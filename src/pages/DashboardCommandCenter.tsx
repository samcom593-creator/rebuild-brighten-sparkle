import { useState, useMemo, useCallback } from "react";
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
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
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
import { AbandonedLeadsPanel } from "@/components/dashboard/AbandonedLeadsPanel";
import { AllLeadsPanel } from "@/components/dashboard/AllLeadsPanel";
import { DateRangePicker, type DateRange } from "@/components/ui/date-range-picker";
import { useProductionRealtime } from "@/hooks/useProductionRealtime";
import { useInFlightGuard } from "@/hooks/useInFlightGuard";
import { getClosingRateColor } from "@/lib/closingRateColors";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { getTodayPST, getWeekStartPST, getMonthStartPST } from "@/lib/dateUtils";
import { toast } from "sonner";

type TimePeriod = "day" | "week" | "month" | "custom";
type FilterType = "all" | "producers" | "weak" | "zero" | "inactive";

interface AgentWithStats {
  id: string;
  profileId: string | null;
  fullName: string;
  email: string | null;
  phone: string | null;
  status: string;
  isDeactivated: boolean;
  isInactive: boolean;
  totalAlp: number;
  totalDeals: number;
  closingRate: number;
  hasCrmLink: boolean;
  lastActivity: string | null;
}

export default function DashboardCommandCenter() {
  const { isAdmin } = useAuth();
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
  const [showTerminated, setShowTerminated] = useState(false);
  const [showAbandoned, setShowAbandoned] = useState(false);
  const [showAllLeads, setShowAllLeads] = useState(false);
  
  // Stat card popup state
  const [statPopup, setStatPopup] = useState<{ type: StatType; open: boolean }>({ type: "totalAlp", open: false });

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
    staleTime: 120000, // 2 minutes - prevent unnecessary refetches
    gcTime: 600000, // 10 minutes cache
    queryFn: async () => {
      // First get all agents with profiles
      const { data: agents, error: agentsError } = await supabase
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
        .order("created_at", { ascending: false });

      if (agentsError) throw agentsError;

      // Get pre-aggregated production stats from database function (server-side aggregation)
      const { data: production, error: prodError } = await supabase
        .rpc("get_agent_production_stats", {
          start_date: dateRange.start,
          end_date: dateRange.end,
        });

      if (prodError) throw prodError;

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
          const profile = a.profiles;
          const name = profile?.full_name || "";
          // HARD RULE: No anonymous, numeric-only, or "Unknown" entries
          return (
            name &&
            name.trim().length > 0 &&
            !name.toLowerCase().includes("unknown") &&
            !/^\d+$/.test(name.trim())
          );
        })
        .map((a) => {
          const profile = a.profiles;
          const prod = productionMap.get(a.id);
          const closingRate = prod && prod.presentations > 0 
            ? Math.round((prod.deals / prod.presentations) * 100) 
            : 0;
          
          return {
            id: a.id,
            profileId: a.profile_id,
            fullName: profile?.full_name || "Unknown",
            email: profile?.email || null,
            phone: profile?.phone || null,
            status: a.status,
            isDeactivated: a.is_deactivated || false,
            isInactive: a.is_inactive || false,
            totalAlp: prod?.alp || 0,
            totalDeals: prod?.deals || 0,
            closingRate,
            hasCrmLink: !!a.profile_id,
            lastActivity: prod?.lastDate || null,
          };
        });

      return agentStats;
    },
  });

  // In-flight guard to prevent multiple simultaneous refetches
  const guardedRefetch = useInFlightGuard(refetch);

  // Use singleton realtime hook (shared channel across app, 1s debounce)
  useProductionRealtime(() => guardedRefetch(), 1000);

  // Login link handlers
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

  // Apply filters
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
        filtered = filtered.filter((a) => a.isDeactivated || a.isInactive);
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

  // Summary stats - updated "Needs Attention" logic
  const summaryStats = useMemo(() => {
    if (!agentsData) return { totalAlp: 0, activeAgents: 0, producers: 0, weakPerformers: 0 };
    
    const activeAgents = agentsData.filter((a) => !a.isDeactivated && !a.isInactive);
    const producers = agentsData.filter((a) => a.totalAlp > 0);
    // "Needs Attention" = LIVE agents under $5,000 for the week
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
    };
  }, [agentsData]);

  if (!isAdmin) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-[60vh]">
          <Card className="p-8 text-center">
            <Shield className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h2 className="text-xl font-semibold mb-2">Admin Access Required</h2>
            <p className="text-muted-foreground">This command center is only accessible to administrators.</p>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold tracking-tight">Command Center</h1>
            <p className="text-muted-foreground">Full agency control. Zero spreadsheets.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <LeadImporter />
            <LeadExporter />
            <Button 
              variant="default" 
              onClick={() => setShowInviteModal(true)}
              className="gap-2"
            >
              <UserPlus className="h-4 w-4" />
              Invite Team
            </Button>
            <Button 
              variant="outline" 
              onClick={() => setShowDuplicateTool(true)}
              className="gap-2"
            >
              <Users className="h-4 w-4" />
              Find Duplicates
            </Button>
          </div>
        </div>

        {/* Summary Stats - Clickable */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card 
            className="stat-card cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all"
            onClick={() => setStatPopup({ type: "totalAlp", open: true })}
          >
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <DollarSign className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Total ALP</p>
                  <p className="text-2xl font-bold">${Math.round(summaryStats.totalAlp).toLocaleString()}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card 
            className="stat-card cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all"
            onClick={() => setStatPopup({ type: "activeAgents", open: true })}
          >
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Users className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Active Agents</p>
                  <p className="text-2xl font-bold">{summaryStats.activeAgents}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card 
            className="stat-card cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all"
            onClick={() => setStatPopup({ type: "producers", open: true })}
          >
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <TrendingUp className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Producers</p>
                  <p className="text-2xl font-bold">{summaryStats.producers}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card 
            className="stat-card border-destructive/20 cursor-pointer hover:ring-2 hover:ring-destructive/50 transition-all"
            onClick={() => setStatPopup({ type: "needsAttention", open: true })}
          >
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-destructive/10">
                  <AlertTriangle className="h-5 w-5 text-destructive" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Needs Attention</p>
                  <p className="text-2xl font-bold text-destructive">{summaryStats.weakPerformers}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Time Period Toggle + Custom Date Range */}
        <div className="flex flex-col lg:flex-row lg:items-center gap-4">
          <Tabs value={timePeriod} onValueChange={(v) => setTimePeriod(v as TimePeriod)} className="w-full lg:w-auto">
            <TabsList className="grid grid-cols-4 w-full lg:w-auto">
              <TabsTrigger value="day" className="px-3 text-sm">Today</TabsTrigger>
              <TabsTrigger value="week" className="px-3 text-sm">Week</TabsTrigger>
              <TabsTrigger value="month" className="px-3 text-sm">Month</TabsTrigger>
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
                className="pl-9"
              />
            </div>
          </div>
        </div>

        {/* Quick Filters */}
        <QuickFilters activeFilter={activeFilter} onFilterChange={setActiveFilter} />

        {/* Main Content Grid */}
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Leaderboard - Takes 70% on desktop */}
          <div className="w-full lg:w-[70%]">
            <Card className="flex flex-col h-full">
              <CardHeader className="pb-3 shrink-0">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg font-semibold">Production Leaderboard</CardTitle>
                  <Badge variant="outline" className="text-xs">
                    {filteredAgents.length} agents
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="flex-1 min-h-0 p-0">
                {isLoading ? (
                  <div className="space-y-3 px-6 pb-6">
                    {[...Array(5)].map((_, i) => (
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
                      <div
                        key={agent.id}
                        onClick={() => setSelectedAgent(agent)}
                        className={cn(
                          "flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 p-4 rounded-lg cursor-pointer transition-all min-h-[56px]",
                          "hover:bg-muted/50 border border-transparent hover:border-border",
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
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Recognition Queue & Course Progress - 30% on desktop */}
          <div className="w-full lg:w-[30%] space-y-6">
            <RecognitionQueue />
            <CourseProgressPanel />
          </div>
        </div>

        {/* Team Hierarchy Manager */}
        <TeamHierarchyManager />

        {/* Manager Invites + Bulk Assignment (side by side) */}
        <div className="grid lg:grid-cols-2 gap-4">
          <AdminManagerInvites />
          <BulkLeadAssignment />
        </div>

        {/* Collapsible: Invite Links + Lead Reassignment */}
        <Collapsible open={showInviteLinks} onOpenChange={setShowInviteLinks}>
          <CollapsibleTrigger asChild>
            <Card className="cursor-pointer hover:bg-muted/50 transition-colors">
              <CardHeader className="py-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-medium">Manager Links & Lead Reassignment</CardTitle>
                  <ChevronDown className={cn("h-4 w-4 transition-transform", showInviteLinks && "rotate-180")} />
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
              <Card className="cursor-pointer hover:bg-muted/50 transition-colors">
                <CardHeader className="py-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-medium flex items-center gap-2">
                      Terminated Agent Leads
                    </CardTitle>
                    <ChevronDown className={cn("h-4 w-4 transition-transform", showTerminated && "rotate-180")} />
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
              <Card className="cursor-pointer hover:bg-muted/50 transition-colors">
                <CardHeader className="py-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-medium flex items-center gap-2">
                      Abandoned Applications
                    </CardTitle>
                    <ChevronDown className={cn("h-4 w-4 transition-transform", showAbandoned && "rotate-180")} />
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
              <Card className="cursor-pointer hover:bg-muted/50 transition-colors">
                <CardHeader className="py-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-medium flex items-center gap-2">
                      All Leads
                    </CardTitle>
                    <ChevronDown className={cn("h-4 w-4 transition-transform", showAllLeads && "rotate-180")} />
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
        agents={agentsData || []}
        timePeriod={timePeriod}
      />
    </DashboardLayout>
  );
}
