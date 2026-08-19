/**
 * /admin/invite-links — APEX one-stop contracting + signup.
 *
 * 2026-08-19 (Sam, with his Agent Cloud "Invite Links" screenshot + "one link
 * contracting and signup, this my one stop shop"): rebuilt from the bare
 * hire/join generator into the Agent Cloud invite flow — Link Name, Invite As
 * (Agent / Manager / Agency Owner [White Label] / Staff), Their Upline, Link
 * Type (personal vs agency signup), then the shareable link that places the
 * new agent directly in that upline's downline.
 *
 * Every link is minted by the SAME generate_invite_token RPC that already
 * worked — p_notes=Link Name, p_target_role=role, p_target_manager_id=upline
 * (this is what actually places them in the downline), p_prefill carries the
 * invite_as / white_label / link_type intent. Copy + revoke + the live list
 * are preserved. Final comp level is confirmed on the joiner's profile after
 * they join — the same model Agent Cloud states on this page — so nothing here
 * claims a role is fully provisioned before the person exists.
 *
 * RLS: invite_tokens.admin_all scopes reads to admin/manager or
 * created_by_user_id, so managers see only their own links.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Link2, Copy, Check, Ban, Loader2, User, Users, Building2, ClipboardList, ArrowRight,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
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
  notes: string | null;
}

interface ManagerOption { id: string; name: string }

const ORIGIN = typeof window !== "undefined" ? window.location.origin : "https://apex-financial.org";

// Invite As → the role the token carries. p_target_manager_id is what actually
// places the joiner in the downline; target_role + prefill record the intent
// the joiner's profile is finalized against after they sign up.
type InviteAs = "agent" | "manager" | "agency_owner" | "staff";
const INVITE_AS: { key: InviteAs; label: string; desc: string; icon: typeof User; role: string; whiteLabel?: boolean }[] = [
  { key: "agent", label: "Agent", desc: "Can work their own pipeline", icon: User, role: "hired_unlicensed" },
  { key: "manager", label: "Manager", desc: "Can manage a downline team", icon: Users, role: "hired_manager" },
  { key: "agency_owner", label: "Agency Owner", desc: "Their own sub-agency — they manage their team independently", icon: Building2, role: "agency_owner", whiteLabel: true },
  { key: "staff", label: "Staff", desc: "Assistant — acts on your behalf", icon: ClipboardList, role: "staff" },
];

function statusBadge(row: InviteTokenRow) {
  if (row.used_at) return <Badge variant="outline" className="bg-info/15 text-info border-info/30">Used</Badge>;
  if (!row.is_active || row.revoked_at) return <Badge variant="outline" className="bg-muted text-muted-foreground border-border">Revoked</Badge>;
  if (new Date(row.expires_at).getTime() < Date.now()) return <Badge variant="outline" className="bg-warning/15 text-warning border-warning/30">Expired</Badge>;
  return <Badge variant="outline" className="bg-success/15 text-success border-success/30">Active</Badge>;
}

export default function InviteLinksAdmin() {
  usePageTitle("Invite Links");
  const askConfirm = useConfirm();
  const [rows, setRows] = useState<InviteTokenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // form state
  const [linkName, setLinkName] = useState("");
  const [inviteAs, setInviteAs] = useState<InviteAs>("agent");
  const [linkType, setLinkType] = useState<"personal" | "agency">("personal");
  const [uplineId, setUplineId] = useState<string>("");
  const [managers, setManagers] = useState<ManagerOption[]>([]);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("invite_tokens")
      .select("id, kind, token, created_at, expires_at, used_at, is_active, revoked_at, target_role, notes")
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
      const list = ((data as { managers?: Array<{ id: string; display_name?: string; name?: string }> })?.managers ?? [])
        .map((m) => ({ id: m.id, name: m.display_name || m.name || "Unnamed" }));
      setManagers(list);
    } catch { /* upline dropdown just falls back to "Me (default)" */ }
  }, []);

  useEffect(() => { load(); loadManagers(); }, [load, loadManagers]);

  const counts = useMemo(() => ({
    all: rows.length,
    active: rows.filter((r) => r.is_active && !r.used_at && !r.revoked_at && new Date(r.expires_at).getTime() > Date.now()).length,
    used: rows.filter((r) => r.used_at).length,
  }), [rows]);

  async function createLink() {
    if (!linkName.trim()) { toast.error("Give the link a name so you can tell them apart."); return; }
    setCreating(true);
    try {
      const chosen = INVITE_AS.find((o) => o.key === inviteAs)!;
      const { data, error } = await supabase.rpc("generate_invite_token", {
        p_kind: "hire",
        p_expires_hours: 168,
        p_target_role: chosen.role,
        p_target_manager_id: uplineId || null,
        p_prefill: { invite_as: inviteAs, white_label: !!chosen.whiteLabel, link_type: linkType },
        p_notes: linkName.trim(),
      });
      if (error) { toast.error(error.message); return; }
      const url = (data as { url?: string })?.url;
      if (url) {
        try { await navigator.clipboard.writeText(url); toast.success("Link created and copied."); }
        catch { toast.success(`Link created: ${url}`); }
      }
      setLinkName("");
      await load();
    } catch (err) {
      console.error("generate_invite_token failed", err);
      toast.error("Couldn't create the link.");
    } finally {
      setCreating(false);
    }
  }

  async function copyUrl(row: InviteTokenRow) {
    const url = `${ORIGIN}/${row.kind}/${row.token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(row.id);
      toast.success("Link copied.");
      setTimeout(() => setCopiedId(null), 2000);
    } catch { toast.error("Clipboard blocked. Copy manually."); }
  }

  async function revoke(row: InviteTokenRow) {
    const ok = await askConfirm({
      title: "Revoke this link?",
      description: "Anyone who opens it hits an invalid page. Reversible by issuing a new link.",
      confirmText: "Revoke", tone: "danger",
    });
    if (!ok) return;
    const { error } = await supabase.from("invite_tokens").update({ is_active: false, revoked_at: new Date().toISOString() }).eq("id", row.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Link revoked.");
    await load();
  }

  const chosen = INVITE_AS.find((o) => o.key === inviteAs)!;

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6 page-enter">
      <PageHeader
        eyebrow="Contracting · Invite Links"
        eyebrowIcon={<Link2 className="h-3 w-3" />}
        title="Invite Links"
        subtitle="Create a shareable link that places new agents directly in your downline. One link contracts and onboards them — carrier requests route to whoever you pick as their upline."
      />

      <Card>
        <CardContent className="p-5 space-y-6">
          {/* Link name */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Link Name <span className="text-destructive">*</span></label>
            <Input value={linkName} onChange={(e) => setLinkName(e.target.value)} placeholder="e.g. New Agent, New Manager, Regional Lead" className="h-11" />
            <p className="text-xs text-muted-foreground">Just a label for you — it won't be shown to the person joining.</p>
          </div>

          {/* Invite As */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Invite As</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {INVITE_AS.map((o) => {
                const Icon = o.icon;
                const active = inviteAs === o.key;
                return (
                  <button key={o.key} type="button" onClick={() => setInviteAs(o.key)}
                    className={`text-left rounded-md border p-4 transition-colors ${active ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"}`}>
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-primary" />
                      <span className="font-medium text-sm">{o.label}</span>
                      {o.whiteLabel && <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30 text-[10px]">White Label</Badge>}
                      {active && <Check className="h-4 w-4 text-primary ml-auto" />}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{o.desc}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Link type */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Link Type</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {([
                { key: "personal" as const, label: "Personal invite", desc: '"[Your name] invited you" — you set the upline' },
                { key: "agency" as const, label: "Agency signup link", desc: '"[Agency] invited you" — they pick their upline' },
              ]).map((t) => {
                const active = linkType === t.key;
                return (
                  <button key={t.key} type="button" onClick={() => setLinkType(t.key)}
                    className={`text-left rounded-md border p-4 transition-colors ${active ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"}`}>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{t.label}</span>
                      {active && <Check className="h-4 w-4 text-primary ml-auto" />}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{t.desc}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Their upline */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Their Upline</label>
            <select value={uplineId} onChange={(e) => setUplineId(e.target.value)}
              className="h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm">
              <option value="">Me (default)</option>
              {managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <p className="text-xs text-muted-foreground">Anyone joining through this link is placed under whoever you pick here, and their carrier requests go to that person.</p>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
            <p className="text-xs text-muted-foreground">
              {chosen.whiteLabel ? "White-label sub-agency — they run their own branded team under you." : `New ${chosen.label.toLowerCase()} placed under ${uplineId ? managers.find((m) => m.id === uplineId)?.name ?? "the chosen upline" : "you"}.`}
            </p>
            <Button onClick={createLink} disabled={creating || !linkName.trim()} className="gap-2">
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
              Create Link
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* My invite links */}
      <div>
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">My Invite Links</h2>
          <p className="text-xs text-muted-foreground">{counts.active} active · {counts.used} used · {counts.all} total</p>
        </div>
        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-8 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
            ) : rows.length === 0 ? (
              <p className="p-8 text-sm text-muted-foreground text-center">No links yet. Create one above and share it — the person who opens it lands in your downline.</p>
            ) : (
              <div className="divide-y divide-border">
                {rows.map((row) => {
                  const url = `${ORIGIN}/${row.kind}/${row.token}`;
                  const revocable = row.is_active && !row.used_at && !row.revoked_at;
                  return (
                    <div key={row.id} className="p-4 flex items-center justify-between gap-3 flex-wrap" data-testid={`invite-row-${row.id}`} data-invite-kind={row.kind}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{row.notes || `${row.kind} link`}</span>
                          {statusBadge(row)}
                        </div>
                        <p className="text-xs font-mono truncate mt-1 text-muted-foreground">{url}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          Expires {new Date(row.expires_at).toLocaleDateString()}
                          {row.used_at ? ` · Used ${new Date(row.used_at).toLocaleDateString()}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button size="sm" onClick={() => copyUrl(row)} data-testid={`copy-${row.id}`} className="gap-1.5">
                          {copiedId === row.id ? <><Check className="h-4 w-4" /> Copied</> : <><Copy className="h-4 w-4" /> Copy</>}
                        </Button>
                        {revocable && (
                          <Button variant="ghost" size="sm" onClick={() => revoke(row)} className="text-destructive hover:text-destructive hover:bg-destructive/10" data-testid={`revoke-${row.id}`}>
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
