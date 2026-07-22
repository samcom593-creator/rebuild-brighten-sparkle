// BusinessAnalytics — mirrors agentlink.insuracloud.ai/business-analytics
//
// Layout (matched against AgentLink screenshot at biz.png 2026-06-12):
//   1. Header: title + "Last 30 days" badge + AI Insights button + Refresh
//   2. 4-tile KPI strip: Total Deals · Total Premium · Active Producers · Avg Deal Size
//   3. 2-up stat band: Conversion Rate + Monthly Growth
//   4. Carrier Performance list (sorted by premium desc)
//
// Data sources (our internal views, since agentlink v1 /business-analytics
// returns HTTP 500 on their side — see master prompt 121):
//   - v_business_analytics_summary
//   - v_business_analytics_carriers
//
// When the AgentLink /api/v1/business-analytics endpoint stops 500-ing,
// swap the queries below to call the AgentLink API instead. Same shape.

import { useQuery } from "@tanstack/react-query";
import { DollarSign, Trophy, Users, Target, TrendingUp, RefreshCw, Sparkles, Flame, AlertTriangle, Brain, UserX, Lightbulb, GraduationCap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";

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
    refetchInterval: 5 * 60_000,
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
    refetchInterval: 5 * 60_000,
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
    refetchInterval: 5 * 60_000,
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
    refetchInterval: 5 * 60_000,
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
    refetchInterval: 5 * 60_000,
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
    refetchInterval: 10 * 60_000,
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
    refetchInterval: 10 * 60_000,
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
    refetchInterval: 10 * 60_000,
  });

  const s = summary.data;
  const growth = Number(s?.growth_pct_mom ?? 0);
  const growthPositive = growth >= 0;
  const totalPremium = Number(s?.total_premium_mtd ?? 0);

  return (
    <div className="page-enter px-4 sm:px-6 pb-24 space-y-5">
      <PageHeader
        eyebrow="Analytics"
        eyebrowIcon={<TrendingUp className="h-3 w-3" />}
        title="Business Analytics"
        subtitle="Track this team's performance and business growth. Mirrors AgentLink's business-analytics page."
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="text-11">Last 30 days</Badge>
            {/* WAVE FINAL · AI Insights jump-to-section button · mirrors AgentLink's
                top-right "AI Insights" header button. Scrolls to the AI section. */}
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => {
                const el = document.querySelector("[data-section='ai-insights']");
                el?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              <Sparkles className="h-3.5 w-3.5 text-amber-500" />
              AI Insights
            </Button>
            <Button variant="outline" size="sm" onClick={() => {
              summary.refetch(); carriers.refetch(); insights.refetch();
              challenges.refetch(); trophy.refetch(); needsAttention.refetch();
              learnFrom.refetch(); inactive.refetch();
            }}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${summary.isFetching || carriers.isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        }
      />

      {/* WAVE v6 §31 · CANONICAL AMBER HERO · single source of truth for
          Business Analytics top-of-page. Replaces the previous 4-tile sales
          challenge grid + Trophy Cabinet banner ("kinda duplicate" per Sam).
          4 hero metrics: Trophy wins · Active challenges · Needs-Attention ·
          Learn-From. 3-lane challenge strip below: Daily / Weekly / Monthly
          (rose if not started · amber if in progress · emerald if complete).
          All LIVE via useQuery. */}
      {(summary.isLoading || trophy.isLoading || challenges.isLoading) ? (
        <Skeleton className="h-64 w-full rounded-3xl" />
      ) : (
        <div className="rounded-3xl border border-amber-500/25 bg-gradient-to-br from-slate-950 via-slate-900 to-amber-950 text-white shadow-[0_0_64px_-12px_hsl(168_70%_45%/0.35)] overflow-hidden relative">
          <div className="absolute -top-32 -right-32 h-80 w-80 rounded-full bg-emerald-500/20 blur-3xl pointer-events-none" />
          <div className="absolute -bottom-40 -left-32 h-96 w-96 rounded-full bg-amber-500/15 blur-3xl pointer-events-none" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_50%,hsl(168_70%_45%/0.06),transparent_60%)] pointer-events-none" />

          <div className="relative p-6 sm:p-7">
            {/* LIVE indicator row */}
            <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                </span>
                <p className="text-[11px] uppercase tracking-[0.32em] font-bold text-emerald-300">BUSINESS ANALYTICS · LIVE</p>
              </div>
              <div className="flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-amber-300" />
                <p className="text-[11px] uppercase tracking-widest font-bold text-amber-300">
                  AI · Personalized per producer
                </p>
              </div>
            </div>

            {/* 4 hero metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-5 sm:gap-6 mb-5">
              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Trophy className="h-3 w-3 text-amber-300" />
                  <p className="text-[10px] uppercase tracking-widest text-white/50 font-bold">TROPHY WINS</p>
                </div>
                <p className="text-[32px] sm:text-[40px] leading-none font-black tabular-nums text-white">
                  {fmtNum(tc?.total_wins ?? 0)}
                </p>
                <p className="text-[10px] text-white/50 mt-1 tabular-nums">
                  {fmtNum(tc?.daily_wins ?? 0)}D · {fmtNum(tc?.weekly_wins ?? 0)}W · {fmtNum(tc?.monthly_wins ?? 0)}M · {fmtNum(tc?.quarterly_wins ?? 0)}Q
                </p>
              </div>

              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Target className="h-3 w-3 text-emerald-300" />
                  <p className="text-[10px] uppercase tracking-widest text-white/50 font-bold">ACTIVE CHALLENGES</p>
                </div>
                <p className="text-[32px] sm:text-[40px] leading-none font-black tabular-nums text-emerald-300">
                  {fmtNum(challenges.data?.length ?? 0)}
                </p>
                <p className="text-[10px] text-white/50 mt-1 tabular-nums">
                  {ins ? `${ins.streak_days}/${ins.days_in_month_elapsed} day streak` : "auto-targeted"}
                </p>
              </div>

              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <AlertTriangle className="h-3 w-3 text-rose-300" />
                  <p className="text-[10px] uppercase tracking-widest text-white/50 font-bold">NEEDS ATTENTION</p>
                </div>
                <p className="text-[32px] sm:text-[40px] leading-none font-black tabular-nums text-rose-300">
                  {fmtNum(needsAttention.data?.length ?? 0)}
                </p>
                <p className="text-[10px] text-white/50 mt-1 tabular-nums">
                  {(needsAttention.data?.length ?? 0) > 0 ? "agents below team avg" : "Roster healthy"}
                </p>
              </div>

              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <GraduationCap className="h-3 w-3 text-amber-300" />
                  <p className="text-[10px] uppercase tracking-widest text-white/50 font-bold">LEARN FROM</p>
                </div>
                <p className="text-[32px] sm:text-[40px] leading-none font-black tabular-nums text-amber-300">
                  {fmtNum(learnFrom.data?.length ?? 0)}
                </p>
                <p className="text-[10px] text-white/50 mt-1 tabular-nums">
                  {(learnFrom.data?.length ?? 0) > 0 ? "top performers · share playbook" : "Coach to exam"}
                </p>
              </div>
            </div>

            {/* Inner glass band · MTD totals */}
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-4 mb-5 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">MTD PREMIUM</p>
                <p className="text-[22px] leading-none font-bold tabular-nums text-emerald-300">
                  {fmtUsd(totalPremium, true)}
                </p>
                <p className="text-[10px] text-white/40 tabular-nums">{fmtUsd(totalPremium)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">DEALS MTD</p>
                <p className="text-[22px] leading-none font-bold tabular-nums text-white">
                  {fmtNum(s?.total_deals_mtd)}
                </p>
                <p className="text-[10px] text-white/40 tabular-nums">avg {fmtUsd(Number(s?.avg_deal_size ?? 0))}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">PRODUCERS · 30d</p>
                <p className="text-[22px] leading-none font-bold tabular-nums text-amber-300">
                  {fmtNum(s?.active_producers_30d)}
                </p>
                <p className="text-[10px] text-white/40 tabular-nums">active</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">MoM GROWTH</p>
                <p className={`text-[22px] leading-none font-bold tabular-nums ${growthPositive ? "text-emerald-300" : "text-rose-300"}`}>
                  {growthPositive ? "+" : ""}{growth}%
                </p>
                <p className="text-[10px] text-white/40 tabular-nums">
                  vs {fmtUsd(Number(s?.premium_last_month ?? 0), true)}
                </p>
              </div>
            </div>

            {/* 3-LANE CHALLENGE STRIP · Daily / Weekly / Monthly with status tones */}
            <div className="grid gap-3 sm:grid-cols-3">
              {(["daily", "weekly", "monthly"] as const).map((period) => {
                const c = challenges.data?.find((x) => x.period === period);
                const cur = Number(c?.current_premium ?? 0);
                const tgt = Number(c?.target_premium ?? 0) || 1;
                const pct = c ? Math.min(150, Math.round((cur / tgt) * 100)) : 0;
                // rose if not started · amber if in progress · emerald if complete
                const complete = pct >= 100;
                const inProgress = pct > 0 && pct < 100;
                const tone = complete ? "emerald" : inProgress ? "amber" : "rose";
                const toneClass =
                  tone === "emerald"
                    ? "border-emerald-400/40 bg-emerald-500/[0.08]"
                    : tone === "amber"
                    ? "border-amber-400/40 bg-amber-500/[0.08]"
                    : "border-rose-400/40 bg-rose-500/[0.08]";
                const dotClass =
                  tone === "emerald" ? "bg-emerald-400" : tone === "amber" ? "bg-amber-400" : "bg-rose-400";
                const textClass =
                  tone === "emerald" ? "text-emerald-300" : tone === "amber" ? "text-amber-300" : "text-rose-300";
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
                    className={`relative rounded-2xl border ${toneClass} p-4 transition-all`}
                  >
                    {tone === "rose" && (
                      <span className="absolute top-3 right-3 flex h-2 w-2">
                        <span className="absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75 animate-ping" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-500" />
                      </span>
                    )}
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
                      <p className="text-[10px] uppercase tracking-widest font-bold text-white/60">
                        {label} Challenge
                      </p>
                    </div>
                    <p className={`text-[22px] leading-none font-black tabular-nums ${textClass}`}>
                      {c ? fmtUsd(cur, true) : "—"}
                      <span className="text-[11px] font-normal text-white/40 ml-1">
                        / {c ? fmtUsd(tgt, true) : "—"}
                      </span>
                    </p>
                    <div className="h-1.5 bg-white/10 rounded-full overflow-hidden mt-2.5">
                      <div
                        className={`h-full transition-all ${
                          tone === "emerald" ? "bg-emerald-400" : tone === "amber" ? "bg-amber-400" : "bg-rose-400"
                        }`}
                        style={{ width: `${Math.min(100, pct)}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <p className={`text-[10px] uppercase tracking-widest font-bold ${textClass}`}>
                        {status} · {pct}%
                      </p>
                      <p className="text-[10px] text-white/40 tabular-nums">
                        {c ? `${c.current_deals}/${c.target_deals} deals` : "—"}
                      </p>
                    </div>
                    <p className="text-[11px] text-white/60 mt-2 leading-snug">{coaching}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 2026-06-15 zero-substance cull: removed the dead tab strip.
          Business Analytics now shows only live data-backed sections. */}
      <div className="space-y-5">
        {/* WAVE FINAL · AI-Powered Insights · PERSONALIZED with named agents.
            Mirrors AgentLink's actual insight card layout: "<Agent Name> Needs
            Attention · $X potential · Action: <verb>". Backed by 3 SQL views
            shipped 2026-06-13. Falls back to formula insights if no agents need
            attention (healthy roster). */}
        <div data-section="ai-insights">
          <div className="flex items-baseline justify-between mb-2 px-0.5">
            <h2 className="text-12 uppercase tracking-wider font-bold text-foreground flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-amber-500" />
              AI-Powered Insights
            </h2>
            <span className="text-11 text-muted-foreground">live · personalized per producer</span>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
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
            {/* Fill remainder with the original 3 formula insights so the row is always full */}
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
        </div>

        {/* WAVE FINAL · LEARN FROM cards · top-3 performers above team avg.
            Mirrors AgentLink's "Learn from <agent> · X% above average · Action".
            v_agents_learn_from filters to >150% team avg. */}
        {(learnFrom.data?.length ?? 0) > 0 && (
          <div>
            <div className="flex items-baseline justify-between mb-2 px-0.5">
              <h2 className="text-12 uppercase tracking-wider font-bold text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
                <GraduationCap className="h-3.5 w-3.5" />
                Learn from
              </h2>
              <span className="text-11 text-muted-foreground">top performers · share their playbook</span>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {learnFrom.data!.map((agent) => (
                <Card key={`lf-${agent.user_id}`} className="border-emerald-500/30 bg-emerald-50 dark:bg-emerald-900/10 border-2">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <Lightbulb className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-13 font-bold truncate">{agent.display_name}</p>
                        <p className="text-22 font-bold tabular-nums mt-0.5 text-emerald-600 dark:text-emerald-400">+{agent.pct_above_avg}%</p>
                        <p className="text-12 text-foreground/80 mt-1.5 leading-snug">
                          Above team average · {agent.deals_30d} deals · {fmtUsd(Number(agent.premium_30d))} in 30d.
                          Schedule a team best-practices session with them.
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* WAVE FINAL · INACTIVE AGENTS · count + sample names · mirrors
            AgentLink's "138 Agents Inactive" callout. */}
        {inactive.data && Number(inactive.data.inactive_count) > 0 && (
          <Card className="border-slate-300 dark:border-slate-700">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <UserX className="h-5 w-5 text-slate-500 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-22 font-bold tabular-nums">{inactive.data.inactive_count}</span>
                    <span className="text-13 text-muted-foreground">Licensed agents inactive 30d</span>
                  </div>
                  {inactive.data.sample_names && inactive.data.sample_names.length > 0 && (
                    <p className="text-12 text-muted-foreground mt-1.5 leading-relaxed">
                      {inactive.data.sample_names.slice(0, 10).join(" · ")}
                      {Number(inactive.data.inactive_count) > 10 && ` · +${Number(inactive.data.inactive_count) - 10} more`}
                    </p>
                  )}
                  <p className="text-11 text-amber-700 dark:text-amber-300 mt-2 font-semibold">
                    Action: bulk re-engagement campaign · 1-on-1 check-ins prioritized by tenure.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

      {/* 2-up stat band */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
          <CardContent className="p-5">
            <p className="text-11 uppercase tracking-wider font-semibold text-slate-500">Monthly Growth</p>
            {summary.isLoading ? (
              <Skeleton className="h-9 w-24 mt-2" />
            ) : (
              <div className="flex items-baseline gap-2 mt-1">
                <span className={`text-32 font-bold tabular-nums ${growthPositive ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                  {growthPositive ? "+" : ""}{growth}%
                </span>
                <span className="text-12 text-muted-foreground">vs last month</span>
              </div>
            )}
            <p className="text-11 text-slate-500 mt-1">
              Last month: {fmtUsd(Number(s?.premium_last_month ?? 0), true)}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
          <CardContent className="p-5">
            <p className="text-11 uppercase tracking-wider font-semibold text-slate-500">Avg Producer Output</p>
            {summary.isLoading ? (
              <Skeleton className="h-9 w-32 mt-2" />
            ) : (() => {
              const apc = Number(s?.active_producers_30d ?? 0);
              const per = apc > 0 ? totalPremium / apc : 0;
              return (
                <div className="mt-1">
                  <span className="text-32 font-bold tabular-nums">{fmtUsd(per, true)}</span>
                  <span className="text-12 text-muted-foreground ml-2">/ producer · 30d</span>
                </div>
              );
            })()}
            <p className="text-11 text-slate-500 mt-1">
              {fmtNum(s?.active_producers_30d)} producers wrote {fmtNum(s?.total_deals_mtd)} deals
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Carrier Performance · sorted by premium */}
      <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
        <CardContent className="p-5">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-base font-semibold flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amber-500" />
              Carrier Performance
            </h2>
            <span className="text-11 text-muted-foreground">Last 30 days</span>
          </div>

          {carriers.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (carriers.data?.length ?? 0) === 0 ? (
            <EmptyState
              icon={<Sparkles className="h-6 w-6" />}
              title="No carrier data in the last 30 days"
              description="Carrier rows appear here as deals land via the AgentLink sync. Check sync status if this stays empty."
            />
          ) : (
            <div className="space-y-1">
              {carriers.data!.map((c, i) => {
                const pct = totalPremium > 0 ? (Number(c.total_premium) / totalPremium) * 100 : 0;
                return (
                  <div
                    key={c.carrier_id}
                    className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-base"
                  >
                    <span className="text-11 text-muted-foreground tabular-nums w-5 text-right">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-13 font-semibold truncate">{c.carrier_name}</p>
                      <p className="text-11 text-muted-foreground">
                        {fmtNum(c.deal_count)} deals · avg {fmtUsd(Number(c.avg_deal_size))}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-13 font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                        {fmtUsd(Number(c.total_premium))}
                      </p>
                      <p className="text-11 text-muted-foreground tabular-nums">{pct.toFixed(1)}% share</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
      </div>
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
    <Card className={`border ${onTrack ? "border-emerald-500/40" : close ? "border-amber-500/40" : "border-slate-300 dark:border-slate-700"} bg-white dark:bg-slate-900`}>
      <CardContent className="p-3.5">
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-11 uppercase tracking-wider font-bold text-slate-500">{periodLabel} Challenge</p>
          <span className={`text-11 font-bold tabular-nums ${onTrack ? "text-emerald-600 dark:text-emerald-400" : close ? "text-amber-600 dark:text-amber-400" : "text-slate-500"}`}>{pct}%</span>
        </div>
        <p className="text-lg font-bold leading-tight">{headlineMetric}</p>
        <p className="text-11 text-muted-foreground mt-0.5">
          {isQuarterly ? `${Math.round(current)} / ${Math.round(target)} ${unit}` : `${c.current_deals} / ${c.target_deals} deals`} · {goal}
        </p>
        <div className="h-1.5 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden mt-2">
          <div className={`h-full ${barColor} transition-all`} style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
        <p className={`text-11 mt-2 ${onTrack ? "text-emerald-700 dark:text-emerald-300" : close ? "text-amber-700 dark:text-amber-300" : "text-slate-600 dark:text-slate-400"} leading-snug`}>
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
  const toneClass = tone === "positive"
    ? "border-emerald-500/30 bg-emerald-50 dark:bg-emerald-900/10"
    : tone === "warn"
    ? "border-rose-500/30 bg-rose-50 dark:bg-rose-900/10"
    : "border-border bg-card";
  const iconColor = tone === "positive"
    ? "text-emerald-600 dark:text-emerald-400"
    : tone === "warn"
    ? "text-rose-600 dark:text-rose-400"
    : "text-slate-500";
  return (
    <Card className={`${toneClass} border-2`}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <Icon className={`h-4 w-4 ${iconColor} shrink-0 mt-0.5`} />
          <div className="flex-1 min-w-0">
            <p className="text-11 uppercase tracking-wider font-semibold text-muted-foreground">{title}</p>
            <p className={`text-22 font-bold tabular-nums mt-0.5 ${iconColor}`}>{metric}</p>
            <p className="text-12 text-foreground/80 mt-1.5 leading-snug">{body}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Kpi({
  icon: Icon, label, value, sub, color = "text-foreground", loading,
}: {
  icon: any; label: string; value: string; sub?: string; color?: string; loading?: boolean;
}) {
  return (
    <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-11 uppercase tracking-wider font-semibold text-slate-500">
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
