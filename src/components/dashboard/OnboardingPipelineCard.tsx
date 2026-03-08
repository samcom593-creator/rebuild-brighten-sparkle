import { useState } from "react";
import { Users, BookOpen, Briefcase, Award, GraduationCap, ChevronRight } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

interface AgentPeek {
  id: string;
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

  const agentIds = agents.map(a => a.id);
  const { data: apps } = agentIds.length > 0
    ? await supabase.from("applications").select("assigned_agent_id, last_contacted_at, license_progress").in("assigned_agent_id", agentIds).is("terminated_at", null).order("last_contacted_at", { ascending: false, nullsFirst: false })
    : { data: null };
  const contactMap = new Map<string, string | null>();
  // Build license_progress map from applications for agents that don't have agent-level data
  const appLicenseProgressMap = new Map<string, string>();
  apps?.forEach(a => {
    if (a.assigned_agent_id && !contactMap.has(a.assigned_agent_id)) {
      contactMap.set(a.assigned_agent_id, a.last_contacted_at);
    }
    // Track the most advanced license_progress per agent from applications
    if (a.assigned_agent_id && a.license_progress) {
      const progressOrder = ["unlicensed", "course_purchased", "finished_course", "test_scheduled", "passed_test", "fingerprints_done", "waiting_on_license", "licensed"];
      const current = appLicenseProgressMap.get(a.assigned_agent_id) || "unlicensed";
      if (progressOrder.indexOf(a.license_progress) > progressOrder.indexOf(current)) {
        appLicenseProgressMap.set(a.assigned_agent_id, a.license_progress);
      }
    }
  });

  const stageAgents: Record<string, AgentPeek[]> = {
    onboarding: [], training_online: [], in_field_training: [], evaluated: [],
  };
  const preLicensingAgents: AgentPeek[] = [];

  agents.forEach(agent => {
    const name = agent.display_name || profileMap.get(agent.profile_id ?? "") || "Unknown";
    const peek: AgentPeek = { id: agent.id, name, lastContactedAt: contactMap.get(agent.id) ?? null };
    const stage = agent.onboarding_stage || "onboarding";
    if (stageAgents[stage]) stageAgents[stage].push(peek);
    
    // Cross-reference: check both agent-level and application-level license data
    const appProgress = appLicenseProgressMap.get(agent.id);
    const isPreLicensing = agent.license_status !== "licensed" && (
      agent.has_training_course === true ||
      (appProgress && appProgress !== "unlicensed" && appProgress !== "licensed")
    );
    if (isPreLicensing) {
      preLicensingAgents.push(peek);
    }
  });

  return [
    { stage: "pre_licensing", label: "Pre-Licensing", count: preLicensingAgents.length, icon: <GraduationCap className="h-4 w-4" />, color: "text-amber-500 bg-amber-500/10", agents: preLicensingAgents },
    { stage: "onboarding", label: "Onboarding", count: stageAgents.onboarding.length, icon: <Users className="h-4 w-4" />, color: "text-blue-500 bg-blue-500/10", agents: stageAgents.onboarding },
    { stage: "training_online", label: "Training Online", count: stageAgents.training_online.length, icon: <BookOpen className="h-4 w-4" />, color: "text-cyan-500 bg-cyan-500/10", agents: stageAgents.training_online },
    { stage: "in_field_training", label: "Field Training", count: stageAgents.in_field_training.length, icon: <Briefcase className="h-4 w-4" />, color: "text-violet-500 bg-violet-500/10", agents: stageAgents.in_field_training },
    { stage: "evaluated", label: "Evaluated", count: stageAgents.evaluated.length, icon: <Award className="h-4 w-4" />, color: "text-emerald-500 bg-emerald-500/10", agents: stageAgents.evaluated },
  ];
}

function getContactDot(lastContactedAt: string | null) {
  if (lastContactedAt === null) return "bg-muted-foreground/50";
  const hrs = (Date.now() - new Date(lastContactedAt).getTime()) / 36e5;
  if (hrs < 24) return "bg-emerald-400";
  if (hrs < 48) return "bg-amber-400";
  return "bg-red-400";
}

function getContactLabel(lastContactedAt: string | null) {
  if (!lastContactedAt) return "New";
  const hrs = (Date.now() - new Date(lastContactedAt).getTime()) / 36e5;
  if (hrs < 1) return "Just now";
  if (hrs < 24) return `${Math.floor(hrs)}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "Yesterday";
  return `${days}d ago`;
}

export function OnboardingPipelineCard() {
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [selectedStage, setSelectedStage] = useState<PipelineStage | null>(null);

  const { data: stages = [], isLoading } = useQuery({
    queryKey: ["onboarding-pipeline", user?.id, isAdmin],
    queryFn: () => fetchPipeline(user!.id, isAdmin),
    enabled: !!user,
    staleTime: 30_000,
  });

  const totalAgents = stages.reduce((sum, s) => sum + s.count, 0);

  const handleAgentClick = (agentId: string) => {
    setSelectedStage(null);
    navigate(`/dashboard/crm?focusAgentId=${agentId}`);
  };

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

  if (totalAgents === 0) return null;

  return (
    <>
      <div>
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
              <div
                key={stage.stage}
                className="relative cursor-pointer"
                onClick={() => stage.count > 0 && setSelectedStage(stage)}
              >
                <div className={cn(
                  "bg-background/50 rounded-lg p-3 border border-border/50 text-center transition-all",
                  stage.count > 0 && "hover:border-primary/40 hover:shadow-md hover:scale-[1.02]"
                )}>
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
                      {stage.agents.slice(0, 3).map((a, ai) => (
                        <p key={ai} className="text-[9px] text-muted-foreground truncate flex items-center gap-1">
                          <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", getContactDot(a.lastContactedAt))} />
                          {a.name.split(" ")[0]}
                        </p>
                      ))}
                      {stage.count > 3 && (
                        <p className="text-[9px] text-muted-foreground/60">+{stage.count - 3} more</p>
                      )}
                    </div>
                  )}
                </div>
                
                {index < stages.length - 1 && (
                  <div className="hidden md:block absolute top-1/2 -right-1.5 w-3 h-0.5 bg-border" />
                )}
              </div>
            ))}
          </div>
        </GlassCard>
      </div>

      {/* Stage drilldown dialog */}
      <Dialog open={!!selectedStage} onOpenChange={() => setSelectedStage(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedStage?.icon}
              {selectedStage?.label} ({selectedStage?.count})
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <div className="space-y-1 p-1">
              {selectedStage?.agents.map((agent) => (
                <button
                  key={agent.id}
                  onClick={() => handleAgentClick(agent.id)}
                  className="w-full flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 transition-colors text-left group"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className={cn("w-2 h-2 rounded-full shrink-0", getContactDot(agent.lastContactedAt))} />
                    <span className="text-sm font-medium truncate">{agent.name}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-muted-foreground">{getContactLabel(agent.lastContactedAt)}</span>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </button>
              ))}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}
