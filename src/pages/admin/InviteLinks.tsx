/**
 * /admin/invite-links — MP-234 magic invite links admin.
 *
 * Lists both hire and join tokens minted via generate_invite_token RPC.
 * Share-only: never rendered in GlobalSidebar. Direct URL only.
 *
 * Actions:
 *   - Generate new hire or join token.
 *   - Copy full URL to clipboard.
 *   - Revoke (soft, sets is_active=false + revoked_at).
 *
 * RLS: invite_tokens.admin_all policy scopes reads to admin/manager or
 * created_by_user_id, so managers only see their own links.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Link2,
  Copy,
  Check,
  Plus,
  Ban,
  Loader2,
  Users,
  UserPlus,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { usePageTitle } from "@/hooks/usePageTitle";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";

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

const ORIGIN =
  typeof window !== "undefined" ? window.location.origin : "https://apex-financial.org";

function statusBadge(row: InviteTokenRow) {
  if (row.used_at) {
    return (
      <Badge className="bg-blue-500/20 text-blue-300 border-blue-500/30">
        Used
      </Badge>
    );
  }
  if (!row.is_active || row.revoked_at) {
    return (
      <Badge className="bg-gray-500/20 text-gray-300 border-gray-500/30">
        Revoked
      </Badge>
    );
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return (
      <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30">
        Expired
      </Badge>
    );
  }
  return (
    <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30">
      Active
    </Badge>
  );
}

export default function InviteLinksAdmin() {
  usePageTitle("Invite Links");
  const [rows, setRows] = useState<InviteTokenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState<"hire" | "join" | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [tab, setTab] = useState<"all" | "hire" | "join">("all");

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("invite_tokens")
      .select(
        "id, kind, token, created_at, expires_at, used_at, is_active, revoked_at, target_role, notes",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      console.error("invite_tokens load failed", error);
      toast.error("Couldn't load invite links.");
      setLoading(false);
      return;
    }
    setRows((data ?? []) as InviteTokenRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (tab === "all") return rows;
    return rows.filter((r) => r.kind === tab);
  }, [rows, tab]);

  const counts = useMemo(() => {
    return {
      all: rows.length,
      hire: rows.filter((r) => r.kind === "hire").length,
      join: rows.filter((r) => r.kind === "join").length,
    };
  }, [rows]);

  async function generate(kind: "hire" | "join") {
    setGenerating(kind);
    try {
      const { data, error } = await supabase.rpc("generate_invite_token", {
        p_kind: kind,
        p_expires_hours: 168,
        p_target_role: kind === "hire" ? "hired_unlicensed" : "referral_prospect",
        p_notes: `admin/invite-links · ${kind}`,
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      const url = (data as { url?: string })?.url;
      if (!url) {
        toast.error("No URL returned.");
        return;
      }
      try {
        await navigator.clipboard.writeText(url);
        toast.success(`${kind === "hire" ? "Hire" : "Join"} link copied.`);
      } catch {
        toast.success(`${kind === "hire" ? "Hire" : "Join"} link: ${url}`);
      }
      await load();
    } catch (err) {
      console.error("generate_invite_token failed", err);
      toast.error("Couldn't generate link.");
    } finally {
      setGenerating(null);
    }
  }

  async function copyUrl(row: InviteTokenRow) {
    const url = `${ORIGIN}/${row.kind}/${row.token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(row.id);
      toast.success("Link copied.");
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      toast.error("Clipboard blocked. Copy manually.");
    }
  }

  async function revoke(row: InviteTokenRow) {
    if (!confirm(`Revoke this ${row.kind} link? Anyone who opens it will hit an invalid page.`)) return;
    const { error } = await supabase
      .from("invite_tokens")
      .update({
        is_active: false,
        revoked_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Link revoked.");
    await load();
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Link2 className="h-6 w-6 text-primary" />
            Invite Links
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            One-use, share-only links. Hire = new agent, Join = prospect capture.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            data-testid="generate-hire"
            data-invite-kind="hire"
            disabled={generating !== null}
            onClick={() => generate("hire")}
          >
            {generating === "hire" ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <UserPlus className="h-4 w-4 mr-1" />
            )}
            New Hire Link
          </Button>
          <Button
            size="sm"
            data-testid="generate-join"
            data-invite-kind="join"
            disabled={generating !== null}
            onClick={() => generate("join")}
          >
            {generating === "join" ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <Plus className="h-4 w-4 mr-1" />
            )}
            New Join Link
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "all" | "hire" | "join")}>
        <TabsList>
          <TabsTrigger value="all" data-testid="tab-all">
            All ({counts.all})
          </TabsTrigger>
          <TabsTrigger value="hire" data-testid="tab-hire">
            <Users className="h-3.5 w-3.5 mr-1" /> Hire ({counts.hire})
          </TabsTrigger>
          <TabsTrigger value="join" data-testid="tab-join">
            <UserPlus className="h-3.5 w-3.5 mr-1" /> Join ({counts.join})
          </TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-4">
          <GlassCard className="p-0 overflow-hidden">
            {loading ? (
              <div className="p-8 flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : filtered.length === 0 ? (
              <p className="p-8 text-sm text-muted-foreground text-center">
                {tab === "all"
                  ? "No links yet. Generate one above."
                  : `No ${tab} links yet. Generate one above.`}
              </p>
            ) : (
              <div className="divide-y divide-border">
                {filtered.map((row) => {
                  const url = `${ORIGIN}/${row.kind}/${row.token}`;
                  const revocable =
                    row.is_active && !row.used_at && !row.revoked_at;
                  return (
                    <div
                      key={row.id}
                      className="p-4 flex items-center justify-between gap-3 flex-wrap"
                      data-testid={`invite-row-${row.id}`}
                      data-invite-kind={row.kind}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge
                            variant="outline"
                            className={
                              row.kind === "hire"
                                ? "bg-purple-500/10 text-purple-300 border-purple-500/30"
                                : "bg-cyan-500/10 text-cyan-300 border-cyan-500/30"
                            }
                          >
                            {row.kind}
                          </Badge>
                          {statusBadge(row)}
                        </div>
                        <p className="text-sm font-mono truncate mt-1 text-muted-foreground">
                          {url}
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          Expires {new Date(row.expires_at).toLocaleDateString()}
                          {row.used_at
                            ? ` · Used ${new Date(row.used_at).toLocaleDateString()}`
                            : ""}
                        </p>
                      </div>

                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          onClick={() => copyUrl(row)}
                          data-testid={`copy-${row.id}`}
                          className="gap-1.5"
                        >
                          {copiedId === row.id ? (
                            <>
                              <Check className="h-4 w-4" /> Copied
                            </>
                          ) : (
                            <>
                              <Copy className="h-4 w-4" /> Copy
                            </>
                          )}
                        </Button>
                        {revocable ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => revoke(row)}
                            className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                            data-testid={`revoke-${row.id}`}
                          >
                            <Ban className="h-4 w-4" />
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </GlassCard>
        </TabsContent>
      </Tabs>
    </div>
  );
}
