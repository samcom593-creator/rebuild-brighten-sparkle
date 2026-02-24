import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Users, BookOpen, ChevronRight, Clock, AlertTriangle, CheckCircle, FileText } from "lucide-react";
import { ApplicationDetailSheet } from "@/components/dashboard/ApplicationDetailSheet";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSoundEffects } from "@/hooks/useSoundEffects";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface PipelineAgent {
  id: string;
  name: string;
  onboardingStage: string;
  hasCourse: boolean;
  licenseStatus: string;
  lastContactedAt: string | null;
  applicationId: string | null;
}

const stageLabels: Record<string, string> = {
  onboarding: "Onboarding",
  training_online: "Training",
  in_field_training: "Field Training",
  evaluated: "Evaluated",
};

function getContactFreshness(lastContactedAt: string | null): { label: string; color: string; staleHours: number } {
  if (!lastContactedAt) return { label: "Never", color: "text-destructive", staleHours: Infinity };
  const hours = (Date.now() - new Date(lastContactedAt).getTime()) / (1000 * 60 * 60);
  if (hours < 24) return { label: `${Math.round(hours)}h ago`, color: "text-emerald-400", staleHours: hours };
  if (hours < 48) return { label: "Yesterday", color: "text-amber-400", staleHours: hours };
  const days = Math.round(hours / 24);
  return { label: `${days}d ago`, color: "text-destructive", staleHours: hours };
}

async function fetchRecruitingData(userId: string, isAdmin: boolean): Promise<PipelineAgent[]> {
  const { data: currentAgent } = await supabase
    .from("agents")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (!currentAgent) return [];

  let query = supabase
    .from("agents")
    .select("id, user_id, display_name, onboarding_stage, has_training_course, license_status, profile_id")
    .eq("is_deactivated", false)
    .eq("status", "active");

  if (!isAdmin) {
    query = query.eq("invited_by_manager_id", currentAgent.id);
  }

  const { data: agents } = await query;
  if (!agents || agents.length === 0) return [];

  // Get profile names
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", agents.map(a => a.profile_id).filter(Boolean) as string[]);

  const profileMap = new Map(profiles?.map(p => [p.id, p.full_name]) ?? []);

  // Get last contact + application id from applications
  const agentIds = agents.map(a => a.id);
  const { data: apps } = await supabase
    .from("applications")
    .select("id, assigned_agent_id, last_contacted_at")
    .in("assigned_agent_id", agentIds)
    .is("terminated_at", null)
    .order("last_contacted_at", { ascending: false, nullsFirst: false });

  const contactMap = new Map<string, { lastContactedAt: string | null; appId: string }>();
  apps?.forEach(a => {
    if (a.assigned_agent_id && !contactMap.has(a.assigned_agent_id)) {
      contactMap.set(a.assigned_agent_id, { lastContactedAt: a.last_contacted_at, appId: a.id });
    }
  });

  return agents.map(a => {
    const contact = contactMap.get(a.id);
    return {
      id: a.id,
      name: a.display_name || profileMap.get(a.profile_id ?? "") || "Unknown",
      onboardingStage: a.onboarding_stage || "onboarding",
      hasCourse: a.has_training_course === true,
      licenseStatus: a.license_status || "unlicensed",
      lastContactedAt: contact?.lastContactedAt ?? null,
      applicationId: contact?.appId ?? null,
    };
  }).sort((a, b) => {
    if (!a.lastContactedAt && b.lastContactedAt) return -1;
    if (a.lastContactedAt && !b.lastContactedAt) return 1;
    if (!a.lastContactedAt && !b.lastContactedAt) return 0;
    return new Date(a.lastContactedAt!).getTime() - new Date(b.lastContactedAt!).getTime();
  });
}

type FilterTab = "all" | "needs_followup";

export function RecruitingQuickView() {
  const { user, isAdmin } = useAuth();
  const isMobile = useIsMobile();
  const { playSound } = useSoundEffects();
  const queryClient = useQueryClient();
  const [activeFilter, setActiveFilter] = useState<FilterTab>("all");
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [viewAppId, setViewAppId] = useState<string | null>(null);

  const { data: agents = [], isLoading } = useQuery({
    queryKey: ["recruiting-quick-view", user?.id, isAdmin],
    queryFn: () => fetchRecruitingData(user!.id, isAdmin),
    enabled: !!user,
    staleTime: 120_000,
  });

  const needsFollowUp = agents.filter(a => {
    const { staleHours } = getContactFreshness(a.lastContactedAt);
    return staleHours >= 48;
  });

  const displayAgents = activeFilter === "needs_followup" ? needsFollowUp : agents;

  const handleMarkContacted = async (agent: PipelineAgent, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!agent.applicationId) {
      toast.error("No application found for this agent");
      return;
    }
    setMarkingId(agent.id);
    try {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from("applications")
        .update({ last_contacted_at: now, contacted_at: now })
        .eq("id", agent.applicationId);
      if (error) throw error;
      playSound("success");
      toast.success(`Marked ${agent.name.split(" ")[0]} as contacted`);
      queryClient.invalidateQueries({ queryKey: ["recruiting-quick-view"] });
    } catch {
      playSound("error");
      toast.error("Failed to update contact status");
    } finally {
      setMarkingId(null);
    }
  };

  if (isLoading) {
    return (
      <GlassCard className="p-4">
        <div className="animate-pulse space-y-2">
          <div className="h-4 bg-muted rounded w-1/3" />
          <div className="h-8 bg-muted rounded" />
          <div className="h-8 bg-muted rounded" />
        </div>
      </GlassCard>
    );
  }

  if (agents.length === 0) return null;

  const content = (
    <GlassCard className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          Recruiting Pipeline
        </h3>
        <Link to="/dashboard/crm">
          <Button variant="ghost" size="sm" className="text-xs h-6 px-2">
            View CRM <ChevronRight className="h-3 w-3 ml-1" />
          </Button>
        </Link>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-3">
        <Button
          variant={activeFilter === "all" ? "default" : "outline"}
          size="sm"
          className="h-7 text-xs px-3"
          onClick={() => { setActiveFilter("all"); playSound("click"); }}
        >
          All ({agents.length})
        </Button>
        <Button
          variant={activeFilter === "needs_followup" ? "default" : "outline"}
          size="sm"
          className={cn(
            "h-7 text-xs px-3 gap-1",
            needsFollowUp.length > 0 && activeFilter !== "needs_followup" && "border-destructive/50 text-destructive hover:bg-destructive/10"
          )}
          onClick={() => { setActiveFilter("needs_followup"); playSound("click"); }}
        >
          <AlertTriangle className="h-3 w-3" />
          Needs Follow-Up ({needsFollowUp.length})
        </Button>
      </div>

      {/* Header row */}
      <div className="grid grid-cols-[1fr_80px_60px_70px_90px] gap-2 text-[10px] uppercase tracking-wide text-muted-foreground font-medium px-2 pb-1 border-b border-border/50">
        <span>Name</span>
        <span>Stage</span>
        <span>Course</span>
        <span>License</span>
        <span className="text-right">Contact</span>
      </div>

      {/* Agent rows */}
      <div className="divide-y divide-border/30 max-h-[300px] overflow-y-auto">
        {displayAgents.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            <CheckCircle className="h-5 w-5 mx-auto mb-1 text-emerald-400" />
            All agents contacted recently ✓
          </div>
        ) : (
          displayAgents.map((agent, i) => {
            const contact = getContactFreshness(agent.lastContactedAt);
            const isStale = contact.staleHours >= 48;
            return (
              <motion.div
                key={agent.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.03 }}
              >
                <div
                  className={cn(
                    "grid grid-cols-[1fr_80px_60px_70px_90px] gap-2 items-center px-2 py-2 rounded transition-colors text-xs",
                    isStale && activeFilter === "needs_followup" ? "bg-destructive/5" : "hover:bg-muted/30"
                  )}
                >
                  <button
                    onClick={() => agent.applicationId ? setViewAppId(agent.applicationId) : null}
                    className="font-medium truncate hover:text-primary transition-colors text-left flex items-center gap-1"
                  >
                    <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
                    {agent.name}
                  </button>
                  <Badge variant="outline" className="text-[9px] h-4 px-1 justify-center">
                    {stageLabels[agent.onboardingStage] || agent.onboardingStage}
                  </Badge>
                  <span className={cn("text-center", agent.hasCourse ? "text-emerald-400" : "text-destructive")}>
                    {agent.hasCourse ? "✅" : "❌"}
                  </span>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[9px] h-4 px-1 justify-center",
                      agent.licenseStatus === "licensed"
                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                        : "bg-amber-500/10 text-amber-400 border-amber-500/30"
                    )}
                  >
                    {agent.licenseStatus === "licensed" ? "Licensed" : "Unlicensed"}
                  </Badge>
                  <div className="flex items-center justify-end gap-1">
                    {isStale && agent.applicationId ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 px-1.5 text-[10px] text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
                        disabled={markingId === agent.id}
                        onClick={(e) => handleMarkContacted(agent, e)}
                      >
                        <CheckCircle className="h-3 w-3 mr-0.5" />
                        {markingId === agent.id ? "..." : "Mark"}
                      </Button>
                    ) : (
                      <span className={cn("text-[10px] flex items-center gap-1", contact.color)}>
                        <Clock className="h-2.5 w-2.5" />
                        {contact.label}
                      </span>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })
        )}
      </div>
      <ApplicationDetailSheet
        open={!!viewAppId}
        onOpenChange={(o) => !o && setViewAppId(null)}
        applicationId={viewAppId || undefined}
      />
    </GlassCard>
  );

  if (isMobile) {
    return (
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="outline" className="w-full gap-2 text-sm">
            <BookOpen className="h-4 w-4" />
            View Recruiting Pipeline ({agents.length})
            {needsFollowUp.length > 0 && (
              <Badge variant="destructive" className="text-[9px] h-4 px-1 ml-1">
                {needsFollowUp.length} overdue
              </Badge>
            )}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3">
          {content}
        </CollapsibleContent>
      </Collapsible>
    );
  }

  return content;
}
