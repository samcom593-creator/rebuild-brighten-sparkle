import { useCallback, useEffect, useMemo, useState } from "react";
import { Crown, Loader2, Medal, TrendingUp, Calendar as CalendarIcon, Clock3, Target, Users, Activity, CalendarDays, Trophy, DollarSign, TrendingDown, AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { formatDistanceToNowStrict } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format as fmtDate } from "date-fns";
import { cn } from "@/lib/utils";
import { getMetricBounds, type MetricBounds } from "@/lib/metricTruth";
import { useProductionRealtime } from "@/hooks/useProductionRealtime";

type Period = "daily" | "weekly" | "monthly" | "custom";
type Board = "production" | "recruiting" | "referrals" | "activity";
// Wave B v9 §3/§12 check 8: Top Producing Leg sub-view EXCLUDES Sam James'
// leg (so it surfaces actual downline managers, not Sam swallowing every
// agency-wide deal). Toggled inside the Production board only.
type ProductionMode = "individuals" | "top_legs";
type Row = {
  rank: number;
  // Stable list identity. Equals the canonical agent id when the producer is a
  // mapped agent, else a `name:<lowercased>` key so unmapped producers (e.g.
  // Marquay Vaughns, Raheem Sheikh) still get a unique, collision-free React key.
  agent_key: string;
  agent_id: string;
  primary: number;
  secondary: number;
  tertiary: number;
  agent_name: string | null;
  avatar_url: string | null;
  // top_legs mode only — number of agents inside the leg
  leg_size?: number;
};

// Podium tints are theme-paired: the bare -400/-500 weights washed out on the
// white light-theme card (--apex-card: 0 0% 100%).
const RANK_ICONS: Record<number, { icon: typeof Crown; color: string }> = {
  1: { icon: Crown, color: "text-amber-600 dark:text-amber-400" },
  2: { icon: Medal, color: "text-slate-600 dark:text-slate-300" },
  3: { icon: Medal, color: "text-amber-700 dark:text-amber-500" },
};

const BOARD_META: Record<Board, { label: string; icon: typeof Crown; source: string }> = {
  production: { label: "Production", icon: Crown, source: "agentlink_book · posted date · dead statuses excluded" },
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
  // Default to Monthly: the book runs on posted/sale date and the business
  // week resets Monday (America/Chicago), so Weekly reads empty at the top of
  // each week until deals post. Monthly always shows the live agency picture.
  const [period, setPeriod] = useState<Period>("monthly");
  const [board, setBoard] = useState<Board>("production");
  const [productionMode, setProductionMode] = useState<ProductionMode>("individuals");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);

  const bounds = useMemo(() => getBounds(period, customFrom, customTo), [period, customFrom, customTo]);

  // v6 §31 hero data — agency production this month vs prior month. Source of
  // truth is agentlink_book (fresh, name-attributed AgentLink book) via the
  // leaderboard_book_hero RPC: posted/sale-date windowed, dead statuses
  // excluded, Phoenix tz month boundaries per Sam's permanent memory rule.
  const heroData = useQuery({
    queryKey: ["leaderboard-hero-agency-production"],
    refetchInterval: 60_000,
    staleTime: 55_000,
    queryFn: async () => {
      const { data } = await supabase.rpc("leaderboard_book_hero" as any);
      const row = (Array.isArray(data) ? data[0] : data) as
        | {
            total_ap: number | string | null;
            producers: number | string | null;
            deal_count: number | string | null;
            prior_ap: number | string | null;
            day_of_month: number | string | null;
            days_in_month: number | string | null;
          }
        | undefined;

      const totalAp = Number(row?.total_ap ?? 0);
      const producers = Number(row?.producers ?? 0);
      const dealCount = Number(row?.deal_count ?? 0);
      const priorAp = Number(row?.prior_ap ?? 0);
      const dayOfMonth = Number(row?.day_of_month ?? 0);
      const daysInMonth = Number(row?.days_in_month ?? 0);

      const avgPerProducer = producers > 0 ? totalAp / producers : 0;
      // Pace projection: linearly extrapolate month-to-date to full month.
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

  // Freshness guard — the original bug was that the book silently froze
  // (last synced 2026-07-06) while the board kept rendering stale totals as if
  // live. Surface the book's age so staleness screams instead of lying.
  const bookFreshness = useQuery({
    queryKey: ["leaderboard-book-freshness"],
    refetchInterval: 300_000,
    staleTime: 250_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("v_agentlink_book_freshness" as any)
        .select("latest_posted, days_since_last_posted, deals")
        .maybeSingle();
      return (data ?? null) as {
        latest_posted: string | null;
        days_since_last_posted: number | string | null;
        deals: number | string | null;
      } | null;
    },
  });
  const staleDays = bookFreshness.data?.days_since_last_posted != null
    ? Number(bookFreshness.data.days_since_last_posted)
    : null;

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
          agent_key: agentId,
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
          agent_key: leg.manager_id,
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
        // Source of truth: agentlink_book (fresh, name-attributed AgentLink
        // book) via the leaderboard_book RPC. This fixes the four accuracy
        // bugs the prior snapshot path carried:
        //   1. Staleness — the book has its own upsert path, not the sync that
        //      froze agentlink_deals_snapshot at 2026-07-06.
        //   2. Unmapped producers — the RPC attributes by NAME first, so real
        //      producers with no al_user_id (Marquay Vaughns, Pranav Kodali,
        //      Matthew Anduha, Taylen Nash, Jorge Oyervidez, Raheem Sheikh,
        //      Mahmod Imran, Logan Spatola) rank instead of being join-dropped.
        //   3. Window — ranks on POSTED/sale date, not effective_date, so a
        //      policy written this week effective next month counts this week.
        //   4. Status — Declined / Not Taken / Withdrawn / Lapse are excluded.
        // Dup identities are canonicalized inside the RPC (v_agent_canonical_map).
        const { data: rpcRows } = await supabase.rpc("leaderboard_book" as any, {
          p_start: bounds.startIso.slice(0, 10),
          p_end: bounds.endIso.slice(0, 10),
        });
        const built: Row[] = ((rpcRows ?? []) as Array<{
          agent_key: string;
          agent_id: string | null;
          agent_name: string | null;
          avatar_url: string | null;
          deals: number | string;
          ap: number | string;
        }>).map((r, index) => ({
          rank: index + 1,
          agent_key: r.agent_key,
          agent_id: r.agent_id ?? r.agent_key,
          primary: Number(r.ap ?? 0),
          secondary: Number(r.deals ?? 0),
          tertiary: 0,
          agent_name: r.agent_name,
          avatar_url: r.avatar_url,
        }));
        setRows(built);
        setLastUpdatedAt(new Date().toISOString());
        setLoading(false);
        return;
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
    <div className="page-enter mx-auto w-full max-w-6xl space-y-5 px-4 pb-24 sm:px-6">
      <PageHeader
        accent="amber"
        eyebrow="Production · Rankings"
        eyebrowIcon={<Trophy className="h-3 w-3" />}
        title="Leaderboard"
        subtitle="Production, recruiting, referral, and activity rankings from live platform tables."
        actions={
          <div className="flex items-center gap-2">
            {board === "production" && staleDays !== null && staleDays > 3 && (
              <Badge variant="destructive" className="gap-1.5">
                <Clock3 className="h-3 w-3" />
                Book {staleDays}d stale
              </Badge>
            )}
            {lastUpdatedAt && (
              <Badge variant="outline" className="gap-1.5">
                <CalendarIcon className="h-3 w-3" />
                {formatDistanceToNowStrict(new Date(lastUpdatedAt), { addSuffix: true })}
              </Badge>
            )}
          </div>
        }
      />

      {/* v6 §31 canonical hero — month-to-date agency AP, producer count, avg
          per producer, and projected pace vs prior month.
          Truth source: agentlink_book via leaderboard_book_hero.
          Month-to-date AP is the one number Sam reads first, so it is the only
          emerald figure in the strip; every other tile stays neutral. */}
      <GlassCard className="p-4">
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
            <Activity className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">Agency production</span>
          </h3>
          <span className="flex shrink-0 items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            <span aria-hidden className="h-2 w-2 rounded-full bg-emerald-500" />
            Live
          </span>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
          Source · agentlink_book · posted date · America/Phoenix month window · refreshes every 60s
        </p>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="min-w-0 rounded-lg border border-border bg-card p-3 sm:p-4">
            <div className="mb-1.5 flex items-center gap-2">
              <DollarSign className="h-4 w-4 shrink-0 text-muted-foreground" />
              <p className="truncate text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Month-to-date AP</p>
            </div>
            <p className="truncate text-2xl font-bold leading-none tabular-nums text-emerald-600 dark:text-emerald-400">
              {heroData.isLoading ? "—" : formatMoney(heroData.data?.totalAp ?? 0)}
            </p>
            <p className="mt-1.5 truncate text-[11px] tabular-nums text-muted-foreground">
              {heroData.data?.dealCount ?? 0} deals · day {heroData.data?.dayOfMonth ?? "—"}/{heroData.data?.daysInMonth ?? "—"}
            </p>
          </div>

          <div className="min-w-0 rounded-lg border border-border bg-card p-3 sm:p-4">
            <div className="mb-1.5 flex items-center gap-2">
              <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
              <p className="truncate text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Producers</p>
            </div>
            <p className="truncate text-2xl font-bold leading-none tabular-nums text-foreground">
              {heroData.isLoading ? "—" : (heroData.data?.producers ?? 0).toLocaleString()}
            </p>
            <p className="mt-1.5 truncate text-[11px] text-muted-foreground">
              {heroData.data?.producers === 1 ? "agent posting deals" : "agents posting deals"}
            </p>
          </div>

          <div className="min-w-0 rounded-lg border border-border bg-card p-3 sm:p-4">
            <div className="mb-1.5 flex items-center gap-2">
              <Target className="h-4 w-4 shrink-0 text-muted-foreground" />
              <p className="truncate text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Avg / producer</p>
            </div>
            <p className="truncate text-2xl font-bold leading-none tabular-nums text-foreground">
              {heroData.isLoading ? "—" : formatMoney(heroData.data?.avgPerProducer ?? 0)}
            </p>
            <p className="mt-1.5 truncate text-[11px] text-muted-foreground">
              month-to-date per active producer
            </p>
          </div>

          <div className="min-w-0 rounded-lg border border-border bg-card p-3 sm:p-4">
            <div className="mb-1.5 flex items-center gap-2">
              {(heroData.data?.paceDelta ?? 0) >= 0 ? (
                <TrendingUp className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <TrendingDown className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
              )}
              <p className="truncate text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Pace vs prior mo</p>
            </div>
            <p className={cn(
              "truncate text-2xl font-bold leading-none tabular-nums",
              (heroData.data?.paceDelta ?? 0) >= 0
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-rose-600 dark:text-rose-400",
            )}>
              {heroData.isLoading
                ? "—"
                : `${(heroData.data?.paceDelta ?? 0) >= 0 ? "+" : ""}${(heroData.data?.paceDelta ?? 0).toFixed(0)}%`}
            </p>
            <p className="mt-1.5 truncate text-[11px] tabular-nums text-muted-foreground">
              proj {formatMoney(heroData.data?.projected ?? 0)} · prior {formatMoney(heroData.data?.priorAp ?? 0)}
            </p>
          </div>
        </div>
      </GlassCard>

      <p className="text-xs leading-relaxed text-muted-foreground">
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
        <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <TabsList className="grid w-full grid-cols-4 lg:w-auto">
            <TabsTrigger value="production">Production</TabsTrigger>
            <TabsTrigger value="recruiting">Recruiting</TabsTrigger>
            <TabsTrigger value="referrals">Referral</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>
          {board === "production" && (
            // The "Top Producing Leg (excl. Sam)" trigger is wider than a phone
            // viewport — it scrolls inside its own rail so the page body never does.
            <div className="-mx-4 min-w-0 overflow-x-auto pb-1 sm:mx-0">
              <div className="flex min-w-max px-4 sm:px-0">
                <Tabs value={productionMode} onValueChange={(value) => setProductionMode(value as ProductionMode)}>
                  <TabsList>
                    <TabsTrigger value="individuals">Individuals</TabsTrigger>
                    <TabsTrigger value="top_legs">Top Producing Leg (excl. Sam)</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
            </div>
          )}
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Tabs value={period} onValueChange={(value) => setPeriod(value as Period)} className="min-w-0 flex-1 lg:flex-none">
              <TabsList className="grid w-full grid-cols-4 lg:w-auto">
                <TabsTrigger value="daily">Daily</TabsTrigger>
                <TabsTrigger value="weekly">Weekly</TabsTrigger>
                <TabsTrigger value="monthly">Monthly</TabsTrigger>
                <TabsTrigger value="custom">Custom</TabsTrigger>
              </TabsList>
            </Tabs>
            {period === "custom" && (
              <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
                <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="h-10 min-w-0 flex-1 justify-start truncate text-left font-normal sm:h-9 sm:w-[160px] sm:flex-none">
                      {customFrom ? fmtDate(new Date(customFrom + "T00:00:00"), "MMM d, yyyy") : "From"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={customFrom ? new Date(customFrom + "T00:00:00") : undefined}
                      onSelect={(d) => setCustomFrom(d ? fmtDate(d, "yyyy-MM-dd") : "")} initialFocus />
                  </PopoverContent>
                </Popover>
                <span className="shrink-0 text-sm text-muted-foreground">→</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="h-10 min-w-0 flex-1 justify-start truncate text-left font-normal sm:h-9 sm:w-[160px] sm:flex-none">
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
          <TabsContent key={tab} value={tab} className="mt-3">
            {loading ? (
              <GlassCard className="p-4">
                <div className="space-y-2" aria-label="Loading leaderboard">
                  {[0,1,2,3,4,5,6,7].map((i) => (
                    /* stable-key-allow:skeleton */
                    <div key={i} className="h-16 rounded-lg bg-muted/30 animate-pulse" />
                  ))}
                </div>
              </GlassCard>
            ) : rows.length === 0 ? (
              <div className="space-y-3">
                {/* 2026-06-15 v7.2 diagnostic empty-state · Sam's mandate: never leave
                    the user wondering WHY. Tell them: fetched count + what's been queried
                    + a one-tap fallback to widen the window. */}
                <EmptyState
                  icon={<Trophy className="h-7 w-7" />}
                  variant="warning"
                  title={rows.length === 0 ? `No ${BOARD_META[tab].label.toLowerCase()} rows fetched` : "Filters are hiding everything"}
                  description={
                    <>
                      Fetched <span className="font-bold tabular-nums text-foreground">{rows.length.toLocaleString()}</span> ranked rows for the <span className="font-bold text-foreground">{period}</span> window.
                    </>
                  }
                  actions={
                    period !== "monthly" ? (
                      <Button
                        size="sm"
                        className="h-10 w-full sm:h-9 sm:w-auto"
                        onClick={() => setPeriod("monthly")}
                      >
                        Widen window · switch to monthly
                      </Button>
                    ) : undefined
                  }
                />
                <GlassCard className="p-4">
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
                      <AlertTriangle className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">Zero rows in this window. Likely causes:</span>
                    </h3>
                  </div>
                  <p className="mb-3 text-xs leading-relaxed text-amber-600 dark:text-amber-400">
                    Empty here means the board fetched nothing — treat the number as missing, not as zero, until one of these is ruled out.
                  </p>
                  <ul className="space-y-2">
                    <li className="rounded-lg border border-border/60 bg-card/60 px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
                      The current {period} window genuinely has no {BOARD_META[tab].label.toLowerCase()} yet
                    </li>
                    <li className="rounded-lg border border-border/60 bg-card/60 px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
                      Source ({BOARD_META[tab].source}) is dark or RLS-restricted
                    </li>
                    <li className="rounded-lg border border-border/60 bg-card/60 px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
                      Your role can't see other agents' rows on this view
                    </li>
                  </ul>
                  <p className="mt-3 text-[11px] font-semibold text-muted-foreground">Hold the Standard.</p>
                </GlassCard>
              </div>
            ) : (
              <GlassCard className="p-4">
                <ul className="space-y-2">
                  {rows.map((row) => {
                    const RankIcon = RANK_ICONS[row.rank]?.icon ?? TrendingUp;
                    const rankColor = RANK_ICONS[row.rank]?.color ?? "text-muted-foreground";
                    const highlight = row.rank <= 3;

                    // v6 §31 Sam: #1 gold, #2 silver, #3 bronze, rest neutral.
                    // Flattened to a border/soft-fill tint — the ring + glow
                    // shadow form was the "bolted-on" tell the 2026-06-10 audit
                    // deleted, and the rank icon + numeral already carry the tier.
                    const podiumStyle =
                      row.rank === 1
                        ? "border-amber-500/50 bg-amber-500/10"
                        : row.rank === 2
                        ? "border-border bg-muted/40"
                        : row.rank === 3
                        ? "border-border bg-muted/20"
                        : "";
                    return (
                      <li
                        key={row.agent_key}
                        className={cn(
                          "flex items-center gap-3 rounded-lg border border-border/60 bg-card/60 px-3 py-2.5 transition-colors hover:border-border hover:bg-card",
                          highlight && podiumStyle,
                        )}
                      >
                        <div className={cn("w-9 shrink-0 text-center text-sm font-bold tabular-nums", rankColor)}>
                          #{row.rank}
                        </div>
                        <RankIcon className={cn("h-4 w-4 shrink-0", rankColor)} />
                        {row.avatar_url ? (
                          <img src={row.avatar_url} alt="" className={cn("h-8 w-8 shrink-0 rounded-full ring-2", row.rank === 1 ? "ring-amber-500/50" : "ring-border/40")} />
                        ) : (
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted/50 text-[10px] font-bold text-muted-foreground">
                            {(row.agent_name ?? "?").split(" ").map((part) => part[0]).slice(0, 2).join("")}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-foreground">{row.agent_name ?? "—"}</div>
                          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{subValue(row)}</div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-sm font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                            {primaryValue(row)}
                          </div>
                          <div className="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                            {BOARD_META[tab].label}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </GlassCard>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
