import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Users,
  TrendingUp,
  AlertTriangle,
  Clock,
  Search,
  Eye,
  BarChart3,
  Shield,
  Trophy,
  ChevronRight,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LeaderboardCard } from "@/components/dashboard/LeaderboardCard";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { Navigate } from "react-router-dom";

interface AgentStats {
  id: string;
  name: string;
  email: string;
  totalLeads: number;
  contacted: number;
  qualified: number;
  closed: number;
  closeRate: number;
  staleLeads: number;
  lastActive: string;
}

interface TeamOverview {
  totalAgents: number;
  totalLeads: number;
  totalClosed: number;
  teamCloseRate: number;
}

export default function DashboardAdmin() {
  const { isAdmin, isManager, isLoading: authLoading } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [agents, setAgents] = useState<AgentStats[]>([]);
  const [teamOverview, setTeamOverview] = useState<TeamOverview>({
    totalAgents: 0,
    totalLeads: 0,
    totalClosed: 0,
    teamCloseRate: 0,
  });
  const [needsAttention, setNeedsAttention] = useState<AgentStats[]>([]);
  const [fastestGrowers, setFastestGrowers] = useState<{ rank: number; name: string; value: number }[]>([]);

  useEffect(() => {
    fetchAdminData();
  }, []);

  const fetchAdminData = async () => {
    // Demo data for admin panel
    const demoAgents: AgentStats[] = [
      {
        id: "1",
        name: "Marcus Thompson",
        email: "marcus.t@apex.com",
        totalLeads: 78,
        contacted: 65,
        qualified: 42,
        closed: 22,
        closeRate: 28.2,
        staleLeads: 2,
        lastActive: "2 hours ago",
      },
      {
        id: "2",
        name: "Sarah Kim",
        email: "sarah.k@apex.com",
        totalLeads: 65,
        contacted: 58,
        qualified: 38,
        closed: 24,
        closeRate: 36.9,
        staleLeads: 0,
        lastActive: "30 minutes ago",
      },
      {
        id: "3",
        name: "Jessica Rodriguez",
        email: "jessica.r@apex.com",
        totalLeads: 42,
        contacted: 35,
        qualified: 18,
        closed: 10,
        closeRate: 23.8,
        staleLeads: 5,
        lastActive: "1 day ago",
      },
      {
        id: "4",
        name: "David Chen",
        email: "david.c@apex.com",
        totalLeads: 38,
        contacted: 28,
        qualified: 15,
        closed: 8,
        closeRate: 21.1,
        staleLeads: 8,
        lastActive: "3 days ago",
      },
      {
        id: "5",
        name: "Emily Watson",
        email: "emily.w@apex.com",
        totalLeads: 55,
        contacted: 48,
        qualified: 28,
        closed: 15,
        closeRate: 27.3,
        staleLeads: 3,
        lastActive: "5 hours ago",
      },
    ];

    setAgents(demoAgents);

    // Calculate team overview
    const totalLeads = demoAgents.reduce((sum, a) => sum + a.totalLeads, 0);
    const totalClosed = demoAgents.reduce((sum, a) => sum + a.closed, 0);
    setTeamOverview({
      totalAgents: demoAgents.length,
      totalLeads,
      totalClosed,
      teamCloseRate: totalLeads > 0 ? (totalClosed / totalLeads) * 100 : 0,
    });

    // Agents needing attention (low close rate or many stale leads)
    setNeedsAttention(
      demoAgents
        .filter(a => a.closeRate < 25 || a.staleLeads > 3)
        .sort((a, b) => a.closeRate - b.closeRate)
    );

    // Fastest growers (by close rate for demo)
    setFastestGrowers(
      demoAgents
        .sort((a, b) => b.closeRate - a.closeRate)
        .map((a, i) => ({
          rank: i + 1,
          name: a.name,
          value: Math.round(a.closeRate * 10) / 10,
        }))
        .slice(0, 5)
    );
  };

  const filteredAgents = agents.filter(
    (agent) =>
      agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      agent.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Access control check
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
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <div className="flex items-center gap-2 mb-2">
          <Shield className="h-6 w-6 text-primary" />
          <h1 className="text-3xl font-bold">Admin Panel</h1>
        </div>
        <p className="text-muted-foreground">
          Oversee team performance and manage all agents
        </p>
      </motion.div>

      {/* Team Overview */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8"
      >
        {[
          { label: "Total Agents", value: teamOverview.totalAgents, icon: Users, color: "text-primary" },
          { label: "Total Leads", value: teamOverview.totalLeads, icon: BarChart3, color: "text-blue-400" },
          { label: "Total Closed", value: teamOverview.totalClosed, icon: Trophy, color: "text-emerald-400" },
          { label: "Team Close Rate", value: `${teamOverview.teamCloseRate.toFixed(1)}%`, icon: TrendingUp, color: "text-primary" },
        ].map((stat) => (
          <GlassCard key={stat.label} className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-muted">
                <stat.icon className={cn("h-5 w-5", stat.color)} />
              </div>
              <div>
                <p className={cn("text-2xl font-bold", stat.color)}>{stat.value}</p>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
              </div>
            </div>
          </GlassCard>
        ))}
      </motion.div>

      {/* Search */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="mb-6"
      >
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search agents..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 bg-input"
          />
        </div>
      </motion.div>

      {/* Agent Management Table */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="mb-8"
      >
        <GlassCard className="p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            Agent Management
          </h3>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead className="text-center">Leads</TableHead>
                  <TableHead className="text-center">Contacted</TableHead>
                  <TableHead className="text-center">Qualified</TableHead>
                  <TableHead className="text-center">Closed</TableHead>
                  <TableHead className="text-center">Close Rate</TableHead>
                  <TableHead className="text-center">Stale</TableHead>
                  <TableHead>Last Active</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAgents.map((agent) => (
                  <TableRow key={agent.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{agent.name}</p>
                        <p className="text-xs text-muted-foreground">{agent.email}</p>
                      </div>
                    </TableCell>
                    <TableCell className="text-center font-medium">{agent.totalLeads}</TableCell>
                    <TableCell className="text-center">{agent.contacted}</TableCell>
                    <TableCell className="text-center">{agent.qualified}</TableCell>
                    <TableCell className="text-center font-medium text-emerald-400">{agent.closed}</TableCell>
                    <TableCell className="text-center">
                      <Badge 
                        variant="outline" 
                        className={cn(
                          agent.closeRate >= 30 
                            ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                            : agent.closeRate >= 20
                            ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
                            : "bg-red-500/20 text-red-400 border-red-500/30"
                        )}
                      >
                        {agent.closeRate.toFixed(1)}%
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      {agent.staleLeads > 0 ? (
                        <Badge variant="outline" className="bg-amber-500/20 text-amber-400 border-amber-500/30">
                          {agent.staleLeads}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{agent.lastActive}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm">
                        <Eye className="h-4 w-4 mr-1" />
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </GlassCard>
      </motion.div>

      {/* Bottom Row: Needs Attention + Fastest Growers */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Needs Attention */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <GlassCard className="p-6">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-400" />
              Needs Attention
            </h3>
            <div className="space-y-3">
              {needsAttention.length === 0 ? (
                <p className="text-muted-foreground text-sm">All agents are performing well!</p>
              ) : (
                needsAttention.map((agent) => (
                  <div
                    key={agent.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-amber-500/10 border border-amber-500/20"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-full bg-amber-500/20">
                        <AlertTriangle className="h-4 w-4 text-amber-400" />
                      </div>
                      <div>
                        <p className="font-medium">{agent.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {agent.staleLeads > 3 
                            ? `${agent.staleLeads} stale leads` 
                            : `Close rate: ${agent.closeRate.toFixed(1)}%`}
                        </p>
                      </div>
                    </div>
                    <Button variant="ghost" size="sm">
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </GlassCard>
        </motion.div>

        {/* Fastest Growers */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
        >
          <LeaderboardCard
            title="Fastest Growers"
            entries={fastestGrowers}
            valueLabel="% close rate"
          />
        </motion.div>
      </div>
    </DashboardLayout>
  );
}
