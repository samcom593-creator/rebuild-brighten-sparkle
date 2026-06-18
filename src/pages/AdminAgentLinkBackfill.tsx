import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, Loader2, Mail, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { supabase } from "@/integrations/supabase/client";
import { useAgentProfileDrawer } from "@/stores/agentProfileDrawer";
import { toast } from "sonner";
import { usePageTitle } from "@/hooks/usePageTitle";
import { cn } from "@/lib/utils";

/**
 * /admin/agentlink-backfill — surface the 31 licensed active agents
 * whose al_user_id is NULL. They produce in AgentLink but don't appear
 * in book-of-business leaderboards on apex-financial.org until linked.
 *
 * Sam directive 2026-06-18 (context): 'I'm still missing Daniel and more
 * people inside the leaderboards.' Plus: 'add all there numbers even tau.'
 *
 * Backfill flow per row:
 *   - Type in their AgentLink user_id (the int from agentlink_agents)
 *   - Save → UPDATE agents SET al_user_id = X
 *   - Optionally tap 'Suggest from name' to scan agentlink_agents for a
 *     first-last match.
 */

interface MissingRow {
  agent_id: string;
  display_name: string | null;
  agent_code: string | null;
  license_status: string | null;
  status: string | null;
  created_at: string | null;
}

interface ALSuggestion {
  insuracloud_user_id: number;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch { return "—"; }
}

export default function AdminAgentLinkBackfill() {
  usePageTitle("AgentLink Backfill · Apex Admin");
  const qc = useQueryClient();
  const openAgent = useAgentProfileDrawer((s) => s.openAgent);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Record<string, ALSuggestion[]>>({});

  const { data: rows = [], isLoading } = useQuery<MissingRow[]>({
    queryKey: ["admin-agentlink-backfill"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("v_agents_missing_al_link")
        .select("*");
      if (error) {
        toast.error(`Load failed: ${error.message.slice(0, 80)}`);
        return [];
      }
      return (data as MissingRow[]) ?? [];
    },
    staleTime: 30_000,
  });

  async function suggest(row: MissingRow) {
    const name = (row.display_name ?? "").trim();
    if (!name) return;
    const parts = name.split(/\s+/);
    const first = parts[0]?.toLowerCase();
    const last = parts[parts.length - 1]?.toLowerCase();
    setBusyId(row.agent_id);
    try {
      const { data, error } = await (supabase as any)
        .from("agentlink_agents")
        .select("insuracloud_user_id, first_name, last_name, email")
        .or(`first_name.ilike.%${first}%,last_name.ilike.%${last}%`)
        .not("insuracloud_user_id", "is", null)
        .limit(5);
      if (error) throw error;
      setSuggestions((prev) => ({ ...prev, [row.agent_id]: (data as any[]) ?? [] }));
      if (!(data as any[])?.length) toast.info("No AgentLink match found");
    } catch (e: any) {
      toast.error(`Suggest failed: ${e?.message?.slice(0, 80) ?? "unknown"}`);
    } finally {
      setBusyId(null);
    }
  }

  async function link(row: MissingRow, alUserId: number | string) {
    const id = typeof alUserId === "string" ? parseInt(alUserId, 10) : alUserId;
    if (!Number.isFinite(id)) {
      toast.error("Invalid AgentLink user_id");
      return;
    }
    setBusyId(row.agent_id);
    try {
      const { error } = await (supabase as any)
        .from("agents")
        .update({ al_user_id: id, updated_at: new Date().toISOString() })
        .eq("id", row.agent_id);
      if (error) throw error;
      toast.success(`${row.display_name} linked to AgentLink user ${id}`);
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[row.agent_id];
        return next;
      });
      await qc.invalidateQueries({ queryKey: ["admin-agentlink-backfill"] });
    } catch (e: any) {
      toast.error(`Link failed: ${e?.message?.slice(0, 80) ?? "unknown"}`);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-5xl mx-auto">
      <PageHeader
        title="AgentLink Backfill"
        subtitle={`${rows.length} licensed active agents missing AgentLink linkage — they won't show on leaderboards until linked.`}
        accent="purple"
      />

      {isLoading ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">Loading…</CardContent></Card>
      ) : !rows.length ? (
        <Card>
          <CardContent className="p-8 text-center">
            <CheckCircle2 className="h-8 w-8 mx-auto text-emerald-500 mb-2" />
            <p className="text-sm font-semibold">All licensed actives linked.</p>
            <p className="text-xs text-muted-foreground mt-1">Every agent appears on book-of-business leaderboards.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => {
            const draft = drafts[row.agent_id] ?? "";
            const isBusy = busyId === row.agent_id;
            const sugg = suggestions[row.agent_id] ?? [];
            return (
              <Card key={row.agent_id} className="hover:bg-muted/20 transition-colors">
                <CardContent className="p-3 sm:p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <button
                      onClick={() => openAgent(row.agent_id)}
                      className="min-w-0 text-left"
                    >
                      <p className="text-sm font-bold leading-tight truncate">
                        {row.display_name?.trim() || "—"}
                        {row.agent_code && <span className="text-muted-foreground font-normal"> · {row.agent_code}</span>}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        Hired {fmtDate(row.created_at)} · {row.license_status}
                      </p>
                    </button>
                    <Badge variant="outline" className="text-[10px] gap-1 border-violet-500/40 bg-violet-500/10 text-violet-400">
                      🔗 NEEDS_AGENTLINK
                    </Badge>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <Input
                      value={draft}
                      onChange={(e) => setDrafts((p) => ({ ...p, [row.agent_id]: e.target.value }))}
                      placeholder="AgentLink user_id (e.g. 901)"
                      type="number"
                      className="h-8 text-xs flex-1 min-w-[160px]"
                      disabled={isBusy}
                    />
                    <Button
                      size="sm"
                      className="h-8 gap-1 text-xs"
                      disabled={isBusy || !draft.trim()}
                      onClick={() => link(row, draft)}
                    >
                      {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                      Link
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1 text-xs"
                      disabled={isBusy}
                      onClick={() => suggest(row)}
                    >
                      <Search className="h-3 w-3" />
                      Suggest
                    </Button>
                    <a
                      href="https://agentlink.insuracloud.ai/admin/agents"
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-violet-300"
                    >
                      <ExternalLink className="h-3 w-3" />
                      AgentLink roster
                    </a>
                  </div>

                  {sugg.length > 0 && (
                    <div className="rounded-md border border-violet-500/20 bg-violet-500/5 p-2 space-y-1.5">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                        AgentLink suggestions
                      </p>
                      {sugg.map((s) => (
                        <button
                          key={s.insuracloud_user_id}
                          onClick={() => link(row, s.insuracloud_user_id)}
                          className={cn(
                            "w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded hover:bg-violet-500/10 transition-colors text-xs text-left",
                          )}
                          disabled={isBusy}
                        >
                          <span className="min-w-0 flex-1">
                            <p className="font-medium truncate">
                              {s.first_name} {s.last_name}
                            </p>
                            {s.email && (
                              <p className="text-[10px] text-muted-foreground truncate flex items-center gap-1">
                                <Mail className="h-2.5 w-2.5" />
                                {s.email}
                              </p>
                            )}
                          </span>
                          <span className="shrink-0 font-mono text-violet-400 tabular-nums">
                            #{s.insuracloud_user_id}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
