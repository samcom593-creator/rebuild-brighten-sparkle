import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Search,
  Filter,
  Target,
  Phone,
  Mail,
  RefreshCw,
  Users,
  UserX,
  Award,
  Clock,
  Download,
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
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { format } from "date-fns";
import { QuickAssignMenu } from "@/components/dashboard/QuickAssignMenu";
import { QuickEmailMenu } from "@/components/dashboard/QuickEmailMenu";
import { useAuth } from "@/hooks/useAuth";

interface Lead {
  id: string;
  source: "applications" | "aged_leads";
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
}

interface Manager {
  id: string;
  name: string;
  leadCount: number;
}

const statusColors: Record<string, string> = {
  new: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  reviewing: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  contacted: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  interview: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  qualified: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  contracting: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  approved: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  hired: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  contracted: "bg-teal-500/20 text-teal-400 border-teal-500/30",
  rejected: "bg-red-500/20 text-red-400 border-red-500/30",
  not_qualified: "bg-red-500/20 text-red-400 border-red-500/30",
};

export default function LeadCenter() {
  const { isAdmin } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [managers, setManagers] = useState<Manager[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterManager, setFilterManager] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterLicense, setFilterLicense] = useState<string>("all");

  const fetchLeads = async () => {
    setLoading(true);
    try {
      // Fetch all applications
      const { data: applications, error: appError } = await supabase
        .from("applications")
        .select("*")
        .is("terminated_at", null)
        .order("created_at", { ascending: false });

      if (appError) throw appError;

      // Fetch aged leads
      const { data: agedLeads, error: agedError } = await supabase
        .from("aged_leads")
        .select("*")
        .order("created_at", { ascending: false });

      if (agedError) throw agedError;

      // Fetch all agents with profiles for name lookup
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
      const appLeads: Lead[] = (applications || []).map((app) => ({
        id: app.id,
        source: "applications" as const,
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
          : undefined,
        createdAt: app.created_at,
      }));

      // Transform aged leads
      const aged: Lead[] = (agedLeads || []).map((lead) => ({
        id: lead.id,
        source: "aged_leads" as const,
        firstName: lead.first_name || "",
        lastName: lead.last_name || "",
        email: lead.email || "",
        phone: lead.phone || "",
        city: undefined,
        state: undefined,
        status: lead.status || "new",
        licenseStatus: lead.license_status || "unknown",
        assignedAgentId: lead.assigned_manager_id || undefined,
        assignedAgentName: lead.assigned_manager_id
          ? agentNameMap[lead.assigned_manager_id]
          : undefined,
        createdAt: lead.created_at || new Date().toISOString(),
      }));

      const allLeads = [...appLeads, ...aged];
      setLeads(allLeads);

      // Build manager list with counts
      const managerCounts: Record<string, number> = {};
      allLeads.forEach((lead) => {
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
    if (isAdmin) {
      fetchLeads();
    }
  }, [isAdmin]);

  // Filter leads
  const filteredLeads = useMemo(() => {
    return leads.filter((lead) => {
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

      const matchesLicense =
        filterLicense === "all" || lead.licenseStatus === filterLicense;

      return matchesSearch && matchesManager && matchesStatus && matchesLicense;
    });
  }, [leads, searchQuery, filterManager, filterStatus, filterLicense]);

  // Stats
  const stats = useMemo(() => {
    return {
      total: leads.length,
      unassigned: leads.filter((l) => !l.assignedAgentId).length,
      licensed: leads.filter((l) => l.licenseStatus === "licensed").length,
      new: leads.filter((l) => l.status === "new").length,
    };
  }, [leads]);

  const handleExport = () => {
    const csvContent = [
      ["Name", "Email", "Phone", "Status", "License", "Assigned To", "Source", "Created"].join(","),
      ...filteredLeads.map((lead) =>
        [
          `"${lead.firstName} ${lead.lastName}"`,
          lead.email,
          lead.phone,
          lead.status,
          lead.licenseStatus,
          lead.assignedAgentName || "Unassigned",
          lead.source,
          format(new Date(lead.createdAt), "yyyy-MM-dd"),
        ].join(",")
      ),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `leads-export-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Leads exported successfully");
  };

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Admin access required</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col md:flex-row md:items-center justify-between gap-4"
      >
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-primary/20 to-primary/10 border border-primary/30">
            <Target className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Lead Center</h1>
            <p className="text-sm text-muted-foreground">
              Manage all leads and assignments
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={loading}
          >
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchLeads}
            disabled={loading}
          >
            <RefreshCw
              className={cn("h-4 w-4 mr-2", loading && "animate-spin")}
            />
            Refresh
          </Button>
        </div>
      </motion.div>

      {/* Stats Cards */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="grid grid-cols-2 md:grid-cols-4 gap-4"
      >
        <GlassCard className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Users className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{stats.total}</p>
              <p className="text-xs text-muted-foreground">Total Leads</p>
            </div>
          </div>
        </GlassCard>
        <GlassCard className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-500/10">
              <UserX className="h-5 w-5 text-amber-500" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{stats.unassigned}</p>
              <p className="text-xs text-muted-foreground">Unassigned</p>
            </div>
          </div>
        </GlassCard>
        <GlassCard className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/10">
              <Award className="h-5 w-5 text-emerald-500" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{stats.licensed}</p>
              <p className="text-xs text-muted-foreground">Licensed</p>
            </div>
          </div>
        </GlassCard>
        <GlassCard className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-500/10">
              <Clock className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{stats.new}</p>
              <p className="text-xs text-muted-foreground">New Leads</p>
            </div>
          </div>
        </GlassCard>
      </motion.div>

      {/* Filters */}
      <GlassCard className="p-4">
        <div className="flex flex-col md:flex-row gap-4">
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
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="new">New</SelectItem>
              <SelectItem value="reviewing">Reviewing</SelectItem>
              <SelectItem value="contacted">Contacted</SelectItem>
              <SelectItem value="interview">Interview</SelectItem>
              <SelectItem value="contracting">Contracting</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterLicense} onValueChange={setFilterLicense}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="License" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Licenses</SelectItem>
              <SelectItem value="licensed">Licensed</SelectItem>
              <SelectItem value="unlicensed">Unlicensed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </GlassCard>

      {/* Leads Table */}
      <GlassCard className="p-4">
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
                  <TableHead>Source</TableHead>
                  <TableHead>Applied</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLeads.map((lead) => (
                  <TableRow key={`${lead.source}-${lead.id}`}>
                    <TableCell>
                      <div>
                        <p className="font-medium">
                          {lead.firstName} {lead.lastName}
                        </p>
                        <p className="text-xs text-muted-foreground">{lead.email}</p>
                      </div>
                    </TableCell>
                    <TableCell>{lead.phone || "-"}</TableCell>
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
                        {lead.assignedAgentName || "Unassigned"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          lead.source === "applications"
                            ? "bg-blue-500/20 text-blue-400 border-blue-500/30"
                            : "bg-amber-500/20 text-amber-400 border-amber-500/30"
                        }
                      >
                        {lead.source === "applications" ? "App" : "Aged"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {format(new Date(lead.createdAt), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {lead.source === "applications" && (
                          <QuickAssignMenu
                            applicationId={lead.id}
                            currentAgentId={lead.assignedAgentId || null}
                            onAssigned={fetchLeads}
                          />
                        )}
                        <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                          <a href={`tel:${lead.phone}`}>
                            <Phone className="h-4 w-4" />
                          </a>
                        </Button>
                        {lead.source === "applications" && (
                          <QuickEmailMenu
                            applicationId={lead.id}
                            agentId={null}
                            licenseStatus={lead.licenseStatus as "licensed" | "unlicensed" | "pending"}
                            recipientEmail={lead.email}
                            recipientName={`${lead.firstName} ${lead.lastName}`}
                          />
                        )}
                        {lead.source !== "applications" && (
                          <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                            <a href={`mailto:${lead.email}`}>
                              <Mail className="h-4 w-4" />
                            </a>
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <div className="mt-4 text-sm text-muted-foreground text-center">
          Showing {filteredLeads.length} of {leads.length} leads
        </div>
      </GlassCard>
    </div>
  );
}
