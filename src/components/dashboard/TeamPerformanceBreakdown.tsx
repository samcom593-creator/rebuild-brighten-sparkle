import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  DollarSign, 
  Target, 
  TrendingUp, 
  Presentation, 
  ChevronDown,
  ChevronRight,
  BarChart3,
  Users
} from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { format, subWeeks, startOfWeek, endOfWeek, isWithinInterval, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useDebouncedRefetch } from "@/hooks/useDebouncedRefetch";
import { getClosingRateColor } from "@/lib/closingRateColors";

interface WeeklyStats {
  weekLabel: string;
  weekStart: string;
  weekEnd: string;
  totalALP: number;
  totalDeals: number;
  totalPresentations: number;
  closeRate: number;
  agentCount: number;
}

interface AgentBreakdown {
  id: string;
  name: string;
  aop: number;
  deals: number;
  presentations: number;
  closeRate: number;
}

export function TeamPerformanceBreakdown() {
  const { user, isAdmin, isManager, isLoading: authLoading } = useAuth();
  const [weeklyData, setWeeklyData] = useState<WeeklyStats[]>([]);
  const [expandedWeek, setExpandedWeek] = useState<string | null>(null);
  const [agentBreakdown, setAgentBreakdown] = useState<AgentBreakdown[]>([]);
  const [loading, setLoading] = useState(true);
  const [breakdownLoading, setBreakdownLoading] = useState(false);

  const fetchWeeklyData = useCallback(async () => {
    if (!user || authLoading) return;

    // Check role access
    if (!isManager && !isAdmin) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      // Get agent IDs based on role
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
      }

      if (agentIds.length === 0) {
        setWeeklyData([]);
        setLoading(false);
        return;
      }

      // Get last 4 weeks of data
      const today = new Date();
      const weeks: WeeklyStats[] = [];

      for (let i = 0; i < 4; i++) {
        const weekEnd = endOfWeek(subWeeks(today, i), { weekStartsOn: 0 });
        const weekStart = startOfWeek(subWeeks(today, i), { weekStartsOn: 0 });

        const weekLabel = i === 0 
          ? "This Week" 
          : i === 1 
            ? "Last Week" 
            : `Week of ${format(weekStart, "MMM d")}`;

        weeks.push({
          weekLabel,
          weekStart: format(weekStart, "yyyy-MM-dd"),
          weekEnd: format(weekEnd, "yyyy-MM-dd"),
          totalALP: 0,
          totalDeals: 0,
          totalPresentations: 0,
          closeRate: 0,
          agentCount: 0,
        });
      }

      // Fetch all production data for the last 4 weeks
      const oldestWeek = weeks[weeks.length - 1].weekStart;
      const { data: productionData } = await supabase
        .from("daily_production")
        .select("aop, deals_closed, presentations, agent_id, production_date")
        .in("agent_id", agentIds)
        .gte("production_date", oldestWeek)
        .lte("production_date", weeks[0].weekEnd);

      // Aggregate data by week
      productionData?.forEach(p => {
        const prodDate = parseISO(p.production_date);
        
        for (const week of weeks) {
          const weekStart = parseISO(week.weekStart);
          const weekEnd = parseISO(week.weekEnd);
          
          if (isWithinInterval(prodDate, { start: weekStart, end: weekEnd })) {
            week.totalALP += Number(p.aop) || 0;
            week.totalDeals += p.deals_closed || 0;
            week.totalPresentations += p.presentations || 0;
            break;
          }
        }
      });

      // Calculate close rates and agent counts
      weeks.forEach(week => {
        week.closeRate = week.totalPresentations > 0 
          ? Math.round((week.totalDeals / week.totalPresentations) * 100) 
          : 0;
        
        // Count unique agents with production in this week
        const weekAgents = new Set(
          productionData
            ?.filter(p => {
              const prodDate = parseISO(p.production_date);
              return isWithinInterval(prodDate, { 
                start: parseISO(week.weekStart), 
                end: parseISO(week.weekEnd) 
              });
            })
            .map(p => p.agent_id)
        );
        week.agentCount = weekAgents.size || 0;
      });

      setWeeklyData(weeks);
    } catch (error) {
      console.error("Error fetching weekly data:", error);
    } finally {
      setLoading(false);
    }
  }, [user, authLoading, isAdmin, isManager]);

  const fetchWeekBreakdown = useCallback(async (weekStart: string, weekEnd: string) => {
    if (!user) return;

    setBreakdownLoading(true);
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
        .gte("production_date", weekStart)
        .lte("production_date", weekEnd);

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

      // Calculate close rates and sort
      const sortedAgents = Array.from(agentMap.values())
        .map(agent => ({
          ...agent,
          closeRate: agent.presentations > 0 
            ? Math.round((agent.deals / agent.presentations) * 100) 
            : 0,
        }))
        .sort((a, b) => b.aop - a.aop);

      setAgentBreakdown(sortedAgents);
    } catch (error) {
      console.error("Error fetching week breakdown:", error);
    } finally {
      setBreakdownLoading(false);
    }
  }, [user, isAdmin, isManager]);

  useEffect(() => {
    if (!authLoading && user) {
      fetchWeeklyData();
    }
  }, [fetchWeeklyData, authLoading, user]);

  // Debounced refetch to prevent storms
  const debouncedRefetch = useDebouncedRefetch(fetchWeeklyData, 1200);

  useEffect(() => {
    const channel = supabase
      .channel("team-performance-breakdown-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "daily_production" },
        () => debouncedRefetch()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [debouncedRefetch]);

  const handleWeekClick = (week: WeeklyStats) => {
    if (expandedWeek === week.weekStart) {
      setExpandedWeek(null);
      setAgentBreakdown([]);
    } else {
      setExpandedWeek(week.weekStart);
      fetchWeekBreakdown(week.weekStart, week.weekEnd);
    }
  };

  // Don't render for non-managers/admins
  if (!isManager && !isAdmin) {
    return null;
  }

  if (loading) {
    return (
      <GlassCard className="p-6">
        <div className="flex items-center gap-3 mb-6">
          <Skeleton className="h-12 w-12 rounded-xl" />
          <div>
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-32 mt-1" />
          </div>
        </div>
        <div className="space-y-3">
          {[1, 2, 3, 4].map(i => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      </GlassCard>
    );
  }

  return (
    <div className="transition-opacity duration-100">
      <GlassCard className="p-6 relative">
        {/* Powered by Apex watermark */}
        <div className="absolute top-3 right-4">
          <p className="text-[9px] text-muted-foreground/50 uppercase tracking-widest">
            Powered by <span className="font-semibold text-primary/60">Apex</span>
          </p>
        </div>

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
            <BarChart3 className="h-6 w-6 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold">Performance Breakdown</h2>
            <p className="text-sm text-muted-foreground">
              Click any week to see agent breakdown
            </p>
          </div>
        </div>

        {/* Weekly Cards */}
        <div className="space-y-3">
          {weeklyData.map((week, index) => (
            <div key={week.weekStart}>
              <motion.button
                onClick={() => handleWeekClick(week)}
                className={cn(
                  "w-full p-4 rounded-xl border transition-all text-left",
                  expandedWeek === week.weekStart
                    ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                    : "border-border/50 hover:border-primary/50 hover:bg-muted/30"
                )}
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
              >
                {/* Week Header */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    {expandedWeek === week.weekStart ? (
                      <ChevronDown className="h-4 w-4 text-primary" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span className="font-semibold">{week.weekLabel}</span>
                    {index === 0 && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                        CURRENT
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {week.agentCount} agent{week.agentCount !== 1 ? 's' : ''} active
                  </span>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-4 gap-3">
                  <div className="text-center p-2 rounded-lg bg-background/50">
                    <div className="flex items-center justify-center gap-1 text-primary mb-1">
                      <DollarSign className="h-3 w-3" />
                    </div>
                    <p className="text-lg font-bold">${week.totalALP.toLocaleString()}</p>
                    <p className="text-[10px] text-muted-foreground">ALP</p>
                  </div>

                  <div className="text-center p-2 rounded-lg bg-background/50">
                    <div className="flex items-center justify-center gap-1 text-emerald-500 mb-1">
                      <Target className="h-3 w-3" />
                    </div>
                    <p className="text-lg font-bold">{week.totalDeals}</p>
                    <p className="text-[10px] text-muted-foreground">Deals</p>
                  </div>

                  <div className="text-center p-2 rounded-lg bg-background/50">
                    <div className="flex items-center justify-center gap-1 text-violet-500 mb-1">
                      <Presentation className="h-3 w-3" />
                    </div>
                    <p className="text-lg font-bold">{week.totalPresentations}</p>
                    <p className="text-[10px] text-muted-foreground">Presentations</p>
                  </div>

                  <div className="text-center p-2 rounded-lg bg-background/50">
                    <div className="flex items-center justify-center gap-1 text-amber-500 mb-1">
                      <TrendingUp className="h-3 w-3" />
                    </div>
                    <p className="text-lg font-bold">{week.closeRate}%</p>
                    <p className="text-[10px] text-muted-foreground">Close Rate</p>
                  </div>
                </div>
              </motion.button>

              {/* Expanded Agent Breakdown */}
              <AnimatePresence>
                {expandedWeek === week.weekStart && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-2 ml-6 p-4 rounded-xl bg-muted/20 border border-border/30">
                      <div className="flex items-center gap-2 mb-3">
                        <Users className="h-4 w-4 text-primary" />
                        <span className="text-sm font-semibold">Agent Breakdown</span>
                      </div>

                      {breakdownLoading ? (
                        <div className="space-y-2">
                          {[1, 2, 3].map(i => (
                            <Skeleton key={i} className="h-12 rounded-lg" />
                          ))}
                        </div>
                      ) : agentBreakdown.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-4">
                          No production data for this week
                        </p>
                      ) : (
                        <ScrollArea className="max-h-60">
                          <div className="space-y-2 pr-2">
                            {agentBreakdown.map((agent, agentIndex) => (
                              <div
                                key={agent.id}
                                className="flex items-center justify-between p-3 rounded-lg bg-background/50 hover:bg-background/80 transition-colors"
                              >
                                <div className="flex items-center gap-3">
                                  <span className="text-xs font-bold text-muted-foreground w-5">
                                    #{agentIndex + 1}
                                  </span>
                                  <span className="font-medium text-sm">{agent.name}</span>
                                </div>
                                <div className="flex items-center gap-4 text-xs">
                                  <span className="text-primary font-semibold">
                                    ${agent.aop.toLocaleString()}
                                  </span>
                                  <span className="text-emerald-500">
                                    {agent.deals} deals
                                  </span>
                                  <span className="text-violet-500">
                                    {agent.presentations} sits
                                  </span>
                                  <span className={cn("font-semibold", getClosingRateColor(agent.closeRate).textClass)}>
                                    {agent.closeRate}%
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </ScrollArea>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}
