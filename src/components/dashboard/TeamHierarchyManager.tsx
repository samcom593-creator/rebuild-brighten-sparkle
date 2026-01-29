import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Users, RefreshCw, AlertTriangle, Check, Loader2, Network, GraduationCap } from "lucide-react";
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
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { AddToCourseButton } from "./AddToCourseButton";

interface AgentHierarchyEntry {
  id: string;
  name: string;
  email: string;
  managerId: string | null;
  managerName: string | null;
  isManager: boolean;
  onboardingStage: string | null;
  hasProgress: boolean;
  courseProgress: number; // percentage 0-100
}

interface Manager {
  id: string;
  name: string;
}

export function TeamHierarchyManager() {
  const { user } = useAuth();
  const [agents, setAgents] = useState<AgentHierarchyEntry[]>([]);
  const [managers, setManagers] = useState<Manager[]>([]);
  const [adminAgentId, setAdminAgentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [filterManager, setFilterManager] = useState<string>("all");

  useEffect(() => {
    fetchHierarchy();
  }, [user]);

  const fetchHierarchy = async () => {
    if (!user) return;
    setLoading(true);

    try {
      // Get current user's agent ID (admin)
      const { data: currentAgent } = await supabase
        .from("agents")
        .select("id")
        .eq("user_id", user.id)
        .eq("is_deactivated", false)
        .maybeSingle();

      if (currentAgent) {
        setAdminAgentId(currentAgent.id);
      }

      // Get all active agents with their managers
      const { data: agentsData, error: agentsError } = await supabase
        .from("agents")
        .select("id, user_id, invited_by_manager_id, onboarding_stage")
        .eq("is_deactivated", false)
        .order("created_at", { ascending: true });

      if (agentsError) throw agentsError;

      if (!agentsData || agentsData.length === 0) {
        setAgents([]);
        setManagers([]);
        setLoading(false);
        return;
      }

      // Get all user_ids for profile lookup
      const userIds = agentsData.map(a => a.user_id).filter(Boolean);
      
      // Fetch profiles, manager roles, and course progress in parallel
      const [profilesResult, managerRolesResult, progressResult, modulesResult] = await Promise.all([
        supabase.from("profiles").select("user_id, full_name, email").in("user_id", userIds),
        supabase.from("user_roles").select("user_id").in("role", ["manager", "admin"]),
        supabase.from("onboarding_progress").select("agent_id, passed"),
        supabase.from("onboarding_modules").select("id").eq("is_active", true),
      ]);

      const profiles = profilesResult.data || [];
      const managerUserIds = new Set(managerRolesResult.data?.map(r => r.user_id) || []);
      const progressData = progressResult.data || [];
      const totalModules = modulesResult.data?.length || 1;

      // Calculate progress per agent
      const agentProgressMap = new Map<string, { hasProgress: boolean; passedCount: number }>();
      progressData.forEach(p => {
        const existing = agentProgressMap.get(p.agent_id) || { hasProgress: false, passedCount: 0 };
        agentProgressMap.set(p.agent_id, {
          hasProgress: true,
          passedCount: existing.passedCount + (p.passed ? 1 : 0),
        });
      });

      // Build agent hierarchy entries
      const agentEntries: AgentHierarchyEntry[] = agentsData.map(agent => {
        const profile = profiles?.find(p => p.user_id === agent.user_id);
        const isManager = managerUserIds.has(agent.user_id || "");
        const progressInfo = agentProgressMap.get(agent.id);
        
        // Find manager's name
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
          name: profile?.full_name || "Unknown",
          email: profile?.email || "",
          managerId: agent.invited_by_manager_id,
          managerName,
          isManager,
          onboardingStage: agent.onboarding_stage,
          hasProgress: progressInfo?.hasProgress || false,
          courseProgress: progressInfo 
            ? Math.round((progressInfo.passedCount / totalModules) * 100) 
            : 0,
        };
      });

      // Build managers list for dropdown
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

  const handleAssignAllToMe = async () => {
    if (!adminAgentId) {
      toast.error("Could not find your admin agent record");
      return;
    }

    setBulkUpdating(true);

    try {
      // Update all agents except admin to report to admin
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

  // Filter agents based on selected manager
  const filteredAgents = filterManager === "all" 
    ? agents 
    : filterManager === "orphaned"
    ? agents.filter(a => !a.managerId && a.id !== adminAgentId)
    : agents.filter(a => a.managerId === filterManager);

  // Count orphaned agents (no manager, excluding admin)
  const orphanedCount = agents.filter(a => !a.managerId && a.id !== adminAgentId).length;

  // Count agents not directly under admin
  const indirectReports = agents.filter(a => {
    if (a.id === adminAgentId) return false;
    if (!a.managerId) return false;
    return a.managerId !== adminAgentId;
  }).length;

  if (loading) {
    return (
      <GlassCard className="p-6">
        <div className="flex items-center justify-center gap-2 py-8">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <span className="text-muted-foreground">Loading hierarchy...</span>
        </div>
      </GlassCard>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
    >
      <GlassCard className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Network className="h-5 w-5 text-primary" />
            <h3 className="font-semibold">Team Hierarchy Manager</h3>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={fetchHierarchy}
              disabled={loading}
            >
              <RefreshCw className={cn("h-4 w-4 mr-1", loading && "animate-spin")} />
              Refresh
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={handleAssignAllToMe}
              disabled={bulkUpdating || !adminAgentId}
            >
              {bulkUpdating ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Users className="h-4 w-4 mr-1" />
              )}
              Assign All to Me
            </Button>
          </div>
        </div>

        {/* Alerts */}
        {(orphanedCount > 0 || indirectReports > 0) && (
          <div className="mb-4 space-y-2">
            {orphanedCount > 0 && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-sm">
                <AlertTriangle className="h-4 w-4" />
                <span>{orphanedCount} agent{orphanedCount > 1 ? 's' : ''} with no manager assigned</span>
              </div>
            )}
            {indirectReports > 0 && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400 text-sm">
                <Users className="h-4 w-4" />
                <span>{indirectReports} agent{indirectReports > 1 ? 's' : ''} report to sub-managers</span>
              </div>
            )}
          </div>
        )}

        {/* Filter */}
        <div className="flex items-center gap-3 mb-4">
          <span className="text-sm text-muted-foreground">Filter by:</span>
          <Select value={filterManager} onValueChange={setFilterManager}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="All agents" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Agents ({agents.length})</SelectItem>
              <SelectItem value="orphaned">
                ⚠️ No Manager ({orphanedCount})
              </SelectItem>
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
              <TableHead>Agent</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead className="w-32">Course</TableHead>
              <TableHead className="w-48">Reports To</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredAgents.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  No agents found
                </TableCell>
              </TableRow>
              ) : (
                filteredAgents.map((agent) => (
                  <TableRow 
                    key={agent.id}
                    className={cn(
                      agent.id === adminAgentId && "bg-primary/5"
                    )}
                  >
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {agent.name}
                        {agent.isManager && (
                          <Badge variant="secondary" className="text-xs">
                            Manager
                          </Badge>
                        )}
                        {agent.id === adminAgentId && (
                          <Badge className="text-xs bg-primary/20 text-primary border-primary/30">
                            You
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {agent.email}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs capitalize">
                        {agent.onboardingStage?.replace(/_/g, " ") || "N/A"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {agent.id === adminAgentId ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : agent.courseProgress === 100 ? (
                        <Badge className="bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
                          ✓ Complete
                        </Badge>
                      ) : agent.hasProgress ? (
                        <div className="flex items-center gap-2">
                          <Progress value={agent.courseProgress} className="h-2 w-16" />
                          <span className="text-xs text-muted-foreground">{agent.courseProgress}%</span>
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
                    <TableCell>
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
                          <SelectTrigger className="w-full h-8 text-xs">
                            {updating === agent.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <SelectValue placeholder="Select manager" />
                            )}
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">
                              <span className="text-muted-foreground">No Manager</span>
                            </SelectItem>
                            {managers
                              .filter(m => m.id !== agent.id)
                              .map((manager) => (
                                <SelectItem key={manager.id} value={manager.id}>
                                  <div className="flex items-center gap-2">
                                    {manager.name}
                                    {manager.id === adminAgentId && (
                                      <span className="text-xs text-primary">(You)</span>
                                    )}
                                  </div>
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Summary */}
        <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
          <span>{agents.length} total agents • {managers.length} managers</span>
          {adminAgentId && (
            <span className="text-primary">
              Your Agent ID: {adminAgentId.slice(0, 8)}...
            </span>
          )}
        </div>
      </GlassCard>
    </motion.div>
  );
}
