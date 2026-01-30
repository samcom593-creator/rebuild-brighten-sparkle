import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
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
  Upload,
  Download
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
import { cn } from "@/lib/utils";
import { format, startOfWeek, startOfMonth } from "date-fns";

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

  // Get date range based on time period
  const dateRange = useMemo(() => {
    const now = new Date();
    switch (timePeriod) {
      case "day":
        return { start: format(now, "yyyy-MM-dd"), end: format(now, "yyyy-MM-dd") };
      case "week":
        return { start: format(startOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd"), end: format(now, "yyyy-MM-dd") };
      case "month":
        return { start: format(startOfMonth(now), "yyyy-MM-dd"), end: format(now, "yyyy-MM-dd") };
      case "custom":
        if (customDateRange.from && customDateRange.to) {
          return { start: format(customDateRange.from, "yyyy-MM-dd"), end: format(customDateRange.to, "yyyy-MM-dd") };
        }
        return { start: format(startOfMonth(now), "yyyy-MM-dd"), end: format(now, "yyyy-MM-dd") };
      default:
        return { start: format(startOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd"), end: format(now, "yyyy-MM-dd") };
    }
  }, [timePeriod, customDateRange]);

  // Fetch all agents with production stats - CLEAN query excluding unknowns/duplicates
  const { data: agentsData, isLoading, refetch } = useQuery({
    queryKey: ["command-center-agents", dateRange],
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

      // Get production data for the period
      const { data: production, error: prodError } = await supabase
        .from("daily_production")
        .select("agent_id, aop, deals_closed, presentations, production_date")
        .gte("production_date", dateRange.start)
        .lte("production_date", dateRange.end);

      if (prodError) throw prodError;

      // Aggregate production by agent
      const productionMap = new Map<string, { alp: number; deals: number; presentations: number; lastDate: string }>();
      production?.forEach((p) => {
        const existing = productionMap.get(p.agent_id) || { alp: 0, deals: 0, presentations: 0, lastDate: "" };
        productionMap.set(p.agent_id, {
          alp: existing.alp + Number(p.aop || 0),
          deals: existing.deals + Number(p.deals_closed || 0),
          presentations: existing.presentations + Number(p.presentations || 0),
          lastDate: p.production_date > existing.lastDate ? p.production_date : existing.lastDate,
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

        {/* Summary Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <Card className="stat-card">
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
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <Card className="stat-card">
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
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <Card className="stat-card">
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
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
          >
            <Card className="stat-card border-destructive/20">
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
          </motion.div>
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
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Leaderboard - 2 columns */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg font-semibold">Production Leaderboard</CardTitle>
                  <Badge variant="outline" className="text-xs">
                    {filteredAgents.length} agents
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="space-y-3">
                    {[...Array(5)].map((_, i) => (
                      <div key={i} className="h-14 bg-muted animate-pulse rounded-lg" />
                    ))}
                  </div>
                ) : filteredAgents.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Users className="h-10 w-10 mx-auto mb-3 opacity-50" />
                    <p>No agents match your filters</p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[500px] overflow-y-auto scrollbar-custom">
                    {filteredAgents.map((agent, index) => (
                      <motion.div
                        key={agent.id}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: index * 0.02 }}
                        onClick={() => setSelectedAgent(agent)}
                        className={cn(
                          "flex items-center gap-4 p-3 rounded-lg cursor-pointer transition-all",
                          "hover:bg-muted/50 border border-transparent hover:border-border",
                          index === 0 && "bg-primary/5 border-primary/20",
                          index === 1 && "bg-muted/30",
                          index === 2 && "bg-muted/20",
                          agent.closingRate < 15 && agent.totalAlp > 0 && "border-l-2 border-l-amber-500",
                          (agent.isDeactivated || agent.isInactive) && "opacity-60"
                        )}
                      >
                        {/* Rank */}
                        <div className={cn(
                          "w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold",
                          index === 0 && "bg-amber-500 text-black",
                          index === 1 && "bg-gray-300 text-black",
                          index === 2 && "bg-amber-700 text-white",
                          index > 2 && "bg-muted text-muted-foreground"
                        )}>
                          {index + 1}
                        </div>

                        {/* Agent Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium truncate">{agent.fullName}</span>
                            {!agent.hasCrmLink && (
                              <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-600 border-amber-500/30">
                                No CRM
                              </Badge>
                            )}
                            {agent.isDeactivated && (
                              <Badge variant="destructive" className="text-xs">Terminated</Badge>
                            )}
                            {agent.isInactive && !agent.isDeactivated && (
                              <Badge variant="secondary" className="text-xs">Inactive</Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground truncate">
                            {agent.email || "No email"}
                          </p>
                        </div>

                        {/* Stats */}
                        <div className="flex items-center gap-4 text-right">
                          <div>
                            <p className="font-bold text-lg">${Math.round(agent.totalAlp).toLocaleString()}</p>
                            <p className="text-xs text-muted-foreground">{agent.totalDeals} deals</p>
                          </div>
                          <div className={cn(
                            "text-sm font-medium",
                            agent.closingRate >= 25 && "text-green-500",
                            agent.closingRate >= 15 && agent.closingRate < 25 && "text-primary",
                            agent.closingRate < 15 && agent.closingRate > 0 && "text-amber-500",
                            agent.closingRate === 0 && "text-muted-foreground"
                          )}>
                            {agent.closingRate}%
                          </div>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-8 w-8"
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
                      </motion.div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Recognition Queue & Course Progress - 1 column */}
          <div className="space-y-6">
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
    </DashboardLayout>
  );
}
