import { useState, useEffect } from "react";
 import { motion, AnimatePresence } from "framer-motion";
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
   PhoneCall,
   Filter,
} from "lucide-react";
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
 import { CallModeInterface } from "@/components/dashboard/CallModeInterface";
 import { AgedLeadImporter } from "@/components/dashboard/AgedLeadImporter";

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
   instagramHandle?: string;
   motivation?: string;
}

interface Manager {
  id: string;
  name: string;
}

const statusColors: Record<string, string> = {
   new: "bg-primary/20 text-primary",
   contacted: "bg-secondary text-secondary-foreground",
   hired: "bg-primary/20 text-primary",
   not_qualified: "bg-destructive/20 text-destructive",
   licensing: "bg-accent text-accent-foreground",
  contracted: "bg-primary/20 text-primary",
};

export default function DashboardAgedLeads() {
  const { user, isAdmin, isManager, isLoading: authLoading } = useAuth();
  const [leads, setLeads] = useState<AgedLead[]>([]);
  const [managers, setManagers] = useState<Manager[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
   const [licenseFilter, setLicenseFilter] = useState<"all" | "licensed" | "unlicensed">("all");
   const [showImporter, setShowImporter] = useState(false);
   const [callModeOpen, setCallModeOpen] = useState(false);
   const [callModeLicense, setCallModeLicense] = useState<"licensed" | "unlicensed">("unlicensed");
   const [callModeSelectOpen, setCallModeSelectOpen] = useState(false);
   const [myAgentId, setMyAgentId] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!authLoading && user) {
      fetchLeads();
      if (isAdmin) {
        fetchManagers();
      }
       // Get current user's agent ID for call mode filtering
       fetchMyAgentId();
    }
  }, [user, authLoading]);
 
   const fetchMyAgentId = async () => {
     if (!user) return;
     const { data } = await supabase
       .from("agents")
       .select("id")
       .eq("user_id", user.id)
       .single();
     if (data) {
       setMyAgentId(data.id);
     }
   };

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
       let query = supabase
         .from("aged_leads")
         .select("id, first_name, last_name, email, phone, about_me, original_date, assigned_manager_id, status, license_status, created_at, notes, instagram_handle, motivation")
         .order("created_at", { ascending: false });

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

  const filteredLeads = leads.filter(lead => {
    const matchesSearch =
      lead.firstName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (lead.lastName?.toLowerCase().includes(searchTerm.toLowerCase()) || false) ||
      lead.email.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus = statusFilter === "all" || lead.status === statusFilter;
     const matchesLicense = licenseFilter === "all" || lead.licenseStatus === licenseFilter;

     return matchesSearch && matchesStatus && matchesLicense;
  });

  // Stats
  const totalLeads = leads.length;
  const newLeads = leads.filter(l => l.status === "new").length;
  const processedLeads = leads.filter(l => l.status !== "new").length;
  const hiredLeads = leads.filter(l => l.status === "hired" || l.status === "contracted").length;
   const licensedLeads = leads.filter(l => l.licenseStatus === "licensed" && ["new", "contacted", "no_pickup"].includes(l.status)).length;
   const unlicensedLeads = leads.filter(l => l.licenseStatus === "unlicensed" && ["new", "contacted", "no_pickup"].includes(l.status)).length;
 
   const handleOpenCallMode = (license: "licensed" | "unlicensed") => {
     setCallModeLicense(license);
     setCallModeSelectOpen(false);
     setCallModeOpen(true);
   };

  if (authLoading) {
    return (
       <div className="flex items-center justify-center h-64">
         <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
       </div>
    );
  }

  return (
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
             {/* Call Mode Button */}
             {/* Call Mode Button */}
             {(licensedLeads > 0 || unlicensedLeads > 0) && (
               <div className="relative">
                 <Button
                   onClick={() => setCallModeSelectOpen(!callModeSelectOpen)}
                   className="gap-2"
                   variant="default"
                 >
                   <PhoneCall className="h-4 w-4" />
                   Call Mode
                 </Button>
                 <AnimatePresence>
                   {callModeSelectOpen && (
                     <motion.div
                       initial={{ opacity: 0, y: -10 }}
                       animate={{ opacity: 1, y: 0 }}
                       exit={{ opacity: 0, y: -10 }}
                       className="absolute top-full right-0 mt-2 w-48 rounded-lg border border-border bg-background shadow-lg z-50"
                     >
                       {licensedLeads > 0 && (
                         <button
                           onClick={() => handleOpenCallMode("licensed")}
                           className="w-full px-4 py-3 text-left hover:bg-muted transition-colors flex justify-between items-center"
                         >
                           <span>Licensed</span>
                           <Badge variant="secondary">{licensedLeads}</Badge>
                         </button>
                       )}
                       {unlicensedLeads > 0 && (
                         <button
                           onClick={() => handleOpenCallMode("unlicensed")}
                           className="w-full px-4 py-3 text-left hover:bg-muted transition-colors flex justify-between items-center border-t border-border"
                         >
                           <span>Unlicensed</span>
                           <Badge variant="secondary">{unlicensedLeads}</Badge>
                         </button>
                       )}
                     </motion.div>
                   )}
                 </AnimatePresence>
               </div>
             )}
            {isAdmin && (
               <Button onClick={() => setShowImporter(true)} className="gap-2">
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
               <div className="p-2 rounded-lg bg-primary/20">
                 <UserPlus className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{newLeads}</p>
                <p className="text-sm text-muted-foreground">New / Unprocessed</p>
              </div>
            </div>
          </GlassCard>

          <GlassCard className="p-4">
            <div className="flex items-center gap-3">
               <div className="p-2 rounded-lg bg-secondary">
                 <Phone className="h-5 w-5 text-secondary-foreground" />
              </div>
              <div>
                <p className="text-2xl font-bold">{processedLeads}</p>
                <p className="text-sm text-muted-foreground">Processed</p>
              </div>
            </div>
          </GlassCard>

          <GlassCard className="p-4">
            <div className="flex items-center gap-3">
               <div className="p-2 rounded-lg bg-primary/20">
                 <CheckCircle2 className="h-5 w-5 text-primary" />
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
           {/* License Status Filter */}
           <div className="flex gap-2">
             <Button
               variant={licenseFilter === "all" ? "default" : "outline"}
               size="sm"
               onClick={() => setLicenseFilter("all")}
             >
               All
             </Button>
             {leads.some(l => l.licenseStatus === "licensed") && (
               <Button
                 variant={licenseFilter === "licensed" ? "default" : "outline"}
                 size="sm"
                 onClick={() => setLicenseFilter("licensed")}
                 className="gap-1"
               >
                 <CheckCircle2 className="h-3 w-3" />
                 Licensed
               </Button>
             )}
             {leads.some(l => l.licenseStatus === "unlicensed") && (
               <Button
                 variant={licenseFilter === "unlicensed" ? "default" : "outline"}
                 size="sm"
                 onClick={() => setLicenseFilter("unlicensed")}
                 className="gap-1"
               >
                 <GraduationCap className="h-3 w-3" />
                 Unlicensed
               </Button>
             )}
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
                       <Badge className={cn("text-xs", statusColors[lead.status] || "bg-secondary text-secondary-foreground")}>
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
                         className="gap-1 text-primary border-primary/30 hover:bg-primary/10"
                        onClick={() => handleStatusChange(lead.id, "hired")}
                      >
                        <CheckCircle2 className="h-3 w-3" />
                        Hired
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                         className="gap-1 text-destructive border-destructive/30 hover:bg-destructive/10"
                        onClick={() => handleStatusChange(lead.id, "not_qualified")}
                      >
                        <XCircle className="h-3 w-3" />
                        Not Qualified
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                         className="gap-1 text-accent-foreground border-accent/30 hover:bg-accent/10"
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

         {/* Call Mode Interface */}
         <CallModeInterface
           isOpen={callModeOpen}
           onClose={() => setCallModeOpen(false)}
           licenseFilter={callModeLicense}
           managerId={myAgentId}
           isAdmin={isAdmin}
           onLeadProcessed={fetchLeads}
         />
 
         {/* Enhanced Importer Modal */}
         <AgedLeadImporter
           isOpen={showImporter}
           onClose={() => setShowImporter(false)}
           managers={managers}
           onImportComplete={fetchLeads}
         />
     </div>
  );
}
