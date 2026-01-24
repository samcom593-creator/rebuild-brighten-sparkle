import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { format } from "date-fns";
import {
  Archive,
  Search,
  RefreshCw,
  Upload,
  UserPlus,
  X,
  CheckCircle2,
  XCircle,
  GraduationCap,
  FileText,
  Mail,
  Phone,
  ChevronDown,
  AlertCircle,
} from "lucide-react";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
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
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

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
  createdAt: string;
  notes?: string;
}

interface Manager {
  id: string;
  name: string;
}

const statusColors: Record<string, string> = {
  new: "bg-blue-500/20 text-blue-400",
  contacted: "bg-amber-500/20 text-amber-400",
  hired: "bg-green-500/20 text-green-400",
  not_qualified: "bg-red-500/20 text-red-400",
  licensing: "bg-purple-500/20 text-purple-400",
  contracted: "bg-primary/20 text-primary",
};

export default function DashboardAgedLeads() {
  const { user, isAdmin, isManager, isLoading: authLoading } = useAuth();
  const [leads, setLeads] = useState<AgedLead[]>([]);
  const [managers, setManagers] = useState<Manager[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [csvData, setCsvData] = useState("");
  const [selectedManager, setSelectedManager] = useState<string>("");

  useEffect(() => {
    if (!authLoading && user) {
      fetchLeads();
      if (isAdmin) {
        fetchManagers();
      }
    }
  }, [user, authLoading]);

  const fetchManagers = async () => {
    try {
      const { data: managerRoles } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "manager");

      if (!managerRoles?.length) return;

      const userIds = managerRoles.map(r => r.user_id);
      
      const { data: agents } = await supabase
        .from("agents")
        .select("id, user_id")
        .in("user_id", userIds)
        .eq("status", "active");

      if (!agents?.length) return;

      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", userIds);

      const profileMap = new Map(profiles?.map(p => [p.user_id, p.full_name]) || []);

      setManagers(
        agents.map(a => ({
          id: a.id,
          name: profileMap.get(a.user_id) || "Unknown Manager",
        }))
      );
    } catch (error) {
      console.error("Error fetching managers:", error);
    }
  };

  const fetchLeads = async () => {
    setLoading(true);
    try {
      let query = supabase.from("aged_leads").select("*").order("created_at", { ascending: false });

      // If manager (not admin), only show their assigned leads
      if (isManager && !isAdmin) {
        const { data: agent } = await supabase
          .from("agents")
          .select("id")
          .eq("user_id", user!.id)
          .single();

        if (agent) {
          query = query.eq("assigned_manager_id", agent.id);
        }
      }

      const { data, error } = await query;

      if (error) throw error;

      setLeads(
        (data || []).map(lead => ({
          id: lead.id,
          firstName: lead.first_name,
          lastName: lead.last_name || undefined,
          email: lead.email,
          phone: lead.phone || undefined,
          aboutMe: lead.about_me || undefined,
          originalDate: lead.original_date || undefined,
          assignedManagerId: lead.assigned_manager_id || undefined,
          status: lead.status || "new",
          licenseStatus: lead.license_status || "unknown",
          createdAt: lead.created_at,
          notes: lead.notes || undefined,
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
      const updateData: Record<string, any> = { 
        status, 
        processed_at: new Date().toISOString() 
      };

      const { error } = await supabase
        .from("aged_leads")
        .update(updateData)
        .eq("id", leadId);

      if (error) throw error;

      setLeads(prev =>
        prev.map(l => (l.id === leadId ? { ...l, status } : l))
      );

      toast.success(`Lead marked as ${status.replace("_", " ")}`);

      // If hired or contracted, could trigger transfer to CRM here
      if (status === "hired" || status === "contracted") {
        toast.info("Lead ready to be added to your CRM");
      }
    } catch (error) {
      console.error("Error updating lead status:", error);
      toast.error("Failed to update status");
    }
  };

  const handleBulkImport = async () => {
    if (!csvData.trim() || !selectedManager) {
      toast.error("Please provide CSV data and select a manager");
      return;
    }

    setImporting(true);
    try {
      const lines = csvData.trim().split("\n");
      const leadsToImport: any[] = [];

      for (const line of lines) {
        const parts = line.split(",").map(s => s.trim());
        if (parts.length >= 2) {
          const [firstName, lastName, email, phone, aboutMe, dateStr] = parts;
          leadsToImport.push({
            first_name: firstName || "Unknown",
            last_name: lastName || null,
            email: email || `unknown-${Date.now()}@placeholder.com`,
            phone: phone || null,
            about_me: aboutMe || null,
            original_date: dateStr ? new Date(dateStr).toISOString().split("T")[0] : null,
            assigned_manager_id: selectedManager,
            status: "new",
            license_status: "unknown",
          });
        }
      }

      if (leadsToImport.length === 0) {
        toast.error("No valid leads found in CSV");
        return;
      }

      const { error } = await supabase.from("aged_leads").insert(leadsToImport);

      if (error) throw error;

      toast.success(`Imported ${leadsToImport.length} aged leads`);
      setImportOpen(false);
      setCsvData("");
      setSelectedManager("");
      fetchLeads();

      // Trigger emails for each lead
      for (const lead of leadsToImport) {
        try {
          await supabase.functions.invoke("send-aged-lead-email", {
            body: { email: lead.email, firstName: lead.first_name },
          });
        } catch (e) {
          console.error("Error sending aged lead email:", e);
        }
      }
    } catch (error) {
      console.error("Error importing leads:", error);
      toast.error("Failed to import leads");
    } finally {
      setImporting(false);
    }
  };

  const filteredLeads = leads.filter(lead => {
    const matchesSearch =
      lead.firstName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (lead.lastName?.toLowerCase().includes(searchTerm.toLowerCase()) || false) ||
      lead.email.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus = statusFilter === "all" || lead.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  // Stats
  const totalLeads = leads.length;
  const newLeads = leads.filter(l => l.status === "new").length;
  const processedLeads = leads.filter(l => l.status !== "new").length;
  const hiredLeads = leads.filter(l => l.status === "hired" || l.status === "contracted").length;

  if (authLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold gradient-text">Aged Leads</h1>
            <p className="text-muted-foreground mt-1">
              Old applicants and first contact leads to follow up on
            </p>
          </div>
          <div className="flex gap-2">
            {isAdmin && (
              <Button onClick={() => setImportOpen(true)} className="gap-2">
                <Upload className="h-4 w-4" />
                Bulk Import
              </Button>
            )}
            <Button onClick={fetchLeads} variant="outline" className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <GlassCard className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/20">
                <Archive className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{totalLeads}</p>
                <p className="text-sm text-muted-foreground">Total Leads</p>
              </div>
            </div>
          </GlassCard>

          <GlassCard className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/20">
                <UserPlus className="h-5 w-5 text-blue-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{newLeads}</p>
                <p className="text-sm text-muted-foreground">New / Unprocessed</p>
              </div>
            </div>
          </GlassCard>

          <GlassCard className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/20">
                <Phone className="h-5 w-5 text-amber-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{processedLeads}</p>
                <p className="text-sm text-muted-foreground">Processed</p>
              </div>
            </div>
          </GlassCard>

          <GlassCard className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/20">
                <CheckCircle2 className="h-5 w-5 text-green-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{hiredLeads}</p>
                <p className="text-sm text-muted-foreground">Hired/Contracted</p>
              </div>
            </div>
          </GlassCard>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search leads..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="new">New</SelectItem>
              <SelectItem value="contacted">Contacted</SelectItem>
              <SelectItem value="hired">Hired</SelectItem>
              <SelectItem value="not_qualified">Not Qualified</SelectItem>
              <SelectItem value="licensing">Starting Licensing</SelectItem>
              <SelectItem value="contracted">Contracted</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Leads List */}
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : filteredLeads.length === 0 ? (
          <GlassCard className="p-12 text-center">
            <Archive className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Aged Leads Found</h3>
            <p className="text-muted-foreground">
              {isAdmin
                ? "Import aged leads using the Bulk Import button above"
                : "No aged leads have been assigned to you yet"}
            </p>
          </GlassCard>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredLeads.map((lead, index) => (
              <motion.div
                key={lead.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.03 }}
              >
                <GlassCard className="p-5 h-full flex flex-col">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-semibold">
                        {lead.firstName} {lead.lastName || ""}
                      </h3>
                      <p className="text-sm text-muted-foreground flex items-center gap-1">
                        <Mail className="h-3 w-3" />
                        {lead.email}
                      </p>
                      {lead.phone && (
                        <p className="text-sm text-muted-foreground flex items-center gap-1">
                          <Phone className="h-3 w-3" />
                          {lead.phone}
                        </p>
                      )}
                    </div>
                    <Badge className={cn("text-xs", statusColors[lead.status] || "bg-muted")}>
                      {lead.status.replace("_", " ")}
                    </Badge>
                  </div>

                  {lead.aboutMe && (
                    <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
                      {lead.aboutMe}
                    </p>
                  )}

                  {lead.originalDate && (
                    <p className="text-xs text-muted-foreground mb-3">
                      Original date: {format(new Date(lead.originalDate), "MMM d, yyyy")}
                    </p>
                  )}

                  <div className="mt-auto pt-3 border-t border-border">
                    <p className="text-xs text-muted-foreground mb-2">Quick Actions:</p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1 text-green-500 border-green-500/30 hover:bg-green-500/10"
                        onClick={() => handleStatusChange(lead.id, "hired")}
                      >
                        <CheckCircle2 className="h-3 w-3" />
                        Hired
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1 text-red-500 border-red-500/30 hover:bg-red-500/10"
                        onClick={() => handleStatusChange(lead.id, "not_qualified")}
                      >
                        <XCircle className="h-3 w-3" />
                        Not Qualified
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1 text-purple-500 border-purple-500/30 hover:bg-purple-500/10"
                        onClick={() => handleStatusChange(lead.id, "licensing")}
                      >
                        <GraduationCap className="h-3 w-3" />
                        Licensing
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1 text-primary border-primary/30 hover:bg-primary/10"
                        onClick={() => handleStatusChange(lead.id, "contracted")}
                      >
                        <FileText className="h-3 w-3" />
                        Contracted
                      </Button>
                    </div>
                  </div>
                </GlassCard>
              </motion.div>
            ))}
          </div>
        )}

        {/* Bulk Import Modal */}
        <Dialog open={importOpen} onOpenChange={setImportOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5 text-primary" />
                Bulk Import Aged Leads
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Assign to Manager</Label>
                <Select value={selectedManager} onValueChange={setSelectedManager}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a manager" />
                  </SelectTrigger>
                  <SelectContent>
                    {managers.map(m => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>CSV Data</Label>
                <p className="text-xs text-muted-foreground">
                  Format: FirstName, LastName, Email, Phone, AboutMe, OriginalDate (one per line)
                </p>
                <Textarea
                  placeholder="John, Doe, john@example.com, 555-1234, Previous sales experience, 2024-01-15"
                  value={csvData}
                  onChange={(e) => setCsvData(e.target.value)}
                  className="min-h-[200px] font-mono text-sm"
                />
              </div>

              <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 text-sm text-amber-400 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>
                  Each imported lead will automatically receive an outreach email inviting them to 
                  apply or schedule a call.
                </span>
              </div>
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={() => setImportOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleBulkImport} disabled={importing} className="gap-2">
                {importing ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                Import Leads
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
