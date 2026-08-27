/**
 * /admin/invite-links — the one link that contracts and onboards a new agent.
 *
 * THE CHAIN, AND WHAT PROVES EACH LINK
 *
 *   Create Link  → generate_invite_token(p_kind, p_expires_hours, p_target_role,
 *                  p_target_manager_id, p_prefill, p_notes)  [SECURITY DEFINER;
 *                  requires the caller to have an active agents row]
 *   Open link    → /hire/:token → get_invite_token_prefill(p_token) as anon
 *   Sign up      → consume-invite-token edge function → auth user + agents row,
 *                  placed under target_manager_id, token stamped used
 *   Role applied → trg_apply_invite_target_role on invite_tokens fires the
 *                  moment used_by_agent_id lands and grants the app_role the
 *                  link was minted for.
 *
 * 2026-08-23 fixes:
 *  - "Link Type" was recorded in prefill and changed nothing: both options
 *    minted an identical token. It now decides placement for real — a personal
 *    invite bakes in the upline you pick, an agency signup link mints with no
 *    target_manager_id so the joiner is placed on arrival. The upline control
 *    disables itself for agency links instead of implying a choice that would
 *    be discarded.
 *  - "Invite As" was likewise decorative: target_role was stored and never
 *    read, so Manager / Agency Owner / Staff produced an agent identical to
 *    Agent. The role is now applied by trigger at consume time.
 *  - ...except the trigger could never actually see those values. Measured live
 *    2026-08-23: invite_tokens_target_role_check permitted only
 *    agent / hired_unlicensed / hired_licensed / manager_candidate /
 *    referral_prospect, while fn_apply_invite_target_role branched on
 *    hired_manager / manager / agency_owner / staff. The CHECK rejected the
 *    INSERT before a row carrying those roles could exist, so every one of the
 *    trigger's manager-, owner- and staff-shaped arms was unreachable code and
 *    three of the four buttons below returned 23514 and minted no link at all.
 *    Widened by 20260823180000_invite_target_role_widen.sql; all four verified
 *    minting afterwards. The lesson: a role written into the UI and a role the
 *    trigger translates prove nothing on their own — the table is the third
 *    party that has to agree, and it was the one saying no.
 *  - Every link is openable from this page, so the person minting it can walk
 *    the recruit's path instead of assuming it works.
 *  - Copy and Open build the URL the same way as the mint, so the three can
 *    never disagree about where a link points.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Link2, Copy, Check, Ban, Loader2, User, Users, Building2, ClipboardList, ExternalLink, ShieldCheck,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { resolveBrand } from "@/config/brand";

const BRAND = resolveBrand();
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { toast } from "sonner";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useConfirm } from "@/hooks/useConfirm";

interface InviteTokenRow {
  id: string;
  kind: "hire" | "join";
  token: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  is_active: boolean;
  revoked_at: string | null;
  target_role: string | null;
  target_manager_id: string | null;
  notes: string | null;
}

interface ManagerOption { id: string; name: string }

const ORIGIN = typeof window !== "undefined" ? window.location.origin : "https://apex-financial.org";

const inviteUrl = (row: Pick<InviteTokenRow, "kind" | "token">) => `${ORIGIN}/${row.kind}/${row.token}`;

/**
 * Invite As → the role the token carries. p_target_manager_id is what places
 * the joiner in the downline; target_role is what trg_apply_invite_target_role
 * turns into an actual app_role grant once they finish signing up.
 */
type InviteAs = "agent" | "manager" | "agency_owner" | "staff";
const INVITE_AS: Array<{ key: InviteAs; label: string; desc: string; icon: typeof User; role: string; whiteLabel?: boolean }> = [
  { key: "agent", label: "Agent", desc: "Can work their own pipeline", icon: User, role: "hired_unlicensed" },
  { key: "manager", label: "Manager", desc: "Can manage a downline team", icon: Users, role: "hired_manager" },
  { key: "agency_owner", label: "Agency Owner", desc: "Runs their own team under you — granted manager rights on signup", icon: Building2, role: "agency_owner", whiteLabel: true },
  { key: "staff", label: "Staff", desc: "Assistant — acts on your behalf", icon: ClipboardList, role: "staff" },
];

const EXPIRY_OPTIONS: Array<{ hours: number; label: string }> = [
  { hours: 24, label: "24 hours" },
  { hours: 72, label: "3 days" },
  { hours: 168, label: "7 days" },
  { hours: 720, label: "30 days" },
];

type StatusKey = "all" | "active" | "used" | "revoked";

function rowStatus(row: InviteTokenRow): Exclude<StatusKey, "all"> | "expired" {
  if (row.used_at) return "used";
  if (!row.is_active || row.revoked_at) return "revoked";
  if (new Date(row.expires_at).getTime() < Date.now()) return "expired";
  return "active";
}

function statusBadge(row: InviteTokenRow) {
  const s = rowStatus(row);
  if (s === "used") return <Badge variant="outline" className="border-info/30 bg-info/15 text-info">Used</Badge>;
  if (s === "revoked") return <Badge variant="outline" className="border-border bg-muted text-muted-foreground">Revoked</Badge>;
  if (s === "expired") return <Badge variant="outline" className="border-warning/30 bg-warning/15 text-warning">Expired</Badge>;
  return <Badge variant="outline" className="border-success/30 bg-success/15 text-success">Active</Badge>;
}

export default function InviteLinksAdmin() {
  usePageTitle("Invite Links");
  const askConfirm = useConfirm();
  const [rows, setRows] = useState<InviteTokenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusKey>("all");

  // form state
  const [linkName, setLinkName] = useState("");
  const [inviteAs, setInviteAs] = useState<InviteAs>("agent");
  const [linkType, setLinkType] = useState<"personal" | "agency">("personal");
  const [uplineId, setUplineId] = useState<string>("");
  const [expiresHours, setExpiresHours] = useState(168);
  const [managers, setManagers] = useState<ManagerOption[]>([]);
  const [creating, setCreating] = useState(false);
  const [justCreated, setJustCreated] = useState<{ url: string; name: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("invite_tokens")
      .select("id, kind, token, created_at, expires_at, used_at, is_active, revoked_at, target_role, target_manager_id, notes")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      console.error("invite_tokens load failed", error);
      toast.error("Couldn't load invite links.");
    } else {
      setRows((data ?? []) as unknown as InviteTokenRow[]);
    }
    setLoading(false);
  }, []);

  const loadManagers = useCallback(async () => {
    try {
      const { data, error } = await supabase.functions.invoke("get-active-managers");
      if (error) return;
      const payload = data as {
        managers?: Array<{ id: string; display_name?: string; name?: string }>;
        callerAgentId?: string | null;
      };
      const list = (payload?.managers ?? [])
        .map((m) => ({ id: m.id, name: m.display_name || m.name || "Unnamed" }));
      setManagers(list);
      // "Me (default)" must be a real hierarchy assignment, not a null target.
      // The previous label claimed placement while minting an unassigned token.
      if (payload?.callerAgentId) setUplineId((current) => current || payload.callerAgentId!);
    // empty-catch-allow:optional-upline-list — dropdown visibly falls back to Me (default).
    } catch { /* upline dropdown just falls back to "Me (default)" */ }
  }, []);

  useEffect(() => { load(); loadManagers(); }, [load, loadManagers]);

  const counts = useMemo(() => {
    const c = { all: rows.length, active: 0, used: 0, revoked: 0 };
    for (const r of rows) {
      const s = rowStatus(r);
      if (s === "active") c.active += 1;
      else if (s === "used") c.used += 1;
      else c.revoked += 1; // revoked + expired are both "no longer usable"
    }
    return c;
  }, [rows]);

  const visibleRows = useMemo(() => {
    if (filter === "all") return rows;
    return rows.filter((r) => {
      const s = rowStatus(r);
      if (filter === "revoked") return s === "revoked" || s === "expired";
      return s === filter;
    });
  }, [rows, filter]);

  const chosen = INVITE_AS.find((o) => o.key === inviteAs)!;
  // An agency signup link deliberately carries no upline: the joiner is placed
  // when they arrive. Sending one with an upline baked in would be a different
  // link than the one this option describes.
  const effectiveUpline = linkType === "agency" ? "" : uplineId;

  async function createLink() {
    if (!linkName.trim()) { toast.error("Give the link a name so you can tell them apart."); return; }
    setCreating(true);
    try {
      const { data, error } = await (supabase as any).rpc("generate_invite_token", {
        p_kind: "hire",
        p_expires_hours: expiresHours,
        p_target_role: chosen.role,
        p_target_manager_id: effectiveUpline || null,
        p_prefill: { invite_as: inviteAs, white_label: !!chosen.whiteLabel, link_type: linkType },
        p_notes: linkName.trim(),
      });
      if (error) { toast.error(error.message); return; }

      // Build the shareable URL from this origin so Copy, Open and the panel
      // below can never point somewhere different from each other.
      const minted = data as { url?: string; token?: string; kind?: string } | null;
      if (!minted?.token) {
        toast.error("The link was not returned. Nothing was shared.");
        return;
      }
      const url = inviteUrl({ kind: (minted.kind as "hire" | "join") ?? "hire", token: minted.token });
      setJustCreated({ url, name: linkName.trim() });

      try { await navigator.clipboard.writeText(url); toast.success("Link created and copied."); }
      catch { toast.success("Link created. Copy it from the panel below."); }

      setLinkName("");
      await load();
    } catch (err) {
      console.error("generate_invite_token failed", err);
      toast.error("Couldn't create the link.");
    } finally {
      setCreating(false);
    }
  }

  async function copyUrl(id: string, url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      toast.success("Link copied.");
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 2000);
    } catch { toast.error("Clipboard blocked. Copy manually."); }
  }

  async function revoke(row: InviteTokenRow) {
    const ok = await askConfirm({
      title: "Revoke this link?",
      description: "Anyone who opens it hits an invalid page. Reversible by issuing a new link.",
      confirmText: "Revoke", tone: "danger",
    });
    if (!ok) return;
    const { error } = await (supabase as any)
      .from("invite_tokens")
      .update({ is_active: false, revoked_at: new Date().toISOString() })
      .eq("id", row.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Link revoked.");
    await load();
  }

  return (
    <div className="page-enter mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <PageHeader
        eyebrow="Contracting · Invite an agent"
        eyebrowIcon={<Link2 className="h-3 w-3" />}
        title="Invite Links"
        subtitle="Create one shareable recruiting link. Every recruit confirms licensed or unlicensed; licensed hires start contracting automatically, while unlicensed hires start the licensing roadmap."
      />

      <Card>
        <CardContent className="space-y-6 p-5">
          <div className="space-y-1.5">
            <label htmlFor="link-name" className="text-sm font-medium">
              Link Name <span className="text-destructive">*</span>
            </label>
            <Input id="link-name" value={linkName} onChange={(e) => setLinkName(e.target.value)} placeholder="e.g. New Agent, New Manager, Regional Lead" className="h-11" />
            <p className="text-xs text-muted-foreground">Just a label for you — it won't be shown to the person joining.</p>
          </div>

          <div className="space-y-2">
            <span className="text-sm font-medium">Invite As</span>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {INVITE_AS.map((o) => {
                const Icon = o.icon;
                const active = inviteAs === o.key;
                return (
                  <button
                    key={o.key}
                    type="button"
                    onClick={() => setInviteAs(o.key)}
                    aria-pressed={active}
                    data-testid={`invite-as-${o.key}`}
                    className={`rounded-md border p-4 text-left transition-colors ${active ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"}`}
                  >
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-primary" />
                      <span className="text-sm font-medium">{o.label}</span>
                      {o.whiteLabel && <Badge variant="outline" className="border-primary/30 bg-primary/10 text-[10px] text-primary">White Label</Badge>}
                      {active && <Check className="ml-auto h-4 w-4 text-primary" />}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{o.desc}</p>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <span className="text-sm font-medium">Link Type</span>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {([
                { key: "personal" as const, label: "Personal invite", desc: "You set the upline now — everyone who joins lands under them." },
                { key: "agency" as const, label: "Agency signup link", desc: "No upline baked in — placement is decided when they join." },
              ]).map((t) => {
                const active = linkType === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setLinkType(t.key)}
                    aria-pressed={active}
                    data-testid={`link-type-${t.key}`}
                    className={`rounded-md border p-4 text-left transition-colors ${active ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{t.label}</span>
                      {active && <Check className="ml-auto h-4 w-4 text-primary" />}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{t.desc}</p>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-md border border-primary/35 bg-primary/5 p-4" data-testid="license-routing">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <div>
                <p className="text-sm font-semibold">License status is always required</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  The recruit chooses Licensed or Unlicensed on the invite. Licensed starts native {BRAND.platformName} contracting immediately; unlicensed starts the licensing roadmap. Hires are announced to Slack and Discord automatically.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="upline" className="text-sm font-medium">Their Upline</label>
              <select
                id="upline"
                value={effectiveUpline}
                disabled={linkType === "agency"}
                onChange={(e) => setUplineId(e.target.value)}
                className="h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm disabled:opacity-50"
              >
                <option value="" disabled>Choose an upline</option>
                {managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              <p className="text-xs text-muted-foreground">
                {linkType === "agency"
                  ? "An agency signup link carries no upline — placement happens when they join."
                  : "Anyone joining through this link is placed under whoever you pick here, and their carrier requests go to that person."}
              </p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="expiry" className="text-sm font-medium">Link expires in</label>
              <select
                id="expiry"
                value={expiresHours}
                onChange={(e) => setExpiresHours(Number(e.target.value))}
                className="h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              >
                {EXPIRY_OPTIONS.map((o) => <option key={o.hours} value={o.hours}>{o.label}</option>)}
              </select>
              <p className="text-xs text-muted-foreground">After this the link stops working and has to be reissued.</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <p className="text-xs text-muted-foreground">
              {linkType === "agency"
                ? `New ${chosen.label.toLowerCase()} — upline assigned after they join.`
                : `New ${chosen.label.toLowerCase()} placed under ${uplineId ? (managers.find((m) => m.id === uplineId)?.name ?? "the chosen upline") : "an upline you choose"}.`}
            </p>
            <Button onClick={createLink} disabled={creating || !linkName.trim() || (linkType === "personal" && !uplineId)} className="gap-2" data-testid="create-link">
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
              Create Link
            </Button>
          </div>

          {justCreated && (
            <div className="rounded-md border border-primary/40 bg-primary/5 p-4">
              <p className="text-sm font-medium">{justCreated.name} is ready to share</p>
              <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{justCreated.url}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => copyUrl("just-created", justCreated.url)}>
                  {copiedId === "just-created" ? <><Check className="h-4 w-4" /> Copied</> : <><Copy className="h-4 w-4" /> Copy</>}
                </Button>
                <Button asChild size="sm" variant="outline">
                  <a href={justCreated.url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4" /> Open it yourself
                  </a>
                </Button>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Opening it shows the signup form the recruit sees. It is only consumed when someone submits that form.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">My Invite Links</h2>
          <div className="flex flex-wrap gap-1.5">
            {(["all", "active", "used", "revoked"] as StatusKey[]).map((k) => (
              <Button
                key={k}
                size="sm"
                variant={filter === k ? "default" : "outline"}
                className="h-7 text-xs capitalize"
                onClick={() => setFilter(k)}
                data-testid={`filter-${k}`}
              >
                {k === "revoked" ? "Revoked / expired" : k}: {counts[k]}
              </Button>
            ))}
          </div>
        </div>
        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
            ) : visibleRows.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">
                {rows.length === 0
                  ? "No links yet. Create one above and share it — the person who opens it lands in your downline."
                  : "No links in this state."}
              </p>
            ) : (
              <div className="divide-y divide-border">
                {visibleRows.map((row) => {
                  const url = inviteUrl(row);
                  const usable = rowStatus(row) === "active";
                  return (
                    <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 p-4" data-testid={`invite-row-${row.id}`} data-invite-kind={row.kind}>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">{row.notes || `${row.kind} link`}</span>
                          {statusBadge(row)}
                          {row.target_role && (
                            <span className="text-[11px] capitalize text-muted-foreground">{row.target_role.replace(/_/g, " ")}</span>
                          )}
                        </div>
                        <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{url}</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          Expires {new Date(row.expires_at).toLocaleDateString()}
                          {row.used_at ? ` · Used ${new Date(row.used_at).toLocaleDateString()}` : ""}
                          {row.target_manager_id ? " · Upline preset" : " · Upline set on join"}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button size="sm" onClick={() => copyUrl(row.id, url)} data-testid={`copy-${row.id}`} className="gap-1.5">
                          {copiedId === row.id ? <><Check className="h-4 w-4" /> Copied</> : <><Copy className="h-4 w-4" /> Copy</>}
                        </Button>
                        {usable && (
                          <Button asChild size="sm" variant="outline" data-testid={`open-${row.id}`}>
                            <a href={url} target="_blank" rel="noopener noreferrer" aria-label="Open invite link">
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          </Button>
                        )}
                        {usable && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => revoke(row)}
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                            data-testid={`revoke-${row.id}`}
                            aria-label="Revoke invite link"
                          >
                            <Ban className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
