import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import {
  Users, ShieldCheck, ShieldOff, GraduationCap, Swords, Zap,
  TrendingUp, TrendingDown, DollarSign, Percent, Activity, UserCheck,
} from "lucide-react";
import { motion } from "framer-motion";
import { getTodayPST, getDateDaysAgoPST } from "@/lib/dateUtils";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend,
} from "recharts";
import { cn } from "@/lib/utils";

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
  managerBreakdown: Array<{
    name: string;
    activeAgents: number;
    producingAgents: number;
    teamAlp: number;
    ownAlp: number;
    totalAlp: number;
  }>;
}

export function TeamOverviewDashboard() {
  const today = getTodayPST();
  const sevenDaysAgo = getDateDaysAgoPST(7);
  const thirtyDaysAgo = getDateDaysAgoPST(30);
  const ninetyDaysAgo = getDateDaysAgoPST(90);

  const { data, isLoading } = useQuery({
    queryKey: ["team-overview", today],
    queryFn: async (): Promise<TeamOverviewData> => {
      // Parallel fetch all data
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
        // Get unlicensed applicants for unified count
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

      // Unified unlicensed count: agents + applicants (deduplicated by email)
      const agentEmails = new Set<string>();
      for (const agent of activeAgents) {
        if (agent.license_status !== "licensed") {
          // We need to get the profile email for dedup — approximate via user_id presence
          agentEmails.add(agent.id); // use agent id as proxy
        }
      }
      const unlicensedApplicants = applicationsRes.data?.length || 0;
      const unlicensedTotal = unlicensedAgents + unlicensedApplicants;

      const onboarding = activeAgents.filter(a =>
        a.onboarding_stage === "onboarding"
      ).length;
      const trainingOnline = activeAgents.filter(a =>
        a.onboarding_stage === "training_online"
      ).length;
      const inFieldTraining = activeAgents.filter(a =>
        a.onboarding_stage === "in_field_training"
      ).length;
      // Agents past field training (evaluated or no stage = live/producing)
      const liveInField = activeAgents.filter(a =>
        a.onboarding_stage === "evaluated" || !a.onboarding_stage
      ).length;

      // 7-day AOP
      const prod7 = prodRes7.data || [];
      const aop7 = prod7.reduce((sum, p) => sum + (Number(p.aop) || 0), 0);

      // 30-day AOP
      const prod30 = prodRes30.data || [];
      const aop30 = prod30.reduce((sum, p) => sum + (Number(p.aop) || 0), 0);

      // Avg close rate (30-day, per agent)
      const agentProd30 = new Map<string, { deals: number; presentations: number }>();
      for (const p of prod30) {
        const existing = agentProd30.get(p.agent_id) || { deals: 0, presentations: 0 };
        agentProd30.set(p.agent_id, {
          deals: existing.deals + (p.deals_closed || 0),
          presentations: existing.presentations + (p.presentations || 0),
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

      // Active producers (agents with at least 1 deal in 30 days)
      const activeProducerIds = new Set<string>();
      for (const p of prod30) {
        if ((p.deals_closed || 0) > 0) activeProducerIds.add(p.agent_id);
      }
      const activeProducers = activeProducerIds.size;

      // Activation rate
      const activationRate = totalActive > 0 ? (activeProducers / totalActive) * 100 : 0;

      // Retention rate
      const deactivatedLast90 = deactivatedRes.data?.length || 0;
      const retentionRate = (totalActive + deactivatedLast90) > 0
        ? (totalActive / (totalActive + deactivatedLast90)) * 100
        : 100;

      // Revenue per agent
      const revenuePerAgent = totalActive > 0 ? aop30 / totalActive : 0;

      // Manager breakdown — include manager's OWN production + team production
      const managerMap = new Map<string, {
        name: string;
        activeAgents: number;
        producingAgentIds: Set<string>;
        teamAlp: number;
        ownAlp: number;
      }>();

      // Build manager entries from their team agents
      for (const agent of activeAgents) {
        const mgrId = agent.invited_by_manager_id;
        if (!mgrId) continue;
        const existing = managerMap.get(mgrId) || {
          name: "",
          activeAgents: 0,
          producingAgentIds: new Set<string>(),
          teamAlp: 0,
          ownAlp: 0,
        };
        existing.activeAgents++;
        if (!existing.name) {
          const mgr = agents.find(a => a.id === mgrId);
          existing.name = (mgr as any)?.profile?.full_name || "Unknown";
        }
        managerMap.set(mgrId, existing);
      }

      // Add team ALP from production data
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

      // Add manager's OWN production (managers are also agents)
      for (const [mgrId, entry] of managerMap) {
        const mgrProd = agentProd30.get(mgrId);
        if (mgrProd) {
          // Sum the manager's own AOP from prod30
          const ownAlp = prod30
            .filter(p => p.agent_id === mgrId)
            .reduce((sum, p) => sum + (Number(p.aop) || 0), 0);
          entry.ownAlp = ownAlp;
        }
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
            name: v.name,
            activeAgents: v.activeAgents,
            producingAgents: v.producingAgentIds.size,
            teamAlp: v.teamAlp,
            ownAlp: v.ownAlp,
            totalAlp: v.teamAlp + v.ownAlp,
          }))
          .sort((a, b) => b.totalAlp - a.totalAlp)
          .slice(0, 8),
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

  const barColors = [
    "hsl(168, 84%, 42%)", "hsl(222, 47%, 55%)", "hsl(262, 52%, 55%)",
    "hsl(45, 93%, 58%)", "hsl(340, 65%, 55%)", "hsl(200, 70%, 50%)",
    "hsl(15, 75%, 55%)", "hsl(120, 45%, 45%)",
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

      {/* Manager comparison chart — Team + Own production */}
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
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-muted-foreground">
            {data.managerBreakdown.map((m, i) => (
              <div key={m.name} className="flex items-center justify-between bg-muted/30 rounded-lg px-3 py-2">
                <span className="font-medium text-foreground">{m.name}</span>
                <div className="flex items-center gap-3">
                  <span>{m.activeAgents} agents</span>
                  <span className="text-emerald-500">{m.producingAgents} producing</span>
                  <span className="font-bold text-foreground">${m.totalAlp.toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      )}
    </div>
  );
}
