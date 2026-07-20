import { useState, useMemo, useCallback, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { 
  Users, 
  DollarSign, 
  TrendingUp, 
  AlertTriangle,
  Shield,
  Search,
  MoreVertical,
  Calendar,
  UserPlus,
  Pencil,
  UserX,
  ChevronDown,
  Mail,
  Copy,
  Crown,
  UserMinus,
  RotateCcw,
  ArrowRightLeft,
  GitBranch,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { AgentProfileEditor } from "@/components/admin/AgentProfileEditor";
import { QuickFilters } from "@/components/admin/QuickFilters";
import { RecognitionQueue } from "@/components/admin/RecognitionQueue";
import { DuplicateMergeTool } from "@/components/admin/DuplicateMergeTool";
import { PageLoadingSkeleton } from "@/components/ui/page-loading-skeleton";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ProductionAnalyticsCard } from "@/components/dashboard/ProductionAnalyticsCard";
import { CourseProgressPanel } from "@/components/admin/CourseProgressPanel";
import { StatCardPopup, type StatType } from "@/components/dashboard/StatCardPopup";
import { InviteTeamModal } from "@/components/dashboard/InviteTeamModal";
import { DeactivateAgentDialog } from "@/components/dashboard/DeactivateAgentDialog";
import { TeamHierarchyManager } from "@/components/dashboard/TeamHierarchyManager";
import { AdminManagerInvites } from "@/components/dashboard/AdminManagerInvites";
import { BulkLeadAssignment } from "@/components/dashboard/BulkLeadAssignment";
import { ManagerInviteLinks } from "@/components/dashboard/ManagerInviteLinks";
import { LeadReassignment } from "@/components/dashboard/LeadReassignment";
import { LeadImporter } from "@/components/dashboard/LeadImporter";
import { LeadExporter } from "@/components/dashboard/LeadExporter";
import { TerminatedAgentLeadsPanel } from "@/components/dashboard/TerminatedAgentLeadsPanel";
import { AddAgentModal } from "@/components/dashboard/AddAgentModal";
import { AbandonedLeadsPanel } from "@/components/dashboard/AbandonedLeadsPanel";
import { AllLeadsPanel } from "@/components/dashboard/AllLeadsPanel";
import { HideableCard } from "@/components/dashboard/HideableCard";
import { HiddenCardsManager } from "@/components/dashboard/HiddenCardsManager";
import { TeamCommissionsCard } from "@/components/finances/TeamCommissionsCard";
import { LiveCommissionsLeaderboard } from "@/components/finances/LiveCommissionsLeaderboard";

import { AISummaryReport } from "@/components/admin/AISummaryReport";
import { DateRangePicker, type DateRange } from "@/components/ui/date-range-picker";
import { useProductionRealtime } from "@/hooks/useProductionRealtime";
import { useInFlightGuard } from "@/hooks/useInFlightGuard";
import { getClosingRateColor } from "@/lib/closingRateColors";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { getTodayPST, getWeekStartPST, getMonthStartPST } from "@/lib/dateUtils";
import { toast } from "sonner";
import { useSoundEffects } from "@/hooks/useSoundEffects";
import { ControlTerminal } from "@/components/dashboard/ControlTerminal";
import { UnclaimedLeadsCard } from "@/components/dashboard/UnclaimedLeadsCard";
import { Target20kPaceWidget } from "@/components/dashboard/Target20kPaceWidget";
import { TeamHierarchyWidget } from "@/components/dashboard/TeamHierarchyWidget";
import { InsuraCloudHealthAlert } from "@/components/dashboard/InsuraCloudHealthAlert";
import { XcelLastSyncedBadge } from "@/components/dashboard/XcelLastSyncedBadge";
import { NextStepStuckPool } from "@/components/next-step/NextStepStuckPool";
import { NextStepFunnelStrip } from "@/components/next-step/NextStepFunnelStrip";
import { LIVE_AGENT_DEAL_WINDOW_DAYS, getLiveAgentCutoffIso } from "@/lib/metricTruth";
import { DEAL_TRUTH_STATUS_FILTER, liveDealWindowOr } from "@/lib/dealTruth";
import { motion } from "framer-motion";

type TimePeriod = "day" | "week" | "month" | "custom";
type FilterType = "all" | "producers" | "weak" | "zero" | "inactive";

const ONBOARDING_STAGES = [
  { value: "onboarding", label: "Onboarding" },
  { value: "training_online", label: "Training Online" },
  { value: "in_field_training", label: "In Field Training" },
  { value: "evaluated", label: "Evaluated" },
] as const;

// Catalog of hideable cards on this page (key → friendly label for the restore menu)
const HIDEABLE_CARDS: Record<string, string> = {
  "admin.stat.totalAlp": "Stat: Total ALP",
  "admin.stat.activeAgents": "Stat: Live Agents",
  "admin.stat.producers": "Stat: Producers",
  "admin.stat.needsAttention": "Stat: Needs Attention",
  "admin.stat.totalDeals": "Stat: Total Deals",
  "admin.ai-summary": "AI Summary Report",
  "admin.recognition-queue": "Recognition Queue",
  "admin.course-progress": "Course Progress",
  "admin.team-hierarchy": "Team Hierarchy Manager",
  "admin.manager-invites": "Manager Invites",
  "admin.bulk-lead-assignment": "Bulk Lead Assignment",
  "admin.team-commissions": "Team Commissions (InsuraCloud Live)",
};

const surfaceMotion = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.28, ease: "easeOut" },
};

interface AgentWithStats {
  id: string;
  profileId: string | null;
  userId: string | null;
  fullName: string;
  email: string | null;
  phone: string | null;
  status: string;
  isDeactivated: boolean;
  isInactive: boolean;
  isManager: boolean;
  totalAlp: number;
  totalDeals: number;
  closingRate: number;
  hasCrmLink: boolean;
  lastActivity: string | null;
  standardPaid: boolean;
  premiumPaid: boolean;
  isLiveAgent?: boolean;
}

export default function DashboardCommandCenter() {
  const { isAdmin } = useAuth();
  const { playSound } = useSoundEffects();
  const [timePeriod, setTimePeriod] = useState<TimePeriod>("week");
  const [customDateRange, setCustomDateRange] = useState<DateRange>({ from: undefined, to: undefined });
  const [activeFilter, setActiveFilter] = useState<FilterType>("producers");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedAgent, setSelectedAgent] = useState<AgentWithStats | null>(null);
  const [showDuplicateTool, setShowDuplicateTool] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [deactivateAgent, setDeactivateAgent] = useState<AgentWithStats | null>(null);
  
  // Collapsible sections state
  const [showInviteLinks, setShowInviteLinks] = useState(false);
  const [showMoreStats, setShowMoreStats] = useState(false);
  const [showTerminated, setShowTerminated] = useState(false);
  const [showAbandoned, setShowAbandoned] = useState(false);
  const [showAllLeads, setShowAllLeads] = useState(false);
  
  // Stat card popup state
  const [statPopup, setStatPopup] = useState<{ type: StatType; open: boolean }>({ type: "totalAlp", open: false });

  // Fetch managers list for reassignment sub-menu
  const { data: managersList } = useQuery({
    queryKey: ["command-center-managers"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("get-active-managers");
      if (error) return [];
      return (data?.managers as { id: string; name: string }[]) || [];
    },
    staleTime: 300000,
  });


  // Get date range based on time period - using PST utilities for consistency
  const dateRange = useMemo(() => {
    const today = getTodayPST();
    switch (timePeriod) {
      case "day":
        return { start: today, end: today };
      case "week":
        return { start: getWeekStartPST(), end: today };
      case "month":
        return { start: getMonthStartPST(), end: today };
      case "custom":
        if (customDateRange.from && customDateRange.to) {
          return { start: format(customDateRange.from, "yyyy-MM-dd"), end: format(customDateRange.to, "yyyy-MM-dd") };
        }
        return { start: getMonthStartPST(), end: today };
      default:
        return { start: getWeekStartPST(), end: today };
    }
  }, [timePeriod, customDateRange]);

  // Fetch all agents with production stats using server-side aggregation
  const { data: agentsData, isLoading, refetch } = useQuery({
    queryKey: ["command-center-agents", dateRange],
    staleTime: 120_000,
    refetchInterval: 120_000,
    gcTime: 600_000,
    queryFn: async () => {
      // Compute week start outside the parallel block so it's stable
      const today = new Date();
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - today.getDay());
      const weekStartStr = weekStart.toISOString().split("T")[0];

      // Fire agents + production + manager roles + payments in parallel (independent queries)
      const [agentsRes, productionRes, managerRolesRes, paymentsRes] = await Promise.all([
        supabase
          .from("agents")
          .select(`
            id,
            profile_id,
            user_id,
            status,
            is_deactivated,
            is_inactive,
            profiles!agents_profile_id_fkey (
              id,
              full_name,
              email,
              phone
            )
          `)
          .order("created_at", { ascending: false })
          .limit(900),
        supabase.rpc("get_agent_production_stats", {
          start_date: dateRange.start,
          end_date: dateRange.end,
        }),
        supabase.from("user_roles").select("user_id").eq("role", "manager"),
        supabase.from("lead_payment_tracking")
          .select("agent_id, tier, paid")
          .eq("week_start", weekStartStr)
          .eq("paid", true),
      ]);

      const { data: agents, error: agentsError } = agentsRes;
      const { data: production, error: prodError } = productionRes;
      const { data: managerRoles } = managerRolesRes;
      const { data: payments } = paymentsRes;

      if (agentsError) throw agentsError;
      if (prodError) throw prodError;

      // Conditional second round-trip: only for agents missing a profile_id join
      const agentsMissingProfile = (agents || []).filter(a => !a.profiles && a.user_id);
      const fallbackProfileMap = new Map<string, { full_name: string | null; email: string; phone: string | null }>();

      if (agentsMissingProfile.length > 0) {
        const userIds = agentsMissingProfile.map(a => a.user_id!);
        const { data: fallbackProfiles } = await supabase
          .from("profiles")
          .select("user_id, full_name, email, phone")
          .in("user_id", userIds);

        fallbackProfiles?.forEach(p => {
          if (p.user_id) fallbackProfileMap.set(p.user_id, p);
        });
      }

      const managerUserIds = new Set(managerRoles?.map(r => r.user_id) || []);

      const paymentMap = new Map<string, { standard: boolean; premium: boolean }>();
      payments?.forEach((p: any) => {
        const existing = paymentMap.get(p.agent_id) || { standard: false, premium: false };
        if (p.tier === "standard") existing.standard = true;
        if (p.tier === "premium") existing.premium = true;
        paymentMap.set(p.agent_id, existing);
      });

      // Build production map from pre-aggregated data (cheap operation)
      const productionMap = new Map<string, { alp: number; deals: number; presentations: number; lastDate: string }>();
      production?.forEach((p) => {
        productionMap.set(p.agent_id, {
          alp: Number(p.total_alp || 0),
          deals: Number(p.total_deals || 0),
          presentations: Number(p.total_presentations || 0),
          lastDate: p.last_activity_date || "",
        });
      });

      // Map to AgentWithStats, filtering out invalid entries
      const agentStats: AgentWithStats[] = (agents || [])
        .filter((a) => {
          const profile = a.profiles || (a.user_id ? fallbackProfileMap.get(a.user_id) : null);
          const name = profile?.full_name || "";
          return (
            name &&
            name.trim().length > 0 &&
            !name.toLowerCase().includes("unknown") &&
            !/^\d+$/.test(name.trim())
          );
        })
        .map((a) => {
          const profile = a.profiles || (a.user_id ? fallbackProfileMap.get(a.user_id) : null);
          const prod = productionMap.get(a.id);
          const closingRate = prod && prod.presentations > 0 
            ? Math.round((prod.deals / prod.presentations) * 100) 
            : 0;
          const pay = paymentMap.get(a.id) || { standard: false, premium: false };
          
          return {
            id: a.id,
            profileId: a.profile_id,
            userId: a.user_id,
            fullName: profile?.full_name || "—",
            email: profile?.email || null,
            phone: profile?.phone || null,
            status: a.status,
            isDeactivated: a.is_deactivated || false,
            isInactive: a.is_inactive || false,
            isManager: a.user_id ? managerUserIds.has(a.user_id) : false,
            totalAlp: prod?.alp || 0,
            totalDeals: prod?.deals || 0,
            closingRate,
            hasCrmLink: !!a.profile_id,
            lastActivity: prod?.lastDate || null,
            standardPaid: pay.standard,
            premiumPaid: pay.premium,
          };
        });

      return agentStats;
    },
  });

  // In-flight guard to prevent multiple simultaneous refetches
  const guardedRefetch = useInFlightGuard(refetch);

  // Stable callback so useProductionRealtime's useEffect doesn't re-run on every render
  const handleRealtimeUpdate = useCallback(() => guardedRefetch(), [guardedRefetch]);
  useProductionRealtime(handleRealtimeUpdate, 1000);

  // Handlers for inline reassign/stage change
  const handleReassignManager = useCallback(async (agentId: string, managerId: string | null, managerName: string) => {
    try {
      const { error } = await supabase
        .from("agents")
        .update({ invited_by_manager_id: managerId })
        .eq("id", agentId);
      if (error) throw error;
      toast.success(`Reassigned to ${managerName}`);
      playSound("success");
      refetch();
    } catch (err: any) {
      toast.error(err.message || "Failed to reassign manager");
      playSound("error");
    }
  }, [refetch, playSound]);

  const handleChangeStage = useCallback(async (agentId: string, stage: string, label: string) => {
    try {
      const { error } = await supabase
        .from("agents")
        .update({ onboarding_stage: stage as any })
        .eq("id", agentId);
      if (error) throw error;
      toast.success(`Stage changed to ${label}`);
      playSound("success");
      refetch();
    } catch (err: any) {
      toast.error(err.message || "Failed to change stage");
      playSound("error");
    }
  }, [refetch, playSound]);

  const handleEmailLoginLink = useCallback(async (agent: AgentWithStats) => {
    if (!agent.email) {
      toast.error("This agent has no email address");
      return;
    }
    try {
      const { error } = await supabase.functions.invoke("send-agent-portal-login", {
        body: { agentId: agent.id },
      });
      if (error) throw error;
      toast.success(`Login link sent to ${agent.email}`);
    } catch (error: any) {
      console.error("Error sending login link:", error);
      toast.error("Failed to send login link");
    }
  }, []);

  const handleCopyLoginLink = useCallback(async (agent: AgentWithStats) => {
    if (!agent.email) {
      toast.error("This agent has no email address");
      return;
    }
    try {
      const { data, error } = await supabase.functions.invoke("generate-magic-link", {
        body: { 
          agentId: agent.id, 
          email: agent.email,
          destination: "portal" 
        },
      });
      if (error) throw error;
      if (!data?.magicLink) throw new Error("No link generated");
      
      await navigator.clipboard.writeText(data.magicLink);
      toast.success("Login link copied to clipboard!");
    } catch (error: any) {
      console.error("Error generating login link:", error);
      toast.error("Failed to generate login link");
    }
  }, []);

  // Promote agent to manager
  const handlePromoteToManager = useCallback(async (agent: AgentWithStats) => {
    if (!agent.userId) {
      toast.error("This agent has no user account linked");
      return;
    }
    
    try {
      const { error } = await supabase
        .from("user_roles")
        .insert({ user_id: agent.userId, role: "manager" });
      
      if (error) {
        if (error.code === "23505") {
          toast.info("This agent is already a manager");
        } else {
          throw error;
        }
        return;
      }
      
      toast.success(`${agent.fullName} is now a Manager!`);
      refetch();
    } catch (error: any) {
      console.error("Error promoting to manager:", error);
      toast.error("Failed to promote agent to manager");
    }
  }, [refetch]);

  // Demote agent from manager
  const handleDemoteFromManager = useCallback(async (agent: AgentWithStats) => {
    if (!agent.userId) {
      toast.error("This agent has no user account linked");
      return;
    }
    
    try {
      const { error } = await supabase
        .from("user_roles")
        .delete()
        .eq("user_id", agent.userId)
        .eq("role", "manager");
      
      if (error) throw error;
      
      toast.success(`${agent.fullName} is no longer a Manager`);
      refetch();
    } catch (error: any) {
      console.error("Error demoting from manager:", error);
      toast.error("Failed to remove manager role");
    }
  }, [refetch]);

  const filteredAgents = useMemo(() => {
    if (!agentsData) return [];
    
    let filtered = [...agentsData];
    
    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (a) =>
          a.fullName.toLowerCase().includes(query) ||
          a.email?.toLowerCase().includes(query)
      );
    }

    // Status filters
    switch (activeFilter) {
      case "producers":
        filtered = filtered.filter((a) => a.totalAlp > 0 && !a.isDeactivated && !a.isInactive);
        break;
      case "weak":
        // "Needs Attention" = LIVE agents under $5,000 for the week
        // From Thursday onward, highlight zero production strongly
        const dayOfWeek = new Date().getDay(); // 0=Sun, 4=Thu
        const isThursdayOrLater = dayOfWeek >= 4 || dayOfWeek === 0; // Thu, Fri, Sat, Sun
        filtered = filtered.filter(
          (a) => 
            !a.isDeactivated && 
            !a.isInactive && 
            a.totalAlp < 5000 &&
            (isThursdayOrLater ? true : a.totalAlp === 0 || a.closingRate < 15)
        );
        break;
      case "zero":
        filtered = filtered.filter((a) => a.totalAlp === 0 && !a.isDeactivated && !a.isInactive);
        break;
      case "inactive":
        filtered = filtered.filter((a) => a.isInactive || a.isDeactivated);
        break;
      case "all":
      default:
        // Show all except inactive with zero production
        filtered = filtered.filter((a) => !(a.isDeactivated && a.totalAlp === 0));
        break;
    }

    // Sort by ALP descending
    return filtered.sort((a, b) => b.totalAlp - a.totalAlp);
  }, [agentsData, searchQuery, activeFilter]);

  // Live-agent rule:
  //   counts as live only when the agent has a submitted/active deal posted in
  //   the last 10 days. Agent-row status and onboarding stage do not count.
  // Returns string[] so TanStack Query can serialize the cache correctly (Set is not JSON-serializable)
  const { data: activeProducerIds } = useQuery({
    queryKey: ["live-agent-set-v2", LIVE_AGENT_DEAL_WINDOW_DAYS],
    staleTime: 120_000,
    refetchInterval: 120_000,
    queryFn: async () => {
      const dealsRes = await supabase.from("deals")
        .select("agent_id")
        .or(liveDealWindowOr(getLiveAgentCutoffIso()))
        .in("status", DEAL_TRUTH_STATUS_FILTER)
        .limit(2500);

      const ids = new Set<string>();
      for (const r of (dealsRes.data || []) as any[]) {
        if (r.agent_id) ids.add(r.agent_id);
      }
      return Array.from(ids);
    },
  });

  const activeProducerSet = useMemo(() => new Set(activeProducerIds ?? []), [activeProducerIds]);

  const summaryStats = useMemo(() => {
    if (!agentsData) return { totalAlp: 0, activeAgents: 0, producers: 0, weakPerformers: 0, totalDeals: 0 };

    const activeAgents = agentsData.filter((a) => !a.isDeactivated && !a.isInactive && activeProducerSet.has(a.id));
    const producers = activeAgents;

    const dayOfWeek = new Date().getDay();
    const isThursdayOrLater = dayOfWeek >= 4 || dayOfWeek === 0;
    const weak = agentsData.filter((a) =>
      !a.isDeactivated &&
      !a.isInactive &&
      a.totalAlp < 5000 &&
      (isThursdayOrLater ? true : a.totalAlp === 0)
    );

    return {
      totalAlp: agentsData.reduce((sum, a) => sum + a.totalAlp, 0),
      activeAgents: activeAgents.length,
      producers: producers.length,
      weakPerformers: weak.length,
      totalDeals: agentsData.reduce((sum, a) => sum + a.totalDeals, 0),
    };
  }, [agentsData, activeProducerSet]);

  const agentsForPopup = useMemo(
    () => (agentsData || []).map((agent) => ({
      ...agent,
      isLiveAgent: activeProducerSet?.has(agent.id) ?? false,
    })),
    [agentsData, activeProducerSet],
  );

  if (!isAdmin) {
    return (
      <>
        <div className="flex items-center justify-center h-[60vh]">
          <Card className="p-8 text-center">
            <Shield className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h2 className="text-xl font-semibold mb-2">Admin Access Required</h2>
            <p className="text-muted-foreground">This command center is only accessible to administrators.</p>
          </Card>
        </div>
      </>
    );
  }

  if (isLoading && !agentsData) {
    return <PageLoadingSkeleton variant="dashboard" />;
  }

  return (
    <>
      <div className="space-y-6 page-enter p-4 md:p-6">
        <motion.div
          {...surfaceMotion}
          className="relative overflow-hidden rounded-lg border border-slate-900/10 bg-white dark:bg-slate-950 px-4 py-4 text-white shadow-xl shadow-slate-950/10 dark:border-white/10 md:px-5"
        >
          <div className="absolute inset-x-0 top-0 h-1 bg-white dark:bg-slate-900" />
          <PageHeader
            accent="primary"
            eyebrow="Admin · Command"
            eyebrowIcon={<Crown className="h-3 w-3" />}
            title="Command Center"
            subtitle="Full agency control. Every metric live, every agent within reach, zero spreadsheets."
            actions={
              <>
                <HiddenCardsManager catalog={HIDEABLE_CARDS} />
                <LeadImporter />
                <LeadExporter />
                <AddAgentModal onAgentAdded={() => refetch()} />
                <Button
                  variant="default"
                  onClick={() => setShowInviteModal(true)}
                  className="gap-2 bg-white text-slate-950 hover:bg-white/90"
                >
                  <UserPlus className="h-4 w-4" />
                  Invite Team
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setShowDuplicateTool(true)}
                  className="gap-2 border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
                >
                  <Users className="h-4 w-4" />
                  Find Duplicates
                </Button>
                <XcelLastSyncedBadge />
              </>
            }
          />
        </motion.div>

        <ControlTerminal />

        {/* InsuraCloud sync auth — only renders when 🔴 broken. Self-hiding. */}
        <InsuraCloudHealthAlert />

        {/* Unclaimed applicants — money on the floor, first thing Sam sees */}
        <UnclaimedLeadsCard />

        {/* $20K-per-agent pace board. Replaces "type-in-a-date" production widget. */}
        <Target20kPaceWidget />

        {/* Team hierarchy: who recruited who + their downline production rollup */}
        <TeamHierarchyWidget />

        {/* Next Step Engine — 18-stage pipeline funnel + stuck-pool prioritizer */}
        <NextStepFunnelStrip />
        <NextStepStuckPool />

        {/* Team Commissions (InsuraCloud Live) - sits ABOVE the stat grid */}
        <HideableCard cardKey="admin.team-commissions" label="Team Commissions (Live)">
          <TeamCommissionsCard />
        </HideableCard>

        {/* Summary Stats - Clickable */}
        <motion.div
          {...surfaceMotion}
          transition={{ duration: 0.28, delay: 0.04, ease: "easeOut" }}
          className="grid grid-cols-1 sm:grid-cols-3 gap-4 card-hover-lift"
        >
          <HideableCard cardKey="admin.stat.totalAlp" label="Production (Week / MTD / YTD, Phoenix TZ)">
            <ProductionAnalyticsCard />
          </HideableCard>

          <HideableCard cardKey="admin.stat.activeAgents" label="Live Agents">
            <Card
              className="stat-card group cursor-pointer overflow-hidden border-border/70 bg-card/95 shadow-sm transition-all .5 hover:border-foreground/20 hover:shadow-md"
              onClick={() => setStatPopup({ type: "activeAgents", open: true })}
            >
              <CardContent className="p-4">
                <div className="mb-3 h-1 w-14 rounded-full bg-slate-500/80 transition-all group-hover:w-20" />
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-md bg-slate-500/10 ring-1 ring-cyan-500/15">
                    <Users className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Live Agents</p>
                    <p className="text-2xl font-bold">{summaryStats.activeAgents}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </HideableCard>

          <HideableCard cardKey="admin.stat.needsAttention" label="Needs Attention">
            <Card
              className="stat-card group cursor-pointer overflow-hidden border-destructive/30 bg-card/95 shadow-sm transition-all .5 hover:border-destructive/60 hover:shadow-md"
              onClick={() => setStatPopup({ type: "needsAttention", open: true })}
            >
              <CardContent className="p-4">
                <div className="mb-3 h-1 w-14 rounded-full bg-destructive/80 transition-all group-hover:w-20" />
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-md bg-destructive/10 ring-1 ring-destructive/15">
                    <AlertTriangle className="h-5 w-5 text-destructive" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Needs Attention</p>
                    <p className="text-2xl font-bold text-destructive">{summaryStats.weakPerformers}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </HideableCard>
        </motion.div>

        {/* MP238-simplify: Producers + Total Deals moved to collapsible detail; primary strip stays 3 cards */}
        <Collapsible open={showMoreStats} onOpenChange={setShowMoreStats}>
          <CollapsibleTrigger asChild>
            <button className="text-xs text-muted-foreground hover:text-foreground transition-colors underline-offset-4 hover:underline">
              {showMoreStats ? "Hide" : "Show"} more stats (Producers · Total Deals)
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <HideableCard cardKey="admin.stat.producers" label="Producers">
                <Card
                  className="stat-card group cursor-pointer overflow-hidden border-border/70 bg-card/95 shadow-sm transition-all .5 hover:border-foreground/20 hover:shadow-md"
                  onClick={() => setStatPopup({ type: "producers", open: true })}
                >
                  <CardContent className="p-4">
                    <div className="mb-3 h-1 w-14 rounded-full bg-emerald-500/80 transition-all group-hover:w-20" />
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-md bg-emerald-500/10 ring-1 ring-emerald-500/15">
                        <TrendingUp className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Producers</p>
                        <p className="text-2xl font-bold">{summaryStats.producers}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </HideableCard>
              <HideableCard cardKey="admin.stat.totalDeals" label="Total Deals">
                <Card
                  className="stat-card group cursor-pointer overflow-hidden border-border/70 bg-card/95 shadow-sm transition-all .5 hover:border-foreground/20 hover:shadow-md"
                  onClick={() => setStatPopup({ type: "totalDeals", open: true })}
                >
                  <CardContent className="p-4">
                    <div className="mb-3 h-1 w-14 rounded-full bg-amber-500/80 transition-all group-hover:w-20" />
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-md bg-amber-500/10 ring-1 ring-amber-500/15">
                        <TrendingUp className="h-5 w-5 text-emerald-500" />
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Total Deals</p>
                        <p className="text-2xl font-bold">{summaryStats.totalDeals}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </HideableCard>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Time Period Toggle + Custom Date Range */}
        <motion.div
          {...surfaceMotion}
          transition={{ duration: 0.28, delay: 0.08, ease: "easeOut" }}
          className="flex flex-col gap-4 rounded-lg border border-border/70 bg-card/95 p-3 shadow-sm lg:flex-row lg:items-center"
        >
          <Tabs value={timePeriod} onValueChange={(v) => setTimePeriod(v as TimePeriod)} className="w-full lg:w-auto">
            <TabsList className="grid grid-cols-4 w-full rounded-md bg-muted/70 lg:w-auto">
              <TabsTrigger value="day" className="px-3 text-sm">Today</TabsTrigger>
              <TabsTrigger value="week" className="px-3 text-sm">This Week</TabsTrigger>
              <TabsTrigger value="month" className="px-3 text-sm">MTD</TabsTrigger>
              <TabsTrigger value="custom" className="px-3 text-sm gap-1">
                <Calendar className="h-3 w-3" />
                Custom
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Custom Date Range Picker - shown when Custom is selected */}
          {timePeriod === "custom" && (
            <DateRangePicker
              value={customDateRange}
              onChange={setCustomDateRange}
              simpleMode
              className="w-full lg:w-auto"
            />
          )}

          <div className="flex-1 max-w-md">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search agents..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 bg-background/80"
              />
            </div>
          </div>
        </motion.div>

        {/* Quick Filters */}
        <QuickFilters activeFilter={activeFilter} onFilterChange={setActiveFilter} />

        {/* Main Content Grid — MP238-simplify: stacked full-width; widgets get ErrorBoundary + Suspense */}
        <motion.div
          {...surfaceMotion}
          transition={{ duration: 0.28, delay: 0.12, ease: "easeOut" }}
          className="flex flex-col gap-6"
        >
          {/* Leaderboard - full width */}
          <div className="w-full">
            <Card className="flex flex-col h-full overflow-hidden border-border/70 bg-card/95 shadow-sm">
              <Tabs defaultValue="live" className="w-full flex flex-col h-full">
                <CardHeader className="shrink-0 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-white pb-4">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-3">
                      <CardTitle className="text-lg font-semibold">Leaderboard</CardTitle>
                      <TabsList className="bg-white/10">
                        <TabsTrigger value="live" className="text-xs text-white/75 data-[state=active]:bg-white data-[state=active]:text-slate-950">Commissions (Live)</TabsTrigger>
                        <TabsTrigger value="logged" className="text-xs text-white/75 data-[state=active]:bg-white data-[state=active]:text-slate-950">Logged ALP</TabsTrigger>
                      </TabsList>
                    </div>
                    <Badge variant="outline" className="border-white/20 bg-white/10 text-xs text-white">
                      {filteredAgents.length} agents
                    </Badge>
                  </div>
                </CardHeader>
                <TabsContent value="live" className="flex-1 min-h-0 px-6 pb-6 mt-0">
                  <LiveCommissionsLeaderboard />
                </TabsContent>
                <TabsContent value="logged" className="flex-1 min-h-0 mt-0">
                  <CardContent className="flex-1 min-h-0 p-0">
                {isLoading ? (
                  <div className="space-y-3 px-6 pb-6">
                    {[...Array(5)].map((_, i) => (
                      // stable-key-allow:skeleton
                      <div key={i} className="h-14 bg-muted animate-pulse rounded-lg" />
                    ))}
                  </div>
                ) : filteredAgents.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground px-6">
                    <Users className="h-10 w-10 mx-auto mb-3 opacity-50" />
                    <p>No agents match your filters</p>
                  </div>
                ) : (
                  <div className="space-y-2 overflow-y-auto scrollbar-custom px-6 pb-6 max-h-none lg:max-h-[70vh]">
                    {filteredAgents.map((agent, index) => (
                      <motion.div
                        key={agent.id}
                        whileHover={{ y: -2 }}
                        transition={{ duration: 0.16 }}
                        onClick={() => setSelectedAgent(agent)}
                        className={cn(
                          "flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 p-4 rounded-lg cursor-pointer transition-all min-h-[56px]",
                          "border border-border/70 bg-background/85 shadow-sm hover:bg-muted/45 hover:border-foreground/20 hover:shadow-md",
                          index === 0 && "bg-primary/5 border-primary/20",
                          index === 1 && "bg-muted/30",
                          index === 2 && "bg-muted/20",
                          agent.closingRate < 15 && agent.totalAlp > 0 && "border-l-2 border-l-amber-500",
                          (agent.isDeactivated || agent.isInactive) && "opacity-60"
                        )}
                      >
                        {/* Top row: Rank + Name + Badges */}
                        <div className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0">
                          {/* Rank */}
                          <div className={cn(
                            "w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0",
                            index === 0 && "bg-amber-500 text-black",
                            index === 1 && "bg-gray-300 text-black",
                            index === 2 && "bg-amber-700 text-white",
                            index > 2 && "bg-muted text-muted-foreground"
                          )}>
                            {index + 1}
                          </div>

                          {/* Agent Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium truncate">{agent.fullName}</span>
                              {agent.isManager && (
                                <Badge variant="outline" className="text-xs bg-teal-500/10 text-teal-600 border-teal-500/30 shrink-0">
                                  Manager
                                </Badge>
                              )}
                              {!agent.hasCrmLink && (
                                <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-600 border-amber-500/30 shrink-0">
                                  No CRM
                                </Badge>
                              )}
                              {agent.isDeactivated && (
                                <Badge variant="destructive" className="text-xs shrink-0">Terminated</Badge>
                              )}
                              {agent.isInactive && !agent.isDeactivated && (
                                <Badge variant="secondary" className="text-xs shrink-0">Inactive</Badge>
                              )}
                              {agent.premiumPaid && (
                                <Badge className="text-xs shrink-0 bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                                  $1K Paid
                                </Badge>
                              )}
                              {agent.standardPaid && !agent.premiumPaid && (
                                <Badge className="text-xs shrink-0 bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                                  $250 Paid
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground truncate">
                              {agent.email || "No email"}
                            </p>
                          </div>
                        </div>

                        {/* Stats row - stacks on mobile */}
                        <div className="flex items-center justify-between sm:justify-end gap-4 pl-11 sm:pl-0">
                          <div className="flex items-center gap-4">
                            <div className="text-left sm:text-right">
                              <p className="font-bold text-lg">${Math.round(agent.totalAlp).toLocaleString()}</p>
                              <p className="text-xs text-muted-foreground">{agent.totalDeals} deals</p>
                            </div>
                            <div className={cn(
                              "text-sm font-medium",
                              getClosingRateColor(agent.closingRate).textClass
                            )}>
                              {agent.closingRate}%
                            </div>
                          </div>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-10 w-10 sm:h-8 sm:w-8 shrink-0"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="bg-popover">
                              <DropdownMenuItem onClick={(e) => { 
                                e.stopPropagation(); 
                                setSelectedAgent(agent); 
                              }}>
                                <Pencil className="h-4 w-4 mr-2" />
                                Edit Profile
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              {/* Reassign Manager Sub-menu */}
                              <DropdownMenuSub>
                                <DropdownMenuSubTrigger onClick={(e) => e.stopPropagation()}>
                                  <ArrowRightLeft className="h-4 w-4 mr-2" />
                                  Reassign Manager
                                </DropdownMenuSubTrigger>
                                <DropdownMenuSubContent className="bg-popover border-border">
                                  <DropdownMenuItem onClick={(e) => {
                                    e.stopPropagation();
                                    handleReassignManager(agent.id, null, "Unassigned");
                                  }}>
                                    Unassigned
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  {(managersList || []).map((m) => (
                                    <DropdownMenuItem
                                      key={m.id}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleReassignManager(agent.id, m.id, m.name);
                                      }}
                                    >
                                      {m.name}
                                    </DropdownMenuItem>
                                  ))}
                                </DropdownMenuSubContent>
                              </DropdownMenuSub>
                              {/* Change Stage Sub-menu */}
                              <DropdownMenuSub>
                                <DropdownMenuSubTrigger onClick={(e) => e.stopPropagation()}>
                                  <GitBranch className="h-4 w-4 mr-2" />
                                  Change Stage
                                </DropdownMenuSubTrigger>
                                <DropdownMenuSubContent className="bg-popover border-border">
                                  {ONBOARDING_STAGES.map((s) => (
                                    <DropdownMenuItem
                                      key={s.value}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleChangeStage(agent.id, s.value, s.label);
                                      }}
                                    >
                                      {s.label}
                                    </DropdownMenuItem>
                                  ))}
                                </DropdownMenuSubContent>
                              </DropdownMenuSub>
                              <DropdownMenuSeparator />
                              {agent.userId && (
                                agent.isManager ? (
                                  <DropdownMenuItem onClick={(e) => { 
                                    e.stopPropagation(); 
                                    handleDemoteFromManager(agent); 
                                  }}>
                                    <UserMinus className="h-4 w-4 mr-2" />
                                    Remove Manager Role
                                  </DropdownMenuItem>
                                ) : (
                                  <DropdownMenuItem onClick={(e) => { 
                                    e.stopPropagation(); 
                                    handlePromoteToManager(agent); 
                                  }}>
                                    <Crown className="h-4 w-4 mr-2" />
                                    Promote to Manager
                                  </DropdownMenuItem>
                                )
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={(e) => { 
                                e.stopPropagation(); 
                                handleEmailLoginLink(agent); 
                              }}>
                                <Mail className="h-4 w-4 mr-2" />
                                Email Login Link
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={(e) => { 
                                e.stopPropagation(); 
                                handleCopyLoginLink(agent); 
                              }}>
                                <Copy className="h-4 w-4 mr-2" />
                                Copy Login Link
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              {(agent.isDeactivated || agent.isInactive || agent.status === "terminated") ? (
                                <DropdownMenuItem 
                                  className="text-emerald-500 focus:text-emerald-500"
                                  onClick={async (e) => { 
                                    e.stopPropagation();
                                    try {
                                      const { error } = await supabase
                                        .from("agents")
                                        .update({ 
                                          status: "active" as any,
                                          is_deactivated: false, 
                                          is_inactive: false, 
                                          deactivation_reason: null,
                                          verified_at: new Date().toISOString()
                                        })
                                        .eq("id", agent.id);
                                      if (error) throw error;
                                      toast.success(`${agent.fullName} has been reactivated`);
                                      refetch();
                                    } catch (err: any) {
                                      toast.error(err.message || "Failed to reactivate agent");
                                    }
                                  }}
                                >
                                  <RotateCcw className="h-4 w-4 mr-2" />
                                  Reactivate Agent
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem 
                                  className="text-destructive focus:text-destructive"
                                  onClick={(e) => { 
                                    e.stopPropagation(); 
                                    setDeactivateAgent(agent); 
                                  }}
                                >
                                  <UserX className="h-4 w-4 mr-2" />
                                  Remove from Pipeline
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )}
              </CardContent>
                </TabsContent>
              </Tabs>
            </Card>
          </div>

          {/* MP238-simplify: right-column widgets stacked full-width below leaderboard, each wrapped in ErrorBoundary + Suspense so a single failure never blocks the rest */}
          <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-6">
            <HideableCard cardKey="admin.ai-summary" label="AI Summary Report">
              <ErrorBoundary>
                <Suspense fallback={<div className="h-40 rounded-md bg-muted/30 animate-pulse" />}>
                  <AISummaryReport />
                </Suspense>
              </ErrorBoundary>
            </HideableCard>

            <HideableCard cardKey="admin.recognition-queue" label="Recognition Queue">
              <ErrorBoundary>
                <Suspense fallback={<div className="h-40 rounded-md bg-muted/30 animate-pulse" />}>
                  <RecognitionQueue />
                </Suspense>
              </ErrorBoundary>
            </HideableCard>
            <HideableCard cardKey="admin.course-progress" label="Course Progress">
              <ErrorBoundary>
                <Suspense fallback={<div className="h-40 rounded-md bg-muted/30 animate-pulse" />}>
                  <CourseProgressPanel />
                </Suspense>
              </ErrorBoundary>
            </HideableCard>
            {/* PL-MP242 cull 2026-07-05: Activity Feed (Live Activity) widget
                removed per Sam directive. Culture-feed live-deal ticker was
                duplicative with WhatShippedTodayBanner + Recognition Queue. */}
          </div>
        </motion.div>

        {/* Team Hierarchy Manager */}
        <HideableCard cardKey="admin.team-hierarchy" label="Team Hierarchy Manager">
          <TeamHierarchyManager />
        </HideableCard>

        {/* MP238-simplify: Manager Invites + Bulk Assignment stacked (was 2-col; too much noise beside the leaderboard) */}
        <div className="space-y-4">
          <HideableCard cardKey="admin.manager-invites" label="Manager Invites">
            <AdminManagerInvites />
          </HideableCard>
          <HideableCard cardKey="admin.bulk-lead-assignment" label="Bulk Lead Assignment">
            <BulkLeadAssignment />
          </HideableCard>
        </div>

        {/* Collapsible: Invite Links + Lead Reassignment */}
        <Collapsible open={showInviteLinks} onOpenChange={setShowInviteLinks}>
          <CollapsibleTrigger asChild>
            <Card className="cursor-pointer border-border/70 bg-card/95 shadow-sm transition-colors hover:bg-muted/50">
              <CardHeader className="py-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-medium">Manager Links & Lead Reassignment</CardTitle>
                  <ChevronDown className={cn("h-4 w-4 transition-base", showInviteLinks && "rotate-180")} />
                </div>
              </CardHeader>
            </Card>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-4">
            <div className="grid lg:grid-cols-2 gap-4">
              <ManagerInviteLinks />
              <LeadReassignment />
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Collapsible sections for Terminated, Abandoned, All Leads */}
        <div className="space-y-3">
          <Collapsible open={showTerminated} onOpenChange={setShowTerminated}>
            <CollapsibleTrigger asChild>
              <Card className="cursor-pointer border-border/70 bg-card/95 shadow-sm transition-colors hover:bg-muted/50">
                <CardHeader className="py-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-medium flex items-center gap-2">
                      Terminated Agent Leads
                    </CardTitle>
                    <ChevronDown className={cn("h-4 w-4 transition-base", showTerminated && "rotate-180")} />
                  </div>
                </CardHeader>
              </Card>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-4">
              <TerminatedAgentLeadsPanel />
            </CollapsibleContent>
          </Collapsible>

          <Collapsible open={showAbandoned} onOpenChange={setShowAbandoned}>
            <CollapsibleTrigger asChild>
              <Card className="cursor-pointer border-border/70 bg-card/95 shadow-sm transition-colors hover:bg-muted/50">
                <CardHeader className="py-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-medium flex items-center gap-2">
                      Abandoned Applications
                    </CardTitle>
                    <ChevronDown className={cn("h-4 w-4 transition-base", showAbandoned && "rotate-180")} />
                  </div>
                </CardHeader>
              </Card>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-4">
              <AbandonedLeadsPanel />
            </CollapsibleContent>
          </Collapsible>

          <Collapsible open={showAllLeads} onOpenChange={setShowAllLeads}>
            <CollapsibleTrigger asChild>
              <Card className="cursor-pointer border-border/70 bg-card/95 shadow-sm transition-colors hover:bg-muted/50">
                <CardHeader className="py-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-medium flex items-center gap-2">
                      All Leads
                    </CardTitle>
                    <ChevronDown className={cn("h-4 w-4 transition-base", showAllLeads && "rotate-180")} />
                  </div>
                </CardHeader>
              </Card>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-4">
              <AllLeadsPanel />
            </CollapsibleContent>
          </Collapsible>
        </div>
      </div>

      {/* Agent Profile Editor Drawer */}
      <AgentProfileEditor
        agent={selectedAgent}
        open={!!selectedAgent}
        onClose={() => setSelectedAgent(null)}
        onUpdate={() => {
          refetch();
          setSelectedAgent(null);
        }}
      />

      {/* Duplicate Merge Tool */}
      <DuplicateMergeTool
        open={showDuplicateTool}
        onClose={() => setShowDuplicateTool(false)}
        onMergeComplete={() => {
          refetch();
          setShowDuplicateTool(false);
        }}
      />

      {/* Invite Team Modal */}
      <InviteTeamModal
        open={showInviteModal}
        onClose={() => setShowInviteModal(false)}
      />

      {/* Deactivate Agent Dialog */}
      <DeactivateAgentDialog
        open={!!deactivateAgent}
        onOpenChange={(open) => !open && setDeactivateAgent(null)}
        agentId={deactivateAgent?.id || ""}
        agentName={deactivateAgent?.fullName || ""}
        onComplete={() => {
          refetch();
          setDeactivateAgent(null);
        }}
      />

      {/* Stat Card Popup */}
      <StatCardPopup
        type={statPopup.type}
        open={statPopup.open}
        onOpenChange={(open) => setStatPopup({ ...statPopup, open })}
        agents={agentsForPopup}
        timePeriod={timePeriod}
      />
    </>
  );
}
