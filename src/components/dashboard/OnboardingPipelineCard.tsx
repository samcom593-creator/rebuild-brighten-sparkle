import { motion } from "framer-motion";
import { Users, BookOpen, Briefcase, Award, GraduationCap } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";

interface AgentPeek {
  name: string;
  lastContactedAt: string | null;
}

interface PipelineStage {
  stage: string;
  label: string;
  count: number;
  icon: React.ReactNode;
  color: string;
  agents: AgentPeek[];
}

async function fetchPipeline(userId: string, isAdmin: boolean): Promise<PipelineStage[]> {
  const { data: currentAgent } = await supabase
    .from("agents")
    .select("id")
    .eq("user_id", userId)
    .eq("is_deactivated", false)
    .maybeSingle();

  if (!currentAgent) return [];

  let query = supabase
    .from("agents")
    .select("id, display_name, profile_id, onboarding_stage, license_status, has_training_course")
    .eq("is_deactivated", false);

  if (!isAdmin) {
    query = query.eq("invited_by_manager_id", currentAgent.id);
  }

  const { data: agents } = await query;
  if (!agents) return [];

  const profileIds = agents.map(a => a.profile_id).filter(Boolean) as string[];
  const { data: profiles } = profileIds.length > 0
    ? await supabase.from("profiles").select("id, full_name").in("id", profileIds)
    : { data: null };
  const profileMap = new Map<string, string>(
    (profiles ?? []).map(p => [p.id, p.full_name ?? "Unknown"] as [string, string])
  );

  // Get last contact info from applications
  const agentIds = agents.map(a => a.id);
  const { data: apps } = agentIds.length > 0
    ? await supabase.from("applications").select("assigned_agent_id, last_contacted_at").in("assigned_agent_id", agentIds).is("terminated_at", null).order("last_contacted_at", { ascending: false, nullsFirst: false })
    : { data: null };
  const contactMap = new Map<string, string | null>();
  apps?.forEach(a => {
    if (a.assigned_agent_id && !contactMap.has(a.assigned_agent_id)) {
      contactMap.set(a.assigned_agent_id, a.last_contacted_at);
    }
  });

  const stageAgents: Record<string, AgentPeek[]> = {
    onboarding: [], training_online: [], in_field_training: [], evaluated: [],
  };
  const preLicensingAgents: AgentPeek[] = [];

  agents.forEach(agent => {
    const name = agent.display_name || profileMap.get(agent.profile_id ?? "") || "Unknown";
    const peek: AgentPeek = { name, lastContactedAt: contactMap.get(agent.id) ?? null };
    const stage = agent.onboarding_stage || "onboarding";
    if (stageAgents[stage]) stageAgents[stage].push(peek);
    if (agent.license_status !== "licensed" && agent.has_training_course === true) {
      preLicensingAgents.push(peek);
    }
  });

  return [
    { stage: "pre_licensing", label: "Pre-Licensing", count: preLicensingAgents.length, icon: <GraduationCap className="h-4 w-4" />, color: "text-amber-500 bg-amber-500/10", agents: preLicensingAgents.slice(0, 3) },
    { stage: "onboarding", label: "Onboarding", count: stageAgents.onboarding.length, icon: <Users className="h-4 w-4" />, color: "text-blue-500 bg-blue-500/10", agents: stageAgents.onboarding.slice(0, 3) },
    { stage: "training_online", label: "Training Online", count: stageAgents.training_online.length, icon: <BookOpen className="h-4 w-4" />, color: "text-cyan-500 bg-cyan-500/10", agents: stageAgents.training_online.slice(0, 3) },
    { stage: "in_field_training", label: "Field Training", count: stageAgents.in_field_training.length, icon: <Briefcase className="h-4 w-4" />, color: "text-violet-500 bg-violet-500/10", agents: stageAgents.in_field_training.slice(0, 3) },
    { stage: "evaluated", label: "Evaluated", count: stageAgents.evaluated.length, icon: <Award className="h-4 w-4" />, color: "text-emerald-500 bg-emerald-500/10", agents: stageAgents.evaluated.slice(0, 3) },
  ];
}

export function OnboardingPipelineCard() {
  const { user, isAdmin } = useAuth();

  const { data: stages = [], isLoading } = useQuery({
    queryKey: ["onboarding-pipeline", user?.id, isAdmin],
    queryFn: () => fetchPipeline(user!.id, isAdmin),
    enabled: !!user,
  });

  const totalAgents = stages.reduce((sum, s) => sum + s.count, 0);

  if (isLoading) {
    return (
      <GlassCard className="p-5">
        <div className="animate-pulse space-y-3">
          <div className="h-5 bg-muted rounded w-1/3" />
          <div className="grid grid-cols-4 gap-2">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-16 bg-muted rounded" />
            ))}
          </div>
        </div>
      </GlassCard>
    );
  }

  if (totalAgents === 0) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
    >
      <GlassCard className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            Onboarding Pipeline
          </h3>
          <span className="text-xs text-muted-foreground">{totalAgents} total</span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {stages.map((stage, index) => (
            <motion.div
              key={stage.stage}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: index * 0.1 }}
              className="relative"
            >
              <div className="bg-background/50 rounded-lg p-3 border border-border/50 text-center">
                <div className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center mx-auto mb-2",
                  stage.color
                )}>
                  {stage.icon}
                </div>
                <p className="text-2xl font-bold">{stage.count}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">
                  {stage.label}
                </p>
                {stage.agents.length > 0 && (
                  <div className="mt-1 space-y-0.5 text-left">
                    {stage.agents.map((a, ai) => {
                      const hrs = a.lastContactedAt ? (Date.now() - new Date(a.lastContactedAt).getTime()) / 36e5 : null;
                      const dot = hrs === null ? "bg-red-400" : hrs < 24 ? "bg-emerald-400" : hrs < 48 ? "bg-amber-400" : "bg-red-400";
                      return (
                        <p key={ai} className="text-[9px] text-muted-foreground truncate flex items-center gap-1">
                          <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", dot)} />
                          {a.name.split(" ")[0]}
                        </p>
                      );
                    })}
                    {stage.count > 3 && (
                      <p className="text-[9px] text-muted-foreground/60">+{stage.count - 3} more</p>
                    )}
                  </div>
                )}
              </div>
              
              {index < stages.length - 1 && (
                <div className="hidden md:block absolute top-1/2 -right-1.5 w-3 h-0.5 bg-border" />
              )}
            </motion.div>
          ))}
        </div>
      </GlassCard>
    </motion.div>
  );
}
