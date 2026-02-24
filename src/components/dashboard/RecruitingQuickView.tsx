import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Users, BookOpen, ChevronRight, Clock } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

interface PipelineAgent {
  id: string;
  name: string;
  onboardingStage: string;
  hasCourse: boolean;
  licenseStatus: string;
  lastContactedAt: string | null;
}

const stageLabels: Record<string, string> = {
  onboarding: "Onboarding",
  training_online: "Training",
  in_field_training: "Field Training",
  evaluated: "Evaluated",
};

function getContactFreshness(lastContactedAt: string | null): { label: string; color: string } {
  if (!lastContactedAt) return { label: "Never", color: "text-red-400" };
  const hours = (Date.now() - new Date(lastContactedAt).getTime()) / (1000 * 60 * 60);
  if (hours < 24) return { label: `${Math.round(hours)}h ago`, color: "text-emerald-400" };
  if (hours < 48) return { label: "Yesterday", color: "text-amber-400" };
  const days = Math.round(hours / 24);
  return { label: `${days}d ago`, color: "text-red-400" };
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
  const userIds = agents.map(a => a.user_id).filter(Boolean) as string[];
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", agents.map(a => a.profile_id).filter(Boolean) as string[]);

  const profileMap = new Map(profiles?.map(p => [p.id, p.full_name]) ?? []);

  // Get last contact from applications
  const agentIds = agents.map(a => a.id);
  const { data: apps } = await supabase
    .from("applications")
    .select("assigned_agent_id, last_contacted_at")
    .in("assigned_agent_id", agentIds)
    .is("terminated_at", null)
    .order("last_contacted_at", { ascending: false, nullsFirst: false });

  const contactMap = new Map<string, string | null>();
  apps?.forEach(a => {
    if (a.assigned_agent_id && !contactMap.has(a.assigned_agent_id)) {
      contactMap.set(a.assigned_agent_id, a.last_contacted_at);
    }
  });

  return agents.map(a => ({
    id: a.id,
    name: a.display_name || profileMap.get(a.profile_id ?? "") || "Unknown",
    onboardingStage: a.onboarding_stage || "onboarding",
    hasCourse: a.has_training_course === true,
    licenseStatus: a.license_status || "unlicensed",
    lastContactedAt: contactMap.get(a.id) ?? null,
  })).sort((a, b) => {
    // Sort: never contacted first, then oldest contact first
    if (!a.lastContactedAt && b.lastContactedAt) return -1;
    if (a.lastContactedAt && !b.lastContactedAt) return 1;
    if (!a.lastContactedAt && !b.lastContactedAt) return 0;
    return new Date(a.lastContactedAt!).getTime() - new Date(b.lastContactedAt!).getTime();
  });
}

export function RecruitingQuickView() {
  const { user, isAdmin } = useAuth();
  const isMobile = useIsMobile();

  const { data: agents = [], isLoading } = useQuery({
    queryKey: ["recruiting-quick-view", user?.id, isAdmin],
    queryFn: () => fetchRecruitingData(user!.id, isAdmin),
    enabled: !!user,
    staleTime: 120_000,
  });

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

      {/* Header row */}
      <div className="grid grid-cols-[1fr_80px_60px_70px_70px] gap-2 text-[10px] uppercase tracking-wide text-muted-foreground font-medium px-2 pb-1 border-b border-border/50">
        <span>Name</span>
        <span>Stage</span>
        <span>Course</span>
        <span>License</span>
        <span className="text-right">Contact</span>
      </div>

      {/* Agent rows */}
      <div className="divide-y divide-border/30 max-h-[300px] overflow-y-auto">
        {agents.map((agent, i) => {
          const contact = getContactFreshness(agent.lastContactedAt);
          return (
            <motion.div
              key={agent.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.03 }}
            >
              <Link
                to="/dashboard/crm"
                className="grid grid-cols-[1fr_80px_60px_70px_70px] gap-2 items-center px-2 py-2 hover:bg-muted/30 rounded transition-colors text-xs"
              >
                <span className="font-medium truncate">{agent.name}</span>
                <Badge variant="outline" className="text-[9px] h-4 px-1 justify-center">
                  {stageLabels[agent.onboardingStage] || agent.onboardingStage}
                </Badge>
                <span className={cn("text-center", agent.hasCourse ? "text-emerald-400" : "text-red-400")}>
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
                <span className={cn("text-right text-[10px] flex items-center justify-end gap-1", contact.color)}>
                  <Clock className="h-2.5 w-2.5" />
                  {contact.label}
                </span>
              </Link>
            </motion.div>
          );
        })}
      </div>
    </GlassCard>
  );

  if (isMobile) {
    return (
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="outline" className="w-full gap-2 text-sm">
            <BookOpen className="h-4 w-4" />
            View Recruiting Pipeline ({agents.length})
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
