import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { TrendingDown, TrendingUp, Zap } from "lucide-react";
import { addDays, startOfMonth, subMonths } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { supabase } from "@/integrations/supabase/client";
import {
  BUSINESS_TIMEZONE,
  countDistinctBusinessDays,
  METRIC_REGISTRY,
  formatMetricSource,
  projectMonthEndAlp,
  sumAnnualPremium,
} from "@/lib/metricTruth";
import { getBusinessMonthBounds, getBusinessNow } from "@/lib/dateUtils";
import { DEAL_TRUTH_STATUS_FILTER, dealTruthWindowOr } from "@/lib/dealTruth";

function fmt$(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}

type Forecast = {
  mtd: number;
  projection: number;
  comparisonWindowAlp: number;
  delta: number;
  confidence: "low" | "medium" | "high";
  activeDays: number;
  elapsedCalendarDays: number;
  daysInMonth: number;
  lastUpdatedAt: string | null;
};

async function fetchForecast(): Promise<Forecast> {
  const monthBounds = getBusinessMonthBounds();
  const now = getBusinessNow();
  const comparisonMonthStart = startOfMonth(subMonths(now, 1));
  const comparisonMonthStartKey = formatInTimeZone(comparisonMonthStart, BUSINESS_TIMEZONE, "yyyy-MM-dd");
  const comparisonEndKey = formatInTimeZone(
    addDays(comparisonMonthStart, now.getDate()),
    BUSINESS_TIMEZONE,
    "yyyy-MM-dd",
  );
  const comparisonStart = fromZonedTime(`${comparisonMonthStartKey}T00:00:00`, BUSINESS_TIMEZONE);
  const comparisonEnd = fromZonedTime(`${comparisonEndKey}T00:00:00`, BUSINESS_TIMEZONE);

  const [mtdRes, comparisonRes, syncRes] = await Promise.all([
    supabase
      .from("deals")
      .select("annual_premium, posted_at, created_at")
      .or(dealTruthWindowOr(monthBounds.startIso, monthBounds.endIso))
      .in("status", DEAL_TRUTH_STATUS_FILTER),
    supabase
      .from("deals")
      .select("annual_premium, posted_at, created_at")
      .or(dealTruthWindowOr(comparisonStart.toISOString(), comparisonEnd.toISOString()))
      .in("status", DEAL_TRUTH_STATUS_FILTER),
    supabase
      .from("agentlink_sync_log" as any)
      .select("finished_at, started_at")
      .eq("status", "ok")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const mtdRows = (mtdRes.data ?? []) as Array<{ annual_premium?: number | null; posted_at?: string | null }>;
  const mtd = sumAnnualPremium(mtdRows);
  const comparisonWindowAlp = sumAnnualPremium((comparisonRes.data ?? []) as Array<{ annual_premium?: number | null }>);
  const activeDays = countDistinctBusinessDays(mtdRows);
  const projectionResult = projectMonthEndAlp(mtd, activeDays);
  const delta = comparisonWindowAlp > 0
    ? ((mtd - comparisonWindowAlp) / comparisonWindowAlp) * 100
    : (mtd > 0 ? 100 : 0);
  const syncRow = syncRes.data as { finished_at?: string | null; started_at?: string | null } | null;

  return {
    mtd,
    projection: projectionResult.projection,
    comparisonWindowAlp,
    delta,
    confidence: projectionResult.confidence,
    activeDays: projectionResult.activeDays,
    elapsedCalendarDays: projectionResult.elapsedCalendarDays,
    daysInMonth: projectionResult.daysInMonth,
    lastUpdatedAt: syncRow?.finished_at || syncRow?.started_at || null,
  };
}

export function ForecastCard() {
  const { data } = useQuery({
    queryKey: ["apex-forecast-truth"],
    queryFn: fetchForecast,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  if (!data) return null;

  const up = data.delta >= 0;
  const TrendIcon = up ? TrendingUp : TrendingDown;
  const tint = up ? "#10b981" : "#ef4444";
  const sourceHint = formatMetricSource(METRIC_REGISTRY.monthlyAlp, data.lastUpdatedAt);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1, duration: 0.35 }}
      className="relative mb-5 overflow-hidden rounded-xl border bg-gradient-to-br from-background via-background to-muted/40 p-5"
    >
      <motion.div
        animate={{ opacity: [0.2, 0.4, 0.2] }}
        transition={{ duration: 3, repeat: Infinity }}
        className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full"
        style={{ background: `radial-gradient(circle, ${tint}33, transparent 70%)` }}
      />

      <div className="relative flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
            <Zap className="h-3.5 w-3.5" />
            Month-end forecast
          </div>
          <motion.div
            key={data.projection}
            initial={{ y: -4, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="mt-1 text-3xl font-bold tabular-nums"
            style={{ color: tint }}
          >
            {fmt$(data.projection)}
          </motion.div>
          <div className="mt-1 text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">{fmt$(data.mtd)}</span> MTD · day {data.elapsedCalendarDays}/{data.daysInMonth} · {data.confidence} confidence
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {data.activeDays < 3
              ? "Projection is suppressed until at least 3 posted-sales days exist this month."
              : sourceHint}
          </p>
        </div>

        <div className="text-right">
          <div className="inline-flex items-center gap-1 text-sm font-semibold" style={{ color: tint }}>
            <TrendIcon className="h-4 w-4" />
            {up ? "+" : ""}{data.delta.toFixed(0)}%
          </div>
          <div className="mt-0.5 text-[10px] text-muted-foreground">
            vs last month
            <br />
            same pace window
          </div>
        </div>
      </div>
    </motion.div>
  );
}
