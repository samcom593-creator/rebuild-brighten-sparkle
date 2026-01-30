import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { format, differenceInDays } from "date-fns";
import {
  GraduationCap,
  RefreshCw,
  CheckCircle,
  Clock,
  AlertTriangle,
  Send,
  Filter,
  Copy,
  ArrowRight,
  BookOpen,
  XCircle,
  Eye,
} from "lucide-react";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { AddToCourseButton } from "@/components/dashboard/AddToCourseButton";
import { CourseContentViewer } from "@/components/admin/CourseContentViewer";

interface ModuleInfo {
  id: string;
  title: string;
  order_index: number;
}

interface AgentProgress {
  agentId: string;
  agentName: string;
  email: string;
  managerId: string | null;
  managerName: string;
  onboardingStage: string;
  modules: Record<string, { 
    passed: boolean; 
    completedAt: string | null; 
    watchedPercent: number;
    quizScore: number | null;
  }>;
  completedCount: number;
  totalModules: number;
  percentComplete: number;
  lastActivity: string | null;
  isStalled: boolean;
  isAtRisk: boolean;
  hasStarted: boolean;
  courseStartedAt: string | null;
}

type FilterType = "all" | "not_started" | "in_progress" | "stalled" | "complete";

export default function CourseProgress() {
  const [filter, setFilter] = useState<FilterType>("all");
  const [sendingReminder, setSendingReminder] = useState<string | null>(null);
  const [showContentViewer, setShowContentViewer] = useState(false);
  const queryClient = useQueryClient();

  // Fetch modules
  const { data: modules = [] } = useQuery({
    queryKey: ["onboarding-modules"],
    queryFn: async () => {
      const { data } = await supabase
        .from("onboarding_modules")
        .select("id, title, order_index")
        .eq("is_active", true)
        .order("order_index");
      return (data || []) as ModuleInfo[];
    },
  });

  // Fetch agents in course with their progress
  const { data: agentProgress = [], isLoading, refetch } = useQuery({
    queryKey: ["course-progress-full"],
    queryFn: async () => {
      // Get agents in onboarding stages
      const { data: agents } = await supabase
        .from("agents")
        .select(`
          id,
          onboarding_stage,
          invited_by_manager_id,
          profiles!agents_profile_id_fkey (
            full_name,
            email
          )
        `)
        .in("onboarding_stage", ["onboarding", "training_online"])
        .eq("is_deactivated", false);

      if (!agents?.length) return [];

      const agentIds = agents.map((a) => a.id);
      const managerIds = [...new Set(agents.map(a => a.invited_by_manager_id).filter(Boolean))];

      // Fetch manager names
      let managerMap = new Map<string, string>();
      if (managerIds.length > 0) {
        const { data: managerAgents } = await supabase
          .from("agents")
          .select("id, user_id")
          .in("id", managerIds);
        
        if (managerAgents?.length) {
          const managerUserIds = managerAgents.map(a => a.user_id).filter(Boolean);
          const { data: managerProfiles } = await supabase
            .from("profiles")
            .select("user_id, full_name")
            .in("user_id", managerUserIds);
          
          const userToName = new Map(managerProfiles?.map(p => [p.user_id, p.full_name]) || []);
          managerAgents.forEach(ma => {
            if (ma.user_id) {
              managerMap.set(ma.id, userToName.get(ma.user_id) || "Unknown");
            }
          });
        }
      }

      // Fetch progress for these agents
      const { data: progress } = await supabase
        .from("onboarding_progress")
        .select("agent_id, module_id, passed, completed_at, video_watched_percent, score")
        .in("agent_id", agentIds);

      // Fetch total modules count
      const { data: allModules } = await supabase
        .from("onboarding_modules")
        .select("id")
        .eq("is_active", true);
      const totalModules = allModules?.length || 0;

      // Build progress map per agent
      const progressByAgent = new Map<string, Map<string, { passed: boolean; completedAt: string | null; watchedPercent: number; quizScore: number | null }>>();
      const lastActivityByAgent = new Map<string, string>();
      const courseStartByAgent = new Map<string, string>();

      progress?.forEach((p) => {
        if (!progressByAgent.has(p.agent_id)) {
          progressByAgent.set(p.agent_id, new Map());
        }
        progressByAgent.get(p.agent_id)!.set(p.module_id, {
          passed: p.passed || false,
          completedAt: p.completed_at,
          watchedPercent: p.video_watched_percent || 0,
          quizScore: p.score || null,
        });

        // Track last activity
        if (p.completed_at) {
          const current = lastActivityByAgent.get(p.agent_id);
          if (!current || p.completed_at > current) {
            lastActivityByAgent.set(p.agent_id, p.completed_at);
          }
        }
        
        // Track when course started (first progress entry)
        const startedAt = (p as any).started_at || p.completed_at;
        if (startedAt) {
          const currentStart = courseStartByAgent.get(p.agent_id);
          if (!currentStart || startedAt < currentStart) {
            courseStartByAgent.set(p.agent_id, startedAt);
          }
        }
      });

      // Build agent progress list
      const result: AgentProgress[] = agents.map((agent) => {
        const profile = agent.profiles;
        const agentModules = progressByAgent.get(agent.id) || new Map();
        const lastActivity = lastActivityByAgent.get(agent.id) || null;
        const courseStartedAt = courseStartByAgent.get(agent.id) || null;
        
        let completedCount = 0;
        const modulesRecord: Record<string, { passed: boolean; completedAt: string | null; watchedPercent: number; quizScore: number | null }> = {};
        
        agentModules.forEach((value, key) => {
          if (value.passed) completedCount++;
          modulesRecord[key] = value;
        });

        const percentComplete = totalModules > 0 ? Math.round((completedCount / totalModules) * 100) : 0;
        const hasStarted = agentModules.size > 0;
        
        // Calculate stalled status
        const daysSinceActivity = lastActivity 
          ? differenceInDays(new Date(), new Date(lastActivity))
          : hasStarted ? 999 : 0;
        
        const isStalled = hasStarted && !lastActivity ? true : daysSinceActivity >= 3 && percentComplete < 100;
        const isAtRisk = daysSinceActivity >= 7 && percentComplete < 100;

        return {
          agentId: agent.id,
          agentName: profile?.full_name || "Unknown",
          email: profile?.email || "",
          managerId: agent.invited_by_manager_id,
          managerName: agent.invited_by_manager_id ? managerMap.get(agent.invited_by_manager_id) || "Unknown" : "Unassigned",
          onboardingStage: agent.onboarding_stage || "onboarding",
          modules: modulesRecord,
          completedCount,
          totalModules,
          percentComplete,
          lastActivity,
          isStalled,
          isAtRisk,
          hasStarted,
          courseStartedAt,
        };
      });

      // Sort by progress (lowest first)
      return result.sort((a, b) => a.percentComplete - b.percentComplete);
    },
  });

  // Send reminder mutation
  const sendReminderMutation = useMutation({
    mutationFn: async (agentId: string) => {
      setSendingReminder(agentId);
      const { error } = await supabase.functions.invoke("send-course-reminder", {
        body: { agentId },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Reminder sent successfully!");
    },
    onError: (error) => {
      console.error("Error sending reminder:", error);
      toast.error("Failed to send reminder");
    },
    onSettled: () => {
      setSendingReminder(null);
    },
  });

  // Push to field training
  const pushToFieldMutation = useMutation({
    mutationFn: async (agentId: string) => {
      const { error } = await supabase
        .from("agents")
        .update({ 
          onboarding_stage: "in_field_training",
          field_training_started_at: new Date().toISOString()
        })
        .eq("id", agentId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Agent moved to field training!");
      queryClient.invalidateQueries({ queryKey: ["course-progress-full"] });
    },
    onError: (error) => {
      console.error("Error updating stage:", error);
      toast.error("Failed to update agent stage");
    },
  });

  // Unenroll from course - resets progress and stage
  const unenrollMutation = useMutation({
    mutationFn: async (agentId: string) => {
      // Delete all onboarding_progress for this agent
      const { error: progressError } = await supabase
        .from("onboarding_progress")
        .delete()
        .eq("agent_id", agentId);
      if (progressError) throw progressError;

      // Reset agent stage back to onboarding (or you could use a different stage)
      const { error: agentError } = await supabase
        .from("agents")
        .update({ 
          onboarding_stage: "onboarding",
          has_training_course: false
        })
        .eq("id", agentId);
      if (agentError) throw agentError;
    },
    onSuccess: () => {
      toast.success("Agent unenrolled from course");
      queryClient.invalidateQueries({ queryKey: ["course-progress-full"] });
    },
    onError: (error) => {
      console.error("Unenroll error:", error);
      toast.error("Failed to unenroll agent");
    },
  });

  // Bulk send reminders to stalled
  const sendBulkReminders = async () => {
    const stalledAgents = agentProgress.filter(a => a.isStalled || a.isAtRisk);
    if (stalledAgents.length === 0) {
      toast.info("No stalled agents to remind");
      return;
    }
    
    toast.promise(
      Promise.all(stalledAgents.map(a => 
        supabase.functions.invoke("send-course-reminder", { body: { agentId: a.agentId } })
      )),
      {
        loading: `Sending reminders to ${stalledAgents.length} agents...`,
        success: `Sent reminders to ${stalledAgents.length} agents`,
        error: "Some reminders failed to send",
      }
    );
  };

  // Copy progress to clipboard
  const copyToClipboard = () => {
    const text = agentProgress.map(a => 
      `${a.agentName} - ${a.percentComplete}% (${a.completedCount}/${a.totalModules}) - ${a.isAtRisk ? "AT RISK" : a.isStalled ? "STALLED" : "Active"}`
    ).join("\n");
    navigator.clipboard.writeText(text);
    toast.success("Progress copied to clipboard!");
  };

  // Filter agents
  const filteredAgents = useMemo(() => {
    return agentProgress.filter(agent => {
      switch (filter) {
        case "not_started":
          return !agent.hasStarted;
        case "in_progress":
          return agent.hasStarted && agent.percentComplete < 100 && !agent.isStalled;
        case "stalled":
          return agent.isStalled || agent.isAtRisk;
        case "complete":
          return agent.percentComplete >= 100;
        default:
          return true;
      }
    });
  }, [agentProgress, filter]);

  // Stats
  const stats = useMemo(() => ({
    total: agentProgress.length,
    notStarted: agentProgress.filter(a => !a.hasStarted).length,
    inProgress: agentProgress.filter(a => a.hasStarted && a.percentComplete < 100 && !a.isStalled).length,
    stalled: agentProgress.filter(a => a.isStalled || a.isAtRisk).length,
    complete: agentProgress.filter(a => a.percentComplete >= 100).length,
  }), [agentProgress]);

  return (
    <DashboardLayout>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold gradient-text flex items-center gap-2">
              <GraduationCap className="h-6 w-6" />
              Course Progress Monitor
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Track agent coursework completion and send reminders
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={() => window.location.href = '/course-progress/content'} className="gap-1.5">
              <Eye className="h-3.5 w-3.5" />
              View Full Course
            </Button>
            <Button variant="outline" size="sm" onClick={copyToClipboard} className="gap-1.5">
              <Copy className="h-3.5 w-3.5" />
              Copy
            </Button>
            <Button variant="outline" size="sm" onClick={sendBulkReminders} className="gap-1.5">
              <Send className="h-3.5 w-3.5" />
              Remind All Stalled
            </Button>
            <Button onClick={() => refetch()} variant="outline" size="sm" className="gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
          </div>
        </div>

        {/* Stats Bar */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <GlassCard 
            className={cn(
              "p-3 cursor-pointer transition-all hover:ring-2 hover:ring-primary/50",
              filter === "all" && "ring-2 ring-primary"
            )}
            onClick={() => setFilter("all")}
          >
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-primary" />
              <div>
                <p className="text-lg font-bold">{stats.total}</p>
                <p className="text-[10px] text-muted-foreground">All Agents</p>
              </div>
            </div>
          </GlassCard>

          <GlassCard 
            className={cn(
              "p-3 cursor-pointer transition-all hover:ring-2 hover:ring-muted-foreground/50",
              filter === "not_started" && "ring-2 ring-muted-foreground"
            )}
            onClick={() => setFilter("not_started")}
          >
            <div className="flex items-center gap-2">
              <XCircle className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-lg font-bold">{stats.notStarted}</p>
                <p className="text-[10px] text-muted-foreground">Not Started</p>
              </div>
            </div>
          </GlassCard>

          <GlassCard 
            className={cn(
              "p-3 cursor-pointer transition-all hover:ring-2 hover:ring-blue-500/50",
              filter === "in_progress" && "ring-2 ring-blue-500"
            )}
            onClick={() => setFilter("in_progress")}
          >
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-blue-500" />
              <div>
                <p className="text-lg font-bold">{stats.inProgress}</p>
                <p className="text-[10px] text-muted-foreground">In Progress</p>
              </div>
            </div>
          </GlassCard>

          <GlassCard 
            className={cn(
              "p-3 cursor-pointer transition-all hover:ring-2 hover:ring-amber-500/50",
              filter === "stalled" && "ring-2 ring-amber-500"
            )}
            onClick={() => setFilter("stalled")}
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <div>
                <p className="text-lg font-bold">{stats.stalled}</p>
                <p className="text-[10px] text-muted-foreground">Stalled</p>
              </div>
            </div>
          </GlassCard>

          <GlassCard 
            className={cn(
              "p-3 cursor-pointer transition-all hover:ring-2 hover:ring-green-500/50",
              filter === "complete" && "ring-2 ring-green-500"
            )}
            onClick={() => setFilter("complete")}
          >
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <div>
                <p className="text-lg font-bold">{stats.complete}</p>
                <p className="text-[10px] text-muted-foreground">Complete</p>
              </div>
            </div>
          </GlassCard>
        </div>

        {/* Course Progress Table */}
        <GlassCard>
          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredAgents.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <BookOpen className="h-10 w-10 mx-auto mb-3 opacity-50" />
              <p>No agents match this filter</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[180px]">Agent</TableHead>
                    <TableHead className="min-w-[120px]">Manager</TableHead>
                    <TableHead className="min-w-[80px]">Stage</TableHead>
                    {modules.map((module) => (
                      <TableHead key={module.id} className="min-w-[80px] text-center">
                        <span className="text-xs truncate block" title={module.title}>
                          {module.title.length > 12 ? module.title.slice(0, 12) + "..." : module.title}
                        </span>
                      </TableHead>
                    ))}
                    <TableHead className="min-w-[120px]">Progress</TableHead>
                    <TableHead className="min-w-[100px]">Last Active</TableHead>
                    <TableHead className="min-w-[120px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAgents.map((agent, index) => (
                    <motion.tr
                      key={agent.agentId}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.02 }}
                      className="border-b border-border hover:bg-muted/30"
                    >
                      <TableCell>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{agent.agentName}</span>
                            {agent.isAtRisk && (
                              <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-[9px]">
                                At Risk
                              </Badge>
                            )}
                            {agent.isStalled && !agent.isAtRisk && (
                              <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[9px]">
                                Stalled
                              </Badge>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground">{agent.email}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm">{agent.managerName}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">
                          {agent.onboardingStage === "training_online" ? "Course" : "Onboard"}
                        </Badge>
                      </TableCell>
                      {modules.map((module) => {
                        const progress = agent.modules[module.id];
                        return (
                          <TableCell key={module.id} className="text-center">
                            {progress?.passed ? (
                              <div className="flex flex-col items-center">
                                <CheckCircle className="h-4 w-4 text-green-500" />
                                {progress.quizScore !== null && (
                                  <span className="text-[9px] text-green-600 dark:text-green-400 font-medium">
                                    {progress.quizScore}%
                                  </span>
                                )}
                              </div>
                            ) : progress?.watchedPercent > 0 ? (
                              <div className="flex flex-col items-center">
                                <Clock className="h-3.5 w-3.5 text-blue-400" />
                                <span className="text-[9px] text-muted-foreground">{progress.watchedPercent}%</span>
                              </div>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        );
                      })}
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress value={agent.percentComplete} className="h-2 w-16" />
                          <span className="text-sm font-medium">{agent.percentComplete}%</span>
                        </div>
                        <span className="text-[10px] text-muted-foreground">
                          {agent.completedCount}/{agent.totalModules} modules
                        </span>
                      </TableCell>
                      <TableCell>
                        {agent.lastActivity ? (
                          <span className={cn(
                            "text-xs",
                            agent.isAtRisk && "text-red-400",
                            agent.isStalled && !agent.isAtRisk && "text-amber-400"
                          )}>
                            {format(new Date(agent.lastActivity), "MMM d")}
                          </span>
                        ) : agent.hasStarted ? (
                          <span className="text-xs text-muted-foreground">Unknown</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">Not started</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1">
                                Actions
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {agent.percentComplete >= 100 && (
                                <DropdownMenuItem
                                  onClick={() => pushToFieldMutation.mutate(agent.agentId)}
                                  disabled={pushToFieldMutation.isPending}
                                >
                                  <ArrowRight className="h-3.5 w-3.5 mr-2" />
                                  Push to Field Training
                                </DropdownMenuItem>
                              )}
                              {!agent.hasStarted && (
                                <DropdownMenuItem asChild>
                                  <div>
                                    <AddToCourseButton
                                      agentId={agent.agentId}
                                      agentName={agent.agentName}
                                      hasProgress={false}
                                      onSuccess={() => refetch()}
                                      size="sm"
                                      variant="ghost"
                                    />
                                  </div>
                                </DropdownMenuItem>
                              )}
                              {agent.hasStarted && agent.percentComplete < 100 && (
                                <DropdownMenuItem
                                  onClick={() => sendReminderMutation.mutate(agent.agentId)}
                                  disabled={sendingReminder === agent.agentId}
                                >
                                  <Send className="h-3.5 w-3.5 mr-2" />
                                  {sendingReminder === agent.agentId ? "Sending..." : "Send Reminder"}
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem
                                onClick={() => unenrollMutation.mutate(agent.agentId)}
                                disabled={unenrollMutation.isPending}
                                className="text-destructive focus:text-destructive"
                              >
                                <XCircle className="h-3.5 w-3.5 mr-2" />
                                Unenroll from Course
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </motion.tr>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </GlassCard>

        {/* Course Content Viewer */}
        <CourseContentViewer
          open={showContentViewer}
          onClose={() => setShowContentViewer(false)}
        />
      </div>
    </DashboardLayout>
  );
}
