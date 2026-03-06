import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Search,
  Filter,
  Users,
  ChevronDown,
  ChevronUp,
  Phone,
  Mail,
  RefreshCw,
  XCircle,
  FileText,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { format } from "date-fns";
import { QuickAssignMenu } from "@/components/dashboard/QuickAssignMenu";

interface Lead {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  city?: string;
  state?: string;
  status: string;
  licenseStatus: string;
  assignedAgentId?: string;
  assignedAgentName?: string;
  createdAt: string;
  terminatedAt?: string;
}

interface Manager {
  id: string;
  name: string;
  leadCount: number;
}

const statusColors: Record<string, string> = {
  new: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  reviewing: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  interview: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  contracting: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  approved: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  rejected: "bg-red-500/20 text-red-400 border-red-500/30",
};

export function AllLeadsPanel() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [terminatedLeads, setTerminatedLeads] = useState<Lead[]>([]);
  const [managers, setManagers] = useState<Manager[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterManager, setFilterManager] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [showTerminated, setShowTerminated] = useState(false);

  const fetchAllLeads = async () => {
    setLoading(true);
    try {
      // Fetch all applications
      const { data: applications, error } = await supabase
        .from("applications")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;

      // Fetch all agents with profiles
      const { data: agents } = await supabase
        .from("agents")
        .select("id, user_id")
        .eq("status", "active");

      const userIds = agents?.map((a) => a.user_id).filter(Boolean) || [];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", userIds);

      // Build agent name map
      const agentNameMap: Record<string, string> = {};
      agents?.forEach((agent) => {
        const profile = profiles?.find((p) => p.user_id === agent.user_id);
        agentNameMap[agent.id] = profile?.full_name || "Unknown";
      });

      // Transform applications
      const allLeads: Lead[] = (applications || []).map((app) => ({
        id: app.id,
        firstName: app.first_name || "",
        lastName: app.last_name || "",
        email: app.email || "",
        phone: app.phone || "",
        city: app.city || undefined,
        state: app.state || undefined,
        status: app.status,
        licenseStatus: app.license_status,
        assignedAgentId: app.assigned_agent_id || undefined,
        assignedAgentName: app.assigned_agent_id
          ? agentNameMap[app.assigned_agent_id]
          : "Unassigned",
        createdAt: app.created_at,
        terminatedAt: app.terminated_at || undefined,
      }));

      // Separate active and terminated leads
      const active = allLeads.filter((l) => !l.terminatedAt);
      const terminated = allLeads.filter((l) => l.terminatedAt);

      setLeads(active);
      setTerminatedLeads(terminated);

      // Build manager list with counts
      const managerCounts: Record<string, number> = {};
      active.forEach((lead) => {
        const key = lead.assignedAgentId || "unassigned";
        managerCounts[key] = (managerCounts[key] || 0) + 1;
      });

      const managerList: Manager[] = [];
      agents?.forEach((agent) => {
        const count = managerCounts[agent.id] || 0;
        if (count > 0) {
          managerList.push({
            id: agent.id,
            name: agentNameMap[agent.id] || "Unknown",
            leadCount: count,
          });
        }
      });

      if (managerCounts["unassigned"] > 0) {
        managerList.unshift({
          id: "unassigned",
          name: "Unassigned",
          leadCount: managerCounts["unassigned"],
        });
      }

      setManagers(managerList);
    } catch (error) {
      console.error("Error fetching leads:", error);
      toast.error("Failed to load leads");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAllLeads();
  }, []);

  // Filter leads
  const filteredLeads = leads.filter((lead) => {
    const matchesSearch =
      `${lead.firstName} ${lead.lastName} ${lead.email} ${lead.phone}`
        .toLowerCase()
        .includes(searchQuery.toLowerCase());

    const matchesManager =
      filterManager === "all" ||
      (filterManager === "unassigned"
        ? !lead.assignedAgentId
        : lead.assignedAgentId === filterManager);

    const matchesStatus =
      filterStatus === "all" || lead.status === filterStatus;

    return matchesSearch && matchesManager && matchesStatus;
  });

  const renderLeadRow = (lead: Lead) => (
    <TableRow key={lead.id}>
      <TableCell>
        <div>
          <p className="font-medium">
            {lead.firstName} {lead.lastName}
          </p>
          <p className="text-xs text-muted-foreground">{lead.email}</p>
        </div>
      </TableCell>
      <TableCell>{lead.phone}</TableCell>
      <TableCell>
        {lead.city && lead.state ? `${lead.city}, ${lead.state}` : "-"}
      </TableCell>
      <TableCell>
        <Badge
          variant="outline"
          className={cn(
            statusColors[lead.status] || "bg-muted text-muted-foreground"
          )}
        >
          {lead.status}
        </Badge>
      </TableCell>
      <TableCell>
        <Badge
          variant="outline"
          className={
            lead.licenseStatus === "licensed"
              ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
              : "bg-amber-500/20 text-amber-400 border-amber-500/30"
          }
        >
          {lead.licenseStatus}
        </Badge>
      </TableCell>
      <TableCell>
        <span
          className={cn(
            "text-sm",
            !lead.assignedAgentId && "text-amber-400 font-medium"
          )}
        >
          {lead.assignedAgentName}
        </span>
      </TableCell>
      <TableCell className="text-muted-foreground text-sm">
        {format(new Date(lead.createdAt), "MMM d, yyyy")}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          <QuickAssignMenu
            applicationId={lead.id}
            currentAgentId={lead.assignedAgentId || null}
            onAssigned={fetchAllLeads}
            displayMode="icon"
          />
          <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
            <a href={`tel:${lead.phone}`}>
              <Phone className="h-4 w-4" />
            </a>
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
            <a href={`mailto:${lead.email}`}>
              <Mail className="h-4 w-4" />
            </a>
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );

  return (
    <GlassCard className="p-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <FileText className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-semibold">All Leads</h3>
          <Badge variant="outline" className="bg-primary/20 text-primary">
            {leads.length} Active
          </Badge>
          {terminatedLeads.length > 0 && (
            <Badge
              variant="outline"
              className="bg-red-500/20 text-red-400 border-red-500/30"
            >
              {terminatedLeads.length} Terminated
            </Badge>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchAllLeads}
          disabled={loading}
        >
          <RefreshCw
            className={cn("h-4 w-4 mr-2", loading && "animate-spin")}
          />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search leads..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 bg-input"
          />
        </div>
        <Select value={filterManager} onValueChange={setFilterManager}>
          <SelectTrigger className="w-[200px]">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue placeholder="Filter by manager" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Managers</SelectItem>
            {managers.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name} ({m.leadCount})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="new">New</SelectItem>
            <SelectItem value="reviewing">Reviewing</SelectItem>
            <SelectItem value="interview">Interview</SelectItem>
            <SelectItem value="contracting">Contracting</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Active Leads Table */}
      {loading ? (
        <div className="flex items-center justify-center h-32">
          <RefreshCw className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : filteredLeads.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          No leads found matching your filters.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>License</TableHead>
                <TableHead>Assigned To</TableHead>
                <TableHead>Applied</TableHead>
                <TableHead>Assign</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>{filteredLeads.map(renderLeadRow)}</TableBody>
          </Table>
        </div>
      )}

      {/* Terminated Leads Section */}
      {terminatedLeads.length > 0 && (
        <Collapsible
          open={showTerminated}
          onOpenChange={setShowTerminated}
          className="mt-6"
        >
          <CollapsibleTrigger asChild>
            <Button
              variant="outline"
              className="w-full justify-between border-red-500/30 text-red-400 hover:bg-red-500/10"
            >
              <div className="flex items-center gap-2">
                <XCircle className="h-4 w-4" />
                Terminated Leads ({terminatedLeads.length})
              </div>
              {showTerminated ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-4">
            <div className="overflow-x-auto border border-red-500/20 rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>License</TableHead>
                    <TableHead>Assigned To</TableHead>
                    <TableHead>Applied</TableHead>
                    <TableHead>Assign</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>{terminatedLeads.map(renderLeadRow)}</TableBody>
              </Table>
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </GlassCard>
  );
}
