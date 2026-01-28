import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { DollarSign, Target, Users, TrendingUp } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from "date-fns";
import { cn } from "@/lib/utils";
import { DateRangePicker, useDateRange } from "@/components/ui/date-range-picker";
import { AnimatedCounter } from "@/components/ui/animated-counter";

interface SnapshotStats {
  totalALP: number;
  totalDeals: number;
  agentCount: number;
  avgCloseRate: number;
  totalPresentations: number;
}

export function TeamSnapshotCard() {
  const { user, isAdmin, isManager, isAgent } = useAuth();
  const { period, setPeriod, range, setRange, startDate, endDate } = useDateRange("week");
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

    // Real-time subscription for live updates
    const channel = supabase
      .channel("team-snapshot-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "daily_production" },
        () => {
          fetchStats();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, isAdmin, isManager, startDate, endDate]);

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

      // Role-based scoping:
      // - Admin: ALL active agents (agency-wide)
      // - Manager: Direct reports + self (team)
      // - Agent: Only self (personal)
      if (isAdmin) {
        const { data: allAgents } = await supabase
          .from("agents")
          .select("id")
          .eq("is_deactivated", false);

        agentIds = allAgents?.map(a => a.id) || [];
      } else if (isManager) {
        // Manager sees their team + themselves
        const { data: downlineAgents } = await supabase
          .from("agents")
          .select("id")
          .eq("invited_by_manager_id", currentAgent.id)
          .eq("is_deactivated", false);

        agentIds = [currentAgent.id, ...(downlineAgents?.map(a => a.id) || [])];
      } else {
        // Agent sees only their own stats
        agentIds = [currentAgent.id];
      }

      if (agentIds.length === 0) {
        setLoading(false);
        return;
      }

      // Query production data with date range
      const { data: productionData } = await supabase
        .from("daily_production")
        .select("aop, deals_closed, presentations, agent_id")
        .in("agent_id", agentIds)
        .gte("production_date", startDate)
        .lte("production_date", endDate);

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

  // Dynamic label based on role
  const getLabel = () => {
    if (isAdmin) return "Agency Production";
    if (isManager) return "Team Production";
    return "My Production";
  };

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
              <h2 className="text-xl font-bold">{getLabel()}</h2>
              <p className="text-sm text-muted-foreground">
                {format(range.from, "MMM d")} - {format(range.to, "MMM d, yyyy")}
              </p>
            </div>
          </div>

          {/* Date Range Picker */}
          <DateRangePicker
            value={range}
            onChange={setRange}
            period={period}
            onPeriodChange={setPeriod}
          />
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
              <AnimatedCounter
                value={stats.totalALP}
                prefix="$"
                className="text-3xl font-bold"
                formatOptions={{ maximumFractionDigits: 0 }}
              />
            </div>

            {/* Deals Closed */}
            <div className="bg-background/50 rounded-xl p-4 border border-border/50">
              <div className="flex items-center gap-2 text-emerald-500 mb-2">
                <Target className="h-5 w-5" />
                <span className="text-xs font-medium uppercase tracking-wide">Deals</span>
              </div>
              <AnimatedCounter
                value={stats.totalDeals}
                className="text-3xl font-bold"
              />
            </div>

            {/* Active Agents - hide for regular agents */}
            {(isAdmin || isManager) && (
              <div className="bg-background/50 rounded-xl p-4 border border-border/50">
                <div className="flex items-center gap-2 text-violet-500 mb-2">
                  <Users className="h-5 w-5" />
                  <span className="text-xs font-medium uppercase tracking-wide">
                    {isAdmin ? "Active Agents" : "Team Size"}
                  </span>
                </div>
                <AnimatedCounter
                  value={stats.agentCount}
                  className="text-3xl font-bold"
                />
              </div>
            )}

            {/* Close Rate */}
            <div className="bg-background/50 rounded-xl p-4 border border-border/50">
              <div className="flex items-center gap-2 text-amber-500 mb-2">
                <TrendingUp className="h-5 w-5" />
                <span className="text-xs font-medium uppercase tracking-wide">Close Rate</span>
              </div>
              <AnimatedCounter
                value={stats.avgCloseRate}
                suffix="%"
                className="text-3xl font-bold"
              />
            </div>

            {/* Presentations - show for agents instead of team count */}
            {isAgent && !isManager && !isAdmin && (
              <div className="bg-background/50 rounded-xl p-4 border border-border/50">
                <div className="flex items-center gap-2 text-violet-500 mb-2">
                  <Target className="h-5 w-5" />
                  <span className="text-xs font-medium uppercase tracking-wide">Presentations</span>
                </div>
                <AnimatedCounter
                  value={stats.totalPresentations}
                  className="text-3xl font-bold"
                />
              </div>
            )}
          </div>
        )}
      </GlassCard>
    </motion.div>
  );
}
