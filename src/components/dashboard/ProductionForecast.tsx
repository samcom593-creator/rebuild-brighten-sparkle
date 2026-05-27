import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { TrendingDown, TrendingUp, Minus } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { countDistinctBusinessDays, projectMonthEndAlp, sumAnnualPremium } from "@/lib/metricTruth";
import { getBusinessMonthBounds } from "@/lib/dateUtils";
import { DEAL_TRUTH_STATUS_FILTER } from "@/lib/dealTruth";

interface ProductionForecastProps {
  agentId: string;
}

export function ProductionForecast({ agentId }: ProductionForecastProps) {
  const { data: production } = useQuery({
    queryKey: ["production-forecast-agent", agentId],
    queryFn: async () => {
      const monthBounds = getBusinessMonthBounds();
      const [dealsRes, presRes] = await Promise.all([
        supabase
          .from("deals")
          .select("posted_at, annual_premium")
          .eq("agent_id", agentId)
          .gte("posted_at", monthBounds.startIso)
          .lt("posted_at", monthBounds.endIso)
          .in("status", DEAL_TRUTH_STATUS_FILTER),
        supabase
          .from("daily_production")
          .select("presentations")
          .eq("agent_id", agentId)
          .gte("production_date", monthBounds.startIso.slice(0, 10))
          .lte("production_date", monthBounds.endIso.slice(0, 10)),
      ]);

      const dealRows = (dealsRes.data ?? []) as Array<{ posted_at?: string | null; annual_premium?: number | null }>;
      const totalAlp = sumAnnualPremium(dealRows);
      const activeDays = countDistinctBusinessDays(dealRows);
      const projection = projectMonthEndAlp(totalAlp, activeDays);
      const presentations = (presRes.data ?? []).reduce((sum, row: { presentations?: number | null }) => sum + Number(row.presentations ?? 0), 0);

      return {
        totalAlp,
        activeDays,
        projection,
        deals: dealRows.length,
        presentations,
      };
    },
    staleTime: 120_000,
    refetchInterval: 120_000,
  });

  const trend = useMemo(() => {
    if (!production) return "flat" as const;
    if (production.projection.projection > production.totalAlp) return "up" as const;
    if (production.projection.projection < production.totalAlp) return "down" as const;
    return "flat" as const;
  }, [production]);

  if (!production) return null;

  const TrendIcon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;
  const trendColor = trend === "up" ? "text-emerald-400" : trend === "down" ? "text-rose-400" : "text-muted-foreground";

  return (
    <GlassCard className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="flex items-center gap-2 text-sm font-semibold">
          <TrendingUp className="h-4 w-4 text-primary" />
          Month-end ALP forecast
        </h4>
        <Badge
          variant="outline"
          className={cn(
            "text-[10px]",
            production.projection.confidence === "high" ? "border-emerald-500/30 text-emerald-400" :
            production.projection.confidence === "medium" ? "border-amber-500/30 text-amber-400" :
            "text-muted-foreground"
          )}
        >
          {production.projection.confidence} confidence
        </Badge>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="text-center">
          <p className="text-[10px] text-muted-foreground">This Month</p>
          <p className="text-lg font-bold">${production.totalAlp.toLocaleString()}</p>
        </div>
        <div className="text-center">
          <p className="text-[10px] text-muted-foreground">Posted Sales Days</p>
          <p className="text-lg font-bold">{production.activeDays}</p>
        </div>
        <div className="text-center">
          <p className="text-[10px] text-muted-foreground">Projected Month</p>
          <div className="flex items-center justify-center gap-1">
            <p className="text-lg font-bold">${production.projection.projection.toLocaleString()}</p>
            <TrendIcon className={cn("h-4 w-4", trendColor)} />
          </div>
        </div>
      </div>

      <p className="mt-3 text-[11px] text-muted-foreground">
        {production.projection.activeDays < 3
          ? "Projection stays pinned to current MTD until at least 3 posted-sales days exist."
          : `${production.deals} deals written this month · ${production.presentations} presentations logged.`}
      </p>
    </GlassCard>
  );
}
