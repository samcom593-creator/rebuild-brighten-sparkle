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
import { DollarSign, Trophy, Users, Target, TrendingUp, RefreshCw, Sparkles, Flame, AlertTriangle, Brain } from "lucide-react";
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
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-11">Last 30 days</Badge>
            <Button variant="outline" size="sm" onClick={() => { summary.refetch(); carriers.refetch(); }}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${summary.isFetching || carriers.isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        }
      />

      {/* v26 Trophy Cabinet · mirrors AgentLink's yellow streak banner.
          Shows the consecutive-day deal streak this month + MTD numbers.
          When streak = days_in_month_elapsed, the team has written a deal
          EVERY DAY this month — gold treatment. */}
      {insights.isLoading ? (
        <Skeleton className="h-16 w-full rounded-md" />
      ) : ins ? (
        <div className={`rounded-md border-2 p-4 ${
          Number(ins.streak_days) >= Number(ins.days_in_month_elapsed) - 1
            ? "border-amber-400 bg-gradient-to-r from-amber-500/15 via-amber-400/10 to-amber-500/15 dark:from-amber-500/20 dark:to-amber-500/20"
            : "border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
        }`}>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-2xl">🏆</span>
            <div className="flex-1 min-w-0">
              <p className="text-11 uppercase tracking-wider font-bold text-amber-700 dark:text-amber-300">Trophy Cabinet</p>
              <p className="text-15 font-bold text-foreground">
                <span className="tabular-nums">{ins.streak_days}</span>
                <span className="text-muted-foreground"> / </span>
                <span className="tabular-nums">{ins.days_in_month_elapsed}</span>
                <span className="text-13 font-normal text-muted-foreground"> days with a deal this month</span>
                {Number(ins.streak_days) >= Number(ins.days_in_month_elapsed) - 1 && (
                  <span className="ml-2 text-amber-600 dark:text-amber-400 font-bold">· PERFECT</span>
                )}
              </p>
            </div>
            <div className="text-right">
              <p className="text-11 uppercase tracking-wider font-semibold text-slate-500">MTD Premium</p>
              <p className="text-base font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{fmtUsd(Number(ins.team_premium_30d), true)}</p>
            </div>
          </div>
        </div>
      ) : null}

      {/* v26 AI-Powered Insights · 3 formula-driven insight cards.
          Each card shows a data-derived "what to do" prompt that mirrors
          AgentLink's AI Insights panel. Updated live from v_business_analytics_insights. */}
      {ins && (
        <div className="grid gap-3 md:grid-cols-3">
          <InsightCard
            icon={Flame}
            tone={Number(ins.top_carrier_share_pct) >= 50 ? "warn" : "neutral"}
            title="Carrier concentration"
            metric={`${ins.top_carrier_share_pct}%`}
            body={`${ins.top_carrier_name ?? "Top carrier"} carries ${ins.top_carrier_share_pct}% of your team's premium (${ins.top_carrier_deals} deals · 30d).${
              Number(ins.top_carrier_share_pct) >= 50
                ? " Diversify before this becomes a single-point failure."
                : " Healthy spread across multiple carriers."
            }`}
          />
          <InsightCard
            icon={AlertTriangle}
            tone={Number(ins.top3_producer_share_pct) >= 50 ? "warn" : "neutral"}
            title="Producer concentration"
            metric={`${ins.top3_producer_share_pct}%`}
            body={`Top 3 producers wrote ${ins.top3_producer_share_pct}% of team premium across ${ins.team_producers} active producers.${
              Number(ins.top3_producer_share_pct) >= 50
                ? " Coach the bottom 75% to close the gap."
                : " Production is distributed — keep the bench warm."
            }`}
          />
          <InsightCard
            icon={Brain}
            tone="positive"
            title="Team rhythm"
            metric={`${ins.team_deals_30d}`}
            body={`Team wrote ${ins.team_deals_30d} deals in 30 days · avg ${fmtUsd(Number(ins.team_premium_30d) / Math.max(1, Number(ins.team_deals_30d)))} per policy. ${
              Number(ins.team_producers) > 0
                ? `Each producer averaged ${Math.round(Number(ins.team_deals_30d) / Number(ins.team_producers))} deals this month.`
                : ""
            }`}
          />
        </div>
      )}

      {/* 4-KPI tile row */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          icon={Trophy}
          label="Total Deals · MTD"
          value={fmtNum(s?.total_deals_mtd)}
          loading={summary.isLoading}
        />
        <Kpi
          icon={DollarSign}
          label="Total Premium · MTD"
          value={fmtUsd(totalPremium, true)}
          sub={fmtUsd(totalPremium)}
          loading={summary.isLoading}
          color="text-emerald-600 dark:text-emerald-400"
        />
        <Kpi
          icon={Users}
          label="Active Producers · 30d"
          value={fmtNum(s?.active_producers_30d)}
          loading={summary.isLoading}
        />
        <Kpi
          icon={Target}
          label="Avg Deal Size"
          value={fmtUsd(Number(s?.avg_deal_size ?? 0))}
          loading={summary.isLoading}
        />
      </div>

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
