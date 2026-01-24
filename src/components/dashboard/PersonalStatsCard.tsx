import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { TrendingUp, TrendingDown, Target, Trophy, Zap, Award } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { supabase } from "@/integrations/supabase/client";
import { AnimatedNumber } from "./AnimatedNumber";
import { cn } from "@/lib/utils";

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

export function PersonalStatsCard({ agentId, todayProduction }: PersonalStatsCardProps) {
  const [agencyStats, setAgencyStats] = useState<AgencyStats | null>(null);
  const [personalBest, setPersonalBest] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, [agentId]);

  const fetchStats = async () => {
    try {
      const today = new Date().toISOString().split("T")[0];
      
      // Get all production for today (agency-wide)
      const { data: allProduction } = await supabase
        .from("daily_production")
        .select("closing_rate, presentations, aop")
        .eq("production_date", today);

      if (allProduction && allProduction.length > 0) {
        const totalAgents = allProduction.length;
        const avgClosingRate = allProduction.reduce((sum, p) => sum + Number(p.closing_rate || 0), 0) / totalAgents;
        const avgPresentations = allProduction.reduce((sum, p) => sum + Number(p.presentations || 0), 0) / totalAgents;
        const avgAlp = allProduction.reduce((sum, p) => sum + Number(p.aop || 0), 0) / totalAgents;

        setAgencyStats({ avgClosingRate, avgPresentations, avgAlp, totalAgents });
      }

      // Get personal best ALP
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
  };

  const myClosingRate = Number(todayProduction?.closing_rate || 0);
  const myPresentations = Number(todayProduction?.presentations || 0);
  const myAlp = Number(todayProduction?.aop || 0);
  const myDeals = Number(todayProduction?.deals_closed || 0);

  const isAboveAvgClosing = agencyStats && myClosingRate > agencyStats.avgClosingRate;
  const isAboveAvgPresentations = agencyStats && myPresentations > agencyStats.avgPresentations;
  const isPersonalBest = myAlp > 0 && myAlp >= personalBest;
  const closingDiff = agencyStats ? (myClosingRate - agencyStats.avgClosingRate).toFixed(0) : 0;

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
      label: "Today's ALP",
      value: myAlp,
      formatAsCurrency: true,
      icon: Award,
      isPersonalBest,
    },
  ];

  if (loading) {
    return (
      <GlassCard className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-muted rounded w-1/3" />
          <div className="grid grid-cols-2 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 bg-muted/50 rounded" />
            ))}
          </div>
        </div>
      </GlassCard>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
    >
      <GlassCard className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold gradient-text">Your Performance</h3>
          {isPersonalBest && myAlp > 0 && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="px-3 py-1 bg-amber-500/20 text-amber-500 rounded-full text-xs font-bold flex items-center gap-1"
            >
              <Trophy className="h-3 w-3" />
              Personal Best!
            </motion.span>
          )}
        </div>

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

        {/* Agency Wide Summary */}
        {agencyStats && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="mt-4 pt-4 border-t border-border/50"
          >
            <p className="text-xs text-muted-foreground text-center">
              Agency Today: <span className="font-medium text-foreground">{agencyStats.totalAgents}</span> agents active • 
              Avg Close Rate: <span className={cn("font-medium", isAboveAvgClosing ? "text-emerald-500" : "text-foreground")}>{agencyStats.avgClosingRate.toFixed(0)}%</span> • 
              Avg ALP: <span className="font-medium text-foreground">${agencyStats.avgAlp.toLocaleString()}</span>
            </p>
          </motion.div>
        )}
      </GlassCard>
    </motion.div>
  );
}
