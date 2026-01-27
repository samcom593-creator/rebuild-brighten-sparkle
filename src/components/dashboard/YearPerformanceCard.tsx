import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { 
  CalendarDays, 
  TrendingUp, 
  Target, 
  DollarSign,
  BarChart3,
  Award
} from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface YearPerformanceCardProps {
  agentId: string;
}

interface YearStats {
  ytdALP: number;
  ytdDeals: number;
  ytdPresentations: number;
  avgCloseRate: number;
  avgDealSize: number;
}

export function YearPerformanceCard({ agentId }: YearPerformanceCardProps) {
  const [stats, setStats] = useState<YearStats | null>(null);
  const [loading, setLoading] = useState(true);
  const currentYear = new Date().getFullYear();

  useEffect(() => {
    if (!agentId) return;
    fetchYearStats();
  }, [agentId]);

  const fetchYearStats = async () => {
    try {
      const yearStart = `${currentYear}-01-01`;
      const { data, error } = await supabase
        .from("daily_production")
        .select("aop, deals_closed, presentations")
        .eq("agent_id", agentId)
        .gte("production_date", yearStart);

      if (error) throw error;

      if (data && data.length > 0) {
        const ytdALP = data.reduce((sum, p) => sum + Number(p.aop || 0), 0);
        const ytdDeals = data.reduce((sum, p) => sum + Number(p.deals_closed || 0), 0);
        const ytdPresentations = data.reduce((sum, p) => sum + Number(p.presentations || 0), 0);
        const avgCloseRate = ytdPresentations > 0 ? (ytdDeals / ytdPresentations) * 100 : 0;
        const avgDealSize = ytdDeals > 0 ? ytdALP / ytdDeals : 0;

        setStats({
          ytdALP,
          ytdDeals,
          ytdPresentations,
          avgCloseRate,
          avgDealSize,
        });
      } else {
        setStats({
          ytdALP: 0,
          ytdDeals: 0,
          ytdPresentations: 0,
          avgCloseRate: 0,
          avgDealSize: 0,
        });
      }
    } catch (error) {
      console.error("Error fetching year stats:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <GlassCard className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-muted rounded w-48" />
          <div className="grid grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 bg-muted rounded-xl" />
            ))}
          </div>
        </div>
      </GlassCard>
    );
  }

  const statCards = [
    {
      label: "YTD ALP",
      value: `$${stats?.ytdALP.toLocaleString() || 0}`,
      icon: DollarSign,
      color: "from-emerald-500/20 to-emerald-500/5 border-emerald-500/20",
      iconColor: "text-emerald-400",
    },
    {
      label: "Total Deals",
      value: stats?.ytdDeals || 0,
      icon: TrendingUp,
      color: "from-amber-500/20 to-amber-500/5 border-amber-500/20",
      iconColor: "text-amber-400",
    },
    {
      label: "Avg Close %",
      value: `${stats?.avgCloseRate.toFixed(1) || 0}%`,
      icon: Target,
      color: "from-violet-500/20 to-violet-500/5 border-violet-500/20",
      iconColor: "text-violet-400",
    },
  ];

  return (
    <GlassCard className="p-6 relative overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20">
            <CalendarDays className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="font-bold text-lg">{currentYear} Year Performance</h3>
            <p className="text-xs text-muted-foreground">Year-to-date stats</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20">
          <BarChart3 className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-medium text-primary">Annual</span>
        </div>
      </div>

      {/* Main Stats */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        {statCards.map((stat, index) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
            className={cn(
              "relative overflow-hidden rounded-xl border bg-gradient-to-br p-4 text-center",
              stat.color
            )}
          >
            <div className={cn("mx-auto mb-2 h-8 w-8 rounded-lg bg-background/50 flex items-center justify-center", stat.iconColor)}>
              <stat.icon className="h-4 w-4" />
            </div>
            <p className="text-2xl font-bold text-foreground">{stat.value}</p>
            <p className="text-xs text-muted-foreground mt-1">{stat.label}</p>
            
            {/* Decorative glow */}
            <div className="absolute -right-4 -top-4 h-12 w-12 rounded-full bg-current opacity-10 blur-xl" />
          </motion.div>
        ))}
      </div>

      {/* Bottom Stats */}
      <div className="flex items-center justify-center gap-6 pt-4 border-t border-border/50">
        <div className="flex items-center gap-2 text-sm">
          <Target className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">Total Presentations:</span>
          <span className="font-semibold">{stats?.ytdPresentations || 0}</span>
        </div>
        <div className="h-4 w-px bg-border" />
        <div className="flex items-center gap-2 text-sm">
          <Award className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">Avg Deal Size:</span>
          <span className="font-semibold">${stats?.avgDealSize.toLocaleString(undefined, { maximumFractionDigits: 0 }) || 0}</span>
        </div>
      </div>

      {/* Background decoration */}
      <div className="absolute -right-8 -bottom-8 h-32 w-32 rounded-full bg-gradient-to-br from-primary/10 to-transparent blur-2xl" />
    </GlassCard>
  );
}
