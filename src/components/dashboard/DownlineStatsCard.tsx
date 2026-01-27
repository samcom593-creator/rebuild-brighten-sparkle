import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Users, DollarSign, Target, TrendingUp, Calendar } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from "date-fns";
import { cn } from "@/lib/utils";

type TimePeriod = "week" | "month" | "all";

interface DownlineStats {
  totalALP: number;
  totalDeals: number;
  agentCount: number;
  avgCloseRate: number;
}

export function DownlineStatsCard() {
  const { user, isAdmin } = useAuth();
  const [period, setPeriod] = useState<TimePeriod>("week");
  const [stats, setStats] = useState<DownlineStats>({
    totalALP: 0,
    totalDeals: 0,
    agentCount: 0,
    avgCloseRate: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDownlineStats = async () => {
      if (!user) return;

      try {
        setLoading(true);
        
        // Get current user's agent ID
        const { data: currentAgent } = await supabase
          .from("agents")
          .select("id")
          .eq("user_id", user.id)
          .eq("is_deactivated", false)
          .maybeSingle();

        if (!currentAgent) {
          setLoading(false);
          return;
        }

        let agentIds: string[] = [];

        // For admins, fetch ALL active agents (not just direct reports)
        if (isAdmin) {
          const { data: allAgents } = await supabase
            .from("agents")
            .select("id")
            .eq("is_deactivated", false)
            .neq("id", currentAgent.id);

          agentIds = allAgents?.map(a => a.id) || [];
        } else {
          // For managers, fetch only direct reports
          const { data: downlineAgents } = await supabase
            .from("agents")
            .select("id")
            .eq("invited_by_manager_id", currentAgent.id)
            .eq("is_deactivated", false);

          agentIds = downlineAgents?.map(a => a.id) || [];
        }

        if (agentIds.length === 0) {
          setLoading(false);
          return;
        }

        // Build date range based on period
        const today = new Date();
        let startDate: string | undefined;
        let endDate: string | undefined;

        if (period === "week") {
          startDate = format(startOfWeek(today, { weekStartsOn: 0 }), "yyyy-MM-dd");
          endDate = format(endOfWeek(today, { weekStartsOn: 0 }), "yyyy-MM-dd");
        } else if (period === "month") {
          startDate = format(startOfMonth(today), "yyyy-MM-dd");
          endDate = format(endOfMonth(today), "yyyy-MM-dd");
        }

        // Query production data
        let query = supabase
          .from("daily_production")
          .select("aop, deals_closed, presentations")
          .in("agent_id", agentIds);

        if (startDate && endDate) {
          query = query.gte("production_date", startDate).lte("production_date", endDate);
        }

        const { data: productionData } = await query;

        if (productionData) {
          const totalALP = productionData.reduce((sum, p) => sum + (Number(p.aop) || 0), 0);
          const totalDeals = productionData.reduce((sum, p) => sum + (p.deals_closed || 0), 0);
          const totalPresentations = productionData.reduce((sum, p) => sum + (p.presentations || 0), 0);
          const avgCloseRate = totalPresentations > 0 
            ? Math.round((totalDeals / totalPresentations) * 100) 
            : 0;

          setStats({
            totalALP,
            totalDeals,
            agentCount: agentIds.length,
            avgCloseRate,
          });
        }
      } catch (error) {
        console.error("Error fetching downline stats:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchDownlineStats();
  }, [user, isAdmin, period]);

  if (loading && stats.agentCount === 0) {
    return null;
  }

  if (stats.agentCount === 0 && !loading) {
    return null;
  }

  const periodLabels = {
    week: "This Week",
    month: "This Month",
    all: "All Time",
  };

  const label = isAdmin ? "Agency Production" : "Team Production";

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
    >
      <GlassCard className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            <h3 className="font-semibold">{label}</h3>
            <span className="text-xs text-muted-foreground">
              ({periodLabels[period]})
            </span>
          </div>
          
          {/* Time Toggle */}
          <div className="flex items-center gap-1 bg-muted/50 rounded-md p-0.5">
            {(["week", "month", "all"] as TimePeriod[]).map((p) => (
              <Button
                key={p}
                variant={period === p ? "default" : "ghost"}
                size="sm"
                onClick={() => setPeriod(p)}
                className={cn(
                  "text-[10px] h-6 px-2",
                  period === p && "bg-primary text-primary-foreground"
                )}
              >
                {p === "week" ? "W" : p === "month" ? "M" : "All"}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground mb-3">
          <span>{stats.agentCount} agent{stats.agentCount !== 1 ? 's' : ''}</span>
        </div>
        
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 text-primary mb-1">
              <DollarSign className="h-4 w-4" />
            </div>
            <p className="text-2xl font-bold">${stats.totalALP.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">Total ALP</p>
          </div>
          
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 text-emerald-400 mb-1">
              <Target className="h-4 w-4" />
            </div>
            <p className="text-2xl font-bold">{stats.totalDeals}</p>
            <p className="text-xs text-muted-foreground">Deals</p>
          </div>
          
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 text-violet-400 mb-1">
              <TrendingUp className="h-4 w-4" />
            </div>
            <p className="text-2xl font-bold">{stats.avgCloseRate}%</p>
            <p className="text-xs text-muted-foreground">Close Rate</p>
          </div>
        </div>
      </GlassCard>
    </motion.div>
  );
}
