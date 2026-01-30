import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { DollarSign, Target, Users, TrendingUp, Presentation, X } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { DateRangePicker, useDateRange } from "@/components/ui/date-range-picker";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useProductionRealtime } from "@/hooks/useProductionRealtime";

interface SnapshotStats {
  totalALP: number;
  totalDeals: number;
  agentCount: number;
  avgCloseRate: number;
  totalPresentations: number;
}

interface AgentBreakdown {
  id: string;
  name: string;
  aop: number;
  deals: number;
  presentations: number;
  closeRate: number;
}

type DrilldownType = "alp" | "deals" | "agents" | "closeRate" | null;

export function TeamSnapshotCard() {
  const { user, isAdmin, isManager, isAgent, isLoading: authLoading } = useAuth();
  const { period, setPeriod, range, setRange, startDate, endDate } = useDateRange("week");
  const [stats, setStats] = useState<SnapshotStats>({
    totalALP: 0,
    totalDeals: 0,
    agentCount: 0,
    avgCloseRate: 0,
    totalPresentations: 0,
  });
  const [loading, setLoading] = useState(true);
  const [dataFetched, setDataFetched] = useState(false);
  
  // Drilldown state
  const [drilldownType, setDrilldownType] = useState<DrilldownType>(null);
  const [agentBreakdown, setAgentBreakdown] = useState<AgentBreakdown[]>([]);
  const [drilldownLoading, setDrilldownLoading] = useState(false);

  const fetchStats = useCallback(async () => {
    if (!user || authLoading) return;

    try {
      setLoading(true);
      
      let agentIds: string[] = [];

      if (isAdmin) {
        const { data: allAgents } = await supabase
          .from("agents")
          .select("id")
          .eq("is_deactivated", false);
        agentIds = allAgents?.map(a => a.id) || [];
      } else if (isManager) {
        const { data: currentAgent } = await supabase
          .from("agents")
          .select("id")
          .eq("user_id", user.id)
          .eq("is_deactivated", false)
          .maybeSingle();

        if (currentAgent) {
          const { data: downlineAgents } = await supabase
            .from("agents")
            .select("id")
            .eq("invited_by_manager_id", currentAgent.id)
            .eq("is_deactivated", false);

          agentIds = [currentAgent.id, ...(downlineAgents?.map(a => a.id) || [])];
        }
      } else {
        const { data: currentAgent } = await supabase
          .from("agents")
          .select("id")
          .eq("user_id", user.id)
          .eq("is_deactivated", false)
          .maybeSingle();
          
        if (currentAgent) {
          agentIds = [currentAgent.id];
        }
      }

      if (agentIds.length === 0) {
        setStats({
          totalALP: 0,
          totalDeals: 0,
          agentCount: 0,
          avgCloseRate: 0,
          totalPresentations: 0,
        });
        setLoading(false);
        setDataFetched(true);
        return;
      }

      const { data: productionData } = await supabase
        .from("daily_production")
        .select("aop, deals_closed, presentations, agent_id")
        .in("agent_id", agentIds)
        .gte("production_date", startDate)
        .lte("production_date", endDate);

      if (productionData && productionData.length > 0) {
        const totalALP = productionData.reduce((sum, p) => sum + (Number(p.aop) || 0), 0);
        const totalDeals = productionData.reduce((sum, p) => sum + (p.deals_closed || 0), 0);
        const totalPresentations = productionData.reduce((sum, p) => sum + (p.presentations || 0), 0);
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
      } else {
        setStats({
          totalALP: 0,
          totalDeals: 0,
          agentCount: agentIds.length,
          avgCloseRate: 0,
          totalPresentations: 0,
        });
      }
      
      setDataFetched(true);
    } catch (error) {
      console.error("[TeamSnapshot] Error:", error);
    } finally {
      setLoading(false);
    }
  }, [user, authLoading, isAdmin, isManager, isAgent, startDate, endDate]);

  const fetchDrilldown = useCallback(async (type: DrilldownType) => {
    if (!user || !type) return;
    
    setDrilldownLoading(true);
    try {
      let agentIds: string[] = [];

      if (isAdmin) {
        const { data: allAgents } = await supabase
          .from("agents")
          .select("id")
          .eq("is_deactivated", false);
        agentIds = allAgents?.map(a => a.id) || [];
      } else if (isManager) {
        const { data: currentAgent } = await supabase
          .from("agents")
          .select("id")
          .eq("user_id", user.id)
          .maybeSingle();

        if (currentAgent) {
          const { data: downlineAgents } = await supabase
            .from("agents")
            .select("id")
            .eq("invited_by_manager_id", currentAgent.id)
            .eq("is_deactivated", false);

          agentIds = [currentAgent.id, ...(downlineAgents?.map(a => a.id) || [])];
        }
      }

      // Get production data with agent info
      const { data: productionData } = await supabase
        .from("daily_production")
        .select(`
          aop, deals_closed, presentations, agent_id,
          agent:agents!inner(
            id,
            profile:profiles!agents_profile_id_fkey(full_name)
          )
        `)
        .in("agent_id", agentIds)
        .gte("production_date", startDate)
        .lte("production_date", endDate);

      // Aggregate by agent
      const agentMap = new Map<string, AgentBreakdown>();
      
      productionData?.forEach((p: any) => {
        const agentId = p.agent_id;
        const agentName = p.agent?.profile?.full_name || "Unknown";
        
        if (!agentMap.has(agentId)) {
          agentMap.set(agentId, {
            id: agentId,
            name: agentName,
            aop: 0,
            deals: 0,
            presentations: 0,
            closeRate: 0,
          });
        }
        
        const agent = agentMap.get(agentId)!;
        agent.aop += Number(p.aop) || 0;
        agent.deals += p.deals_closed || 0;
        agent.presentations += p.presentations || 0;
      });

      // Calculate close rates
      agentMap.forEach((agent) => {
        agent.closeRate = agent.presentations > 0 
          ? Math.round((agent.deals / agent.presentations) * 100) 
          : 0;
      });

      // Sort based on drilldown type
      let sortedAgents = Array.from(agentMap.values());
      
      switch (type) {
        case "alp":
          sortedAgents.sort((a, b) => b.aop - a.aop);
          break;
        case "deals":
          sortedAgents.sort((a, b) => b.deals - a.deals);
          break;
        case "closeRate":
          sortedAgents.sort((a, b) => b.closeRate - a.closeRate);
          break;
        default:
          sortedAgents.sort((a, b) => b.aop - a.aop);
      }

      setAgentBreakdown(sortedAgents);
    } catch (error) {
      console.error("Error fetching drilldown:", error);
    } finally {
      setDrilldownLoading(false);
    }
  }, [user, isAdmin, isManager, startDate, endDate]);

  useEffect(() => {
    if (!authLoading && user) {
      fetchStats();
    }
  }, [fetchStats, authLoading, user]);

  // Use shared realtime hook for instant updates
  useProductionRealtime(fetchStats, 300);

  const handleStatClick = (type: DrilldownType) => {
    if (!isAdmin && !isManager) return; // Only admin/manager can drilldown
    setDrilldownType(type);
    fetchDrilldown(type);
  };

  const getLabel = () => {
    if (isAdmin) return "Agency Production";
    if (isManager) return "Team Production";
    return "My Production";
  };

  const getDrilldownTitle = () => {
    switch (drilldownType) {
      case "alp": return "ALP Breakdown by Agent";
      case "deals": return "Deals Breakdown by Agent";
      case "agents": return "Active Agents";
      case "closeRate": return "Close Rate by Agent";
      default: return "";
    }
  };

  const showSkeleton = authLoading || (loading && !dataFetched);
  const canDrilldown = isAdmin || isManager;

  return (
    <>
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
                {range.from && range.to && (
                  <p className="text-sm text-muted-foreground">
                    {format(range.from, "MMM d")} - {format(range.to, "MMM d, yyyy")}
                  </p>
                )}
              </div>
            </div>

            <DateRangePicker
              value={range}
              onChange={setRange}
              period={period}
              onPeriodChange={setPeriod}
            />
          </div>

          {showSkeleton ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map(i => (
                <Skeleton key={i} className="h-24 rounded-xl" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {/* Total ALP - Clickable */}
              <button
                onClick={() => handleStatClick("alp")}
                className={cn(
                  "bg-background/50 rounded-xl p-4 border border-border/50 text-left transition-all",
                  canDrilldown && "hover:border-primary/50 hover:bg-primary/5 cursor-pointer"
                )}
                disabled={!canDrilldown}
              >
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
              </button>

              {/* Deals Closed - Clickable */}
              <button
                onClick={() => handleStatClick("deals")}
                className={cn(
                  "bg-background/50 rounded-xl p-4 border border-border/50 text-left transition-all",
                  canDrilldown && "hover:border-emerald-500/50 hover:bg-emerald-500/5 cursor-pointer"
                )}
                disabled={!canDrilldown}
              >
                <div className="flex items-center gap-2 text-emerald-500 mb-2">
                  <Target className="h-5 w-5" />
                  <span className="text-xs font-medium uppercase tracking-wide">Deals</span>
                </div>
                <AnimatedCounter
                  value={stats.totalDeals}
                  className="text-3xl font-bold"
                />
              </button>

              {/* Active Agents - Clickable */}
              {(isAdmin || isManager) && (
                <button
                  onClick={() => handleStatClick("agents")}
                  className={cn(
                    "bg-background/50 rounded-xl p-4 border border-border/50 text-left transition-all",
                    canDrilldown && "hover:border-violet-500/50 hover:bg-violet-500/5 cursor-pointer"
                  )}
                >
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
                </button>
              )}

              {/* Close Rate - Clickable */}
              <button
                onClick={() => handleStatClick("closeRate")}
                className={cn(
                  "bg-background/50 rounded-xl p-4 border border-border/50 text-left transition-all",
                  canDrilldown && "hover:border-amber-500/50 hover:bg-amber-500/5 cursor-pointer"
                )}
                disabled={!canDrilldown}
              >
                <div className="flex items-center gap-2 text-amber-500 mb-2">
                  <TrendingUp className="h-5 w-5" />
                  <span className="text-xs font-medium uppercase tracking-wide">Close Rate</span>
                </div>
                <AnimatedCounter
                  value={stats.avgCloseRate}
                  suffix="%"
                  className="text-3xl font-bold"
                />
              </button>

              {/* Presentations - for agents only */}
              {isAgent && !isManager && !isAdmin && (
                <div className="bg-background/50 rounded-xl p-4 border border-border/50">
                  <div className="flex items-center gap-2 text-violet-500 mb-2">
                    <Presentation className="h-5 w-5" />
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

      {/* Drilldown Dialog */}
      <Dialog open={!!drilldownType} onOpenChange={() => setDrilldownType(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{getDrilldownTitle()}</DialogTitle>
          </DialogHeader>
          
          <ScrollArea className="max-h-[60vh]">
            {drilldownLoading ? (
              <div className="space-y-3 p-4">
                {[1, 2, 3, 4, 5].map(i => (
                  <Skeleton key={i} className="h-14 rounded-lg" />
                ))}
              </div>
            ) : agentBreakdown.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                No data for this period
              </p>
            ) : (
              <div className="space-y-2 p-2">
                {agentBreakdown.map((agent, index) => (
                  <div
                    key={agent.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-bold text-muted-foreground w-6">
                        #{index + 1}
                      </span>
                      <span className="font-medium">{agent.name}</span>
                    </div>
                    <div className="text-right">
                      {drilldownType === "alp" && (
                        <span className="font-bold text-primary">
                          ${agent.aop.toLocaleString()}
                        </span>
                      )}
                      {drilldownType === "deals" && (
                        <span className="font-bold text-emerald-500">
                          {agent.deals} deals
                        </span>
                      )}
                      {drilldownType === "agents" && (
                        <span className="text-sm text-muted-foreground">
                          ${agent.aop.toLocaleString()} • {agent.deals} deals
                        </span>
                      )}
                      {drilldownType === "closeRate" && (
                        <span className="font-bold text-amber-500">
                          {agent.closeRate}%
                          <span className="text-xs text-muted-foreground ml-1">
                            ({agent.deals}/{agent.presentations})
                          </span>
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}
