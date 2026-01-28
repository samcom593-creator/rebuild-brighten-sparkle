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
import { OnboardingTracker } from "./OnboardingTracker";
import { cn } from "@/lib/utils";
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from "date-fns";

type SortOption = "production-desc" | "production-asc" | "name" | "status";

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
  const [sortBy, setSortBy] = useState<SortOption>("production-desc");

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

      // Build team member data
      const members: TeamMember[] = teamAgents.map(agent => {
        const profile = profiles?.find(p => p.user_id === agent.user_id);
        const agentApps = applications?.filter(a => a.assigned_agent_id === agent.id) || [];
        const totalLeads = agentApps.length;
        const contacted = agentApps.filter(a => a.contacted_at).length;
        const closed = agentApps.filter(a => a.closed_at).length;

        // Calculate production
        const agentWeekProduction = weekProduction?.filter(p => p.agent_id === agent.id) || [];
        const agentMonthProduction = monthProduction?.filter(p => p.agent_id === agent.id) || [];

        const weekALP = agentWeekProduction.reduce((sum, p) => sum + (Number(p.aop) || 0), 0);
        const monthALP = agentMonthProduction.reduce((sum, p) => sum + (Number(p.aop) || 0), 0);
        const monthDeals = agentMonthProduction.reduce((sum, p) => sum + (p.deals_closed || 0), 0);

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

  // Sorted team members
  const sortedMembers = useMemo(() => {
    const sorted = [...teamMembers];
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
  }, [teamMembers, sortBy]);

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
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            Your Team ({teamMembers.length})
          </h3>
          
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

        <div className="space-y-3">
          {sortedMembers.map((member, index) => (
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
