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
  Ban,
  MoreHorizontal,
  ChevronRight,
  CheckCircle,
  FileCheck,
  XCircle,
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { format, subDays } from "date-fns";
import { QuickAssignMenu } from "@/components/dashboard/QuickAssignMenu";
import { QuickEmailMenu } from "@/components/dashboard/QuickEmailMenu";
import { ResendLicensingButton } from "@/components/callcenter/ResendLicensingButton";
import { useAuth } from "@/hooks/useAuth";
import { useSoundEffects } from "@/hooks/useSoundEffects";

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
  hasContactHistory?: boolean;
  licenseProgress?: string;
  hasNotes?: boolean;
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
  const { playSound } = useSoundEffects();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [managers, setManagers] = useState<Manager[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterManager, setFilterManager] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterLicense, setFilterLicense] = useState<string>("all");
  const [filterSource, setFilterSource] = useState<"all" | "applications" | "aged_leads">("all");

  // Stats
  const [avgLeadsPerDay, setAvgLeadsPerDay] = useState(0);

  // Bulk selection state
  const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set());
  const [bulkAssigning, setBulkAssigning] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkManagerId, setBulkManagerId] = useState<string>("");

  // Ban/Delete state
  const [banTarget, setBanTarget] = useState<Lead | null>(null);
  const [banningLead, setBanningLead] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Lead | null>(null);
  const [deletingLead, setDeletingLead] = useState(false);

  const fetchLeads = async () => {
    if (!initialLoaded) setLoading(true);
    try {
      // Fetch applications
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

      // Fetch contacts
      const { data: contactedAppIds } = await supabase
        .from("contact_history")
        .select("application_id");
      const contactedSet = new Set(contactedAppIds?.map(c => c.application_id) || []);

      // Fetch agent names
      const { data: agents } = await supabase
        .from("agents")
        .select("id, user_id");

      const userIds = agents?.map((a) => a.user_id).filter(Boolean) || [];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", userIds);

      const agentNameMap: Record<string, string> = {};
      agents?.forEach((agent) => {
        const profile = profiles?.find((p) => p.user_id === agent.user_id);
        agentNameMap[agent.id] = profile?.full_name || "Unknown";
      });

      // Transform apps
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
        assignedAgentName: app.assigned_agent_id ? agentNameMap[app.assigned_agent_id] : undefined,
        createdAt: app.created_at,
        referralSource: app.referral_source || undefined,
        contactedAt: app.contacted_at || undefined,
        notes: app.notes || undefined,
        hasContactHistory: contactedSet.has(app.id),
        licenseProgress: app.license_progress || undefined,
        hasNotes: !!app.notes,
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
        assignedAgentName: lead.assigned_manager_id ? agentNameMap[lead.assigned_manager_id] : undefined,
        createdAt: lead.created_at || new Date().toISOString(),
        referralSource: undefined,
        contactedAt: lead.contacted_at || undefined,
        notes: lead.notes || lead.motivation || undefined,
      }));

      const allLeads = [...appLeads, ...aged];
      setLeads(allLeads);

      // Calc 30-day average (using allLeads creation date)
      const cutoff = subDays(new Date(), 30);
      const recentLeads = allLeads.filter(l => new Date(l.createdAt) >= cutoff).length;
      setAvgLeadsPerDay(parseFloat((recentLeads / 30).toFixed(1)));

      // Build manager list
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

  // Filter logic
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

      let matchesStatus = true;
      if (filterStatus === "all") {
        matchesStatus = true;
      } else if (filterStatus === "not_contacted") {
        const hasBeenContacted = !!lead.contactedAt || !!lead.hasContactHistory || (lead.licenseProgress && lead.licenseProgress !== 'unlicensed') || lead.hasNotes;
        matchesStatus = !hasBeenContacted && lead.status === "new";
      } else if (filterStatus === "has_contacted") {
        matchesStatus = !!lead.contactedAt || !!lead.hasContactHistory || (lead.status !== "new" && lead.status !== "not_contacted") || !!(lead.licenseProgress && lead.licenseProgress !== 'unlicensed') || !!lead.hasNotes;
      } else if (filterStatus === "contracting_only") {
        matchesStatus = lead.status === "contracting";
      } else if (filterStatus === "hired") {
        matchesStatus = lead.status === "hired" || lead.status === "approved";
      } else if (filterStatus === "contracted") {
        matchesStatus = lead.status === "contracted";
      } else if (filterStatus === "interview") {
        matchesStatus = lead.status === "interview";
      } else if (filterStatus === "qualified") {
        matchesStatus = lead.status === "qualified";
      } else {
        matchesStatus = lead.status === filterStatus;
      }

      const matchesLicense =
        filterLicense === "all" || lead.licenseStatus === filterLicense;

      const matchesSource =
        filterSource === "all" || lead.source === filterSource;

      return matchesSearch && matchesManager && matchesStatus && matchesLicense && matchesSource;
    });
  }, [leads, searchQuery, filterManager, filterStatus, filterLicense, filterSource]);

  const stats = useMemo(() => {
    return {
      newDripIns: leads.filter((l) => l.source === "applications" && l.status === "new").length,
      contacted: leads.filter((l) => !!l.contactedAt || !!l.hasContactHistory || (l.status !== "new" && l.status !== "not_contacted") || !!(l.licenseProgress && l.licenseProgress !== 'unlicensed') || !!l.hasNotes).length,
      // "Closed" matches the status filter "contracting_only"
      closed: leads.filter((l) => l.status === "contracting").length,
      licensed: leads.filter((l) => l.licenseStatus === "licensed").length,
      agedLeads: leads.filter((l) => l.source === "aged_leads").length,
    };
  }, [leads]);

  // Bulk / Delete / Ban handlers (omitted for brevity but assumed present or similar to previous)
  // Use :: as separator so UUIDs (which contain -) are never truncated
  const encodeLeadKey = (source: string, id: string) => `${source}::${id}`;
  const decodeLeadKey = (key: string): { source: string; id: string } => {
    const idx = key.indexOf("::");
    return { source: key.slice(0, idx), id: key.slice(idx + 2) };
  };

  const toggleSelectLead = useCallback((leadKey: string) => {
    setSelectedLeads((prev) => {
      const next = new Set(prev);
      if (next.has(leadKey)) {
        next.delete(leadKey);
      } else {
        next.add(leadKey);
      }
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selectedLeads.size === filteredLeads.length) {
      setSelectedLeads(new Set());
    } else {
      setSelectedLeads(new Set(filteredLeads.map((l) => encodeLeadKey(l.source, l.id))));
    }
  }, [selectedLeads.size, filteredLeads]);

  const clearSelection = useCallback(() => {
    setSelectedLeads(new Set());
    setBulkManagerId("");
  }, []);

  const handleBulkAssign = async () => {
    if (!bulkManagerId || selectedLeads.size === 0) {
      toast.error("Please select a manager to assign");
      return;
    }
    setBulkAssigning(true);
    try {
      const applicationIds: string[] = [];
      const agedLeadIds: string[] = [];
      selectedLeads.forEach((key) => {
        const { source, id } = decodeLeadKey(key);
        if (source === "applications") applicationIds.push(id);
        else agedLeadIds.push(id);
      });

      const managerId = bulkManagerId === "unassigned" ? null : bulkManagerId;

      if (applicationIds.length > 0) {
        const { error: appError } = await supabase.from("applications").update({ assigned_agent_id: managerId }).in("id", applicationIds);
        if (appError) throw appError;
      }
      if (agedLeadIds.length > 0) {
        const { error: agedError } = await supabase.from("aged_leads").update({ assigned_manager_id: managerId }).in("id", agedLeadIds);
        if (agedError) throw agedError;
      }
      toast.success(`${selectedLeads.size} leads assigned`);
      playSound("celebrate");
      clearSelection();
      fetchLeads();
    } catch (error) {
      toast.error("Failed to assign leads");
      playSound("error");
    } finally {
      setBulkAssigning(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedLeads.size === 0) return;
    if (!window.confirm(`Delete ${selectedLeads.size} leads? They will be moved to the vault.`)) return;
    setBulkDeleting(true);
    try {
      const applicationIds: string[] = [];
      const agedLeadIds: string[] = [];
      selectedLeads.forEach((key) => {
        const { source, id } = decodeLeadKey(key);
        if (source === "applications") applicationIds.push(id);
        else agedLeadIds.push(id);
      });

      // Move applications to vault then soft-delete (terminate)
      for (const id of applicationIds) {
        const lead = leads.find(l => l.id === id && l.source === "applications");
        if (!lead) continue;
        await supabase.from("deleted_leads").insert({
          original_id: id,
          source: "applications",
          first_name: lead.firstName,
          last_name: lead.lastName || null,
          email: lead.email,
          phone: lead.phone || null,
          license_status: lead.licenseStatus,
          deleted_by: user!.id,
          reason: "Bulk deleted via Lead Center",
        });
      }
      if (applicationIds.length > 0) {
        await supabase.from("applications").update({ terminated_at: new Date().toISOString(), termination_reason: "Bulk deleted via Lead Center" }).in("id", applicationIds);
      }

      // Move aged leads to vault then hard-delete
      for (const id of agedLeadIds) {
        const lead = leads.find(l => l.id === id && l.source === "aged_leads");
        if (!lead) continue;
        await supabase.from("deleted_leads").insert({
          original_id: id,
          source: "aged_leads",
          first_name: lead.firstName,
          last_name: lead.lastName || null,
          email: lead.email,
          phone: lead.phone || null,
          license_status: lead.licenseStatus,
          deleted_by: user!.id,
          reason: "Bulk deleted via Lead Center",
        });
      }
      if (agedLeadIds.length > 0) {
        await supabase.from("aged_leads").delete().in("id", agedLeadIds);
      }

      toast.success(`${selectedLeads.size} leads moved to vault`);
      playSound("success");
      setLeads(prev => prev.filter(lead => !selectedLeads.has(encodeLeadKey(lead.source, lead.id))));
      clearSelection();
    } catch (error) {
      console.error("Bulk delete error:", error);
      toast.error("Failed to delete leads");
      playSound("error");
    } finally {
      setBulkDeleting(false);
    }
  };

  const handleSingleDelete = async () => {
    if (!deleteTarget || !user) return;
    setDeletingLead(true);
    try {
      // Insert into vault
      await supabase.from("deleted_leads").insert({
        original_id: deleteTarget.id,
        source: deleteTarget.source,
        first_name: deleteTarget.firstName,
        last_name: deleteTarget.lastName || null,
        email: deleteTarget.email,
        phone: deleteTarget.phone || null,
        license_status: deleteTarget.licenseStatus,
        deleted_by: user.id,
        reason: "Deleted via Lead Center",
      });

      if (deleteTarget.source === "applications") {
        await supabase.from("applications").update({ terminated_at: new Date().toISOString(), termination_reason: "Deleted via Lead Center" }).eq("id", deleteTarget.id);
      } else {
        await supabase.from("aged_leads").delete().eq("id", deleteTarget.id);
      }

      toast.success("Lead deleted");
      playSound("success");
      setLeads(prev => prev.filter(l => l.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (error) {
      console.error("Delete error:", error);
      toast.error("Failed to delete lead");
      playSound("error");
    } finally {
      setDeletingLead(false);
    }
  };

  const handleBanLead = async () => {
    if (!banTarget || !user) return;
    setBanningLead(true);
    try {
      const normalizedPhone = banTarget.phone ? banTarget.phone.replace(/\D/g, "").slice(-10) : null;

      // Insert into banned_prospects
      const { error: banError } = await supabase.from("banned_prospects" as any).insert({
        email: banTarget.email?.toLowerCase().trim() || null,
        phone: normalizedPhone || null,
        first_name: banTarget.firstName?.toLowerCase().trim() || null,
        last_name: banTarget.lastName?.toLowerCase().trim() || null,
        reason: "Banned via Lead Center",
        banned_by: user.id,
      });
      if (banError && !banError.message?.includes("duplicate")) throw banError;

      // Delete the lead
      if (banTarget.source === "applications") {
        await supabase.from("applications").update({ terminated_at: new Date().toISOString(), termination_reason: "Banned" }).eq("id", banTarget.id);
      } else {
        await supabase.from("aged_leads").delete().eq("id", banTarget.id);
      }

      toast.success("Prospect banned");
      playSound("success");
      setLeads(prev => prev.filter(l => l.id !== banTarget.id));
      setBanTarget(null);
    } catch (error) {
      console.error("Ban error:", error);
      toast.error("Failed to ban");
      playSound("error");
    } finally {
      setBanningLead(false);
    }
  };

  const handleExport = () => {
    const headers = ["First Name", "Last Name", "Email", "Phone", "Status", "License", "Source", "Assigned To", "Created"];
    const rows = filteredLeads.map(l => [l.firstName, l.lastName, l.email, l.phone, l.status, l.licenseStatus, l.source, l.assignedAgentName || "", l.createdAt]);
    const csv = [headers.join(","), ...rows.map(r => r.map(v => `"${(v || "").replace(/"/g, '""')}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lead-center-export-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Export downloaded");
  };

  const isAllSelected = filteredLeads.length > 0 && selectedLeads.size === filteredLeads.length;
  const isPartiallySelected = selectedLeads.size > 0 && selectedLeads.size < filteredLeads.length;

  const [allManagers, setAllManagers] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    const fetchAllManagers = async () => {
      try {
        const { data } = await supabase.functions.invoke("get-active-managers");
        if (data?.managers) setAllManagers(data.managers);
      } catch (e) { console.error(e); }
    };
    fetchAllManagers();
  }, []);

  if (!isAdmin) {
    return <div className="flex items-center justify-center h-64"><p className="text-muted-foreground">Admin access required</p></div>;
  }

  return (
    <div className="space-y-6 p-4 md:p-6 page-enter">
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
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Manage all leads and assignments</span>
              <span className="w-1 h-1 rounded-full bg-border" />
              <span className="flex items-center gap-1 text-emerald-500 font-medium">
                <Target className="h-3 w-3" />
                Avg {avgLeadsPerDay} leads/day
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleExport} disabled={loading}>
            <Download className="h-4 w-4 mr-2" /> Export
          </Button>
          <Button variant="outline" size="sm" onClick={fetchLeads} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} /> Refresh
          </Button>
        </div>
      </motion.div>

      {/* Stats Cards */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="grid grid-cols-2 md:grid-cols-5 gap-4"
      >
        {[
          {
            label: "New Drip-Ins",
            value: stats.newDripIns,
            icon: Clock,
            iconColor: "text-blue-500",
            bgColor: "bg-blue-500/10",
            onClick: () => { setFilterStatus("new"); setFilterManager("all"); setFilterLicense("all"); setFilterSource("applications"); },
            active: filterStatus === "new" && filterSource === "applications",
          },
          {
            label: "Contacted",
            value: stats.contacted,
            icon: Phone,
            iconColor: "text-purple-500",
            bgColor: "bg-purple-500/10",
            onClick: () => { setFilterStatus("has_contacted"); setFilterManager("all"); setFilterLicense("all"); setFilterSource("all"); },
            active: filterStatus === "has_contacted",
          },
          {
            label: "Closed",
            value: stats.closed,
            icon: Users,
            iconColor: "text-emerald-500",
            bgColor: "bg-emerald-500/10",
            onClick: () => { setFilterStatus("contracting_only"); setFilterManager("all"); setFilterLicense("all"); setFilterSource("all"); },
            active: filterStatus === "contracting_only",
          },
          {
            label: "Licensed",
            value: stats.licensed,
            icon: Award,
            iconColor: "text-emerald-500",
            bgColor: "bg-emerald-500/10",
            onClick: () => { setFilterLicense("licensed"); setFilterManager("all"); setFilterStatus("all"); setFilterSource("all"); },
            active: filterLicense === "licensed",
          },
          {
            label: "Aged Leads",
            value: stats.agedLeads,
            icon: UserX,
            iconColor: "text-amber-500",
            bgColor: "bg-amber-500/10",
            onClick: () => { setFilterSource("aged_leads"); setFilterManager("all"); setFilterStatus("all"); setFilterLicense("all"); },
            active: filterSource === "aged_leads" && filterStatus === "all" && filterLicense === "all",
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
      <GlassCard className="p-4 sticky-filter-bar">
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
              <SelectItem value="has_contacted">Contacted</SelectItem>
              <SelectItem value="interview">Interview</SelectItem>
              <SelectItem value="qualified">Qualified</SelectItem>
              <SelectItem value="hired">Hired</SelectItem>
              <SelectItem value="contracted">Contracted</SelectItem>
              <SelectItem value="contracting_only">Closed (Contracting)</SelectItem>
              <SelectItem value="not_qualified">Not Qualified</SelectItem>
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
          <Select value={filterSource} onValueChange={(v) => setFilterSource(v as "all" | "applications" | "aged_leads")}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Lead Source" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sources</SelectItem>
              <SelectItem value="applications">New Drip-Ins</SelectItem>
              <SelectItem value="aged_leads">Aged Leads</SelectItem>
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
                  const leadKey = encodeLeadKey(lead.source, lead.id);
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
                          {(lead.status === "hired" || lead.status === "contracted") && lead.assignedAgentName
                            ? `Closed by ${lead.assignedAgentName}`
                            : displayStatus}
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
                            ? "New Drip-In"
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
                            source={lead.source}
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
                          {lead.licenseStatus !== "licensed" && (
                            <ResendLicensingButton
                              recipientEmail={lead.email}
                              recipientName={`${lead.firstName} ${lead.lastName}`}
                              licenseStatus={lead.licenseStatus as "licensed" | "unlicensed" | "pending"}
                            />
                          )}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              {lead.source === "applications" && (
                                <>
                                  {lead.status !== "contacted" && lead.status !== "hired" && lead.status !== "contracted" && (
                                    <DropdownMenuItem
                                      onClick={async () => {
                                        await supabase.from("applications").update({ contacted_at: new Date().toISOString(), last_contacted_at: new Date().toISOString() }).eq("id", lead.id);
                                        playSound("success");
                                        toast.success("Marked as contacted");
                                        fetchLeads();
                                      }}
                                      className="text-xs gap-2"
                                    >
                                      <Phone className="h-3 w-3" /> Mark Contacted
                                    </DropdownMenuItem>
                                  )}
                                  {lead.status !== "hired" && lead.status !== "contracted" && (
                                    <DropdownMenuItem
                                      onClick={async () => {
                                        await supabase.from("applications").update({ closed_at: new Date().toISOString(), contacted_at: new Date().toISOString() }).eq("id", lead.id);
                                        playSound("celebrate");
                                        toast.success("Marked as hired!");
                                        fetchLeads();
                                      }}
                                      className="text-xs gap-2"
                                    >
                                      <CheckCircle className="h-3 w-3 text-emerald-400" /> Mark Hired
                                    </DropdownMenuItem>
                                  )}
                                  {lead.status !== "contracted" && (
                                    <DropdownMenuItem
                                      onClick={async () => {
                                        await supabase.from("applications").update({ contracted_at: new Date().toISOString() }).eq("id", lead.id);
                                        playSound("celebrate");
                                        toast.success("Marked as contracted!");
                                        fetchLeads();
                                      }}
                                      className="text-xs gap-2"
                                    >
                                      <FileCheck className="h-3 w-3 text-violet-400" /> Contracted
                                    </DropdownMenuItem>
                                  )}
                                  <DropdownMenuItem
                                    onClick={async () => {
                                      await supabase.from("applications").update({ terminated_at: new Date().toISOString(), termination_reason: "Terminated via Lead Center" }).eq("id", lead.id);
                                      playSound("error");
                                      toast.success("Lead terminated");
                                      fetchLeads();
                                    }}
                                    className="text-xs gap-2 text-destructive focus:text-destructive"
                                  >
                                    <XCircle className="h-3 w-3" /> Terminate
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                </>
                              )}
                              <DropdownMenuItem
                                onClick={() => setDeleteTarget(lead)}
                                className="text-xs gap-2 text-destructive focus:text-destructive"
                              >
                                <Trash2 className="h-3 w-3" /> Delete Lead
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => setBanTarget(lead)}
                                className="text-xs gap-2 text-destructive focus:text-destructive"
                              >
                                <Ban className="h-3 w-3" /> Ban Prospect
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
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

      {/* Delete/Ban Dialogs would go here */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Lead</AlertDialogTitle>
            <AlertDialogDescription>Are you sure?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleSingleDelete} className="bg-destructive text-white">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!banTarget} onOpenChange={(open) => !open && setBanTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ban Prospect</AlertDialogTitle>
            <AlertDialogDescription>This will ban {banTarget?.firstName} {banTarget?.lastName} permanently.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleBanLead} className="bg-destructive text-white">Ban</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
