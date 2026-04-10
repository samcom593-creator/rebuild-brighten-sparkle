import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
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
  X,
  UserPlus,
  Trophy,
} from "lucide-react";

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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { AddToCourseButton } from "@/components/dashboard/AddToCourseButton";
import { AddAgentToCourseDialog } from "@/components/dashboard/AddAgentToCourseDialog";
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

type FilterType = "in_progress" | "complete" | "not_started";

// Progress ring component
function ProgressRing({ percent, size = 40, strokeWidth = 4, className }: { percent: number; size?: number; strokeWidth?: number; className?: string }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;
  const color = percent >= 100 ? "hsl(var(--primary))" : percent >= 50 ? "hsl(142 76% 36%)" : percent > 0 ? "hsl(217 91% 60%)" : "hsl(var(--muted-foreground))";

  return (
    <div className={cn("relative inline-flex items-center justify-center", className)}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="hsl(var(--muted) / 0.5)" strokeWidth={strokeWidth} />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none"
          stroke={color} strokeWidth={strokeWidth}
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-700 ease-out"
        />
      </svg>
      <span className="absolute text-[10px] font-bold">{percent}%</span>
    </div>
  );
}

export default function CourseProgress() {
  const [filter, setFilter] = useState<FilterType>("in_progress");
  const [sendingReminder, setSendingReminder] = useState<string | null>(null);
  const [showContentViewer, setShowContentViewer] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

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
    staleTime: 60_000,
  });

  // Fetch agents in course with their progress
  const { data: agentProgress = [], isLoading, refetch } = useQuery({
    queryKey: ["course-progress-full"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data: agents } = await supabase
        .from("agents")
        .select(`
          id,
          onboarding_stage,
          invited_by_manager_id,
          has_training_course,
          profiles!agents_profile_id_fkey (
            full_name,
            email
          )
        `)
        .eq("has_training_course", true)
        .eq("is_deactivated", false);

      if (!agents?.length) return [];

      const agentIds = agents.map((a) => a.id);
      const managerIds = [...new Set(agents.map(a => a.invited_by_manager_id).filter(Boolean))];

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

      const { data: progress } = await supabase
        .from("onboarding_progress")
        .select("agent_id, module_id, passed, completed_at, video_watched_percent, score")
        .in("agent_id", agentIds);

      const { data: allModules } = await supabase
        .from("onboarding_modules")
        .select("id")
        .eq("is_active", true);
      const totalModules = allModules?.length || 0;

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

        if (p.completed_at) {
          const current = lastActivityByAgent.get(p.agent_id);
          if (!current || p.completed_at > current) {
            lastActivityByAgent.set(p.agent_id, p.completed_at);
          }
        }
        
        const startedAt = (p as any).started_at || p.completed_at;
        if (startedAt) {
          const currentStart = courseStartByAgent.get(p.agent_id);
          if (!currentStart || startedAt < currentStart) {
            courseStartByAgent.set(p.agent_id, startedAt);
          }
        }
      });

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

      return result.sort((a, b) => {
        const priority = (agent: AgentProgress) => {
          if (agent.percentComplete >= 100) return 0;
          if (agent.hasStarted && agent.percentComplete < 100 && !agent.isStalled && !agent.isAtRisk) return 1;
          if (agent.isStalled && !agent.isAtRisk) return 2;
          if (agent.isAtRisk) return 3;
          if (!agent.hasStarted) return 4;
          return 4;
        };
        const pa = priority(a), pb = priority(b);
        if (pa !== pb) return pa - pb;
        return b.percentComplete - a.percentComplete;
      });
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

  // Unenroll from course
  const unenrollMutation = useMutation({
    mutationFn: async (agentId: string) => {
      const { error: progressError } = await supabase
        .from("onboarding_progress")
        .delete()
        .eq("agent_id", agentId);
      if (progressError) throw progressError;

      const { error: agentError } = await supabase
        .from("agents")
        .update({ 
          onboarding_stage: "onboarding",
          has_training_course: false
        })
        .eq("id", agentId);
      if (agentError) throw agentError;
    },
    onSuccess: (_, agentId) => {
      toast.success("Agent unenrolled from course");
      queryClient.setQueryData(["course-progress-full"], (old: AgentProgress[] | undefined) => 
        old?.filter(a => a.agentId !== agentId) || []
      );
      queryClient.invalidateQueries({ queryKey: ["course-progress-full"] });
      queryClient.invalidateQueries({ queryKey: ["course-progress-admin"] });
    },
    onError: (error: any) => {
      console.error("Unenroll error:", error);
      toast.error(`Failed to unenroll agent: ${error?.message || "Unknown error"}`);
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

  // Get row border color
  const getRowBorderColor = (agent: AgentProgress) => {
    if (agent.percentComplete >= 100) return "border-l-emerald-500";
    if (agent.isAtRisk) return "border-l-red-500";
    if (agent.isStalled) return "border-l-amber-500";
    if (agent.hasStarted) return "border-l-blue-500";
    return "border-l-muted";
  };

  // Days in course
  const getDaysInCourse = (agent: AgentProgress) => {
    if (!agent.courseStartedAt) return null;
    return differenceInDays(new Date(), new Date(agent.courseStartedAt));
  };

  // Progress summary bar segments
  const progressBarSegments = useMemo(() => {
    const total = stats.total || 1;
    return [
      { label: "Complete", pct: (stats.complete / total) * 100, color: "bg-emerald-500" },
      { label: "In Progress", pct: (stats.inProgress / total) * 100, color: "bg-blue-500" },
      { label: "Stalled", pct: (stats.stalled / total) * 100, color: "bg-amber-500" },
      { label: "Not Started", pct: (stats.notStarted / total) * 100, color: "bg-muted-foreground/40" },
    ];
  }, [stats]);

  return (
    <>
      <div className="space-y-4 page-enter">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20">
              <GraduationCap className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold gradient-text">
                Course Progress Monitor
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Track agent coursework completion and send reminders
              </p>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <AddAgentToCourseDialog onSuccess={() => refetch()} />
            <Button variant="outline" size="sm" onClick={() => navigate('/course-progress/content')} className="gap-1.5">
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

        {/* Progress Summary Bar */}
        {stats.total > 0 && (
          <div className="space-y-1.5">
            <div className="flex h-3 w-full rounded-full overflow-hidden bg-muted/30">
              {progressBarSegments.map((seg, i) => (
                seg.pct > 0 && (
                  <motion.div
                    key={i}
                    initial={{ width: 0 }}
                    animate={{ width: `${seg.pct}%` }}
                    transition={{ duration: 0.6, delay: i * 0.1 }}
                    className={cn("h-full", seg.color)}
                  />
                )
              ))}
            </div>
            <div className="flex gap-4 text-[10px] text-muted-foreground">
              {progressBarSegments.map((seg, i) => (
                <div key={i} className="flex items-center gap-1">
                  <div className={cn("w-2 h-2 rounded-full", seg.color)} />
                  {seg.label} ({Math.round(seg.pct)}%)
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Stats Bar - Gradient Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <button 
            className={cn(
              "p-2 rounded-xl bg-gradient-to-br from-primary/15 to-primary/5 border border-primary/20 cursor-pointer transition-all hover:shadow-md hover:shadow-primary/10 text-left",
              filter === "all" && "ring-2 ring-primary shadow-md shadow-primary/20"
            )}
            onClick={() => setFilter("all")}
          >
            <div className="flex items-center gap-2">
              <div className="h-6 w-6 rounded-lg bg-primary/20 flex items-center justify-center">
                <BookOpen className="h-3.5 w-3.5 text-primary" />
              </div>
              <div>
                <p className="text-lg font-bold">{stats.total}</p>
                <p className="text-[10px] text-muted-foreground">All Agents</p>
              </div>
            </div>
          </button>

          <button 
            className={cn(
              "p-2 rounded-xl bg-gradient-to-br from-muted/30 to-muted/10 border border-border cursor-pointer transition-all hover:shadow-md text-left",
              filter === "not_started" && "ring-2 ring-muted-foreground shadow-md"
            )}
            onClick={() => setFilter("not_started")}
          >
            <div className="flex items-center gap-2">
              <div className="h-6 w-6 rounded-lg bg-muted/50 flex items-center justify-center">
                <XCircle className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-lg font-bold">{stats.notStarted}</p>
                <p className="text-[10px] text-muted-foreground">Not Started</p>
              </div>
            </div>
          </button>

          <button 
            className={cn(
              "p-2 rounded-xl bg-gradient-to-br from-blue-500/15 to-blue-500/5 border border-blue-500/20 cursor-pointer transition-all hover:shadow-md hover:shadow-blue-500/10 text-left",
              filter === "in_progress" && "ring-2 ring-blue-500 shadow-md shadow-blue-500/20"
            )}
            onClick={() => setFilter("in_progress")}
          >
            <div className="flex items-center gap-2">
              <div className="h-6 w-6 rounded-lg bg-blue-500/20 flex items-center justify-center">
                <Clock className="h-3.5 w-3.5 text-blue-500" />
              </div>
              <div>
                <p className="text-lg font-bold">{stats.inProgress}</p>
                <p className="text-[10px] text-muted-foreground">In Progress</p>
              </div>
            </div>
          </button>

          <button 
            className={cn(
              "p-2 rounded-xl bg-gradient-to-br from-amber-500/15 to-amber-500/5 border border-amber-500/20 cursor-pointer transition-all hover:shadow-md hover:shadow-amber-500/10 text-left",
              filter === "stalled" && "ring-2 ring-amber-500 shadow-md shadow-amber-500/20"
            )}
            onClick={() => setFilter("stalled")}
          >
            <div className="flex items-center gap-2">
              <div className="h-6 w-6 rounded-lg bg-amber-500/20 flex items-center justify-center">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
              </div>
              <div>
                <p className="text-lg font-bold">{stats.stalled}</p>
                <p className="text-[10px] text-muted-foreground">Stalled</p>
              </div>
            </div>
          </button>

          <button 
            className={cn(
              "p-2 rounded-xl bg-gradient-to-br from-emerald-500/15 to-emerald-500/5 border border-emerald-500/20 cursor-pointer transition-all hover:shadow-md hover:shadow-emerald-500/10 text-left",
              filter === "complete" && "ring-2 ring-emerald-500 shadow-md shadow-emerald-500/20"
            )}
            onClick={() => setFilter("complete")}
          >
            <div className="flex items-center gap-2">
              <div className="h-6 w-6 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                <Trophy className="h-3.5 w-3.5 text-emerald-500" />
              </div>
              <div>
                <p className="text-lg font-bold">{stats.complete}</p>
                <p className="text-[10px] text-muted-foreground">Finished</p>
              </div>
            </div>
          </button>
        </div>

        {/* Course Progress Table */}
        <GlassCard className="overflow-hidden">
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
              <TooltipProvider>
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableHead className="min-w-[180px]">Agent</TableHead>
                      <TableHead className="min-w-[120px]">Manager</TableHead>
                      <TableHead className="min-w-[80px]">Stage</TableHead>
                      <TableHead className="min-w-[60px] text-center">Days</TableHead>
                      {modules.map((module) => (
                        <TableHead key={module.id} className="min-w-[80px] text-center">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-xs truncate block cursor-help">
                                {module.title.length > 12 ? module.title.slice(0, 12) + "..." : module.title}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              <p className="text-xs font-medium">{module.title}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TableHead>
                      ))}
                      <TableHead className="min-w-[120px]">Progress</TableHead>
                      <TableHead className="min-w-[100px]">Last Active</TableHead>
                      <TableHead className="min-w-[120px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                      {filteredAgents.map((agent, index) => {
                        const daysInCourse = getDaysInCourse(agent);
                        return (
                          <TableRow
                            key={agent.agentId}
                            className={cn(
                              "border-b border-border hover:bg-muted/40 transition-colors border-l-4",
                              getRowBorderColor(agent),
                              agent.percentComplete >= 100 && "bg-emerald-500/5"
                            )}
                          >
                            <TableCell>
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-sm">{agent.agentName}</span>
                                  {agent.isAtRisk && (
                                    <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-[9px] animate-pulse">
                                      At Risk
                                    </Badge>
                                  )}
                                  {agent.isStalled && !agent.isAtRisk && (
                                    <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[9px]">
                                      Stalled
                                    </Badge>
                                  )}
                                  {agent.percentComplete >= 100 && (
                                    <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[9px]">
                                      <CheckCircle className="h-2.5 w-2.5 mr-0.5" />
                                      Done
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
                                {agent.onboardingStage === "training_online" ? "In Course" 
                                  : agent.onboardingStage === "in_field_training" ? "Field Training"
                                  : agent.onboardingStage === "evaluated" ? "Evaluated"
                                  : agent.onboardingStage === "onboarding" ? "Onboarding"
                                  : agent.onboardingStage || "Unknown"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-center">
                              {daysInCourse !== null ? (
                                <span className={cn(
                                  "text-xs font-medium",
                                  daysInCourse > 14 ? "text-red-400" : daysInCourse > 7 ? "text-amber-400" : "text-muted-foreground"
                                )}>
                                  {daysInCourse}d
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            {modules.map((module) => {
                              const progress = agent.modules[module.id];
                              return (
                                <TableCell key={module.id} className="text-center">
                                  {progress?.passed ? (
                                    <div className="flex flex-col items-center">
                                      <CheckCircle className="h-4 w-4 text-emerald-500" />
                                      {progress.quizScore !== null && (
                                        <span className="text-[9px] text-emerald-600 dark:text-emerald-400 font-medium">
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
                                <ProgressRing percent={agent.percentComplete} size={36} strokeWidth={3} />
                                <span className="text-[10px] text-muted-foreground">
                                  {agent.completedCount}/{agent.totalModules}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell>
                              {agent.lastActivity ? (
                                <span className={cn(
                                  "text-xs",
                                  agent.isAtRisk && "text-red-400 font-medium",
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
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                                      disabled={unenrollMutation.isPending}
                                      title="Remove from course"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <X className="h-4 w-4" />
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Remove from Course?</AlertDialogTitle>
                                      <AlertDialogDescription>
                                        This will remove <strong>{agent.agentName}</strong> from the course progress list and reset their progress. They will need to be re-enrolled to appear again.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                                      <AlertDialogAction
                                        onClick={() => unenrollMutation.mutate(agent.agentId)}
                                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                      >
                                        Remove
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                                
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
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                  </TableBody>
                </Table>
              </TooltipProvider>
            </div>
          )}
        </GlassCard>

        {/* Course Content Viewer */}
        <CourseContentViewer
          open={showContentViewer}
          onClose={() => setShowContentViewer(false)}
        />
      </div>
    </>
  );
}
