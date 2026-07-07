import { useCallback, useEffect, useMemo, useState } from "react";
import { Crown, Loader2, Medal, TrendingUp, Calendar as CalendarIcon, Clock3, Target, Users, Activity, CalendarDays, Trophy, DollarSign, TrendingDown } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { formatDistanceToNowStrict } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format as fmtDate } from "date-fns";
import { cn } from "@/lib/utils";
import { getMetricBounds, sumAnnualPremium, type MetricBounds } from "@/lib/metricTruth";
import { useProductionRealtime } from "@/hooks/useProductionRealtime";
import { DEAL_TRUTH_STATUS_FILTER, dealTruthWindowOr } from "@/lib/dealTruth";

type Period = "daily" | "weekly" | "monthly" | "custom";
type Board = "production" | "recruiting" | "referrals" | "activity";
// Wave B v9 §3/§12 check 8: Top Producing Leg sub-view EXCLUDES Sam James'
// leg (so it surfaces actual downline managers, not Sam swallowing every
// agency-wide deal). Toggled inside the Production board only.
type ProductionMode = "individuals" | "top_legs";
type Row = {
  rank: number;
  agent_id: string;
  primary: number;
  secondary: number;
  tertiary: number;
  agent_name: string | null;
  avatar_url: string | null;
  // top_legs mode only — number of agents inside the leg
  leg_size?: number;
};

const RANK_ICONS: Record<number, { icon: typeof Crown; color: string }> = {
  1: { icon: Crown, color: "text-amber-400" },
  2: { icon: Medal, color: "text-slate-600 dark:text-slate-300" },
  3: { icon: Medal, color: "text-rose-500" },
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
  // P3/P4: referral_recruiter_id is the canonical credit field; fall back to
  // the legacy referral_manager_id chain.
  return (
    row.referral_recruiter_id ||
    row.referral_manager_id ||
    row.recruiter_id ||
    row.assigned_agent_id ||
    row.agent_id ||
    null
  );
}

export default function Leaderboard() {
  const [period, setPeriod] = useState<Period>("weekly");
  const [board, setBoard] = useState<Board>("production");
  const [productionMode, setProductionMode] = useState<ProductionMode>("individuals");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);

  const bounds = useMemo(() => getBounds(period, customFrom, customTo), [period, customFrom, customTo]);

  // v6 §31 hero data — agency production this month vs prior month, source of
  // truth is agentlink_deals_snapshot (NOT legacy deals). Phoenix tz for
  // month boundaries per Sam's permanent memory rule.
  const heroData = useQuery({
    queryKey: ["leaderboard-hero-agency-production"],
    refetchInterval: 60_000,
    staleTime: 55_000,
    queryFn: async () => {
      const monthBounds = getMetricBounds("month");
      // Prior month window — shift back 1 month from current month start.
      const monthStart = new Date(monthBounds.startIso);
      const priorEnd = new Date(monthStart);
      const priorStart = new Date(monthStart);
      priorStart.setMonth(priorStart.getMonth() - 1);

      const curStartDate = monthBounds.startIso.slice(0, 10);
      const curEndDate = monthBounds.endIso.slice(0, 10);
      const priorStartDate = priorStart.toISOString().slice(0, 10);
      const priorEndDate = priorEnd.toISOString().slice(0, 10);

      // Day-of-month for pace calc (Phoenix tz to match Sam's rule)
      const phoenixNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Phoenix" }));
      const dayOfMonth = phoenixNow.getDate();
      const daysInMonth = new Date(phoenixNow.getFullYear(), phoenixNow.getMonth() + 1, 0).getDate();

      const [{ data: cur }, { data: prior }] = await Promise.all([
        supabase
          .from("agentlink_deals_snapshot" as any)
          .select("annual_premium, user_id")
          .gte("effective_date", curStartDate)
          .lte("effective_date", curEndDate),
        supabase
          .from("agentlink_deals_snapshot" as any)
          .select("annual_premium")
          .gte("effective_date", priorStartDate)
          .lt("effective_date", priorEndDate.slice(0, 10)),
      ]);

      const curRows = (cur ?? []) as Array<{ annual_premium: number | string | null; user_id: number | null }>;
      const priorRows = (prior ?? []) as Array<{ annual_premium: number | string | null }>;

      const totalAp = curRows.reduce((s, r) => s + Number(r.annual_premium ?? 0), 0);
      const priorAp = priorRows.reduce((s, r) => s + Number(r.annual_premium ?? 0), 0);
      const producers = new Set(curRows.map((r) => r.user_id).filter((v) => v != null)).size;
      const avgPerProducer = producers > 0 ? totalAp / producers : 0;
      const dealCount = curRows.length;

      // Pace projection: linearly extrapolate to full month
      const projected = dayOfMonth > 0 ? (totalAp / dayOfMonth) * daysInMonth : totalAp;
      const paceDelta = priorAp > 0 ? ((projected - priorAp) / priorAp) * 100 : 0;

      return {
        totalAp,
        producers,
        avgPerProducer,
        dealCount,
        priorAp,
        projected,
        paceDelta,
        dayOfMonth,
        daysInMonth,
      };
    },
  });

  const buildRows = useCallback(async (ids: string[], grouped: Map<string, { primary: number; secondary: number; tertiary: number }>) => {
    if (ids.length === 0) return [];

    // PL-052: canonicalize duplicate identity rows (e.g. Sam James SJAMES01
    // == SJAMES02). v_agent_canonical_map returns COALESCE(canonical_agent_id, id)
    // per agent. Roll up grouped totals onto the canonical id before fetching
    // agent metadata so each identity gets one leaderboard row.
    const { data: canonMap } = await supabase
      .from("v_agent_canonical_map" as any)
      .select("agent_id, canonical_agent_id")
      .in("agent_id", ids);
    const canonical = new Map<string, string>(
      ((canonMap ?? []) as Array<{ agent_id: string; canonical_agent_id: string }>)
        .map((r) => [r.agent_id, r.canonical_agent_id])
    );
    const rolled = new Map<string, { primary: number; secondary: number; tertiary: number }>();
    for (const [aid, totals] of grouped) {
      const canon = canonical.get(aid) ?? aid;
      const row = rolled.get(canon) ?? { primary: 0, secondary: 0, tertiary: 0 };
      row.primary += totals.primary;
      row.secondary += totals.secondary;
      row.tertiary += totals.tertiary;
      rolled.set(canon, row);
    }
    const canonIds = Array.from(rolled.keys());

    const { data: agents } = await supabase
      .from("agents")
      .select("id, display_name, profile:profiles(full_name, avatar_url)")
      .in("id", canonIds);
    const byId = new Map((agents ?? []).map((agent: any) => [agent.id, agent]));
    return canonIds
      .map((agentId) => {
        const totals = rolled.get(agentId)!;
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

      if (board === "production" && productionMode === "top_legs") {
        // Wave B v9: read v_top_legs_excl_sam — manager-rolled-up book from
        // agentlink_deals_snapshot, excluding Sam's leg. RPC-level guard:
        // the view itself excludes Sam (agent.id 7c3c5581…) so the client
        // can't accidentally include him by forgetting a filter.
        const { data: legs } = await supabase
          .from("v_top_legs_excl_sam" as any)
          .select("manager_id, manager_name, deals, premium, leg_size")
          .order("premium", { ascending: false })
          .limit(50);
        const built: Row[] = ((legs ?? []) as Array<{
          manager_id: string;
          manager_name: string | null;
          deals: number | string;
          premium: number | string;
          leg_size: number | string;
        }>).map((leg, index) => ({
          rank: index + 1,
          agent_id: leg.manager_id,
          primary: Number(leg.premium ?? 0),
          secondary: Number(leg.deals ?? 0),
          tertiary: Number(leg.leg_size ?? 0),
          agent_name: leg.manager_name,
          avatar_url: null,
          leg_size: Number(leg.leg_size ?? 0),
        }));
        setRows(built);
        setLastUpdatedAt(new Date().toISOString());
        setLoading(false);
        return;
      }

      if (board === "production") {
        // 2026-06-18 Sam directive: 'I'm still missing Daniel and more people
        // inside the leaderboards.' Daniel + 15+ other producers have their
        // deals in agentlink_deals_snapshot (book of business) not the local
        // deals table. The website-side deals table only contains rows that
        // were manually entered or sync'd into Apex. Switch the production
        // board to source from book of business (joined via agents.al_user_id
        // → user_id) so the Production leaderboard matches AgentLink truth.
        // Falls back to v_deals_leaderboard for any agent without al_user_id
        // (so a producer who only has local entries still shows).
        const [bookRes, localRes, agentsLink, { data: syncRow }] = await Promise.all([
          // Book of business — the truth.
          supabase
            .from("agentlink_deals_snapshot" as any)
            .select("user_id, annual_premium, effective_date")
            .gte("effective_date", bounds.startIso.slice(0, 10))
            .lt("effective_date", bounds.endIso.slice(0, 10)),
          // Local fallback — for agents whose deals haven't synced to AgentLink.
          supabase
            .from("v_deals_leaderboard" as any)
            .select("agent_id, annual_premium, posted_at")
            .gte("posted_at", bounds.startIso)
            .lt("posted_at", bounds.endIso),
          // Map user_id (int) → agents.id (uuid) for the book half.
          supabase
            .from("agents")
            .select("id, al_user_id")
            .not("al_user_id", "is", null),
          supabase
            .from("agentlink_sync_log" as any)
            .select("finished_at, started_at")
            .eq("status", "ok")
            .order("started_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);
        const alUserIdToAgentId = new Map<number, string>(
          ((agentsLink.data ?? []) as Array<{ id: string; al_user_id: number }>)
            .map((r) => [Number(r.al_user_id), r.id])
        );
        const premiumRows = new Map<string, Array<{ annual_premium?: number | null }>>();
        // Book of business — preferred source.
        for (const deal of (bookRes.data ?? []) as Array<{ user_id: number; annual_premium: number | string | null }>) {
          const agentId = alUserIdToAgentId.get(Number(deal.user_id));
          if (!agentId) continue;
          if (!premiumRows.has(agentId)) premiumRows.set(agentId, []);
          premiumRows.get(agentId)!.push({ annual_premium: Number(deal.annual_premium ?? 0) });
        }
        // Local deals — only for agents WITHOUT al_user_id (no double count).
        const linkedAgentIds = new Set(alUserIdToAgentId.values());
        for (const deal of (localRes.data ?? []) as any[]) {
          if (!deal.agent_id) continue;
          if (linkedAgentIds.has(deal.agent_id)) continue;
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
          .select("assigned_agent_id, referral_recruiter_id, referral_manager_id, recruiter_id, status, license_status, contracted_at, first_deal_at, created_at")
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
        const [{ data: dailyRows }, { data: dialerRows }] = await Promise.all([
          supabase
            .from("daily_production")
            .select("agent_id, presentations, hours_called, referrals_caught, referral_presentations, booked_inhome_referrals, production_date")
            .gte("production_date", bounds.startIso.slice(0, 10))
            .lt("production_date", bounds.endIso.slice(0, 10)),
          // PL-053: also count dialer pages — every ReadyMode dialer call
          // counts as 1 unit of activity. The table is populated by the
          // readymode-ingest fn; when it lags the activity number falls
          // back to daily_production-only (graceful).
          supabase
            .from("readymode_dialer_calls" as any)
            .select("agent_id")
            .gte("call_started_at", bounds.startIso)
            .lt("call_started_at", bounds.endIso)
            .not("agent_id", "is", null),
        ]);
        for (const activity of (dailyRows ?? []) as any[]) {
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
        // PL-053: roll up dialer pages by agent — each call = 1 activity unit
        const dialerByAgent = new Map<string, number>();
        for (const call of (dialerRows ?? []) as Array<{ agent_id: string | null }>) {
          if (!call.agent_id) continue;
          dialerByAgent.set(call.agent_id, (dialerByAgent.get(call.agent_id) ?? 0) + 1);
        }
        for (const [agentId, pages] of dialerByAgent) {
          const row = grouped.get(agentId) ?? { primary: 0, secondary: 0, tertiary: 0 };
          row.primary += pages;
          grouped.set(agentId, row);
        }
      }

      const builtRows = await buildRows(Array.from(grouped.keys()), grouped);
      setRows(builtRows);
      setLastUpdatedAt(syncAt ?? new Date().toISOString());
    } finally {
      setLoading(false);
    }
  }, [board, productionMode, bounds.endIso, bounds.startIso, buildRows]);

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

  // PL-051: Production rows now spell out deals × avg-ALP-per-deal so
  // managers can see whether a leader is winning on volume or on premium
  // size. Other boards keep their existing breakdown shape.
  function subValue(row: Row): string {
    if (board === "production" && productionMode === "top_legs") {
      const deals = row.secondary;
      const size = row.leg_size ?? 0;
      const sizeLabel = `${size} agent${size === 1 ? "" : "s"} in leg`;
      if (deals === 0) return `${sizeLabel} · 0 deals via AgentLink yet`;
      const avg = row.primary / deals;
      return `${sizeLabel} · ${deals} deal${deals === 1 ? "" : "s"} · avg ${formatMoney(avg)}`;
    }
    if (board === "production") {
      const deals = row.secondary;
      if (deals === 0) return "0 deals";
      const avg = row.primary / deals;
      return `${deals} deal${deals === 1 ? "" : "s"} · avg ${formatMoney(avg)} / deal`;
    }
    if (board === "recruiting") return `${row.secondary} advanced · ${row.tertiary} contracted/first sale`;
    if (board === "referrals") return `${row.secondary} licensed · ${row.tertiary} contracted/first sale`;
    return `${row.secondary} presentations · ${row.tertiary} referral actions`;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6 ops-surface ops-fade-in">
      <PageHeader
        accent="amber"
        eyebrow="Production · Rankings"
        eyebrowIcon={<Trophy className="h-3 w-3" />}
        title="Leaderboard"
        subtitle="Production, recruiting, referral, and activity rankings from live platform tables."
        actions={lastUpdatedAt && (
          <Badge variant="outline" className="gap-1.5">
            <CalendarIcon className="h-3 w-3" />
            {formatDistanceToNowStrict(new Date(lastUpdatedAt), { addSuffix: true })}
          </Badge>
        )}
      />

      {/* v6 §31 canonical hero — production = money = emerald gradient.
          Truth source: agentlink_deals_snapshot (Sam's permanent memory).
          Shows month-to-date agency AP, producer count, avg per producer,
          and projected pace vs prior month. */}
      <div className="relative overflow-hidden rounded-3xl border border-emerald-500/25 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 text-white shadow-[0_0_64px_-12px_hsl(168_70%_45%/0.35)]">
        <div className="absolute -top-32 -right-32 h-80 w-80 rounded-full bg-emerald-500/20 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-40 -left-32 h-96 w-96 rounded-full bg-amber-500/15 blur-3xl pointer-events-none" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_50%,hsl(168_70%_45%/0.06),transparent_60%)] pointer-events-none" />
        <div className="relative p-5 sm:p-6">
          <div className="mb-4 flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
            <p className="text-[11px] uppercase tracking-[0.32em] font-bold text-emerald-300">AGENCY PRODUCTION · LIVE</p>
          </div>

          <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <DollarSign className="h-3 w-3 text-emerald-400" />
                <p className="text-[10px] uppercase tracking-widest text-white/50 font-bold">MONTH-TO-DATE AP</p>
              </div>
              <p className="text-[32px] sm:text-[40px] leading-none font-black tabular-nums text-white">
                {heroData.isLoading ? "—" : formatMoney(heroData.data?.totalAp ?? 0)}
              </p>
              <p className="text-[10px] text-white/50 mt-1 tabular-nums">
                {heroData.data?.dealCount ?? 0} deals · day {heroData.data?.dayOfMonth ?? "—"}/{heroData.data?.daysInMonth ?? "—"}
              </p>
            </div>

            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <Users className="h-3 w-3 text-amber-400" />
                <p className="text-[10px] uppercase tracking-widest text-white/50 font-bold">PRODUCERS</p>
              </div>
              <p className="text-[32px] sm:text-[40px] leading-none font-black tabular-nums text-amber-300">
                {heroData.isLoading ? "—" : (heroData.data?.producers ?? 0).toLocaleString()}
              </p>
              <p className="text-[10px] text-white/50 mt-1 tabular-nums">
                {heroData.data?.producers === 1 ? "agent posting deals" : "agents posting deals"}
              </p>
            </div>

            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <Target className="h-3 w-3 text-emerald-400" />
                <p className="text-[10px] uppercase tracking-widest text-white/50 font-bold">AVG / PRODUCER</p>
              </div>
              <p className="text-[32px] sm:text-[40px] leading-none font-black tabular-nums text-emerald-300">
                {heroData.isLoading ? "—" : formatMoney(heroData.data?.avgPerProducer ?? 0)}
              </p>
              <p className="text-[10px] text-white/50 mt-1 tabular-nums">
                month-to-date per active producer
              </p>
            </div>

            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                {(heroData.data?.paceDelta ?? 0) >= 0 ? (
                  <TrendingUp className="h-3 w-3 text-emerald-400" />
                ) : (
                  <TrendingDown className="h-3 w-3 text-rose-400" />
                )}
                <p className="text-[10px] uppercase tracking-widest text-white/50 font-bold">PACE VS PRIOR MO</p>
              </div>
              <p className={cn(
                "text-[32px] sm:text-[40px] leading-none font-black tabular-nums",
                (heroData.data?.paceDelta ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300",
              )}>
                {heroData.isLoading
                  ? "—"
                  : `${(heroData.data?.paceDelta ?? 0) >= 0 ? "+" : ""}${(heroData.data?.paceDelta ?? 0).toFixed(0)}%`}
              </p>
              <p className="text-[10px] text-white/50 mt-1 tabular-nums">
                proj {formatMoney(heroData.data?.projected ?? 0)} · prior {formatMoney(heroData.data?.priorAp ?? 0)}
              </p>
            </div>
          </div>

          <p className="mt-4 text-[10px] text-white/40 tracking-wide">
            Source · agentlink_deals_snapshot · America/Phoenix month window · refreshes every 60s
          </p>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {sourceHint}
        {board === "production" && productionMode === "top_legs" && (
          <> · Top Producing Leg sources v_top_legs_excl_sam (AgentLink book, excludes Sam's leg).</>
        )}
      </p>

      {/* PL-WAVE71: single Tabs root binds TabsList triggers + TabsContent under one Radix tree.
          Previously rendered as two separate <Tabs value={board}> roots (header trigger row +
          content map below), which broke aria-controls / keyboard nav and forced parallel state
          writes. Nested productionMode + period Tabs stay as independent roots — they govern
          orthogonal axes and don't conflict. */}
      <Tabs value={board} onValueChange={(value) => setBoard(value as Board)}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <TabsList className="grid grid-cols-4">
            <TabsTrigger value="production">Production</TabsTrigger>
            <TabsTrigger value="recruiting">Recruiting</TabsTrigger>
            <TabsTrigger value="referrals">Referral</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>
          {board === "production" && (
            <Tabs value={productionMode} onValueChange={(value) => setProductionMode(value as ProductionMode)}>
              <TabsList>
                <TabsTrigger value="individuals">Individuals</TabsTrigger>
                <TabsTrigger value="top_legs">Top Producing Leg (excl. Sam)</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
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
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="h-9 w-[160px] justify-start text-left font-normal">
                      {customFrom ? fmtDate(new Date(customFrom + "T00:00:00"), "MMM d, yyyy") : "From"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={customFrom ? new Date(customFrom + "T00:00:00") : undefined}
                      onSelect={(d) => setCustomFrom(d ? fmtDate(d, "yyyy-MM-dd") : "")} initialFocus />
                  </PopoverContent>
                </Popover>
                <span className="text-muted-foreground text-sm">→</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="h-9 w-[160px] justify-start text-left font-normal">
                      {customTo ? fmtDate(new Date(customTo + "T00:00:00"), "MMM d, yyyy") : "To"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={customTo ? new Date(customTo + "T00:00:00") : undefined}
                      onSelect={(d) => setCustomTo(d ? fmtDate(d, "yyyy-MM-dd") : "")} initialFocus />
                  </PopoverContent>
                </Popover>
              </div>
            )}
          </div>
        </div>

        {(["production", "recruiting", "referrals", "activity"] as Board[]).map((tab) => (
          <TabsContent key={tab} value={tab} className="mt-0">
            {loading ? (
              <div className="space-y-2 py-2" aria-label="Loading leaderboard">
                {[0,1,2,3,4,5,6,7].map((i) => (
                  <div key={i} className="h-12 rounded-lg bg-muted/40 animate-pulse" />
                ))}
              </div>
            ) : rows.length === 0 ? (
              <GlassCard className="p-0">
                {/* 2026-06-15 v7.2 diagnostic empty-state · Sam's mandate: never leave
                    the user wondering WHY. Tell them: fetched count + what's been queried
                    + a one-tap fallback to widen the window. */}
                <div className="text-center py-12">
                  <Trophy className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-semibold mb-2">
                    {rows.length === 0 ? `No ${BOARD_META[tab].label.toLowerCase()} rows fetched` : "Filters are hiding everything"}
                  </h3>
                  <div className="space-y-3 max-w-md mx-auto">
                    <p className="text-13 text-muted-foreground">
                      Fetched <span className="font-bold text-foreground tabular-nums">{rows.length.toLocaleString()}</span> ranked rows for the <span className="font-bold">{period}</span> window.
                    </p>
                    <div className="text-12 text-rose-600 dark:text-rose-400">
                      Zero rows in this window. Likely causes:
                      <ul className="list-disc list-inside mt-2 text-left">
                        <li>The current {period} window genuinely has no {BOARD_META[tab].label.toLowerCase()} yet</li>
                        <li>Source ({BOARD_META[tab].source}) is dark or RLS-restricted</li>
                        <li>Your role can't see other agents' rows on this view</li>
                      </ul>
                      <p className="mt-2 font-semibold">Hold the Standard.</p>
                    </div>
                    {period !== "monthly" && (
                      <Button
                        size="sm"
                        onClick={() => setPeriod("monthly")}
                        className="bg-amber-500 hover:bg-amber-400 text-slate-950"
                      >
                        Widen window · switch to monthly
                      </Button>
                    )}
                  </div>
                </div>
              </GlassCard>
            ) : (
              <GlassCard className="overflow-hidden p-0">
                <div className="divide-y divide-border/40">
                  {rows.map((row) => {
                    const RankIcon = RANK_ICONS[row.rank]?.icon ?? TrendingUp;
                    const rankColor = RANK_ICONS[row.rank]?.color ?? "text-muted-foreground";
                    const highlight = row.rank <= 3;

                    // v6 §31 Sam: #1 amber-glow ring, #2 slate, #3 amber-700,
                    // rest neutral. Stronger top-3 contrast for the podium.
                    const podiumStyle =
                      row.rank === 1
                        ? "bg-amber-500/15 ring-1 ring-amber-400/60 shadow-[0_0_24px_-8px_hsl(45_90%_55%/0.45)]"
                        : row.rank === 2
                        ? "bg-slate-400/10 ring-1 ring-slate-300/40"
                        : row.rank === 3
                        ? "bg-amber-700/15 ring-1 ring-amber-700/50"
                        : "";
                    return (
                      <div
                        key={row.agent_id}
                        className={cn(
                          "flex items-center gap-3 px-4 py-3 transition-all",
                          highlight && podiumStyle,
                        )}
                      >
                        <div className={cn("w-10 text-center text-lg font-bold tabular-nums", rankColor, highlight && "text-shadow")}>
                          #{row.rank}
                        </div>
                        <RankIcon className={cn("h-5 w-5", rankColor)} />
                        {row.avatar_url ? (
                          <img src={row.avatar_url} alt="" className={cn("h-9 w-9 rounded-full ring-2", row.rank === 1 ? "ring-amber-400/70" : "ring-border/40")} />
                        ) : (
                          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted/50 text-xs font-semibold">
                            {(row.agent_name ?? "?").split(" ").map((part) => part[0]).slice(0, 2).join("")}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className={cn("truncate font-semibold", highlight && "text-foreground")}>{row.agent_name ?? "—"}</div>
                          <div className={cn("text-xs", highlight ? "text-foreground/75" : "text-muted-foreground")}>{subValue(row)}</div>
                        </div>
                        <div className="text-right">
                          <div className={cn(
                            "text-[26px] leading-none font-black tabular-nums",
                            highlight ? "text-emerald-300" : "text-emerald-400",
                          )}>
                            {primaryValue(row)}
                          </div>
                          <div className="mt-1 flex items-center justify-end gap-1 text-[10px] uppercase tracking-widest text-muted-foreground">
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
