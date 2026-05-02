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
  Users,
} from "lucide-react";
import { addDays, format, startOfWeek, subWeeks } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { GlassCard } from "@/components/ui/glass-card";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useProductionRealtime } from "@/hooks/useProductionRealtime";
import { getClosingRateColor } from "@/lib/closingRateColors";
import { BUSINESS_TIMEZONE, getBusinessDayBounds, getBusinessNow } from "@/lib/dateUtils";
import { getCloseRate, sumAnnualPremium } from "@/lib/metricTruth";

interface WeeklyStats {
  weekLabel: string;
  weekStart: string;
  weekEnd: string;
  totalALP: number;
  totalDeals: number;
  totalPresentations: number;
  closeRate: number;
  agentCount: number;
  startIso: string;
  endIso: string;
}

interface AgentBreakdown {
  id: string;
  name: string;
  alp: number;
  deals: number;
  presentations: number;
  closeRate: number;
}

function buildWeekWindow(baseDate: Date, offset: number): WeeklyStats {
  const weekStartDate = startOfWeek(subWeeks(baseDate, offset), { weekStartsOn: 1 });
  const weekStart = format(weekStartDate, "yyyy-MM-dd");
  const weekEndDate = addDays(weekStartDate, 6);
  const weekEnd = format(weekEndDate, "yyyy-MM-dd");
  const start = fromZonedTime(`${weekStart}T00:00:00`, BUSINESS_TIMEZONE);
  const rawEnd = offset === 0
    ? getBusinessDayBounds().end
    : fromZonedTime(`${format(addDays(weekStartDate, 7), "yyyy-MM-dd")}T00:00:00`, BUSINESS_TIMEZONE);

  return {
    weekLabel: offset === 0 ? "This Week" : offset === 1 ? "Last Week" : `Week of ${format(weekStartDate, "MMM d")}`,
    weekStart,
    weekEnd,
    totalALP: 0,
    totalDeals: 0,
    totalPresentations: 0,
    closeRate: 0,
    agentCount: 0,
    startIso: start.toISOString(),
    endIso: rawEnd.toISOString(),
  };
}

export function TeamPerformanceBreakdown() {
  const { user, isAdmin, isManager, isLoading: authLoading } = useAuth();
  const [weeklyData, setWeeklyData] = useState<WeeklyStats[]>([]);
  const [expandedWeek, setExpandedWeek] = useState<string | null>(null);
  const [agentBreakdown, setAgentBreakdown] = useState<AgentBreakdown[]>([]);
  const [loading, setLoading] = useState(true);
  const [breakdownLoading, setBreakdownLoading] = useState(false);

  const resolveAgentIds = useCallback(async (): Promise<string[]> => {
    if (!user) return [];

    if (isAdmin) {
      const { data: allAgents } = await supabase.from("agents").select("id");
      return allAgents?.map((agent) => agent.id) || [];
    }

    if (isManager) {
      const { data: currentAgent } = await supabase
        .from("agents")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!currentAgent) return [];

      const { data: downlineAgents } = await supabase
        .from("agents")
        .select("id")
        .eq("invited_by_manager_id", currentAgent.id);

      return [currentAgent.id, ...(downlineAgents?.map((agent) => agent.id) || [])];
    }

    return [];
  }, [user, isAdmin, isManager]);

  const fetchWeeklyData = useCallback(async () => {
    if (!user || authLoading) return;

    if (!isManager && !isAdmin) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const agentIds = await resolveAgentIds();

      if (agentIds.length === 0) {
        setWeeklyData([]);
        return;
      }

      const baseDate = getBusinessNow();
      const weeks = Array.from({ length: 4 }, (_, index) => buildWeekWindow(baseDate, index));
      const oldestWeek = weeks[weeks.length - 1];
      const currentWeek = weeks[0];

      const [{ data: dealsRows }, { data: productionRows }] = await Promise.all([
        supabase
          .from("deals")
          .select("annual_premium, agent_id, posted_at")
          .in("agent_id", agentIds)
          .gte("posted_at", oldestWeek.startIso)
          .lt("posted_at", currentWeek.endIso)
          .in("status", ["submitted", "active"]),
        supabase
          .from("daily_production")
          .select("presentations, agent_id, production_date")
          .in("agent_id", agentIds)
          .gte("production_date", oldestWeek.weekStart)
          .lte("production_date", currentWeek.weekEnd),
      ]);

      const rowsByWeek = weeks.map((week) => {
        const weekDeals = (dealsRows ?? []).filter((deal: any) => {
          return Boolean(deal.posted_at) && deal.posted_at >= week.startIso && deal.posted_at < week.endIso;
        });
        const weekProduction = (productionRows ?? []).filter((row: any) => {
          return row.production_date >= week.weekStart && row.production_date <= week.weekEnd;
        });
        const agentCount = new Set([
          ...weekDeals.map((deal: any) => deal.agent_id).filter(Boolean),
          ...weekProduction.map((row: any) => row.agent_id).filter(Boolean),
        ]).size;
        const totalDeals = weekDeals.length;
        const totalPresentations = weekProduction.reduce(
          (sum: number, row: any) => sum + Number(row.presentations || 0),
          0,
        );

        return {
          ...week,
          totalALP: sumAnnualPremium(weekDeals as Array<{ annual_premium?: number | null }>),
          totalDeals,
          totalPresentations,
          closeRate: Math.round(getCloseRate(totalDeals, totalPresentations)),
          agentCount,
        };
      });

      setWeeklyData(rowsByWeek);
    } catch (error) {
      console.error("Error fetching weekly data:", error);
    } finally {
      setLoading(false);
    }
  }, [user, authLoading, isAdmin, isManager, resolveAgentIds]);

  const fetchWeekBreakdown = useCallback(async (selectedWeek: WeeklyStats) => {
    if (!user) return;

    setBreakdownLoading(true);
    try {
      const agentIds = await resolveAgentIds();

      const [{ data: dealsRows }, { data: productionRows }, { data: agentRows }] = await Promise.all([
        supabase
          .from("deals")
          .select("annual_premium, agent_id")
          .in("agent_id", agentIds)
          .gte("posted_at", selectedWeek.startIso)
          .lt("posted_at", selectedWeek.endIso)
          .in("status", ["submitted", "active"]),
        supabase
          .from("daily_production")
          .select("presentations, agent_id")
          .in("agent_id", agentIds)
          .gte("production_date", selectedWeek.weekStart)
          .lte("production_date", selectedWeek.weekEnd),
        supabase
          .from("agents")
          .select("id, profile:profiles!agents_profile_id_fkey(full_name)")
          .in("id", agentIds),
      ]);

      const names = new Map(
        (agentRows ?? []).map((row: any) => [row.id, row.profile?.full_name || "Unknown"]),
      );
      const agentMap = new Map<string, AgentBreakdown>();

      (dealsRows ?? []).forEach((deal: any) => {
        const agentId = deal.agent_id;
        if (!agentId) return;
        if (!agentMap.has(agentId)) {
          agentMap.set(agentId, {
            id: agentId,
            name: names.get(agentId) || "Unknown",
            alp: 0,
            deals: 0,
            presentations: 0,
            closeRate: 0,
          });
        }
        const agent = agentMap.get(agentId)!;
        agent.alp += Number(deal.annual_premium) || 0;
        agent.deals += 1;
      });

      (productionRows ?? []).forEach((row: any) => {
        const agentId = row.agent_id;
        if (!agentId) return;
        if (!agentMap.has(agentId)) {
          agentMap.set(agentId, {
            id: agentId,
            name: names.get(agentId) || "Unknown",
            alp: 0,
            deals: 0,
            presentations: 0,
            closeRate: 0,
          });
        }
        const agent = agentMap.get(agentId)!;
        agent.presentations += Number(row.presentations) || 0;
      });

      const sortedAgents = Array.from(agentMap.values())
        .map((agent) => ({
          ...agent,
          closeRate: Math.round(getCloseRate(agent.deals, agent.presentations)),
        }))
        .sort((a, b) => b.alp - a.alp);

      setAgentBreakdown(sortedAgents);
    } catch (error) {
      console.error("Error fetching week breakdown:", error);
    } finally {
      setBreakdownLoading(false);
    }
  }, [user, resolveAgentIds]);

  useEffect(() => {
    if (!authLoading && user) {
      fetchWeeklyData();
    }
  }, [fetchWeeklyData, authLoading, user]);

  useProductionRealtime(fetchWeeklyData, 300);

  const handleWeekClick = (week: WeeklyStats) => {
    if (expandedWeek === week.weekStart) {
      setExpandedWeek(null);
      setAgentBreakdown([]);
      return;
    }

    setExpandedWeek(week.weekStart);
    fetchWeekBreakdown(week);
  };

  if (!isManager && !isAdmin) {
    return null;
  }

  if (loading) {
    return (
      <GlassCard className="p-6">
        <div className="mb-6 flex items-center gap-3">
          <Skeleton className="h-12 w-12 rounded-xl" />
          <div>
            <Skeleton className="h-6 w-48" />
            <Skeleton className="mt-1 h-4 w-32" />
          </div>
        </div>
        <div className="space-y-3">
          {[1, 2, 3, 4].map((index) => (
            <Skeleton key={index} className="h-20 rounded-xl" />
          ))}
        </div>
      </GlassCard>
    );
  }

  return (
    <div className="transition-opacity duration-100">
      <GlassCard className="relative p-6">
        <div className="absolute right-4 top-3">
          <p className="text-[9px] uppercase tracking-widest text-muted-foreground/50">
            Powered by <span className="font-semibold text-primary/60">Apex</span>
          </p>
        </div>

        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-purple-600">
            <BarChart3 className="h-6 w-6 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold">Performance Breakdown</h2>
            <p className="text-sm text-muted-foreground">
              Calendar weeks in Chicago time. ALP comes from posted deals; presentations come from logged production.
            </p>
          </div>
        </div>

        <div className="space-y-3">
          {weeklyData.map((week, index) => (
            <div key={week.weekStart}>
              <motion.button
                onClick={() => handleWeekClick(week)}
                className={cn(
                  "w-full rounded-xl border p-4 text-left transition-all",
                  expandedWeek === week.weekStart
                    ? "bg-primary/5 ring-2 ring-primary/20 border-primary"
                    : "border-border/50 hover:border-primary/50 hover:bg-muted/30",
                )}
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
              >
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {expandedWeek === week.weekStart ? (
                      <ChevronDown className="h-4 w-4 text-primary" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span className="font-semibold">{week.weekLabel}</span>
                    {index === 0 && (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                        CURRENT
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {week.agentCount} agent{week.agentCount !== 1 ? "s" : ""} active
                  </span>
                </div>

                <div className="grid grid-cols-4 gap-3">
                  <div className="rounded-lg bg-background/50 p-2 text-center">
                    <div className="mb-1 flex items-center justify-center gap-1 text-primary">
                      <DollarSign className="h-3 w-3" />
                    </div>
                    <p className="text-lg font-bold">${week.totalALP.toLocaleString()}</p>
                    <p className="text-[10px] text-muted-foreground">ALP</p>
                  </div>

                  <div className="rounded-lg bg-background/50 p-2 text-center">
                    <div className="mb-1 flex items-center justify-center gap-1 text-emerald-500">
                      <Target className="h-3 w-3" />
                    </div>
                    <p className="text-lg font-bold">{week.totalDeals}</p>
                    <p className="text-[10px] text-muted-foreground">Deals</p>
                  </div>

                  <div className="rounded-lg bg-background/50 p-2 text-center">
                    <div className="mb-1 flex items-center justify-center gap-1 text-violet-500">
                      <Presentation className="h-3 w-3" />
                    </div>
                    <p className="text-lg font-bold">{week.totalPresentations}</p>
                    <p className="text-[10px] text-muted-foreground">Presentations</p>
                  </div>

                  <div className="rounded-lg bg-background/50 p-2 text-center">
                    <div className="mb-1 flex items-center justify-center gap-1 text-amber-500">
                      <TrendingUp className="h-3 w-3" />
                    </div>
                    <p className="text-lg font-bold">{week.closeRate}%</p>
                    <p className="text-[10px] text-muted-foreground">Close Rate</p>
                  </div>
                </div>
              </motion.button>

              <AnimatePresence>
                {expandedWeek === week.weekStart && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-2 ml-6 rounded-xl border border-border/30 bg-muted/20 p-4">
                      <div className="mb-3 flex items-center gap-2">
                        <Users className="h-4 w-4 text-primary" />
                        <span className="text-sm font-semibold">Agent Breakdown</span>
                      </div>

                      {breakdownLoading ? (
                        <div className="space-y-2">
                          {[1, 2, 3].map((index) => (
                            <Skeleton key={index} className="h-12 rounded-lg" />
                          ))}
                        </div>
                      ) : agentBreakdown.length === 0 ? (
                        <p className="py-4 text-center text-sm text-muted-foreground">
                          No production data for this week
                        </p>
                      ) : (
                        <ScrollArea className="max-h-60">
                          <div className="space-y-2 pr-2">
                            {agentBreakdown.map((agent, agentIndex) => (
                              <div
                                key={agent.id}
                                className="flex items-center justify-between rounded-lg bg-background/50 p-3 transition-colors hover:bg-background/80"
                              >
                                <div className="flex items-center gap-3">
                                  <span className="w-5 text-xs font-bold text-muted-foreground">
                                    #{agentIndex + 1}
                                  </span>
                                  <span className="text-sm font-medium">{agent.name}</span>
                                </div>
                                <div className="flex items-center gap-4 text-xs">
                                  <span className="font-semibold text-primary">
                                    ${agent.alp.toLocaleString()}
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
