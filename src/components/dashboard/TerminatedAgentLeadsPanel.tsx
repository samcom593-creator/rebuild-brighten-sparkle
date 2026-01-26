import { useState, useEffect } from "react";
import { UserX, RefreshCw, Phone, Mail, Calendar, Loader2 } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { QuickAssignMenu } from "./QuickAssignMenu";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";

interface OrphanedLead {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  status: string;
  licenseStatus: string;
  createdAt: string;
  formerAgentId: string;
  formerAgentName: string;
}

export function TerminatedAgentLeadsPanel() {
  const [leads, setLeads] = useState<OrphanedLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isOpen, setIsOpen] = useState(true);

  useEffect(() => {
    fetchOrphanedLeads();
  }, []);

  const fetchOrphanedLeads = async () => {
    try {
      // Step 1: Get all terminated agents
      const { data: terminatedAgents, error: agentsError } = await supabase
        .from("agents")
        .select("id, user_id")
        .eq("status", "terminated");

      if (agentsError) throw agentsError;

      if (!terminatedAgents || terminatedAgents.length === 0) {
        setLeads([]);
        setLoading(false);
        return;
      }

      const terminatedAgentIds = terminatedAgents.map((a) => a.id);
      const terminatedUserIds = terminatedAgents.map((a) => a.user_id).filter(Boolean);

      // Step 2: Get profiles for terminated agents
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", terminatedUserIds);

      // Create a map of agent ID to name
      const agentNameMap: Record<string, string> = {};
      terminatedAgents.forEach((agent) => {
        const profile = profiles?.find((p) => p.user_id === agent.user_id);
        agentNameMap[agent.id] = profile?.full_name || "Unknown Agent";
      });

      // Step 3: Get applications assigned to terminated agents (exclude terminated leads)
      const { data: orphanedApps, error: appsError } = await supabase
        .from("applications")
        .select("id, first_name, last_name, email, phone, status, license_status, created_at, assigned_agent_id")
        .in("assigned_agent_id", terminatedAgentIds)
        .is("terminated_at", null)
        .order("created_at", { ascending: false });

      if (appsError) throw appsError;

      const formattedLeads: OrphanedLead[] = (orphanedApps || []).map((app) => ({
        id: app.id,
        firstName: app.first_name,
        lastName: app.last_name,
        email: app.email,
        phone: app.phone,
        status: app.status,
        licenseStatus: app.license_status,
        createdAt: app.created_at,
        formerAgentId: app.assigned_agent_id || "",
        formerAgentName: agentNameMap[app.assigned_agent_id || ""] || "Unknown",
      }));

      setLeads(formattedLeads);
    } catch (error) {
      console.error("Error fetching orphaned leads:", error);
      toast.error("Failed to fetch orphaned leads");
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchOrphanedLeads();
    setRefreshing(false);
    toast.success("Orphaned leads refreshed");
  };

  const handleLeadReassigned = () => {
    fetchOrphanedLeads();
  };

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { className: string; label: string }> = {
      new: { className: "bg-blue-500/20 text-blue-400 border-blue-500/30", label: "New" },
      reviewing: { className: "bg-purple-500/20 text-purple-400 border-purple-500/30", label: "Reviewing" },
      interview: { className: "bg-amber-500/20 text-amber-400 border-amber-500/30", label: "Interview" },
      contracting: { className: "bg-teal-500/20 text-teal-400 border-teal-500/30", label: "Contracting" },
      approved: { className: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30", label: "Approved" },
      rejected: { className: "bg-red-500/20 text-red-400 border-red-500/30", label: "Rejected" },
    };

    const config = statusConfig[status] || { className: "bg-muted text-muted-foreground", label: status };
    return (
      <Badge variant="outline" className={config.className}>
        {config.label}
      </Badge>
    );
  };

  const getLicenseBadge = (status: string) => {
    if (status === "licensed") {
      return (
        <Badge variant="outline" className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
          Licensed
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="bg-muted text-muted-foreground border-border">
        Unlicensed
      </Badge>
    );
  };

  if (loading) {
    return (
      <GlassCard className="p-6 border border-orange-500/30 bg-orange-500/5">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-orange-400" />
        </div>
      </GlassCard>
    );
  }

  return (
    <GlassCard className="p-6 border border-orange-500/30 bg-orange-500/5">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <div className="flex items-center justify-between mb-4">
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-2 hover:opacity-80 transition-opacity">
              <UserX className="h-5 w-5 text-orange-400" />
              <h3 className="text-lg font-semibold">Terminated Agent Leads</h3>
              <Badge variant="outline" className="bg-orange-500/20 text-orange-400 border-orange-500/30 ml-2">
                {leads.length} Orphaned
              </Badge>
            </button>
          </CollapsibleTrigger>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
            className="text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        <CollapsibleContent>
          {leads.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <UserX className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="font-medium">No orphaned leads</p>
              <p className="text-sm">All leads from terminated agents have been reassigned.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Lead</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>License</TableHead>
                    <TableHead>Former Agent</TableHead>
                    <TableHead>Applied</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leads.map((lead) => (
                    <TableRow key={lead.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">
                            {lead.firstName} {lead.lastName}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <a
                            href={`mailto:${lead.email}`}
                            className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1"
                          >
                            <Mail className="h-3 w-3" />
                            {lead.email}
                          </a>
                          <a
                            href={`tel:${lead.phone}`}
                            className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1"
                          >
                            <Phone className="h-3 w-3" />
                            {lead.phone}
                          </a>
                        </div>
                      </TableCell>
                      <TableCell>{getStatusBadge(lead.status)}</TableCell>
                      <TableCell>{getLicenseBadge(lead.licenseStatus)}</TableCell>
                      <TableCell>
                        <span className="text-sm text-orange-400/80">
                          Formerly: {lead.formerAgentName}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Calendar className="h-3 w-3" />
                          {format(new Date(lead.createdAt), "MMM d, yyyy")}
                        </div>
                      </TableCell>
                      <TableCell>
                        <QuickAssignMenu
                          applicationId={lead.id}
                          currentAgentId={lead.formerAgentId}
                          onAssigned={handleLeadReassigned}
                          className="text-orange-400 hover:text-orange-300 hover:bg-orange-500/10"
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </GlassCard>
  );
}
