import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { BookOpen, CheckCircle, Clock, GraduationCap, Send, AlertTriangle, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { format, differenceInDays } from "date-fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Link } from "react-router-dom";

interface AgentCourseProgress {
  agentId: string;
  agentName: string;
  email: string | null;
  moduleProgress: number;
  totalModules: number;
  completedModules: number;
  lastActivity: string | null;
  allModulesPassed: boolean;
  onboardingStage: string | null;
  isStalled: boolean;
  isAtRisk: boolean;
}

type FilterType = "all" | "not_started" | "in_progress" | "stalled" | "complete";

export function CourseProgressPanel() {
  const [filter, setFilter] = useState<FilterType>("all");
  const [sendingReminder, setSendingReminder] = useState<string | null>(null);

  const { data: courseProgress, isLoading } = useQuery({
    queryKey: ["course-progress-admin"],
    queryFn: async () => {
      // Get all modules
      const { data: modules } = await supabase
        .from("onboarding_modules")
        .select("id, title")
        .eq("is_active", true);

      const totalModules = modules?.length || 0;

      // Get agents actively in course (training_online stage)
      const { data: agents } = await supabase
        .from("agents")
        .select(`
          id,
          onboarding_stage,
          has_training_course,
          profiles!agents_profile_id_fkey (
            full_name,
            email
          )
        `)
        .eq("has_training_course", true)
        .eq("is_deactivated", false);

      if (!agents || agents.length === 0) return [];

      // Get progress for these agents
      const agentIds = agents.map((a) => a.id);
      const { data: progress } = await supabase
        .from("onboarding_progress")
        .select("agent_id, module_id, passed, completed_at, video_watched_percent")
        .in("agent_id", agentIds);

      // Aggregate progress by agent
      const progressMap = new Map<string, { completed: number; lastActivity: string | null; hasStarted: boolean }>();
      progress?.forEach((p) => {
        const existing = progressMap.get(p.agent_id) || { completed: 0, lastActivity: null, hasStarted: false };
        if (p.passed) {
          existing.completed += 1;
        }
        if (p.completed_at || (p.video_watched_percent && p.video_watched_percent > 0)) {
          existing.hasStarted = true;
        }
        if (p.completed_at && (!existing.lastActivity || p.completed_at > existing.lastActivity)) {
          existing.lastActivity = p.completed_at;
        }
        progressMap.set(p.agent_id, existing);
      });

      // Map to course progress
      const result: AgentCourseProgress[] = agents.map((agent) => {
        const profile = agent.profiles;
        const agentProgress = progressMap.get(agent.id) || { completed: 0, lastActivity: null, hasStarted: false };
        const completedModules = agentProgress.completed;
        const percentComplete = totalModules > 0 ? Math.round((completedModules / totalModules) * 100) : 0;
        
        const daysSinceActivity = agentProgress.lastActivity 
          ? differenceInDays(new Date(), new Date(agentProgress.lastActivity))
          : agentProgress.hasStarted ? 999 : 0;
        
        const isStalled = agentProgress.hasStarted && daysSinceActivity >= 3 && percentComplete < 100;
        const isAtRisk = daysSinceActivity >= 7 && percentComplete < 100;

        return {
          agentId: agent.id,
          agentName: profile?.full_name || "Unknown",
          email: profile?.email || null,
          moduleProgress: percentComplete,
          totalModules,
          completedModules,
          lastActivity: agentProgress.lastActivity,
          allModulesPassed: completedModules >= totalModules && totalModules > 0,
          onboardingStage: agent.onboarding_stage,
          isStalled,
          isAtRisk,
        };
      });

      // Sort: at-risk first, then stalled, then in-progress, then not started, then complete
      return result.sort((a, b) => {
        const priority = (agent: AgentCourseProgress) => {
          if (agent.isAtRisk) return 0;
          if (agent.isStalled) return 1;
          if (agent.completedModules > 0 && !agent.allModulesPassed) return 2;
          if (!agent.lastActivity && agent.completedModules === 0) return 3;
          if (agent.allModulesPassed) return 4;
          return 3;
        };
        const pa = priority(a), pb = priority(b);
        if (pa !== pb) return pa - pb;
        return a.moduleProgress - b.moduleProgress;
      });
    },
  });

  const handleSendReminder = async (agentId: string, agentName: string) => {
    setSendingReminder(agentId);
    try {
      const { error } = await supabase.functions.invoke("send-course-reminder", {
        body: { agentId },
      });
      if (error) throw error;
      toast.success(`Reminder sent to ${agentName}`);
    } catch (error) {
      console.error("Error sending reminder:", error);
      toast.error("Failed to send reminder");
    } finally {
      setSendingReminder(null);
    }
  };

  const filteredProgress = courseProgress?.filter(agent => {
    const hasStarted = agent.completedModules > 0 || agent.lastActivity;
    switch (filter) {
      case "not_started":
        return !hasStarted;
      case "in_progress":
        return hasStarted && agent.moduleProgress < 100 && !agent.isStalled;
      case "stalled":
        return agent.isStalled || agent.isAtRisk;
      case "complete":
        return agent.allModulesPassed;
      default:
        return true;
    }
  }) || [];

  // Stats
  const stats = {
    total: courseProgress?.length || 0,
    notStarted: courseProgress?.filter(a => a.completedModules === 0 && !a.lastActivity).length || 0,
    inProgress: courseProgress?.filter(a => (a.completedModules > 0 || a.lastActivity) && a.moduleProgress < 100 && !a.isStalled).length || 0,
    stalled: courseProgress?.filter(a => a.isStalled || a.isAtRisk).length || 0,
    complete: courseProgress?.filter(a => a.allModulesPassed).length || 0,
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <GraduationCap className="h-5 w-5 text-primary" />
            Course Progress
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!courseProgress || courseProgress.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <GraduationCap className="h-5 w-5 text-primary" />
            Course Progress
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <BookOpen className="h-10 w-10 mx-auto mb-3 opacity-50" />
            <p>No agents currently in training</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <GraduationCap className="h-5 w-5 text-primary" />
            Course Progress
          </CardTitle>
          <div className="flex items-center gap-2">
            <Link to="/course-progress">
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">
                View Full <ArrowRight className="h-3 w-3" />
              </Button>
            </Link>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Stats Bar */}
        <div className="flex flex-wrap gap-2 mb-4">
          <Badge
            variant={filter === "all" ? "default" : "outline"}
            className="cursor-pointer"
            onClick={() => setFilter("all")}
          >
            All ({stats.total})
          </Badge>
          <Badge
            variant={filter === "not_started" ? "default" : "outline"}
            className="cursor-pointer"
            onClick={() => setFilter("not_started")}
          >
            Not Started ({stats.notStarted})
          </Badge>
          <Badge
            variant={filter === "in_progress" ? "default" : "outline"}
            className={cn("cursor-pointer", filter === "in_progress" && "bg-primary")}
            onClick={() => setFilter("in_progress")}
          >
            In Progress ({stats.inProgress})
          </Badge>
          <Badge
            variant={filter === "stalled" ? "default" : "outline"}
            className={cn("cursor-pointer", filter === "stalled" && "bg-destructive")}
            onClick={() => setFilter("stalled")}
          >
            <AlertTriangle className="h-3 w-3 mr-1" />
            Stalled ({stats.stalled})
          </Badge>
          <Badge
            variant={filter === "complete" ? "default" : "outline"}
            className={cn("cursor-pointer", filter === "complete" && "bg-primary")}
            onClick={() => setFilter("complete")}
          >
            Complete ({stats.complete})
          </Badge>
        </div>

        <div className="space-y-3 max-h-[400px] overflow-y-auto scrollbar-custom">
          {filteredProgress.map((agent, index) => (
            <motion.div
              key={agent.agentId}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className="p-3 rounded-lg border border-border bg-card hover:bg-muted/30 transition-colors"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{agent.agentName}</span>
                    {agent.allModulesPassed && (
                      <Badge className="bg-primary/10 text-primary border-primary/30 text-xs">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Ready for Field
                      </Badge>
                    )}
                    {agent.isAtRisk && (
                      <Badge variant="destructive" className="text-[10px]">
                        At Risk
                      </Badge>
                    )}
                    {agent.isStalled && !agent.isAtRisk && (
                      <Badge variant="secondary" className="text-[10px]">
                        Stalled
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{agent.email || "No email"}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold text-primary">{agent.moduleProgress}%</span>
                  {!agent.allModulesPassed && agent.completedModules > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => handleSendReminder(agent.agentId, agent.agentName)}
                      disabled={sendingReminder === agent.agentId}
                    >
                      <Send className={cn("h-3.5 w-3.5", sendingReminder === agent.agentId && "animate-pulse")} />
                    </Button>
                  )}
                </div>
              </div>

              <Progress value={agent.moduleProgress} className="h-2 mb-2" />

              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {agent.completedModules}/{agent.totalModules} modules
                </span>
                {agent.lastActivity ? (
                  <span className={cn(
                    "flex items-center gap-1",
                    agent.isAtRisk && "text-destructive",
                    agent.isStalled && !agent.isAtRisk && "text-muted-foreground"
                  )}>
                    <Clock className="h-3 w-3" />
                    {format(new Date(agent.lastActivity), "MMM d")}
                  </span>
                ) : (
                  <span className="text-muted-foreground">Not started</span>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
