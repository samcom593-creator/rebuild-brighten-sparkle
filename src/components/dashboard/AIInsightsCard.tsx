import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Sparkles, AlertTriangle, TrendingUp, Clock, RefreshCw } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface AgentStats {
  totalLeads: number;
  contacted: number;
  qualified: number;
  closed: number;
  closeRate: number;
  avgWaitTime: number; // in hours
  staleLeads: number; // leads not contacted in 48+ hours
  teamAvgCloseRate: number;
}

interface AIInsightsCardProps {
  stats: AgentStats;
  className?: string;
}

interface Insight {
  type: "warning" | "success" | "tip";
  icon: React.ReactNode;
  message: string;
}

function generateInsights(stats: AgentStats): Insight[] {
  const insights: Insight[] = [];

  // Check for stale leads
  if (stats.staleLeads > 0) {
    insights.push({
      type: "warning",
      icon: <AlertTriangle className="h-4 w-4" />,
      message: `You have ${stats.staleLeads} lead${stats.staleLeads > 1 ? 's' : ''} waiting 48+ hours. Speed-to-lead improves close rates by 40%! Contact them ASAP.`
    });
  }

  // Check close rate vs team average
  if (stats.closeRate < stats.teamAvgCloseRate - 5) {
    insights.push({
      type: "tip",
      icon: <TrendingUp className="h-4 w-4" />,
      message: `Your close rate is ${(stats.teamAvgCloseRate - stats.closeRate).toFixed(1)}% below team average. Try following up within 5 minutes of receiving a new lead.`
    });
  } else if (stats.closeRate > stats.teamAvgCloseRate + 5) {
    insights.push({
      type: "success",
      icon: <TrendingUp className="h-4 w-4" />,
      message: `Great job! Your close rate is ${(stats.closeRate - stats.teamAvgCloseRate).toFixed(1)}% above team average. Keep up the excellent work!`
    });
  }

  // Check average wait time
  if (stats.avgWaitTime > 24) {
    insights.push({
      type: "warning",
      icon: <Clock className="h-4 w-4" />,
      message: `Your average response time is ${stats.avgWaitTime.toFixed(0)} hours. Leads contacted within 1 hour are 7x more likely to convert.`
    });
  }

  // Conversion funnel tips
  const qualifyRate = stats.totalLeads > 0 ? (stats.qualified / stats.contacted) * 100 : 0;
  if (qualifyRate < 40 && stats.contacted > 5) {
    insights.push({
      type: "tip",
      icon: <Sparkles className="h-4 w-4" />,
      message: `Only ${qualifyRate.toFixed(0)}% of your contacted leads qualify. Consider refining your qualifying questions to identify serious candidates faster.`
    });
  }

  // If doing well, add encouragement
  if (insights.length === 0) {
    insights.push({
      type: "success",
      icon: <Sparkles className="h-4 w-4" />,
      message: `You're on track! Keep engaging with your leads and maintaining your momentum. Consistency is key to success.`
    });
  }

  return insights;
}

const insightStyles = {
  warning: "bg-amber-500/10 border-amber-500/30 text-amber-200",
  success: "bg-emerald-500/10 border-emerald-500/30 text-emerald-200",
  tip: "bg-primary/10 border-primary/30 text-primary",
};

export function AIInsightsCard({ stats, className }: AIInsightsCardProps) {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    setInsights(generateInsights(stats));
  }, [stats]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => {
      setInsights(generateInsights(stats));
      setIsRefreshing(false);
    }, 500);
  };

  return (
    <GlassCard className={cn("p-6", className)}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          AI Suggestions
        </h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRefresh}
          disabled={isRefreshing}
        >
          <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
        </Button>
      </div>
      
      <div className="space-y-3">
        {insights.map((insight, index) => (
          <motion.div
            key={index}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
            className={cn(
              "p-4 rounded-lg border flex gap-3",
              insightStyles[insight.type]
            )}
          >
            <div className="shrink-0 mt-0.5">{insight.icon}</div>
            <p className="text-sm leading-relaxed">{insight.message}</p>
          </motion.div>
        ))}
      </div>
    </GlassCard>
  );
}
