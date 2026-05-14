import { useCallback, useEffect, useState } from "react";
import { Crown, Loader2, Medal, TrendingUp, Calendar, Clock3 } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { formatMetricSource, getMetricBounds, METRIC_REGISTRY, sumAnnualPremium } from "@/lib/metricTruth";
import { useProductionRealtime } from "@/hooks/useProductionRealtime";
import { DEAL_TRUTH_STATUS_FILTER, dealTruthWindowOr } from "@/lib/dealTruth";

type Period = "daily" | "weekly" | "monthly";
type Row = {
  rank: number;
  agent_id: string;
  deals: number;
  alp: number;
  agent_name: string | null;
  avatar_url: string | null;
};

const RANK_ICONS: Record<number, { icon: typeof Crown; color: string }> = {
  1: { icon: Crown, color: "text-amber-400" },
  2: { icon: Medal, color: "text-slate-300" },
  3: { icon: Medal, color: "text-orange-400" },
};

function periodToWindow(period: Period) {
  return period === "daily" ? "day" : period === "weekly" ? "week" : "month";
}

export default function Leaderboard() {
  const [period, setPeriod] = useState<Period>("monthly");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);

  const load = useCallback(async (activePeriod: Period) => {
    setLoading(true);
    try {
      const bounds = getMetricBounds(periodToWindow(activePeriod));
      const [{ data: dealRows }, { data: syncRow }] = await Promise.all([
        supabase
          .from("deals")
          .select("agent_id, annual_premium, posted_at, created_at")
          .or(dealTruthWindowOr(bounds.startIso, bounds.endIso))
          .in("status", DEAL_TRUTH_STATUS_FILTER),
        supabase
          .from("agentlink_sync_log" as any)
          .select("finished_at, started_at")
          .eq("status", "ok")
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      const grouped = new Map<string, { deals: number; annualPremiums: Array<{ annual_premium?: number | null }> }>();
      (dealRows ?? []).forEach((deal: any) => {
        if (!deal.agent_id) return;
        if (!grouped.has(deal.agent_id)) {
          grouped.set(deal.agent_id, { deals: 0, annualPremiums: [] });
        }
        const row = grouped.get(deal.agent_id)!;
        row.deals += 1;
        row.annualPremiums.push({ annual_premium: deal.annual_premium });
      });

      const ids = Array.from(grouped.keys());
      if (ids.length === 0) {
        setRows([]);
        setLastUpdatedAt((syncRow as any)?.finished_at || (syncRow as any)?.started_at || null);
        return;
      }

      const { data: agents } = await supabase
        .from("agents")
        .select("id, profile:profiles(full_name, avatar_url)")
        .in("id", ids);

      const byId = new Map((agents ?? []).map((agent: any) => [agent.id, agent.profile]));
      const builtRows = ids
        .map((agentId) => {
          const totals = grouped.get(agentId)!;
          return {
            rank: 0,
            agent_id: agentId,
            deals: totals.deals,
            alp: sumAnnualPremium(totals.annualPremiums),
            agent_name: (byId.get(agentId) as any)?.full_name ?? null,
            avatar_url: (byId.get(agentId) as any)?.avatar_url ?? null,
          };
        })
        .sort((a, b) => b.alp - a.alp || b.deals - a.deals)
        .map((row, index) => ({ ...row, rank: index + 1 }));

      setRows(builtRows);
      setLastUpdatedAt((syncRow as any)?.finished_at || (syncRow as any)?.started_at || null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(period);
  }, [period, load]);

  useProductionRealtime(() => {
    load(period);
  }, 300);

  const sourceHint = formatMetricSource(METRIC_REGISTRY.leaderboards, lastUpdatedAt);

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500/30 to-yellow-500/20">
          <Crown className="h-6 w-6 text-amber-300" />
        </div>
        <div className="flex-1">
          <h1 className="apex-headline text-3xl font-bold">Leaderboard</h1>
          <p className="text-sm text-muted-foreground">
            Live rankings from posted deals in Chicago time. Day, week, and month all use the same truth layer.
          </p>
        </div>
        {lastUpdatedAt && (
          <Badge variant="outline" className="gap-1.5">
            <Calendar className="h-3 w-3" />
            {formatDistanceToNowStrict(new Date(lastUpdatedAt), { addSuffix: true })}
          </Badge>
        )}
      </div>

      <p className="text-xs text-muted-foreground">{sourceHint}</p>

      <Tabs value={period} onValueChange={(value) => setPeriod(value as Period)}>
        <TabsList className="grid w-full grid-cols-3 md:w-auto">
          <TabsTrigger value="daily">Daily</TabsTrigger>
          <TabsTrigger value="weekly">Weekly</TabsTrigger>
          <TabsTrigger value="monthly">Monthly</TabsTrigger>
        </TabsList>

        {(["daily", "weekly", "monthly"] as Period[]).map((tab) => (
          <TabsContent key={tab} value={tab} className="mt-4">
            {loading ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…
              </div>
            ) : rows.length === 0 ? (
              <GlassCard className="p-12 text-center text-muted-foreground">
                No {tab} leaderboard data yet. The leaderboard will populate as soon as posted deals land in the truth layer.
              </GlassCard>
            ) : (
              <GlassCard className="overflow-hidden p-0">
                <div className="divide-y divide-border/40">
                  {rows.map((row) => {
                    const RankIcon = RANK_ICONS[row.rank]?.icon ?? TrendingUp;
                    const rankColor = RANK_ICONS[row.rank]?.color ?? "text-muted-foreground";
                    const highlight = row.rank <= 3;

                    return (
                      <div
                        key={row.agent_id}
                        className={cn(
                          "flex items-center gap-3 px-4 py-3 transition-all",
                          highlight && "bg-gradient-to-r from-amber-500/10 to-transparent",
                        )}
                      >
                        <div className={cn("w-10 text-center text-lg font-bold", rankColor)}>
                          #{row.rank}
                        </div>
                        <RankIcon className={cn("h-5 w-5", rankColor)} />
                        {row.avatar_url ? (
                          <img src={row.avatar_url} alt="" className="h-9 w-9 rounded-full ring-2 ring-border/40" />
                        ) : (
                          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted/50 text-xs font-semibold">
                            {(row.agent_name ?? "?").split(" ").map((part) => part[0]).slice(0, 2).join("")}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-semibold">{row.agent_name ?? "Unknown agent"}</div>
                          <div className="text-xs text-muted-foreground">
                            {row.deals} deal{row.deals === 1 ? "" : "s"}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold tabular-nums text-emerald-400">
                            ${row.alp.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </div>
                          <div className="mt-0.5 flex items-center justify-end gap-1 text-xs text-muted-foreground">
                            <Clock3 className="h-3 w-3" />
                            posted deals truth
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </GlassCard>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
