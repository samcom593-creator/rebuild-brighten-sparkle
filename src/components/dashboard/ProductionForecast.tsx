import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { subDays, format } from "date-fns";
import { cn } from "@/lib/utils";

interface ProductionForecastProps {
  agentId: string;
}

export function ProductionForecast({ agentId: _agentId }: ProductionForecastProps) {
  const { data: production } = useQuery({
    queryKey: ["production-forecast-agency"],
    queryFn: async () => {
      const today = new Date();
      const historyStartDate = subDays(today, 29);
      const historyStart = format(historyStartDate, "yyyy-MM-dd");
      const todayStr = format(today, "yyyy-MM-dd");

      const { data } = await supabase
        .from("daily_production")
        .select("production_date, aop, deals_closed, presentations")
        .gte("production_date", historyStart)
        .lte("production_date", todayStr)
        .order("production_date", { ascending: true });

      // Aggregate all agents by date
      const byDate = new Map<string, { production_date: string; aop: number; deals_closed: number; presentations: number }>();
      (data || []).forEach((row) => {
        const existing = byDate.get(row.production_date);
        if (existing) {
          existing.aop += Number(row.aop || 0);
          existing.deals_closed += row.deals_closed || 0;
          existing.presentations += row.presentations || 0;
        } else {
          byDate.set(row.production_date, {
            production_date: row.production_date,
            aop: Number(row.aop || 0),
            deals_closed: row.deals_closed || 0,
            presentations: row.presentations || 0,
          });
        }
      });

      // Fill missing days with zeroes so 7d/30d math and regression are stable
      return Array.from({ length: 30 }, (_, i) => {
        const date = format(subDays(today, 29 - i), "yyyy-MM-dd");
        return byDate.get(date) || {
          production_date: date,
          aop: 0,
          deals_closed: 0,
          presentations: 0,
        };
      });
    },
    staleTime: 120_000,
  });

  const forecast = useMemo(() => {
    if (!production || production.length < 3) {
      return { projected: 0, trend: "flat" as const, confidence: "low", last7: 0, last30: 0 };
    }

    const last7 = production
      .slice(-7)
      .reduce((s, p) => s + Number(p.aop || 0), 0);

    const last30 = production.reduce((s, p) => s + Number(p.aop || 0), 0);

    // Count days with actual production (non-zero) for pace-based projection
    const activeDays = production.filter(p => Number(p.aop || 0) > 0).length;
    const dailyPace = activeDays > 0 ? last30 / activeDays : 0;
    
    // Use last 7 days pace if available (more recent = more accurate)
    const last7ActiveDays = production.slice(-7).filter(p => Number(p.aop || 0) > 0).length;
    const recentPace = last7ActiveDays > 0 ? last7 / last7ActiveDays : dailyPace;
    
    // Assume ~5 working days per week, 4.3 weeks per month ≈ 21.5 working days
    const workingDaysPerMonth = 22;
    const projected = Math.max(0, Math.round(recentPace * workingDaysPerMonth));

    // Trend based on comparing last 7d pace vs previous 7d pace
    const prev7 = production.slice(-14, -7).reduce((s, p) => s + Number(p.aop || 0), 0);
    const trend = last7 > prev7 * 1.1 ? "up" : last7 < prev7 * 0.9 ? "down" : "flat";
    const confidence = activeDays >= 14 ? "high" : activeDays >= 7 ? "medium" : "low";

    return { projected, trend, confidence, last7, last30 };
  }, [production]);

  const TrendIcon = forecast.trend === "up" ? TrendingUp : forecast.trend === "down" ? TrendingDown : Minus;
  const trendColor = forecast.trend === "up" ? "text-emerald-400" : forecast.trend === "down" ? "text-rose-400" : "text-muted-foreground";

  return (
    <GlassCard className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-semibold text-sm flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          30-Day AOP Forecast
        </h4>
        <Badge
          variant="outline"
          className={cn(
            "text-[10px]",
            forecast.confidence === "high" ? "text-emerald-400 border-emerald-500/30" :
            forecast.confidence === "medium" ? "text-amber-400 border-amber-500/30" :
            "text-muted-foreground"
          )}
        >
          {forecast.confidence} confidence
        </Badge>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="text-center">
          <p className="text-[10px] text-muted-foreground">Last 7 Days</p>
          <p className="text-lg font-bold">${forecast.last7.toLocaleString()}</p>
        </div>
        <div className="text-center">
          <p className="text-[10px] text-muted-foreground">Last 30 Days</p>
          <p className="text-lg font-bold">${forecast.last30.toLocaleString()}</p>
        </div>
        <div className="text-center">
          <p className="text-[10px] text-muted-foreground">Projected 30d</p>
          <div className="flex items-center justify-center gap-1">
            <p className="text-lg font-bold">${forecast.projected.toLocaleString()}</p>
            <TrendIcon className={cn("h-4 w-4", trendColor)} />
          </div>
        </div>
      </div>
    </GlassCard>
  );
}
