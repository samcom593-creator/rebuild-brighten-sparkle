/**
 * /admin/producer-trends — Producer Weekly Trend Surface
 *
 * Sam's use case: "Daniel didn't know his production dropped 3 weeks."
 *
 * Sources:
 *   - public.v_producer_trend_alert (current week vs 3 weeks ago + dropping flag)
 *   - public.v_agent_weekly_production (12-week series for spark bars)
 *
 * Color rules:
 *   - currently_dropping = true → rose badge "DROPPING 3W"
 *   - direction = down (but not 3W dropping) → amber badge
 *   - direction = up → emerald badge
 *   - direction = flat → slate badge
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Minus, TrendingDown, UserCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AgentNameLink } from "@/components/dashboard/AgentNameLink";
import { cn } from "@/lib/utils";

type TrendAlertRow = {
  producer_id: string;
  display_name: string;
  current_week_start: string;
  current_week_alp: number;
  current_week_deals: number;
  alp_1w_ago: number | null;
  alp_2w_ago: number | null;
  alp_3_weeks_ago: number | null;
  delta_pct: number;
  direction: "up" | "down" | "flat";
  currently_dropping: boolean;
};

type NewHireActivationRow = {
  agent_id: string;
  display_name: string;
  hire_date: string;
  days_since_hire: number;
  onboarding_stage: string | null;
  license_status: string | null;
  manager_id: string | null;
  manager_name: string | null;
  agentlink_linked: boolean;
  next_action_text: string | null;
  next_action_due_at: string | null;
};

type WeeklyRow = {
  agent_id: string;
  display_name: string;
  week_start: string;
  deals: number;
  alp: number;
};

function fmtUSDCompact(n: number | null | undefined): string {
  if (n == null) return "—";
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}K`;
  return `$${n}`;
}

export default function AdminProducerTrends() {
  const { data: trends = [], isLoading } = useQuery<TrendAlertRow[]>({
    queryKey: ["producer-trend-alert"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_producer_trend_alert" as any)
        .select("*")
        .order("currently_dropping", { ascending: false })
        .order("delta_pct", { ascending: true });
      if (error) throw error;
      return ((data as unknown) as TrendAlertRow[]) ?? [];
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  const { data: newHires = [] } = useQuery<NewHireActivationRow[]>({
    queryKey: ["new-hires-activation"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_new_hires_activation" as any)
        .select("*")
        .order("days_since_hire", { ascending: false });
      if (error) throw error;
      return ((data as unknown) as NewHireActivationRow[]) ?? [];
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  const { data: weekly = [] } = useQuery<WeeklyRow[]>({
    queryKey: ["agent-weekly-production"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_agent_weekly_production" as any)
        .select("agent_id, display_name, week_start, deals, alp")
        .order("week_start", { ascending: true });
      if (error) throw error;
      return ((data as unknown) as WeeklyRow[]) ?? [];
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  // Build per-producer 12-week ALP series for spark bars.
  const seriesByAgent = useMemo(() => {
    const map: Record<string, number[]> = {};
    for (const row of weekly) {
      if (!map[row.agent_id]) map[row.agent_id] = [];
      map[row.agent_id].push(row.alp);
    }
    return map;
  }, [weekly]);

  const totals = useMemo(() => {
    return {
      dropping: trends.filter((r) => r.currently_dropping).length,
      down_this_week: trends.filter((r) => r.direction === "down" && !r.currently_dropping).length,
    };
  }, [trends]);

  return (
    <div className="container mx-auto px-4 py-8 space-y-6 max-w-7xl">
      <div>
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-1">
          <TrendingDown className="h-3.5 w-3.5" /> Producers · Trend Surface
        </div>
        <h1 className="text-3xl font-bold">Producer Trends</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Weekly ALP for every producer. A 3-week drop alarm surfaces anyone
          quietly sliding. Nobody dips silently.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-w-2xl">
        <KpiTile label="Dropping 3W" value={totals.dropping} tone={totals.dropping > 0 ? "rose" : "neutral"} />
        <KpiTile label="Down this week" value={totals.down_this_week} tone="amber" />
        <KpiTile
          label="Never activated (60d)"
          value={newHires.length}
          tone={newHires.length > 0 ? "rose" : "neutral"}
        />
      </div>

      {totals.dropping > 0 && (
        <Card className="border-rose-500/40 bg-rose-500/5">
          <CardContent className="p-5">
            <div className="flex items-start gap-3">
              <div className="rounded-md bg-rose-500/15 p-3 border border-rose-500/30 shrink-0">
                <AlertTriangle className="h-5 w-5 text-rose-300" />
              </div>
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-[0.18em] text-rose-400/80">3-week drop alert</div>
                <div className="text-lg font-bold mt-0.5">
                  {totals.dropping} producer{totals.dropping === 1 ? "" : "s"} dropped ALP 3 weeks in a row
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  Reach out today. Same slide Daniel had. Nobody caught it.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {newHires.length > 0 && (
        <Card className="border-rose-500/40 bg-rose-500/5">
          <CardHeader>
            <div className="flex items-start gap-3">
              <div className="rounded-md bg-rose-500/15 p-3 border border-rose-500/30 shrink-0">
                <UserCheck className="h-5 w-5 text-rose-300" />
              </div>
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-[0.18em] text-rose-400/80">Never activated · last 60 days</div>
                <CardTitle className="text-lg mt-0.5">
                  {newHires.length} licensed hire{newHires.length === 1 ? "" : "s"} without a first deal
                </CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Licensed, cleared the finish line, still zero production. Reach out today before the streak turns permanent.
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border/50">
                    <th className="text-left py-2 px-2">Agent</th>
                    <th className="text-right py-2 px-2">Days since hire</th>
                    <th className="text-left py-2 px-2">Stage</th>
                    <th className="text-left py-2 px-2">Manager</th>
                    <th className="text-left py-2 px-2">AgentLink</th>
                  </tr>
                </thead>
                <tbody>
                  {newHires.map((r) => (
                    <tr key={r.agent_id} className="border-b border-border/30 hover:bg-muted/30">
                      <td className="py-2 px-2 font-medium">
                        <AgentNameLink agentId={r.agent_id}>{r.display_name}</AgentNameLink>
                      </td>
                      <td className={cn(
                        "py-2 px-2 text-right tabular-nums font-semibold",
                        r.days_since_hire >= 30 && "text-rose-400",
                        r.days_since_hire >= 14 && r.days_since_hire < 30 && "text-amber-400",
                        r.days_since_hire < 14 && "text-muted-foreground",
                      )}>
                        {r.days_since_hire}d
                      </td>
                      <td className="py-2 px-2 text-muted-foreground text-xs">
                        {r.onboarding_stage ?? "—"}
                      </td>
                      <td className="py-2 px-2 text-muted-foreground text-xs">
                        {r.manager_name ?? "—"}
                      </td>
                      <td className="py-2 px-2">
                        {r.agentlink_linked ? (
                          <Badge variant="outline" className="border-emerald-500/40 text-emerald-400 text-[10px]">linked</Badge>
                        ) : (
                          <Badge variant="outline" className="border-amber-500/40 text-amber-400 text-[10px]">unlinked</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Every active producer · current week vs 3 weeks ago</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-10 text-center text-muted-foreground">Loading producer trends…</div>
          ) : trends.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground">
              No linked producers yet. Producers appear once their AgentLink profile is matched.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border/50">
                    <th className="text-left py-2 px-2">Producer</th>
                    <th className="text-left py-2 px-2">12-wk ALP</th>
                    <th className="text-right py-2 px-2">3W ago</th>
                    <th className="text-right py-2 px-2">This week</th>
                    <th className="text-right py-2 px-2">Δ%</th>
                    <th className="text-left py-2 px-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {trends.map((r) => {
                    const series = seriesByAgent[r.producer_id] ?? [];
                    return (
                      <tr key={r.producer_id} className={cn(
                        "border-b border-border/30 hover:bg-muted/30",
                        r.currently_dropping && "bg-rose-500/[0.04]",
                      )}>
                        <td className="py-2 px-2 font-medium">
                          <AgentNameLink agentId={r.producer_id}>{r.display_name}</AgentNameLink>
                        </td>
                        <td className="py-2 px-2">
                          <SparkBars series={series} highlight={r.currently_dropping ? "rose" : r.direction === "up" ? "emerald" : "muted"} />
                        </td>
                        <td className="py-2 px-2 text-right tabular-nums text-muted-foreground">
                          {fmtUSDCompact(r.alp_3_weeks_ago)}
                        </td>
                        <td className="py-2 px-2 text-right tabular-nums font-semibold">
                          {fmtUSDCompact(r.current_week_alp)}
                        </td>
                        <td className={cn(
                          "py-2 px-2 text-right tabular-nums font-semibold",
                          r.delta_pct < -25 && "text-rose-400",
                          r.delta_pct >= -25 && r.delta_pct < 0 && "text-amber-400",
                          r.delta_pct === 0 && "text-muted-foreground",
                          r.delta_pct > 0 && "text-emerald-400",
                        )}>
                          {r.delta_pct > 0 ? "+" : ""}{r.delta_pct}%
                        </td>
                        <td className="py-2 px-2">
                          <TrendBadge row={r} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KpiTile({ label, value, tone }: { label: string; value: number; tone: "rose" | "amber" | "emerald" | "neutral" }) {
  const toneClass: Record<typeof tone, string> = {
    rose: "border-rose-500/30 text-rose-300",
    amber: "border-amber-500/30 text-amber-300",
    emerald: "border-emerald-500/30 text-emerald-300",
    neutral: "border-border text-foreground",
  };
  return (
    <div className={cn("rounded-lg border bg-card p-3", toneClass[tone])}>
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold tabular-nums leading-none mt-1.5">{value.toLocaleString()}</div>
    </div>
  );
}

function TrendBadge({ row }: { row: TrendAlertRow }) {
  if (row.currently_dropping) {
    return (
      <Badge className="bg-rose-500/15 text-rose-300 border border-rose-500/30 text-[10px] font-semibold">
        <TrendingDown className="h-3 w-3 mr-1" /> DROPPING 3W
      </Badge>
    );
  }
  if (row.direction === "down") {
    return (
      <Badge variant="outline" className="border-amber-500/40 text-amber-400 text-[10px]">
        <ArrowDownRight className="h-3 w-3 mr-1" /> down
      </Badge>
    );
  }
  if (row.direction === "up") {
    return (
      <Badge variant="outline" className="border-emerald-500/40 text-emerald-400 text-[10px]">
        <ArrowUpRight className="h-3 w-3 mr-1" /> up
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-border text-muted-foreground text-[10px]">
      <Minus className="h-3 w-3 mr-1" /> flat
    </Badge>
  );
}

/** Simple CSS spark bars (no chart library needed). */
function SparkBars({ series, highlight }: { series: number[]; highlight: "rose" | "emerald" | "muted" }) {
  if (series.length === 0) return <span className="text-muted-foreground text-xs">—</span>;
  const max = Math.max(...series, 1);
  const barClass =
    highlight === "rose" ? "bg-rose-400/70"
    : highlight === "emerald" ? "bg-emerald-400/70"
    : "bg-muted-foreground/40";
  return (
    <div className="flex items-end gap-0.5 h-6 w-24">
      {series.map((v, i) => (
        <div
          key={i}
          className={cn("w-1.5 rounded-sm", barClass)}
          style={{ height: `${Math.max(2, (v / max) * 100)}%` }}
          title={`Week ${i + 1}: $${v.toLocaleString()}`}
        />
      ))}
    </div>
  );
}
