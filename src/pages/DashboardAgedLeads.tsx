import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import {
  Archive,
  Search,
  RefreshCw,
  Upload,
  UserPlus,
  CheckCircle2,
  XCircle,
  GraduationCap,
  FileText,
  Mail,
  Phone,
  PhoneCall,
  Instagram,
  ExternalLink,
  MoreHorizontal,
  Shield,
  Ban,
  AlertTriangle,
  Trash2,
  ChevronRight,
} from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { CallModeInterface } from "@/components/dashboard/CallModeInterface";
import { AgedLeadImporter } from "@/components/dashboard/AgedLeadImporter";
import { AnimatedNumber } from "@/components/dashboard/AnimatedNumber";
import { ResendLicensingButton } from "@/components/callcenter/ResendLicensingButton";
import { useSoundEffects } from "@/hooks/useSoundEffects";
import { QuickAssignMenu } from "@/components/dashboard/QuickAssignMenu";
import { LeadDetailSheet } from "@/components/recruiter/LeadDetailSheet";

interface AgedLead {
  id: string;
  firstName: string;
  lastName?: string;
  email: string;
  phone?: string;
  aboutMe?: string;
  originalDate?: string;
  assignedManagerId?: string;
  status: string;
  licenseStatus: string;
  leadSource: "aged" | "new_drip";
  createdAt: string;
  notes?: string;
  instagramHandle?: string;
  motivation?: string;
}

interface Manager {
  id: string;
  name: string;
}

const statusConfig: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  new: { label: "New", color: "bg-primary/15 text-primary border-primary/20", icon: UserPlus },
  contacted: { label: "Contacted", color: "bg-blue-500/15 text-blue-400 border-blue-500/20", icon: Phone },
  hired: { label: "Hired", color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20", icon: CheckCircle2 },
  not_qualified: { label: "Not Qualified", color: "bg-destructive/15 text-destructive border-destructive/20", icon: XCircle },
  licensing: { label: "Licensing", color: "bg-amber-500/15 text-amber-400 border-amber-500/20", icon: GraduationCap },
  contracted: { label: "Contracted", color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20", icon: FileText },
};

function QuickAssignPanel({ managers, unassignedCount, onAssign }: {
  managers: Manager[];
  unassignedCount: number;
  onAssign: (managerId: string, count: number) => Promise<void>;
}) {
  const [selectedManager, setSelectedManager] = useState("");
  const [count, setCount] = useState(100);
  const [assigning, setAssigning] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const presets = [30, 50, 100];

  if (unassignedCount === 0) return null;

  const effectiveCount = Math.min(count, unassignedCount);
  const selectedManagerName = managers.find(m => m.id === selectedManager)?.name || "";

  const handleAssign = async () => {
    setConfirmOpen(false);
    setAssigning(true);
    await onAssign(selectedManager, effectiveCount);
    setAssigning(false);
  };

  const triggerAssign = () => {
    if (effectiveCount >= 50) {
      setConfirmOpen(true);
    } else {
      handleAssign();
    }
  };

  return (
    <>
      <GlassCard className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <UserPlus className="h-5 w-5 text-primary" />
          <span className="font-semibold text-sm">Bulk Assign</span>
          <Badge variant="outline" className="ml-1 bg-primary/15 text-primary border-primary/25 text-xs">
            {unassignedCount} unassigned
          </Badge>
        </div>
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <Select value={selectedManager} onValueChange={setSelectedManager}>
            <SelectTrigger className="w-[200px] h-9 text-sm">
              <SelectValue placeholder="Select manager..." />
            </SelectTrigger>
            <SelectContent>
              {managers.map(m => (
                <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1.5">
            {presets.map(p => (
              <Button
                key={p}
                size="sm"
                variant={count === p ? "default" : "outline"}
                className={cn("h-8 px-3 text-xs font-semibold", count === p && "shadow-sm")}
                onClick={() => setCount(Math.min(p, unassignedCount))}
                disabled={p > unassignedCount}
              >
                {p}
              </Button>
            ))}
            <Button
              size="sm"
              variant={count === unassignedCount ? "default" : "outline"}
              className={cn("h-8 px-3 text-xs font-semibold", count === unassignedCount && "shadow-sm")}
              onClick={() => setCount(unassignedCount)}
            >
              All ({unassignedCount})
            </Button>
          </div>
          <Input
            type="number"
            min={1}
            max={unassignedCount}
            value={count}
            onChange={e => setCount(Math.min(parseInt(e.target.value) || 1, unassignedCount))}
            className="w-20 h-8 text-xs text-center"
            placeholder="Custom"
          />
          <Button
            disabled={!selectedManager || assigning || effectiveCount === 0}
            onClick={triggerAssign}
            className="h-9 px-5 text-sm font-semibold"
          >
            {assigning ? <RefreshCw className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <UserPlus className="h-3.5 w-3.5 mr-1.5" />}
            Send {effectiveCount} Leads
          </Button>
        </div>
      </GlassCard>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-primary" />
              Confirm Bulk Assignment
            </AlertDialogTitle>
            <AlertDialogDescription>
              You are about to assign <strong>{effectiveCount}</strong> aged leads to <strong>{selectedManagerName}</strong>. The manager will receive an email notification. This action can be undone by reassigning leads individually.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleAssign}>
              Assign {effectiveCount} Leads
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function DashboardAgedLeads() {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const { user, isAdmin, isManager, isLoading: authLoading } = useAuth();
  const { playSound } = useSoundEffects();
  const [leads, setLeads] = useState<AgedLead[]>([]);
  const [managers, setManagers] = useState<Manager[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [licenseFilter, setLicenseFilter] = useState<"all" | "licensed" | "unlicensed">("all");
  const [showImporter, setShowImporter] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<"all" | "aged" | "new_drip">("all");
  const [callModeOpen, setCallModeOpen] = useState(false);
  const [callModeLicense, setCallModeLicense] = useState<"licensed" | "unlicensed">("unlicensed");
  const [callModeSelectOpen, setCallModeSelectOpen] = useState(false);
  const [myAgentId, setMyAgentId] = useState<string | undefined>(undefined);

  // Ban state
  const [banTarget, setBanTarget] = useState<AgedLead | null>(null);
  const [banning, setBanning] = useState(false);

  // Merge duplicates dialog state
  const [showMergeConfirm, setShowMergeConfirm] = useState(false);
  const [merging, setMerging] = useState(false);

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState<AgedLead | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [detailLead, setDetailLead] = useState<AgedLead | null>(null);

  const canAccess = isAdmin || isManager;

  useEffect(() => {
    if (!authLoading && user && canAccess) {
      fetchLeads();
      if (isAdmin) fetchManagers();
      fetchMyAgentId();
    }
  }, [user?.id, authLoading, canAccess]);

  // Access guard moved below useMemo to avoid hooks-after-return violation

  const fetchMyAgentId = async () => {
    if (!user) return;
    const { data } = await supabase.from("agents").select("id").eq("user_id", user.id).single();
    if (data) setMyAgentId(data.id);
  };

  const fetchManagers = async () => {
    try {
      const { data: managerRoles } = await supabase.from("user_roles").select("user_id").eq("role", "manager");
      if (!managerRoles?.length) return;
      const userIds = managerRoles.map(r => r.user_id);
      const { data: agents } = await supabase.from("agents").select("id, user_id").in("user_id", userIds).eq("status", "active");
      if (!agents?.length) return;
      const { data: profiles } = await supabase.from("profiles").select("user_id, full_name").in("user_id", userIds);
      const profileMap = new Map(profiles?.map(p => [p.user_id, p.full_name]) || []);
      setManagers(agents.map(a => ({ id: a.id, name: profileMap.get(a.user_id) || "Unknown Manager" })));
    } catch (error) {
      console.error("Error fetching managers:", error);
    }
  };

  const fetchLeads = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from("aged_leads")
        .select("id, first_name, last_name, email, phone, about_me, original_date, assigned_manager_id, status, license_status, lead_source, created_at, notes, instagram_handle, motivation")
        .order("created_at", { ascending: false });

      if (isManager && !isAdmin) {
        const { data: agent } = await supabase.from("agents").select("id").eq("user_id", user!.id).single();
        if (agent) query = query.eq("assigned_manager_id", agent.id);
      }

      const { data, error } = await query;
      if (error) throw error;

      setLeads(
        (data || []).map(lead => ({
          id: lead.id,
          firstName: lead.first_name,
          lastName: lead.last_name || undefined,
          email: lead.email || "",
          phone: lead.phone || undefined,
          aboutMe: lead.about_me || undefined,
          originalDate: lead.original_date || undefined,
          assignedManagerId: lead.assigned_manager_id || undefined,
          status: lead.status || "new",
          licenseStatus: lead.license_status || "unknown",
          leadSource: (lead.lead_source as "aged" | "new_drip") || "aged",
          createdAt: lead.created_at,
          notes: lead.notes || undefined,
          instagramHandle: lead.instagram_handle || undefined,
          motivation: lead.motivation || undefined,
        }))
      );
    } catch (error) {
      console.error("Error fetching aged leads:", error);
      toast.error("Failed to load aged leads");
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (leadId: string, status: string) => {
    try {
      const { error } = await supabase
        .from("aged_leads")
        .update({ status, processed_at: new Date().toISOString() })
        .eq("id", leadId);
      if (error) throw error;
      setLeads(prev => prev.map(l => (l.id === leadId ? { ...l, status } : l)));
      toast.success(`Lead marked as ${status.replace("_", " ")}`);
      playSound("success");
      if (status === "hired" || status === "contracted") {
        toast.info("Lead ready to be added to your CRM");
      }
    } catch (error) {
      console.error("Error updating lead status:", error);
      toast.error("Failed to update status");
      playSound("error");
    }
  };

  // Ban a prospect
  const handleBanProspect = async () => {
    if (!banTarget || !user) return;
    setBanning(true);
    try {
      // Normalize phone to last 10 digits
      const normalizedPhone = banTarget.phone
        ? banTarget.phone.replace(/\D/g, "").slice(-10)
        : null;

      // Insert into banned_prospects
      const { error: banError } = await supabase.from("banned_prospects" as any).insert({
        email: banTarget.email?.toLowerCase().trim() || null,
        phone: normalizedPhone || null,
        first_name: banTarget.firstName?.toLowerCase().trim() || null,
        last_name: banTarget.lastName?.toLowerCase().trim() || null,
        reason: "Banned from Aged Leads",
        banned_by: user.id,
      });

      if (banError) {
        // If duplicate email, still proceed to delete the lead
        if (!banError.message?.includes("duplicate")) throw banError;
      }

      // Delete the aged lead
      const { error: deleteError } = await supabase
        .from("aged_leads")
        .delete()
        .eq("id", banTarget.id);

      if (deleteError) throw deleteError;

      // Remove from local state
      setLeads(prev => prev.filter(l => l.id !== banTarget.id));
      toast.success(`${banTarget.firstName} ${banTarget.lastName || ""} has been banned`);
      playSound("success");
      setBanTarget(null);
    } catch (error: any) {
      console.error("Error banning prospect:", error);
      toast.error("Failed to ban prospect: " + (error.message || "Unknown error"));
      playSound("error");
    } finally {
      setBanning(false);
    }
  };

  // Delete a lead (move to vault + hard delete)
  const handleDeleteLead = async () => {
    if (!deleteTarget || !user) return;
    setDeleting(true);
    try {
      // Insert into vault (ignore duplicates)
      const { error: vaultError } = await supabase.from("deleted_leads").insert({
        original_id: deleteTarget.id,
        source: "aged_leads",
        first_name: deleteTarget.firstName,
        last_name: deleteTarget.lastName || null,
        email: deleteTarget.email,
        phone: deleteTarget.phone || null,
        license_status: deleteTarget.licenseStatus,
        deleted_by: user.id,
        reason: "Deleted via Aged Leads",
      });
      if (vaultError && !vaultError.message?.includes("duplicate")) throw vaultError;

      // Hard delete
      const { error: deleteError } = await supabase.from("aged_leads").delete().eq("id", deleteTarget.id);
      if (deleteError) throw deleteError;

      setLeads(prev => prev.filter(l => l.id !== deleteTarget.id));
      toast.success(`${deleteTarget.firstName} ${deleteTarget.lastName || ""} deleted`);
      playSound("success");
      setDeleteTarget(null);
    } catch (error: any) {
      console.error("Error deleting lead:", error);
      toast.error("Failed to delete lead: " + (error.message || "Unknown error"));
      playSound("error");
    } finally {
      setDeleting(false);
    }
  };

  // Detect duplicates within the lead list (client-side)
  const duplicateMap = useMemo(() => {
    const emailCount = new Map<string, number>();
    const phoneCount = new Map<string, number>();
    leads.forEach(lead => {
      // Only count non-empty emails for duplicate detection
      const emailKey = lead.email?.toLowerCase().trim();
      if (emailKey && emailKey.length > 0) {
        emailCount.set(emailKey, (emailCount.get(emailKey) || 0) + 1);
      }
      // Only count valid 10-digit phones
      if (lead.phone) {
        const key = lead.phone.replace(/\D/g, "").slice(-10);
        if (key.length === 10) phoneCount.set(key, (phoneCount.get(key) || 0) + 1);
      }
    });
    const dupeIds = new Set<string>();
    leads.forEach(lead => {
      const emailKey = lead.email?.toLowerCase().trim();
      const phoneKey = lead.phone?.replace(/\D/g, "").slice(-10);
      // Only flag as duplicate if the key is non-empty and appears more than once
      const emailDupe = emailKey && emailKey.length > 0 && (emailCount.get(emailKey) || 0) > 1;
      const phoneDupe = phoneKey && phoneKey.length === 10 && (phoneCount.get(phoneKey) || 0) > 1;
      if (emailDupe || phoneDupe) {
        dupeIds.add(lead.id);
      }
    });
    return dupeIds;
  }, [leads]);

  // Block agents (non-admin, non-manager) — placed after all hooks
  if (!authLoading && user && !canAccess) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Admin or Manager access required</p>
      </div>
    );
  }

  const filteredLeads = leads.filter(lead => {
    const q = searchTerm.toLowerCase();
    const matchesSearch =
      lead.firstName.toLowerCase().includes(q) ||
      (lead.lastName?.toLowerCase().includes(q) || false) ||
      lead.email.toLowerCase().includes(q) ||
      (lead.phone?.includes(q) || false) ||
      (lead.instagramHandle?.toLowerCase().includes(q) || false);

    const matchesStatus = statusFilter === "all" || lead.status === statusFilter;
    const matchesLicense = licenseFilter === "all" || lead.licenseStatus === licenseFilter;
    const matchesSource = sourceFilter === "all" || lead.leadSource === sourceFilter;

    return matchesSearch && matchesStatus && matchesLicense && matchesSource;
  });

  // Stats
  const totalLeads = leads.length;
  const newLeads = leads.filter(l => l.status === "new").length;
  const processedLeads = leads.filter(l => l.status !== "new").length;
  const hiredLeads = leads.filter(l => l.status === "hired" || l.status === "contracted").length;
  const licensedLeads = leads.filter(l => l.licenseStatus === "licensed").length;
  const unlicensedLeads = leads.filter(l => l.licenseStatus === "unlicensed").length;

  // Backend-driven dedupe: calls the dedupe-aged-leads edge function
  const handleAutoMergeDuplicates = async () => {
    if (duplicateMap.size === 0) {
      toast.info("No duplicates to merge");
      return;
    }
    setShowMergeConfirm(true);
  };

  const executeMergeDuplicates = async () => {
    setMerging(true);
    try {
      const { data, error } = await supabase.functions.invoke("dedupe-aged-leads", {
        method: "POST",
        body: {},
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(data?.message || `Merged ${data?.merged || 0} groups, removed ${data?.deleted || 0} duplicates`);
      playSound("celebrate");
      setShowMergeConfirm(false);
      fetchLeads();
    } catch (error: any) {
      console.error("Error merging duplicates:", error);
      toast.error("Failed to merge duplicates: " + (error.message || "Unknown error"));
      playSound("error");
    } finally {
      setMerging(false);
    }
  };

  const handleOpenCallMode = (license: "licensed" | "unlicensed") => {
    setCallModeLicense(license);
    setCallModeSelectOpen(false);
    setCallModeOpen(true);
  };

  const getInitials = (first: string, last?: string) => {
    return `${first.charAt(0)}${last ? last.charAt(0) : ""}`.toUpperCase();
  };

  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-5 page-enter">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-primary/10">
            <Archive className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Aged Leads</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Follow up on past applicants &amp; first-contact leads
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {(licensedLeads > 0 || unlicensedLeads > 0) && (
            <div className="relative">
              <Button onClick={() => setCallModeSelectOpen(!callModeSelectOpen)} size="sm" className="gap-1.5">
                <PhoneCall className="h-3.5 w-3.5" />
                Call Mode
              </Button>
              <AnimatePresence>
                {callModeSelectOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -8, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8, scale: 0.95 }}
                    transition={{ duration: 0.15 }}
                    className="absolute top-full right-0 mt-1.5 w-44 rounded-lg border border-border bg-card shadow-xl z-50 overflow-hidden"
                  >
                    {licensedLeads > 0 && (
                      <button
                        onClick={() => handleOpenCallMode("licensed")}
                        className="w-full px-3 py-2.5 text-sm text-left hover:bg-muted/60 transition-colors flex justify-between items-center"
                      >
                        <span className="flex items-center gap-2"><Shield className="h-3.5 w-3.5 text-emerald-400" /> Licensed</span>
                        <Badge variant="secondary" className="text-xs h-5">{licensedLeads}</Badge>
                      </button>
                    )}
                    {unlicensedLeads > 0 && (
                      <button
                        onClick={() => handleOpenCallMode("unlicensed")}
                        className="w-full px-3 py-2.5 text-sm text-left hover:bg-muted/60 transition-colors flex justify-between items-center border-t border-border/50"
                      >
                        <span className="flex items-center gap-2"><GraduationCap className="h-3.5 w-3.5 text-amber-400" /> Unlicensed</span>
                        <Badge variant="secondary" className="text-xs h-5">{unlicensedLeads}</Badge>
                      </button>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
          {isAdmin && (
            <Button onClick={() => setShowImporter(true)} size="sm" variant="outline" className="gap-1.5">
              <Upload className="h-3.5 w-3.5" />
              Import
            </Button>
          )}
          <Button onClick={fetchLeads} variant="ghost" size="sm" className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { icon: Archive, label: "Total", value: totalLeads, gradient: "from-primary/20 to-primary/5" },
          { icon: UserPlus, label: "Unprocessed", value: newLeads, gradient: "from-blue-500/20 to-blue-500/5" },
          { icon: CheckCircle2, label: "Hired", value: hiredLeads, gradient: "from-emerald-500/20 to-emerald-500/5" },
          { icon: AlertTriangle, label: "Duplicates", value: duplicateMap.size, gradient: "from-amber-500/20 to-amber-500/5" },
        ].map((stat, i) => (
          <div key={stat.label}>
            <GlassCard variant="subtle" className="p-3.5">
              <div className="flex items-center gap-3">
                <div className={cn("p-2 rounded-lg bg-gradient-to-br", stat.gradient)}>
                  <stat.icon className="h-4 w-4 text-foreground/80" />
                </div>
                <div>
                  <AnimatedNumber value={stat.value} className="text-xl font-bold" />
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                </div>
              </div>
            </GlassCard>
          </div>
        ))}
      </div>

      {/* Merge Duplicates Banner */}
      <div>
        {duplicateMap.size > 0 ? (
          <button
            onClick={handleAutoMergeDuplicates}
            className="w-full flex items-center justify-between gap-4 p-4 rounded-xl border border-amber-500/30 bg-gradient-to-r from-amber-500/15 to-orange-500/10 hover:from-amber-500/25 hover:to-orange-500/20 transition-all duration-200 group cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-amber-500/20">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
              </div>
              <div className="text-left">
                <p className="font-semibold text-foreground">Merge All Duplicates</p>
                <p className="text-sm text-muted-foreground">{duplicateMap.size} duplicate group{duplicateMap.size !== 1 ? 's' : ''} detected — keeps newest records</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center justify-center min-w-[28px] h-7 px-2 rounded-full bg-amber-500 text-amber-950 text-sm font-bold animate-pulse">
                {duplicateMap.size}
              </span>
              <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors" />
            </div>
          </button>
        ) : (
          <div className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-border/50 bg-card/30">
            <div className="p-2 rounded-lg bg-emerald-500/15">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            </div>
            <p className="text-sm text-muted-foreground">No duplicates detected</p>
          </div>
        )}
      </div>

      {/* Filters Bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search name, phone, email, Instagram..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 h-9 text-sm bg-card/50"
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {(["all", "licensed", "unlicensed"] as const).map(f => (
            <Button
              key={f}
              variant={licenseFilter === f ? "default" : "ghost"}
              size="sm"
              className={cn("h-8 text-xs px-3", licenseFilter === f && "shadow-sm")}
              onClick={() => setLicenseFilter(f)}
            >
              {f === "all" ? "All" : f === "licensed" ? "Licensed" : "Unlicensed"}
            </Button>
          ))}
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px] h-8 text-xs">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="new">New</SelectItem>
            <SelectItem value="contacted">Contacted</SelectItem>
            <SelectItem value="hired">Hired</SelectItem>
            <SelectItem value="not_qualified">Not Qualified</SelectItem>
            <SelectItem value="licensing">Licensing</SelectItem>
            <SelectItem value="contracted">Contracted</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sourceFilter} onValueChange={(v) => setSourceFilter(v as "all" | "aged" | "new_drip")}>
          <SelectTrigger className="w-[130px] h-8 text-xs">
            <SelectValue placeholder="Source" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sources</SelectItem>
            <SelectItem value="aged">Aged</SelectItem>
            <SelectItem value="new_drip">New Drip</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Quick Assign Panel */}
      {isAdmin && managers.length > 0 && (
        <QuickAssignPanel
          managers={managers}
          unassignedCount={leads.filter(l => !l.assignedManagerId).length}
          onAssign={async (managerId, count) => {
            const unassigned = leads.filter(l => !l.assignedManagerId).slice(0, count);
            if (unassigned.length === 0) {
              toast.error("No unassigned leads available");
              return;
            }
            const ids = unassigned.map(l => l.id);
            const { error } = await supabase
              .from("aged_leads")
              .update({ assigned_manager_id: managerId, status: "new" })
              .in("id", ids);
            if (error) {
              toast.error("Failed to assign leads");
              return;
            }
            // Send consolidated notification
            try {
              await supabase.functions.invoke("notify-lead-assigned", {
                body: { newAgentId: managerId, batchCount: ids.length, source: "aged_leads" },
              });
            } catch (e) { console.error("Notify error:", e); }
            toast.success(`Assigned ${ids.length} leads!`);
            playSound("celebrate");
            fetchLeads();
          }}
        />
      )}

      {/* Results Count */}
      <p className="text-xs text-muted-foreground">
        Showing {filteredLeads.length} of {totalLeads} leads
        {duplicateMap.size > 0 && (
          <span className="ml-2 text-amber-500">
            • {duplicateMap.size} potential duplicates detected
          </span>
        )}
      </p>

      {/* Leads Table */}
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filteredLeads.length === 0 ? (
        <GlassCard variant="subtle" className="p-10 text-center">
          <Archive className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
          <h3 className="text-sm font-medium mb-1">No Leads Found</h3>
          <p className="text-xs text-muted-foreground">
            {isAdmin ? "Import aged leads using the Import button" : "No aged leads assigned to you yet"}
          </p>
        </GlassCard>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden overflow-x-auto max-h-[calc(100vh-280px)] overflow-y-auto">
          <Table className="min-w-[1100px]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={selectedIds.size === filteredLeads.length && filteredLeads.length > 0}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setSelectedIds(new Set(filteredLeads.map(l => l.id)));
                      } else {
                        setSelectedIds(new Set());
                      }
                    }}
                  />
                </TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Instagram</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>License</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="w-[140px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredLeads.map((lead) => {
                const config = statusConfig[lead.status] || statusConfig.new;
                const isDuplicate = duplicateMap.has(lead.id);
                return (
                  <TableRow
                    key={lead.id}
                    className={cn(
                      "hover:bg-muted/30 transition-colors",
                      isDuplicate && "bg-amber-500/5",
                      selectedIds.has(lead.id) && "bg-primary/5"
                    )}
                  >
                    <TableCell onClick={e => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedIds.has(lead.id)}
                        onCheckedChange={(checked) => {
                          const next = new Set(selectedIds);
                          if (checked) next.add(lead.id); else next.delete(lead.id);
                          setSelectedIds(next);
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 cursor-pointer" onClick={() => setDetailLead(lead)}>
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary/30 to-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                          <span className="text-[10px] font-semibold text-primary">
                            {getInitials(lead.firstName, lead.lastName)}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate hover:text-primary transition-colors">{lead.firstName} {lead.lastName || ""}</p>
                          {lead.motivation && <p className="text-[10px] text-muted-foreground truncate max-w-[140px]">{lead.motivation}</p>}
                        </div>
                        {isDuplicate && (
                          <Badge variant="outline" className="text-[9px] h-4 px-1 bg-amber-500/10 text-amber-500 border-amber-500/20 shrink-0">
                            Dupe
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {lead.phone ? (
                        <a href={`tel:${lead.phone}`} className="text-xs text-emerald-500 hover:underline">{lead.phone}</a>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      {lead.email ? (
                        <a href={`mailto:${lead.email}`} className="text-xs text-muted-foreground hover:text-foreground truncate block max-w-[160px]">{lead.email}</a>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      {lead.instagramHandle ? (
                        <a href={`https://instagram.com/${lead.instagramHandle.replace("@","")}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-pink-400 hover:text-pink-300">
                          <Instagram className="h-3 w-3" />
                          @{lead.instagramHandle.replace("@","")}
                        </a>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn("text-[10px] h-5 px-2", config.color)}>
                        {config.label}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn("text-[10px] h-5 px-2", lead.licenseStatus === "licensed" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-muted/50 text-muted-foreground border-border/50")}>
                        {lead.licenseStatus === "licensed" ? "Licensed" : "Unlicensed"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {lead.leadSource === "new_drip" && (
                        <Badge variant="outline" className="text-[10px] h-4 px-1.5 bg-cyan-500/10 text-cyan-400 border-cyan-500/20">Drip</Badge>
                      )}
                      {lead.leadSource === "aged" && (
                        <span className="text-[10px] text-muted-foreground">Aged</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {lead.phone && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" asChild title="Call">
                            <a href={`tel:${lead.phone}`}><PhoneCall className="h-3.5 w-3.5 text-emerald-400" /></a>
                          </Button>
                        )}
                        {lead.email && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" asChild title="Email">
                            <a href={`mailto:${lead.email}`}><Mail className="h-3.5 w-3.5 text-blue-400" /></a>
                          </Button>
                        )}
                        <ResendLicensingButton
                          recipientEmail={lead.email}
                          recipientName={lead.firstName}
                          licenseStatus={lead.licenseStatus === "licensed" ? "licensed" : "unlicensed"}
                        />
                        {isAdmin && (
                          <QuickAssignMenu
                            applicationId={lead.id}
                            currentAgentId={lead.assignedManagerId || null}
                            onAssigned={fetchLeads}
                            source="aged_leads"
                            displayMode="icon"
                            className="h-7 w-7"
                          />
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem onClick={() => handleStatusChange(lead.id, "contacted")} className="text-xs gap-2">
                              <Phone className="h-3 w-3" /> Mark Contacted
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleStatusChange(lead.id, "hired")} className="text-xs gap-2">
                              <CheckCircle2 className="h-3 w-3 text-emerald-400" /> Hired
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleStatusChange(lead.id, "licensing")} className="text-xs gap-2">
                              <GraduationCap className="h-3 w-3 text-amber-400" /> Start Licensing
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleStatusChange(lead.id, "contracted")} className="text-xs gap-2">
                              <FileText className="h-3 w-3 text-emerald-400" /> Contracted
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleStatusChange(lead.id, "not_qualified")} className="text-xs gap-2 text-destructive">
                              <XCircle className="h-3 w-3" /> Not Qualified
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => setDeleteTarget(lead)} className="text-xs gap-2 text-destructive focus:text-destructive">
                              <Trash2 className="h-3 w-3" /> Delete
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setBanTarget(lead)} className="text-xs gap-2 text-destructive focus:text-destructive">
                              <Ban className="h-3 w-3" /> Ban
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
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-3 px-4 py-2.5 border-t border-border bg-muted/30 flex-wrap">
              <span className="text-xs font-medium">{selectedIds.size} selected</span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => {
                  const first100 = filteredLeads.slice(0, 100);
                  setSelectedIds(new Set(first100.map(l => l.id)));
                }}
              >
                Select 100
              </Button>
              {isAdmin && managers.length > 0 && (
                <>
                  <Select onValueChange={async (managerId) => {
                    const ids = Array.from(selectedIds);
                    const { error } = await supabase
                      .from("aged_leads")
                      .update({ assigned_manager_id: managerId, status: "new" })
                      .in("id", ids);
                    if (error) {
                      toast.error("Failed to assign");
                      playSound("error");
                      return;
                    }
                    try {
                      await supabase.functions.invoke("notify-lead-assigned", {
                        body: { newAgentId: managerId, batchCount: ids.length, source: "aged_leads" },
                      });
                    } catch {}
                    toast.success(`${ids.length} leads assigned!`);
                    playSound("celebrate");
                    setSelectedIds(new Set());
                    fetchLeads();
                  }}>
                    <SelectTrigger className="w-[160px] h-7 text-xs">
                      <SelectValue placeholder="Assign to..." />
                    </SelectTrigger>
                    <SelectContent>
                      {managers.map(m => (
                        <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              )}
              <Button
                size="sm"
                variant="destructive"
                className="h-7 text-xs"
                onClick={() => {
                  const first = filteredLeads.find(l => selectedIds.has(l.id));
                  if (first) setDeleteTarget(first);
                }}
              >
                <Trash2 className="h-3 w-3 mr-1" /> Delete Selected
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => setSelectedIds(new Set())}
              >
                Clear
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-destructive" />
              Delete Lead
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{deleteTarget?.firstName} {deleteTarget?.lastName || ""}</strong>?
              The lead will be moved to the vault and can be restored from Settings.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteLead}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting..." : "Delete Lead"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Ban Confirmation Dialog */}
      <AlertDialog open={!!banTarget} onOpenChange={(open) => !open && setBanTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Ban className="h-5 w-5 text-destructive" />
              Ban Prospect
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to ban <strong>{banTarget?.firstName} {banTarget?.lastName || ""}</strong>?
              This will permanently block their email, phone, and name from the system.
              Any future application or import matching this person will be automatically rejected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={banning}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBanProspect}
              disabled={banning}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {banning ? "Banning..." : "Ban Prospect"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Call Mode Interface */}
      <CallModeInterface
        isOpen={callModeOpen}
        onClose={() => setCallModeOpen(false)}
        licenseFilter={callModeLicense}
        managerId={myAgentId}
        isAdmin={isAdmin}
        onLeadProcessed={fetchLeads}
      />

      {/* Importer Modal */}
      <AgedLeadImporter
        isOpen={showImporter}
        onClose={() => setShowImporter(false)}
        managers={managers}
        onImportComplete={fetchLeads}
      />

      {/* Merge Duplicates Confirmation Dialog */}
      <AlertDialog open={showMergeConfirm} onOpenChange={setShowMergeConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Merge All Duplicates
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will intelligently merge <strong>{duplicateMap.size}</strong> duplicate groups — keeping the best record (latest contact, richest data) and consolidating notes from all copies. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={merging}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={executeMergeDuplicates}
              disabled={merging}
            >
              {merging ? "Merging…" : `Merge ${duplicateMap.size} Duplicate Groups`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Lead Detail Sheet */}
      {detailLead && (
        <LeadDetailSheet
          lead={{
            id: detailLead.id,
            first_name: detailLead.firstName,
            last_name: detailLead.lastName || "",
            email: detailLead.email,
            phone: detailLead.phone || "",
            city: null,
            state: null,
            created_at: detailLead.createdAt,
            last_contacted_at: null,
            contacted_at: null,
            license_status: detailLead.licenseStatus,
            license_progress: null,
            test_scheduled_date: null,
            notes: detailLead.notes || null,
            assigned_agent_id: detailLead.assignedManagerId || null,
            referral_source: detailLead.leadSource || null,
          }}
          open={!!detailLead}
          onOpenChange={(open) => !open && setDetailLead(null)}
          onRefresh={fetchLeads}
        />
      )}
    </div>
  );
}
