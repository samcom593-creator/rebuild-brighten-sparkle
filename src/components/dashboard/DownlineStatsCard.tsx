import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Users, DollarSign, Target, TrendingUp } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { format, startOfWeek, endOfWeek } from "date-fns";

interface DownlineStats {
  totalALP: number;
  totalDeals: number;
  agentCount: number;
  avgCloseRate: number;
}

export function DownlineStatsCard() {
  const { user } = useAuth();
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
        // Get current user's agent ID
        const { data: currentAgent } = await supabase
          .from("agents")
          .select("id")
          .eq("user_id", user.id)
          .maybeSingle();

        if (!currentAgent) {
          setLoading(false);
          return;
        }

        // Get agents under this manager
        const { data: downlineAgents } = await supabase
          .from("agents")
          .select("id")
          .eq("invited_by_manager_id", currentAgent.id)
          .eq("is_deactivated", false);

        if (!downlineAgents || downlineAgents.length === 0) {
          setLoading(false);
          return;
        }

        const agentIds = downlineAgents.map(a => a.id);

        // Get this week's production data for downline
        const today = new Date();
        const weekStart = format(startOfWeek(today, { weekStartsOn: 0 }), "yyyy-MM-dd");
        const weekEnd = format(endOfWeek(today, { weekStartsOn: 0 }), "yyyy-MM-dd");

        const { data: productionData } = await supabase
          .from("daily_production")
          .select("aop, deals_closed, presentations")
          .in("agent_id", agentIds)
          .gte("production_date", weekStart)
          .lte("production_date", weekEnd);

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
            agentCount: downlineAgents.length,
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
  }, [user]);

  if (loading || stats.agentCount === 0) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
    >
      <GlassCard className="p-5">
        <div className="flex items-center gap-2 mb-4">
          <Users className="h-5 w-5 text-primary" />
          <h3 className="font-semibold">Team Production (This Week)</h3>
          <span className="text-xs text-muted-foreground ml-auto">
            {stats.agentCount} agents
          </span>
        </div>
        
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 text-primary mb-1">
              <DollarSign className="h-4 w-4" />
            </div>
            <p className="text-2xl font-bold">${stats.totalALP.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">Team ALP</p>
          </div>
          
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 text-emerald-400 mb-1">
              <Target className="h-4 w-4" />
            </div>
            <p className="text-2xl font-bold">{stats.totalDeals}</p>
            <p className="text-xs text-muted-foreground">Deals Closed</p>
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
