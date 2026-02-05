import { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Phone, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import {
  CallCenterFilters,
  CallCenterLeadCard,
  CallCenterActions,
  CallCenterProgressRing,
  type SourceFilter,
  type LicenseFilter,
  type StatusFilter,
  type ActionId,
  type PipelineStage,
} from "@/components/callcenter";

// Unified lead interface
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
  contactedAt?: string;
}

export default function CallCenter() {
  const { isAdmin, isManager, user } = useAuth();
  const [leads, setLeads] = useState<UnifiedLead[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [started, setStarted] = useState(false);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [currentTranscription, setCurrentTranscription] = useState("");

  // Filters
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [licenseFilter, setLicenseFilter] = useState<LicenseFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("new");

  const currentLead = leads[currentIndex];
  const totalLeads = leads.length;
  const processedCount = currentIndex;

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
          .select("id, first_name, last_name, email, phone, instagram_handle, notes, license_status, created_at, status, contacted_at")
          .is("terminated_at", null)
          .order("created_at", { ascending: true });

        // Status filter for applications
        if (statusFilter === "new") {
          appQuery = appQuery.eq("status", "new");
        } else if (statusFilter === "contacted") {
          appQuery = appQuery.eq("status", "reviewing");
        }

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
            contactedAt: app.contacted_at || undefined,
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

  // Send post-call follow-up email
  const sendFollowUpEmail = async (lead: UnifiedLead, actionType: string = "contacted") => {
    try {
      const { error } = await supabase.functions.invoke("send-post-call-followup", {
        body: {
          firstName: lead.firstName,
          email: lead.email,
          licenseStatus: lead.licenseStatus,
          actionType,
        },
      });

      if (error) {
        console.error("Failed to send follow-up email:", error);
      } else {
        console.log(`Follow-up email (${actionType}) sent to:`, lead.email);
      }
    } catch (err) {
      console.error("Error sending follow-up email:", err);
    }
  };

  // Save transcription notes
  const saveNotes = async (lead: UnifiedLead, notes: string) => {
    if (!notes.trim()) return;

    try {
      const timestamp = new Date().toISOString();
      const noteEntry = `\n\n[Call Notes - ${timestamp}]\n${notes}`;

      if (lead.source === "aged_leads") {
        const existingNotes = lead.notes || "";
        await supabase
          .from("aged_leads")
          .update({ notes: existingNotes + noteEntry })
          .eq("id", lead.id);
      } else {
        const existingNotes = lead.notes || "";
        await supabase
          .from("applications")
          .update({ notes: existingNotes + noteEntry })
          .eq("id", lead.id);
      }
    } catch (error) {
      console.error("Error saving notes:", error);
    }
  };

  const handleAction = useCallback(async (actionId: ActionId) => {
    if (!currentLead || processing) return;

    setProcessing(true);
    try {
      // Save any transcription notes first
      if (currentTranscription) {
        await saveNotes(currentLead, currentTranscription);
        setCurrentTranscription("");
      }

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
        // For applications, map status appropriately
        const updateData: Record<string, string> = {};

        if (actionId === "hired" || actionId === "contracted") {
          updateData.status = "approved";
          updateData.contracted_at = new Date().toISOString();
        } else if (actionId === "not_qualified") {
          updateData.status = "rejected";
        } else if (actionId === "licensing") {
          updateData.status = "contracting";
        } else if (actionId === "contacted") {
          updateData.status = "reviewing";
          updateData.contacted_at = new Date().toISOString();
        } else {
          updateData.status = "reviewing";
          updateData.contacted_at = new Date().toISOString();
        }

        const { error } = await supabase
          .from("applications")
          .update(updateData)
          .eq("id", currentLead.id);

        if (error) throw error;
      }

      // Send follow-up email for applicable actions
      const emailActions = ["contacted", "hired", "contracted", "licensing"];
      if (emailActions.includes(actionId)) {
        await sendFollowUpEmail(currentLead, actionId);
        toast.success(`Lead marked as ${actionId.replace("_", " ")} - follow-up email sent!`);
      } else {
        toast.success(`Lead marked as ${actionId.replace("_", " ")}`);
      }

      // Remove lead from list and move to next
      setLeads((prev) => prev.filter((l) => l.id !== currentLead.id));

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
  }, [currentLead, processing, leads.length, currentTranscription]);

  const handleSkip = useCallback(() => {
    // Save any transcription notes before skipping
    if (currentLead && currentTranscription) {
      saveNotes(currentLead, currentTranscription);
      setCurrentTranscription("");
    }

    if (currentIndex < leads.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    } else {
      toast.info("You've reached the last lead");
    }
  }, [currentIndex, leads.length, currentLead, currentTranscription]);

  const handleCall = useCallback(() => {
    if (currentLead?.phone) {
      window.open(`tel:${currentLead.phone}`, "_self");
    }
  }, [currentLead]);

  const handleStageChange = useCallback(async (stage: PipelineStage) => {
    if (!currentLead || processing) return;

    setProcessing(true);
    try {
      // Map stage back to valid application status
      type ApplicationStatus = "new" | "reviewing" | "interview" | "contracting" | "approved" | "rejected";
      
      const statusMap: Record<PipelineStage, ApplicationStatus> = {
        new: "new",
        contacted: "reviewing",
        qualified: "interview",
        contracted: "contracting",
        onboarding: "approved",
        active: "approved",
      };

      if (currentLead.source === "applications") {
        await supabase
          .from("applications")
          .update({ status: statusMap[stage] })
          .eq("id", currentLead.id);
      } else {
        await supabase
          .from("aged_leads")
          .update({ status: stage })
          .eq("id", currentLead.id);
      }

      toast.success(`Stage updated to ${stage}`);
    } catch (error) {
      console.error("Error updating stage:", error);
      toast.error("Failed to update stage");
    } finally {
      setProcessing(false);
    }
  }, [currentLead, processing]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!started) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (processing) return;

      // Ignore if typing in input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.key.toLowerCase()) {
        case "1":
          handleAction("contacted");
          break;
        case "2":
          handleAction("hired");
          break;
        case "3":
          handleAction("contracted");
          break;
        case "4":
          if (currentLead?.licenseStatus !== "licensed") handleAction("licensing");
          break;
        case "5":
          handleAction("not_qualified");
          break;
        case "6":
          handleAction("no_pickup");
          break;
        case "n":
          handleSkip();
          break;
        case "escape":
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
      <CallCenterFilters
        sourceFilter={sourceFilter}
        licenseFilter={licenseFilter}
        statusFilter={statusFilter}
        onSourceChange={setSourceFilter}
        onLicenseChange={setLicenseFilter}
        onStatusChange={setStatusFilter}
        onStart={handleStartCalling}
      />
    );
  }

  // Active calling UI
  return (
    <div className="flex flex-col h-full max-w-3xl mx-auto p-4 md:p-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between mb-6"
      >
        <div className="flex items-center gap-4">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-primary/20 to-primary/10 border border-primary/30">
            <Phone className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-foreground">Call Center</h2>
            <p className="text-sm text-muted-foreground">
              {totalLeads - processedCount} leads remaining
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <CallCenterProgressRing
            current={processedCount}
            total={totalLeads}
          />
          <Button variant="outline" onClick={() => setStarted(false)}>
            Exit
          </Button>
        </div>
      </motion.div>

      {/* Content */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          >
            <Loader2 className="h-10 w-10 text-primary" />
          </motion.div>
        </div>
      ) : !currentLead ? (
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="flex-1 flex flex-col items-center justify-center text-center"
        >
          <div className="p-6 rounded-full bg-gradient-to-br from-primary/20 to-primary/10 mb-6">
            <CheckCircle2 className="h-16 w-16 text-primary" />
          </div>
          <h3 className="text-2xl font-bold mb-2 text-foreground">All Done!</h3>
          <p className="text-muted-foreground mb-6">
            No more leads matching your filters.
          </p>
          <Button onClick={() => setStarted(false)}>Back to Filters</Button>
        </motion.div>
      ) : (
        <div className="flex-1 flex flex-col gap-6 overflow-hidden">
          {/* Lead Card */}
          <AnimatePresence mode="wait">
            <CallCenterLeadCard
              key={currentLead.id}
              lead={currentLead}
              onTranscriptionUpdate={setCurrentTranscription}
              onStageChange={handleStageChange}
              onCall={handleCall}
              isRecording={isRecording}
              onRecordingStateChange={setIsRecording}
              className="flex-1 overflow-y-auto"
            />
          </AnimatePresence>

          {/* Action Buttons */}
          <CallCenterActions
            onAction={handleAction}
            onSkip={handleSkip}
            processing={processing}
            isLicensed={currentLead.licenseStatus === "licensed"}
          />
        </div>
      )}
    </div>
  );
}
