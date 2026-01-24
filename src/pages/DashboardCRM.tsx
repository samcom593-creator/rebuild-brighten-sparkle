import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { format, differenceInDays } from "date-fns";
import {
  Users,
  Search,
  RefreshCw,
  CheckCircle2,
  Clock,
  AlertTriangle,
  TrendingUp,
  Calendar,
  Award,
  ChevronDown,
  Mail,
  Phone,
  UserX,
  Filter,
  BookOpen,
  GraduationCap,
  Briefcase,
  Instagram,
  X,
} from "lucide-react";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { OnboardingTracker } from "@/components/dashboard/OnboardingTracker";
import { AddAgentModal } from "@/components/dashboard/AddAgentModal";
import { AgentChecklist } from "@/components/dashboard/AgentChecklist";
import { AttendanceGrid } from "@/components/dashboard/AttendanceGrid";
import { StarRating } from "@/components/dashboard/StarRating";
import { AgentNotes } from "@/components/dashboard/AgentNotes";
import { EvaluationButtons } from "@/components/dashboard/EvaluationButtons";
import { PerformanceBadges } from "@/components/dashboard/PerformanceBadges";
import { DeactivateAgentDialog } from "@/components/dashboard/DeactivateAgentDialog";
import { cn } from "@/lib/utils";
import { Database } from "@/integrations/supabase/types";

type AttendanceStatus = Database["public"]["Enums"]["attendance_status"];
type PerformanceTier = Database["public"]["Enums"]["performance_tier"];
type OnboardingStage = Database["public"]["Enums"]["onboarding_stage"];

interface Manager {
  id: string;
  name: string;
}

interface AgentCRM {
  id: string;
  userId: string;
  name: string;
  email: string;
  phone?: string;
  avatarUrl?: string;
  instagramHandle?: string;
  onboardingStage: OnboardingStage;
  attendanceStatus: AttendanceStatus;
  performanceTier: PerformanceTier;
  fieldTrainingStartedAt?: string;
  startDate?: string;
  totalEarnings: number;
  hasTrainingCourse: boolean;
  hasDialerLogin: boolean;
  hasDiscordAccess: boolean;
  potentialRating: number;
  evaluationResult?: string | null;
  isDeactivated: boolean;
  managerId?: string;
  managerName?: string;
  weekly10kBadges: number;
}

const attendanceColors: Record<AttendanceStatus, string> = {
  good: "bg-green-500/20 text-green-400 border-green-500/30",
  warning: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  critical: "bg-red-500/20 text-red-400 border-red-500/30",
};

const attendanceLabels: Record<AttendanceStatus, string> = {
  good: "Good Attendance",
  warning: "Needs Improvement",
  critical: "Critical",
};

const performanceLabels: Record<PerformanceTier, string> = {
  below_10k: "Below $10K",
  standard: "Standard",
  top_producer: "Top Producer",
};

const performanceColors: Record<PerformanceTier, string> = {
  below_10k: "bg-muted text-muted-foreground",
  standard: "bg-primary/20 text-primary border-primary/30",
  top_producer: "bg-amber-500/20 text-amber-400 border-amber-500/30",
};

// Column definitions for the 3-column layout
const COLUMNS = [
  { 
    key: "in_course", 
    label: "In Course", 
    icon: BookOpen,
    stages: ["onboarding", "training_online"] as OnboardingStage[],
    color: "text-blue-400",
    bgColor: "bg-blue-500/20"
  },
  { 
    key: "in_training", 
    label: "In-Field Training", 
    icon: GraduationCap,
    stages: ["in_field_training"] as OnboardingStage[],
    color: "text-amber-400",
    bgColor: "bg-amber-500/20"
  },
  { 
    key: "in_field", 
    label: "In Field Active", 
    icon: Briefcase,
    stages: ["evaluated"] as OnboardingStage[],
    color: "text-green-400",
    bgColor: "bg-green-500/20"
  },
];

export default function DashboardCRM() {
  const { user, isAdmin, isManager, isLoading: authLoading } = useAuth();
  const [agents, setAgents] = useState<AgentCRM[]>([]);
  const [managers, setManagers] = useState<Manager[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [managerFilter, setManagerFilter] = useState<string>("all");
  const [showDeactivated, setShowDeactivated] = useState(false);
  const [deactivateAgent, setDeactivateAgent] = useState<AgentCRM | null>(null);

  useEffect(() => {
    if (!authLoading && user) {
      fetchAgents();
      if (isAdmin) {
        fetchManagers();
      }
    }
  }, [user, authLoading, isAdmin]);

  const fetchManagers = async () => {
    try {
      const { data: managerRoles } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "manager");

      if (!managerRoles?.length) return;

      const managerUserIds = managerRoles.map(r => r.user_id);

      const { data: managerAgents } = await supabase
        .from("agents")
        .select("id, user_id")
        .in("user_id", managerUserIds)
        .eq("status", "active");

      if (!managerAgents?.length) return;

      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", managerUserIds);

      const profileMap = new Map(profiles?.map(p => [p.user_id, p.full_name]) || []);

      const managerList: Manager[] = managerAgents.map(agent => ({
        id: agent.id,
        name: profileMap.get(agent.user_id) || "Unknown Manager",
      }));

      setManagers(managerList);
    } catch (error) {
      console.error("Error fetching managers:", error);
    }
  };

  const fetchAgents = async () => {
    setLoading(true);
    try {
      const { data: currentAgent } = await supabase
        .from("agents")
        .select("id")
        .eq("user_id", user!.id)
        .single();

      if (!currentAgent && !isAdmin) {
        setLoading(false);
        return;
      }

      let query = supabase
        .from("agents")
        .select("*")
        .eq("status", "active")
        .eq("license_status", "licensed");

      if (isManager && !isAdmin) {
        query = query.eq("invited_by_manager_id", currentAgent?.id);
      }

      const { data: agentData, error } = await query;

      if (error) throw error;
      if (!agentData?.length) {
        setAgents([]);
        setLoading(false);
        return;
      }

      const userIds = agentData.map(a => a.user_id).filter(Boolean);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name, email, phone, avatar_url, instagram_handle")
        .in("user_id", userIds);

      const profileMap = new Map(
        profiles?.map(p => [p.user_id, p]) || []
      );

      // Get manager names
      const managerIds = [...new Set(agentData.map(a => a.invited_by_manager_id).filter(Boolean))];
      let managerProfileMap = new Map<string, string>();

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
              managerProfileMap.set(ma.id, userToName.get(ma.user_id) || "Unknown");
            }
          });
        }
      }

      const crmAgents: AgentCRM[] = agentData.map(agent => {
        const profile = profileMap.get(agent.user_id);
        return {
          id: agent.id,
          userId: agent.user_id || "",
          name: profile?.full_name || "Unknown Agent",
          email: profile?.email || "",
          phone: profile?.phone || undefined,
          avatarUrl: profile?.avatar_url || undefined,
          instagramHandle: profile?.instagram_handle || undefined,
          onboardingStage: agent.onboarding_stage || "onboarding",
          attendanceStatus: agent.attendance_status || "good",
          performanceTier: agent.performance_tier || "below_10k",
          fieldTrainingStartedAt: agent.field_training_started_at || undefined,
          startDate: agent.start_date || undefined,
          totalEarnings: Number(agent.total_earnings) || 0,
          hasTrainingCourse: agent.has_training_course || false,
          hasDialerLogin: agent.has_dialer_login || false,
          hasDiscordAccess: agent.has_discord_access || false,
          potentialRating: agent.potential_rating || 0,
          evaluationResult: agent.evaluation_result,
          isDeactivated: agent.is_deactivated || false,
          managerId: agent.invited_by_manager_id || undefined,
          managerName: agent.invited_by_manager_id 
            ? managerProfileMap.get(agent.invited_by_manager_id) 
            : undefined,
          weekly10kBadges: agent.weekly_10k_badges || 0,
        };
      });

      setAgents(crmAgents);
    } catch (error) {
      console.error("Error fetching CRM agents:", error);
      toast.error("Failed to load agents");
    } finally {
      setLoading(false);
    }
  };

  const handleAttendanceChange = async (agentId: string, status: AttendanceStatus) => {
    try {
      const { error } = await supabase
        .from("agents")
        .update({ attendance_status: status })
        .eq("id", agentId);

      if (error) throw error;

      setAgents(prev =>
        prev.map(a => (a.id === agentId ? { ...a, attendanceStatus: status } : a))
      );

      toast.success("Attendance updated");
    } catch (error) {
      console.error("Error updating attendance:", error);
      toast.error("Failed to update attendance");
    }
  };

  const handlePerformanceChange = async (agentId: string, tier: PerformanceTier) => {
    try {
      const { error } = await supabase
        .from("agents")
        .update({ performance_tier: tier })
        .eq("id", agentId);

      if (error) throw error;

      setAgents(prev =>
        prev.map(a => (a.id === agentId ? { ...a, performanceTier: tier } : a))
      );

      toast.success("Performance tier updated");
    } catch (error) {
      console.error("Error updating performance:", error);
      toast.error("Failed to update performance tier");
    }
  };

  const handleMarkAbsent = async (agentId: string) => {
    try {
      await supabase.functions.invoke("notify-attendance-missing", {
        body: { agentId, attendanceType: "training" },
      });
    } catch (error) {
      console.log("Attendance notification skipped:", error);
    }
  };

  // Filter agents
  const filteredAgents = agents.filter(agent => {
    const matchesSearch =
      agent.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      agent.email.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesManager = managerFilter === "all" || agent.managerId === managerFilter;
    const matchesDeactivated = showDeactivated ? agent.isDeactivated : !agent.isDeactivated;

    return matchesSearch && matchesManager && matchesDeactivated;
  });

  // Group agents by column
  const getAgentsForColumn = (stages: OnboardingStage[]) => {
    return filteredAgents.filter(agent => stages.includes(agent.onboardingStage));
  };

  // Stats
  const activeAgents = agents.filter(a => !a.isDeactivated);
  const inCourse = activeAgents.filter(a => ["onboarding", "training_online"].includes(a.onboardingStage)).length;
  const inTraining = activeAgents.filter(a => a.onboardingStage === "in_field_training").length;
  const inField = activeAgents.filter(a => a.onboardingStage === "evaluated").length;
  const criticalAttendance = activeAgents.filter(a => a.attendanceStatus === "critical").length;

  if (authLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    );
  }

  const renderAgentCard = (agent: AgentCRM, index: number) => {
    const daysInTraining = agent.fieldTrainingStartedAt
      ? differenceInDays(new Date(), new Date(agent.fieldTrainingStartedAt))
      : null;
    const evaluationDue = daysInTraining !== null && daysInTraining >= 7 && !agent.evaluationResult;
    const isInFieldActive = agent.onboardingStage === "evaluated";

    return (
      <motion.div
        key={agent.id}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: index * 0.03 }}
      >
        <GlassCard className={cn("p-4", agent.isDeactivated && "opacity-60")}>
          <div className="flex flex-col gap-3">
            {/* Top Row: Agent Info + Star Rating */}
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-3 min-w-0">
                <div className="h-10 w-10 rounded-full bg-gradient-to-br from-primary to-cyan-500 flex items-center justify-center text-white font-bold shrink-0">
                  {agent.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-sm truncate">{agent.name}</h3>
                    {agent.isDeactivated && (
                      <Badge variant="destructive" className="text-xs">
                        Inactive
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5 flex-wrap">
                    <a href={`mailto:${agent.email}`} className="flex items-center gap-1 hover:text-foreground transition-colors truncate">
                      <Mail className="h-3 w-3 shrink-0" />
                      <span className="truncate">{agent.email}</span>
                    </a>
                    {agent.phone && (
                      <a href={`tel:${agent.phone}`} className="flex items-center gap-1 hover:text-foreground transition-colors">
                        <Phone className="h-3 w-3" />
                      </a>
                    )}
                    {agent.instagramHandle && (
                      <a 
                        href={`https://instagram.com/${agent.instagramHandle.replace('@', '')}`} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 hover:text-foreground transition-colors"
                      >
                        <Instagram className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                  {agent.managerName && (
                    <Badge variant="outline" className="text-[10px] mt-1">
                      {agent.managerName}
                    </Badge>
                  )}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <StarRating
                  agentId={agent.id}
                  rating={agent.potentialRating}
                  onUpdate={fetchAgents}
                  size="sm"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-destructive"
                  onClick={() => setDeactivateAgent(agent)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            </div>

            {/* Badges for In Field Active agents */}
            {isInFieldActive && agent.weekly10kBadges > 0 && (
              <PerformanceBadges
                agentId={agent.id}
                badgeCount={agent.weekly10kBadges}
                onUpdate={fetchAgents}
              />
            )}

            {/* Checklist Row */}
            <AgentChecklist
              agentId={agent.id}
              hasTrainingCourse={agent.hasTrainingCourse}
              hasDialerLogin={agent.hasDialerLogin}
              hasDiscordAccess={agent.hasDiscordAccess}
              onUpdate={fetchAgents}
            />

            {/* Onboarding Stage */}
            <div className="border-t border-border pt-3">
              <OnboardingTracker
                agentId={agent.id}
                currentStage={agent.onboardingStage}
                onStageUpdate={fetchAgents}
                readOnly={false}
              />
            </div>

            {/* Attendance Grids */}
            {(agent.onboardingStage === "in_field_training" || agent.onboardingStage === "training_online") && (
              <div className="border-t border-border pt-3 space-y-2">
                <AttendanceGrid
                  agentId={agent.id}
                  type="training"
                  label="Training"
                  onMarkAbsent={() => handleMarkAbsent(agent.id)}
                />
                <AttendanceGrid
                  agentId={agent.id}
                  type="onboarded_meeting"
                  label="Meetings"
                  onMarkAbsent={() => handleMarkAbsent(agent.id)}
                />
              </div>
            )}

            {/* In Field Active - Show Meetings + Dialer Attendance */}
            {isInFieldActive && (
              <div className="border-t border-border pt-3 space-y-2">
                <AttendanceGrid
                  agentId={agent.id}
                  type="onboarded_meeting"
                  label="Meetings"
                  onMarkAbsent={() => handleMarkAbsent(agent.id)}
                />
                <AttendanceGrid
                  agentId={agent.id}
                  type="dialer_activity"
                  label="Dialed"
                  onMarkAbsent={() => handleMarkAbsent(agent.id)}
                />
              </div>
            )}

            {/* Status Controls */}
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
              {/* Training Duration & Evaluation */}
              {daysInTraining !== null && agent.onboardingStage === "in_field_training" && (
                <Badge 
                  variant="outline" 
                  className={cn(
                    "gap-1 text-xs",
                    evaluationDue && "bg-amber-500/20 text-amber-400 border-amber-500/30"
                  )}
                >
                  <Clock className="h-3 w-3" />
                  {daysInTraining}d
                  {evaluationDue && " - Eval Due!"}
                </Badge>
              )}

              {/* Evaluation Buttons */}
              {(evaluationDue || agent.evaluationResult) && (
                <EvaluationButtons
                  agentId={agent.id}
                  agentName={agent.name}
                  currentResult={agent.evaluationResult}
                  onEvaluated={fetchAgents}
                />
              )}

              <div className="flex-1" />

              {/* Attendance Dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn("gap-1 text-xs h-7 px-2", attendanceColors[agent.attendanceStatus])}
                  >
                    {attendanceLabels[agent.attendanceStatus].split(' ')[0]}
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onClick={() => handleAttendanceChange(agent.id, "good")}>
                    <CheckCircle2 className="h-4 w-4 mr-2 text-green-500" />
                    Good
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleAttendanceChange(agent.id, "warning")}>
                    <AlertTriangle className="h-4 w-4 mr-2 text-amber-500" />
                    Warning
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleAttendanceChange(agent.id, "critical")}>
                    <AlertTriangle className="h-4 w-4 mr-2 text-red-500" />
                    Critical
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Performance Tier Dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn("gap-1 text-xs h-7 px-2", performanceColors[agent.performanceTier])}
                  >
                    {performanceLabels[agent.performanceTier]}
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onClick={() => handlePerformanceChange(agent.id, "below_10k")}>
                    Below $10K
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handlePerformanceChange(agent.id, "standard")}>
                    <TrendingUp className="h-4 w-4 mr-2 text-primary" />
                    Standard
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handlePerformanceChange(agent.id, "top_producer")}>
                    <Award className="h-4 w-4 mr-2 text-amber-500" />
                    Top Producer
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Notes Section */}
            <AgentNotes
              agentId={agent.id}
              onNoteAdded={fetchAgents}
            />
          </div>
        </GlassCard>
      </motion.div>
    );
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold gradient-text">Agent CRM</h1>
            <p className="text-muted-foreground mt-1">
              Manage your licensed agents and track their progress
            </p>
          </div>
          <div className="flex gap-2">
            <AddAgentModal onAgentAdded={fetchAgents} />
            <Button onClick={fetchAgents} variant="outline" className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <GlassCard className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/20">
                <BookOpen className="h-5 w-5 text-blue-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{inCourse}</p>
                <p className="text-sm text-muted-foreground">In Course</p>
              </div>
            </div>
          </GlassCard>

          <GlassCard className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/20">
                <GraduationCap className="h-5 w-5 text-amber-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{inTraining}</p>
                <p className="text-sm text-muted-foreground">In-Field Training</p>
              </div>
            </div>
          </GlassCard>

          <GlassCard className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/20">
                <Briefcase className="h-5 w-5 text-green-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{inField}</p>
                <p className="text-sm text-muted-foreground">In Field Active</p>
              </div>
            </div>
          </GlassCard>

          <GlassCard className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-500/20">
                <AlertTriangle className="h-5 w-5 text-red-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{criticalAttendance}</p>
                <p className="text-sm text-muted-foreground">Attendance Issues</p>
              </div>
            </div>
          </GlassCard>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search agents..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>

          {isAdmin && managers.length > 0 && (
            <Select value={managerFilter} onValueChange={setManagerFilter}>
              <SelectTrigger className="w-[180px]">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Filter by manager" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Managers</SelectItem>
                {managers.map((manager) => (
                  <SelectItem key={manager.id} value={manager.id}>
                    {manager.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Button
            variant={showDeactivated ? "secondary" : "outline"}
            size="sm"
            onClick={() => setShowDeactivated(!showDeactivated)}
            className="gap-2"
          >
            <UserX className="h-4 w-4" />
            {showDeactivated ? "Showing Inactive" : "Show Inactive"}
          </Button>
        </div>

        {/* 3-Column Layout */}
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {COLUMNS.map((column) => {
              const columnAgents = getAgentsForColumn(column.stages);
              const Icon = column.icon;
              
              return (
                <div key={column.key} className="space-y-4">
                  <div className={cn("flex items-center gap-2 p-3 rounded-lg", column.bgColor)}>
                    <Icon className={cn("h-5 w-5", column.color)} />
                    <h2 className={cn("font-semibold", column.color)}>
                      {column.label}
                    </h2>
                    <Badge variant="secondary" className="ml-auto">
                      {columnAgents.length}
                    </Badge>
                  </div>
                  
                  {columnAgents.length === 0 ? (
                    <GlassCard className="p-6 text-center">
                      <p className="text-sm text-muted-foreground">
                        No agents in this stage
                      </p>
                    </GlassCard>
                  ) : (
                    <div className="space-y-3">
                      {columnAgents.map((agent, index) => renderAgentCard(agent, index))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Deactivate Dialog */}
      <DeactivateAgentDialog
        open={!!deactivateAgent}
        onOpenChange={(open) => !open && setDeactivateAgent(null)}
        agentId={deactivateAgent?.id || ""}
        agentName={deactivateAgent?.name || ""}
        currentManagerId={deactivateAgent?.managerId}
        onComplete={fetchAgents}
      />
    </DashboardLayout>
  );
}
