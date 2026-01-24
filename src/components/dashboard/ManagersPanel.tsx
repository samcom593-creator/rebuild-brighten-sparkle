import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Users,
  Instagram,
  Mail,
  Phone,
  Edit,
  Trash2,
  ArrowRightLeft,
  RefreshCw,
  TrendingUp,
  Loader2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface ManagerData {
  agentId: string;
  userId: string;
  fullName: string;
  email: string;
  phone?: string;
  instagramHandle?: string;
  avatarUrl?: string;
  city?: string;
  state?: string;
  totalLeads: number;
  closedLeads: number;
  teamMembers: number;
}

export function ManagersPanel() {
  const [managers, setManagers] = useState<ManagerData[]>([]);
  const [loading, setLoading] = useState(true);
  const [terminatingId, setTerminatingId] = useState<string | null>(null);

  const fetchManagers = async () => {
    setLoading(true);
    try {
      // Get all users with manager role
      const { data: managerRoles, error: rolesError } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "manager");

      if (rolesError) throw rolesError;

      const managerUserIds = managerRoles?.map((r) => r.user_id) || [];

      if (managerUserIds.length === 0) {
        setManagers([]);
        setLoading(false);
        return;
      }

      // Get agents for these manager users
      const { data: agents, error: agentsError } = await supabase
        .from("agents")
        .select("id, user_id")
        .in("user_id", managerUserIds)
        .eq("status", "active");

      if (agentsError) throw agentsError;

      // Get profiles for these users
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("*")
        .in("user_id", managerUserIds);

      if (profilesError) throw profilesError;

      // Get all applications to count leads per manager
      const { data: applications } = await supabase
        .from("applications")
        .select("assigned_agent_id, closed_at");

      // Get team member counts
      const { data: teamMembers } = await supabase
        .from("agents")
        .select("invited_by_manager_id")
        .eq("status", "active");

      // Build manager data
      const managersData: ManagerData[] = (agents || []).map((agent) => {
        const profile = profiles?.find((p) => p.user_id === agent.user_id);
        const agentApps =
          applications?.filter((a) => a.assigned_agent_id === agent.id) || [];
        const teamCount =
          teamMembers?.filter((t) => t.invited_by_manager_id === agent.id)
            .length || 0;

        return {
          agentId: agent.id,
          userId: agent.user_id || "",
          fullName: profile?.full_name || "Unknown Manager",
          email: profile?.email || "",
          phone: profile?.phone || undefined,
          instagramHandle: profile?.instagram_handle || undefined,
          avatarUrl: profile?.avatar_url || undefined,
          city: profile?.city || undefined,
          state: profile?.state || undefined,
          totalLeads: agentApps.length,
          closedLeads: agentApps.filter((a) => a.closed_at).length,
          teamMembers: teamCount,
        };
      });

      setManagers(managersData);
    } catch (error) {
      console.error("Error fetching managers:", error);
      toast.error("Failed to load managers");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchManagers();
  }, []);

  const handleTerminateManager = async (agentId: string) => {
    setTerminatingId(agentId);
    try {
      const { error } = await supabase
        .from("agents")
        .update({ status: "terminated" })
        .eq("id", agentId);

      if (error) throw error;

      toast.success("Manager terminated");
      fetchManagers();
    } catch (error) {
      console.error("Error terminating manager:", error);
      toast.error("Failed to terminate manager");
    } finally {
      setTerminatingId(null);
    }
  };

  if (loading) {
    return (
      <GlassCard className="p-6">
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      </GlassCard>
    );
  }

  return (
    <GlassCard className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Users className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-semibold">All Managers</h3>
          <Badge variant="outline" className="bg-primary/20 text-primary">
            {managers.length}
          </Badge>
        </div>
        <Button variant="outline" size="sm" onClick={fetchManagers}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Managers Grid */}
      {managers.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          No managers found.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {managers.map((manager, index) => (
            <motion.div
              key={manager.agentId}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className="p-4 rounded-lg bg-muted/50 border border-border hover:border-primary/30 transition-colors"
            >
              {/* Manager Header */}
              <div className="flex items-start gap-4 mb-4">
                <Avatar className="h-12 w-12 border-2 border-primary/20">
                  <AvatarImage
                    src={manager.avatarUrl}
                    alt={manager.fullName}
                  />
                  <AvatarFallback className="bg-primary/20 text-primary">
                    {manager.fullName
                      .split(" ")
                      .map((n) => n[0])
                      .join("")
                      .toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <h4 className="font-semibold truncate">{manager.fullName}</h4>
                  <p className="text-sm text-muted-foreground truncate">
                    {manager.email}
                  </p>
                  {manager.city && manager.state && (
                    <p className="text-xs text-muted-foreground">
                      📍 {manager.city}, {manager.state}
                    </p>
                  )}
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-2 mb-4">
                <div className="text-center p-2 rounded bg-background/50">
                  <p className="text-lg font-bold text-primary">
                    {manager.totalLeads}
                  </p>
                  <p className="text-xs text-muted-foreground">Leads</p>
                </div>
                <div className="text-center p-2 rounded bg-background/50">
                  <p className="text-lg font-bold text-emerald-400">
                    {manager.closedLeads}
                  </p>
                  <p className="text-xs text-muted-foreground">Closed</p>
                </div>
                <div className="text-center p-2 rounded bg-background/50">
                  <p className="text-lg font-bold text-blue-400">
                    {manager.teamMembers}
                  </p>
                  <p className="text-xs text-muted-foreground">Team</p>
                </div>
              </div>

              {/* Contact Info */}
              <div className="flex flex-wrap gap-2 mb-4">
                {manager.phone && (
                  <a
                    href={`tel:${manager.phone}`}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
                  >
                    <Phone className="h-3 w-3" />
                    {manager.phone}
                  </a>
                )}
                {manager.instagramHandle && (
                  <a
                    href={`https://instagram.com/${manager.instagramHandle}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
                  >
                    <Instagram className="h-3 w-3" />@{manager.instagramHandle}
                  </a>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="flex-1" asChild>
                  <a href={`mailto:${manager.email}`}>
                    <Mail className="h-4 w-4 mr-1" />
                    Email
                  </a>
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-red-500/30 text-red-400 hover:bg-red-500/10"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Terminate Manager?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will deactivate {manager.fullName}'s account. Their
                        leads will need to be reassigned. This action can be
                        undone from the database.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() =>
                          handleTerminateManager(manager.agentId)
                        }
                        className="bg-red-600 hover:bg-red-700"
                      >
                        {terminatingId === manager.agentId ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          "Terminate"
                        )}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </GlassCard>
  );
}
