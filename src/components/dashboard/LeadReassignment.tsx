import { useState, useEffect } from "react";
import { ArrowRightLeft, User, ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Application {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  assigned_agent_id: string | null;
  assigned_agent_name?: string;
  status: string;
  created_at: string;
}

interface Agent {
  id: string;
  name: string;
  email: string;
}

export function LeadReassignment() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedApp, setSelectedApp] = useState<Application | null>(null);
  const [targetAgent, setTargetAgent] = useState<string>("");
  const [isReassigning, setIsReassigning] = useState(false);

  useEffect(() => {
    fetchApplications();
    fetchAgents();
  }, []);

  const fetchAgents = async () => {
    try {
      const { data: agentsData, error } = await supabase
        .from("agents")
        .select("id, user_id")
        .eq("status", "active");

      if (error) throw error;

      const agentsWithNames = await Promise.all(
        (agentsData || []).map(async (agent) => {
          const { data: profile } = await supabase
            .from("profiles")
            .select("full_name, email")
            .eq("user_id", agent.user_id)
            .single();

          return {
            id: agent.id,
            name: profile?.full_name || "Unknown",
            email: profile?.email || "",
          };
        })
      );

      setAgents(agentsWithNames.filter((a) => a.name !== "Unknown"));
    } catch (error) {
      console.error("Error fetching agents:", error);
    }
  };

  const fetchApplications = async () => {
    try {
      const { data: apps, error } = await supabase
        .from("applications")
        .select("id, first_name, last_name, email, assigned_agent_id, status, created_at")
        .order("created_at", { ascending: false })
        .limit(20);

      if (error) throw error;

      // Get agent names for assigned applications
      const appsWithNames = await Promise.all(
        (apps || []).map(async (app) => {
          let assignedAgentName: string | undefined;
          
          if (app.assigned_agent_id) {
            const { data: agent } = await supabase
              .from("agents")
              .select("user_id")
              .eq("id", app.assigned_agent_id)
              .single();

            if (agent?.user_id) {
              const { data: profile } = await supabase
                .from("profiles")
                .select("full_name")
                .eq("user_id", agent.user_id)
                .single();
              assignedAgentName = profile?.full_name || undefined;
            }
          }

          return {
            ...app,
            assigned_agent_name: assignedAgentName,
          };
        })
      );

      setApplications(appsWithNames);
    } catch (error) {
      console.error("Error fetching applications:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleReassign = async () => {
    if (!selectedApp || !targetAgent) return;

    setIsReassigning(true);
    try {
      const { error } = await supabase
        .from("applications")
        .update({ assigned_agent_id: targetAgent })
        .eq("id", selectedApp.id);

      if (error) throw error;

      toast.success("Lead reassigned successfully!");
      setSelectedApp(null);
      setTargetAgent("");
      fetchApplications();
    } catch (error) {
      console.error("Error reassigning lead:", error);
      toast.error("Failed to reassign lead");
    } finally {
      setIsReassigning(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      new: "bg-blue-500/20 text-blue-400 border-blue-500/30",
      contacted: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
      qualified: "bg-purple-500/20 text-purple-400 border-purple-500/30",
      closed: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
      rejected: "bg-red-500/20 text-red-400 border-red-500/30",
    };
    return colors[status] || "bg-gray-500/20 text-gray-400 border-gray-500/30";
  };

  return (
    <>
      <GlassCard className="p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <ArrowRightLeft className="h-5 w-5 text-primary" />
          Lead Reassignment
        </h3>

        {isLoading ? (
          <p className="text-muted-foreground text-sm">Loading...</p>
        ) : applications.length === 0 ? (
          <p className="text-muted-foreground text-sm">No applications found.</p>
        ) : (
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {applications.map((app) => (
              <div
                key={app.id}
                className="flex items-center justify-between p-3 rounded-lg bg-background/50 border border-border"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="font-medium">
                      {app.first_name} {app.last_name}
                    </p>
                    <Badge variant="outline" className={getStatusBadge(app.status)}>
                      {app.status}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {app.assigned_agent_name ? (
                      <>Assigned to: <span className="text-primary">{app.assigned_agent_name}</span></>
                    ) : (
                      <span className="text-amber-400">Unassigned</span>
                    )}
                  </p>
                </div>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm">
                      <ArrowRightLeft className="h-4 w-4 mr-1" />
                      Reassign
                      <ChevronDown className="h-3 w-3 ml-1" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {agents.map((agent) => (
                      <DropdownMenuItem
                        key={agent.id}
                        onClick={() => {
                          setSelectedApp(app);
                          setTargetAgent(agent.id);
                        }}
                        disabled={app.assigned_agent_id === agent.id}
                      >
                        <User className="h-4 w-4 mr-2" />
                        {agent.name}
                        {app.assigned_agent_id === agent.id && (
                          <span className="ml-2 text-xs text-muted-foreground">(current)</span>
                        )}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </div>
        )}
      </GlassCard>

      {/* Confirmation Dialog */}
      <Dialog open={!!selectedApp && !!targetAgent} onOpenChange={() => {
        setSelectedApp(null);
        setTargetAgent("");
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Reassignment</DialogTitle>
            <DialogDescription>
              Are you sure you want to reassign this lead?
            </DialogDescription>
          </DialogHeader>
          
          {selectedApp && (
            <div className="py-4">
              <p className="text-sm mb-2">
                <strong>Lead:</strong> {selectedApp.first_name} {selectedApp.last_name}
              </p>
              <p className="text-sm mb-2">
                <strong>From:</strong>{" "}
                {selectedApp.assigned_agent_name || <span className="text-amber-400">Unassigned</span>}
              </p>
              <p className="text-sm">
                <strong>To:</strong>{" "}
                <span className="text-primary">
                  {agents.find((a) => a.id === targetAgent)?.name}
                </span>
              </p>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setSelectedApp(null);
              setTargetAgent("");
            }}>
              Cancel
            </Button>
            <Button onClick={handleReassign} disabled={isReassigning}>
              {isReassigning ? "Reassigning..." : "Confirm Reassignment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
