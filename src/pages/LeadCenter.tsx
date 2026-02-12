import { useState, useEffect, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
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
  Loader2,
  X,
  Trash2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
import { ResendLicensingButton } from "@/components/callcenter/ResendLicensingButton";
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
  referralSource?: string;
  contactedAt?: string;
  notes?: string;
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
  not_contacted: "bg-gray-500/20 text-gray-400 border-gray-500/30",
};

// Format referral source nicely
const formatReferralSource = (source?: string): string => {
  if (!source) return "Direct Apply";
  const mapping: Record<string, string> = {
    "agent-referral": "Agent Referral",
    "friend-referral": "Friend Referral",
    "social-media": "Social Media",
    "event": "Event",
    "other": "Other",
  };
  return mapping[source] || source;
};

// Format status nicely
const formatStatus = (status: string): string => {
  const mapping: Record<string, string> = {
    new: "New",
    reviewing: "Reviewing",
    contacted: "Contacted",
    interview: "Interview",
    qualified: "Qualified",
    contracting: "Contracting",
    approved: "Approved",
    hired: "Hired",
    contracted: "Contracted",
    rejected: "Rejected",
    not_qualified: "Not Qualified",
  };
  return mapping[status] || status;
};

export default function LeadCenter() {
  const { isAdmin, user } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [managers, setManagers] = useState<Manager[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterManager, setFilterManager] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterLicense, setFilterLicense] = useState<string>("all");

  // Bulk selection state
  const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set());
  const [bulkAssigning, setBulkAssigning] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkManagerId, setBulkManagerId] = useState<string>("");

  const fetchLeads = async () => {
    // Only show loading spinner on first load, not refetches
    if (!initialLoaded) setLoading(true);
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

      // Fetch all agents with profiles for name lookup (no status filter to resolve all names)
      const { data: agents } = await supabase
        .from("agents")
        .select("id, user_id");

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
        referralSource: app.referral_source || undefined,
        contactedAt: app.contacted_at || undefined,
        notes: app.notes || undefined,
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
        referralSource: undefined,
        contactedAt: lead.contacted_at || undefined,
        notes: lead.notes || lead.motivation || undefined,
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
      setInitialLoaded(true);
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

      // Handle special "not_contacted" status filter
      let matchesStatus = true;
      if (filterStatus === "all") {
        matchesStatus = true;
      } else if (filterStatus === "not_contacted") {
        matchesStatus = !lead.contactedAt;
      } else {
        matchesStatus = lead.status === filterStatus;
      }

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

  // Selection helpers
  const toggleSelectLead = useCallback((leadId: string) => {
    setSelectedLeads((prev) => {
      const next = new Set(prev);
      if (next.has(leadId)) {
        next.delete(leadId);
      } else {
        next.add(leadId);
      }
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selectedLeads.size === filteredLeads.length) {
      setSelectedLeads(new Set());
    } else {
      setSelectedLeads(new Set(filteredLeads.map((l) => `${l.source}-${l.id}`)));
    }
  }, [selectedLeads.size, filteredLeads]);

  const clearSelection = useCallback(() => {
    setSelectedLeads(new Set());
    setBulkManagerId("");
  }, []);

  // Bulk assign handler
  const handleBulkAssign = async () => {
    if (!bulkManagerId || selectedLeads.size === 0) {
      toast.error("Please select a manager to assign");
      return;
    }

    setBulkAssigning(true);
    try {
      // Separate leads by source
      const applicationIds: string[] = [];
      const agedLeadIds: string[] = [];

      selectedLeads.forEach((key) => {
        const [source, id] = key.split("-");
        if (source === "applications") {
          applicationIds.push(id);
        } else if (source === "aged_leads") {
          agedLeadIds.push(id);
        }
      });

      const managerId = bulkManagerId === "unassigned" ? null : bulkManagerId;

      // Update applications
      if (applicationIds.length > 0) {
        const { error: appError } = await supabase
          .from("applications")
          .update({ assigned_agent_id: managerId })
          .in("id", applicationIds);
        if (appError) throw appError;
      }

      // Update aged leads
      if (agedLeadIds.length > 0) {
        const { error: agedError } = await supabase
          .from("aged_leads")
          .update({ assigned_manager_id: managerId })
          .in("id", agedLeadIds);
        if (agedError) throw agedError;
      }

      const managerName = managers.find((m) => m.id === bulkManagerId)?.name || "Unassigned";
      toast.success(`${selectedLeads.size} leads assigned to ${managerName}`);
      clearSelection();
      fetchLeads();
    } catch (error) {
      console.error("Error bulk assigning leads:", error);
      toast.error("Failed to assign leads");
    } finally {
      setBulkAssigning(false);
    }
  };

  // Bulk delete handler - moves leads to vault
  const handleBulkDelete = async () => {
    if (selectedLeads.size === 0) return;

    const confirmed = window.confirm(
      `Delete ${selectedLeads.size} leads? They will be moved to the vault and can be restored from Settings.`
    );
    if (!confirmed) return;

    setBulkDeleting(true);
    try {
      // Separate leads by source
      const applicationIds: string[] = [];
      const agedLeadIds: string[] = [];

      selectedLeads.forEach((key) => {
        const [source, id] = key.split("-");
        if (source === "applications") applicationIds.push(id);
        else if (source === "aged_leads") agedLeadIds.push(id);
      });

      // Move applications to vault
      if (applicationIds.length > 0) {
        const { data: apps } = await supabase
          .from("applications")
          .select("*")
          .in("id", applicationIds);

        if (apps?.length) {
          // Insert into vault
          const { error: vaultError } = await supabase
            .from("deleted_leads")
            .insert(
              apps.map((app) => ({
                original_id: app.id,
                source: "applications",
                first_name: app.first_name,
                last_name: app.last_name,
                email: app.email,
                phone: app.phone,
                city: app.city,
                state: app.state,
                license_status: app.license_status,
                assigned_agent_id: app.assigned_agent_id,
                original_data: app,
                deleted_by: user?.id,
              }))
            );

          if (vaultError) throw vaultError;

          // Soft delete applications by setting terminated_at
          const { data: updatedApps, error: softDeleteError } = await supabase
            .from("applications")
            .update({ terminated_at: new Date().toISOString(), termination_reason: "Deleted via Lead Center" })
            .in("id", applicationIds)
            .select("id");

          if (softDeleteError) {
            // Roll back vault entries since soft-delete failed
            await supabase.from("deleted_leads").delete().in("original_id", applicationIds);
            throw new Error(`Failed to terminate applications: ${softDeleteError.message}`);
          }

          const updatedCount = updatedApps?.length ?? 0;
          if (updatedCount < applicationIds.length) {
            // Some rows were not updated (likely RLS blocked them) — roll back vault for those
            const updatedSet = new Set(updatedApps?.map(a => a.id));
            const failedIds = applicationIds.filter(id => !updatedSet.has(id));
            if (failedIds.length > 0) {
              await supabase.from("deleted_leads").delete().in("original_id", failedIds);
            }
            toast.warning(`${updatedCount} of ${applicationIds.length} leads deleted — you may not have permission to delete all selected leads`);
          }
        }
      }

      // Move aged leads to vault and hard delete
      if (agedLeadIds.length > 0) {
        const { data: aged } = await supabase
          .from("aged_leads")
          .select("*")
          .in("id", agedLeadIds);

        if (aged?.length) {
          // Insert into vault
          const { error: vaultError } = await supabase
            .from("deleted_leads")
            .insert(
              aged.map((lead) => ({
                original_id: lead.id,
                source: "aged_leads",
                first_name: lead.first_name,
                last_name: lead.last_name,
                email: lead.email,
                phone: lead.phone,
                license_status: lead.license_status,
                assigned_agent_id: lead.assigned_manager_id,
                original_data: lead,
                deleted_by: user?.id,
              }))
            );

          if (vaultError) throw vaultError;

          // Hard delete aged leads
          const { error: hardDeleteError } = await supabase.from("aged_leads").delete().in("id", agedLeadIds);
          if (hardDeleteError) {
            await supabase.from("deleted_leads").delete().in("original_id", agedLeadIds);
            throw new Error(`Failed to delete aged leads: ${hardDeleteError.message}`);
          }
        }
      }

      const deletedCount = selectedLeads.size;
      // Optimistic: remove deleted leads from local state immediately
      const deletedKeys = new Set(selectedLeads);
      setLeads(prev => prev.filter(lead => !deletedKeys.has(`${lead.source}-${lead.id}`)));
      clearSelection();
      toast.success(`${deletedCount} leads moved to vault`);
    } catch (error) {
      console.error("Error deleting leads:", error);
      toast.error("Failed to delete leads");
    } finally {
      setBulkDeleting(false);
    }
  };

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

  const isAllSelected = filteredLeads.length > 0 && selectedLeads.size === filteredLeads.length;
  const isPartiallySelected = selectedLeads.size > 0 && selectedLeads.size < filteredLeads.length;

  // Get list of managers for bulk assign (not just those with leads)
  const [allManagers, setAllManagers] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    const fetchAllManagers = async () => {
      try {
        const { data, error } = await supabase.functions.invoke("get-active-managers");
        if (error) throw error;
        if (data?.managers) {
          setAllManagers(data.managers);
        }
      } catch (error) {
        console.error("Error fetching managers:", error);
      }
    };
    fetchAllManagers();
  }, []);

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
        {[
          {
            label: "Total Leads",
            value: stats.total,
            icon: Users,
            iconColor: "text-primary",
            bgColor: "bg-primary/10",
            onClick: () => { setFilterManager("all"); setFilterStatus("all"); setFilterLicense("all"); },
            active: filterManager === "all" && filterStatus === "all" && filterLicense === "all",
          },
          {
            label: "Unassigned",
            value: stats.unassigned,
            icon: UserX,
            iconColor: "text-amber-500",
            bgColor: "bg-amber-500/10",
            onClick: () => { setFilterManager("unassigned"); setFilterStatus("all"); setFilterLicense("all"); },
            active: filterManager === "unassigned",
          },
          {
            label: "Licensed",
            value: stats.licensed,
            icon: Award,
            iconColor: "text-emerald-500",
            bgColor: "bg-emerald-500/10",
            onClick: () => { setFilterLicense("licensed"); setFilterManager("all"); setFilterStatus("all"); },
            active: filterLicense === "licensed",
          },
          {
            label: "New Leads",
            value: stats.new,
            icon: Clock,
            iconColor: "text-blue-500",
            bgColor: "bg-blue-500/10",
            onClick: () => { setFilterStatus("new"); setFilterManager("all"); setFilterLicense("all"); },
            active: filterStatus === "new",
          },
        ].map((card) => (
          <GlassCard
            key={card.label}
            className={cn(
              "p-4 cursor-pointer transition-all hover:ring-2 hover:ring-primary/40",
              card.active && "ring-2 ring-primary shadow-lg shadow-primary/10"
            )}
            onClick={card.onClick}
          >
            <div className="flex items-center gap-3">
              <div className={cn("p-2 rounded-lg", card.bgColor)}>
                <card.icon className={cn("h-5 w-5", card.iconColor)} />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{card.value}</p>
                <p className="text-xs text-muted-foreground">{card.label}</p>
              </div>
            </div>
          </GlassCard>
        ))}
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
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="new">New</SelectItem>
              <SelectItem value="not_contacted">Not Contacted</SelectItem>
              <SelectItem value="reviewing">Reviewing / Hired</SelectItem>
              <SelectItem value="contacted">Contacted</SelectItem>
              <SelectItem value="interview">Interview</SelectItem>
              <SelectItem value="contracting">Contracting</SelectItem>
              <SelectItem value="approved">Contracted</SelectItem>
              <SelectItem value="rejected">Not Qualified</SelectItem>
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
              <SelectItem value="unknown">Unknown</SelectItem>
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
                  <TableHead className="w-10">
                    <Checkbox
                      checked={isAllSelected}
                      onCheckedChange={toggleSelectAll}
                      aria-label="Select all"
                      className={cn(isPartiallySelected && "data-[state=checked]:bg-primary/50")}
                    />
                  </TableHead>
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
                {filteredLeads.map((lead) => {
                  const leadKey = `${lead.source}-${lead.id}`;
                  const isSelected = selectedLeads.has(leadKey);
                  
                  // Determine display status
                  const displayStatus = !lead.contactedAt ? "Not Contacted" : formatStatus(lead.status);
                  const statusColorKey = !lead.contactedAt ? "not_contacted" : lead.status;

                  return (
                    <TableRow
                      key={leadKey}
                      className={cn(isSelected && "bg-primary/5")}
                    >
                      <TableCell>
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleSelectLead(leadKey)}
                          aria-label={`Select ${lead.firstName} ${lead.lastName}`}
                        />
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium">
                            {lead.firstName} {lead.lastName}
                          </p>
                          <p className="text-xs text-muted-foreground">{lead.email}</p>
                          {lead.notes && (
                            <p className="text-xs text-muted-foreground mt-1 italic border-l-2 border-primary/30 pl-2 line-clamp-2 max-w-[250px]">
                              {lead.notes}
                            </p>
                          )}
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
                            statusColors[statusColorKey] || "bg-muted text-muted-foreground"
                          )}
                        >
                          {displayStatus}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            lead.licenseStatus === "licensed"
                              ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                              : lead.licenseStatus === "unknown"
                              ? "bg-gray-500/20 text-gray-400 border-gray-500/30"
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
                          {lead.source === "applications"
                            ? formatReferralSource(lead.referralSource)
                            : "Aged Lead"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {format(new Date(lead.createdAt), "MMM d, yyyy")}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <QuickAssignMenu
                            applicationId={lead.id}
                            currentAgentId={lead.assignedAgentId || null}
                            onAssigned={fetchLeads}
                          />
                          <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                            <a href={`tel:${lead.phone}`}>
                              <Phone className="h-4 w-4" />
                            </a>
                          </Button>
                          <QuickEmailMenu
                            applicationId={lead.id}
                            agentId={null}
                            licenseStatus={lead.licenseStatus as "licensed" | "unlicensed" | "pending"}
                            recipientEmail={lead.email}
                            recipientName={`${lead.firstName} ${lead.lastName}`}
                            leadSource={lead.source}
                          />
                          <ResendLicensingButton
                            recipientEmail={lead.email}
                            recipientName={`${lead.firstName} ${lead.lastName}`}
                            licenseStatus={lead.licenseStatus as "licensed" | "unlicensed" | "pending"}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        <div className="mt-4 text-sm text-muted-foreground text-center">
          Showing {filteredLeads.length} of {leads.length} leads
        </div>
      </GlassCard>

      {/* Floating Bulk Action Bar */}
      <AnimatePresence>
        {selectedLeads.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50"
          >
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-card border shadow-lg">
              <span className="text-sm font-medium">
                {selectedLeads.size} selected
              </span>
              <div className="h-4 w-px bg-border" />
              <Select value={bulkManagerId} onValueChange={setBulkManagerId}>
                <SelectTrigger className="w-48 h-9">
                  <SelectValue placeholder="Select manager..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {allManagers.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                onClick={handleBulkAssign}
                disabled={!bulkManagerId || bulkAssigning}
                size="sm"
              >
                {bulkAssigning ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Users className="h-4 w-4 mr-2" />
                )}
                Assign
              </Button>
              <Button
                variant="destructive"
                onClick={handleBulkDelete}
                disabled={bulkDeleting}
                size="sm"
              >
                {bulkDeleting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-2" />
                )}
                Delete
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={clearSelection}
                className="h-9 w-9"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
