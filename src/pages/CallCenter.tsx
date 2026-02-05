import { useState, useCallback, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Phone,
  CheckCircle2,
  XCircle,
  GraduationCap,
  FileText,
  PhoneOff,
  Mail,
  Instagram,
  Loader2,
  ChevronRight,
  Filter,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDistanceToNow } from "date-fns";

// Unified lead interface for both aged_leads and applications
interface UnifiedLead {
  id: string;
  source: "aged_leads" | "applications";
  firstName: string;
  lastName?: string;
  email: string;
  phone?: string;
  instagramHandle?: string;
  notes?: string;
  motivation?: string;
  licenseStatus: string;
  createdAt: string;
  status: string;
}

type SourceFilter = "all" | "aged_leads" | "applications";
type LicenseFilter = "all" | "licensed" | "unlicensed";
type StatusFilter = "new" | "no_pickup" | "contacted";

const statusActions = [
  { id: "hired", label: "Hired", icon: CheckCircle2, color: "text-green-500 border-green-500/30 hover:bg-green-500/10", key: "1" },
  { id: "contracted", label: "Contracted", icon: FileText, color: "text-primary border-primary/30 hover:bg-primary/10", key: "2" },
  { id: "licensing", label: "Licensing", icon: GraduationCap, color: "text-purple-500 border-purple-500/30 hover:bg-purple-500/10", unlicensedOnly: true, key: "3" },
  { id: "not_qualified", label: "Not Qualified", icon: XCircle, color: "text-red-500 border-red-500/30 hover:bg-red-500/10", key: "4" },
  { id: "no_pickup", label: "No Pickup", icon: PhoneOff, color: "text-amber-500 border-amber-500/30 hover:bg-amber-500/10", key: "5" },
];

export default function CallCenter() {
  const { isAdmin, isManager, user } = useAuth();
  const [leads, setLeads] = useState<UnifiedLead[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [started, setStarted] = useState(false);
  const [agentId, setAgentId] = useState<string | null>(null);

  // Filters
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [licenseFilter, setLicenseFilter] = useState<LicenseFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("new");

  const currentLead = leads[currentIndex];
  const totalLeads = leads.length;
  const progressPercent = totalLeads > 0 ? (currentIndex / totalLeads) * 100 : 0;

  // Fetch agent ID for role-based filtering
  useEffect(() => {
    const fetchAgentId = async () => {
      if (!user) return;
      const { data } = await supabase
        .from("agents")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (data) setAgentId(data.id);
    };
    fetchAgentId();
  }, [user]);

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    try {
      const allLeads: UnifiedLead[] = [];

      // Fetch aged leads if source filter allows
      if (sourceFilter === "all" || sourceFilter === "aged_leads") {
        let query = supabase
          .from("aged_leads")
          .select("id, first_name, last_name, email, phone, instagram_handle, notes, motivation, license_status, created_at, status")
          .order("created_at", { ascending: true });

        // Status filter
        if (statusFilter === "new") {
          query = query.in("status", ["new"]);
        } else if (statusFilter === "no_pickup") {
          query = query.eq("status", "no_pickup");
        } else if (statusFilter === "contacted") {
          query = query.eq("status", "contacted");
        }

        // License filter
        if (licenseFilter !== "all") {
          query = query.eq("license_status", licenseFilter);
        }

        // Role-based filtering for managers
        if (!isAdmin && isManager && agentId) {
          query = query.eq("assigned_manager_id", agentId);
        }

        const { data: agedData, error: agedError } = await query;
        if (agedError) throw agedError;

        (agedData || []).forEach((lead) => {
          allLeads.push({
            id: lead.id,
            source: "aged_leads",
            firstName: lead.first_name,
            lastName: lead.last_name || undefined,
            email: lead.email,
            phone: lead.phone || undefined,
            instagramHandle: lead.instagram_handle || undefined,
            notes: lead.notes || undefined,
            motivation: lead.motivation || undefined,
            licenseStatus: lead.license_status || "unknown",
            createdAt: lead.created_at || new Date().toISOString(),
            status: lead.status || "new",
          });
        });
      }

      // Fetch applications if source filter allows
      if (sourceFilter === "all" || sourceFilter === "applications") {
        let appQuery = supabase
          .from("applications")
          .select("id, first_name, last_name, email, phone, instagram_handle, notes, license_status, created_at, status")
          .is("terminated_at", null)
          .order("created_at", { ascending: true });

        // Status filter for applications - map to valid application statuses
        if (statusFilter === "new") {
          appQuery = appQuery.eq("status", "new");
        } else if (statusFilter === "contacted") {
          // Use "reviewing" as the contacted equivalent for applications
          appQuery = appQuery.eq("status", "reviewing");
        }
        // Note: no_pickup isn't a valid application status, skip those

        // License filter
        if (licenseFilter !== "all") {
          appQuery = appQuery.eq("license_status", licenseFilter);
        }

        // Role-based filtering for managers
        if (!isAdmin && isManager && agentId) {
          appQuery = appQuery.eq("assigned_agent_id", agentId);
        }

        const { data: appData, error: appError } = await appQuery;
        if (appError) throw appError;

        (appData || []).forEach((app) => {
          allLeads.push({
            id: app.id,
            source: "applications",
            firstName: app.first_name,
            lastName: app.last_name || undefined,
            email: app.email,
            phone: app.phone || undefined,
            instagramHandle: app.instagram_handle || undefined,
            notes: app.notes || undefined,
            motivation: undefined,
            licenseStatus: app.license_status || "unknown",
            createdAt: app.created_at,
            status: app.status || "new",
          });
        });
      }

      // Sort by created date
      allLeads.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      setLeads(allLeads);
      setCurrentIndex(0);
    } catch (error) {
      console.error("Error fetching leads:", error);
      toast.error("Failed to load leads");
    } finally {
      setLoading(false);
    }
  }, [sourceFilter, licenseFilter, statusFilter, isAdmin, isManager, agentId]);

  const handleStartCalling = () => {
    setStarted(true);
    fetchLeads();
  };

  const handleAction = useCallback(async (actionId: string) => {
    if (!currentLead || processing) return;

    setProcessing(true);
    try {
      if (currentLead.source === "aged_leads") {
        const { error } = await supabase
          .from("aged_leads")
          .update({
            status: actionId,
            processed_at: new Date().toISOString(),
          })
          .eq("id", currentLead.id);

        if (error) throw error;
      } else {
        // For applications, map status appropriately to valid enum values
        const updateData: Record<string, any> = {};
        
        // Map action to valid application status
        if (actionId === "hired" || actionId === "contracted") {
          updateData.status = "approved";
          updateData.contracted_at = new Date().toISOString();
        } else if (actionId === "not_qualified") {
          updateData.status = "rejected";
        } else if (actionId === "licensing") {
          updateData.status = "contracting";
        } else {
          // Default: mark as reviewed
          updateData.status = "reviewing";
          updateData.contacted_at = new Date().toISOString();
        }

        const { error } = await supabase
          .from("applications")
          .update(updateData)
          .eq("id", currentLead.id);

        if (error) throw error;
      }

      // Remove lead from list and move to next
      setLeads((prev) => prev.filter((l) => l.id !== currentLead.id));
      toast.success(`Lead marked as ${actionId.replace("_", " ")}`);

      // If no more leads after removal
      if (leads.length <= 1) {
        toast.info("All leads processed!");
      }
    } catch (error) {
      console.error("Error updating lead:", error);
      toast.error("Failed to update lead");
    } finally {
      setProcessing(false);
    }
  }, [currentLead, processing, leads.length]);

  const handleSkip = useCallback(() => {
    if (currentIndex < leads.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    } else {
      toast.info("You've reached the last lead");
    }
  }, [currentIndex, leads.length]);

  const handleCall = useCallback(() => {
    if (currentLead?.phone) {
      window.open(`tel:${currentLead.phone}`, "_self");
    }
  }, [currentLead]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!started) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (processing) return;

      switch (e.key) {
        case "1":
          handleAction("hired");
          break;
        case "2":
          handleAction("contracted");
          break;
        case "3":
          if (currentLead?.licenseStatus === "unlicensed") handleAction("licensing");
          break;
        case "4":
          handleAction("not_qualified");
          break;
        case "5":
          handleAction("no_pickup");
          break;
        case "n":
        case "N":
          handleSkip();
          break;
        case "Escape":
          setStarted(false);
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [started, processing, handleAction, handleSkip, currentLead]);

  // Filter selection UI
  if (!started) {
    return (
      <div className="container max-w-2xl mx-auto py-8 px-4">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
            <Phone className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold mb-2">Call Center</h1>
          <p className="text-muted-foreground">
            Process leads one at a time with quick action buttons
          </p>
        </div>

        <GlassCard className="p-6 space-y-6">
          <div className="space-y-4">
            <h3 className="font-semibold flex items-center gap-2">
              <Filter className="h-4 w-4" />
              Configure Filters
            </h3>

            <div className="grid gap-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Lead Source</label>
                <Select value={sourceFilter} onValueChange={(v) => setSourceFilter(v as SourceFilter)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Sources</SelectItem>
                    <SelectItem value="aged_leads">Aged Leads Only</SelectItem>
                    <SelectItem value="applications">New Applicants Only</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">License Status</label>
                <Select value={licenseFilter} onValueChange={(v) => setLicenseFilter(v as LicenseFilter)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="licensed">Licensed</SelectItem>
                    <SelectItem value="unlicensed">Unlicensed</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Lead Status</label>
                <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">New / Uncontacted</SelectItem>
                    <SelectItem value="no_pickup">No Pickup (Retry)</SelectItem>
                    <SelectItem value="contacted">Contacted</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <Button onClick={handleStartCalling} className="w-full" size="lg">
            <Phone className="h-5 w-5 mr-2" />
            Start Calling
          </Button>
        </GlassCard>

        <p className="text-xs text-muted-foreground text-center mt-4">
          Keyboard shortcuts: 1-5 for actions • N for skip • ESC to exit
        </p>
      </div>
    );
  }

  // Active calling UI
  return (
    <div className="flex flex-col h-full max-w-2xl mx-auto p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Phone className="h-5 w-5 text-primary" />
            Call Center
          </h2>
          <p className="text-sm text-muted-foreground">
            {totalLeads - currentIndex} leads remaining
          </p>
        </div>
        <Button variant="outline" onClick={() => setStarted(false)}>
          Exit
        </Button>
      </div>

      {/* Progress Bar */}
      <div className="mb-6">
        <Progress value={progressPercent} className="h-2" />
        <p className="text-xs text-muted-foreground mt-1 text-right">
          {currentIndex} / {totalLeads} processed
        </p>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : !currentLead ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <CheckCircle2 className="h-16 w-16 text-green-500 mb-4" />
          <h3 className="text-2xl font-bold mb-2">All Done!</h3>
          <p className="text-muted-foreground mb-6">
            No more leads matching your filters.
          </p>
          <Button onClick={() => setStarted(false)}>Back to Filters</Button>
        </div>
      ) : (
        <>
          {/* Lead Card */}
          <GlassCard className="flex-1 p-6 mb-4 overflow-y-auto">
            <div className="space-y-4">
              {/* Source Badge */}
              <div className="flex items-center justify-between">
                <span className={cn(
                  "text-xs px-2 py-1 rounded-full font-medium",
                  currentLead.source === "aged_leads" 
                    ? "bg-amber-500/20 text-amber-500" 
                    : "bg-blue-500/20 text-blue-500"
                )}>
                  {currentLead.source === "aged_leads" ? "Aged Lead" : "New Applicant"}
                </span>
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatDistanceToNow(new Date(currentLead.createdAt), { addSuffix: true })}
                </span>
              </div>

              {/* Name */}
              <div>
                <h3 className="text-2xl font-bold">
                  {currentLead.firstName} {currentLead.lastName || ""}
                </h3>
                <span className={cn(
                  "text-xs px-2 py-0.5 rounded-full",
                  currentLead.licenseStatus === "licensed" 
                    ? "bg-green-500/20 text-green-500" 
                    : "bg-muted text-muted-foreground"
                )}>
                  {currentLead.licenseStatus === "licensed" ? "Licensed" : "Unlicensed"}
                </span>
              </div>

              {/* Contact Info */}
              <div className="space-y-3">
                <a
                  href={`mailto:${currentLead.email}`}
                  className="flex items-center gap-3 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Mail className="h-5 w-5 text-primary" />
                  <span>{currentLead.email}</span>
                </a>

                {currentLead.phone && (
                  <button
                    onClick={handleCall}
                    className="flex items-center gap-3 text-muted-foreground hover:text-foreground transition-colors w-full text-left"
                  >
                    <Phone className="h-5 w-5 text-green-500" />
                    <span className="font-medium">{currentLead.phone}</span>
                    <span className="ml-auto text-xs bg-green-500/20 text-green-500 px-2 py-1 rounded">
                      Tap to Call
                    </span>
                  </button>
                )}

                {currentLead.instagramHandle && (
                  <a
                    href={`https://instagram.com/${currentLead.instagramHandle.replace("@", "")}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Instagram className="h-5 w-5 text-pink-500" />
                    <span>@{currentLead.instagramHandle.replace("@", "")}</span>
                  </a>
                )}
              </div>

              {/* Notes / Motivation */}
              {(currentLead.notes || currentLead.motivation) && (
                <div className="pt-4 border-t border-border">
                  <p className="text-sm font-medium mb-2">Notes:</p>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {currentLead.motivation || currentLead.notes}
                  </p>
                </div>
              )}
            </div>
          </GlassCard>

          {/* Action Buttons */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
            {statusActions
              .filter((action) => !action.unlicensedOnly || currentLead.licenseStatus === "unlicensed")
              .map((action) => (
                <Button
                  key={action.id}
                  variant="outline"
                  size="lg"
                  disabled={processing}
                  onClick={() => handleAction(action.id)}
                  className={cn("gap-2 h-14 text-sm font-medium", action.color)}
                >
                  <action.icon className="h-5 w-5" />
                  {action.label}
                  <span className="text-[10px] opacity-60 ml-auto hidden sm:inline">
                    [{action.key}]
                  </span>
                </Button>
              ))}
          </div>

          {/* Skip Button */}
          <Button
            variant="ghost"
            size="lg"
            onClick={handleSkip}
            disabled={processing}
            className="w-full"
          >
            Skip to Next
            <ChevronRight className="h-4 w-4 ml-2" />
            <span className="text-[10px] opacity-60 ml-2 hidden sm:inline">[N]</span>
          </Button>

          {/* Keyboard hint */}
          <p className="text-xs text-muted-foreground text-center mt-4 hidden sm:block">
            Press 1-5 for quick actions • N for skip • ESC to exit
          </p>
        </>
      )}
    </div>
  );
}
