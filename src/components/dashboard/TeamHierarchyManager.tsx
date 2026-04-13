import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Users, RefreshCw, AlertTriangle, Loader2, Network, MoreVertical, Pencil, UserX, Trash2, Merge, Mail } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  DropdownMenuSeparator,
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
} from "@/components/ui/alert-dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { AddToCourseButton } from "./AddToCourseButton";
import { AgentProfileEditor } from "@/components/admin/AgentProfileEditor";
import { DeactivateAgentDialog } from "./DeactivateAgentDialog";
import { DuplicateMergeTool } from "@/components/admin/DuplicateMergeTool";

interface AgentHierarchyEntry {
  id: string;
  profileId: string | null;
  name: string;
  email: string;
  phone: string | null;
  managerId: string | null;
  managerName: string | null;
  isManager: boolean;
  onboardingStage: string | null;
  hasProgress: boolean;
  courseProgress: number;
  isDeactivated: boolean;
  isInactive: boolean;
  // Production data
  weeklyAlp: number;
  weeklyDeals: number;
  monthlyAlp: number;
  monthlyDeals: number;
}

interface Manager {
  id: string;
  name: string;
}

const ONBOARDING_STAGES = [
  { value: "onboarding", label: "Onboarding" },
  { value: "training_online", label: "Training Online" },
  { value: "in_field_training", label: "In Field Training" },
  { value: "evaluated", label: "Evaluated" },
];

export function TeamHierarchyManager() {
  const { user } = useAuth();
  const [agents, setAgents] = useState<AgentHierarchyEntry[]>([]);
  const [managers, setManagers] = useState<Manager[]>([]);
  const [adminAgentId, setAdminAgentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [updatingStage, setUpdatingStage] = useState<string | null>(null);
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [filterManager, setFilterManager] = useState<string>("all");
  
  // Selection state for bulk actions
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set());
  const [showBulkDeleteDialog, setShowBulkDeleteDialog] = useState(false);
  const [bulkDeleteType, setBulkDeleteType] = useState<"soft" | "hard">("soft");
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  
  // Editor states
  const [selectedAgent, setSelectedAgent] = useState<AgentHierarchyEntry | null>(null);
  const [deactivateAgent, setDeactivateAgent] = useState<AgentHierarchyEntry | null>(null);
  const [showMergeTool, setShowMergeTool] = useState(false);
  const [sendingLoginTo, setSendingLoginTo] = useState<string | null>(null);

  useEffect(() => {
    fetchHierarchy();
  }, [user?.id]);

  const fetchHierarchy = async () => {
    if (!user) return;
    setLoading(true);

    try {
      const { data: currentAgent } = await supabase
        .from("agents")
        .select("id")
        .eq("user_id", user.id)
        .eq("is_deactivated", false)
        .maybeSingle();

      if (currentAgent) {
        setAdminAgentId(currentAgent.id);
      }

      const { data: agentsData, error: agentsError } = await supabase
        .from("agents")
        .select("id, user_id, profile_id, invited_by_manager_id, onboarding_stage, is_deactivated, is_inactive")
        .eq("is_deactivated", false)
        .order("created_at", { ascending: true });

      if (agentsError) throw agentsError;

      if (!agentsData || agentsData.length === 0) {
        setAgents([]);
        setManagers([]);
        setLoading(false);
        return;
      }

      const userIds = agentsData.map(a => a.user_id).filter(Boolean);
      const agentIds = agentsData.map(a => a.id);
      
      // Get week start (Sunday) in PST
      const now = new Date();
      const dayOfWeek = now.getDay();
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - dayOfWeek);
      weekStart.setHours(0, 0, 0, 0);
      const weekStartStr = weekStart.toISOString().split('T')[0];
      
      // Get month start
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthStartStr = monthStart.toISOString().split('T')[0];
      
      const [profilesResult, managerRolesResult, progressResult, modulesResult, productionResult] = await Promise.all([
        supabase.from("profiles").select("user_id, full_name, email, phone").in("user_id", userIds),
        supabase.from("user_roles").select("user_id").in("role", ["manager", "admin"]),
        supabase.from("onboarding_progress").select("agent_id, passed"),
        supabase.from("onboarding_modules").select("id").eq("is_active", true),
        supabase.from("daily_production").select("agent_id, production_date, aop, deals_closed").in("agent_id", agentIds).gte("production_date", monthStartStr),
      ]);

      const profiles = profilesResult.data || [];
      const managerUserIds = new Set(managerRolesResult.data?.map(r => r.user_id) || []);
      const progressData = progressResult.data || [];
      const totalModules = modulesResult.data?.length || 1;
      const productionData = productionResult.data || [];

      // Aggregate production by agent
      const productionMap = new Map<string, { weeklyAlp: number; weeklyDeals: number; monthlyAlp: number; monthlyDeals: number }>();
      productionData.forEach(p => {
        const existing = productionMap.get(p.agent_id) || { weeklyAlp: 0, weeklyDeals: 0, monthlyAlp: 0, monthlyDeals: 0 };
        const isThisWeek = p.production_date >= weekStartStr;
        productionMap.set(p.agent_id, {
          weeklyAlp: existing.weeklyAlp + (isThisWeek ? Number(p.aop) || 0 : 0),
          weeklyDeals: existing.weeklyDeals + (isThisWeek ? p.deals_closed || 0 : 0),
          monthlyAlp: existing.monthlyAlp + (Number(p.aop) || 0),
          monthlyDeals: existing.monthlyDeals + (p.deals_closed || 0),
        });
      });

      const agentProgressMap = new Map<string, { hasProgress: boolean; passedCount: number }>();
      progressData.forEach(p => {
        const existing = agentProgressMap.get(p.agent_id) || { hasProgress: false, passedCount: 0 };
        agentProgressMap.set(p.agent_id, {
          hasProgress: true,
          passedCount: existing.passedCount + (p.passed ? 1 : 0),
        });
      });

      const agentEntries: AgentHierarchyEntry[] = agentsData.map(agent => {
        const profile = profiles?.find(p => p.user_id === agent.user_id);
        const isManager = managerUserIds.has(agent.user_id || "");
        const progressInfo = agentProgressMap.get(agent.id);
        const production = productionMap.get(agent.id) || { weeklyAlp: 0, weeklyDeals: 0, monthlyAlp: 0, monthlyDeals: 0 };
        
        let managerName: string | null = null;
        if (agent.invited_by_manager_id) {
          const managerAgent = agentsData.find(a => a.id === agent.invited_by_manager_id);
          if (managerAgent) {
            const managerProfile = profiles?.find(p => p.user_id === managerAgent.user_id);
            managerName = managerProfile?.full_name || "Unknown";
          }
        }

        return {
          id: agent.id,
          profileId: agent.profile_id,
          name: profile?.full_name || "Unknown",
          email: profile?.email || "",
          phone: profile?.phone || null,
          managerId: agent.invited_by_manager_id,
          managerName,
          isManager,
          onboardingStage: agent.onboarding_stage,
          hasProgress: progressInfo?.hasProgress || false,
          courseProgress: progressInfo 
            ? Math.round((progressInfo.passedCount / totalModules) * 100) 
            : 0,
          isDeactivated: agent.is_deactivated || false,
          isInactive: agent.is_inactive || false,
          weeklyAlp: production.weeklyAlp,
          weeklyDeals: production.weeklyDeals,
          monthlyAlp: production.monthlyAlp,
          monthlyDeals: production.monthlyDeals,
        };
      });

      // Sort by monthly production (highest first)
      agentEntries.sort((a, b) => b.monthlyAlp - a.monthlyAlp);

      const managerList: Manager[] = agentEntries
        .filter(a => a.isManager)
        .map(a => ({ id: a.id, name: a.name }));

      setAgents(agentEntries);
      setManagers(managerList);
    } catch (error) {
      console.error("Error fetching hierarchy:", error);
      toast.error("Failed to load team hierarchy");
    } finally {
      setLoading(false);
    }
  };

  const handleReassign = async (agentId: string, newManagerId: string | null) => {
    setUpdating(agentId);

    try {
      const { error } = await supabase
        .from("agents")
        .update({ invited_by_manager_id: newManagerId })
        .eq("id", agentId);

      if (error) throw error;

      const agentName = agents.find(a => a.id === agentId)?.name || "Agent";
      const managerName = newManagerId 
        ? managers.find(m => m.id === newManagerId)?.name || "manager"
        : "no manager";

      toast.success(`${agentName} reassigned to ${managerName}`);
      fetchHierarchy();
    } catch (error) {
      console.error("Error reassigning agent:", error);
      toast.error("Failed to reassign agent");
    } finally {
      setUpdating(null);
    }
  };

  const handleStageChange = async (agentId: string, newStage: string) => {
    setUpdatingStage(agentId);

    try {
      const { error } = await supabase
        .from("agents")
        .update({ onboarding_stage: newStage as "onboarding" | "training_online" | "in_field_training" | "evaluated" })
        .eq("id", agentId);

      if (error) throw error;

      const agentName = agents.find(a => a.id === agentId)?.name || "Agent";
      
      // Trigger new hire auto-flow when moving to in_field_training
      if (newStage === "in_field_training") {
        try {
          await supabase.functions.invoke("trigger-new-hire-flow", {
            body: { agentId, triggerType: "contracted" }
          });
          toast.success(`${agentName} is now LIVE — welcome email and SMS sent automatically`);
        } catch (e) {
          console.error("New hire flow trigger failed:", e);
          toast.success(`${agentName}'s stage updated to ${newStage.replace(/_/g, " ")}`);
        }
      } else {
        toast.success(`${agentName}'s stage updated to ${newStage.replace(/_/g, " ")}`);
      }
      fetchHierarchy();
    } catch (error) {
      console.error("Error updating stage:", error);
      toast.error("Failed to update stage");
    } finally {
      setUpdatingStage(null);
    }
  };

  const handleAssignAllToMe = async () => {
    if (!adminAgentId) {
      toast.error("Could not find your admin agent record");
      return;
    }

    setBulkUpdating(true);

    try {
      const { error } = await supabase
        .from("agents")
        .update({ invited_by_manager_id: adminAgentId })
        .neq("id", adminAgentId)
        .eq("is_deactivated", false);

      if (error) throw error;

      toast.success("All agents now report directly to you!");
      fetchHierarchy();
    } catch (error) {
      console.error("Error bulk reassigning:", error);
      toast.error("Failed to reassign all agents");
    } finally {
      setBulkUpdating(false);
    }
  };

  // Function to assign all orphaned agents to a specific manager
  const handleAssignOrphansToManager = async (managerId: string) => {
    setBulkUpdating(true);

    try {
      const orphanIds = agents
        .filter(a => !a.managerId && a.id !== adminAgentId && a.id !== managerId)
        .map(a => a.id);

      if (orphanIds.length === 0) {
        toast.info("No orphaned agents to assign");
        setBulkUpdating(false);
        return;
      }

      const { error } = await supabase
        .from("agents")
        .update({ invited_by_manager_id: managerId })
        .in("id", orphanIds);

      if (error) throw error;

      const managerName = managers.find(m => m.id === managerId)?.name || "manager";
      toast.success(`${orphanIds.length} agents assigned to ${managerName}`);
      fetchHierarchy();
    } catch (error) {
      console.error("Error bulk reassigning:", error);
      toast.error("Failed to assign agents");
    } finally {
      setBulkUpdating(false);
    }
  };

  // Bulk selection handlers
  const toggleSelectAgent = (agentId: string) => {
    setSelectedAgents(prev => {
      const next = new Set(prev);
      if (next.has(agentId)) {
        next.delete(agentId);
      } else {
        next.add(agentId);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    const selectableAgents = filteredAgents.filter(a => a.id !== adminAgentId);
    if (selectedAgents.size === selectableAgents.length) {
      setSelectedAgents(new Set());
    } else {
      setSelectedAgents(new Set(selectableAgents.map(a => a.id)));
    }
  };

  // Bulk delete handler
  const handleBulkDelete = async () => {
    if (selectedAgents.size === 0) return;
    setIsBulkDeleting(true);

    try {
      const agentIds = Array.from(selectedAgents);
      
      if (bulkDeleteType === "soft") {
        // Soft delete: mark as deactivated
        const { error } = await supabase
          .from("agents")
          .update({ is_deactivated: true, deactivation_reason: "inactive" })
          .in("id", agentIds);
        
        if (error) throw error;
        toast.success(`${agentIds.length} agents marked as inactive`);
      } else {
        // Hard delete: permanently remove agents
        // This needs to delete from multiple tables
        for (const agentId of agentIds) {
          // Delete from related tables first
          await supabase.from("onboarding_progress").delete().eq("agent_id", agentId);
          await supabase.from("daily_production").delete().eq("agent_id", agentId);
          await supabase.from("agent_notes").delete().eq("agent_id", agentId);
          await supabase.from("agent_goals").delete().eq("agent_id", agentId);
          await supabase.from("agent_attendance").delete().eq("agent_id", agentId);
          await supabase.from("agent_ratings").delete().eq("agent_id", agentId);
          await supabase.from("agent_onboarding").delete().eq("agent_id", agentId);
          await supabase.from("plaque_awards").delete().eq("agent_id", agentId);
          await supabase.from("magic_login_tokens").delete().eq("agent_id", agentId);
          
          // Finally delete the agent record
          await supabase.from("agents").delete().eq("id", agentId);
        }
        toast.success(`${agentIds.length} agents permanently deleted`);
      }

      setSelectedAgents(new Set());
      setShowBulkDeleteDialog(false);
      fetchHierarchy();
    } catch (error) {
      console.error("Error bulk deleting:", error);
      toast.error("Failed to delete agents");
    } finally {
      setIsBulkDeleting(false);
    }
  };

  // Send Login Handler
  const handleSendLogin = async (agentId: string, email: string) => {
    setSendingLoginTo(agentId);
    try {
      const { error } = await supabase.functions.invoke("send-agent-portal-login", {
        body: { agentId }
      });
      if (error) throw error;
      toast.success(`Portal login email sent to ${email}`);
    } catch (error) {
      console.error("Error sending login:", error);
      toast.error("Failed to send login email");
    } finally {
      setSendingLoginTo(null);
    }
  };

  // Get indirect agents (those under sub-managers)
  const indirectAgents = agents.filter(a => {
    if (a.id === adminAgentId) return false;
    if (!a.managerId) return false;
    return a.managerId !== adminAgentId;
  });

  // Always show admin at top, then apply filter to remaining agents
  const filteredAgents = (() => {
    const adminAgent = agents.find(a => a.id === adminAgentId);
    const otherAgents = agents.filter(a => a.id !== adminAgentId);
    
    let filtered: AgentHierarchyEntry[];
    if (filterManager === "all") {
      filtered = otherAgents;
    } else if (filterManager === "orphaned") {
      filtered = otherAgents.filter(a => !a.managerId);
    } else {
      filtered = otherAgents.filter(a => a.managerId === filterManager);
    }
    
    // Admin always at top
    return adminAgent ? [adminAgent, ...filtered] : filtered;
  })();

  const orphanedCount = agents.filter(a => !a.managerId && a.id !== adminAgentId).length;
  const indirectReports = agents.filter(a => {
    if (a.id === adminAgentId) return false;
    if (!a.managerId) return false;
    return a.managerId !== adminAgentId;
  }).length;

  const selectableAgents = filteredAgents.filter(a => a.id !== adminAgentId);
  const isAllSelected = selectableAgents.length > 0 && selectedAgents.size === selectableAgents.length;
  const isPartiallySelected = selectedAgents.size > 0 && selectedAgents.size < selectableAgents.length;

  if (loading) {
    return (
      <GlassCard className="p-4">
        <div className="space-y-3">
          {/* Skeleton header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 rounded bg-muted animate-pulse" />
              <div className="h-4 w-32 rounded bg-muted animate-pulse" />
            </div>
            <div className="flex gap-2">
              <div className="h-7 w-20 rounded bg-muted animate-pulse" />
              <div className="h-7 w-28 rounded bg-muted animate-pulse" />
            </div>
          </div>
          {/* Skeleton rows */}
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="h-12 rounded bg-muted/50 animate-pulse" />
          ))}
        </div>
      </GlassCard>
    );
  }

  return (
    <>
      <GlassCard className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Network className="h-4 w-4 text-primary" />
            <h3 className="font-semibold text-sm">Team Hierarchy Manager</h3>
            <Badge variant="secondary" className="text-xs">{agents.length} agents</Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={fetchHierarchy}
              disabled={loading}
              className="h-7 text-xs"
            >
              <RefreshCw className={cn("h-3 w-3 mr-1", loading && "animate-spin")} />
              Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowMergeTool(true)}
              className="h-7 text-xs"
            >
              <Merge className="h-3 w-3 mr-1" />
              Merge
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={handleAssignAllToMe}
              disabled={bulkUpdating || !adminAgentId}
              className="h-7 text-xs"
            >
              {bulkUpdating ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <Users className="h-3 w-3 mr-1" />
              )}
              Assign All to Me
            </Button>
            {/* Bulk assign orphans to selected manager */}
            {filterManager !== "all" && filterManager !== "orphaned" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleAssignOrphansToManager(filterManager)}
                disabled={bulkUpdating || orphanedCount === 0}
                className="h-7 text-xs"
              >
                {bulkUpdating ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : (
                  <Users className="h-3 w-3 mr-1" />
                )}
                Assign Orphans to {managers.find(m => m.id === filterManager)?.name}
              </Button>
            )}
          </div>
        </div>

        {/* Alerts */}
        {(orphanedCount > 0 || indirectReports > 0) && (
          <div className="mb-3 flex flex-wrap gap-2">
            {orphanedCount > 0 && (
              <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs">
                <AlertTriangle className="h-3 w-3" />
                <span>{orphanedCount} with no manager</span>
              </div>
            )}
            {indirectReports > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <button className="flex items-center gap-1.5 px-2 py-1 rounded bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400 text-xs cursor-pointer hover:bg-blue-500/20 transition-colors">
                    <Users className="h-3 w-3" />
                    <span>{indirectReports} under sub-managers</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-0" align="start">
                  <div className="p-3 border-b">
                    <h4 className="font-semibold text-sm">Agents Under Sub-Managers</h4>
                    <p className="text-xs text-muted-foreground mt-1">Click to reassign to a different manager</p>
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {indirectAgents.map((agent) => (
                      <div key={agent.id} className="flex items-center justify-between p-2 border-b last:border-0 hover:bg-muted/50">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{agent.name}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            Manager: {agent.managerName || "Unknown"}
                          </p>
                        </div>
                        <Select
                          value={agent.managerId || ""}
                          onValueChange={(value) => handleReassign(agent.id, value || null)}
                          disabled={updating === agent.id}
                        >
                          <SelectTrigger className="h-7 w-24 text-xs">
                            {updating === agent.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <SelectValue placeholder="Reassign" />
                            )}
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="">No Manager</SelectItem>
                            {managers.map((m) => (
                              <SelectItem key={m.id} value={m.id} className="text-xs">
                                {m.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            )}
          </div>
        )}

        {/* Filter */}
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs text-muted-foreground">Filter:</span>
          <Select value={filterManager} onValueChange={setFilterManager}>
            <SelectTrigger className="w-40 h-7 text-xs">
              <SelectValue placeholder="All agents" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All ({agents.length})</SelectItem>
              <SelectItem value="orphaned">⚠️ No Manager ({orphanedCount})</SelectItem>
              {managers.map((manager) => (
                <SelectItem key={manager.id} value={manager.id}>
                  {manager.name}'s Team
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Agents Table - Premium Production Display */}
        <div className="rounded-lg border bg-card/50 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="text-xs w-10">
                  <Checkbox
                    checked={isAllSelected}
                    onCheckedChange={toggleSelectAll}
                    className="border-muted-foreground/50"
                    aria-label="Select all"
                  />
                </TableHead>
                <TableHead className="text-xs">Agent</TableHead>
                <TableHead className="text-xs text-right">Week ALP</TableHead>
                <TableHead className="text-xs text-right">Deals</TableHead>
                <TableHead className="text-xs text-right">Month ALP</TableHead>
                <TableHead className="text-xs w-36">Stage</TableHead>
                <TableHead className="text-xs w-28">Course</TableHead>
                <TableHead className="text-xs w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAgents.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-6 text-muted-foreground text-sm">
                    No agents found
                  </TableCell>
                </TableRow>
              ) : (
                filteredAgents.map((agent) => (
                  <TableRow 
                    key={agent.id}
                    className={cn(
                      "hover:bg-muted/20",
                      agent.id === adminAgentId && "bg-primary/5",
                      selectedAgents.has(agent.id) && "bg-primary/10"
                    )}
                  >
                    {/* Checkbox */}
                    <TableCell className="py-2">
                      {agent.id !== adminAgentId ? (
                        <Checkbox
                          checked={selectedAgents.has(agent.id)}
                          onCheckedChange={() => toggleSelectAgent(agent.id)}
                          aria-label={`Select ${agent.name}`}
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    
                    {/* Agent Name with Badges */}
                    <TableCell className="py-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-medium text-sm">{agent.name}</span>
                        {/* In Field Badge - shown for in_field_training or evaluated */}
                        {(agent.onboardingStage === "in_field_training" || agent.onboardingStage === "evaluated") && (
                          <Badge className="text-[10px] px-1 py-0 bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
                            ✓ In Field
                          </Badge>
                        )}
                        {agent.isManager && (
                          <Badge variant="secondary" className="text-[10px] px-1 py-0 bg-teal-500/20 text-teal-600 dark:text-teal-400 border-teal-500/30">
                            Manager
                          </Badge>
                        )}
                        {agent.id === adminAgentId && (
                          <Badge className="text-[10px] px-1 py-0 bg-primary/20 text-primary border-primary/30">You</Badge>
                        )}
                        {/* Show which manager for indirect reports */}
                        {agent.managerId && agent.managerId !== adminAgentId && agent.id !== adminAgentId && (
                          <span className="text-[10px] text-muted-foreground">
                            → {agent.managerName?.split(" ")[0]}
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-muted-foreground">{agent.email}</span>
                    </TableCell>
                    
                    {/* Weekly ALP - Highlighted */}
                    <TableCell className="text-right py-2">
                      <span className={cn(
                        "font-bold text-sm tabular-nums",
                        agent.weeklyAlp > 0 ? "text-primary" : "text-muted-foreground"
                      )}>
                        ${agent.weeklyAlp.toLocaleString()}
                      </span>
                    </TableCell>
                    
                    {/* Weekly Deals */}
                    <TableCell className="text-right py-2">
                      <span className={cn(
                        "font-semibold text-sm tabular-nums",
                        agent.weeklyDeals > 0 ? "text-foreground" : "text-muted-foreground"
                      )}>
                        {agent.weeklyDeals}
                      </span>
                    </TableCell>
                    
                    {/* Monthly ALP */}
                    <TableCell className="text-right py-2">
                      <span className={cn(
                        "text-sm tabular-nums",
                        agent.monthlyAlp > 0 ? "text-muted-foreground font-medium" : "text-muted-foreground/50"
                      )}>
                        ${agent.monthlyAlp.toLocaleString()}
                      </span>
                    </TableCell>
                    
                    {/* Stage Dropdown */}
                    <TableCell className="py-2">
                      {agent.id === adminAgentId ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <Select
                          value={agent.onboardingStage || "onboarding"}
                          onValueChange={(value) => handleStageChange(agent.id, value)}
                          disabled={updatingStage === agent.id}
                        >
                          <SelectTrigger className="h-6 text-[10px] w-full">
                            {updatingStage === agent.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <SelectValue />
                            )}
                          </SelectTrigger>
                          <SelectContent>
                            {ONBOARDING_STAGES.map((stage) => (
                              <SelectItem key={stage.value} value={stage.value} className="text-xs">
                                {stage.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </TableCell>
                    
                    {/* Course Progress */}
                    <TableCell className="py-2">
                      {agent.id === adminAgentId ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : agent.courseProgress === 100 ? (
                        <Badge className="text-[10px] px-1 py-0 bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
                          ✓ Done
                        </Badge>
                      ) : agent.hasProgress ? (
                        <div className="flex items-center gap-1.5">
                          <Progress value={agent.courseProgress} className="h-1.5 w-12" />
                          <span className="text-[10px] text-muted-foreground">{agent.courseProgress}%</span>
                        </div>
                      ) : (
                        <AddToCourseButton
                          agentId={agent.id}
                          agentName={agent.name}
                          hasProgress={false}
                          onSuccess={fetchHierarchy}
                          size="sm"
                        />
                      )}
                    </TableCell>
                    
                    {/* Actions Menu */}
                    <TableCell className="py-2">
                      {agent.id !== adminAgentId && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-6 w-6">
                              <MoreVertical className="h-3 w-3" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setSelectedAgent(agent)}>
                              <Pencil className="h-3 w-3 mr-2" />
                              Edit Profile
                            </DropdownMenuItem>
                            <DropdownMenuItem 
                              onClick={() => handleSendLogin(agent.id, agent.email)}
                              disabled={sendingLoginTo === agent.id}
                            >
                              {sendingLoginTo === agent.id ? (
                                <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                              ) : (
                                <Mail className="h-3 w-3 mr-2" />
                              )}
                              Send Portal Login
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => {
                              // Pre-select this agent and open merge tool
                              setShowMergeTool(true);
                            }}>
                              <Merge className="h-3 w-3 mr-2" />
                              Merge with...
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem 
                              className="text-destructive focus:text-destructive"
                              onClick={() => setDeactivateAgent(agent)}
                            >
                              <UserX className="h-3 w-3 mr-2" />
                              Remove from Pipeline
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Summary */}
        <div className="mt-3 flex items-center justify-between text-[10px] text-muted-foreground">
          <span>{agents.length} total • {managers.length} managers</span>
        </div>
      </GlassCard>

      {/* Floating Action Bar for Bulk Actions */}
      <AnimatePresence>
        {selectedAgents.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50"
          >
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-card border shadow-lg">
              <span className="text-sm font-medium">
                {selectedAgents.size} selected
              </span>
              <div className="h-4 w-px bg-border" />
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedAgents(new Set())}
              >
                Clear
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setBulkDeleteType("soft");
                  setShowBulkDeleteDialog(true);
                }}
              >
                <UserX className="h-3.5 w-3.5 mr-1.5" />
                Soft Remove
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  setBulkDeleteType("hard");
                  setShowBulkDeleteDialog(true);
                }}
              >
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                Permanently Delete
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bulk Delete Confirmation Dialog */}
      <AlertDialog open={showBulkDeleteDialog} onOpenChange={setShowBulkDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {bulkDeleteType === "soft" ? "Soft Remove Agents" : "Permanently Delete Agents"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {bulkDeleteType === "soft" ? (
                <>
                  This will mark <strong>{selectedAgents.size}</strong> agent(s) as inactive. 
                  They will be hidden from the pipeline but their data will be preserved.
                </>
              ) : (
                <>
                  This will <strong className="text-destructive">permanently delete</strong> {selectedAgents.size} agent(s) 
                  and all their associated data (production, notes, progress, etc.). 
                  This action cannot be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isBulkDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkDelete}
              disabled={isBulkDeleting}
              className={bulkDeleteType === "hard" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}
            >
              {isBulkDeleting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              {bulkDeleteType === "soft" ? "Soft Remove" : "Permanently Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Agent Profile Editor Sheet */}
      <AgentProfileEditor
        agent={selectedAgent ? {
          id: selectedAgent.id,
          profileId: selectedAgent.profileId,
          fullName: selectedAgent.name,
          email: selectedAgent.email,
          phone: selectedAgent.phone,
          status: "active",
          isDeactivated: selectedAgent.isDeactivated,
          isInactive: selectedAgent.isInactive,
          totalAlp: 0,
          totalDeals: 0,
          closingRate: 0,
          hasCrmLink: false,
          lastActivity: null,
        } : null}
        open={!!selectedAgent}
        onClose={() => setSelectedAgent(null)}
        onUpdate={() => {
          fetchHierarchy();
          setSelectedAgent(null);
        }}
      />

      {/* Deactivate Agent Dialog */}
      <DeactivateAgentDialog
        open={!!deactivateAgent}
        onOpenChange={(open) => !open && setDeactivateAgent(null)}
        agentId={deactivateAgent?.id || ""}
        agentName={deactivateAgent?.name || ""}
        onComplete={() => {
          fetchHierarchy();
          setDeactivateAgent(null);
        }}
      />

      {/* Duplicate Merge Tool */}
      <DuplicateMergeTool
        open={showMergeTool}
        onClose={() => setShowMergeTool(false)}
        onMergeComplete={() => {
          fetchHierarchy();
          setShowMergeTool(false);
        }}
      />
    </>
  );
}
