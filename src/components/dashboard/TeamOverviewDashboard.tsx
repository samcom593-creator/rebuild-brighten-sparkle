import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import {
  Users, ShieldCheck, ShieldOff, GraduationCap, Swords, Zap,
  TrendingUp, TrendingDown, DollarSign, Percent, Activity, UserCheck,
  ChevronDown, ChevronUp,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { getTodayPST, getDateDaysAgoPST } from "@/lib/dateUtils";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

interface ManagerAgent {
  id: string;
  name: string;
  onboardingStage: string | null;
  aop30: number;
  deals30: number;
}

interface ManagerBreakdownEntry {
  id: string;
  name: string;
  activeAgents: number;
  producingAgents: number;
  teamAlp: number;
  ownAlp: number;
  totalAlp: number;
  agents: ManagerAgent[];
}

interface TeamOverviewData {
  totalActive: number;
  licensed: number;
  unlicensedAgents: number;
  unlicensedTotal: number;
  onboarding: number;
  inFieldTraining: number;
  trainingOnline: number;
  liveInField: number;
  activeProducers: number;
  aop7: number;
  aop30: number;
  avgCloseRate: number;
  activationRate: number;
  retentionRate: number;
  revenuePerAgent: number;
  managerBreakdown: ManagerBreakdownEntry[];
}

const STAGE_LABELS: Record<string, string> = {
  onboarding: "Onboarding",
  training_online: "Training",
  in_field_training: "Field Training",
  evaluated: "Live",
};

export function TeamOverviewDashboard() {
  const today = getTodayPST();
  const sevenDaysAgo = getDateDaysAgoPST(7);
  const thirtyDaysAgo = getDateDaysAgoPST(30);
  const ninetyDaysAgo = getDateDaysAgoPST(90);
  const [expandedManager, setExpandedManager] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["team-overview", today],
    queryFn: async (): Promise<TeamOverviewData> => {
      const [agentsRes, prodRes7, prodRes30, deactivatedRes, applicationsRes] = await Promise.all([
        supabase
          .from("agents")
          .select("id, is_deactivated, is_inactive, license_status, onboarding_stage, invited_by_manager_id, user_id, profile:profiles!agents_profile_id_fkey(full_name)"),
        supabase
          .from("daily_production")
          .select("agent_id, aop, deals_closed, presentations")
          .gte("production_date", sevenDaysAgo)
          .lte("production_date", today),
        supabase
          .from("daily_production")
          .select("agent_id, aop, deals_closed, presentations")
          .gte("production_date", thirtyDaysAgo)
          .lte("production_date", today),
        supabase
          .from("agents")
          .select("id")
          .eq("is_deactivated", true)
          .gte("updated_at", ninetyDaysAgo),
        supabase
          .from("applications")
          .select("id, license_status, email")
          .in("status", ["reviewing", "contracting", "approved", "new"])
          .neq("license_status", "licensed")
          .is("terminated_at", null),
      ]);

      const agents = agentsRes.data || [];
      const activeAgents = agents.filter(a => !a.is_deactivated && !a.is_inactive);
      const totalActive = activeAgents.length;

      const licensed = activeAgents.filter(a => a.license_status === "licensed").length;
      const unlicensedAgents = activeAgents.filter(a => a.license_status !== "licensed").length;
      const unlicensedApplicants = applicationsRes.data?.length || 0;
      const unlicensedTotal = unlicensedAgents + unlicensedApplicants;

      const onboarding = activeAgents.filter(a => a.onboarding_stage === "onboarding").length;
      const trainingOnline = activeAgents.filter(a => a.onboarding_stage === "training_online").length;
      const inFieldTraining = activeAgents.filter(a => a.onboarding_stage === "in_field_training").length;
      const liveInField = activeAgents.filter(a => a.onboarding_stage === "evaluated" || !a.onboarding_stage).length;

      const prod7 = prodRes7.data || [];
      const aop7 = prod7.reduce((sum, p) => sum + (Number(p.aop) || 0), 0);

      const prod30 = prodRes30.data || [];
      const aop30 = prod30.reduce((sum, p) => sum + (Number(p.aop) || 0), 0);

      const agentProd30 = new Map<string, { deals: number; presentations: number; aop: number }>();
      for (const p of prod30) {
        const existing = agentProd30.get(p.agent_id) || { deals: 0, presentations: 0, aop: 0 };
        agentProd30.set(p.agent_id, {
          deals: existing.deals + (p.deals_closed || 0),
          presentations: existing.presentations + (p.presentations || 0),
          aop: existing.aop + (Number(p.aop) || 0),
        });
      }

      let totalCloseRate = 0;
      let closeRateCount = 0;
      agentProd30.forEach(v => {
        if (v.presentations > 0) {
          totalCloseRate += (v.deals / v.presentations) * 100;
          closeRateCount++;
        }
      });
      const avgCloseRate = closeRateCount > 0 ? totalCloseRate / closeRateCount : 0;

      const activeProducerIds = new Set<string>();
      for (const p of prod30) {
        if ((p.deals_closed || 0) > 0) activeProducerIds.add(p.agent_id);
      }
      const activeProducers = activeProducerIds.size;
      const activationRate = totalActive > 0 ? (activeProducers / totalActive) * 100 : 0;

      const deactivatedLast90 = deactivatedRes.data?.length || 0;
      const retentionRate = (totalActive + deactivatedLast90) > 0
        ? (totalActive / (totalActive + deactivatedLast90)) * 100
        : 100;
      const revenuePerAgent = totalActive > 0 ? aop30 / totalActive : 0;

      // Manager breakdown with agent roster
      const managerMap = new Map<string, {
        name: string;
        activeAgents: number;
        producingAgentIds: Set<string>;
        teamAlp: number;
        ownAlp: number;
        agents: ManagerAgent[];
      }>();

      for (const agent of activeAgents) {
        const mgrId = agent.invited_by_manager_id;
        if (!mgrId) continue;
        const existing = managerMap.get(mgrId) || {
          name: "",
          activeAgents: 0,
          producingAgentIds: new Set<string>(),
          teamAlp: 0,
          ownAlp: 0,
          agents: [],
        };
        existing.activeAgents++;
        if (!existing.name) {
          const mgr = agents.find(a => a.id === mgrId);
          existing.name = (mgr as any)?.profile?.full_name || "Unknown";
        }
        const agentName = (agent as any)?.profile?.full_name || "Unknown";
        const agentProdData = agentProd30.get(agent.id);
        existing.agents.push({
          id: agent.id,
          name: agentName,
          onboardingStage: agent.onboarding_stage,
          aop30: agentProdData?.aop || 0,
          deals30: agentProdData?.deals || 0,
        });
        managerMap.set(mgrId, existing);
      }

      for (const p of prod30) {
        const agent = activeAgents.find(a => a.id === p.agent_id);
        if (!agent?.invited_by_manager_id) continue;
        const mgrEntry = managerMap.get(agent.invited_by_manager_id);
        if (mgrEntry) {
          mgrEntry.teamAlp += Number(p.aop) || 0;
          if ((p.deals_closed || 0) > 0 || (Number(p.aop) || 0) > 0) {
            mgrEntry.producingAgentIds.add(p.agent_id);
          }
        }
      }

      for (const [mgrId, entry] of managerMap) {
        const ownAlp = prod30
          .filter(p => p.agent_id === mgrId)
          .reduce((sum, p) => sum + (Number(p.aop) || 0), 0);
        entry.ownAlp = ownAlp;
      }

      return {
        totalActive,
        licensed,
        unlicensedAgents,
        unlicensedTotal,
        onboarding,
        inFieldTraining,
        trainingOnline,
        liveInField,
        activeProducers,
        aop7,
        aop30,
        avgCloseRate,
        activationRate,
        retentionRate,
        revenuePerAgent,
        managerBreakdown: Array.from(managerMap.entries())
          .map(([id, v]) => ({
            id,
            name: v.name,
            activeAgents: v.activeAgents,
            producingAgents: v.producingAgentIds.size,
            teamAlp: v.teamAlp,
            ownAlp: v.ownAlp,
            totalAlp: v.teamAlp + v.ownAlp,
            agents: v.agents.sort((a, b) => b.aop30 - a.aop30),
          }))
          .sort((a, b) => b.totalAlp - a.totalAlp)
          .slice(0, 10),
      };
    },
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-24 bg-muted/50 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  if (!data) return null;

  const metrics = [
    { label: "Active Agents", value: data.totalActive, icon: Users, color: "text-primary" },
    { label: "Licensed", value: data.licensed, icon: ShieldCheck, color: "text-emerald-500" },
    { label: "Unlicensed (Pipeline)", value: data.unlicensedTotal, icon: ShieldOff, color: "text-amber-500", subtitle: `${data.unlicensedAgents} hired` },
    { label: "Onboarding", value: data.onboarding, icon: GraduationCap, color: "text-blue-500" },
    { label: "Training Online", value: data.trainingOnline, icon: GraduationCap, color: "text-cyan-500" },
    { label: "Field Training", value: data.inFieldTraining, icon: Swords, color: "text-violet-500" },
    { label: "Live / Eligible", value: data.liveInField, icon: Zap, color: "text-emerald-500" },
    { label: "Active Producers", value: data.activeProducers, icon: Activity, color: "text-primary" },
  ];

  const financialMetrics = [
    { label: "7-Day AOP", value: data.aop7, currency: true, icon: DollarSign, color: "text-primary" },
    { label: "30-Day AOP", value: data.aop30, currency: true, icon: DollarSign, color: "text-emerald-500" },
    { label: "Avg Close Rate", value: data.avgCloseRate, suffix: "%", icon: Percent, color: "text-blue-500" },
    { label: "Activation Rate", value: data.activationRate, suffix: "%", icon: Activity, color: "text-violet-500" },
    { label: "Retention Rate", value: data.retentionRate, suffix: "%", icon: UserCheck, color: "text-emerald-500" },
    { label: "Rev / Agent", value: data.revenuePerAgent, currency: true, icon: TrendingUp, color: "text-primary" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Users className="h-5 w-5 text-primary" />
        <h3 className="text-lg font-bold">Team Overview</h3>
      </div>

      {/* Agent counts */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-4 gap-3">
        {metrics.map((m, i) => (
          <motion.div
            key={m.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
          >
            <GlassCard className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <m.icon className={cn("h-4 w-4", m.color)} />
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{m.label}</span>
              </div>
              <p className="text-2xl font-bold">
                <AnimatedCounter value={m.value} />
              </p>
              {"subtitle" in m && m.subtitle && (
                <p className="text-[10px] text-muted-foreground mt-0.5">{m.subtitle}</p>
              )}
            </GlassCard>
          </motion.div>
        ))}
      </div>

      {/* Financial metrics */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {financialMetrics.map((m, i) => (
          <motion.div
            key={m.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 + i * 0.05 }}
          >
            <GlassCard className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <m.icon className={cn("h-4 w-4", m.color)} />
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{m.label}</span>
              </div>
              <p className="text-2xl font-bold">
                {m.currency ? (
                  <AnimatedCounter value={Math.round(m.value)} prefix="$" formatOptions={{ maximumFractionDigits: 0 }} />
                ) : (
                  <AnimatedCounter value={Math.round(m.value)} formatOptions={{ maximumFractionDigits: 0 }} />
                )}
                {m.suffix && <span className="text-lg">{m.suffix}</span>}
              </p>
            </GlassCard>
          </motion.div>
        ))}
      </div>

      {/* Manager comparison chart + drillable roster */}
      {data.managerBreakdown.length > 0 && (
        <GlassCard className="p-5">
          <h4 className="text-sm font-bold mb-4 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            Manager Comparison — 30-Day ALP (Team + Personal)
          </h4>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.managerBreakdown} layout="vertical" margin={{ left: 10, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                <XAxis
                  type="number"
                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={110}
                  tick={{ fontSize: 11, fill: "hsl(var(--foreground))" }}
                />
                <Tooltip
                  formatter={(value: number, name: string) => [
                    `$${value.toLocaleString()}`,
                    name === "teamAlp" ? "Team ALP" : "Personal ALP",
                  ]}
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                    fontSize: 12,
                  }}
                />
                <Legend
                  formatter={(value) => value === "teamAlp" ? "Team ALP" : "Personal ALP"}
                  wrapperStyle={{ fontSize: 11 }}
                />
                <Bar dataKey="teamAlp" stackId="a" radius={[0, 0, 0, 0]} barSize={20} fill="hsl(168, 84%, 42%)" />
                <Bar dataKey="ownAlp" stackId="a" radius={[0, 6, 6, 0]} barSize={20} fill="hsl(222, 47%, 55%)" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Clickable manager rows with expandable agent roster */}
          <div className="mt-3 space-y-1">
            {data.managerBreakdown.map((m) => {
              const isExpanded = expandedManager === m.id;
              return (
                <div key={m.id}>
                  <button
                    onClick={() => setExpandedManager(isExpanded ? null : m.id)}
                    className={cn(
                      "w-full flex items-center justify-between rounded-lg px-3 py-2.5 text-left transition-colors",
                      isExpanded ? "bg-primary/10 border border-primary/20" : "bg-muted/30 hover:bg-muted/50"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      {isExpanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                      <span className="font-medium text-sm text-foreground">{m.name}</span>
                      <Badge variant="outline" className="text-[10px] h-5">{m.activeAgents} agents</Badge>
                      <Badge variant="outline" className="text-[10px] h-5 bg-emerald-500/10 text-emerald-500 border-emerald-500/20">{m.producingAgents} producing</Badge>
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <div className="text-right">
                        <span className="text-muted-foreground">Personal</span>
                        <span className="font-bold text-foreground ml-1.5">${m.ownAlp.toLocaleString()}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-muted-foreground">Team</span>
                        <span className="font-bold text-foreground ml-1.5">${m.teamAlp.toLocaleString()}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-muted-foreground">Total</span>
                        <span className="font-bold text-primary ml-1.5">${m.totalAlp.toLocaleString()}</span>
                      </div>
                    </div>
                  </button>

                  <AnimatePresence>
                    {isExpanded && m.agents.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className="ml-6 mt-1 mb-2 rounded-lg border border-border overflow-hidden">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="bg-muted/30 border-b">
                                <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Agent</th>
                                <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Stage</th>
                                <th className="text-right px-3 py-1.5 font-medium text-muted-foreground">30-Day AOP</th>
                                <th className="text-right px-3 py-1.5 font-medium text-muted-foreground">Deals</th>
                              </tr>
                            </thead>
                            <tbody>
                              {m.agents.map((agent) => (
                                <tr key={agent.id} className="border-b border-border/50 hover:bg-muted/20">
                                  <td className="px-3 py-1.5 font-medium">{agent.name}</td>
                                  <td className="px-3 py-1.5">
                                    <Badge variant="outline" className="text-[10px] h-4 px-1.5">
                                      {STAGE_LABELS[agent.onboardingStage || ""] || agent.onboardingStage || "—"}
                                    </Badge>
                                  </td>
                                  <td className="px-3 py-1.5 text-right font-semibold">
                                    {agent.aop30 > 0 ? `$${agent.aop30.toLocaleString()}` : "—"}
                                  </td>
                                  <td className="px-3 py-1.5 text-right">
                                    {agent.deals30 > 0 ? agent.deals30 : "—"}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </GlassCard>
      )}
    </div>
  );
}
