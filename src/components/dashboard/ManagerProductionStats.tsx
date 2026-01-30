import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Users, DollarSign, TrendingUp, Percent } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { supabase } from "@/integrations/supabase/client";
import { getTodayPST, getWeekStartPST, getMonthStartPST } from "@/lib/dateUtils";

interface ManagerProductionStatsProps {
  managerId: string;
}

interface TeamStats {
  todayALP: number;
  weekALP: number;
  monthALP: number;
  todayDeals: number;
  weekDeals: number;
  avgCloseRate: number;
  activeAgents: number;
}

export function ManagerProductionStats({ managerId }: ManagerProductionStatsProps) {
  const [stats, setStats] = useState<TeamStats>({
    todayALP: 0,
    weekALP: 0,
    monthALP: 0,
    todayDeals: 0,
    weekDeals: 0,
    avgCloseRate: 0,
    activeAgents: 0,
  });
  const [loading, setLoading] = useState(true);

  const fetchTeamStats = useCallback(async () => {
    try {
      // Get team members
      const { data: teamAgents } = await supabase
        .from("agents")
        .select("id")
        .eq("invited_by_manager_id", managerId)
        .eq("is_deactivated", false);

      if (!teamAgents || teamAgents.length === 0) {
        setStats({
          todayALP: 0,
          weekALP: 0,
          monthALP: 0,
          todayDeals: 0,
          weekDeals: 0,
          avgCloseRate: 0,
          activeAgents: 0,
        });
        setLoading(false);
        return;
      }

      const agentIds = teamAgents.map(a => a.id);
      const today = getTodayPST();
      const weekStart = getWeekStartPST();
      const monthStart = getMonthStartPST();

      // Fetch production data
      const { data: production } = await supabase
        .from("daily_production")
        .select("agent_id, aop, deals_closed, presentations, closing_rate, production_date")
        .in("agent_id", agentIds)
        .gte("production_date", monthStart);

      if (!production) {
        setLoading(false);
        return;
      }

      let todayALP = 0;
      let weekALP = 0;
      let monthALP = 0;
      let todayDeals = 0;
      let weekDeals = 0;
      let totalPresentations = 0;
      let totalDeals = 0;

      production.forEach(p => {
        const alp = Number(p.aop || 0);
        const deals = Number(p.deals_closed || 0);
        const presentations = Number(p.presentations || 0);

        monthALP += alp;
        totalDeals += deals;
        totalPresentations += presentations;

        if (p.production_date === today) {
          todayALP += alp;
          todayDeals += deals;
        }

        if (p.production_date >= weekStart) {
          weekALP += alp;
          weekDeals += deals;
        }
      });

      const avgCloseRate = totalPresentations > 0 
        ? (totalDeals / totalPresentations) * 100 
        : 0;

      setStats({
        todayALP,
        weekALP,
        monthALP,
        todayDeals,
        weekDeals,
        avgCloseRate,
        activeAgents: agentIds.length,
      });
    } catch (error) {
      console.error("Error fetching team stats:", error);
    } finally {
      setLoading(false);
    }
  }, [managerId]);

  // Initial fetch and real-time subscription
  useEffect(() => {
    fetchTeamStats();

    // Subscribe to real-time production updates
    const channel = supabase
      .channel("manager-production-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "daily_production" },
        () => fetchTeamStats()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchTeamStats]);

  if (loading) {
    return (
      <GlassCard className="p-4">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-muted rounded w-1/3" />
          <div className="grid grid-cols-3 gap-3">
            <div className="h-16 bg-muted rounded" />
            <div className="h-16 bg-muted rounded" />
            <div className="h-16 bg-muted rounded" />
          </div>
        </div>
      </GlassCard>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <GlassCard className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            Team Production
          </h3>
          <span className="text-xs text-muted-foreground">
            {stats.activeAgents} active agents
          </span>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="bg-primary/10 rounded-lg p-3 text-center">
            <DollarSign className="h-4 w-4 mx-auto text-primary mb-1" />
            <p className="text-lg font-bold text-primary">
              ${stats.todayALP.toLocaleString()}
            </p>
            <p className="text-[10px] text-muted-foreground">Today ALP</p>
          </div>

          <div className="bg-emerald-500/10 rounded-lg p-3 text-center">
            <TrendingUp className="h-4 w-4 mx-auto text-emerald-500 mb-1" />
            <p className="text-lg font-bold text-emerald-500">
              ${stats.weekALP.toLocaleString()}
            </p>
            <p className="text-[10px] text-muted-foreground">Week ALP</p>
          </div>

          <div className="bg-amber-500/10 rounded-lg p-3 text-center">
            <Percent className="h-4 w-4 mx-auto text-amber-500 mb-1" />
            <p className="text-lg font-bold text-amber-500">
              {stats.avgCloseRate.toFixed(0)}%
            </p>
            <p className="text-[10px] text-muted-foreground">Close Rate</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 mt-3">
          <div className="text-center p-2 bg-muted/30 rounded">
            <p className="text-sm font-bold">{stats.todayDeals}</p>
            <p className="text-[10px] text-muted-foreground">Today's Deals</p>
          </div>
          <div className="text-center p-2 bg-muted/30 rounded">
            <p className="text-sm font-bold">{stats.weekDeals}</p>
            <p className="text-[10px] text-muted-foreground">Week Deals</p>
          </div>
        </div>
      </GlassCard>
    </motion.div>
  );
}
