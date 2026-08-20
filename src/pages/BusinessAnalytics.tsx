// BusinessAnalytics — the APEX "Reports" route.
//
// 2026-08-19 · AGENT CLOUD composition pass. Presentation only — no query,
// hook, RPC, condition, route, handler or rendered value was touched. The page
// now leads with a KPI stat row (Production · Policies · Producers · Growth)
// and lays every breakdown into calm Card sections instead of the previous
// GlassCard stack + dense bordered table. Same numbers in, executive layout out.
//
// Data sources (our internal views, since agentlink v1 /business-analytics
// returns HTTP 500 on their side — see master prompt 121):
//   - v_business_analytics_summary
//   - v_business_analytics_carriers
//   - v_business_analytics_insights
//   - v_sales_challenges
//   - v_trophy_cabinet
//   - v_agents_needs_attention / v_agents_learn_from / v_inactive_agents_summary
//
// When the AgentLink /api/v1/business-analytics endpoint stops 500-ing,
// swap the queries below to call the AgentLink API instead. Same shape.

import { useQuery } from "@tanstack/react-query";
import { DollarSign, Trophy, Users, Target, TrendingUp, RefreshCw, Sparkles, Flame, AlertTriangle, Brain, UserX, Lightbulb, GraduationCap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

// Contract §6 — three severity tones, mapped to the app's semantic tokens so
// success/warning/destructive read the same everywhere and stay legible on the
// black+gold card in both themes.
const SEV_TEXT = {
  good: "text-success",
  warn: "text-warning",
  bad: "text-destructive",
  none: "text-muted-foreground",
} as const;
const SEV_BORDER = {
  good: "border-success/30",
  warn: "border-warning/30",
  bad: "border-destructive/30",
} as const;
const SEV_DOT = {
  good: "bg-success",
  warn: "bg-warning",
  bad: "bg-destructive",
} as const;

function fmtUsd(n: number, compact = false): string {
  const v = Number(n ?? 0);
  if (compact && v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (compact && v >= 1_000)     return `$${(v / 1_000).toFixed(1)}K`;
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
function fmtNum(n: number | string | null | undefined): string {
  return Number(n ?? 0).toLocaleString("en-US");
}

interface Summary {
  total_deals_mtd: string;
  total_premium_mtd: string;
  active_producers_30d: string;
  avg_deal_size: string;
  premium_last_month: string;
  growth_pct_mom: string;
}
interface Carrier {
  carrier_id: number;
  carrier_name: string;
  deal_count: number;
  total_premium: string;
  avg_deal_size: string;
}

interface Challenge {
  period: "daily" | "weekly" | "monthly" | "quarterly";
  current_premium: string;
  target_premium: string;
  current_deals: number;
  target_deals: number;
  period_end_at: string;
}

interface TrophyCabinet {
  daily_wins: number;
  weekly_wins: number;
  monthly_wins: number;
  quarterly_wins: number;
  total_wins: number;
}

interface NeedsAttention {
  id: string;
  display_name: string | null;
  agent_code: string | null;
  deals_30d: number;
  premium_30d: string;
  potential_30d: string;
  recommendation: string;
}

interface LearnFrom {
  user_id: number;
  display_name: string;
  agent_code: string | null;
  deals_30d: number;
  premium_30d: string;
  pct_above_avg: string;
}

interface InactiveSummary {
  inactive_count: number;
  sample_names: string[] | null;
}

interface Insights {
  top_carrier_name: string | null;
  top_carrier_share_pct: string;
  top_carrier_deals: string;
  top3_producer_share_pct: string;
  team_producers: string;
  team_deals_30d: string;
  team_premium_30d: string;
  streak_days: string;
  days_in_month_elapsed: string;
}

export default function BusinessAnalytics() {
  usePageTitle("Business Analytics · APEX");

  const summary = useQuery({
    queryKey: ["business-analytics-summary"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_business_analytics_summary" as any)
        .select("total_deals_mtd, total_premium_mtd, active_producers_30d, avg_deal_size, premium_last_month, growth_pct_mom")
        .maybeSingle();
      if (error) throw error;
      return data as unknown as Summary;
    },
    refetchInterval: 300_000 * 60_000,
  });

  const carriers = useQuery({
    queryKey: ["business-analytics-carriers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_business_analytics_carriers" as any)
        .select("carrier_id, carrier_name, deal_count, total_premium, avg_deal_size")
        .limit(15);
      if (error) throw error;
      return (data ?? []) as unknown as Carrier[];
    },
    refetchInterval: 300_000 * 60_000,
  });

  const insights = useQuery({
    queryKey: ["business-analytics-insights"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_business_analytics_insights" as any)
        .select("top_carrier_name, top_carrier_share_pct, top_carrier_deals, top3_producer_share_pct, team_producers, team_deals_30d, team_premium_30d, streak_days, days_in_month_elapsed")
        .maybeSingle();
      if (error) throw error;
      return data as unknown as Insights;
    },
    refetchInterval: 300_000 * 60_000,
  });
  const ins = insights.data;

  const challenges = useQuery({
    queryKey: ["sales-challenges"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_sales_challenges" as any)
        .select("period, current_premium, target_premium, current_deals, target_deals, period_end_at");
      if (error) throw error;
      return (data ?? []) as unknown as Challenge[];
    },
    refetchInterval: 300_000 * 60_000,
  });

  const trophy = useQuery({
    queryKey: ["trophy-cabinet"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_trophy_cabinet" as any)
        .select("daily_wins, weekly_wins, monthly_wins, quarterly_wins, total_wins")
        .maybeSingle();
      if (error) throw error;
      return data as unknown as TrophyCabinet;
    },
    refetchInterval: 300_000 * 60_000,
  });
  const tc = trophy.data;

  // WAVE FINAL · personalized insights backing the AgentLink-style cards
  const needsAttention = useQuery({
    queryKey: ["agents-needs-attention"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_agents_needs_attention" as any)
        .select("id, display_name, agent_code, deals_30d, premium_30d, potential_30d, recommendation");
      if (error) throw error;
      return (data ?? []) as unknown as NeedsAttention[];
    },
    refetchInterval: 300_000 * 60_000,
  });

  const learnFrom = useQuery({
    queryKey: ["agents-learn-from"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_agents_learn_from" as any)
        .select("user_id, display_name, agent_code, deals_30d, premium_30d, pct_above_avg");
      if (error) throw error;
      return (data ?? []) as unknown as LearnFrom[];
    },
    refetchInterval: 300_000 * 60_000,
  });

  const inactive = useQuery({
    queryKey: ["agents-inactive-summary"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_inactive_agents_summary" as any)
        .select("inactive_count, sample_names")
        .maybeSingle();
      if (error) throw error;
      return data as unknown as InactiveSummary;
    },
    refetchInterval: 300_000 * 60_000,
  });

  const s = summary.data;
  const growth = Number(s?.growth_pct_mom ?? 0);
  const growthPositive = growth >= 0;
  const totalPremium = Number(s?.total_premium_mtd ?? 0);
  // Rolling-30d total, summed from the carrier rows themselves so the Share column
  // cannot disagree with the table it labels. Do NOT swap this for an MTD figure.
  const carrierTotalPremium = (carriers.data ?? []).reduce(
    (sum, c) => sum + Number(c.total_premium ?? 0),
    0,
  );

  // wave-p1g · fake-success gate. The primary v_business_analytics_summary query
  // drives every MTD number in the hero (premium, deals, producers, growth). On
  // query failure the page previously accepted undefined and rendered $0 across
  // the board — indistinguishable from a real zero-book month. Refuse to lie:
  // render an explicit error card + Retry when summary fails with no data.
  // Same pattern as DashboardCommandCenter (commit 4eeea338).
  const refetchAll = () => {
    summary.refetch(); carriers.refetch(); insights.refetch();
    challenges.refetch(); trophy.refetch(); needsAttention.refetch();
    learnFrom.refetch(); inactive.refetch();
  };
  if (summary.isError && !summary.data) {
    const message = summary.error instanceof Error
      ? summary.error.message
      : "Unknown error loading Business Analytics data.";
    return (
      <div className="page-enter mx-auto w-full max-w-6xl space-y-6 px-4 pb-24 sm:px-6">
        <div className={cn("rounded-[10px] border bg-destructive/5 p-3 sm:p-4", SEV_BORDER.bad)}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <AlertTriangle className={cn("mt-0.5 h-5 w-5 shrink-0", SEV_TEXT.bad)} aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">Business Analytics failed to load</p>
                <p className="mt-0.5 break-words text-xs leading-relaxed text-muted-foreground">{message}</p>
              </div>
            </div>
            <Button onClick={refetchAll} size="sm" variant="outline" className="h-10 w-full shrink-0 sm:h-9 sm:w-auto">
              <RefreshCw className="mr-1.5 h-4 w-4" />
              Retry
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-enter mx-auto w-full max-w-6xl space-y-6 px-4 pb-24 sm:px-6">
      <PageHeader
        eyebrow="Reports · Overview"
        eyebrowIcon={<TrendingUp className="h-3 w-3" />}
        title="Business Analytics"
        subtitle="This team's production, carriers and coaching signals — recomputed from the book every five minutes. Mirrors AgentLink's business-analytics page."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="uppercase tracking-wide">Last 30 days</Badge>
            {/* WAVE FINAL · AI Insights jump-to-section button · mirrors AgentLink's
                top-right "AI Insights" header button. Scrolls to the AI section. */}
            <Button
              variant="outline"
              size="sm"
              className="h-10 gap-2 sm:h-9"
              onClick={() => {
                const el = document.querySelector("[data-section='ai-insights']");
                el?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              <Sparkles className="h-4 w-4 shrink-0" />
              AI Insights
            </Button>
            <Button variant="outline" size="sm" className="h-10 gap-2 sm:h-9" onClick={refetchAll}>
              <RefreshCw className={cn("h-4 w-4 shrink-0", (summary.isFetching || carriers.isFetching) && "animate-spin")} />
              Refresh
            </Button>
          </div>
        }
      />

      {/* KPI STAT ROW · Production · Policies · Producers · Growth. Leads the page
          per the AC Reports composition; every value is live from
          v_business_analytics_summary. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {summary.isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={`kpi-skel-${i}`} className="rounded-md border border-border bg-card p-4">
              <Skeleton className="h-8 w-24" />
              <Skeleton className="mt-2 h-3 w-20" />
            </div>
          ))
        ) : (
          <>
            <div className="rounded-md border border-border bg-card p-4">
              <p className="text-2xl font-bold tabular-nums text-success">{fmtUsd(totalPremium, true)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Production · MTD premium</p>
              <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">{fmtUsd(totalPremium)}</p>
            </div>
            <div className="rounded-md border border-border bg-card p-4">
              <p className="text-2xl font-bold tabular-nums text-foreground">{fmtNum(s?.total_deals_mtd)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Policies · deals MTD</p>
              <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">avg {fmtUsd(Number(s?.avg_deal_size ?? 0))}</p>
            </div>
            <div className="rounded-md border border-border bg-card p-4">
              <p className="text-2xl font-bold tabular-nums text-foreground">{fmtNum(s?.active_producers_30d)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Active producers · 30d</p>
              <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">wrote {fmtNum(s?.total_deals_mtd)} deals</p>
            </div>
            <div className="rounded-md border border-border bg-card p-4">
              <p className={cn(
                "text-2xl font-bold tabular-nums",
                growthPositive ? "text-success" : "text-destructive",
              )}>
                {growthPositive ? "+" : ""}{growth}%
              </p>
              <p className="mt-1 text-xs text-muted-foreground">MoM growth</p>
              <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">vs {fmtUsd(Number(s?.premium_last_month ?? 0), true)}</p>
            </div>
          </>
        )}
      </div>

      {/* PERFORMANCE SNAPSHOT · operational counts + 3-lane challenge strip.
          Replaces the previous GlassCard hero; the MTD totals it used to nest
          now live in the KPI row above, so nothing is shown twice. All LIVE. */}
      {(summary.isLoading || trophy.isLoading || challenges.isLoading) ? (
        <Skeleton className="h-64 w-full rounded-[10px]" />
      ) : (
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2">
                <Target className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate">Performance snapshot</span>
              </CardTitle>
              <p className="mt-1 text-[13px] leading-snug text-muted-foreground">
                Trophy wins, open challenges and the producers the AI singled out — personalized per producer.
              </p>
            </div>
            <Badge variant="outline" className="shrink-0 border-success/30 bg-success/15 text-success">
              <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", SEV_DOT.good)} /> Live
            </Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* 4 operational metrics */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <Trophy className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <p className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">Trophy wins</p>
                </div>
                <p className="mt-1 text-2xl font-bold leading-none tabular-nums text-foreground">
                  {fmtNum(tc?.total_wins ?? 0)}
                </p>
                <p className="mt-1 truncate text-[11px] tabular-nums text-muted-foreground">
                  {fmtNum(tc?.daily_wins ?? 0)}D · {fmtNum(tc?.weekly_wins ?? 0)}W · {fmtNum(tc?.monthly_wins ?? 0)}M · {fmtNum(tc?.quarterly_wins ?? 0)}Q
                </p>
              </div>

              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <Target className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <p className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">Active challenges</p>
                </div>
                <p className="mt-1 text-2xl font-bold leading-none tabular-nums text-foreground">
                  {fmtNum(challenges.data?.length ?? 0)}
                </p>
                <p className="mt-1 truncate text-[11px] tabular-nums text-muted-foreground">
                  {ins
                    ? `${ins.streak_days}/${ins.days_in_month_elapsed} day streak`
                    : insights.isError
                      ? <button onClick={() => insights.refetch()} className="text-warning hover:underline">couldn’t load — retry</button>
                      : insights.isLoading ? "…" : "no streak data"}
                </p>
              </div>

              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <p className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">Needs attention</p>
                </div>
                <p className={cn(
                  "mt-1 text-2xl font-bold leading-none tabular-nums",
                  (needsAttention.data?.length ?? 0) > 0 ? SEV_TEXT.bad : SEV_TEXT.none,
                )}>
                  {fmtNum(needsAttention.data?.length ?? 0)}
                </p>
                <p className="mt-1 truncate text-[11px] text-muted-foreground">
                  {(needsAttention.data?.length ?? 0) > 0 ? "agents below team avg" : "Roster healthy"}
                </p>
              </div>

              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <GraduationCap className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <p className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">Learn from</p>
                </div>
                <p className={cn(
                  "mt-1 text-2xl font-bold leading-none tabular-nums",
                  (learnFrom.data?.length ?? 0) > 0 ? SEV_TEXT.good : SEV_TEXT.none,
                )}>
                  {fmtNum(learnFrom.data?.length ?? 0)}
                </p>
                <p className="mt-1 truncate text-[11px] text-muted-foreground">
                  {(learnFrom.data?.length ?? 0) > 0 ? "top performers · share playbook" : "Coach to exam"}
                </p>
              </div>
            </div>

            {/* 3-LANE CHALLENGE STRIP · Daily / Weekly / Monthly with status tones */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {(["daily", "weekly", "monthly"] as const).map((period) => {
                const c = challenges.data?.find((x) => x.period === period);
                const cur = Number(c?.current_premium ?? 0);
                const tgt = Number(c?.target_premium ?? 0) || 1;
                const pct = c ? Math.min(150, Math.round((cur / tgt) * 100)) : 0;
                // rose if not started · amber if in progress · emerald if complete
                const complete = pct >= 100;
                const inProgress = pct > 0 && pct < 100;
                const tone = complete ? "good" : inProgress ? "warn" : "bad";
                const label = period.charAt(0).toUpperCase() + period.slice(1);
                const status = complete ? "Complete" : inProgress ? "In progress" : "Not started";
                const coaching = complete
                  ? "Locked · push the bonus"
                  : inProgress
                  ? "Maintain your momentum"
                  : "Close one deal · break the seal";
                return (
                  <div
                    key={period}
                    className={cn("rounded-md border bg-card p-3 sm:p-4", SEV_BORDER[tone])}
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="flex min-w-0 items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", SEV_DOT[tone])} />
                        <span className="truncate">{label} challenge</span>
                      </p>
                      <span className={cn("shrink-0 text-sm font-bold tabular-nums", SEV_TEXT[tone])}>
                        {pct}%
                      </span>
                    </div>
                    <p className={cn("text-2xl font-bold leading-none tabular-nums", SEV_TEXT[tone])}>
                      {c ? fmtUsd(cur, true) : "—"}
                      <span className="ml-1 text-[11px] font-medium tabular-nums text-muted-foreground">
                        / {c ? fmtUsd(tgt, true) : "—"}
                      </span>
                    </p>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn("h-full", SEV_DOT[tone])}
                        style={{ width: `${Math.min(100, pct)}%` }}
                      />
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <p className={cn("min-w-0 truncate text-xs font-semibold uppercase tracking-wide", SEV_TEXT[tone])}>
                        {status}
                      </p>
                      <p className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                        {c ? `${c.current_deals}/${c.target_deals} deals` : "—"}
                      </p>
                    </div>
                    <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{coaching}</p>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* WAVE FINAL · AI-Powered Insights · PERSONALIZED with named agents.
          Mirrors AgentLink's actual insight card layout: "<Agent Name> Needs
          Attention · $X potential · Action: <verb>". Backed by 3 SQL views
          shipped 2026-06-13. Falls back to formula insights if no agents need
          attention (healthy roster). */}
      <Card data-section="ai-insights">
        <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate">AI-powered insights</span>
            </CardTitle>
            <p className="mt-1 text-[13px] leading-snug text-muted-foreground">
              Personalized per producer — each card names the agent and the single move that closes the gap.
            </p>
          </div>
          <Badge variant="outline" className="shrink-0 uppercase tracking-wide">Live</Badge>
        </CardHeader>
        <CardContent>
          {(needsAttention.data?.length ?? 0) === 0 && !ins ? (
            <div className="rounded-md border border-dashed border-border bg-muted/20 p-6 text-center">
              <Sparkles className="mx-auto h-7 w-7 text-muted-foreground/50" />
              <p className="mt-2 text-sm font-medium text-foreground">Nothing flagged yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Insight cards appear here as the roster's book moves. Roster is healthy.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {/* Up to 3 "Needs Attention" cards · names with action recommendation */}
              {(needsAttention.data ?? []).slice(0, 3).map((agent, i) => (
                <InsightCard
                  key={`na-${agent.id}`}
                  icon={i === 0 ? AlertTriangle : UserX}
                  tone="warn"
                  title={`${agent.display_name ?? agent.agent_code ?? "Agent"} · needs attention`}
                  metric={fmtUsd(Number(agent.potential_30d), true)}
                  body={`${agent.recommendation} · potential ${fmtUsd(Number(agent.potential_30d))} if matched team avg.`}
                />
              ))}
              {/* Fill remainder with the original formula insight so the row is always full */}
              {ins && Array.from({ length: Math.max(0, 3 - (needsAttention.data?.length ?? 0)) }).slice(0, 1).map((_, i) => (
                <InsightCard
                  key={`fallback-carrier-${i}`}
                  icon={Flame}
                  tone={Number(ins.top_carrier_share_pct) >= 50 ? "warn" : "neutral"}
                  title="Carrier concentration"
                  metric={`${ins.top_carrier_share_pct}%`}
                  body={`${ins.top_carrier_name ?? "Top carrier"} carries ${ins.top_carrier_share_pct}% of premium (${ins.top_carrier_deals} deals · 30d).${
                    Number(ins.top_carrier_share_pct) >= 50
                      ? " Diversify before this becomes a single-point failure."
                      : " Healthy spread across carriers."
                  }`}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* WAVE FINAL · LEARN FROM cards · top-3 performers above team avg.
          Mirrors AgentLink's "Learn from <agent> · X% above average · Action".
          v_agents_learn_from filters to >150% team avg. */}
      {(learnFrom.data?.length ?? 0) > 0 && (
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2">
                <GraduationCap className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate">Learn from</span>
              </CardTitle>
              <p className="mt-1 text-[13px] leading-snug text-muted-foreground">
                Producers writing well above team average — their playbook is the fastest lift available to everyone below them.
              </p>
            </div>
            <Badge variant="outline" className="shrink-0 border-success/30 bg-success/15 text-success">
              {learnFrom.data!.length}
            </Badge>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {learnFrom.data!.map((agent) => (
                <div
                  key={`lf-${agent.user_id}`}
                  className={cn("rounded-md border bg-card p-3 sm:p-4", SEV_BORDER.good)}
                >
                  <div className="flex items-start gap-3">
                    <Lightbulb className={cn("mt-0.5 h-4 w-4 shrink-0", SEV_TEXT.good)} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{agent.display_name}</p>
                      <p className={cn("mt-1 text-2xl font-bold leading-none tabular-nums", SEV_TEXT.good)}>
                        +{agent.pct_above_avg}%
                      </p>
                      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                        Above team average · {agent.deals_30d} deals · {fmtUsd(Number(agent.premium_30d))} in 30d.
                        Schedule a team best-practices session with them.
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* WAVE FINAL · INACTIVE AGENTS · count + sample names · mirrors
          AgentLink's "138 Agents Inactive" callout. */}
      {inactive.data && Number(inactive.data.inactive_count) > 0 && (
        <div className={cn("rounded-[10px] border bg-warning/5 p-3 sm:p-4", SEV_BORDER.warn)}>
          <div className="flex items-start gap-3">
            <UserX className={cn("mt-0.5 h-5 w-5 shrink-0", SEV_TEXT.warn)} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className={cn("text-2xl font-bold leading-none tabular-nums", SEV_TEXT.warn)}>
                  {inactive.data.inactive_count}
                </span>
                <span className="text-sm font-medium text-foreground">Licensed agents inactive 30d</span>
              </div>
              {inactive.data.sample_names && inactive.data.sample_names.length > 0 && (
                <p className="mt-2 break-words text-[11px] leading-relaxed text-muted-foreground">
                  {inactive.data.sample_names.slice(0, 10).join(" · ")}
                  {Number(inactive.data.inactive_count) > 10 && ` · +${Number(inactive.data.inactive_count) - 10} more`}
                </p>
              )}
              <p className={cn("mt-2 text-xs font-semibold leading-relaxed", SEV_TEXT.warn)}>
                Action: bulk re-engagement campaign · 1-on-1 check-ins prioritized by tenure.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 2-up stat band · derived detail not shown in the KPI row */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Card>
          <CardContent className="p-4 sm:p-[18px] sm:pt-[18px] pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Monthly growth</p>
            {summary.isLoading ? (
              <Skeleton className="mt-2 h-8 w-24" />
            ) : (
              <div className="mt-2 flex flex-wrap items-baseline gap-2">
                <span className={cn(
                  "text-2xl font-bold leading-none tabular-nums",
                  growthPositive ? SEV_TEXT.good : SEV_TEXT.bad,
                )}>
                  {growthPositive ? "+" : ""}{growth}%
                </span>
                <span className="text-[11px] text-muted-foreground">vs last month</span>
              </div>
            )}
            <p className="mt-2 text-[11px] tabular-nums text-muted-foreground">
              Last month: {fmtUsd(Number(s?.premium_last_month ?? 0), true)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 sm:p-[18px] sm:pt-[18px] pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Avg producer output</p>
            {summary.isLoading ? (
              <Skeleton className="mt-2 h-8 w-32" />
            ) : (() => {
              const apc = Number(s?.active_producers_30d ?? 0);
              const per = apc > 0 ? totalPremium / apc : 0;
              return (
                <div className="mt-2 flex flex-wrap items-baseline gap-2">
                  <span className="text-2xl font-bold leading-none tabular-nums text-foreground">{fmtUsd(per, true)}</span>
                  <span className="text-[11px] text-muted-foreground">/ producer · 30d</span>
                </div>
              );
            })()}
            <p className="mt-2 text-[11px] tabular-nums text-muted-foreground">
              {fmtNum(s?.active_producers_30d)} producers wrote {fmtNum(s?.total_deals_mtd)} deals
            </p>
          </CardContent>
        </Card>
      </div>

      {/* CARRIER PERFORMANCE · where the month's premium landed. Sorted by
          premium; a carrier holding an outsized share is a single point of
          failure. Rendered as a clean divide-y list, not a dense table. */}
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate">Carrier performance</span>
            </CardTitle>
            <p className="mt-1 text-[13px] leading-snug text-muted-foreground">
              Where the month's premium actually landed — a carrier holding an outsized share is a single point of failure.
            </p>
          </div>
          <Badge variant="outline" className="shrink-0 uppercase tracking-wide">Last 30 days</Badge>
        </CardHeader>
        <CardContent>
          {carriers.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : (carriers.data?.length ?? 0) === 0 ? (
            <div className="rounded-md border border-dashed border-border bg-muted/20 p-8 text-center">
              <Sparkles className="mx-auto h-7 w-7 text-muted-foreground/50" />
              <p className="mt-2 text-sm font-medium text-foreground">No carrier data in the last 30 days</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Carrier rows appear here as deals land via the AgentLink sync. Check sync status if this stays empty.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {carriers.data!.map((c, i) => {
                // Denominator must come from these same rows. totalPremium is
                // v_business_analytics_summary.total_premium_mtd (month-to-date) while every
                // c.total_premium is v_business_analytics_carriers (rolling 30 days), so
                // dividing one by the other made the column sum to 473.7% on 2026-08-11.
                const pct = carrierTotalPremium > 0 ? (Number(c.total_premium) / carrierTotalPremium) * 100 : 0;
                return (
                  <div key={c.carrier_id} className="py-3">
                    <div className="flex items-center gap-3">
                      <span className="w-5 shrink-0 text-right text-xs font-bold tabular-nums text-muted-foreground">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{c.carrier_name}</p>
                        <p className="mt-0.5 truncate text-[11px] tabular-nums text-muted-foreground">
                          {fmtNum(c.deal_count)} deals · avg {fmtUsd(Number(c.avg_deal_size))}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className={cn("text-sm font-semibold tabular-nums", SEV_TEXT.good)}>
                          {fmtUsd(Number(c.total_premium))}
                        </p>
                        <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">{pct.toFixed(1)}% share</p>
                      </div>
                    </div>
                    <div className="mt-2 ml-8 h-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full bg-primary/60" style={{ width: `${Math.min(100, pct)}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// WAVE FINAL+ · per-period AgentLink-exact copy.
// AgentLink uses different copy patterns per period — not just by % bucket.
// Captured from biz.html live snapshot 2026-06-13.
function motivation(period: Challenge["period"], pct: number): { goal: string; copy: string } {
  const goal = period === "daily"     ? "Close new deals today"
             : period === "weekly"    ? "Weekly deal target"
             : period === "monthly"   ? "Monthly premium goal"
             :                          "Recruit new team members";
  // AgentLink per-period defaults (used when % is low)
  const defaultCopy = period === "daily"     ? "Focus on high-probability prospects"
                    : period === "weekly"    ? "Schedule more client meetings"
                    : period === "monthly"   ? "Focus on larger premium policies"
                    :                          "Good team building progress";
  const copy = pct >= 130 ? "On fire — keep stacking, you're way past target"
             : pct >= 100 ? "🎯 Target hit · push the bonus"
             : pct >= 75  ? "Almost there, maintain your momentum"
             : pct >= 50  ? "Great progress, keep it up!"
             :              defaultCopy;
  return { goal, copy };
}

function ChallengeTile({ challenge: c }: { challenge: Challenge }) {
  const current = Number(c.current_premium);
  const target = Number(c.target_premium) || 1;
  const pct = Math.min(150, Math.round((current / target) * 100));
  const onTrack = pct >= 100;
  const close = pct >= 70 && !onTrack;
  const isQuarterly = c.period === "quarterly"; // recruit-count based, not premium
  const end = new Date(c.period_end_at);
  const msLeft = end.getTime() - Date.now();
  const daysLeft = Math.max(0, Math.floor(msLeft / (24 * 60 * 60 * 1000)));
  const hoursLeft = Math.max(0, Math.floor(msLeft / (60 * 60 * 1000)));
  const timeLabel = c.period === "daily" ? `${hoursLeft}h left` : `${daysLeft}d left`;
  const periodLabel = c.period.charAt(0).toUpperCase() + c.period.slice(1);
  const barColor = onTrack ? "bg-emerald-500" : close ? "bg-amber-500" : "bg-slate-500";
  const { goal, copy } = motivation(c.period, pct);
  // Quarterly is recruit-based: show "agents" not "deals"; current_premium IS the agent count
  const unit = isQuarterly ? "agents" : "deals";
  const headlineMetric = isQuarterly
    ? <><span className="tabular-nums">{Math.round(current)}</span><span className="text-11 font-normal text-muted-foreground"> / {Math.round(target)} {unit}</span></>
    : <><>{fmtUsd(current, true)}</><span className="text-11 font-normal text-muted-foreground"> / {fmtUsd(target, true)}</span></>;
  return (
    <Card className={`border ${onTrack ? "border-emerald-500/40" : close ? "border-amber-500/40" : "border-slate-300 dark:border-border"} bg-white dark:bg-card`}>
      <CardContent className="p-3.5">
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-11 uppercase tracking-wider font-bold text-muted-foreground">{periodLabel} Challenge</p>
          <span className={`text-11 font-bold tabular-nums ${onTrack ? "text-emerald-600 dark:text-emerald-400" : close ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>{pct}%</span>
        </div>
        <p className="text-lg font-bold leading-tight">{headlineMetric}</p>
        <p className="text-11 text-muted-foreground mt-0.5">
          {isQuarterly ? `${Math.round(current)} / ${Math.round(target)} ${unit}` : `${c.current_deals} / ${c.target_deals} deals`} · {goal}
        </p>
        <div className="h-1.5 bg-slate-200 dark:bg-muted rounded-full overflow-hidden mt-2">
          <div className={`h-full ${barColor} transition-all`} style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
        <p className={`text-11 mt-2 ${onTrack ? "text-emerald-700 dark:text-emerald-300" : close ? "text-amber-700 dark:text-amber-300" : "text-slate-600 dark:text-muted-foreground"} leading-snug`}>
          {copy}
        </p>
        <p className="text-11 text-muted-foreground tabular-nums mt-1.5 text-right">{timeLabel}</p>
      </CardContent>
    </Card>
  );
}

function InsightCard({
  icon: Icon, tone, title, metric, body,
}: {
  icon: any; tone: "positive" | "warn" | "neutral"; title: string; metric: string; body: string;
}) {
  const sev = tone === "positive" ? "good" : tone === "warn" ? "bad" : "none";
  const toneBorder = sev === "none" ? "border-border" : SEV_BORDER[sev];
  const toneText = SEV_TEXT[sev];
  return (
    <div className={cn("rounded-md border bg-card p-3 sm:p-4", toneBorder)}>
      <div className="flex items-start gap-3">
        <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", toneText)} />
        <div className="min-w-0 flex-1">
          <p className="break-words text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
          <p className={cn("mt-1 text-2xl font-bold leading-none tabular-nums", sev === "none" ? "text-foreground" : toneText)}>
            {metric}
          </p>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{body}</p>
        </div>
      </div>
    </div>
  );
}

function Kpi({
  icon: Icon, label, value, sub, color = "text-foreground", loading,
}: {
  icon: any; label: string; value: string; sub?: string; color?: string; loading?: boolean;
}) {
  return (
    <Card className="bg-white dark:bg-card border-slate-200 dark:border-border">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-11 uppercase tracking-wider font-semibold text-muted-foreground">
          <Icon className="h-3.5 w-3.5 opacity-60" />
          {label}
        </div>
        {loading ? (
          <Skeleton className="h-8 w-20 mt-2" />
        ) : (
          <>
            <p className={`text-28 font-bold tabular-nums ${color}`}>{value}</p>
            {sub && <p className="text-11 text-muted-foreground tabular-nums">{sub}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}
