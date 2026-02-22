import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { format, differenceInDays } from "date-fns";
import {
  Users,
  Search,
  RefreshCw,
  CheckCircle2,
  Clock,
  AlertTriangle,
  TrendingUp,
  DollarSign,
  Calendar,
  Award,
  ChevronDown,
  Mail,
  Phone,
  UserX,
  Filter,
  Mic,
  BookOpen,
  GraduationCap,
  Briefcase,
  Instagram,
  X,
  Video,
  Send,
  ArrowLeft,
  CheckSquare,
  EyeOff,
  Eye,
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
import { InstagramPromptDialog } from "@/components/dashboard/InstagramPromptDialog";
import { BulkStageActions, AgentSelectCheckbox } from "@/components/crm/BulkStageActions";
// AbandonedLeadsPanel removed from CRM - exists only in Admin Panel
import { cn } from "@/lib/utils";
import { Database } from "@/integrations/supabase/types";
import { ResendLicensingButton } from "@/components/callcenter/ResendLicensingButton";
import { InterviewRecorder } from "@/components/dashboard/InterviewRecorder";
import { LicenseProgressSelector } from "@/components/dashboard/LicenseProgressSelector";
import { useSoundEffects } from "@/hooks/useSoundEffects";

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
  isInactive: boolean;
  managerId?: string;
  managerName?: string;
  weekly10kBadges: number;
  sortOrder: number;
  // Weekly production stats for Live agents
  weeklyALP: number;
  weeklyPresentations: number;
  weeklyDeals: number;
  weeklyClosingRate: number;
  // Monthly production stats
  monthlyALP: number;
  monthlyDeals: number;
  // Last contact
  lastContactedAt: string | null;
  // Payment status
  standardPaid: boolean;
  premiumPaid: boolean;
  // License pipeline data (from applications)
  licenseProgress: string | null;
  testScheduledDate: string | null;
  // License status from agents table (source of truth)
  agentLicenseStatus: string;
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
    label: "Onboarding", 
    icon: BookOpen,
    stages: ["onboarding", "training_online"] as OnboardingStage[],
    color: "text-primary",
    bgColor: "bg-primary/10"
  },
  { 
    key: "in_training", 
    label: "In-Field Training", 
    icon: GraduationCap,
    stages: ["in_field_training"] as OnboardingStage[],
    color: "text-primary",
    bgColor: "bg-primary/10"
  },
  { 
    key: "in_field", 
    label: "Live", 
    icon: Briefcase,
    stages: ["evaluated"] as OnboardingStage[],
    color: "text-primary",
    bgColor: "bg-primary/10"
  },
];

// Avatar color palette based on name hash
const AVATAR_COLORS = [
  "from-primary to-cyan-500",
  "from-violet-500 to-purple-500",
  "from-rose-500 to-pink-500",
  "from-amber-500 to-orange-500",
  "from-emerald-500 to-teal-500",
  "from-blue-500 to-indigo-500",
  "from-fuchsia-500 to-pink-500",
  "from-cyan-500 to-blue-500",
];

const getAvatarColor = (name: string) => {
  const hash = name.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
};

export default function DashboardCRM() {
  const { user, isAdmin, isManager, isLoading: authLoading } = useAuth();
  const { playSound } = useSoundEffects();
  const [agents, setAgents] = useState<AgentCRM[]>([]);
  const [managers, setManagers] = useState<Manager[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [managerFilter, setManagerFilter] = useState<string>("all");
  const [showDeactivated, setShowDeactivated] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [deactivateAgent, setDeactivateAgent] = useState<AgentCRM | null>(null);
  const [stageFilter, setStageFilter] = useState<"all" | "in_course" | "in_training" | "live" | "meeting_eligible">("all");
  const [instagramPromptAgent, setInstagramPromptAgent] = useState<AgentCRM | null>(null);
  const [expandedColumn, setExpandedColumn] = useState<string | null>(null);
  const [sendingBulkLogins, setSendingBulkLogins] = useState(false);
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set());
  const [sendingCourseLogin, setSendingCourseLogin] = useState<string | null>(null);
  const [recorderAgent, setRecorderAgent] = useState<AgentCRM | null>(null);
  const currentAgentIdRef = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && user) {
      fetchAgents();
      if (isAdmin) {
        fetchManagers();
      }
    }
  }, [user?.id, authLoading, isAdmin]);

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
      
      // Track current user's agent ID for manager badge filtering
      if (currentAgent) {
        currentAgentIdRef[1](currentAgent.id);
      }

      // Show all active agents (both licensed and unlicensed) for full pipeline visibility
      let query = supabase
        .from("agents")
        .select("*")
        .eq("status", "active")
        .order("sort_order", { ascending: true, nullsFirst: false });

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
      const managerIds = [...new Set(agentData.map(a => a.invited_by_manager_id).filter(Boolean))];
      const liveAgentIds = agentData
        .filter(a => a.onboarding_stage === "evaluated")
        .map(a => a.id);
      const allAgentIds = agentData.map(a => a.id);

      // Date calculations
      const today = new Date();
      const dayOfWeek = today.getDay();
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - dayOfWeek);
      const weekStartStr = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`;
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      const monthStartStr = monthStart.toISOString().split("T")[0];

      // Run ALL independent queries in parallel
      const [
        profilesResult,
        managerAgentsResult,
        monthlyProductionResult,
        appContactsResult,
        appLicenseResult,
        paymentsResult,
      ] = await Promise.all([
        supabase
          .from("profiles")
          .select("user_id, full_name, email, phone, avatar_url, instagram_handle")
          .in("user_id", userIds),
        managerIds.length > 0
          ? supabase.from("agents").select("id, user_id").in("id", managerIds)
          : Promise.resolve({ data: [] as any[] }),
        liveAgentIds.length > 0
          ? supabase
              .from("daily_production")
              .select("agent_id, aop, presentations, deals_closed, production_date")
              .in("agent_id", liveAgentIds)
              .gte("production_date", monthStartStr)
          : Promise.resolve({ data: [] as any[] }),
        supabase
          .from("applications")
          .select("assigned_agent_id, last_contacted_at")
          .in("assigned_agent_id", allAgentIds)
          .not("last_contacted_at", "is", null)
          .order("last_contacted_at", { ascending: false }),
        supabase
          .from("applications")
          .select("assigned_agent_id, license_progress, test_scheduled_date")
          .in("assigned_agent_id", allAgentIds)
          .is("terminated_at", null),
        supabase
          .from("lead_payment_tracking")
          .select("agent_id, tier, paid")
          .eq("week_start", weekStartStr)
          .eq("paid", true),
      ]);

      const profiles = profilesResult.data;
      const profileMap = new Map(
        profiles?.map(p => [p.user_id, p]) || []
      );

      // Manager names - only need one more query for manager profiles
      let managerProfileMap = new Map<string, string>();
      const managerAgents = managerAgentsResult.data;
      if (managerAgents?.length) {
        const managerUserIds = managerAgents.map((a: any) => a.user_id).filter(Boolean);
        const { data: managerProfiles } = await supabase
          .from("profiles")
          .select("user_id, full_name")
          .in("user_id", managerUserIds);

        const userToName = new Map(managerProfiles?.map(p => [p.user_id, p.full_name]) || []);
        managerAgents.forEach((ma: any) => {
          if (ma.user_id) {
            managerProfileMap.set(ma.id, userToName.get(ma.user_id) || "Unknown");
          }
        });
      }

      // Aggregate production stats
      let weeklyProductionMap = new Map<string, { aop: number; presentations: number; deals: number }>();
      let monthlyProductionMap = new Map<string, number>();
      let monthlyDealsMap = new Map<string, number>();

      for (const prod of monthlyProductionResult.data || []) {
        const existingMonthly = monthlyProductionMap.get(prod.agent_id) || 0;
        monthlyProductionMap.set(prod.agent_id, existingMonthly + (Number(prod.aop) || 0));
        const existingMonthlyDeals = monthlyDealsMap.get(prod.agent_id) || 0;
        monthlyDealsMap.set(prod.agent_id, existingMonthlyDeals + (prod.deals_closed || 0));

        if (prod.production_date >= weekStartStr) {
          const existing = weeklyProductionMap.get(prod.agent_id) || { aop: 0, presentations: 0, deals: 0 };
          weeklyProductionMap.set(prod.agent_id, {
            aop: existing.aop + (Number(prod.aop) || 0),
            presentations: existing.presentations + (prod.presentations || 0),
            deals: existing.deals + (prod.deals_closed || 0),
          });
        }
      }

      // Build contact map
      const lastContactMap = new Map<string, string>();
      for (const app of appContactsResult.data || []) {
        if (app.assigned_agent_id && app.last_contacted_at && !lastContactMap.has(app.assigned_agent_id)) {
          lastContactMap.set(app.assigned_agent_id, app.last_contacted_at);
        }
      }

      // Build license progress map
      const licenseProgressMap = new Map<string, { progress: string | null; testDate: string | null }>();
      for (const app of appLicenseResult.data || []) {
        if (app.assigned_agent_id && !licenseProgressMap.has(app.assigned_agent_id)) {
          licenseProgressMap.set(app.assigned_agent_id, {
            progress: app.license_progress,
            testDate: app.test_scheduled_date,
          });
        }
      }

      // Build payment map
      const payments = paymentsResult.data;

      const paymentMap = new Map<string, { standard: boolean; premium: boolean }>();
      payments?.forEach((p: any) => {
        const existing = paymentMap.get(p.agent_id) || { standard: false, premium: false };
        if (p.tier === "standard") existing.standard = true;
        if (p.tier === "premium") existing.premium = true;
        paymentMap.set(p.agent_id, existing);
      });

      const crmAgents: AgentCRM[] = agentData.map((agent, index) => {
        const profile = profileMap.get(agent.user_id);
        const weeklyStats = weeklyProductionMap.get(agent.id) || { aop: 0, presentations: 0, deals: 0 };
        const monthlyALP = monthlyProductionMap.get(agent.id) || 0;
        const weeklyClosingRate = weeklyStats.presentations > 0 
          ? Math.round((weeklyStats.deals / weeklyStats.presentations) * 100) 
          : 0;

        const monthlyDeals = monthlyDealsMap.get(agent.id) || 0;

        const pay = paymentMap.get(agent.id) || { standard: false, premium: false };

        return {
          id: agent.id,
          userId: agent.user_id || "",
          name: profile?.full_name || agent.display_name || "Unknown Agent",
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
          isInactive: (agent as any).is_inactive || false,
          managerId: agent.invited_by_manager_id || undefined,
          managerName: agent.invited_by_manager_id 
            ? managerProfileMap.get(agent.invited_by_manager_id) 
            : undefined,
          weekly10kBadges: agent.weekly_10k_badges || 0,
          sortOrder: agent.sort_order ?? index,
          weeklyALP: weeklyStats.aop,
          weeklyPresentations: weeklyStats.presentations,
          weeklyDeals: weeklyStats.deals,
          weeklyClosingRate,
          monthlyALP,
          monthlyDeals,
          lastContactedAt: lastContactMap.get(agent.id) || null,
          standardPaid: pay.standard,
          premiumPaid: pay.premium,
          licenseProgress: licenseProgressMap.get(agent.id)?.progress || null,
          testScheduledDate: licenseProgressMap.get(agent.id)?.testDate || null,
          agentLicenseStatus: agent.license_status || "unlicensed",
        };
      });

      // Fetch unlicensed applicants from applications table (approved/contracting, not terminated, not licensed)
      let appQuery = supabase
        .from("applications")
        .select("id, first_name, last_name, email, phone, license_status, license_progress, test_scheduled_date, status, instagram_handle, started_training")
        .is("terminated_at", null)
        .neq("license_status", "licensed")
        .in("status", ["approved", "contracting"]);

      if (isManager && !isAdmin && currentAgent) {
        appQuery = appQuery.eq("assigned_agent_id", currentAgent.id);
      }

      const { data: unlicensedApplicants } = await appQuery;

      // Deduplicate: exclude applicants whose email already exists in agent list
      const existingEmails = new Set(crmAgents.map(a => a.email?.toLowerCase()).filter(Boolean));
      const newApplicants: AgentCRM[] = (unlicensedApplicants || [])
        .filter(app => !existingEmails.has(app.email?.toLowerCase()))
        .map((app, index) => ({
          id: app.id,
          userId: "",
          name: `${app.first_name} ${app.last_name}`.trim(),
          email: app.email || "",
          phone: app.phone || undefined,
          avatarUrl: undefined,
          instagramHandle: app.instagram_handle || undefined,
          onboardingStage: "onboarding" as OnboardingStage,
          attendanceStatus: "good" as AttendanceStatus,
          performanceTier: "below_10k" as PerformanceTier,
          fieldTrainingStartedAt: undefined,
          startDate: undefined,
          totalEarnings: 0,
          hasTrainingCourse: app.started_training || false,
          hasDialerLogin: false,
          hasDiscordAccess: false,
          potentialRating: 0,
          evaluationResult: null,
          isDeactivated: false,
          isInactive: false,
          managerId: undefined,
          managerName: undefined,
          weekly10kBadges: 0,
          sortOrder: crmAgents.length + index,
          weeklyALP: 0,
          weeklyPresentations: 0,
          weeklyDeals: 0,
          weeklyClosingRate: 0,
          monthlyALP: 0,
          monthlyDeals: 0,
          lastContactedAt: null,
          standardPaid: false,
          premiumPaid: false,
          licenseProgress: app.license_progress || null,
          testScheduledDate: app.test_scheduled_date || null,
          agentLicenseStatus: app.license_status || "unlicensed",
        }));

      setAgents([...crmAgents, ...newApplicants]);
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

  const handleSendPortalLogin = async (agent: AgentCRM) => {
    try {
      const { error } = await supabase.functions.invoke("send-agent-portal-login", {
        body: { agentId: agent.id },
      });
      if (error) throw error;
      toast.success(`Portal login sent to ${agent.email}`);
    } catch (error) {
      console.error("Error sending portal login:", error);
      toast.error("Failed to send portal login");
    }
  };

  const handleBulkSendPortalLogins = async () => {
    if (!confirm(`Send portal login emails to all ${agents.filter(a => !a.isDeactivated).length} active agents? They will receive magic login links.`)) {
      return;
    }
    
    setSendingBulkLogins(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-bulk-portal-logins");
      
      if (error) throw error;
      
      toast.success(`Sent ${data?.results?.sent || 0} portal login emails!`, {
        description: `${data?.results?.failed || 0} failed, ${data?.results?.skipped || 0} skipped`,
      });
    } catch (error) {
      console.error("Error sending bulk portal logins:", error);
      toast.error("Failed to send bulk portal logins");
    } finally {
      setSendingBulkLogins(false);
    }
  };

  // Stats base - non-deactivated, non-inactive agents (must be computed before filters)
  const activeAgents = agents.filter(a => !a.isDeactivated && !a.isInactive);

  // Filter agents - base filter for display (search + manager + visibility)
  const filteredAgents = agents.filter(agent => {
    const matchesSearch =
      agent.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      agent.email.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesManager = managerFilter === "all" || agent.managerId === managerFilter;
    const matchesDeactivated = showDeactivated ? agent.isDeactivated : !agent.isDeactivated;
    const matchesInactive = showInactive ? agent.isInactive : !agent.isInactive;
    const matchesEvaluation = isAdmin || agent.evaluationResult !== "failed";

    return matchesSearch && matchesManager && matchesDeactivated && matchesInactive && matchesEvaluation;
  });

  // Apply stage filter - when a stat card is clicked, use activeAgents to match stat counts
  const stageFilteredAgents = (() => {
    const base = stageFilter !== "all" ? activeAgents : filteredAgents;
    return base.filter(agent => {
      const matchesSearch =
        agent.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        agent.email.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesManager = managerFilter === "all" || agent.managerId === managerFilter;
      if (!matchesSearch || !matchesManager) return false;
      
      switch (stageFilter) {
        case "in_course":
          return ["onboarding", "training_online"].includes(agent.onboardingStage);
        case "in_training":
          return agent.onboardingStage === "in_field_training";
        case "live":
          return agent.onboardingStage === "evaluated";
        case "meeting_eligible":
          return ["in_field_training", "evaluated"].includes(agent.onboardingStage);
        default:
          return true;
      }
    });
  })();

  // Group agents by column - sort by lastContactedAt (null/oldest first) for follow-up priority
  const getAgentsForColumn = (stages: OnboardingStage[]) => {
    return stageFilteredAgents
      .filter(agent => stages.includes(agent.onboardingStage))
      .sort((a, b) => {
        // Null (never contacted) first, then oldest first
        if (!a.lastContactedAt && !b.lastContactedAt) return a.sortOrder - b.sortOrder;
        if (!a.lastContactedAt) return -1;
        if (!b.lastContactedAt) return 1;
        return new Date(a.lastContactedAt).getTime() - new Date(b.lastContactedAt).getTime();
      });
  };

  // Check if agent is "stale" (not contacted in 48+ hours or never contacted)
  const isStaleAgent = (agent: AgentCRM): boolean => {
    if (!agent.lastContactedAt) return true;
    const hoursAgo = (Date.now() - new Date(agent.lastContactedAt).getTime()) / (1000 * 60 * 60);
    return hoursAgo >= 48;
  };

  // Optimistic stage update: re-read single agent's stage from DB, update local state (no full reload)
  const handleOptimisticStageUpdate = async (agentId: string) => {
    try {
      const { data, error } = await supabase
        .from("agents")
        .select("onboarding_stage, onboarding_completed_at, field_training_started_at")
        .eq("id", agentId)
        .single();

      if (error) throw error;

      setAgents(prev =>
        prev.map(a =>
          a.id === agentId
            ? {
                ...a,
                onboardingStage: data.onboarding_stage || a.onboardingStage,
                fieldTrainingStartedAt: data.field_training_started_at || a.fieldTrainingStartedAt,
              }
            : a
        )
      );
    } catch (err) {
      console.error("Error refreshing agent stage:", err);
    }
  };

  // Stats - Use agent.agentLicenseStatus (from agents table) as source of truth
  const totalLeadsCount = activeAgents.length;
  const hiredUnlicensed = activeAgents.filter(a => a.agentLicenseStatus !== "licensed").length;
  const contractedHired = activeAgents.filter(a => a.onboardingStage === "onboarding" || a.onboardingStage === "training_online").length;
  const coursePurchased = activeAgents.filter(a => a.hasTrainingCourse).length;
  const totalDeals = activeAgents
    .filter(a => a.onboardingStage === "evaluated")
    .reduce((sum, a) => sum + a.monthlyDeals, 0);
  const totalPaidAgents = activeAgents
    .filter(a => a.onboardingStage === "evaluated" && (a.standardPaid || a.premiumPaid)).length;

  // Duplicate detection
  const duplicateAgentIds = useMemo(() => {
    const emailCount = new Map<string, number>();
    const phoneCount = new Map<string, number>();
    activeAgents.forEach(agent => {
      if (agent.email) {
        const key = agent.email.toLowerCase().trim();
        emailCount.set(key, (emailCount.get(key) || 0) + 1);
      }
      if (agent.phone) {
        const key = agent.phone.replace(/\D/g, "").slice(-10);
        if (key.length === 10) phoneCount.set(key, (phoneCount.get(key) || 0) + 1);
      }
    });
    const dupeIds = new Set<string>();
    activeAgents.forEach(agent => {
      const emailKey = agent.email?.toLowerCase().trim();
      const phoneKey = agent.phone?.replace(/\D/g, "").slice(-10);
      if ((emailKey && (emailCount.get(emailKey) || 0) > 1) ||
          (phoneKey && phoneKey.length === 10 && (phoneCount.get(phoneKey) || 0) > 1)) {
        dupeIds.add(agent.id);
      }
    });
    return dupeIds;
  }, [activeAgents]);

  if (authLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    );
  }

  const getTimeAgo = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const renderAgentCard = (agent: AgentCRM, index: number) => {
    const daysInTraining = agent.fieldTrainingStartedAt
      ? differenceInDays(new Date(), new Date(agent.fieldTrainingStartedAt))
      : null;
    const evaluationDue = daysInTraining !== null && daysInTraining >= 7 && !agent.evaluationResult;
    const isInFieldActive = agent.onboardingStage === "evaluated";

    return (
      <div
        className="animate-stagger-in"
        style={{ animationDelay: `${index * 30}ms` }}
      >
      <GlassCard className={cn("p-2 card-hover-lift relative", agent.isDeactivated && "opacity-60")}>
        {/* Stale indicator - orange/red dot for agents not contacted in 48+ hours */}
        {isStaleAgent(agent) && (
          <div 
            className={cn(
              "absolute top-1.5 right-1.5 h-2.5 w-2.5 rounded-full",
              !agent.lastContactedAt ? "bg-red-500 animate-pulse" : "bg-amber-500"
            )} 
            title={agent.lastContactedAt ? `Last contacted ${getTimeAgo(agent.lastContactedAt)}` : "Never contacted"}
          />
        )}
        <div className="flex flex-col gap-1.5">
          {/* Top Row: Agent Info + Star Rating + Deactivate */}
          <div className="flex items-start justify-between gap-1.5">
            <div className="flex items-start gap-1.5 min-w-0">
              {/* Bulk Selection Checkbox */}
              <AgentSelectCheckbox
                agentId={agent.id}
                isSelected={selectedAgents.has(agent.id)}
                onToggle={(id) => {
                  const newSet = new Set(selectedAgents);
                  if (newSet.has(id)) {
                    newSet.delete(id);
                  } else {
                    newSet.add(id);
                  }
                  setSelectedAgents(newSet);
                }}
                isEnabled={bulkMode}
              />
              <div className={cn(
                "h-7 w-7 rounded-full bg-gradient-to-br flex items-center justify-center text-white text-xs font-bold shrink-0",
                getAvatarColor(agent.name)
              )}>
                {agent.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1 flex-wrap">
                  <h3 className="font-medium text-xs truncate">{agent.name}</h3>
                  {agent.isDeactivated && (
                    <Badge variant="outline" className="text-[9px] h-3.5 px-1 bg-amber-500/10 text-amber-400 border-amber-500/30">
                      Pass Pre-License Course
                    </Badge>
                  )}
                  {duplicateAgentIds.has(agent.id) && (
                    <Badge variant="outline" className="text-[9px] h-3.5 px-1 bg-amber-500/10 text-amber-400 border-amber-500/30">
                      ⚠ Duplicate
                    </Badge>
                  )}
                  {agent.managerId && agent.managerName && agent.managerId !== currentAgentIdRef[0] && (
                    <Badge variant="outline" className="text-[9px] h-3.5 px-1 bg-sky-500/10 text-sky-400 border-sky-500/30">
                      Under {agent.managerName.split(" ")[0]}
                    </Badge>
                  )}
                  {agent.onboardingStage === "evaluated" && agent.premiumPaid && (
                    <Badge className="text-[9px] h-3.5 px-1 bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                      $1K Paid
                    </Badge>
                  )}
                  {agent.onboardingStage === "evaluated" && agent.standardPaid && !agent.premiumPaid && (
                    <Badge className="text-[9px] h-3.5 px-1 bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                      $250 Paid
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground mt-0.5">
                  <a 
                    href={`mailto:${agent.email}`} 
                    className="hover:text-foreground transition-colors"
                    title="Click to copy"
                  >
                    {agent.email}
                  </a>
                  <div className="flex items-center gap-1 ml-auto shrink-0">
                    {agent.phone && (
                      <a href={`tel:${agent.phone}`} className="hover:text-foreground transition-colors">
                        <Phone className="h-2.5 w-2.5" />
                      </a>
                    )}
                    {agent.instagramHandle && (
                      <a 
                        href={`https://instagram.com/${agent.instagramHandle.replace('@', '')}`} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="hover:text-foreground transition-colors flex items-center gap-0.5"
                        title={agent.instagramHandle}
                      >
                        <Instagram className="h-2.5 w-2.5" />
                        <span className="text-[9px]">{agent.instagramHandle}</span>
                      </a>
                    )}
                    <button
                      onClick={() => setRecorderAgent(agent)}
                      className="hover:text-foreground transition-colors"
                      title="Record interview"
                    >
                      <Mic className="h-2.5 w-2.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
              <StarRating
                agentId={agent.id}
                rating={agent.potentialRating}
                onUpdate={(newRating?: number) => {
                  if (newRating !== undefined) {
                    setAgents(prev => prev.map(a => a.id === agent.id ? { ...a, potentialRating: newRating } : a));
                  }
                }}
                size="sm"
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-4 w-4 text-muted-foreground hover:text-amber-500 hover:bg-amber-500/10"
                title="Hide agent"
                onClick={async () => {
                  try {
                    const { error } = await supabase
                      .from("agents")
                      .update({ is_inactive: true })
                      .eq("id", agent.id);
                    if (error) throw error;
                    setAgents(prev => prev.map(a => a.id === agent.id ? { ...a, isInactive: true } : a));
                    toast.success(`${agent.name} hidden from pipeline`);
                  } catch (err) {
                    toast.error("Failed to hide agent");
                  }
                }}
              >
                <EyeOff className="h-2.5 w-2.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-4 w-4 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                onClick={() => setDeactivateAgent(agent)}
              >
                <X className="h-2.5 w-2.5" />
              </Button>
            </div>
          </div>

          {/* Badges for Live agents */}
          {isInFieldActive && agent.weekly10kBadges > 0 && (
            <PerformanceBadges
              agentId={agent.id}
              badgeCount={agent.weekly10kBadges}
              onUpdate={fetchAgents}
            />
          )}

          {/* Course Link for In Course agents */}
          {["onboarding", "training_online"].includes(agent.onboardingStage) && (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5">
                <a 
                  href="/onboarding-course" 
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors"
                >
                  <GraduationCap className="h-3.5 w-3.5" />
                  View Training Course
                </a>
                {(agent.licenseProgress !== "licensed") && (
                  <ResendLicensingButton
                    recipientEmail={agent.email}
                    recipientName={agent.name}
                    licenseStatus="unlicensed"
                  />
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-full h-7 text-[10px] gap-1 bg-sky-500/10 text-sky-400 border-sky-500/30 hover:bg-sky-500/20"
                disabled={sendingCourseLogin === agent.id}
                onClick={async () => {
                  setSendingCourseLogin(agent.id);
                  try {
                    const { data, error } = await supabase.functions.invoke("send-course-enrollment-email", {
                      body: { agentId: agent.id },
                    });
                    if (error) throw error;
                    toast.success(`Course login email sent to ${agent.name}`);
                    playSound("success");
                  } catch (err: any) {
                    console.error("Failed to send course login:", err);
                    toast.error("Failed to send course login email");
                  } finally {
                    setSendingCourseLogin(null);
                  }
                }}
              >
                {sendingCourseLogin === agent.id ? (
                  <RefreshCw className="h-3 w-3 animate-spin" />
                ) : (
                  <Send className="h-3 w-3" />
                )}
                Resend Course Login
              </Button>
            </div>
          )}

          {/* License Progress Selector - interactive dropdown */}
          <div className="flex items-center gap-1.5">
            <LicenseProgressSelector
              applicationId={agent.id}
              currentProgress={(agent.licenseProgress || "unlicensed") as any}
              testScheduledDate={agent.testScheduledDate}
              onProgressUpdated={fetchAgents}
              className="h-5 text-[10px]"
            />
          </div>

          {/* Last Follow-Up line */}
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Clock className="h-2.5 w-2.5" />
            <span>Last F/U:</span>
            <span className={cn(
              "font-medium",
              isStaleAgent(agent) ? "text-amber-500" : "text-foreground"
            )}>
              {agent.lastContactedAt ? getTimeAgo(agent.lastContactedAt) : "Never"}
            </span>
          </div>

          {/* Checklist - Compact */}
          <AgentChecklist
            agentId={agent.id}
            hasTrainingCourse={agent.hasTrainingCourse}
            hasDialerLogin={agent.hasDialerLogin}
            hasDiscordAccess={agent.hasDiscordAccess}
            onOptimisticToggle={(agentId, field, newValue) => {
              setAgents(prev => prev.map(a => {
                if (a.id !== agentId) return a;
                const fieldMap: Record<string, keyof AgentCRM> = {
                  has_training_course: "hasTrainingCourse",
                  has_dialer_login: "hasDialerLogin",
                  has_discord_access: "hasDiscordAccess",
                };
                const key = fieldMap[field];
                if (!key) return a;
                return { ...a, [key]: newValue };
              }));
            }}
          />

          {/* Onboarding Stage - Compact */}
          <OnboardingTracker
            agentId={agent.id}
            agentName={agent.name}
            currentStage={agent.onboardingStage}
            onStageUpdate={() => handleOptimisticStageUpdate(agent.id)}
            onGoLive={() => setInstagramPromptAgent(agent)}
            readOnly={false}
          />

          {/* Attendance Grids - In-Field Training: Training + Meetings */}
          {agent.onboardingStage === "in_field_training" && (
            <div className="border-t border-border pt-1.5 space-y-1">
              <AttendanceGrid
                agentId={agent.id}
                type="training"
                label="Homework"
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

          {/* Live agents: Meeting attendance + Did they sell? */}
          {isInFieldActive && (
            <div className="border-t border-border pt-1.5 space-y-1">
              <AttendanceGrid
                agentId={agent.id}
                type="onboarded_meeting"
                label="Meeting"
                onMarkAbsent={() => handleMarkAbsent(agent.id)}
              />
              <AttendanceGrid
                agentId={agent.id}
                type="daily_sale"
                label="Sold"
                onMarkAbsent={() => handleMarkAbsent(agent.id)}
              />
            </div>
          )}

          {/* Status Controls */}
          <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-2">
            {/* Training Duration & Evaluation */}
            {daysInTraining !== null && agent.onboardingStage === "in_field_training" && (
              <Badge 
                variant="outline" 
                className={cn(
                  "gap-0.5 text-[10px] h-5 px-1.5",
                  evaluationDue && "bg-amber-500/20 text-amber-400 border-amber-500/30"
                )}
              >
                <Clock className="h-2.5 w-2.5" />
                {daysInTraining}d
                {evaluationDue && " - Eval!"}
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

            {/* Send Portal Login for any agent with an account */}
            {agent.userId && (
              <Button
                variant="ghost"
                size="sm"
                className="h-5 px-1.5 text-[10px] gap-0.5"
                onClick={() => handleSendPortalLogin(agent)}
                title="Send Portal Login (includes Discord link)"
              >
                <Send className="h-2.5 w-2.5" />
                Login
              </Button>
            )}

            <div className="flex-1" />

            {/* Attendance Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={cn("gap-0.5 text-[10px] h-5 px-1.5", attendanceColors[agent.attendanceStatus])}
                >
                  {attendanceLabels[agent.attendanceStatus].split(' ')[0]}
                  <ChevronDown className="h-2.5 w-2.5" />
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

          </div>

          {/* Week + Month AOP Stats - Prominent Display for Live Agents */}
          {isInFieldActive && (
            <div className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg bg-gradient-to-r from-primary/5 to-primary/10 border border-primary/20 mt-2">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-muted-foreground">Week:</span>
                <span className="text-sm font-bold text-primary">${agent.weeklyALP.toLocaleString()}</span>
              </div>
              <div className="w-px h-4 bg-border" />
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-muted-foreground">Month:</span>
                <span className="text-sm font-bold text-foreground">${agent.monthlyALP.toLocaleString()}</span>
              </div>
              {agent.weeklyClosingRate > 0 && (
                <>
                  <div className="w-px h-4 bg-border" />
                  <span className={cn(
                    "text-[10px] font-medium",
                    agent.weeklyClosingRate >= 30 && "text-primary"
                  )}>
                    {agent.weeklyClosingRate}%
                  </span>
                </>
              )}
            </div>
          )}

          <AgentNotes
            agentId={agent.id}
            onNoteAdded={() => {}}
          />
        </div>
      </GlassCard>
      </div>
    );
  };

  return (
    <DashboardLayout>
      <div className="space-y-4 page-enter">
        {/* AbandonedLeadsPanel removed - exists only in Admin Panel now */}

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold gradient-text">Agent CRM</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Manage licensed agents and track progress
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {(isAdmin || isManager) && (
              <Button
                variant={bulkMode ? "secondary" : "outline"}
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  setBulkMode(!bulkMode);
                  setSelectedAgents(new Set());
                }}
              >
                <CheckSquare className="h-3.5 w-3.5" />
                {bulkMode ? "Exit Bulk Mode" : "Bulk Actions"}
              </Button>
            )}
            {isAdmin && (
              <Button 
                onClick={handleBulkSendPortalLogins} 
                variant="outline" 
                size="sm" 
                className="gap-1.5"
                disabled={sendingBulkLogins}
              >
                <Mail className="h-3.5 w-3.5" />
                {sendingBulkLogins ? "Sending..." : "Email All Logins"}
              </Button>
            )}
            <AddAgentModal onAgentAdded={fetchAgents} />
            <Button onClick={fetchAgents} variant="outline" size="sm" className="gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
          </div>
        </div>

        {/* Bulk Actions Bar */}
        {bulkMode && (
          <BulkStageActions
            agents={stageFilteredAgents.map(a => ({
              id: a.id,
              name: a.name,
              onboardingStage: a.onboardingStage,
            }))}
            selectedIds={selectedAgents}
            onSelectionChange={setSelectedAgents}
            onBulkUpdate={() => {
              fetchAgents();
              setSelectedAgents(new Set());
            }}
            isEnabled={bulkMode}
            onToggle={() => {
              setBulkMode(false);
              setSelectedAgents(new Set());
            }}
          />
        )}

        {/* Clickable Stats Filters - Reordered: Total Leads, Hired (Unlicensed), Contracted (Hired), Course Purchased */}
        <AnimatePresence initial={false}>
          {!expandedColumn && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="grid grid-cols-2 md:grid-cols-4 gap-2"
            >
              <GlassCard
                className={cn(
                  "p-2 cursor-pointer transition-all hover:ring-2 hover:ring-primary/50 hover:scale-[1.02]",
                  expandedColumn === "all" && "ring-2 ring-primary"
                )}
                onClick={() => { setExpandedColumn("all"); playSound("whoosh"); }}
              >
                <div className="flex items-center gap-2">
                  <div className="p-1 rounded-lg bg-primary/10">
                    <Users className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <div>
                    <p className="text-lg font-bold">{totalLeadsCount}</p>
                    <p className="text-[10px] text-muted-foreground">Total Leads</p>
                  </div>
                </div>
              </GlassCard>

              <GlassCard
                className={cn(
                  "p-2 cursor-pointer transition-all hover:ring-2 hover:ring-amber-500/50 hover:scale-[1.02]",
                  expandedColumn === "unlicensed" && "ring-2 ring-amber-500"
                )}
                onClick={() => { setExpandedColumn("unlicensed"); playSound("whoosh"); }}
              >
                <div className="flex items-center gap-2">
                  <div className="p-1 rounded-lg bg-amber-500/10">
                    <GraduationCap className="h-3.5 w-3.5 text-amber-500" />
                  </div>
                  <div>
                    <p className="text-lg font-bold">{hiredUnlicensed}</p>
                    <p className="text-[10px] text-muted-foreground">Hired (Unlicensed)</p>
                  </div>
                </div>
              </GlassCard>

              <GlassCard
                className={cn(
                  "p-2 cursor-pointer transition-all hover:ring-2 hover:ring-primary/50 hover:scale-[1.02]",
                  expandedColumn === "in_course" && "ring-2 ring-primary"
                )}
                onClick={() => { setExpandedColumn("in_course"); playSound("whoosh"); }}
              >
                <div className="flex items-center gap-2">
                  <div className="p-1 rounded-lg bg-primary/10">
                    <BookOpen className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <div>
                    <p className="text-lg font-bold">{contractedHired}</p>
                    <p className="text-[10px] text-muted-foreground">Contracted (Hired)</p>
                  </div>
                </div>
              </GlassCard>

              <GlassCard
                className={cn(
                  "p-2 cursor-pointer transition-all hover:ring-2 hover:ring-emerald-500/50 hover:scale-[1.02]",
                  expandedColumn === "course_purchased" && "ring-2 ring-emerald-500"
                )}
                onClick={() => { setExpandedColumn("course_purchased"); playSound("whoosh"); }}
              >
                <div className="flex items-center gap-2">
                  <div className="p-1 rounded-lg bg-emerald-500/10">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  </div>
                  <div>
                    <p className="text-lg font-bold">{coursePurchased}</p>
                    <p className="text-[10px] text-muted-foreground">Hired (Course Purchased)</p>
                  </div>
                </div>
              </GlassCard>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Filters - Only show when not expanded */}
        <AnimatePresence initial={false}>
          {!expandedColumn && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex flex-col sm:flex-row gap-3 flex-wrap"
            >
              <div className="relative flex-1 min-w-[180px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search agents..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8 h-8 text-sm"
                />
              </div>

              {isAdmin && managers.length > 0 && (
                <Select value={managerFilter} onValueChange={setManagerFilter}>
                  <SelectTrigger className="w-[160px] h-8 text-sm">
                    <Filter className="h-3.5 w-3.5 mr-1.5" />
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
                className="gap-1.5 h-8"
              >
                <UserX className="h-3.5 w-3.5" />
                {showDeactivated ? "Showing Deactivated" : "Show Deactivated"}
              </Button>

              <Button
                variant={showInactive ? "secondary" : "outline"}
                size="sm"
                onClick={() => setShowInactive(!showInactive)}
                className="gap-1.5 h-8"
              >
                <Eye className="h-3.5 w-3.5" />
                {showInactive ? "Showing Inactive" : "Show Inactive"}
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main Content - Either 3-Column Overview or Full-Screen Expanded View */}
        <AnimatePresence initial={false}>
          {loading ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center justify-center h-64"
            >
              <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
            </motion.div>
          ) : expandedColumn ? (
            <motion.div
              key={`expanded-${expandedColumn}`}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="space-y-4"
            >
              {/* Expanded View Header */}
              {(() => {
                const columnConfig = {
                  in_course: { 
                    label: "Onboarding", 
                    icon: BookOpen, 
                    stages: ["onboarding", "training_online"] as OnboardingStage[],
                    color: "text-primary",
                    bgColor: "bg-primary/10"
                  },
                  in_training: { 
                    label: "In-Field Training", 
                    icon: GraduationCap, 
                    stages: ["in_field_training"] as OnboardingStage[],
                    color: "text-primary",
                    bgColor: "bg-primary/10"
                  },
                  live: { 
                    label: "Live", 
                    icon: Briefcase, 
                    stages: ["evaluated"] as OnboardingStage[],
                    color: "text-primary",
                    bgColor: "bg-primary/10"
                  },
                  meeting_eligible: { 
                    label: "Meeting Eligible", 
                    icon: Video, 
                    stages: ["in_field_training", "evaluated"] as OnboardingStage[],
                    color: "text-accent-foreground",
                    bgColor: "bg-accent/10"
                  },
                  all: { 
                    label: "All Agents", 
                    icon: Users, 
                    stages: [] as OnboardingStage[],
                    color: "text-primary",
                    bgColor: "bg-primary/10"
                  },
                  unlicensed: { 
                    label: "Unlicensed", 
                    icon: GraduationCap, 
                    stages: [] as OnboardingStage[],
                    color: "text-amber-500",
                    bgColor: "bg-amber-500/10"
                  },
                  paid: { 
                    label: "Paid Agents", 
                    icon: DollarSign, 
                    stages: [] as OnboardingStage[],
                    color: "text-emerald-500",
                    bgColor: "bg-emerald-500/10"
                  },
                  course_purchased: { 
                    label: "Hired (Course Purchased)", 
                    icon: CheckCircle2, 
                    stages: [] as OnboardingStage[],
                    color: "text-emerald-500",
                    bgColor: "bg-emerald-500/10"
                  },
                };

                const config = columnConfig[expandedColumn as keyof typeof columnConfig];
                if (!config) return null;

                const Icon = config.icon;
                // Use activeAgents with search+manager filters only (no evaluation filter)
                // so expanded list matches stat card counts exactly
                const searchManagerFiltered = activeAgents.filter(a => {
                  const matchesSearch = !searchTerm || 
                    a.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    a.email.toLowerCase().includes(searchTerm.toLowerCase());
                  const matchesManager = managerFilter === "all" || a.managerId === managerFilter;
                  return matchesSearch && matchesManager;
                });

                const expandedAgentsUnsorted = expandedColumn === "all"
                  ? searchManagerFiltered
                  : expandedColumn === "unlicensed"
                  ? searchManagerFiltered.filter(a => a.agentLicenseStatus !== "licensed")
                  : expandedColumn === "paid"
                  ? searchManagerFiltered.filter(a => a.onboardingStage === "evaluated" && (a.standardPaid || a.premiumPaid))
                  : expandedColumn === "course_purchased"
                  ? searchManagerFiltered.filter(a => a.hasTrainingCourse)
                  : searchManagerFiltered.filter(a => config.stages.includes(a.onboardingStage));

                // Sort by last contacted (null/oldest first) for follow-up priority
                const expandedAgents = [...expandedAgentsUnsorted].sort((a, b) => {
                  if (!a.lastContactedAt && !b.lastContactedAt) return 0;
                  if (!a.lastContactedAt) return -1;
                  if (!b.lastContactedAt) return 1;
                  return new Date(a.lastContactedAt).getTime() - new Date(b.lastContactedAt).getTime();
                });

                return (
                  <>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setExpandedColumn(null)}
                          className="gap-1.5"
                        >
                          <ArrowLeft className="h-4 w-4" />
                          Back
                        </Button>
                        <div className={cn("flex items-center gap-2 px-3 py-2 rounded-lg", config.bgColor)}>
                          <Icon className={cn("h-5 w-5", config.color)} />
                          <h2 className={cn("font-bold text-lg", config.color)}>
                            {config.label}
                          </h2>
                          <Badge variant="secondary" className="ml-2">
                            {expandedAgents.length}
                          </Badge>
                        </div>
                      </div>
                      
                      {/* Search in expanded view */}
                      <div className="relative w-64">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                        <Input
                          placeholder="Search agents..."
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          className="pl-8 h-8 text-sm"
                        />
                      </div>
                    </div>

                    {/* Full-Screen Grid */}
                    {expandedAgents.length === 0 ? (
                      <GlassCard className="p-8 text-center">
                        <Icon className={cn("h-12 w-12 mx-auto mb-3 opacity-50", config.color)} />
                        <p className="text-muted-foreground">
                          No agents in this category
                        </p>
                      </GlassCard>
                    ) : (
                      <motion.div 
                        className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
                        initial="hidden"
                        animate="visible"
                        variants={{
                          hidden: { opacity: 0 },
                          visible: {
                            opacity: 1,
                            transition: {
                              staggerChildren: 0.05
                            }
                          }
                        }}
                      >
                        {expandedAgents.map((agent, index) => (
                          <motion.div
                            key={agent.id}
                            variants={{
                              hidden: { opacity: 0, y: 20 },
                              visible: { opacity: 1, y: 0 }
                            }}
                            transition={{ type: "spring", stiffness: 300, damping: 30 }}
                          >
                            {renderAgentCard(agent, index)}
                          </motion.div>
                        ))}
                      </motion.div>
                    )}
                  </>
                );
              })()}
            </motion.div>
          ) : (
            <motion.div
              key="overview"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.2 }}
              className="grid grid-cols-1 lg:grid-cols-3 gap-4"
            >
              {COLUMNS.map((column) => {
                const columnAgents = getAgentsForColumn(column.stages);
                const Icon = column.icon;
                
                return (
                  <motion.div 
                    key={column.key} 
                    className="space-y-3"
                    whileHover={{ scale: 1.01 }}
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  >
                    <div 
                      className={cn(
                        "flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-all hover:ring-2 hover:ring-primary/50",
                        column.bgColor
                      )}
                      onClick={() => setExpandedColumn(column.key)}
                    >
                      <Icon className={cn("h-4 w-4", column.color)} />
                      <h2 className={cn("font-semibold text-sm", column.color)}>
                        {column.label}
                      </h2>
                      <Badge variant="secondary" className="ml-auto text-xs">
                        {columnAgents.length}
                      </Badge>
                    </div>
                    
                    {columnAgents.length === 0 ? (
                      <GlassCard className="p-4 text-center">
                        <p className="text-xs text-muted-foreground">
                          No agents in this stage
                        </p>
                      </GlassCard>
                    ) : (
                      <div className="space-y-2">
                        {columnAgents.slice(0, 3).map((agent, index) => (
                          <div key={agent.id}>
                            {renderAgentCard(agent, index)}
                          </div>
                        ))}
                        {columnAgents.length > 3 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="w-full text-xs text-muted-foreground hover:text-foreground"
                            onClick={() => setExpandedColumn(column.key)}
                          >
                            View all {columnAgents.length} agents →
                          </Button>
                        )}
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
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

      {/* Instagram Prompt Dialog */}
      <InstagramPromptDialog
        open={!!instagramPromptAgent}
        onOpenChange={(open) => !open && setInstagramPromptAgent(null)}
        agentId={instagramPromptAgent?.id || ""}
        agentName={instagramPromptAgent?.name || ""}
        onComplete={fetchAgents}
      />

      {/* Interview Recorder Modal */}
      {recorderAgent && user && (
        <InterviewRecorder
          applicationId={recorderAgent.id}
          agentId={recorderAgent.id}
          applicantName={recorderAgent.name}
          onClose={() => setRecorderAgent(null)}
          onTranscriptionSaved={fetchAgents}
        />
      )}
    </DashboardLayout>
  );
}
