import { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Phone, CheckCircle2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useSoundEffects } from "@/hooks/useSoundEffects";
import { ContractedModal } from "@/components/dashboard/ContractedModal";
import { ConfettiCelebration } from "@/components/dashboard/ConfettiCelebration";
import { LicenseConfirmModal } from "@/components/dashboard/LicenseConfirmModal";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CallCenterFilters,
  CallCenterLeadCard,
  CallCenterActions,
  CallCenterProgressRing,
  type SourceFilter,
  type LicenseFilter,
  type StatusFilter,
  type ProgressFilter,
  type SortOrder,
  type ActionId,
  type LicensingStage,
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
  licenseProgress?: string | null;
  testScheduledDate?: string | null;
  createdAt: string;
  status: string;
  contactedAt?: string;
  lastContactedAt?: string;
  previousCompany?: string;
  niprNumber?: string;
  licensedStates?: string[];
  city?: string;
  state?: string;
  availability?: string;
  referredBy?: string;
}

export default function CallCenter() {
  const { isAdmin, isManager, user } = useAuth();
  const { playSound } = useSoundEffects();
  const [leads, setLeads] = useState<UnifiedLead[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [started, setStarted] = useState(false);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [currentTranscription, setCurrentTranscription] = useState("");
  const [showContractedModal, setShowContractedModal] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [showLicenseConfirm, setShowLicenseConfirm] = useState(false);

  // Filters
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [licenseFilter, setLicenseFilter] = useState<LicenseFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("new");
  const [progressFilter, setProgressFilter] = useState<ProgressFilter>("all");
  const [sortOrder, setSortOrder] = useState<SortOrder>("oldest_first");

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
  }, [user?.id]);

  const fetchLeads = useCallback(async () => {
    // CRITICAL: Never fetch without agentId — unfiltered queries return all leads
    if (!agentId && !isAdmin) {
      setLeads([]);
      return;
    }

    setLoading(true);
    try {
      const allLeads: UnifiedLead[] = [];

      // Fetch aged leads if source filter allows
      if (sourceFilter === "all" || sourceFilter === "aged_leads") {
        let query = supabase
          .from("aged_leads")
          .select("id, first_name, last_name, email, phone, instagram_handle, notes, motivation, license_status, created_at, status, contacted_at, last_contacted_at, assigned_manager_id, agents!aged_leads_assigned_manager_id_fkey(display_name)")
          .order("created_at", { ascending: sortOrder === "oldest_first" });

        // Status filter (source-of-truth = contact timestamps)
        if (statusFilter === "new") {
          query = query.is("contacted_at", null);
        } else if (statusFilter === "no_pickup") {
          query = query.eq("status", "no_pickup");
        } else if (statusFilter === "contacted") {
          query = query.not("contacted_at", "is", null);
        }

        // Always exclude already-processed leads
        query = query.not("status", "in", '("contracted","hired")');

        // License filter
        if (licenseFilter !== "all") {
          query = query.eq("license_status", licenseFilter);
        }

        // Role-based filtering — always filter by current user's agent ID
        if (agentId) {
          query = query.eq("assigned_manager_id", agentId);
        }

        const { data: agedData, error: agedError } = await query;
        if (agedError) throw agedError;

        (agedData || []).forEach((lead: any) => {
          const agentData = lead.agents;
          const referredBy = agentData?.display_name || undefined;
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
            contactedAt: lead.contacted_at || undefined,
            lastContactedAt: lead.last_contacted_at || undefined,
            referredBy,
          });
        });
      }

      // Fetch applications if source filter allows
      if (sourceFilter === "all" || sourceFilter === "applications") {
        let appQuery = supabase
          .from("applications")
          .select("id, first_name, last_name, email, phone, instagram_handle, notes, license_status, license_progress, test_scheduled_date, created_at, status, contacted_at, last_contacted_at, previous_company, nipr_number, licensed_states, city, state, availability, assigned_agent_id, agents!applications_assigned_agent_id_fkey(display_name)")
          .is("terminated_at", null)
          .is("contracted_at", null)
          .order("created_at", { ascending: sortOrder === "oldest_first" });

        // Status filter for applications (source-of-truth = contact timestamps)
        if (statusFilter === "new") {
          appQuery = appQuery.is("contacted_at", null);
        } else if (statusFilter === "no_pickup") {
          appQuery = appQuery.eq("status", "no_pickup");
        } else if (statusFilter === "contacted") {
          appQuery = appQuery.not("contacted_at", "is", null).neq("status", "no_pickup");
        }

        // License filter
        if (licenseFilter !== "all") {
          appQuery = appQuery.eq("license_status", licenseFilter);
        }

        // License progress filter
        if (progressFilter !== "all") {
          appQuery = appQuery.eq("license_progress", progressFilter);
        }

        // Role-based filtering — always filter by current user's agent ID
        if (agentId) {
          appQuery = appQuery.eq("assigned_agent_id", agentId);
        }

        const { data: appData, error: appError } = await appQuery;
        if (appError) throw appError;

        (appData || []).forEach((app: any) => {
          const agentData = app.agents;
          const referredBy = agentData?.display_name || undefined;
          allLeads.push({
            id: app.id,
            source: "applications",
            firstName: app.first_name,
            lastName: app.last_name || undefined,
            email: app.email,
            phone: app.phone || undefined,
            instagramHandle: app.instagram_handle || undefined,
            notes: app.notes || undefined,
            motivation: app.notes || undefined,
            licenseStatus: app.license_status || "unknown",
            licenseProgress: app.license_progress || null,
            testScheduledDate: app.test_scheduled_date || null,
            createdAt: app.created_at,
            status: app.status || "new",
            contactedAt: app.contacted_at || undefined,
            lastContactedAt: app.last_contacted_at || undefined,
            previousCompany: app.previous_company || undefined,
            niprNumber: app.nipr_number || undefined,
            licensedStates: app.licensed_states || undefined,
            city: app.city || undefined,
            state: app.state || undefined,
            availability: app.availability || undefined,
            referredBy,
          });
        });
      }

      // Sort by created date based on sort order preference
      allLeads.sort((a, b) => {
        const timeA = new Date(a.createdAt).getTime();
        const timeB = new Date(b.createdAt).getTime();
        return sortOrder === "oldest_first" ? timeA - timeB : timeB - timeA;
      });

      setLeads(allLeads);
      setCurrentIndex(0);
    } catch (error) {
      console.error("Error fetching leads:", error);
      toast.error("Failed to load leads");
      playSound("error");
    } finally {
      setLoading(false);
    }
  }, [sourceFilter, licenseFilter, statusFilter, progressFilter, sortOrder, isAdmin, isManager, agentId]);

  const agentIdLoading = !agentId && !isAdmin && !!user;

  const handleStartCalling = () => {
    if (agentIdLoading) {
      toast.error("Still loading your profile, please wait...");
      playSound("error");
      return;
    }
    playSound("click");
    setStarted(true);
    fetchLeads();
  };

  // Send post-call follow-up email
  const sendFollowUpEmail = async (lead: UnifiedLead, actionType: string = "hired", calendarLink?: string) => {
    try {
      const { error } = await supabase.functions.invoke("send-post-call-followup", {
        body: {
          firstName: lead.firstName,
          email: lead.email,
          licenseStatus: lead.licenseStatus,
          actionType,
          ...(calendarLink ? { calendarLink } : {}),
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

  // Manual follow-up email from summary panel
  const handleSendFollowUp = useCallback(async (calendarLink?: string) => {
    if (!currentLead) return;
    try {
      await sendFollowUpEmail(currentLead, "contacted", calendarLink);
      toast.success("Follow-up email sent!");
      playSound("success");
    } catch {
      toast.error("Failed to send follow-up email");
      playSound("error");
      throw new Error("Failed");
    }
  }, [currentLead]);

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

    // For contracted action, open the modal instead
    if (actionId === "contracted") {
      setShowContractedModal(true);
      return;
    }

    // For hired action on unlicensed leads, show confirmation
    if (actionId === "hired" && currentLead.licenseStatus !== "licensed") {
      setShowLicenseConfirm(true);
      return;
    }

    await executeAction(actionId);
  }, [currentLead, processing]);

  const executeAction = useCallback(async (actionId: ActionId) => {
    if (!currentLead) return;
    
    setProcessing(true);
    try {
      // Save any transcription notes first
      if (currentTranscription) {
        await saveNotes(currentLead, currentTranscription);
        setCurrentTranscription("");
      }

      if (currentLead.source === "aged_leads") {
        const nowIso = new Date().toISOString();
        const statusMap: Record<string, string> = {
          hired: "hired",
          no_pickup: "no_pickup",
          bad_applicant: "bad_applicant",
        };
        const { error } = await supabase
          .from("aged_leads")
          .update({
            status: statusMap[actionId] || actionId,
            processed_at: nowIso,
            contacted_at: currentLead.contactedAt || nowIso,
            last_contacted_at: nowIso,
          })
          .eq("id", currentLead.id);

        if (error) throw error;
      } else {
        const nowIso = new Date().toISOString();
        const updateData: Record<string, string> = {
          contacted_at: currentLead.contactedAt || nowIso,
          last_contacted_at: nowIso,
        };

        if (actionId === "hired") {
          updateData.status = "reviewing";
        } else if (actionId === "bad_applicant") {
          updateData.status = "rejected";
        } else if (actionId === "no_pickup") {
          updateData.status = "no_pickup";
        }

        const { error } = await supabase
          .from("applications")
          .update(updateData)
          .eq("id", currentLead.id);

        if (error) throw error;
      }

      if (actionId === "hired") {
        await sendFollowUpEmail(currentLead, "hired");
        
        // Auto-send licensing instructions for unlicensed hires
        if (currentLead.licenseStatus === "unlicensed" || currentLead.licenseStatus === "unknown") {
          supabase.functions.invoke("send-licensing-instructions", {
            body: {
              email: currentLead.email,
              firstName: currentLead.firstName,
              licenseStatus: "unlicensed",
            },
          }).catch(err => console.error("Failed to send licensing instructions:", err));
        }

        // Notify all managers about the hire
        supabase.functions.invoke("notify-hire-announcement", {
          body: {
            hirerName: "Manager",
            hireeName: `${currentLead.firstName} ${currentLead.lastName || ""}`.trim(),
            actionType: "hired",
          },
        }).catch(err => console.error("Failed to send hire announcement:", err));

        setShowConfetti(true);
        setTimeout(() => setShowConfetti(false), 3000);
        toast.success("Lead marked as hired - follow-up email sent!");
        playSound("celebrate");
      } else if (actionId === "no_pickup") {
        // Auto-send "we tried calling you" email
        sendFollowUpEmail(currentLead, "no_pickup").catch(err => 
          console.error("Failed to send no-pickup follow-up:", err)
        );
        toast.info("Marked as no pickup - follow-up email sent!");
      } else {
        toast.success(`Lead marked as ${actionId.replace("_", " ")}`);
        playSound("success");
      }

      // For no_pickup, don't remove from list - just move to next
      if (actionId === "no_pickup") {
        setLeads((prev) =>
          prev.map((l) => l.id === currentLead.id ? { ...l, status: "no_pickup" } : l)
        );
        if (currentIndex < leads.length - 1) {
          setCurrentIndex((prev) => prev + 1);
        } else {
          toast.info("You've reached the last lead");
        }
      } else {
        setLeads((prev) => prev.filter((l) => l.id !== currentLead.id));
      }

      if (leads.length <= 1) {
        toast.info("All leads processed!");
      }
    } catch (error) {
      console.error("Error updating lead:", error);
      toast.error("Failed to update lead");
      playSound("error");
    } finally {
      setProcessing(false);
    }
  }, [currentLead, leads.length, currentTranscription]);

  const handleLicenseConfirm = useCallback(() => {
    setShowLicenseConfirm(false);
    executeAction("hired");
  }, [executeAction]);

  const handleContractedSuccess = useCallback(() => {
    // Remove lead from list after successful contracting
    if (currentLead) {
      setLeads((prev) => prev.filter((l) => l.id !== currentLead.id));
    }
    setShowContractedModal(false);
    
    // Trigger celebration
    setShowConfetti(true);
    setTimeout(() => setShowConfetti(false), 3000);

    if (leads.length <= 1) {
      toast.info("All leads processed!");
    }
  }, [currentLead, leads.length]);

  const handleSkip = useCallback(() => {
    // Save any transcription notes before skipping
    if (currentLead && currentTranscription) {
      saveNotes(currentLead, currentTranscription);
      setCurrentTranscription("");
    }

    if (currentIndex < leads.length - 1) {
      setCurrentIndex((prev) => prev + 1);
      playSound("whoosh");
    } else {
      toast.info("You've reached the last lead");
    }
  }, [currentIndex, leads.length, currentLead, currentTranscription]);

  const handlePrevious = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex((prev) => prev - 1);
    }
  }, [currentIndex]);

  const handleCall = useCallback(() => {
    if (currentLead?.phone) {
      window.open(`tel:${currentLead.phone}`, "_self");
    }
  }, [currentLead]);

  const handleStageChange = useCallback(async (stage: LicensingStage) => {
    if (!currentLead || processing) return;

    setProcessing(true);
    try {
      if (currentLead.source === "applications") {
        // Update license_progress for applications
        const updateData: Record<string, unknown> = {
          license_progress: stage,
        };

        // If licensed, also update license_status
        if (stage === "licensed") {
          updateData.license_status = "licensed";
        }

        await supabase
          .from("applications")
          .update(updateData)
          .eq("id", currentLead.id);
      } else {
        // For aged_leads, just update status
        await supabase
          .from("aged_leads")
          .update({ status: stage })
          .eq("id", currentLead.id);
      }

      // Update local state
      setLeads((prev) =>
        prev.map((l) =>
          l.id === currentLead.id ? { ...l, licenseProgress: stage } : l
        )
      );

      toast.success(`Stage updated to ${stage.replace("_", " ")}`);
      playSound("success");
    } catch (error) {
      console.error("Error updating stage:", error);
      toast.error("Failed to update stage");
      playSound("error");
    } finally {
      setProcessing(false);
    }
  }, [currentLead, processing]);

  const handleTestDateChange = useCallback(async (date: Date | undefined) => {
    if (!currentLead || processing || currentLead.source !== "applications") return;

    setProcessing(true);
    try {
      const dateStr = date ? date.toISOString().split("T")[0] : null;

      await supabase
        .from("applications")
        .update({ test_scheduled_date: dateStr })
        .eq("id", currentLead.id);

      // Update local state
      setLeads((prev) =>
        prev.map((l) =>
          l.id === currentLead.id ? { ...l, testScheduledDate: dateStr } : l
        )
      );

      toast.success(date ? `Test scheduled for ${date.toLocaleDateString()}` : "Test date cleared");
    } catch (error) {
      console.error("Error updating test date:", error);
      toast.error("Failed to update test date");
    } finally {
      setProcessing(false);
    }
  }, [currentLead, processing]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!started) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (processing || showContractedModal) return;

      // Ignore if typing in input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.key.toLowerCase()) {
        case "1":
          handleAction("hired");
          break;
        case "2":
          handleAction("contracted");
          break;
        case "3":
          handleAction("bad_applicant");
          break;
        case "4":
          handleAction("no_pickup");
          break;
        case "n":
          handleSkip();
          break;
        case "p":
          handlePrevious();
          break;
        case "escape":
          setStarted(false);
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [started, processing, showContractedModal, handleAction, handleSkip, handlePrevious]);

  // Filter selection UI
  if (!started) {
    return (
        <CallCenterFilters
        sourceFilter={sourceFilter}
        licenseFilter={licenseFilter}
        statusFilter={statusFilter}
        progressFilter={progressFilter}
        sortOrder={sortOrder}
        onSourceChange={setSourceFilter}
        onLicenseChange={setLicenseFilter}
        onStatusChange={setStatusFilter}
        onProgressChange={setProgressFilter}
        onSortOrderChange={setSortOrder}
        onStart={handleStartCalling}
        disabled={agentIdLoading}
      />
    );
  }

  // Active calling UI
  return (
    <div className="flex flex-col h-full w-full max-w-6xl mx-auto p-2 md:p-8 page-enter">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
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
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex-1 flex flex-col gap-6 p-6">
          {/* Skeleton loader */}
          <div className="space-y-4 rounded-2xl border border-border/50 p-6">
            <div className="flex gap-2">
              <Skeleton className="h-6 w-24 rounded-full" />
              <Skeleton className="h-6 w-20 rounded-full" />
            </div>
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-32" />
            <div className="space-y-3 pt-4">
              <Skeleton className="h-16 w-full rounded-xl" />
              <Skeleton className="h-12 w-full rounded-xl" />
              <Skeleton className="h-12 w-full rounded-xl" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="h-20 rounded-xl" />
            <Skeleton className="h-20 rounded-xl" />
          </div>
          <Skeleton className="h-14 w-full rounded-xl" />
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
              onTestDateChange={handleTestDateChange}
              onCall={handleCall}
              isRecording={isRecording}
              onRecordingStateChange={setIsRecording}
              isAdmin={isAdmin}
              onReassigned={() => {
                // Remove lead from list after reassignment
                setLeads((prev) => prev.filter((l) => l.id !== currentLead.id));
              }}
              onSendFollowUp={handleSendFollowUp}
              className="flex-1 overflow-y-auto"
            />
          </AnimatePresence>

          {/* Position indicator */}
          <div className="text-center text-sm text-muted-foreground">
            Lead {currentIndex + 1} of {totalLeads}
          </div>

          {/* Action Buttons */}
          <CallCenterActions
            onAction={handleAction}
            onSkip={handleSkip}
            onPrevious={handlePrevious}
            processing={processing}
            canGoPrevious={currentIndex > 0}
          />
        </div>
      )}

      {/* Contracted Modal */}
      {currentLead && agentId && (
        <ContractedModal
          open={showContractedModal}
          onOpenChange={setShowContractedModal}
          application={{
            id: currentLead.id,
            first_name: currentLead.firstName,
            last_name: currentLead.lastName || "",
            email: currentLead.email,
            phone: currentLead.phone || "",
            license_status: currentLead.licenseStatus as "licensed" | "unlicensed" | "pending",
            license_progress: currentLead.licenseProgress as any,
            source: currentLead.source,
          }}
          agentId={agentId}
          onSuccess={handleContractedSuccess}
        />
      )}

      {/* License Confirmation Modal */}
      {currentLead && (
        <LicenseConfirmModal
          open={showLicenseConfirm}
          onOpenChange={setShowLicenseConfirm}
          onConfirm={handleLicenseConfirm}
          applicantName={`${currentLead.firstName} ${currentLead.lastName || ""}`.trim()}
        />
      )}

      {/* Confetti Celebration */}
      <ConfettiCelebration trigger={showConfetti} />
    </div>
  );
}
