import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Users,
  Phone,
  CheckCircle,
  TrendingUp,
  ChevronDown,
  ChevronUp,
  DollarSign,
  ArrowUpDown,
  ChevronRight,
  Award,
  Clock,
  Edit2,
  Send,
  RotateCcw,
  Shield,
  ShieldOff,
  AlertTriangle,
  Loader2,
  GraduationCap,
  Search,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { OnboardingTracker } from "./OnboardingTracker";
import { AgentQuickEditDialog } from "./AgentQuickEditDialog";
import { AddToCourseButton } from "./AddToCourseButton";
import { DeactivateAgentDialog } from "./DeactivateAgentDialog";
import { ManagerAssignMenu } from "./ManagerAssignMenu";
import { cn } from "@/lib/utils";
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from "date-fns";
import { toast } from "sonner";
import { useSoundEffects } from "@/hooks/useSoundEffects";

type SortOption = "production-desc" | "production-asc" | "name" | "status";
type RosterFilter = "all" | "licensed" | "unlicensed" | "training";

interface TeamMember {
  id: string;
  userId: string;
  name: string;
  email: string;
  status: string;
  onboardingStage: string;
  totalLeads: number;
  contacted: number;
  closed: number;
  closeRate: number;
  joinedAt: string;
  weekALP: number;
  monthALP: number;
  monthDeals: number;
  licenseStatus: "licensed" | "unlicensed" | "pending";
  managerName: string | null;
  isDirectReport: boolean;
  isDeactivated: boolean;
  isInactive: boolean;
  lastContactedAt: string | null;
  invitedByManagerId: string | null;
  standardPaid: boolean;
  premiumPaid: boolean;
}

interface TeamStats {
  totalMembers: number;
  totalLeads: number;
  totalClosed: number;
  avgCloseRate: number;
  licensedCount: number;
  unlicensedCount: number;
  trainingCount: number;
}

export function ManagerTeamView() {
  const { user, isManager, isAdmin } = useAuth();
  const { playSound } = useSoundEffects();
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [teamStats, setTeamStats] = useState<TeamStats>({
    totalMembers: 0,
    totalLeads: 0,
    totalClosed: 0,
    avgCloseRate: 0,
    licensedCount: 0,
    unlicensedCount: 0,
    trainingCount: 0,
  });
  const [activeFilter, setActiveFilter] = useState<RosterFilter>("all");
  const [loading, setLoading] = useState(true);
  const [expandedMember, setExpandedMember] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>("production-desc");
  const [licensedOpen, setLicensedOpen] = useState(true);
  const [unlicensedOpen, setUnlicensedOpen] = useState(true);
  const [terminatedOpen, setTerminatedOpen] = useState(false);
  const [editAgent, setEditAgent] = useState<TeamMember | null>(null);
  const [deactivateAgent, setDeactivateAgent] = useState<{ id: string; name: string } | null>(null);
  const [managerUserIds, setManagerUserIds] = useState<Set<string>>(new Set());
  const [togglingManager, setTogglingManager] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const handleSendPortalLogin = async (member: TeamMember) => {
    try {
      const { error } = await supabase.functions.invoke("send-agent-portal-login", {
        body: { agentId: member.id },
      });
      if (error) throw error;
      playSound("success");
      toast.success(`Portal login sent to ${member.email}`);
    } catch (error) {
      console.error("Error sending portal login:", error);
      playSound("error");
      toast.error("Failed to send portal login");
    }
  };

  const handleReactivate = async (member: TeamMember) => {
    try {
      const { error } = await supabase
        .from("agents")
        .update({ status: "active" as const, is_deactivated: false, is_inactive: false, deactivation_reason: null })
        .eq("id", member.id);
      if (error) throw error;
      playSound("celebrate");
      toast.success(`${member.name} has been reactivated!`);
      fetchTeamData();
    } catch (error) {
      console.error("Error reactivating agent:", error);
      playSound("error");
      toast.error("Failed to reactivate agent");
    }
  };

  const handleToggleLicense = async (member: TeamMember) => {
    const newStatus = member.licenseStatus === "licensed" ? "unlicensed" : "licensed";
    try {
      const { error } = await supabase
        .from("agents")
        .update({ license_status: newStatus })
        .eq("id", member.id);
      if (error) throw error;
      playSound("click");
      toast.success(`${member.name} marked as ${newStatus}`);
      fetchTeamData();
    } catch (error) {
      console.error("Error toggling license:", error);
      playSound("error");
      toast.error("Failed to update license status");
    }
  };

  useEffect(() => {
    fetchTeamData();
    if (isAdmin) fetchManagerRoles();
  }, [user?.id, isAdmin]);

  const fetchManagerRoles = async () => {
    const { data } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "manager");
    setManagerUserIds(new Set((data || []).map(r => r.user_id)));
  };

  const handleToggleManager = async (member: TeamMember) => {
    if (!member.userId) return;
    setTogglingManager(member.id);
    try {
      const isCurrentlyManager = managerUserIds.has(member.userId);
      if (isCurrentlyManager) {
        const { error } = await supabase
          .from("user_roles")
          .delete()
          .eq("user_id", member.userId)
          .eq("role", "manager");
        if (error) throw error;
        toast.success(`${member.name} removed as manager`);
      } else {
        const { error } = await supabase
          .from("user_roles")
          .insert({ user_id: member.userId, role: "manager" });
        if (error) throw error;
        toast.success(`${member.name} promoted to manager!`);
      }
      fetchManagerRoles();
    } catch (error: any) {
      console.error("Error toggling manager:", error);
      toast.error(error.message || "Failed to update role");
    } finally {
      setTogglingManager(null);
    }
  };

  const fetchTeamData = async () => {
    if (!user) return;

    try {
      // Get the current user's agent ID
      const { data: currentAgent } = await supabase
        .from("agents")
        .select("id")
        .eq("user_id", user.id)
        .single();

      if (!currentAgent) {
        setLoading(false);
        return;
      }

      let teamAgents: any[] = [];

      if (isAdmin) {
        const { data: allAgents, error } = await supabase
          .from("agents")
          .select(`
            id,
            user_id,
            status,
            onboarding_stage,
            created_at,
            license_status,
            invited_by_manager_id,
            is_deactivated,
            is_inactive
          `);

        if (error) {
          console.error("Error fetching all agents:", error);
          setLoading(false);
          return;
        }

        teamAgents = allAgents || [];
      } else {
        const { data: directReports, error } = await supabase
          .from("agents")
          .select(`
            id,
            user_id,
            status,
            onboarding_stage,
            created_at,
            license_status,
            invited_by_manager_id
          `)
          .eq("invited_by_manager_id", currentAgent.id);

        if (error) {
          console.error("Error fetching team:", error);
          setLoading(false);
          return;
        }

        teamAgents = directReports || [];
      }

      // Also fetch unlicensed applicants from the applications table
      // These are people who applied but haven't been converted to agent records yet
      let pipelineApplicants: any[] = [];
      // Only include unlicensed applicants who are actually hired (approved/contracting)
      const { data: apps } = await supabase
        .from("applications")
        .select("id, first_name, last_name, email, phone, license_status, status, created_at, assigned_agent_id")
        .is("terminated_at", null)
        .eq("license_status", "unlicensed")
        .in("status", ["approved", "contracting"]);
      pipelineApplicants = apps || [];

      // Deduplicate: remove applicants who already have agent records (match by email)
      const agentEmails = new Set<string>();
      // We'll get emails from profiles later, for now collect user_ids
      const agentUserIds = teamAgents.map(a => a.user_id).filter(Boolean);

      if (teamAgents.length === 0 && pipelineApplicants.length === 0) {
        setLoading(false);
        return;
      }

      // Get all manager IDs to fetch their names
      const managerIds = [...new Set(teamAgents
        .map(a => a.invited_by_manager_id)
        .filter(Boolean))];

      // Fetch manager agents and their profiles
      let managerProfiles: Record<string, string> = {};
      if (managerIds.length > 0) {
        const { data: managerAgents } = await supabase
          .from("agents")
          .select("id, user_id")
          .in("id", managerIds);

        if (managerAgents && managerAgents.length > 0) {
          const managerUserIds = managerAgents.map(m => m.user_id).filter(Boolean);
          const { data: profiles } = await supabase
            .from("profiles")
            .select("user_id, full_name")
            .in("user_id", managerUserIds);

          // Build a map of manager agent id -> manager name
          managerAgents.forEach(manager => {
            const profile = profiles?.find(p => p.user_id === manager.user_id);
            if (profile) {
              managerProfiles[manager.id] = profile.full_name || "Unknown Manager";
            }
          });
        }
      }

      // Get profiles for team members
      const userIds = teamAgents.map(a => a.user_id).filter(Boolean);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name, email")
        .in("user_id", userIds);

      // Get applications assigned to each team member
      const agentIds = teamAgents.map(a => a.id);
      const { data: applications } = await supabase
        .from("applications")
        .select("assigned_agent_id, status, contacted_at, closed_at, last_contacted_at")
        .in("assigned_agent_id", agentIds);

      // Get production data for week and month
      const today = new Date();
      const weekStart = format(startOfWeek(today, { weekStartsOn: 0 }), "yyyy-MM-dd");
      const weekEnd = format(endOfWeek(today, { weekStartsOn: 0 }), "yyyy-MM-dd");
      const monthStart = format(startOfMonth(today), "yyyy-MM-dd");
      const monthEnd = format(endOfMonth(today), "yyyy-MM-dd");

      const { data: weekProduction } = await supabase
        .from("daily_production")
        .select("agent_id, aop, deals_closed")
        .in("agent_id", agentIds)
        .gte("production_date", weekStart)
        .lte("production_date", weekEnd);

      const { data: monthProduction } = await supabase
        .from("daily_production")
        .select("agent_id, aop, deals_closed")
        .in("agent_id", agentIds)
        .gte("production_date", monthStart)
        .lte("production_date", monthEnd);

      // Fetch payment tracking for this week
      const { data: payments } = await supabase
        .from("lead_payment_tracking")
        .select("agent_id, tier, paid")
        .eq("week_start", weekStart)
        .eq("paid", true);

      const paymentMap = new Map<string, { standard: boolean; premium: boolean }>();
      payments?.forEach((p: any) => {
        const existing = paymentMap.get(p.agent_id) || { standard: false, premium: false };
        if (p.tier === "standard") existing.standard = true;
        if (p.tier === "premium") existing.premium = true;
        paymentMap.set(p.agent_id, existing);
      });

      // Build team member data
      // Filter out the current user's own agent record
      const filteredAgents = teamAgents.filter(a => a.user_id !== user.id);

      const members: TeamMember[] = filteredAgents.map(agent => {
        const profile = profiles?.find(p => p.user_id === agent.user_id);
        const agentApps = applications?.filter(a => a.assigned_agent_id === agent.id) || [];
        const totalLeads = agentApps.length;
        const contacted = agentApps.filter(a => a.contacted_at).length;
        const closed = agentApps.filter(a => a.closed_at).length;

        const lastContactDates = agentApps
          .map(a => a.last_contacted_at)
          .filter(Boolean) as string[];
        const lastContactedAt = lastContactDates.length > 0
          ? lastContactDates.sort().reverse()[0]
          : null;

        const agentWeekProduction = weekProduction?.filter(p => p.agent_id === agent.id) || [];
        const agentMonthProduction = monthProduction?.filter(p => p.agent_id === agent.id) || [];

        const weekALP = agentWeekProduction.reduce((sum, p) => sum + (Number(p.aop) || 0), 0);
        const monthALP = agentMonthProduction.reduce((sum, p) => sum + (Number(p.aop) || 0), 0);
        const monthDeals = agentMonthProduction.reduce((sum, p) => sum + (p.deals_closed || 0), 0);

        const isDirectReport = agent.invited_by_manager_id === currentAgent.id;
        const managerName = agent.invited_by_manager_id
          ? managerProfiles[agent.invited_by_manager_id] || null
          : null;

        const pay = paymentMap.get(agent.id) || { standard: false, premium: false };

        return {
          id: agent.id,
          userId: agent.user_id || "",
          name: profile?.full_name || profile?.email?.split("@")[0] || "Unknown",
          email: profile?.email || "",
          status: agent.status,
          onboardingStage: agent.onboarding_stage || "onboarding",
          totalLeads,
          contacted,
          closed,
          closeRate: totalLeads > 0 ? (closed / totalLeads) * 100 : 0,
          joinedAt: agent.created_at,
          weekALP,
          monthALP,
          monthDeals,
          licenseStatus: agent.license_status as "licensed" | "unlicensed" | "pending",
          managerName,
          isDirectReport,
          isDeactivated: agent.is_deactivated || false,
          isInactive: agent.is_inactive || false,
          lastContactedAt,
          invitedByManagerId: agent.invited_by_manager_id || null,
          standardPaid: pay.standard,
          premiumPaid: pay.premium,
        };
      });

      // Deduplicate pipeline applicants: exclude those whose email matches an existing agent profile
      const memberEmails = new Set(members.map(m => m.email.toLowerCase()).filter(Boolean));
      const uniqueApplicants = pipelineApplicants.filter(app => {
        const appEmail = (app.email || "").toLowerCase();
        return appEmail && !memberEmails.has(appEmail);
      });

      // Create pipeline member entries from applications
      const pipelineMembers: TeamMember[] = uniqueApplicants.map(app => ({
        id: `app-${app.id}`,
        userId: "",
        name: `${app.first_name} ${app.last_name || ""}`.trim(),
        email: app.email || "",
        status: app.status || "new",
        onboardingStage: "onboarding",
        totalLeads: 0,
        contacted: 0,
        closed: 0,
        closeRate: 0,
        joinedAt: app.created_at,
        weekALP: 0,
        monthALP: 0,
        monthDeals: 0,
        licenseStatus: "unlicensed" as const,
        managerName: null,
        isDirectReport: true,
        isDeactivated: false,
        isInactive: false,
        lastContactedAt: null,
        invitedByManagerId: null,
        standardPaid: false,
        premiumPaid: false,
      }));

      const allMembers = [...members, ...pipelineMembers];
      setTeamMembers(allMembers);

      // Calculate team stats including pipeline applicants
      const activeOnly = allMembers.filter(m => !m.isDeactivated && !m.isInactive && m.status !== "terminated");
      const totalLeads = allMembers.reduce((sum, m) => sum + m.totalLeads, 0);
      const totalClosed = allMembers.reduce((sum, m) => sum + m.closed, 0);
      const licensedCount = activeOnly.filter(m => m.licenseStatus === "licensed").length;
      const unlicensedCount = activeOnly.filter(m => m.licenseStatus !== "licensed").length;
      const trainingCount = activeOnly.filter(m => m.onboardingStage === "training_online" || m.onboardingStage === "in_field_training").length;

      setTeamStats({
        totalMembers: activeOnly.length,
        totalLeads,
        totalClosed,
        avgCloseRate: totalLeads > 0 ? (totalClosed / totalLeads) * 100 : 0,
        licensedCount,
        unlicensedCount,
        trainingCount,
      });
    } catch (err) {
      console.error("Error in fetchTeamData:", err);
    } finally {
      setLoading(false);
    }
  };

  // Sorted team members
  // Apply search filter first
  const searchFiltered = useMemo(() => {
    if (!searchQuery.trim()) return teamMembers;
    const q = searchQuery.toLowerCase();
    return teamMembers.filter(m =>
      m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)
    );
  }, [teamMembers, searchQuery]);

  const sortedMembers = useMemo(() => {
    const sorted = [...searchFiltered];
    switch (sortBy) {
      case "production-desc":
        return sorted.sort((a, b) => b.monthALP - a.monthALP);
      case "production-asc":
        return sorted.sort((a, b) => a.monthALP - b.monthALP);
      case "name":
        return sorted.sort((a, b) => a.name.localeCompare(b.name));
      case "status":
        return sorted.sort((a, b) => a.status.localeCompare(b.status));
      default:
        return sorted;
    }
  }, [searchFiltered, sortBy]);

  // Split into licensed, unlicensed, and terminated
  const terminatedMembers = useMemo(() =>
    sortedMembers.filter(m => m.isDeactivated || m.isInactive || m.status === "terminated"),
    [sortedMembers]
  );

  const activeMembers = useMemo(() =>
    sortedMembers.filter(m => !m.isDeactivated && !m.isInactive && m.status !== "terminated"),
    [sortedMembers]
  );

  const licensedMembers = useMemo(() => 
    activeMembers.filter(m => m.licenseStatus === "licensed"),
    [activeMembers]
  );

  const unlicensedMembers = useMemo(() => 
    activeMembers.filter(m => m.licenseStatus !== "licensed"),
    [activeMembers]
  );

  const trainingMembers = useMemo(() =>
    activeMembers.filter(m => m.onboardingStage === "training_online" || m.onboardingStage === "in_field_training"),
    [activeMembers]
  );

  const filteredMembers = useMemo(() => {
    switch (activeFilter) {
      case "licensed": return licensedMembers;
      case "unlicensed": return unlicensedMembers;
      case "training": return trainingMembers;
      default: return activeMembers;
    }
  }, [activeFilter, licensedMembers, unlicensedMembers, trainingMembers, activeMembers]);

  const handleFilterClick = (filter: RosterFilter) => {
    setActiveFilter(prev => prev === filter ? "all" : filter);
  };

  const toggleExpand = (memberId: string) => {
    setExpandedMember(expandedMember === memberId ? null : memberId);
  };

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

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active":
        return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
      case "pending":
        return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
      case "inactive":
        return "bg-red-500/20 text-red-400 border-red-500/30";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const renderMemberCard = (member: TeamMember, index: number) => (
    <motion.div
      key={member.id}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03 }}
      className="border border-border rounded-lg overflow-hidden"
    >
      <div
        className="p-4 cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={() => toggleExpand(member.id)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center">
              <span className="text-sm font-semibold text-primary">
                {member.name.charAt(0).toUpperCase()}
              </span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="font-medium">{member.name}</p>
                {/* Manager role badge */}
                {member.userId && managerUserIds.has(member.userId) && (
                  <Badge className="text-[10px] px-1.5 py-0 bg-teal-500/20 text-teal-400 border-teal-500/30">
                    Manager
                  </Badge>
                )}
                {/* Paid badge */}
                {member.onboardingStage === "evaluated" && member.premiumPaid && (
                  <Badge className="text-[10px] px-1.5 py-0 bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                    $1K Paid
                  </Badge>
                )}
                {member.onboardingStage === "evaluated" && member.standardPaid && !member.premiumPaid && (
                  <Badge className="text-[10px] px-1.5 py-0 bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                    $250 Paid
                  </Badge>
                )}
                {/* Show reporting manager for non-direct reports (admin view) */}
                {isAdmin && !member.isDirectReport && member.managerName && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    Under: {member.managerName}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <p className="text-xs text-muted-foreground">{member.email}</p>
                {member.lastContactedAt ? (
                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
                    <Clock className="h-2.5 w-2.5" />
                    {getTimeAgo(member.lastContactedAt)}
                  </span>
                ) : (
                  <span className="text-[10px] text-muted-foreground/50">No contact yet</span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Production Stats - Desktop */}
            <div className="hidden md:flex items-center gap-4 text-sm">
              <div className="text-center">
                <span className="font-semibold text-primary">${member.weekALP.toLocaleString()}</span>
                <p className="text-[10px] text-muted-foreground">Week ALP</p>
              </div>
              <div className="text-center">
                <span className="font-semibold text-emerald-500">${member.monthALP.toLocaleString()}</span>
                <p className="text-[10px] text-muted-foreground">Month ALP</p>
              </div>
              <div className="text-center">
                <span className="font-semibold">{member.monthDeals}</span>
                <p className="text-[10px] text-muted-foreground">Deals</p>
              </div>
            </div>
            <Badge className={cn(
              "text-[10px] capitalize",
              member.onboardingStage === "evaluated" && "bg-emerald-500/20 text-emerald-400",
              member.onboardingStage === "in_field_training" && "bg-violet-500/20 text-violet-400",
              member.onboardingStage === "training_online" && "bg-amber-500/20 text-amber-400",
              member.onboardingStage === "onboarding" && "bg-blue-500/20 text-blue-400"
            )}>
              {member.onboardingStage.replace(/_/g, ' ')}
            </Badge>
            <Badge className={cn("text-xs", getStatusColor(member.status))}>
              {member.status}
            </Badge>
            {expandedMember === member.id ? (
              <ChevronUp className="h-5 w-5 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
        </div>
      </div>

      {/* Expanded Content */}
      {expandedMember === member.id && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          className="border-t border-border bg-muted/30 p-4"
        >
          {/* Mobile Production Stats */}
          <div className="grid grid-cols-3 gap-4 mb-4 md:hidden">
            <div className="text-center">
              <p className="text-lg font-semibold text-primary">${member.weekALP.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Week ALP</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold text-emerald-500">${member.monthALP.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Month ALP</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold">{member.monthDeals}</p>
              <p className="text-xs text-muted-foreground">Deals</p>
            </div>
          </div>

          {/* CRM Stats */}
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div className="text-center">
              <p className="text-lg font-semibold">{member.totalLeads}</p>
              <p className="text-xs text-muted-foreground">Leads</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold">{member.closed}</p>
              <p className="text-xs text-muted-foreground">Closed</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold">{member.closeRate.toFixed(0)}%</p>
              <p className="text-xs text-muted-foreground">Rate</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 mb-4">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={(e) => { e.stopPropagation(); setEditAgent(member); }}
            >
              <Edit2 className="h-3 w-3" />
              Edit Agent
            </Button>
            <ManagerAssignMenu
              agentId={member.id}
              currentManagerId={member.invitedByManagerId}
              onAssigned={fetchTeamData}
            />
            {member.userId && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs"
                onClick={(e) => { e.stopPropagation(); handleSendPortalLogin(member); }}
              >
                <Send className="h-3 w-3" />
                Send Login
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={(e) => { e.stopPropagation(); handleToggleLicense(member); }}
            >
              {member.licenseStatus === "licensed" ? (
                <><ShieldOff className="h-3 w-3" /> Mark Unlicensed</>
              ) : (
                <><Shield className="h-3 w-3" /> Mark Licensed</>
              )}
            </Button>
            <AddToCourseButton
              agentId={member.id}
              agentName={member.name}
              onSuccess={fetchTeamData}
              size="sm"
            />
            {isAdmin && member.userId && (
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  "gap-1.5 text-xs",
                  managerUserIds.has(member.userId)
                    ? "text-amber-500 hover:bg-amber-500/10"
                    : "text-teal-500 hover:bg-teal-500/10"
                )}
                disabled={togglingManager === member.id}
                onClick={(e) => { e.stopPropagation(); handleToggleManager(member); }}
              >
                {togglingManager === member.id ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : managerUserIds.has(member.userId) ? (
                  <><ShieldOff className="h-3 w-3" /> Remove Manager</>
                ) : (
                  <><Shield className="h-3 w-3" /> Make Manager</>
                )}
              </Button>
            )}
            {member.isDeactivated || member.isInactive || member.status === "terminated" ? (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs text-emerald-500 hover:bg-emerald-500/10"
                onClick={(e) => { e.stopPropagation(); handleReactivate(member); }}
              >
                <RotateCcw className="h-3 w-3" />
                Reactivate
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs text-destructive hover:bg-destructive/10"
                onClick={(e) => { e.stopPropagation(); setDeactivateAgent({ id: member.id, name: member.name }); }}
              >
                <Users className="h-3 w-3" />
                Remove
              </Button>
            )}
          </div>
          
          <OnboardingTracker
            agentId={member.id}
            currentStage={member.onboardingStage as "onboarding" | "training_online" | "in_field_training" | "evaluated"}
            onStageUpdate={fetchTeamData}
          />
        </motion.div>
      )}
    </motion.div>
  );

  if (loading) {
    return (
      <GlassCard className="p-6">
        <div className="flex items-center justify-center h-40">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      </GlassCard>
    );
  }

  if (teamMembers.length === 0) {
    return (
      <GlassCard className="p-6">
        <div className="text-center py-8">
          <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">No Team Members Yet</h3>
          <p className="text-muted-foreground text-sm">
            Share your invite link to start building your team
          </p>
        </div>
      </GlassCard>
    );
  }

  return (
    <div className="space-y-6">
      {/* Team Stats Overview */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <GlassCard
          className={cn(
            "p-4 cursor-pointer transition-all",
            activeFilter === "all"
              ? "ring-2 ring-primary shadow-lg shadow-primary/10"
              : "hover:bg-muted/50"
          )}
          onClick={() => handleFilterClick("all")}
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Users className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{teamStats.totalMembers}</p>
              <p className="text-xs text-muted-foreground">Team Members</p>
            </div>
          </div>
        </GlassCard>
        <GlassCard
          className={cn(
            "p-4 cursor-pointer transition-all",
            activeFilter === "licensed"
              ? "ring-2 ring-emerald-500 shadow-lg shadow-emerald-500/10"
              : "hover:bg-muted/50"
          )}
          onClick={() => handleFilterClick("licensed")}
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/10">
              <Award className="h-5 w-5 text-emerald-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{teamStats.licensedCount}</p>
              <p className="text-xs text-muted-foreground">Licensed</p>
            </div>
          </div>
        </GlassCard>
        <GlassCard
          className={cn(
            "p-4 cursor-pointer transition-all",
            activeFilter === "unlicensed"
              ? "ring-2 ring-amber-500 shadow-lg shadow-amber-500/10"
              : "hover:bg-muted/50"
          )}
          onClick={() => handleFilterClick("unlicensed")}
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-500/10">
              <Clock className="h-5 w-5 text-amber-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{teamStats.unlicensedCount}</p>
              <p className="text-xs text-muted-foreground">Unlicensed</p>
            </div>
          </div>
        </GlassCard>
        <GlassCard
          className={cn(
            "p-4 cursor-pointer transition-all",
            activeFilter === "training"
              ? "ring-2 ring-violet-500 shadow-lg shadow-violet-500/10"
              : "hover:bg-muted/50"
          )}
          onClick={() => handleFilterClick("training")}
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-violet-500/10">
              <GraduationCap className="h-5 w-5 text-violet-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{teamStats.trainingCount}</p>
              <p className="text-xs text-muted-foreground">In Training</p>
            </div>
          </div>
        </GlassCard>
        <GlassCard className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <TrendingUp className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{teamStats.avgCloseRate.toFixed(1)}%</p>
              <p className="text-xs text-muted-foreground">Avg Close Rate</p>
            </div>
          </div>
        </GlassCard>
      </div>

      {/* Team Members List */}
      <GlassCard className="p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            {isAdmin ? "Agency Roster" : "Your Team"} ({searchFiltered.length})
          </h3>
          
          <div className="flex items-center gap-2">
            {/* Search Input */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search name or email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-9 w-[200px] rounded-md border border-input bg-background pl-8 pr-3 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
            </div>
            {/* Sort Dropdown */}
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortOption)}>
              <SelectTrigger className="w-[180px]">
                <ArrowUpDown className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Sort by..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="production-desc">Highest Production</SelectItem>
                <SelectItem value="production-asc">Lowest Production</SelectItem>
                <SelectItem value="name">Name A-Z</SelectItem>
                <SelectItem value="status">Status</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-4">
          {activeFilter !== "all" ? (
            /* Filtered flat list */
            <div className="space-y-3">
              {filteredMembers.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No agents match this filter
                </p>
              ) : (
                filteredMembers.map((member, index) => renderMemberCard(member, index))
              )}
            </div>
          ) : (
            /* Default grouped view */
            <>
              {/* Licensed Agents Section */}
              <Collapsible open={licensedOpen} onOpenChange={setLicensedOpen}>
                <CollapsibleTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full flex items-center justify-between p-3 min-h-[48px] bg-emerald-500/10 hover:bg-emerald-500/20 rounded-lg"
                  >
                    <div className="flex items-center gap-2">
                      <Award className="h-4 w-4 text-emerald-500" />
                      <span className="font-medium">Licensed Agents ({licensedMembers.length})</span>
                    </div>
                    <ChevronRight className={cn(
                      "h-4 w-4 transition-transform duration-200",
                      licensedOpen && "rotate-90"
                    )} />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-3 space-y-3">
                  {licensedMembers.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No licensed agents yet
                    </p>
                  ) : (
                    licensedMembers.map((member, index) => renderMemberCard(member, index))
                  )}
                </CollapsibleContent>
              </Collapsible>

              {/* Unlicensed Pipeline Section */}
              <Collapsible open={unlicensedOpen} onOpenChange={setUnlicensedOpen}>
                <CollapsibleTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full flex items-center justify-between p-3 min-h-[48px] bg-amber-500/10 hover:bg-amber-500/20 rounded-lg"
                  >
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-amber-500" />
                      <span className="font-medium">Unlicensed Pipeline ({unlicensedMembers.length})</span>
                    </div>
                    <ChevronRight className={cn(
                      "h-4 w-4 transition-transform duration-200",
                      unlicensedOpen && "rotate-90"
                    )} />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-3 space-y-3">
                  {unlicensedMembers.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No unlicensed agents in pipeline
                    </p>
                  ) : (
                    unlicensedMembers.map((member, index) => renderMemberCard(member, index))
                  )}
                </CollapsibleContent>
              </Collapsible>

              {/* Terminated / Inactive Section */}
              {terminatedMembers.length > 0 && (
                <Collapsible open={terminatedOpen} onOpenChange={setTerminatedOpen}>
                  <CollapsibleTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      className="w-full flex items-center justify-between p-3 min-h-[48px] bg-destructive/10 hover:bg-destructive/20 rounded-lg"
                    >
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-destructive" />
                        <span className="font-medium">Terminated / Inactive ({terminatedMembers.length})</span>
                      </div>
                      <ChevronRight className={cn(
                        "h-4 w-4 transition-transform duration-200",
                        terminatedOpen && "rotate-90"
                      )} />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-3 space-y-3">
                    {terminatedMembers.map((member, index) => renderMemberCard(member, index))}
                  </CollapsibleContent>
                </Collapsible>
              )}
            </>
          )}
        </div>
      </GlassCard>

      {/* Agent Edit Dialog */}
      {editAgent && (
        <AgentQuickEditDialog
          open={!!editAgent}
          onOpenChange={(open) => { if (!open) setEditAgent(null); }}
          agentId={editAgent.id}
          currentName={editAgent.name}
          production={editAgent.monthALP}
          deals={editAgent.monthDeals}
          onUpdate={fetchTeamData}
          period="month"
        />
      )}

      {/* Deactivate Agent Dialog */}
      {deactivateAgent && (
        <DeactivateAgentDialog
          open={!!deactivateAgent}
          onOpenChange={(open) => { if (!open) setDeactivateAgent(null); }}
          agentId={deactivateAgent.id}
          agentName={deactivateAgent.name}
          onComplete={fetchTeamData}
        />
      )}
    </div>
  );
}
