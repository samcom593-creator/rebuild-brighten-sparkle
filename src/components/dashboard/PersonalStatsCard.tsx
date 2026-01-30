import { useState, useEffect, useMemo, useCallback } from "react";
import { motion } from "framer-motion";
import { TrendingUp, TrendingDown, Target, Trophy, Zap, Award, Calendar } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { supabase } from "@/integrations/supabase/client";
import { AnimatedNumber } from "./AnimatedNumber";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DateRangePicker, type DateRange } from "@/components/ui/date-range-picker";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { getTodayPST, getWeekStartPST, getMonthStartPST } from "@/lib/dateUtils";
import { toZonedTime } from "date-fns-tz";

type TimePeriod = "day" | "week" | "month" | "custom";

interface PersonalStatsCardProps {
  agentId: string;
  todayProduction?: any;
}

interface AgencyStats {
  avgClosingRate: number;
  avgPresentations: number;
  avgAlp: number;
  totalAgents: number;
}

interface PeriodStats {
  closingRate: number;
  presentations: number;
  alp: number;
  deals: number;
}

export function PersonalStatsCard({ agentId, todayProduction }: PersonalStatsCardProps) {
  const [timePeriod, setTimePeriod] = useState<TimePeriod>("week");
  const [customDateRange, setCustomDateRange] = useState<DateRange>({ from: undefined, to: undefined });
  const [agencyStats, setAgencyStats] = useState<AgencyStats | null>(null);
  const [personalStats, setPersonalStats] = useState<PeriodStats | null>(null);
  const [personalBest, setPersonalBest] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  // Calculate date range based on selected period - using PST utilities
  const dateRange = useMemo(() => {
    const today = getTodayPST();
    switch (timePeriod) {
      case "day":
        return { start: today, end: today };
      case "week":
        return { start: getWeekStartPST(), end: today };
      case "month":
        return { start: getMonthStartPST(), end: today };
      case "custom":
        if (customDateRange.from && customDateRange.to) {
          return { start: format(customDateRange.from, "yyyy-MM-dd"), end: format(customDateRange.to, "yyyy-MM-dd") };
        }
        return { start: getMonthStartPST(), end: today };
      default:
        return { start: getWeekStartPST(), end: today };
    }
  }, [timePeriod, customDateRange]);

  const fetchStats = useCallback(async () => {
    try {
      setLoading(true);
      
      // Get all production for the period (agency-wide)
      const { data: allProduction } = await supabase
        .from("daily_production")
        .select("agent_id, closing_rate, presentations, aop, deals_closed")
        .gte("production_date", dateRange.start)
        .lte("production_date", dateRange.end);

      if (allProduction && allProduction.length > 0) {
        // Aggregate by agent for accurate averages
        const agentTotals = new Map<string, { closingRate: number; presentations: number; alp: number; deals: number; count: number }>();
        allProduction.forEach((p) => {
          const existing = agentTotals.get(p.agent_id) || { closingRate: 0, presentations: 0, alp: 0, deals: 0, count: 0 };
          agentTotals.set(p.agent_id, {
            closingRate: existing.closingRate + Number(p.closing_rate || 0),
            presentations: existing.presentations + Number(p.presentations || 0),
            alp: existing.alp + Number(p.aop || 0),
            deals: existing.deals + Number(p.deals_closed || 0),
            count: existing.count + 1,
          });
        });

        const totalAgents = agentTotals.size;
        let totalClosingRate = 0, totalPresentations = 0, totalAlp = 0;
        agentTotals.forEach((t) => {
          totalClosingRate += t.presentations > 0 ? (t.deals / t.presentations) * 100 : 0;
          totalPresentations += t.presentations;
          totalAlp += t.alp;
        });

        setAgencyStats({
          avgClosingRate: totalAgents > 0 ? totalClosingRate / totalAgents : 0,
          avgPresentations: totalAgents > 0 ? totalPresentations / totalAgents : 0,
          avgAlp: totalAgents > 0 ? totalAlp / totalAgents : 0,
          totalAgents,
        });

        // Get personal stats for the period
        const myData = agentTotals.get(agentId);
        if (myData) {
          setPersonalStats({
            closingRate: myData.presentations > 0 ? Math.round((myData.deals / myData.presentations) * 100) : 0,
            presentations: myData.presentations,
            alp: myData.alp,
            deals: myData.deals,
          });
        } else {
          setPersonalStats({ closingRate: 0, presentations: 0, alp: 0, deals: 0 });
        }
      } else {
        setAgencyStats(null);
        setPersonalStats({ closingRate: 0, presentations: 0, alp: 0, deals: 0 });
      }

      // Get personal best ALP (all-time)
      const { data: bestData } = await supabase
        .from("daily_production")
        .select("aop")
        .eq("agent_id", agentId)
        .order("aop", { ascending: false })
        .limit(1)
        .single();

      if (bestData) {
        setPersonalBest(Number(bestData.aop));
      }
    } catch (error) {
      console.error("Error fetching stats:", error);
    } finally {
      setLoading(false);
    }
  }, [agentId, dateRange]);

  // Initial fetch
  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // Real-time subscription for live updates
  useEffect(() => {
    const channel = supabase
      .channel("personal-stats-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "daily_production" },
        () => fetchStats()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchStats]);

  const myClosingRate = personalStats?.closingRate || 0;
  const myPresentations = personalStats?.presentations || 0;
  const myAlp = personalStats?.alp || 0;
  const myDeals = personalStats?.deals || 0;

  const isAboveAvgClosing = agencyStats && myClosingRate > agencyStats.avgClosingRate;
  const isAboveAvgPresentations = agencyStats && myPresentations > agencyStats.avgPresentations;
  const isPersonalBest = myAlp > 0 && myAlp >= personalBest;

  const periodLabels: Record<TimePeriod, string> = {
    day: "Today",
    week: "This Week",
    month: "This Month",
    custom: "Custom Range",
  };

  const stats = [
    {
      label: "Your Closing Rate",
      value: myClosingRate,
      suffix: "%",
      comparison: agencyStats?.avgClosingRate,
      comparisonLabel: "Agency Avg",
      isAbove: isAboveAvgClosing,
      icon: Target,
    },
    {
      label: "Presentations",
      value: myPresentations,
      comparison: agencyStats?.avgPresentations,
      comparisonLabel: "Agency Avg",
      isAbove: isAboveAvgPresentations,
      icon: Zap,
    },
    {
      label: "Deals Closed",
      value: myDeals,
      icon: Trophy,
      highlight: myDeals >= 3,
    },
    {
      label: `${periodLabels[timePeriod]} ALP`,
      value: myAlp,
      formatAsCurrency: true,
      icon: Award,
      isPersonalBest,
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
    >
      <GlassCard className="p-6">
        {/* Header with Time Period Selector */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold gradient-text">Your Performance</h3>
            {isPersonalBest && myAlp > 0 && (
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="px-2 py-0.5 bg-amber-500/20 text-amber-500 rounded-full text-xs font-bold flex items-center gap-1"
              >
                <Trophy className="h-3 w-3" />
                Best!
              </motion.span>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            <Tabs value={timePeriod} onValueChange={(v) => setTimePeriod(v as TimePeriod)} className="w-auto">
              <TabsList className="h-8">
                <TabsTrigger value="day" className="text-xs px-2 h-6">Day</TabsTrigger>
                <TabsTrigger value="week" className="text-xs px-2 h-6">Week</TabsTrigger>
                <TabsTrigger value="month" className="text-xs px-2 h-6">Month</TabsTrigger>
                <TabsTrigger value="custom" className="text-xs px-2 h-6 gap-1">
                  <Calendar className="h-3 w-3" />
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>

        {/* Custom Date Range Picker */}
        {timePeriod === "custom" && (
          <div className="mb-4">
            <DateRangePicker
              value={customDateRange}
              onChange={setCustomDateRange}
              simpleMode
              className="w-full"
            />
          </div>
        )}

        {/* Loading State */}
        {loading ? (
          <div className="grid grid-cols-2 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 bg-muted/50 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {stats.map((stat, index) => {
              const Icon = stat.icon;
              return (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: index * 0.1 }}
                  className={cn(
                    "relative p-4 rounded-xl border transition-all duration-300",
                    stat.isAbove || stat.highlight || stat.isPersonalBest
                      ? "bg-primary/5 border-primary/30"
                      : "bg-muted/30 border-border/50"
                )}
              >
                <div className="flex items-center gap-2 text-muted-foreground mb-2">
                  <Icon className="h-4 w-4" />
                  <span className="text-xs font-medium">{stat.label}</span>
                </div>
                
                <div className="flex items-end justify-between">
                  <div>
                    {stat.formatAsCurrency ? (
                      <AnimatedNumber
                        value={stat.value}
                        formatAsCurrency
                        className="text-2xl font-bold"
                      />
                    ) : (
                      <AnimatedNumber
                        value={stat.value}
                        suffix={stat.suffix}
                        className="text-2xl font-bold"
                      />
                    )}
                  </div>
                  
                  {stat.comparison !== undefined && (
                    <div className="text-right">
                      <div className={cn(
                        "flex items-center gap-1 text-xs font-medium",
                        stat.isAbove ? "text-emerald-500" : "text-muted-foreground"
                      )}>
                        {stat.isAbove ? (
                          <TrendingUp className="h-3 w-3" />
                        ) : (
                          <TrendingDown className="h-3 w-3 text-amber-500" />
                        )}
                        <span>
                          {stat.isAbove ? "+" : ""}{(stat.value - stat.comparison).toFixed(0)}
                          {stat.suffix}
                        </span>
                      </div>
                      <span className="text-[10px] text-muted-foreground">
                        vs {stat.comparison.toFixed(0)}{stat.suffix} avg
                      </span>
                    </div>
                  )}
                </div>
                  </motion.div>
                );
              })}
            </div>
          )}

          {/* Agency Wide Summary */}
          {agencyStats && !loading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="mt-4 pt-4 border-t border-border/50"
            >
              <p className="text-xs text-muted-foreground text-center">
                Agency {periodLabels[timePeriod]}: <span className="font-medium text-foreground">{agencyStats.totalAgents}</span> agents • 
                Avg Close: <span className={cn("font-medium", isAboveAvgClosing ? "text-emerald-500" : "text-foreground")}>{agencyStats.avgClosingRate.toFixed(0)}%</span> • 
                Avg ALP: <span className="font-medium text-foreground">${Math.round(agencyStats.avgAlp).toLocaleString()}</span>
              </p>
            </motion.div>
        )}
      </GlassCard>
    </motion.div>
  );
}
