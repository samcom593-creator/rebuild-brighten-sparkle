// ForecastCard — "at current pace you'll hit $X this month."
// Linear projection from MTD deals (status submitted/active by effective_date).
// Migrated off daily_production.aop on 2026-04-27 — that column drifts
// +$345k vs deals truth on 30d windows, inflating month-end projections.

import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { TrendingUp, TrendingDown, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

function fmt$(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${Math.round(n)}`;
}

type Forecast = {
  mtd: number;
  projection: number;
  lastMonthSameDays: number;
  delta: number;
  daysIn: number;
  daysOfMonth: number;
  confidence: "low" | "medium" | "high";
};

async function fetchForecast(): Promise<Forecast> {
  const now = new Date();
  const daysIn = now.getDate();
  const daysOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);

  // Last month, same number of days
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);
  const lastMonthSameDayEnd = new Date(now.getFullYear(), now.getMonth() - 1, daysIn).toISOString().slice(0, 10);

  const [mtdRes, lastRes] = await Promise.all([
    supabase.from("deals").select("annual_premium,effective_date").gte("effective_date", monthStart).in("status", ["submitted", "active"]),
    supabase.from("deals").select("annual_premium").gte("effective_date", lastMonthStart).lte("effective_date", lastMonthSameDayEnd).in("status", ["submitted", "active"]),
  ]);

  const mtdRows = mtdRes.data ?? [];
  const mtd = mtdRows.reduce((s: number, r: any) => s + Number(r.annual_premium ?? 0), 0);
  const lastMonthSameDays = (lastRes.data ?? []).reduce((s: number, r: any) => s + Number(r.annual_premium ?? 0), 0);

  // Guardrails: count distinct days with non-zero production for confidence,
  // and require >= 3 active days before extrapolating month-end. Also clamp
  // projection at 5x MTD so a single big day on day-1 doesn't yield $4M.
  const activeDaySet = new Set<string>();
  for (const r of mtdRows as any[]) if (Number(r.annual_premium) > 0 && r.effective_date) activeDaySet.add(String(r.effective_date).slice(0, 10));
  const activeDays = activeDaySet.size;
  const confidence: "low" | "medium" | "high" =
    activeDays >= 10 ? "high" : activeDays >= 5 ? "medium" : "low";

  const rawProjection = daysIn > 0 ? (mtd / daysIn) * daysOfMonth : 0;
  // Cap projection at 5x MTD to neutralize single-day spikes when daysIn is small
  const cappedProjection = activeDays >= 3 ? Math.min(rawProjection, mtd * 5) : mtd;
  const projection = Math.max(0, cappedProjection);

  const delta = lastMonthSameDays > 0 ? ((mtd - lastMonthSameDays) / lastMonthSameDays) * 100 : (mtd > 0 ? 100 : 0);

  return { mtd, projection, lastMonthSameDays, delta, daysIn, daysOfMonth, confidence };
}

export function ForecastCard() {
  const { data } = useQuery({
    queryKey: ["apex-forecast"],
    queryFn: fetchForecast,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
  });

  if (!data) return null;
  const up = data.delta >= 0;
  const TrendIcon = up ? TrendingUp : TrendingDown;
  const tint = up ? "#10b981" : "#ef4444";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1, duration: 0.35 }}
      className="rounded-xl border bg-gradient-to-br from-background via-background to-muted/40 p-5 mb-5 relative overflow-hidden"
    >
      <motion.div
        animate={{ opacity: [0.2, 0.4, 0.2] }}
        transition={{ duration: 3, repeat: Infinity }}
        className="absolute -top-16 -right-16 w-48 h-48 rounded-full pointer-events-none"
        style={{ background: `radial-gradient(circle, ${tint}33, transparent 70%)` }}
      />

      <div className="flex items-start justify-between gap-4 relative">
        <div>
          <div className="flex items-center gap-2 text-[10px] tracking-[0.2em] uppercase text-muted-foreground font-bold">
            <Zap className="w-3.5 h-3.5" />
            Month-end forecast
          </div>
          <motion.div
            key={data.projection}
            initial={{ y: -4, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="text-3xl font-bold mt-1 tabular-nums"
            style={{ color: tint }}
          >
            {fmt$(data.projection)}
          </motion.div>
          <div className="text-sm text-muted-foreground mt-1">
            <span className="font-semibold text-foreground">{fmt$(data.mtd)}</span> MTD · day {data.daysIn}/{data.daysOfMonth} · {data.confidence} confidence
          </div>
        </div>

        <div className="text-right">
          <div className="inline-flex items-center gap-1 text-sm font-semibold" style={{ color: tint }}>
            <TrendIcon className="w-4 h-4" />
            {up ? "+" : ""}{data.delta.toFixed(0)}%
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            vs last month<br />same days
          </div>
        </div>
      </div>
    </motion.div>
  );
}
