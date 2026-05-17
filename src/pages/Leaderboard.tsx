import { useCallback, useEffect, useMemo, useState } from "react";
import { Crown, Loader2, Medal, TrendingUp, Calendar, Clock3, Target, Users, Activity, CalendarDays, Trophy } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { formatDistanceToNowStrict } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { getMetricBounds, sumAnnualPremium, type MetricBounds } from "@/lib/metricTruth";
import { useProductionRealtime } from "@/hooks/useProductionRealtime";
import { DEAL_TRUTH_STATUS_FILTER, dealTruthWindowOr } from "@/lib/dealTruth";

type Period = "daily" | "weekly" | "monthly" | "custom";
type Board = "production" | "recruiting" | "referrals" | "activity";
type Row = {
  rank: number;
  agent_id: string;
  primary: number;
  secondary: number;
  tertiary: number;
  agent_name: string | null;
  avatar_url: string | null;
};

const RANK_ICONS: Record<number, { icon: typeof Crown; color: string }> = {
  1: { icon: Crown, color: "text-amber-400" },
  2: { icon: Medal, color: "text-slate-300" },
  3: { icon: Medal, color: "text-orange-400" },
};

const BOARD_META: Record<Board, { label: string; icon: typeof Crown; source: string }> = {
  production: { label: "Production", icon: Crown, source: "deals.posted_at + valid deal statuses" },
  recruiting: { label: "Recruiting", icon: Target, source: "applications.created_at + owner attribution" },
  referrals: { label: "Referral", icon: Users, source: "applications.referral_manager_id" },
  activity: { label: "Activity", icon: Activity, source: "daily_production manual activity fields" },
};

function periodToWindow(period: Period) {
  if (period === "daily") return "day";
  if (period === "weekly") return "week";
  return "month";
}

function formatMoney(value: number): string {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function dateInputToDate(value: string): Date | undefined {
  return value ? new Date(`${value}T12:00:00`) : undefined;
}

function getBounds(period: Period, customFrom: string, customTo: string): MetricBounds {
  if (period === "custom") {
    const from = dateInputToDate(customFrom);
    const to = dateInputToDate(customTo);
    if (from && to) return getMetricBounds("custom", { from, to });
  }
  return getMetricBounds(periodToWindow(period));
}

function pickOwner(row: any): string | null {
  return row.referral_manager_id || row.recruiter_id || row.assigned_agent_id || row.agent_id || null;
}

export default function Leaderboard() {
  const [period, setPeriod] = useState<Period>("weekly");
  const [board, setBoard] = useState<Board>("production");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);

  const bounds = useMemo(() => getBounds(period, customFrom, customTo), [period, customFrom, customTo]);

  const buildRows = useCallback(async (ids: string[], grouped: Map<string, { primary: number; secondary: number; tertiary: number }>) => {
    if (ids.length === 0) return [];
    const { data: agents } = await supabase
      .from("agents")
      .select("id, display_name, profile:profiles(full_name, avatar_url)")
      .in("id", ids);
    const byId = new Map((agents ?? []).map((agent: any) => [agent.id, agent]));
    return ids
      .map((agentId) => {
        const totals = grouped.get(agentId)!;
        const agent = byId.get(agentId) as any;
        return {
          rank: 0,
          agent_id: agentId,
          primary: totals.primary,
          secondary: totals.secondary,
          tertiary: totals.tertiary,
          agent_name: agent?.profile?.full_name ?? agent?.display_name ?? null,
          avatar_url: agent?.profile?.avatar_url ?? null,
        };
      })
      .sort((a, b) => b.primary - a.primary || b.secondary - a.secondary || b.tertiary - a.tertiary)
      .map((row, index) => ({ ...row, rank: index + 1 }));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const grouped = new Map<string, { primary: number; secondary: number; tertiary: number }>();
      let syncAt: string | null = null;

      if (board === "production") {
        const [{ data: dealRows }, { data: syncRow }] = await Promise.all([
          // RLS-bypass leaderboard view — regular agents only see their own
          // deals from the base table (deals_own_read policy), which broke
          // leaderboard visibility. v_deals_leaderboard exposes only the
          // 5 non-PII cols needed for ranking and grants SELECT to everyone.
          supabase
            .from("v_deals_leaderboard" as any)
            .select("agent_id, annual_premium, posted_at")
            .gte("posted_at", bounds.startIso)
            .lt("posted_at", bounds.endIso),
          supabase
            .from("agentlink_sync_log" as any)
            .select("finished_at, started_at")
            .eq("status", "ok")
            .order("started_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);
        const premiumRows = new Map<string, Array<{ annual_premium?: number | null }>>();
        for (const deal of (dealRows ?? []) as any[]) {
          if (!deal.agent_id) continue;
          if (!premiumRows.has(deal.agent_id)) premiumRows.set(deal.agent_id, []);
          premiumRows.get(deal.agent_id)!.push({ annual_premium: deal.annual_premium });
        }
        for (const [agentId, premiums] of premiumRows) {
          grouped.set(agentId, { primary: sumAnnualPremium(premiums), secondary: premiums.length, tertiary: 0 });
        }
        syncAt = (syncRow as any)?.finished_at || (syncRow as any)?.started_at || null;
      }

      if (board === "recruiting") {
        const { data } = await supabase
          .from("applications")
          .select("assigned_agent_id, referral_manager_id, recruiter_id, status, license_status, contracted_at, first_deal_at, created_at")
          .gte("created_at", bounds.startIso)
          .lt("created_at", bounds.endIso)
          .is("terminated_at", null);
        for (const app of (data ?? []) as any[]) {
          const owner = pickOwner(app);
          if (!owner) continue;
          const row = grouped.get(owner) ?? { primary: 0, secondary: 0, tertiary: 0 };
          row.primary += 1;
          if (["reviewing", "interview", "contracting", "approved"].includes(app.status) || app.license_status === "licensed") row.secondary += 1;
          if (app.contracted_at || app.first_deal_at) row.tertiary += 1;
          grouped.set(owner, row);
        }
      }

      if (board === "referrals") {
        const { data } = await supabase
          .from("applications")
          .select("referral_manager_id, license_status, contracted_at, first_deal_at, created_at")
          .not("referral_manager_id", "is", null)
          .gte("created_at", bounds.startIso)
          .lt("created_at", bounds.endIso)
          .is("terminated_at", null);
        for (const app of (data ?? []) as any[]) {
          const owner = app.referral_manager_id;
          if (!owner) continue;
          const row = grouped.get(owner) ?? { primary: 0, secondary: 0, tertiary: 0 };
          row.primary += 1;
          if (app.license_status === "licensed") row.secondary += 1;
          if (app.contracted_at || app.first_deal_at) row.tertiary += 1;
          grouped.set(owner, row);
        }
      }

      if (board === "activity") {
        const { data } = await supabase
          .from("daily_production")
          .select("agent_id, presentations, hours_called, referrals_caught, referral_presentations, booked_inhome_referrals, production_date")
          .gte("production_date", bounds.startIso.slice(0, 10))
          .lt("production_date", bounds.endIso.slice(0, 10));
        for (const activity of (data ?? []) as any[]) {
          const owner = activity.agent_id;
          if (!owner) continue;
          const row = grouped.get(owner) ?? { primary: 0, secondary: 0, tertiary: 0 };
          const presentations = Number(activity.presentations ?? 0);
          const referrals = Number(activity.referrals_caught ?? 0) + Number(activity.referral_presentations ?? 0) + Number(activity.booked_inhome_referrals ?? 0);
          const hours = Number(activity.hours_called ?? 0);
          row.primary += presentations + referrals + hours;
          row.secondary += presentations;
          row.tertiary += referrals;
          grouped.set(owner, row);
        }
      }

      const builtRows = await buildRows(Array.from(grouped.keys()), grouped);
      setRows(builtRows);
      setLastUpdatedAt(syncAt ?? new Date().toISOString());
    } finally {
      setLoading(false);
    }
  }, [board, bounds.endIso, bounds.startIso, buildRows]);

  useEffect(() => {
    load();
  }, [load]);

  useProductionRealtime(() => {
    load();
  }, 300);

  const meta = BOARD_META[board];
  const PrimaryIcon = meta.icon;

  const sourceHint = `${meta.label} leaderboard · ${meta.source} · America/Chicago business window`;

  function primaryValue(row: Row): string {
    if (board === "production") return formatMoney(row.primary);
    if (board === "activity") return row.primary.toLocaleString(undefined, { maximumFractionDigits: 1 });
    return row.primary.toLocaleString();
  }

  function subValue(row: Row): string {
    if (board === "production") return `${row.secondary} deal${row.secondary === 1 ? "" : "s"}`;
    if (board === "recruiting") return `${row.secondary} advanced · ${row.tertiary} contracted/first sale`;
    if (board === "referrals") return `${row.secondary} licensed · ${row.tertiary} contracted/first sale`;
    return `${row.secondary} presentations · ${row.tertiary} referral actions`;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      <PageHeader
        accent="amber"
        eyebrow="Production · Rankings"
        eyebrowIcon={<Trophy className="h-3 w-3" />}
        title="Leaderboard"
        subtitle="Production, recruiting, referral, and activity rankings from live platform tables."
        actions={lastUpdatedAt && (
          <Badge variant="outline" className="gap-1.5">
            <Calendar className="h-3 w-3" />
            {formatDistanceToNowStrict(new Date(lastUpdatedAt), { addSuffix: true })}
          </Badge>
        )}
      />

      <p className="text-xs text-muted-foreground">{sourceHint}</p>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Tabs value={board} onValueChange={(value) => setBoard(value as Board)}>
          <TabsList className="grid grid-cols-4">
            <TabsTrigger value="production">Production</TabsTrigger>
            <TabsTrigger value="recruiting">Recruiting</TabsTrigger>
            <TabsTrigger value="referrals">Referral</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={period} onValueChange={(value) => setPeriod(value as Period)}>
            <TabsList>
              <TabsTrigger value="daily">Daily</TabsTrigger>
              <TabsTrigger value="weekly">Weekly</TabsTrigger>
              <TabsTrigger value="monthly">Monthly</TabsTrigger>
              <TabsTrigger value="custom">Custom</TabsTrigger>
            </TabsList>
          </Tabs>
          {period === "custom" && (
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="h-9 w-[150px]" />
              <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="h-9 w-[150px]" />
            </div>
          )}
        </div>
      </div>

      <Tabs value={board} onValueChange={(value) => setBoard(value as Board)}>
        {(["production", "recruiting", "referrals", "activity"] as Board[]).map((tab) => (
          <TabsContent key={tab} value={tab} className="mt-0">
            {loading ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading...
              </div>
            ) : rows.length === 0 ? (
              <GlassCard className="p-12 text-center text-muted-foreground">
                No {BOARD_META[tab].label.toLowerCase()} leaderboard data in this window. This is a true empty state from live tables.
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
                          <div className="text-xs text-muted-foreground">{subValue(row)}</div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold tabular-nums text-emerald-400">{primaryValue(row)}</div>
                          <div className="mt-0.5 flex items-center justify-end gap-1 text-xs text-muted-foreground">
                            <Clock3 className="h-3 w-3" />
                            {BOARD_META[tab].label}
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
