import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Users, RefreshCw, AlertTriangle, Loader2, Network, MoreVertical, Pencil, UserX } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
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
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { AddToCourseButton } from "./AddToCourseButton";
import { AgentProfileEditor } from "@/components/admin/AgentProfileEditor";
import { DeactivateAgentDialog } from "./DeactivateAgentDialog";

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
  
  // Editor states
  const [selectedAgent, setSelectedAgent] = useState<AgentHierarchyEntry | null>(null);
  const [deactivateAgent, setDeactivateAgent] = useState<AgentHierarchyEntry | null>(null);

  useEffect(() => {
    fetchHierarchy();
  }, [user]);

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
      
      const [profilesResult, managerRolesResult, progressResult, modulesResult] = await Promise.all([
        supabase.from("profiles").select("user_id, full_name, email, phone").in("user_id", userIds),
        supabase.from("user_roles").select("user_id").in("role", ["manager", "admin"]),
        supabase.from("onboarding_progress").select("agent_id, passed"),
        supabase.from("onboarding_modules").select("id").eq("is_active", true),
      ]);

      const profiles = profilesResult.data || [];
      const managerUserIds = new Set(managerRolesResult.data?.map(r => r.user_id) || []);
      const progressData = progressResult.data || [];
      const totalModules = modulesResult.data?.length || 1;

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
        };
      });

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
      toast.success(`${agentName}'s stage updated to ${newStage.replace(/_/g, " ")}`);
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

  const filteredAgents = filterManager === "all" 
    ? agents 
    : filterManager === "orphaned"
    ? agents.filter(a => !a.managerId && a.id !== adminAgentId)
    : agents.filter(a => a.managerId === filterManager);

  const orphanedCount = agents.filter(a => !a.managerId && a.id !== adminAgentId).length;
  const indirectReports = agents.filter(a => {
    if (a.id === adminAgentId) return false;
    if (!a.managerId) return false;
    return a.managerId !== adminAgentId;
  }).length;

  if (loading) {
    return (
      <GlassCard className="p-4">
        <div className="flex items-center justify-center gap-2 py-6">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">Loading hierarchy...</span>
        </div>
      </GlassCard>
    );
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
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
                <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400 text-xs">
                  <Users className="h-3 w-3" />
                  <span>{indirectReports} under sub-managers</span>
                </div>
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

          {/* Agents Table */}
          <div className="rounded-lg border bg-card/50 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="text-xs">Agent</TableHead>
                  <TableHead className="text-xs">Email</TableHead>
                  <TableHead className="text-xs w-36">Stage</TableHead>
                  <TableHead className="text-xs w-28">Course</TableHead>
                  <TableHead className="text-xs w-40">Reports To</TableHead>
                  <TableHead className="text-xs w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAgents.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-6 text-muted-foreground text-sm">
                      No agents found
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredAgents.map((agent) => (
                    <TableRow 
                      key={agent.id}
                      className={cn(
                        "hover:bg-muted/20",
                        agent.id === adminAgentId && "bg-primary/5"
                      )}
                    >
                      <TableCell className="py-2">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-sm">{agent.name}</span>
                          {agent.isManager && (
                            <Badge variant="secondary" className="text-[10px] px-1 py-0">MGR</Badge>
                          )}
                          {agent.id === adminAgentId && (
                            <Badge className="text-[10px] px-1 py-0 bg-primary/20 text-primary border-primary/30">You</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs py-2">
                        {agent.email}
                      </TableCell>
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
                      <TableCell className="py-2">
                        {agent.id === adminAgentId ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          <Select
                            value={agent.managerId || "none"}
                            onValueChange={(value) => 
                              handleReassign(agent.id, value === "none" ? null : value)
                            }
                            disabled={updating === agent.id}
                          >
                            <SelectTrigger className="w-full h-6 text-[10px]">
                              {updating === agent.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <SelectValue placeholder="Select" />
                              )}
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none" className="text-xs">
                                <span className="text-muted-foreground">No Manager</span>
                              </SelectItem>
                              {managers
                                .filter(m => m.id !== agent.id)
                                .map((manager) => (
                                  <SelectItem key={manager.id} value={manager.id} className="text-xs">
                                    {manager.name}
                                    {manager.id === adminAgentId && " (You)"}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        )}
                      </TableCell>
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
      </motion.div>

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
    </>
  );
}
