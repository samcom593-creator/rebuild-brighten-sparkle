import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Users, UserPlus, Check, X, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

interface UnassignedLead {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  licenseStatus: string;
  createdAt: string;
}

interface Agent {
  id: string;
  name: string;
  email: string;
}

export function BulkLeadAssignment() {
  const [unassignedLeads, setUnassignedLeads] = useState<UnassignedLead[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set());
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isAssigning, setIsAssigning] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setIsLoading(true);
    
    // Fetch unassigned leads
    const { data: leads, error: leadsError } = await supabase
      .from("applications")
      .select("id, first_name, last_name, email, license_status, created_at")
      .is("assigned_agent_id", null)
      .is("terminated_at", null)
      .order("created_at", { ascending: false })
      .limit(50);

    if (leadsError) {
      console.error("Error fetching unassigned leads:", leadsError);
    } else {
      setUnassignedLeads(
        (leads || []).map((l) => ({
          id: l.id,
          firstName: l.first_name,
          lastName: l.last_name,
          email: l.email,
          licenseStatus: l.license_status,
          createdAt: l.created_at,
        }))
      );
    }

    // Fetch active agents
    const { data: agentsData } = await supabase
      .from("agents")
      .select("id, user_id")
      .eq("status", "active");

    if (agentsData && agentsData.length > 0) {
      const userIds = agentsData.map((a) => a.user_id).filter(Boolean);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name, email")
        .in("user_id", userIds);

      const agentList = agentsData.map((agent) => {
        const profile = profiles?.find((p) => p.user_id === agent.user_id);
        return {
          id: agent.id,
          name: profile?.full_name || "Unknown",
          email: profile?.email || "",
        };
      });
      setAgents(agentList);
    }

    setIsLoading(false);
  };

  const toggleLead = (leadId: string) => {
    const newSelected = new Set(selectedLeads);
    if (newSelected.has(leadId)) {
      newSelected.delete(leadId);
    } else {
      newSelected.add(leadId);
    }
    setSelectedLeads(newSelected);
  };

  const toggleAll = () => {
    if (selectedLeads.size === unassignedLeads.length) {
      setSelectedLeads(new Set());
    } else {
      setSelectedLeads(new Set(unassignedLeads.map((l) => l.id)));
    }
  };

  const handleBulkAssign = async () => {
    if (!selectedAgentId || selectedLeads.size === 0) return;

    setIsAssigning(true);
    const leadIds = Array.from(selectedLeads);

    try {
      // Update all selected leads
      const { error } = await supabase
        .from("applications")
        .update({ assigned_agent_id: selectedAgentId })
        .in("id", leadIds);

      if (error) throw error;

      // Send notifications for each lead
      for (const leadId of leadIds) {
        try {
          await supabase.functions.invoke("notify-lead-assigned", {
            body: { applicationId: leadId, newAgentId: selectedAgentId },
          });
        } catch (notifyErr) {
          console.error("Failed to notify for lead:", leadId, notifyErr);
        }
      }

      toast.success(`Successfully assigned ${leadIds.length} leads!`, {
        description: `Leads have been assigned to the selected agent.`,
      });

      // Reset state
      setSelectedLeads(new Set());
      setSelectedAgentId("");
      setIsConfirmOpen(false);
      fetchData();
    } catch (err) {
      console.error("Bulk assignment error:", err);
      toast.error("Failed to assign leads");
    } finally {
      setIsAssigning(false);
    }
  };

  const selectedAgent = agents.find((a) => a.id === selectedAgentId);

  if (isLoading) {
    return (
      <GlassCard className="p-6">
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </GlassCard>
    );
  }

  return (
    <>
      <GlassCard className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-primary" />
            Bulk Lead Assignment
            {unassignedLeads.length > 0 && (
              <Badge variant="outline" className="ml-2 bg-amber-500/20 text-amber-400 border-amber-500/30">
                {unassignedLeads.length} unassigned
              </Badge>
            )}
          </h3>
        </div>

        {unassignedLeads.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Users className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>No unassigned leads</p>
            <p className="text-sm">All leads have been assigned to agents.</p>
          </div>
        ) : (
          <>
            {/* Controls */}
            <div className="flex flex-wrap items-center gap-4 mb-4 p-4 bg-muted/30 rounded-lg">
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={selectedLeads.size === unassignedLeads.length && unassignedLeads.length > 0}
                  onCheckedChange={toggleAll}
                />
                <span className="text-sm text-muted-foreground">
                  {selectedLeads.size} of {unassignedLeads.length} selected
                </span>
              </div>

              <div className="flex-1 min-w-[200px]">
                <Select value={selectedAgentId} onValueChange={setSelectedAgentId}>
                  <SelectTrigger className="bg-input">
                    <SelectValue placeholder="Select agent to assign..." />
                  </SelectTrigger>
                  <SelectContent>
                    {agents.map((agent) => (
                      <SelectItem key={agent.id} value={agent.id}>
                        {agent.name} ({agent.email})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button
                onClick={() => setIsConfirmOpen(true)}
                disabled={selectedLeads.size === 0 || !selectedAgentId}
                className="bg-primary hover:bg-primary/90"
              >
                <UserPlus className="h-4 w-4 mr-2" />
                Assign {selectedLeads.size > 0 ? `(${selectedLeads.size})` : ""}
              </Button>
            </div>

            {/* Leads List */}
            <div className="space-y-2 max-h-[400px] overflow-y-auto scrollbar-custom">
              {unassignedLeads.map((lead) => (
                <motion.div
                  key={lead.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className={`flex items-center gap-4 p-3 rounded-lg border transition-colors ${
                    selectedLeads.has(lead.id)
                      ? "bg-primary/10 border-primary/30"
                      : "bg-background/50 border-border hover:bg-muted/30"
                  }`}
                >
                  <Checkbox
                    checked={selectedLeads.has(lead.id)}
                    onCheckedChange={() => toggleLead(lead.id)}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">
                      {lead.firstName} {lead.lastName}
                    </p>
                    <p className="text-sm text-muted-foreground truncate">{lead.email}</p>
                  </div>
                  <Badge
                    variant="outline"
                    className={
                      lead.licenseStatus === "licensed"
                        ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                        : "bg-amber-500/20 text-amber-400 border-amber-500/30"
                    }
                  >
                    {lead.licenseStatus === "licensed" ? "Licensed" : "Unlicensed"}
                  </Badge>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(lead.createdAt).toLocaleDateString()}
                  </span>
                </motion.div>
              ))}
            </div>
          </>
        )}
      </GlassCard>

      {/* Confirmation Dialog */}
      <Dialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Bulk Assignment</DialogTitle>
            <DialogDescription>
              You are about to assign {selectedLeads.size} lead{selectedLeads.size !== 1 ? "s" : ""} to{" "}
              <strong>{selectedAgent?.name}</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-muted-foreground">
              Each agent will receive an email notification about their new leads.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsConfirmOpen(false)} disabled={isAssigning}>
              <X className="h-4 w-4 mr-2" />
              Cancel
            </Button>
            <Button onClick={handleBulkAssign} disabled={isAssigning}>
              {isAssigning ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Check className="h-4 w-4 mr-2" />
              )}
              Confirm Assignment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
