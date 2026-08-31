import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, CheckCircle2, UserCheck, Users } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useRealtimeTable } from "@/shared/realtime/useRealtimeTable";
import { AgentNameLink } from "@/components/dashboard/AgentNameLink";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { Skeleton } from "@/components/ui/skeleton";

interface HireRow {
  agent_id: string;
  agent_name: string | null;
  manager: string | null;
  hired_at: string;
  license_status: string | null;
  rungs_complete: number | null;
  next_missing_step: string | null;
  days_since_progress: number | string | null;
}

const QUERY_KEY = ["no-hire-left-behind"] as const;

export function NoHireLeftBehindPanel() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
      const [hires, gaps] = await Promise.all([
        (supabase as any)
          .from("v_onboarding_sequence")
          .select("agent_id,agent_name,manager,hired_at,license_status,rungs_complete,next_missing_step,days_since_progress")
          .gte("hired_at", since)
          .lt("rungs_complete", 8)
          .order("rungs_complete", { ascending: true })
          .order("days_since_progress", { ascending: false })
          .limit(50),
        (supabase as any)
          .from("v_hire_notification_gaps")
          .select("agent_id", { count: "exact", head: true }),
      ]);
      if (hires.error) throw hires.error;
      if (gaps.error) throw gaps.error;
      return { rows: (hires.data ?? []) as HireRow[], notificationGaps: gaps.count ?? 0 };
    },
    staleTime: 30_000,
    // 60s -> 5min. These read realtime-covered tables and a one-minute poll on
    // a page left open all day is what produced 11+ hours of database time
    // across the platform's top RPCs.
    refetchInterval: 300_000,
  });

  const refresh = () => { void queryClient.invalidateQueries({ queryKey: QUERY_KEY }); };
  useRealtimeTable({ table: "agents", channelSuffix: "hire-ops" }, refresh);
  useRealtimeTable({ table: "onboarding_progress", channelSuffix: "hire-ops" }, refresh);
  useRealtimeTable({ table: "contracting_intakes", channelSuffix: "hire-ops" }, refresh);
  useRealtimeTable({ table: "messaging_identity_links", channelSuffix: "hire-ops" }, refresh);

  const stats = useMemo(() => {
    const rows = query.data?.rows ?? [];
    return {
      total: rows.length,
      firstSteps: rows.filter((r) => Number(r.rungs_complete ?? 0) < 2).length,
      stalled: rows.filter((r) => Number(r.days_since_progress ?? 0) >= 2).length,
    };
  }, [query.data]);

  if (query.isLoading) return <Skeleton className="h-64 w-full rounded-xl" />;

  return (
    <GlassCard className="overflow-hidden border-primary/25 p-0">
      <div className="flex flex-col gap-3 border-b border-border bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="flex items-center gap-2 text-sm font-bold text-foreground"><UserCheck className="h-4 w-4 text-primary" />No Hire Left Behind</p>
          <p className="mt-1 text-xs text-muted-foreground">Live Milver + VA handoff queue. Every active hire stays visible until all eight launch steps are complete.</p>
        </div>
        <Button asChild size="sm" className="gap-1.5">
          <Link to="/dashboard/onboarding-ladder">Work full queue <ArrowRight className="h-3.5 w-3.5" /></Link>
        </Button>
      </div>

      {query.isError ? (
        <div className="flex items-start gap-2 p-4 text-sm text-rose-500"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />The live hiring handoff could not load. Treat this as an operational alert, not zero hires.</div>
      ) : (
        <div className="p-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-lg border border-border bg-card p-3"><p className="text-2xl font-black tabular-nums">{stats.total}</p><p className="text-[11px] text-muted-foreground">Hires still launching</p></div>
            <div className="rounded-lg border border-border bg-card p-3"><p className="text-2xl font-black tabular-nums text-amber-600 dark:text-amber-400">{stats.firstSteps}</p><p className="text-[11px] text-muted-foreground">Need first two steps</p></div>
            <div className="rounded-lg border border-border bg-card p-3"><p className="text-2xl font-black tabular-nums text-rose-600 dark:text-rose-400">{stats.stalled}</p><p className="text-[11px] text-muted-foreground">No progress for 2+ days</p></div>
            <div className="rounded-lg border border-border bg-card p-3"><p className="text-2xl font-black tabular-nums text-emerald-600 dark:text-emerald-400">{query.data?.notificationGaps ?? 0}</p><p className="text-[11px] text-muted-foreground">Hire announcement gaps</p></div>
          </div>

          {(query.data?.rows.length ?? 0) === 0 ? (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3 text-sm text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="h-4 w-4" />Every recent hire has cleared the launch ladder.</div>
          ) : (
            <ul className="mt-4 grid gap-2 lg:grid-cols-2">
              {query.data!.rows.slice(0, 6).map((row) => {
                const days = Math.max(0, Math.round(Number(row.days_since_progress ?? 0)));
                return (
                  <li key={row.agent_id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card/70 p-3">
                    <div className="min-w-0">
                      <AgentNameLink agentId={row.agent_id} className="text-sm font-bold"><span className="truncate">{row.agent_name || "Unnamed hire"}</span></AgentNameLink>
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">Owner: {row.manager || "unassigned"} · {row.next_missing_step || "Next step missing"}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <Badge variant="outline" className={days >= 2 ? "border-rose-500/30 text-rose-500" : "border-amber-500/30 text-amber-500"}>{row.rungs_complete ?? 0}/8</Badge>
                      <p className="mt-1 text-[10px] text-muted-foreground">{days}d waiting</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground"><Users className="h-3.5 w-3.5" />New hires appear from the canonical agent record and refresh in real time.</div>
        </div>
      )}
    </GlassCard>
  );
}
