import { useState, useEffect } from "react";
import { useSoundEffects } from "@/hooks/useSoundEffects";
import {
  Trash2,
  RotateCcw,
  Search,
  RefreshCw,
  AlertTriangle,
  ArrowLeft,
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { format } from "date-fns";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";

interface DeletedLead {
  id: string;
  original_id: string;
  source: string;
  first_name: string;
  last_name: string | null;
  email: string;
  phone: string | null;
  city: string | null;
  state: string | null;
  license_status: string | null;
  deleted_at: string;
  reason: string | null;
  original_data: any;
}

export default function DeletedLeadsVault() {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const [deletedLeads, setDeletedLeads] = useState<DeletedLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterSource, setFilterSource] = useState<string>("all");
  const [restoring, setRestoring] = useState<string | null>(null);
  const [permanentlyDeleting, setPermanentlyDeleting] = useState<string | null>(null);
  const { playSound } = useSoundEffects();

  const fetchDeletedLeads = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("deleted_leads")
        .select("*")
        .order("deleted_at", { ascending: false });

      if (error) throw error;
      setDeletedLeads(data || []);
    } catch (error) {
      console.error("Error fetching deleted leads:", error);
      toast.error("Failed to load deleted leads"); playSound("error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) {
      fetchDeletedLeads();
    }
  }, [isAdmin]);

  const handleRestore = async (lead: DeletedLead) => {
    setRestoring(lead.id);
    try {
      if (lead.source === "applications") {
        // Restore by clearing terminated_at
        const { error } = await supabase
          .from("applications")
          .update({ terminated_at: null, termination_reason: null })
          .eq("id", lead.original_id);

        if (error) throw error;
      } else if (lead.source === "aged_leads") {
        // Re-insert the aged lead
        const originalData = lead.original_data;
        const { error } = await supabase.from("aged_leads").insert({
          id: lead.original_id,
          first_name: originalData.first_name,
          last_name: originalData.last_name,
          email: originalData.email,
          phone: originalData.phone,
          instagram_handle: originalData.instagram_handle,
          notes: originalData.notes,
          motivation: originalData.motivation,
          license_status: originalData.license_status,
          assigned_manager_id: originalData.assigned_manager_id,
          lead_source: originalData.lead_source,
          status: originalData.status,
          original_date: originalData.original_date,
        });

        if (error) throw error;
      }

      // Remove from vault
      await supabase.from("deleted_leads").delete().eq("id", lead.id);

      toast.success(`${lead.first_name} ${lead.last_name || ""} restored successfully`); playSound("success");
      fetchDeletedLeads();
    } catch (error) {
      console.error("Error restoring lead:", error);
      toast.error("Failed to restore lead"); playSound("error");
    } finally {
      setRestoring(null);
    }
  };

  const handlePermanentDelete = async (lead: DeletedLead) => {
    setPermanentlyDeleting(lead.id);
    try {
      const { error } = await supabase
        .from("deleted_leads")
        .delete()
        .eq("id", lead.id);

      if (error) throw error;

      toast.success("Lead permanently deleted"); playSound("success");
      fetchDeletedLeads();
    } catch (error) {
      console.error("Error permanently deleting lead:", error);
      toast.error("Failed to permanently delete lead"); playSound("error");
    } finally {
      setPermanentlyDeleting(null);
    }
  };

  const filteredLeads = deletedLeads.filter((lead) => {
    const matchesSearch =
      `${lead.first_name} ${lead.last_name || ""} ${lead.email}`
        .toLowerCase()
        .includes(searchQuery.toLowerCase());

    const matchesSource =
      filterSource === "all" || lead.source === filterSource;

    return matchesSearch && matchesSource;
  });

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
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/dashboard/settings")}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-destructive/20 to-destructive/10 border border-destructive/30">
            <Trash2 className="h-6 w-6 text-destructive" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Deleted Leads Vault</h1>
            <p className="text-sm text-muted-foreground">
              Restore or permanently delete leads
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchDeletedLeads}
          disabled={loading}
        >
          <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {/* Warning Banner */}
      <GlassCard className="p-4 border-amber-500/30 bg-amber-500/5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-amber-500">Warning</p>
            <p className="text-sm text-muted-foreground">
              Permanently deleting leads cannot be undone. Restored leads will be returned to their original table.
            </p>
          </div>
        </div>
      </GlassCard>

      {/* Filters */}
      <GlassCard className="p-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search deleted leads..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 bg-input"
            />
          </div>
          <Select value={filterSource} onValueChange={setFilterSource}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter by source" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sources</SelectItem>
              <SelectItem value="applications">Applications</SelectItem>
              <SelectItem value="aged_leads">Aged Leads</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </GlassCard>

      {/* Table */}
      <GlassCard className="p-4">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <RefreshCw className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : filteredLeads.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            {deletedLeads.length === 0
              ? "No deleted leads in the vault."
              : "No leads match your search."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>License</TableHead>
                  <TableHead>Deleted</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLeads.map((lead) => (
                  <TableRow key={lead.id}>
                    <TableCell className="font-medium">
                      {lead.first_name} {lead.last_name || ""}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {lead.email}
                    </TableCell>
                    <TableCell>{lead.phone || "-"}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          lead.source === "applications"
                            ? "bg-blue-500/20 text-blue-400 border-blue-500/30"
                            : "bg-amber-500/20 text-amber-400 border-amber-500/30"
                        }
                      >
                        {lead.source === "applications" ? "Application" : "Aged Lead"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          lead.license_status === "licensed"
                            ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                            : "bg-gray-500/20 text-gray-400 border-gray-500/30"
                        }
                      >
                        {lead.license_status || "Unknown"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {format(new Date(lead.deleted_at), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleRestore(lead)}
                          disabled={restoring === lead.id}
                        >
                          {restoring === lead.id ? (
                            <RefreshCw className="h-4 w-4 animate-spin" />
                          ) : (
                            <RotateCcw className="h-4 w-4 mr-1" />
                          )}
                          Restore
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="destructive"
                              size="sm"
                              disabled={permanentlyDeleting === lead.id}
                            >
                              {permanentlyDeleting === lead.id ? (
                                <RefreshCw className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Permanently Delete?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently delete {lead.first_name} {lead.last_name || ""} 
                                from the system. This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handlePermanentDelete(lead)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                Delete Forever
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <div className="mt-4 text-sm text-muted-foreground text-center">
          {filteredLeads.length} deleted leads in vault
        </div>
      </GlassCard>
    </div>
  );
}
