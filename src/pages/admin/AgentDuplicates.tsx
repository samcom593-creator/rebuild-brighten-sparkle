import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { GitMerge, ShieldCheck, AlertTriangle, Link2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { useConfirm } from "@/hooks/useConfirm";

/**
 * Sam-adjudication for agent identity duplicates.
 *
 * Production is attributed through agents.al_user_id (AgentLink) and
 * agents.insuracloud_user_id. Neither column is unique, so when the same person
 * exists twice the leaderboard and book-of-business split — or double-count —
 * their policies. v_agent_duplicate_candidates surfaces every unresolved pair;
 * merge_agent_into_canonical() collapses the loser onto the winner by setting
 * canonical_agent_id, and the canonical-mapped views pick it up on next refresh.
 *
 * apex-doctor Check #14 links here weekly while any pair is still unresolved.
 */

type DupRow = {
  group_key: string;
  dup_reason: "al_user_id" | "insuracloud_user_id" | "display_name";
  group_display_name: string | null;
  agent_id: string;
  agent_code: string | null;
  display_name: string | null;
  status: string | null;
  al_user_id: number | null;
  insuracloud_user_id: number | null;
  is_active: boolean;
  created_at: string;
  lifetime_deals: number;
  lifetime_alp: number | string;
  applications_assigned: number;
  applications_referred: number;
  last_deal_at: string | null;
  downline_count: number;
  has_production_signal: boolean;
};

const REASON_LABEL: Record<DupRow["dup_reason"], string> = {
  al_user_id: "Same AgentLink ID",
  insuracloud_user_id: "Same InsuraCloud ID",
  display_name: "Same name",
};

/**
 * v_agent_duplicate_candidates and merge_agent_into_canonical() both post-date the last
 * `supabase gen types` run, so neither is in the generated Database union yet. Narrow shim
 * instead of `as any` so the rest of the file stays type-checked.
 */
type UntypedDb = {
  from: (table: string) => {
    select: (columns: string) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  };
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ error: { message: string } | null }>;
};
const db = supabase as unknown as UntypedDb;

const money = (v: number) =>
  v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default function AgentDuplicates() {
  const qc = useQueryClient();
  const askConfirm = useConfirm();

  const { data: rows, isLoading, isError, error } = useQuery({
    queryKey: ["admin_agent_duplicate_candidates"],
    queryFn: async () => {
      const { data, error: qErr } = await db.from("v_agent_duplicate_candidates").select("*");
      if (qErr) throw new Error(qErr.message);
      return (data ?? []) as DupRow[];
    },
  });

  // One card per duplicate group, biggest split production first. Inside each
  // group the row with the most lifetime ALP is the proposed canonical.
  const groups = useMemo(() => {
    const byKey = new Map<string, DupRow[]>();
    for (const row of rows ?? []) {
      const bucket = byKey.get(row.group_key);
      if (bucket) bucket.push(row);
      else byKey.set(row.group_key, [row]);
    }
    return [...byKey.entries()]
      .map(([key, members]) => {
        const sorted = [...members].sort((a, b) => Number(b.lifetime_alp) - Number(a.lifetime_alp));
        return {
          key,
          reason: sorted[0].dup_reason,
          label: sorted[0].group_display_name ?? "—",
          members: sorted,
          splitAlp: sorted.slice(1).reduce((sum, m) => sum + Number(m.lifetime_alp), 0),
          totalAlp: sorted.reduce((sum, m) => sum + Number(m.lifetime_alp), 0),
        };
      })
      .sort((a, b) => b.splitAlp - a.splitAlp);
  }, [rows]);

  const merge = useMutation({
    mutationFn: async (vars: { canonicalId: string; dupId: string }) => {
      const { error: rpcErr } = await db.rpc("merge_agent_into_canonical", {
        p_canonical_agent_id: vars.canonicalId,
        p_dup_agent_id: vars.dupId,
      });
      if (rpcErr) throw new Error(rpcErr.message);
    },
    onSuccess: () => {
      toast.success("Merged — production now rolls up to the canonical agent");
      void qc.invalidateQueries({ queryKey: ["admin_agent_duplicate_candidates"] });
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Merge failed");
    },
  });

  const handleMerge = async (canonical: DupRow, dup: DupRow) => {
    const ok = await askConfirm({
      title: `Merge ${dup.display_name ?? "this row"} into ${canonical.display_name ?? "the canonical row"}?`,
      description: (
        <>
          {dup.display_name ?? "The duplicate"} keeps its record but stops counting on its own:
          its {dup.lifetime_deals} deals ({money(Number(dup.lifetime_alp))} ALP) roll up to{" "}
          {canonical.display_name ?? "the canonical agent"}. Reversible by clearing
          canonical_agent_id.
        </>
      ),
      confirmText: "Merge",
      tone: "primary",
    });
    if (!ok) return;
    merge.mutate({ canonicalId: canonical.agent_id, dupId: dup.agent_id });
  };

  const totalSplit = groups.reduce((sum, g) => sum + g.splitAlp, 0);

  return (
    <div className="container mx-auto px-4 py-6 space-y-6">
      <PageHeader
        title="Agent Duplicates"
        subtitle="Two agent rows, one real person. Pick the real one and production stops splitting."
      />

      {isError && (
        <Card className="border-destructive/40">
          <CardContent className="flex items-start gap-3 py-4">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
            <div className="text-sm">
              <p className="font-medium">Could not load duplicate candidates.</p>
              <p className="text-muted-foreground">
                {error instanceof Error ? error.message : "Unknown error"}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading && (
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      )}

      {!isLoading && !isError && groups.length === 0 && (
        <Card>
          <CardContent className="flex items-center gap-3 py-8">
            <ShieldCheck className="h-6 w-6 text-emerald-500" />
            <div>
              <p className="font-medium">No unresolved duplicates.</p>
              <p className="text-sm text-muted-foreground">
                Every agent identity maps to exactly one row. Nothing to adjudicate.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {!isLoading && !isError && groups.length > 0 && (
        <>
          <Card>
            <CardContent className="grid grid-cols-2 gap-4 py-5 sm:grid-cols-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Unresolved pairs</p>
                <p className="text-2xl font-semibold">{groups.length}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Rows to adjudicate</p>
                <p className="text-2xl font-semibold">{rows?.length ?? 0}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">ALP on the wrong row</p>
                <p className="text-2xl font-semibold">{money(totalSplit)}</p>
              </div>
            </CardContent>
          </Card>

          {groups.map((group) => (
            <Card key={group.key}>
              <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Link2 className="h-4 w-4 text-muted-foreground" />
                  {group.label}
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{REASON_LABEL[group.reason]}</Badge>
                  <Badge variant="secondary">{money(group.totalAlp)} combined</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {group.members.map((member, position) => {
                  const canonical = group.members[0];
                  const isProposed = position === 0;
                  return (
                    <div
                      key={member.agent_id}
                      className={cn(
                        "flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between",
                        isProposed ? "border-primary/40 bg-primary/5" : "border-border",
                      )}
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{member.display_name ?? "—"}</span>
                          {member.agent_code && (
                            <span className="text-xs text-muted-foreground">{member.agent_code}</span>
                          )}
                          <Badge variant={member.is_active ? "default" : "outline"}>
                            {member.status ?? "—"}
                          </Badge>
                          {isProposed && (
                            <Badge variant="secondary" className="gap-1">
                              <ShieldCheck className="h-3 w-3" />
                              Most production
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {member.lifetime_deals} deals · {money(Number(member.lifetime_alp))} ALP ·{" "}
                          {member.downline_count} downline ·{" "}
                          {member.applications_assigned + member.applications_referred} applicants
                        </p>
                        <p className="text-xs text-muted-foreground">
                          AgentLink {member.al_user_id ?? "—"} · InsuraCloud{" "}
                          {member.insuracloud_user_id ?? "—"} · last deal{" "}
                          {member.last_deal_at
                            ? formatDistanceToNow(new Date(member.last_deal_at), { addSuffix: true })
                            : "never"}{" "}
                          · added{" "}
                          {formatDistanceToNow(new Date(member.created_at), { addSuffix: true })}
                        </p>
                      </div>
                      <div className="shrink-0">
                        {isProposed ? (
                          <Badge variant="outline">Keeps everything</Badge>
                        ) : (
                          <Button
                            size="sm"
                            variant="secondary"
                            className="gap-2"
                            disabled={merge.isPending}
                            onClick={() => void handleMerge(canonical, member)}
                          >
                            <GitMerge className="h-4 w-4" />
                            Merge into {canonical.display_name ?? "canonical"}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
                <p className="text-xs text-muted-foreground">
                  Wrong winner? Merge is reversible — clearing canonical_agent_id puts the row back on
                  its own.
                </p>
              </CardContent>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}
