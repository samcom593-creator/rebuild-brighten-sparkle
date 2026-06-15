import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  GitMerge,
  Loader2,
  ShieldCheck,
  Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePageTitle } from "@/hooks/usePageTitle";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

/**
 * wave-100: Sam-adjudication surface for unresolved same-display_name agent pairs.
 *
 * v_agent_duplicate_candidates surfaces pairs where 2+ agents.display_name match AND
 * 2+ rows still have canonical_agent_id IS NULL. Clicking Merge calls the
 * merge_agent_into_canonical RPC (admin gate via user_roles) which sets
 * canonical_agent_id on the dup; the wave-93+ canonical-mapped views auto-collapse
 * downstream so leaderboard/book/command-center stop double-counting on next refresh.
 */

type CandidateRow = {
  group_display_name: string;
  agent_id: string;
  agent_code: string;
  status: string;
  canonical_agent_id: string | null;
  al_user_id: number | null;
  created_at: string;
  lifetime_deals: number;
  lifetime_alp: number | string;
  applications_assigned: number;
  applications_referred: number;
  last_deal_at: string | null;
  downline_count: number;
  has_production_signal: boolean;
};

type Group = {
  display_name: string;
  rows: CandidateRow[];
};

const fmtUsd = (v: number | string | null) => {
  const n = typeof v === "string" ? Number(v) : (v ?? 0);
  if (!Number.isFinite(n) || n === 0) return "$0";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
};

const fmtDate = (iso: string | null) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

const STATUS_BADGE: Record<string, string> = {
  active: "border-emerald-500/40 text-emerald-200 bg-emerald-500/15",
  terminated: "border-slate-500/40 text-slate-300 bg-slate-500/15",
  pending: "border-amber-500/40 text-amber-200 bg-amber-500/15",
};

export default function AgentDuplicates() {
  usePageTitle("Agent Duplicates · APEX Financial");
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const [pendingMerge, setPendingMerge] = useState<{
    canonical: CandidateRow;
    dup: CandidateRow;
  } | null>(null);

  const { data: rows, isLoading } = useQuery({
    queryKey: ["agentDuplicateCandidates"],
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_agent_duplicate_candidates")
        .select("*");
      if (error) throw error;
      return (data ?? []) as CandidateRow[];
    },
  });

  const merge = useMutation({
    mutationFn: async (args: { canonical_id: string; dup_id: string }) => {
      const { error } = await supabase.rpc("merge_agent_into_canonical", {
        p_canonical_agent_id: args.canonical_id,
        p_dup_agent_id: args.dup_id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Merged. Canonical views rebuild on next refresh.");
      qc.invalidateQueries({ queryKey: ["agentDuplicateCandidates"] });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Merge failed";
      toast.error(msg);
    },
    onSettled: () => setPendingMerge(null),
  });

  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, CandidateRow[]>();
    for (const r of rows ?? []) {
      const key = r.group_display_name;
      const list = map.get(key) ?? [];
      list.push(r);
      map.set(key, list);
    }
    return Array.from(map.entries())
      .map(([display_name, rs]) => ({
        display_name,
        rows: [...rs].sort((a, b) => Number(b.lifetime_alp) - Number(a.lifetime_alp)),
      }))
      .sort((a, b) => {
        const aActive = a.rows.some((r) => r.status === "active");
        const bActive = b.rows.some((r) => r.status === "active");
        if (aActive !== bActive) return aActive ? -1 : 1;
        const aProd = a.rows.reduce((s, r) => s + Number(r.lifetime_alp), 0);
        const bProd = b.rows.reduce((s, r) => s + Number(r.lifetime_alp), 0);
        return bProd - aProd;
      });
  }, [rows]);

  const heroStats = useMemo(() => {
    const list = rows ?? [];
    const groupCount = groups.length;
    const activeGroups = groups.filter((g) => g.rows.some((r) => r.status === "active")).length;
    const totalDeals = list.reduce((s, r) => s + r.lifetime_deals, 0);
    const totalAlp = list.reduce((s, r) => s + Number(r.lifetime_alp), 0);
    return { groupCount, activeGroups, totalDeals, totalAlp };
  }, [rows, groups]);

  if (!isAdmin) {
    return (
      <div className="container mx-auto max-w-2xl p-6">
        <Card>
          <CardContent className="py-10 text-center">
            <ShieldCheck className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
            <h2 className="text-base font-semibold">Admins only</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Agent merge actions are restricted to admins.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="container mx-auto max-w-6xl p-6 flex items-center justify-center min-h-[40vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-6xl p-4 sm:p-6 space-y-5">
      {/* Hero */}
      <div className="rounded-3xl border border-amber-500/25 bg-gradient-to-br from-slate-950 via-slate-900 to-amber-950 text-white shadow-[0_0_64px_-12px_hsl(40_85%_55%/0.30)] overflow-hidden relative">
        <div className="absolute -top-32 -right-32 h-80 w-80 rounded-full bg-amber-500/20 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-40 -left-32 h-96 w-96 rounded-full bg-rose-500/15 blur-3xl pointer-events-none" />

        <div className="relative p-6 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75 animate-ping" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
                </span>
                <p className="text-[11px] uppercase tracking-[0.32em] font-bold text-amber-300">
                  AGENT DUP CANARY · WAVE-100
                </p>
              </div>
              <h1 className="text-2xl sm:text-3xl font-black flex items-center gap-2 text-white">
                <Users className="h-7 w-7 text-amber-300" /> Agent Duplicates
              </h1>
              <p className="text-sm text-white/60 mt-1.5 max-w-2xl">
                Same display name on multiple agent rows. Pick the canonical row, click Merge.
                The wave-93+ canonical-mapped views auto-collapse downstream — no more
                double-counting on leaderboards or book-of-business.
              </p>
            </div>
          </div>

          <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
            <div className="p-3 rounded-xl bg-amber-500/[0.08] border border-amber-500/20">
              <p className="text-[9px] uppercase tracking-widest text-white/50 font-bold mb-1.5">DUP GROUPS</p>
              <p className="text-[22px] leading-none font-black tabular-nums text-amber-200">{heroStats.groupCount}</p>
            </div>
            <div className="p-3 rounded-xl bg-rose-500/[0.08] border border-rose-500/20">
              <p className="text-[9px] uppercase tracking-widest text-white/50 font-bold mb-1.5">ACTIVE GROUPS</p>
              <p className="text-[22px] leading-none font-black tabular-nums text-rose-300">{heroStats.activeGroups}</p>
              <p className="text-[10px] text-white/40 tabular-nums mt-1">canary blockers</p>
            </div>
            <div className="p-3 rounded-xl bg-white/[0.04] border border-white/10">
              <p className="text-[9px] uppercase tracking-widest text-white/50 font-bold mb-1.5">LIFETIME DEALS</p>
              <p className="text-[22px] leading-none font-black tabular-nums text-white">{heroStats.totalDeals}</p>
              <p className="text-[10px] text-white/40 tabular-nums mt-1">across all dup rows</p>
            </div>
            <div className="p-3 rounded-xl bg-white/[0.04] border border-white/10">
              <p className="text-[9px] uppercase tracking-widest text-white/50 font-bold mb-1.5">LIFETIME ALP</p>
              <p className="text-[22px] leading-none font-black tabular-nums text-white">{fmtUsd(heroStats.totalAlp)}</p>
              <p className="text-[10px] text-white/40 tabular-nums mt-1">at stake in attribution</p>
            </div>
          </div>
        </div>
      </div>

      {groups.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center space-y-3">
            <CheckCircle2 className="h-10 w-10 text-emerald-400 mx-auto" />
            <h3 className="text-lg font-semibold">Zero dup-name pairs unresolved.</h3>
            <p className="text-sm text-muted-foreground">
              Every same-display-name pair has a canonical_agent_id set. Hold the Standard.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {groups.map((g) => (
        <Card key={g.display_name} className="overflow-hidden">
          <CardHeader className="pb-3 border-b">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base flex items-center gap-2">
                {g.rows.some((r) => r.status === "active") ? (
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                ) : (
                  <Users className="h-4 w-4 text-muted-foreground" />
                )}
                {g.display_name}
                <span className="text-xs text-muted-foreground font-normal">
                  · {g.rows.length} rows
                </span>
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Sort by lifetime ALP. Pick the canonical row, merge the others into it.
              </p>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30">
                  <tr className="text-xs uppercase text-muted-foreground">
                    <th className="text-left p-3">Agent code</th>
                    <th className="text-left p-3">Status</th>
                    <th className="text-right p-3">Deals</th>
                    <th className="text-right p-3">Lifetime ALP</th>
                    <th className="text-right p-3 hidden md:table-cell">Apps</th>
                    <th className="text-right p-3 hidden md:table-cell">Downline</th>
                    <th className="text-right p-3 hidden md:table-cell">Last deal</th>
                    <th className="text-right p-3 hidden md:table-cell">Created</th>
                    <th className="text-right p-3 w-[200px]">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r, i) => {
                    const isCanonicalCandidate = i === 0;
                    const isFirstWithProduction = r.has_production_signal && i === 0;
                    return (
                      <tr key={r.agent_id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="p-3 font-mono text-xs">
                          <div className="flex items-center gap-2">
                            {isFirstWithProduction ? (
                              <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                            ) : null}
                            {r.agent_code}
                          </div>
                          {r.al_user_id ? (
                            <div className="text-[10px] text-muted-foreground mt-0.5">
                              AL #{r.al_user_id}
                            </div>
                          ) : null}
                        </td>
                        <td className="p-3">
                          <Badge variant="outline" className={STATUS_BADGE[r.status] ?? STATUS_BADGE.terminated}>
                            {r.status}
                          </Badge>
                        </td>
                        <td className="p-3 text-right tabular-nums">{r.lifetime_deals}</td>
                        <td className="p-3 text-right tabular-nums font-semibold">{fmtUsd(r.lifetime_alp)}</td>
                        <td className="p-3 text-right tabular-nums hidden md:table-cell text-xs text-muted-foreground">
                          {r.applications_assigned}
                          {r.applications_referred > 0 ? ` · ${r.applications_referred} ref` : ""}
                        </td>
                        <td className="p-3 text-right tabular-nums hidden md:table-cell text-xs text-muted-foreground">
                          {r.downline_count}
                        </td>
                        <td className="p-3 text-right tabular-nums hidden md:table-cell text-xs text-muted-foreground">
                          {fmtDate(r.last_deal_at)}
                        </td>
                        <td className="p-3 text-right tabular-nums hidden md:table-cell text-xs text-muted-foreground">
                          {fmtDate(r.created_at)}
                        </td>
                        <td className="p-3 text-right">
                          {isCanonicalCandidate ? (
                            <Badge variant="outline" className="border-emerald-500/40 text-emerald-200 bg-emerald-500/15">
                              Canonical (default)
                            </Badge>
                          ) : (
                            <Button
                              size="sm"
                              variant="default"
                              disabled={merge.isPending}
                              onClick={() =>
                                setPendingMerge({
                                  canonical: g.rows[0],
                                  dup: r,
                                })
                              }
                            >
                              <GitMerge className="h-3.5 w-3.5 mr-1.5" />
                              Merge into {g.rows[0].agent_code}
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ))}

      <AlertDialog open={!!pendingMerge} onOpenChange={(open) => { if (!open) setPendingMerge(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Merge {pendingMerge?.dup.agent_code} into {pendingMerge?.canonical.agent_code}?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">
                This sets <span className="font-mono">{pendingMerge?.dup.agent_code}</span>.canonical_agent_id to{" "}
                <span className="font-mono">{pendingMerge?.canonical.agent_code}</span>. Every wave-93+
                canonical-mapped view (leaderboard, book-of-business, command center, builders,
                strikes, inbox, etc.) will collapse the dup row onto the canonical on next query.
              </span>
              <span className="block text-xs text-amber-500">
                The action is reversible only by setting canonical_agent_id back to NULL via SQL.
                If they're actually different people, cancel and tell the bot to mark them distinct.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={merge.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={merge.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (!pendingMerge) return;
                merge.mutate({
                  canonical_id: pendingMerge.canonical.agent_id,
                  dup_id: pendingMerge.dup.agent_id,
                });
              }}
            >
              {merge.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <GitMerge className="h-4 w-4 mr-2" />
                  Confirm merge
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
