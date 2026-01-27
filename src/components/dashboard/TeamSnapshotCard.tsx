import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { DollarSign, Target, Users, TrendingUp, Calendar } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from "date-fns";
import { cn } from "@/lib/utils";

type TimePeriod = "week" | "month" | "all";

interface SnapshotStats {
  totalALP: number;
  totalDeals: number;
  agentCount: number;
  avgCloseRate: number;
  totalPresentations: number;
}

export function TeamSnapshotCard() {
  const { user, isAdmin } = useAuth();
  const [period, setPeriod] = useState<TimePeriod>("week");
  const [stats, setStats] = useState<SnapshotStats>({
    totalALP: 0,
    totalDeals: 0,
    agentCount: 0,
    avgCloseRate: 0,
    totalPresentations: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, [user, isAdmin, period]);

  const fetchStats = async () => {
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

      // For admins, fetch ALL active agents
      if (isAdmin) {
        const { data: allAgents } = await supabase
          .from("agents")
          .select("id")
          .eq("is_deactivated", false);

        agentIds = allAgents?.map(a => a.id) || [];
      } else {
        // For managers, fetch only direct reports + self
        const { data: downlineAgents } = await supabase
          .from("agents")
          .select("id")
          .eq("invited_by_manager_id", currentAgent.id)
          .eq("is_deactivated", false);

        agentIds = [currentAgent.id, ...(downlineAgents?.map(a => a.id) || [])];
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
      // "all" has no date filter

      // Query production data
      let query = supabase
        .from("daily_production")
        .select("aop, deals_closed, presentations, agent_id")
        .in("agent_id", agentIds);

      if (startDate && endDate) {
        query = query.gte("production_date", startDate).lte("production_date", endDate);
      }

      const { data: productionData } = await query;

      if (productionData) {
        const totalALP = productionData.reduce((sum, p) => sum + (Number(p.aop) || 0), 0);
        const totalDeals = productionData.reduce((sum, p) => sum + (p.deals_closed || 0), 0);
        const totalPresentations = productionData.reduce((sum, p) => sum + (p.presentations || 0), 0);
        
        // Count unique agents with production
        const uniqueAgents = new Set(productionData.map(p => p.agent_id));
        
        const avgCloseRate = totalPresentations > 0 
          ? Math.round((totalDeals / totalPresentations) * 100) 
          : 0;

        setStats({
          totalALP,
          totalDeals,
          agentCount: uniqueAgents.size || agentIds.length,
          avgCloseRate,
          totalPresentations,
        });
      }
    } catch (error) {
      console.error("Error fetching team snapshot:", error);
    } finally {
      setLoading(false);
    }
  };

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
    >
      <GlassCard className="p-6 bg-gradient-to-br from-primary/5 via-background to-emerald-500/5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-primary to-emerald-500 flex items-center justify-center">
              <TrendingUp className="h-6 w-6 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold">{label}</h2>
              <p className="text-sm text-muted-foreground">{periodLabels[period]}</p>
            </div>
          </div>

          {/* Time Toggle */}
          <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-1">
            {(["week", "month", "all"] as TimePeriod[]).map((p) => (
              <Button
                key={p}
                variant={period === p ? "default" : "ghost"}
                size="sm"
                onClick={() => setPeriod(p)}
                className={cn(
                  "text-xs h-8",
                  period === p && "bg-primary text-primary-foreground"
                )}
              >
                <Calendar className="h-3 w-3 mr-1" />
                {p === "week" ? "Week" : p === "month" ? "Month" : "All"}
              </Button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="animate-pulse bg-muted/50 rounded-lg h-20" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* Total ALP */}
            <div className="bg-background/50 rounded-xl p-4 border border-border/50">
              <div className="flex items-center gap-2 text-primary mb-2">
                <DollarSign className="h-5 w-5" />
                <span className="text-xs font-medium uppercase tracking-wide">Total ALP</span>
              </div>
              <p className="text-3xl font-bold">${stats.totalALP.toLocaleString()}</p>
            </div>

            {/* Deals Closed */}
            <div className="bg-background/50 rounded-xl p-4 border border-border/50">
              <div className="flex items-center gap-2 text-emerald-500 mb-2">
                <Target className="h-5 w-5" />
                <span className="text-xs font-medium uppercase tracking-wide">Deals</span>
              </div>
              <p className="text-3xl font-bold">{stats.totalDeals}</p>
            </div>

            {/* Active Agents */}
            <div className="bg-background/50 rounded-xl p-4 border border-border/50">
              <div className="flex items-center gap-2 text-violet-500 mb-2">
                <Users className="h-5 w-5" />
                <span className="text-xs font-medium uppercase tracking-wide">Agents</span>
              </div>
              <p className="text-3xl font-bold">{stats.agentCount}</p>
            </div>

            {/* Close Rate */}
            <div className="bg-background/50 rounded-xl p-4 border border-border/50">
              <div className="flex items-center gap-2 text-amber-500 mb-2">
                <TrendingUp className="h-5 w-5" />
                <span className="text-xs font-medium uppercase tracking-wide">Close Rate</span>
              </div>
              <p className="text-3xl font-bold">{stats.avgCloseRate}%</p>
            </div>
          </div>
        )}
      </GlassCard>
    </motion.div>
  );
}
