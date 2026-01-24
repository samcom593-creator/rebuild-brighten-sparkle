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
  ArrowUpRight,
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
import { cn } from "@/lib/utils";
import { Database } from "@/integrations/supabase/types";

type AttendanceStatus = Database["public"]["Enums"]["attendance_status"];
type PerformanceTier = Database["public"]["Enums"]["performance_tier"];
type OnboardingStage = Database["public"]["Enums"]["onboarding_stage"];

interface AgentCRM {
  id: string;
  userId: string;
  name: string;
  email: string;
  phone?: string;
  avatarUrl?: string;
  onboardingStage: OnboardingStage;
  attendanceStatus: AttendanceStatus;
  performanceTier: PerformanceTier;
  fieldTrainingStartedAt?: string;
  startDate?: string;
  totalEarnings: number;
}

const attendanceColors: Record<AttendanceStatus, string> = {
  good: "bg-green-500/20 text-green-400 border-green-500/30",
  warning: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  critical: "bg-red-500/20 text-red-400 border-red-500/30",
};

const attendanceLabels: Record<AttendanceStatus, string> = {
  good: "Good Attendance",
  warning: "Needs Improvement",
  critical: "Critical - Alert Sent",
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

export default function DashboardCRM() {
  const { user, isAdmin, isManager, isLoading: authLoading } = useAuth();
  const [agents, setAgents] = useState<AgentCRM[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("all");

  useEffect(() => {
    if (!authLoading && user) {
      fetchAgents();
    }
  }, [user, authLoading]);

  const fetchAgents = async () => {
    setLoading(true);
    try {
      // Get current user's agent ID
      const { data: currentAgent } = await supabase
        .from("agents")
        .select("id")
        .eq("user_id", user!.id)
        .single();

      if (!currentAgent && !isAdmin) {
        setLoading(false);
        return;
      }

      // Build query for agents
      let query = supabase
        .from("agents")
        .select("*")
        .eq("status", "active")
        .eq("license_status", "licensed");

      // If manager (not admin), only show their team
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

      // Get profiles
      const userIds = agentData.map(a => a.user_id).filter(Boolean);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name, email, phone, avatar_url")
        .in("user_id", userIds);

      const profileMap = new Map(
        profiles?.map(p => [p.user_id, p]) || []
      );

      const crmAgents: AgentCRM[] = agentData.map(agent => {
        const profile = profileMap.get(agent.user_id);
        return {
          id: agent.id,
          userId: agent.user_id || "",
          name: profile?.full_name || "Unknown Agent",
          email: profile?.email || "",
          phone: profile?.phone || undefined,
          avatarUrl: profile?.avatar_url || undefined,
          onboardingStage: agent.onboarding_stage || "onboarding",
          attendanceStatus: agent.attendance_status || "good",
          performanceTier: agent.performance_tier || "below_10k",
          fieldTrainingStartedAt: agent.field_training_started_at || undefined,
          startDate: agent.start_date || undefined,
          totalEarnings: Number(agent.total_earnings) || 0,
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

  const filteredAgents = agents.filter(agent => {
    const matchesSearch =
      agent.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      agent.email.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStage = stageFilter === "all" || agent.onboardingStage === stageFilter;

    return matchesSearch && matchesStage;
  });

  // Stats
  const totalAgents = agents.length;
  const inTraining = agents.filter(a => a.onboardingStage === "in_field_training").length;
  const evaluated = agents.filter(a => a.onboardingStage === "evaluated").length;
  const criticalAttendance = agents.filter(a => a.attendanceStatus === "critical").length;

  if (authLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    );
  }

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
          <Button onClick={fetchAgents} variant="outline" className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <GlassCard className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/20">
                <Users className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{totalAgents}</p>
                <p className="text-sm text-muted-foreground">Total Agents</p>
              </div>
            </div>
          </GlassCard>

          <GlassCard className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/20">
                <Clock className="h-5 w-5 text-amber-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{inTraining}</p>
                <p className="text-sm text-muted-foreground">In Training</p>
              </div>
            </div>
          </GlassCard>

          <GlassCard className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/20">
                <CheckCircle2 className="h-5 w-5 text-green-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{evaluated}</p>
                <p className="text-sm text-muted-foreground">Fully Trained</p>
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
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search agents..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={stageFilter} onValueChange={setStageFilter}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Filter by stage" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Stages</SelectItem>
              <SelectItem value="onboarding">Onboarding</SelectItem>
              <SelectItem value="training_online">Training Online</SelectItem>
              <SelectItem value="in_field_training">In-Field Training</SelectItem>
              <SelectItem value="evaluated">Evaluated</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Agent Grid */}
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : filteredAgents.length === 0 ? (
          <GlassCard className="p-12 text-center">
            <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Agents Found</h3>
            <p className="text-muted-foreground">
              {searchTerm || stageFilter !== "all"
                ? "Try adjusting your filters"
                : "Licensed agents will appear here once they join your team"}
            </p>
          </GlassCard>
        ) : (
          <div className="grid gap-4">
            {filteredAgents.map((agent, index) => {
              const daysInTraining = agent.fieldTrainingStartedAt
                ? differenceInDays(new Date(), new Date(agent.fieldTrainingStartedAt))
                : null;

              return (
                <motion.div
                  key={agent.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                >
                  <GlassCard className="p-6">
                    <div className="flex flex-col lg:flex-row gap-6">
                      {/* Agent Info */}
                      <div className="flex items-start gap-4 lg:w-1/4">
                        <div className="h-12 w-12 rounded-full bg-gradient-to-br from-primary to-cyan-500 flex items-center justify-center text-white font-bold text-lg">
                          {agent.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold truncate">{agent.name}</h3>
                          <p className="text-sm text-muted-foreground truncate">
                            {agent.email}
                          </p>
                          {agent.startDate && (
                            <p className="text-xs text-muted-foreground mt-1">
                              <Calendar className="h-3 w-3 inline mr-1" />
                              Started {format(new Date(agent.startDate), "MMM d, yyyy")}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Onboarding Stage */}
                      <div className="lg:flex-1">
                        <OnboardingTracker
                          agentId={agent.id}
                          currentStage={agent.onboardingStage}
                          onStageUpdate={fetchAgents}
                          readOnly={false}
                        />
                      </div>

                      {/* Status Controls */}
                      <div className="flex flex-wrap lg:flex-col gap-3 lg:w-48">
                        {/* Training Duration */}
                        {daysInTraining !== null && agent.onboardingStage === "in_field_training" && (
                          <Badge variant="outline" className="gap-1">
                            <Clock className="h-3 w-3" />
                            {daysInTraining} days in training
                          </Badge>
                        )}

                        {/* Attendance Dropdown */}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              className={cn("gap-2 justify-between", attendanceColors[agent.attendanceStatus])}
                            >
                              {attendanceLabels[agent.attendanceStatus]}
                              <ChevronDown className="h-3 w-3" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem onClick={() => handleAttendanceChange(agent.id, "good")}>
                              <CheckCircle2 className="h-4 w-4 mr-2 text-green-500" />
                              Good Attendance
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleAttendanceChange(agent.id, "warning")}>
                              <AlertTriangle className="h-4 w-4 mr-2 text-amber-500" />
                              Needs Improvement
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
                              className={cn("gap-2 justify-between", performanceColors[agent.performanceTier])}
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
                              Standard ($10K+)
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handlePerformanceChange(agent.id, "top_producer")}>
                              <Award className="h-4 w-4 mr-2 text-amber-500" />
                              Top Producer
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  </GlassCard>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
