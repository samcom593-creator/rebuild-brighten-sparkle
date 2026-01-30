import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Users,
  TrendingUp,
  Search,
  BarChart3,
  Shield,
  Trophy,
  UserCheck,
  Clock,
  CheckCircle,
  XCircle,
  Wifi,
  WifiOff,
  UserMinus,
  RotateCcw,
  ChevronDown,
  FileText,
  AlertCircle,
  Package,
} from "lucide-react";
import { ConfettiCelebration } from "@/components/dashboard/ConfettiCelebration";
import { useSoundEffects } from "@/hooks/useSoundEffects";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ManagerInviteLinks } from "@/components/dashboard/ManagerInviteLinks";
import { AdminManagerInvites } from "@/components/dashboard/AdminManagerInvites";
import { LeadReassignment } from "@/components/dashboard/LeadReassignment";
import { LeadExporter } from "@/components/dashboard/LeadExporter";
import { LeadImporter } from "@/components/dashboard/LeadImporter";
import { BulkLeadAssignment } from "@/components/dashboard/BulkLeadAssignment";
import { AbandonedLeadsPanel } from "@/components/dashboard/AbandonedLeadsPanel";
import { AllLeadsPanel } from "@/components/dashboard/AllLeadsPanel";
import { TerminatedAgentLeadsPanel } from "@/components/dashboard/TerminatedAgentLeadsPanel";
import { TeamHierarchyManager } from "@/components/dashboard/TeamHierarchyManager";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { Navigate } from "react-router-dom";
import { toast } from "sonner";

interface PendingAgent {
  id: string;
  userId: string;
  name: string;
  email: string;
  createdAt: string;
}

interface InactiveAgent {
  id: string;
  name: string;
  email: string;
  deactivatedAt: string;
}

interface TeamOverview {
  totalAgents: number;
  totalLeads: number;
  totalClosed: number;
  teamCloseRate: number;
  pendingAgents: number;
  inactiveAgents: number;
}

export default function DashboardAdmin() {
  const { isAdmin, isManager, isLoading: authLoading, user } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [pendingAgents, setPendingAgents] = useState<PendingAgent[]>([]);
  const [teamOverview, setTeamOverview] = useState<TeamOverview>({
    totalAgents: 0,
    totalLeads: 0,
    totalClosed: 0,
    teamCloseRate: 0,
    pendingAgents: 0,
    inactiveAgents: 0,
  });
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false);
  const [inactiveAgents, setInactiveAgents] = useState<InactiveAgent[]>([]);
  const [reactivatingId, setReactivatingId] = useState<string | null>(null);
  const [showReactivateConfetti, setShowReactivateConfetti] = useState(false);
  const { playSound } = useSoundEffects();
  
  // Collapsible states - default collapsed
  const [showInactive, setShowInactive] = useState(false);
  const [showTerminated, setShowTerminated] = useState(false);
  const [showAbandoned, setShowAbandoned] = useState(false);
  const [showAllLeads, setShowAllLeads] = useState(false);

  useEffect(() => {
    fetchAdminData();
    fetchPendingAgents();
    fetchInactiveAgents();

    // Set up real-time subscriptions for agents
    const agentsChannel = supabase
      .channel('admin-agents-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'agents',
        },
        (payload) => {
          console.log('Agent change received:', payload);
          fetchPendingAgents();
          fetchInactiveAgents();
          fetchAdminData();
          
          if (payload.eventType === 'INSERT') {
            toast.info('New agent registration received!', {
              description: 'Check the pending approvals section.',
            });
          }
        }
      )
      .subscribe((status) => {
        setIsRealtimeConnected(status === 'SUBSCRIBED');
      });

    // Set up real-time subscriptions for applications
    const applicationsChannel = supabase
      .channel('admin-applications-changes')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'applications',
        },
        (payload) => {
          console.log('New application received:', payload);
          fetchAdminData();
          
          const newApp = payload.new as { first_name?: string; last_name?: string };
          toast.success('New application received!', {
            description: `${newApp.first_name} ${newApp.last_name} just applied.`,
          });
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'applications',
        },
        () => {
          fetchAdminData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(agentsChannel);
      supabase.removeChannel(applicationsChannel);
    };
  }, []);

  const fetchPendingAgents = async () => {
    const { data: pendingByUserId } = await supabase
      .from("agents")
      .select("id, user_id, created_at")
      .eq("status", "pending");

    if (pendingByUserId && pendingByUserId.length > 0) {
      const userIds = pendingByUserId.map(a => a.user_id).filter(Boolean);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name, email")
        .in("user_id", userIds);

      const pending = pendingByUserId.map(agent => {
        const profile = profiles?.find(p => p.user_id === agent.user_id);
        return {
          id: agent.id,
          userId: agent.user_id || "",
          name: profile?.full_name || "Unknown",
          email: profile?.email || "Unknown",
          createdAt: agent.created_at,
        };
      });

      setPendingAgents(pending);
      setTeamOverview(prev => ({ ...prev, pendingAgents: pending.length }));
    } else {
      setPendingAgents([]);
      setTeamOverview(prev => ({ ...prev, pendingAgents: 0 }));
    }
  };

  const fetchInactiveAgents = async () => {
    const { data: inactiveData, error } = await supabase
      .from("agents")
      .select("id, user_id, updated_at")
      .eq("is_inactive", true)
      .order("updated_at", { ascending: false });

    if (error) {
      console.error("Error fetching inactive agents:", error);
      return;
    }

    if (!inactiveData || inactiveData.length === 0) {
      setInactiveAgents([]);
      setTeamOverview(prev => ({ ...prev, inactiveAgents: 0 }));
      return;
    }

    const userIds = inactiveData.map(a => a.user_id).filter(Boolean);
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, full_name, email")
      .in("user_id", userIds);

    const inactive: InactiveAgent[] = inactiveData.map(agent => {
      const profile = profiles?.find(p => p.user_id === agent.user_id);
      return {
        id: agent.id,
        name: profile?.full_name || "Unknown",
        email: profile?.email || "Unknown",
        deactivatedAt: agent.updated_at,
      };
    });

    setInactiveAgents(inactive);
    setTeamOverview(prev => ({ ...prev, inactiveAgents: inactive.length }));
  };

  const handleReactivateAgent = async (agentId: string, agentName: string) => {
    setReactivatingId(agentId);
    playSound("click");

    try {
      const { error } = await supabase
        .from("agents")
        .update({ is_inactive: false })
        .eq("id", agentId);

      if (error) throw error;

      setShowReactivateConfetti(true);
      playSound("celebrate");

      toast.success(`🎉 ${agentName} is back in action!`, {
        description: "Agent has been reactivated and will appear in the CRM.",
      });
      fetchInactiveAgents();
      fetchAdminData();
    } catch (error: any) {
      console.error("Error reactivating agent:", error);
      playSound("error");
      toast.error("Failed to reactivate agent");
    } finally {
      setReactivatingId(null);
    }
  };

  const handleApproveAgent = async (agentId: string) => {
    if (!user) return;
    setApprovingId(agentId);

    try {
      const { error } = await supabase
        .from("agents")
        .update({
          status: "active",
          verified_at: new Date().toISOString(),
          verified_by: user.id,
        })
        .eq("id", agentId);

      if (error) throw error;

      toast.success("Agent approved successfully!");
      fetchPendingAgents();
      fetchAdminData();
    } catch (error: any) {
      console.error("Error approving agent:", error);
      toast.error("Failed to approve agent");
    } finally {
      setApprovingId(null);
    }
  };

  const handleRejectAgent = async (agentId: string) => {
    setApprovingId(agentId);

    try {
      const { error } = await supabase
        .from("agents")
        .update({ status: "terminated" })
        .eq("id", agentId);

      if (error) throw error;

      toast.success("Agent rejected");
      fetchPendingAgents();
    } catch (error: any) {
      console.error("Error rejecting agent:", error);
      toast.error("Failed to reject agent");
    } finally {
      setApprovingId(null);
    }
  };

  const fetchAdminData = async () => {
    const { data: activeAgents } = await supabase
      .from("agents")
      .select("id, user_id")
      .eq("status", "active");

    if (!activeAgents || activeAgents.length === 0) {
      setTeamOverview(prev => ({
        ...prev,
        totalAgents: 0,
        totalLeads: 0,
        totalClosed: 0,
        teamCloseRate: 0,
        inactiveAgents: prev.inactiveAgents,
      }));
      return;
    }

    const { data: allApplications } = await supabase
      .from("applications")
      .select("id, assigned_agent_id, closed_at");

    const totalLeads = allApplications?.length || 0;
    const totalClosed = allApplications?.filter(a => a.closed_at).length || 0;

    setTeamOverview(prev => ({
      ...prev,
      totalAgents: activeAgents.length,
      totalLeads,
      totalClosed,
      teamCloseRate: totalLeads > 0 ? (totalClosed / totalLeads) * 100 : 0,
    }));
  };

  if (authLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </DashboardLayout>
    );
  }

  if (!isAdmin && !isManager) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <DashboardLayout>
      <ConfettiCelebration 
        trigger={showReactivateConfetti} 
        onComplete={() => setShowReactivateConfetti(false)} 
      />
      
      {/* Header - Compact */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-4"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Shield className="h-5 w-5 text-primary" />
            <h1 className="text-2xl font-bold">Admin Panel</h1>
          </div>
          <div className="flex items-center gap-2">
            <LeadImporter />
            <LeadExporter />
            <div className={cn(
              "flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium",
              isRealtimeConnected 
                ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400" 
                : "bg-amber-500/20 text-amber-600 dark:text-amber-400"
            )}>
              {isRealtimeConnected ? (
                <>
                  <Wifi className="h-3 w-3" />
                  Live
                </>
              ) : (
                <>
                  <WifiOff className="h-3 w-3" />
                  ...
                </>
              )}
            </div>
          </div>
        </div>
      </motion.div>

      {/* Team Overview Stats - Compact */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4"
      >
        {[
          { label: "Active Agents", value: teamOverview.totalAgents, icon: Users, color: "text-primary" },
          { label: "Pending", value: teamOverview.pendingAgents, icon: Clock, color: "text-amber-500" },
          { label: "Total Leads", value: teamOverview.totalLeads, icon: BarChart3, color: "text-blue-500" },
          { label: "Closed", value: teamOverview.totalClosed, icon: Trophy, color: "text-emerald-500" },
          { label: "Close Rate", value: `${teamOverview.teamCloseRate.toFixed(1)}%`, icon: TrendingUp, color: "text-primary" },
        ].map((stat) => (
          <GlassCard key={stat.label} className="p-3">
            <div className="flex items-center gap-2">
              <stat.icon className={cn("h-4 w-4", stat.color)} />
              <div>
                <p className={cn("text-lg font-bold", stat.color)}>{stat.value}</p>
                <p className="text-[10px] text-muted-foreground">{stat.label}</p>
              </div>
            </div>
          </GlassCard>
        ))}
      </motion.div>

      {/* Pending Agents Approval Section */}
      {pendingAgents.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="mb-4"
        >
          <GlassCard className="p-4 border-2 border-amber-500/30 bg-amber-500/5">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber-500" />
              Pending Agent Approvals
              <Badge variant="outline" className="bg-amber-500/20 text-amber-600 border-amber-500/30 text-xs">
                {pendingAgents.length}
              </Badge>
            </h3>
            <div className="space-y-2">
              {pendingAgents.map((agent) => (
                <div
                  key={agent.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-background/50 border border-border"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                      <UserCheck className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{agent.name}</p>
                      <p className="text-xs text-muted-foreground">{agent.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground mr-2">
                      {new Date(agent.createdAt).toLocaleDateString()}
                    </span>
                    <Button
                      size="sm"
                      onClick={() => handleApproveAgent(agent.id)}
                      disabled={approvingId === agent.id}
                      className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700"
                    >
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleRejectAgent(agent.id)}
                      disabled={approvingId === agent.id}
                      className="h-7 text-xs border-red-500/30 text-red-500 hover:bg-red-500/10"
                    >
                      <XCircle className="h-3 w-3 mr-1" />
                      Reject
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </GlassCard>
        </motion.div>
      )}

      {/* Team Hierarchy Manager - Primary Section */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="mb-4"
      >
        <TeamHierarchyManager />
      </motion.div>

      {/* Manager Account Invites */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="mb-4"
      >
        <AdminManagerInvites />
      </motion.div>

      {/* Bulk Lead Assignment */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
        className="mb-4"
      >
        <BulkLeadAssignment />
      </motion.div>

      {/* Manager Invite Links & Lead Reassignment */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <ManagerInviteLinks />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
        >
          <LeadReassignment />
        </motion.div>
      </div>

      {/* Collapsible Bottom Sections */}
      <div className="space-y-3">
        {/* Inactive Agents - Collapsible */}
        {inactiveAgents.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
          >
            <Collapsible open={showInactive} onOpenChange={setShowInactive}>
              <GlassCard className="overflow-hidden">
                <CollapsibleTrigger className="w-full">
                  <div className="flex items-center justify-between p-3 hover:bg-muted/30 transition-colors cursor-pointer">
                    <div className="flex items-center gap-2">
                      <UserMinus className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium text-sm">Inactive Agents</span>
                      <Badge variant="outline" className="text-xs">{inactiveAgents.length}</Badge>
                    </div>
                    <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", showInactive && "rotate-180")} />
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="p-3 pt-0 space-y-2">
                    {inactiveAgents.map((agent) => (
                      <div
                        key={agent.id}
                        className="flex items-center justify-between p-3 rounded-lg bg-background/50 border border-border"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                            <UserMinus className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <div>
                            <p className="font-medium text-sm">{agent.name}</p>
                            <p className="text-xs text-muted-foreground">{agent.email}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-muted-foreground">
                            {new Date(agent.deactivatedAt).toLocaleDateString()}
                          </span>
                          <Button
                            size="sm"
                            onClick={() => handleReactivateAgent(agent.id, agent.name)}
                            disabled={reactivatingId === agent.id}
                            className="h-7 text-xs"
                          >
                            <RotateCcw className="h-3 w-3 mr-1" />
                            {reactivatingId === agent.id ? "..." : "Reactivate"}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CollapsibleContent>
              </GlassCard>
            </Collapsible>
          </motion.div>
        )}

        {/* Terminated Agent Leads - Collapsible */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45 }}
        >
          <Collapsible open={showTerminated} onOpenChange={setShowTerminated}>
            <GlassCard className="overflow-hidden">
              <CollapsibleTrigger className="w-full">
                <div className="flex items-center justify-between p-3 hover:bg-muted/30 transition-colors cursor-pointer">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium text-sm">Terminated Agent Leads</span>
                  </div>
                  <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", showTerminated && "rotate-180")} />
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="p-3 pt-0">
                  <TerminatedAgentLeadsPanel />
                </div>
              </CollapsibleContent>
            </GlassCard>
          </Collapsible>
        </motion.div>

        {/* Abandoned Applications - Collapsible */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
        >
          <Collapsible open={showAbandoned} onOpenChange={setShowAbandoned}>
            <GlassCard className="overflow-hidden">
              <CollapsibleTrigger className="w-full">
                <div className="flex items-center justify-between p-3 hover:bg-muted/30 transition-colors cursor-pointer">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium text-sm">Abandoned Applications</span>
                  </div>
                  <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", showAbandoned && "rotate-180")} />
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="p-3 pt-0">
                  <AbandonedLeadsPanel />
                </div>
              </CollapsibleContent>
            </GlassCard>
          </Collapsible>
        </motion.div>

        {/* All Leads - Collapsible */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.55 }}
        >
          <Collapsible open={showAllLeads} onOpenChange={setShowAllLeads}>
            <GlassCard className="overflow-hidden">
              <CollapsibleTrigger className="w-full">
                <div className="flex items-center justify-between p-3 hover:bg-muted/30 transition-colors cursor-pointer">
                  <div className="flex items-center gap-2">
                    <Package className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium text-sm">All Leads</span>
                  </div>
                  <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", showAllLeads && "rotate-180")} />
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="p-3 pt-0">
                  <AllLeadsPanel />
                </div>
              </CollapsibleContent>
            </GlassCard>
          </Collapsible>
        </motion.div>
      </div>
    </DashboardLayout>
  );
}
