import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Users,
  Phone,
  CheckCircle,
  TrendingUp,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { OnboardingTracker } from "./OnboardingTracker";
import { cn } from "@/lib/utils";

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
}

interface TeamStats {
  totalMembers: number;
  totalLeads: number;
  totalClosed: number;
  avgCloseRate: number;
}

export function ManagerTeamView() {
  const { user, isManager, isAdmin } = useAuth();
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [teamStats, setTeamStats] = useState<TeamStats>({
    totalMembers: 0,
    totalLeads: 0,
    totalClosed: 0,
    avgCloseRate: 0,
  });
  const [loading, setLoading] = useState(true);
  const [expandedMember, setExpandedMember] = useState<string | null>(null);

  useEffect(() => {
    fetchTeamData();
  }, [user]);

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

      // Fetch team members (agents invited by this manager)
      const { data: teamAgents, error } = await supabase
        .from("agents")
        .select(`
          id,
          user_id,
          status,
          onboarding_stage,
          created_at
        `)
        .eq("invited_by_manager_id", currentAgent.id);

      if (error) {
        console.error("Error fetching team:", error);
        setLoading(false);
        return;
      }

      if (!teamAgents || teamAgents.length === 0) {
        setLoading(false);
        return;
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
        .select("assigned_agent_id, status, contacted_at, closed_at")
        .in("assigned_agent_id", agentIds);

      // Build team member data
      const members: TeamMember[] = teamAgents.map(agent => {
        const profile = profiles?.find(p => p.user_id === agent.user_id);
        const agentApps = applications?.filter(a => a.assigned_agent_id === agent.id) || [];
        const totalLeads = agentApps.length;
        const contacted = agentApps.filter(a => a.contacted_at).length;
        const closed = agentApps.filter(a => a.closed_at).length;

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
        };
      });

      setTeamMembers(members);

      // Calculate team stats
      const totalLeads = members.reduce((sum, m) => sum + m.totalLeads, 0);
      const totalClosed = members.reduce((sum, m) => sum + m.closed, 0);
      setTeamStats({
        totalMembers: members.length,
        totalLeads,
        totalClosed,
        avgCloseRate: totalLeads > 0 ? (totalClosed / totalLeads) * 100 : 0,
      });
    } catch (err) {
      console.error("Error in fetchTeamData:", err);
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = (memberId: string) => {
    setExpandedMember(expandedMember === memberId ? null : memberId);
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <GlassCard className="p-4">
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
        <GlassCard className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Phone className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{teamStats.totalLeads}</p>
              <p className="text-xs text-muted-foreground">Total Leads</p>
            </div>
          </div>
        </GlassCard>
        <GlassCard className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/10">
              <CheckCircle className="h-5 w-5 text-emerald-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{teamStats.totalClosed}</p>
              <p className="text-xs text-muted-foreground">Total Closed</p>
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
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          Your Team ({teamMembers.length})
        </h3>

        <div className="space-y-3">
          {teamMembers.map((member, index) => (
            <motion.div
              key={member.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
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
                      <p className="font-medium">{member.name}</p>
                      <p className="text-xs text-muted-foreground">{member.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="hidden md:flex items-center gap-4 text-sm">
                      <span className="text-muted-foreground">
                        <span className="font-semibold text-foreground">{member.totalLeads}</span> leads
                      </span>
                      <span className="text-muted-foreground">
                        <span className="font-semibold text-foreground">{member.closed}</span> closed
                      </span>
                      <span className="text-muted-foreground">
                        <span className="font-semibold text-foreground">{member.closeRate.toFixed(0)}%</span> rate
                      </span>
                    </div>
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
                  <div className="grid grid-cols-3 gap-4 mb-4 md:hidden">
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
                  
                  <OnboardingTracker
                    agentId={member.id}
                    currentStage={member.onboardingStage as "onboarding" | "training_online" | "in_field_training" | "evaluated"}
                    onStageUpdate={fetchTeamData}
                  />
                </motion.div>
              )}
            </motion.div>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}
