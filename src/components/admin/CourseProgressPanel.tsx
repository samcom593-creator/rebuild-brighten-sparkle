import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { BookOpen, CheckCircle, Clock, GraduationCap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { format } from "date-fns";

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
}

export function CourseProgressPanel() {
  const { data: courseProgress, isLoading } = useQuery({
    queryKey: ["course-progress-admin"],
    queryFn: async () => {
      // Get all modules
      const { data: modules } = await supabase
        .from("onboarding_modules")
        .select("id")
        .eq("is_active", true);

      const totalModules = modules?.length || 0;

      // Get agents in onboarding/training stages
      const { data: agents } = await supabase
        .from("agents")
        .select(`
          id,
          onboarding_stage,
          profiles!agents_profile_id_fkey (
            full_name,
            email
          )
        `)
        .in("onboarding_stage", ["onboarding", "training_online"])
        .eq("is_deactivated", false);

      if (!agents || agents.length === 0) return [];

      // Get progress for these agents
      const agentIds = agents.map((a) => a.id);
      const { data: progress } = await supabase
        .from("onboarding_progress")
        .select("agent_id, module_id, passed, completed_at, video_watched_percent")
        .in("agent_id", agentIds);

      // Aggregate progress by agent
      const progressMap = new Map<string, { completed: number; lastActivity: string | null }>();
      progress?.forEach((p) => {
        const existing = progressMap.get(p.agent_id) || { completed: 0, lastActivity: null };
        if (p.passed) {
          existing.completed += 1;
        }
        if (p.completed_at && (!existing.lastActivity || p.completed_at > existing.lastActivity)) {
          existing.lastActivity = p.completed_at;
        }
        progressMap.set(p.agent_id, existing);
      });

      // Map to course progress
      const result: AgentCourseProgress[] = agents.map((agent) => {
        const profile = agent.profiles;
        const agentProgress = progressMap.get(agent.id) || { completed: 0, lastActivity: null };
        const completedModules = agentProgress.completed;
        const percentComplete = totalModules > 0 ? Math.round((completedModules / totalModules) * 100) : 0;

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
        };
      });

      // Sort by progress (lowest first to highlight who needs attention)
      return result.sort((a, b) => a.moduleProgress - b.moduleProgress);
    },
  });

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
          <Badge variant="outline" className="text-xs">
            {courseProgress.length} in training
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3 max-h-[400px] overflow-y-auto scrollbar-custom">
          {courseProgress.map((agent, index) => (
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
                      <Badge className="bg-green-500/10 text-green-600 border-green-500/30 text-xs">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Ready for Field
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{agent.email || "No email"}</p>
                </div>
                <span className="text-lg font-bold text-primary">{agent.moduleProgress}%</span>
              </div>

              <Progress value={agent.moduleProgress} className="h-2 mb-2" />

              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {agent.completedModules}/{agent.totalModules} modules
                </span>
                {agent.lastActivity ? (
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {format(new Date(agent.lastActivity), "MMM d")}
                  </span>
                ) : (
                  <span className="text-amber-500">Not started</span>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
