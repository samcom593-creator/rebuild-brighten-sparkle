// ForecastCard — "at current pace you'll hit $X this month."
// Simple linear projection from MTD daily_production.aop: (mtd / days_elapsed) * days_in_month.
// Compares against last month same-days-elapsed for a trend arrow.

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
    supabase.from("daily_production").select("aop").gte("production_date", monthStart),
    supabase.from("daily_production").select("aop").gte("production_date", lastMonthStart).lte("production_date", lastMonthSameDayEnd),
  ]);

  const mtd = (mtdRes.data ?? []).reduce((s: number, r: any) => s + Number(r.aop ?? 0), 0);
  const lastMonthSameDays = (lastRes.data ?? []).reduce((s: number, r: any) => s + Number(r.aop ?? 0), 0);
  const projection = daysIn > 0 ? (mtd / daysIn) * daysOfMonth : 0;
  const delta = lastMonthSameDays > 0 ? ((mtd - lastMonthSameDays) / lastMonthSameDays) * 100 : (mtd > 0 ? 100 : 0);

  return { mtd, projection, lastMonthSameDays, delta, daysIn, daysOfMonth };
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
            <span className="font-semibold text-foreground">{fmt$(data.mtd)}</span> MTD · day {data.daysIn}/{data.daysOfMonth} · pace projects to month-end
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
