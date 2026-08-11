import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { AnimatePresence } from "framer-motion";
import { Phone, CheckCircle2, Sparkles, Instagram, Mail, PhoneCall, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useSoundEffects } from "@/hooks/useSoundEffects";
import { ContractedModal } from "@/components/dashboard/ContractedModal";
import { ConfettiCelebration } from "@/components/dashboard/ConfettiCelebration";
import { HireConfirmModal } from "@/components/callcenter/HireConfirmModal";
import { InterviewScheduler } from "@/components/dashboard/InterviewScheduler";
import { ApplicationDetailSheet } from "@/components/dashboard/ApplicationDetailSheet";
import { CalendarPlus, Rocket } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { getNextBestAction } from "@/lib/nextBestAction";
import { priorityBadgeClasses } from "@/lib/priority";
import { openGoogleVoice } from "@/lib/phone";
import { cn } from "@/lib/utils";
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
  type RefererFilter,
  type DateRangeFilter,
  type OwnerFilter,
  type StateFilter,
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
  hasNoReferrer?: boolean;
  assignedManagerName?: string;
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
  const confettiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (confettiTimerRef.current) clearTimeout(confettiTimerRef.current); }, []);
  const [showHireConfirm, setShowHireConfirm] = useState(false);
  // Schedule Meeting modal — Sam: "fix the schedule button, actually
  // work a schedule a meeting." It was never wired into CallCenter.
  const [showScheduleModal, setShowScheduleModal] = useState(false);

  // Filters
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [licenseFilter, setLicenseFilter] = useState<LicenseFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("new");
  const [progressFilter, setProgressFilter] = useState<ProgressFilter>("all");
  const [sortOrder, setSortOrder] = useState<SortOrder>("oldest_first");
  // Sam 2026-05-04: filter applicants by referrer attribution. Default "all"
  // so existing behavior is unchanged unless he picks "mine" or "no_referrer".
  const [refererFilter, setRefererFilter] = useState<RefererFilter>("all");
  // MP-260 additional filter axes.
  const [dateRangeFilter, setDateRangeFilter] = useState<DateRangeFilter>("all");
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>("all");
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  // MP-260 detail drawer for row-tap → expanded context (applications only).
  const [detailAppId, setDetailAppId] = useState<string | null>(null);

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
    // CRITICAL: Never fetch without agentId — unfiltered queries return all leads.
    // Admin path (Sam): bypass assigned-only and lifecycle-status filters so
    // every lead in the system stays visible. v2026-05-02-admin-bypass.
    if (!agentId && !isAdmin) {
      setLeads([]);
      return;
    }

    setLoading(true);
    try {
      const allLeads: UnifiedLead[] = [];

      // MP-260 shared date-range gate. `all` → no bound.
      const dateSinceIso = (() => {
        const day = 24 * 60 * 60 * 1000;
        const now = Date.now();
        switch (dateRangeFilter) {
          case "last_7": return new Date(now - 7 * day).toISOString();
          case "last_30": return new Date(now - 30 * day).toISOString();
          case "last_90": return new Date(now - 90 * day).toISOString();
          default: return null;
        }
      })();

      // Fetch aged leads if source filter allows
      if (sourceFilter === "all" || sourceFilter === "aged_leads") {
        // 2026-06-17 Sam directive: "the button as they start calling runs
        // way too slow." Was unbounded query against 899 aged_leads + 550
        // applications + JOIN — ~1500 rows fetched per tap. Cap at 500
        // (covers ~3 days of dial throughput for a single seat) and load
        // more on scroll if Sam needs it.
        let query = supabase
          .from("aged_leads")
          .select("id, first_name, last_name, email, phone, instagram_handle, notes, motivation, license_status, created_at, status, contacted_at, last_contacted_at, assigned_manager_id, agents!aged_leads_assigned_manager_id_fkey(display_name)")
          .order("created_at", { ascending: sortOrder === "oldest_first" })
          .limit(500);

        // Status filter (source-of-truth = contact timestamps)
        if (statusFilter === "new") {
          query = query.is("contacted_at", null);
        } else if (statusFilter === "no_pickup") {
          query = query.eq("status", "no_pickup");
        } else if (statusFilter === "contacted") {
          query = query.not("contacted_at", "is", null);
        }

        // License filter
        if (licenseFilter !== "all") {
          query = query.eq("license_status", licenseFilter);
        }

        // Role-based filtering — admins see EVERY lead regardless of who it
        // is assigned to (Sam: "I should be able to see them unless I
        // physically put them somewhere else"). Non-admins still see only
        // leads assigned to them.
        if (!isAdmin && agentId) {
          query = query.eq("assigned_manager_id", agentId);
        }

        // MP-260 axes.
        if (dateSinceIso) query = query.gte("created_at", dateSinceIso);
        if (ownerFilter === "unassigned") {
          query = query.is("assigned_manager_id", null);
        } else if (ownerFilter && ownerFilter !== "all") {
          query = query.eq("assigned_manager_id", ownerFilter);
        }

        const { data: agedData, error: agedError } = await query;
        if (agedError) throw agedError;

        (agedData || []).forEach((lead: any) => {
          const agentData = lead.agents;
          const managerName = agentData?.display_name || undefined;
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
            assignedManagerName: managerName,
          });
        });
      }

      // Fetch applications if source filter allows
      if (sourceFilter === "all" || sourceFilter === "applications") {
        // Sam 2026-04-29: hired/contracted/terminated apps must never appear
        // in the call list. He kept seeing Kyle and others he'd already
        // hired show up in the funnel because we only excluded
        // terminated_at + contracted_at; closed_at (hired) was leaking
        // through. Three-way exclusion now matches the dashboard's
        // active-funnel definition.
        // Note: no embed for the referrer agent — that FK constraint
        // (applications_referral_manager_id_fkey) doesn't exist yet, and
        // including the embed makes the entire query 400. Migration
        // 20260504143100_add_referral_manager_fk adds it; once it's applied
        // we can re-add `referrer:agents!fkname(display_name)` here.
        let appQuery = supabase
          .from("applications")
          .select("id, first_name, last_name, email, phone, instagram_handle, notes, license_status, license_progress, test_scheduled_date, created_at, status, contacted_at, last_contacted_at, previous_company, nipr_number, licensed_states, city, state, availability, assigned_agent_id, hiring_manager_user_id, referral_manager_id, terminated_at, contracted_at, closed_at, agents!applications_assigned_agent_id_fkey(display_name)")
          .order("created_at", { ascending: sortOrder === "oldest_first" })
          .limit(500);

        // Referrer filter — "mine" matches if the agent is the referrer via
        // ANY attribution column (assigned_agent_id / referral_manager_id /
        // recruiter_id). Earlier this only checked referral_manager_id, so
        // older leads where attribution was on a different column were
        // invisible to the agent who owned them. "no_referrer" means
        // genuinely orphaned (none of the 3 columns set).
        if (refererFilter === "mine" && agentId) {
          appQuery = appQuery.or(
            `assigned_agent_id.eq.${agentId},referral_manager_id.eq.${agentId},recruiter_id.eq.${agentId}`,
          );
        } else if (refererFilter === "no_referrer") {
          appQuery = appQuery
            .is("referral_manager_id", null)
            .is("assigned_agent_id", null)
            .is("recruiter_id", null);
        }

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

        // MP-260 axes for applications.
        if (dateSinceIso) appQuery = appQuery.gte("created_at", dateSinceIso);
        if (stateFilter && stateFilter !== "all") appQuery = appQuery.eq("state", stateFilter);
        if (ownerFilter === "unassigned") {
          appQuery = appQuery
            .is("assigned_agent_id", null)
            .is("referral_manager_id", null);
        } else if (ownerFilter && ownerFilter !== "all") {
          appQuery = appQuery.or(
            `assigned_agent_id.eq.${ownerFilter},referral_manager_id.eq.${ownerFilter}`,
          );
        }

        // Role-based filtering — admins see every application regardless of
        // assignment + lifecycle status (Sam wants visibility, not curation).
        // Non-admins keep the existing assigned-only + active-only filter.
        if (!isAdmin) {
          appQuery = appQuery
            .is("terminated_at", null)
            .is("contracted_at", null)
            .is("closed_at", null);
          // Non-admin scope: caller sees leads where they are referrer on ANY
          // of the 3 attribution columns. Single-column filter (the old
          // behavior) hid hot leads from KJ/managers when attribution was on
          // a different column.
          if (agentId && refererFilter !== "mine" && refererFilter !== "no_referrer") {
            appQuery = appQuery.or(
              `assigned_agent_id.eq.${agentId},referral_manager_id.eq.${agentId},recruiter_id.eq.${agentId}`,
            );
          }
        }

        const { data: appData, error: appError } = await appQuery;
        if (appError) throw appError;

        (appData || []).forEach((app: any) => {
          const agentData = app.agents;
          const managerName = agentData?.display_name || undefined;
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
            assignedManagerName: managerName,
            // Only "no referrer" if BOTH the referrer column AND the
            // assigned_agent_id are empty. A lead with a real manager
            // attached is never unattributed.
            hasNoReferrer: !app.referral_manager_id && !app.assigned_agent_id,
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
  }, [sourceFilter, licenseFilter, statusFilter, progressFilter, sortOrder, refererFilter, dateRangeFilter, ownerFilter, stateFilter, isAdmin, isManager, agentId]);

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
          agentId,
          ...(calendarLink ? { calendarLink } : {}),
        },
      });

      if (error) {
        console.error("Failed to send follow-up email:", error);
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

  // MP-260 shared log_contact_attempt helper. Fire-and-forget so a 500
  // never blocks the disposition or auto-advance. Channel default = 'call'
  // since every disposition in the workflow implies a call attempt.
  const logContactAttempt = useCallback(
    (applicationId: string, outcome: string, channel: "call" | "sms" | "email" = "call") => {
      // Wrap in Promise.resolve so the .catch is on a real Promise, not a
      // PromiseLike (Supabase v2 typings). Fire-and-forget by design.
      Promise.resolve(
        supabase.rpc("log_contact_attempt" as any, {
          p_application_id: applicationId,
          p_channel: channel,
          p_outcome: outcome,
        }),
      )
        .then(() => undefined)
        // empty-catch-allow:fire-and-forget telemetry — cannot block navigation
        .catch(() => undefined);
    },
    [],
  );

  const handleAction = useCallback(async (actionId: ActionId) => {
    if (!currentLead || processing) return;

    // For contracted action, open the modal instead
    if (actionId === "contracted") {
      setShowContractedModal(true);
      return;
    }

    // For hired action, always show the hire confirm modal
    if (actionId === "hired") {
      setShowHireConfirm(true);
      return;
    }

    // MP-260 — Reschedule opens the InterviewScheduler modal for applications.
    // For aged leads (no application_id), fall back to logging a scheduled outcome.
    if (actionId === "reschedule") {
      if (currentLead.source === "applications") {
        setShowScheduleModal(true);
      } else {
        logContactAttempt(currentLead.id, "reschedule_requested");
        toast.info("Reschedule requested — advancing");
        handleSkip();
      }
      return;
    }

    await executeAction(actionId);
  }, [currentLead, processing, logContactAttempt]);

  const executeAction = useCallback(async (actionId: ActionId) => {
    if (!currentLead) return;
    
    setProcessing(true);
    try {
      // Save any transcription notes first
      if (currentTranscription) {
        await saveNotes(currentLead, currentTranscription);
        setCurrentTranscription("");
      }

      // MP-260 disposition → outcome/channel mapping for log_contact_attempt.
      const outcomeMap: Record<string, string> = {
        hired: "hired",
        contracted: "contracted",
        bad_applicant: "not_a_fit",
        no_pickup: "no_pickup",
        contacted: "contacted",
        reschedule: "reschedule_requested",
        bad_number: "bad_number",
        needs_followup: "needs_followup",
      };

      // Log telemetry for applications — RPC only accepts application ids.
      if (currentLead.source === "applications" && outcomeMap[actionId]) {
        logContactAttempt(currentLead.id, outcomeMap[actionId]);
      }

      if (currentLead.source === "aged_leads") {
        const nowIso = new Date().toISOString();
        const statusMap: Record<string, string> = {
          hired: "hired",
          no_pickup: "no_pickup",
          bad_applicant: "bad_applicant",
          contacted: "contacted",
          bad_number: "bad_number",
          needs_followup: "needs_followup",
        };
        const patch: Record<string, string> = {
          status: statusMap[actionId] || actionId,
          processed_at: nowIso,
          contacted_at: currentLead.contactedAt || nowIso,
          last_contacted_at: nowIso,
        };
        const { error } = await supabase
          .from("aged_leads")
          .update(patch)
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
        } else if (actionId === "contacted") {
          updateData.status = "contacted";
        } else if (actionId === "needs_followup") {
          updateData.status = "contacted";
          // Bump next-action to tomorrow so the follow-up cohort catches it.
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          (updateData as Record<string, unknown>).next_action_due_at = tomorrow.toISOString();
        }

        const { error } = await supabase
          .from("applications")
          .update(updateData)
          .eq("id", currentLead.id);

        if (error) throw error;

        // Bad number → also flag phone_bad via unified RPC so the dialer
        // stops calling it. Guarded to applications since aged_leads use
        // a different column set.
        if (actionId === "bad_number") {
          Promise.resolve(
            supabase.rpc("unified_mark_phone_bad" as any, {
              p_id: currentLead.id,
              p_source: "applied",
              p_reason: "call_center_marked_bad",
            }),
          )
            .then(() => undefined)
            // empty-catch-allow:fire-and-forget — bad-number status still wins even if the RPC 500s (edge fn optional).
            .catch(() => undefined);
        }
      }

      // MP-260 outcome UX for new dispositions.
      if (actionId === "contacted") {
        toast.success("Marked contacted — advancing");
      } else if (actionId === "bad_number") {
        toast.warning("Bad number flagged — removed from queue");
      } else if (actionId === "needs_followup") {
        toast.success("Follow-up scheduled for tomorrow — advancing");
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
              agentId,
            },
          }).catch(err => console.error("Failed to send licensing instructions:", err));
        }

        // Notify all managers about the hire
        supabase.functions.invoke("notify-hire-announcement", {
          body: {
            hirerName: "Manager",
            hireeName: `${currentLead.firstName} ${currentLead.lastName || ""}`.trim(),
            actionType: "hired",
            agentId,
          },
        }).catch(err => console.error("Failed to send hire announcement:", err));

        setShowConfetti(true);
        confettiTimerRef.current = setTimeout(() => setShowConfetti(false), 3000);
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

      // For no_pickup / contacted / needs_followup, don't remove from the
      // list — just advance so the caller can loop back later.
      const advanceOnly = actionId === "no_pickup" || actionId === "contacted" || actionId === "needs_followup";
      if (advanceOnly) {
        const patchStatus = actionId === "contacted"
          ? "contacted"
          : actionId === "needs_followup"
            ? "contacted"
            : "no_pickup";
        setLeads((prev) =>
          prev.map((l) => l.id === currentLead.id ? { ...l, status: patchStatus } : l)
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
  }, [currentLead, leads.length, currentTranscription, currentIndex, logContactAttempt]);

  const handleHireConfirm = useCallback(async (boughtCourse: boolean) => {
    setShowHireConfirm(false);
    await executeAction("hired");

    // Log course purchase activity if checked
    if (boughtCourse && currentLead) {
      const { logLeadActivity } = await import("@/lib/logLeadActivity");
      logLeadActivity({
        leadId: currentLead.id,
        type: "course_purchased_on_call",
        title: "Bought course on the phone",
        details: { source: currentLead.source },
      });

      // Also update the has_training_course flag if it's an application-linked agent
      if (currentLead.source === "applications") {
        supabase
          .from("applications")
          .update({ started_training: true })
          .eq("id", currentLead.id)
          .then(({ error }) => {
            if (error) { /* console.error stripped by v25 codemod */ }
          });
      }
    }
  }, [executeAction, currentLead]);

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
    if (!currentLead?.phone) return;
    // MP-260 log the initiation so the funnel counts every dial attempt.
    if (currentLead.source === "applications") {
      logContactAttempt(currentLead.id, "initiated", "call");
    }
    // `tel:` opens the dialer on a phone, but on a desktop with no softphone
    // registered the browser silently swallows it — the agent clicks Call and
    // NOTHING happens, which is exactly what the floor reported. So we always
    // put the number on the clipboard and surface it, giving a usable action on
    // every device instead of a dead button.
    const num = currentLead.phone;
    const who =
      `${currentLead.firstName ?? ""} ${currentLead.lastName ?? ""}`.trim() ||
      "this lead";
    const isMobile = /iphone|ipad|ipod|android/i.test(navigator.userAgent);
    if (isMobile) {
      // Phone: native dialer actually rings.
      window.open(`tel:${num}`, "_self");
      return;
    }
    // Desktop: `tel:` is a dead click with no softphone registered — the exact
    // "I click Call and nothing happens" the floor reported. Open Google Voice
    // so the call actually places from the browser (caller-ID on the GV number).
    if (openGoogleVoice(num)) {
      toast.success("Opening Google Voice", {
        description: `Dialing ${who} — click Call in the tab`,
      });
      return;
    }
    // Only if GV can't dial the number: copy it so the rep can paste into ReadyMode.
    navigator.clipboard?.writeText(num).catch(() => { // empty-catch-allow:clipboard blocked in insecure context; the toast still shows the number
      /* no-op */
    });
    toast.success(`${num} copied — paste into your dialer`, {
      description: `Calling ${who}`,
    });
  }, [currentLead, logContactAttempt]);

  // Google Voice variation: place the call from voice.google.com in a new tab.
  // Works on desktop (where tel: is a dead click) and keeps caller-ID on the GV
  // number. Same funnel logging as a normal dial.
  const handleGoogleVoiceCall = useCallback(() => {
    if (!currentLead?.phone) return;
    if (currentLead.source === "applications") {
      logContactAttempt(currentLead.id, "initiated", "call");
    }
    const ok = openGoogleVoice(currentLead.phone);
    if (ok) {
      toast.success("Opening Google Voice", {
        description: `Dialing ${`${currentLead.firstName ?? ""} ${currentLead.lastName ?? ""}`.trim() || "this lead"} — click Call in the tab`,
      });
    } else {
      toast.error("That number isn't dialable");
    }
  }, [currentLead, logContactAttempt]);

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

  const handleStatusChange = useCallback(async (newStatus: string) => {
    if (!currentLead || processing) return;

    setProcessing(true);
    try {
      const nowIso = new Date().toISOString();

      if (currentLead.source === "aged_leads") {
        const { error } = await supabase
          .from("aged_leads")
          .update({ status: newStatus, last_contacted_at: nowIso })
          .eq("id", currentLead.id);
        if (error) throw error;
      } else {
        const updateData: Record<string, string> = { status: newStatus, last_contacted_at: nowIso };
        if (newStatus === "contacted" && !currentLead.contactedAt) {
          updateData.contacted_at = nowIso;
        }
        const { error } = await supabase
          .from("applications")
          .update(updateData)
          .eq("id", currentLead.id);
        if (error) throw error;
      }

      setLeads((prev) =>
        prev.map((l) => l.id === currentLead.id ? { ...l, status: newStatus } : l)
      );
      toast.success(`Status updated to ${newStatus.replace("_", " ")}`);
      playSound("success");
    } catch (error) {
      console.error("Error updating status:", error);
      toast.error("Failed to update status");
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

      // Ignore modifier chords + non-mapped keys. MP-260 shortcut map:
      // 1 Hired · 2 Contracted · 3 Not a Fit · 4 No Pickup · 5 Contacted ·
      // 6 Reschedule · 7 Bad Number · 8 Needs Follow-Up · N Next · P Prev · Esc Exit.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
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
        case "5":
          handleAction("contacted");
          break;
        case "6":
          handleAction("reschedule");
          break;
        case "7":
          handleAction("bad_number");
          break;
        case "8":
          handleAction("needs_followup");
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

  // MP-260 NBA + priority for the current lead. Signals mapped from the
  // unified lead shape — never invented, always safe fallbacks for missing.
  //
  // MUST stay above the `if (!started)` early return below. It used to sit
  // after it, which meant this hook ran only on renders where a session was
  // started — so pressing "Start" changed the hook count between renders and
  // React threw #310 ("Rendered more hooks than during the previous render").
  // That crash is in error_logs 13 times across 2 real users on
  // /dashboard/call-center. Hooks run unconditionally or they do not run at all.
  const currentNba = useMemo(() => {
    if (!currentLead) return null;
    const licProgress = currentLead.licenseProgress ?? null;
    return getNextBestAction({
      kind: "applicant",
      is_new_applicant: !currentLead.contactedAt,
      no_contact_logged: !currentLead.contactedAt,
      passed_test: licProgress === "passed_test",
      waiting_on_license: licProgress === "waiting_on_license",
      course_bought: licProgress === "course_purchased" || licProgress === "course_started",
      referred_by_active_producer: !!currentLead.referredBy,
      applicant_name: `${currentLead.firstName} ${currentLead.lastName ?? ""}`.trim(),
      license_status: currentLead.licenseStatus,
      license_progress: licProgress ?? undefined,
    });
  }, [currentLead]);

  // Filter selection UI
  if (!started) {
    return (
        <CallCenterFilters
        sourceFilter={sourceFilter}
        licenseFilter={licenseFilter}
        statusFilter={statusFilter}
        progressFilter={progressFilter}
        sortOrder={sortOrder}
        refererFilter={refererFilter}
        dateRangeFilter={dateRangeFilter}
        ownerFilter={ownerFilter}
        stateFilter={stateFilter}
        onSourceChange={setSourceFilter}
        onLicenseChange={setLicenseFilter}
        onStatusChange={setStatusFilter}
        onProgressChange={setProgressFilter}
        onSortOrderChange={setSortOrder}
        onRefererChange={setRefererFilter}
        onDateRangeChange={setDateRangeFilter}
        onOwnerChange={setOwnerFilter}
        onStateChange={setStateFilter}
        onStart={handleStartCalling}
        disabled={agentIdLoading}
      />
    );
  }

  const currentBadge = currentNba ? priorityBadgeClasses(currentNba.priority) : null;

  // Active calling UI
  return (
    <div className="page-enter mx-auto w-full max-w-6xl space-y-5 px-4 pb-24 sm:px-6">
      <PageHeader
        accent="cyan"
        eyebrow="Recruiting · Dial session"
        eyebrowIcon={<Phone className="h-3 w-3" />}
        title="Call Center"
        subtitle={
          <span className="tabular-nums">
            {totalLeads - processedCount} leads remaining · {processedCount} processed
          </span>
        }
        actions={
          <>
            <CallCenterProgressRing
              current={processedCount}
              total={totalLeads}
            />
            <Button
              variant="outline"
              className="h-10 sm:h-9"
              onClick={() => setStarted(false)}
              aria-label="Exit call center"
            >
              Exit
            </Button>
          </>
        }
      />

      {/* Content */}
      {loading ? (
        <div className="space-y-5">
          <GlassCard className="p-4">
            <div className="flex gap-2">
              <Skeleton className="h-6 w-24 rounded-full" />
              <Skeleton className="h-6 w-20 rounded-full" />
            </div>
            <Skeleton className="mt-3 h-6 w-48" />
            <Skeleton className="mt-2 h-4 w-32" />
            <div className="mt-3 space-y-2">
              <Skeleton className="h-16 w-full rounded-lg" />
              <Skeleton className="h-12 w-full rounded-lg" />
              <Skeleton className="h-12 w-full rounded-lg" />
            </div>
          </GlassCard>
          <GlassCard className="p-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Skeleton className="h-20 rounded-lg" />
              <Skeleton className="h-20 rounded-lg" />
              <Skeleton className="h-20 rounded-lg" />
              <Skeleton className="h-20 rounded-lg" />
            </div>
          </GlassCard>
        </div>
      ) : !currentLead ? (
        <EmptyState
          icon={<CheckCircle2 className="h-7 w-7" />}
          variant="success"
          title="No leads left in this queue"
          description="Every lead matching your filters has been worked. Head back and widen the filters to keep dialing."
          actions={
            <Button
              className="h-10 w-full sm:h-9 sm:w-auto"
              onClick={() => setStarted(false)}
            >
              Back to filters
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
          {/* CALL PANEL — left column on desktop, stacked on mobile */}
          <div className="flex min-w-0 flex-col gap-3">
            {/* Priority + NBA strip */}
            {currentBadge && currentNba && (
              <GlassCard className="p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-start gap-2">
                    <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn(
                          "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                          currentBadge.className,
                        )}>
                          {currentBadge.text}
                        </span>
                        <span className="min-w-0 truncate text-sm font-medium text-foreground">
                          Next best action: {currentNba.action}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {currentNba.reason}
                      </p>
                    </div>
                  </div>
                  {currentLead?.phone && (
                    <div className="flex w-full shrink-0 gap-2 sm:w-auto">
                      <Button
                        onClick={handleCall}
                        aria-label={`Call ${currentLead.firstName} now`}
                        className="h-10 flex-1 sm:h-9 sm:w-auto sm:flex-none"
                      >
                        <PhoneCall className="mr-1.5 h-4 w-4" />
                        Call Now
                      </Button>
                      <Button
                        onClick={handleGoogleVoiceCall}
                        variant="outline"
                        aria-label={`Call ${currentLead.firstName} via Google Voice`}
                        title="Call via Google Voice"
                        className="h-10 shrink-0 sm:h-9"
                      >
                        <Phone className="mr-1.5 h-4 w-4" />
                        Voice
                      </Button>
                    </div>
                  )}
                </div>
              </GlassCard>
            )}

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
                  setLeads((prev) => prev.filter((l) => l.id !== currentLead.id));
                }}
                onSendFollowUp={handleSendFollowUp}
                onStatusChange={handleStatusChange}
                className="min-w-0 flex-1 overflow-y-auto"
              />
            </AnimatePresence>

            {/* Disposition — 8-button grid + secondary actions */}
            <GlassCard className="p-4">
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
                  <PhoneCall className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">Disposition</span>
                </h3>
                {/* Position indicator */}
                <span className="shrink-0 text-sm font-bold tabular-nums text-muted-foreground">
                  Lead {currentIndex + 1} of {totalLeads}
                </span>
              </div>
              <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
                Log the outcome and the queue advances on its own. Keys 1 to 8 fire the same
                eight buttons without leaving the keyboard.
              </p>

              {/* 8-button disposition grid */}
              <CallCenterActions
                onAction={handleAction}
                onSkip={handleSkip}
                onPrevious={handlePrevious}
                processing={processing}
                canGoPrevious={currentIndex > 0}
              />

              {/* Secondary actions row — schedule meeting + open detail drawer */}
              {currentLead?.source === "applications" && (
                <div className="mt-3 flex flex-col gap-2 border-t border-border/60 pt-3 sm:flex-row sm:flex-wrap">
                  <Button
                    variant="outline"
                    onClick={() => setShowScheduleModal(true)}
                    disabled={processing}
                    aria-label={`Schedule meeting with ${currentLead.firstName}`}
                    className="h-10 w-full gap-2 sm:h-9 sm:w-auto"
                  >
                    <CalendarPlus className="h-4 w-4" />
                    Schedule a meeting
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setDetailAppId(currentLead.id)}
                    disabled={processing}
                    aria-label={`Open expanded detail for ${currentLead.firstName}`}
                    className="h-10 w-full gap-2 sm:h-9 sm:w-auto"
                  >
                    <Rocket className="h-4 w-4" />
                    Expanded detail
                  </Button>
                </div>
              )}
            </GlassCard>
          </div>

          {/* QUEUE RAIL — desktop-only right column showing next 10 leads */}
          <GlassCard
            role="complementary"
            aria-label="Queue rail"
            className="hidden min-w-0 overflow-hidden lg:flex lg:flex-col"
          >
            <div className="shrink-0 border-b border-border/60 p-4">
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
                  <ListChecks className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">Queue Rail</span>
                </h3>
                <span className="shrink-0 text-sm font-bold tabular-nums text-muted-foreground">
                  {Math.max(0, leads.length - currentIndex - 1)}{" "}
                  <span className="text-[10px] font-bold uppercase tracking-wide">ahead</span>
                </span>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                The next ten leads in dial order. Tap a name to jump straight to it.
              </p>
            </div>
            <div className="min-w-0 flex-1 divide-y divide-border/60 overflow-y-auto">
              {leads.slice(currentIndex + 1, currentIndex + 11).map((l, idx) => {
                const name = `${l.firstName} ${l.lastName ?? ""}`.trim() || "Unnamed";
                const isLicensed = (l.licenseStatus ?? "").toLowerCase() === "licensed";
                const hasPhone = !!l.phone;
                const ageDays = Math.max(
                  0,
                  Math.floor((Date.now() - new Date(l.createdAt).getTime()) / (24 * 60 * 60 * 1000)),
                );
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => setCurrentIndex(currentIndex + 1 + idx)}
                    aria-label={`Jump to ${name}`}
                    className="w-full px-3 py-2.5 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 truncate text-sm font-medium text-foreground">{name}</div>
                      <span className={cn(
                        "shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                        isLicensed
                          ? "border-emerald-500/35 text-emerald-600 dark:text-emerald-400"
                          : "border-rose-500/35 text-rose-600 dark:text-rose-400",
                      )}>
                        {isLicensed ? "Lic" : "Unlic"}
                      </span>
                    </div>
                    <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
                      <span className="shrink-0">
                        <span className="tabular-nums">{ageDays}d</span> old
                      </span>
                      {hasPhone ? (
                        <span className="inline-flex shrink-0 items-center gap-1 text-emerald-600 dark:text-emerald-400">
                          <Phone className="h-3 w-3" /> phone
                        </span>
                      ) : l.instagramHandle ? (
                        <span className="inline-flex shrink-0 items-center gap-1 text-amber-600 dark:text-amber-400">
                          <Instagram className="h-3 w-3" /> IG
                        </span>
                      ) : (
                        <span className="inline-flex shrink-0 items-center gap-1 text-muted-foreground">
                          <Mail className="h-3 w-3" /> email
                        </span>
                      )}
                      <span className="min-w-0 truncate text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                        {l.source === "aged_leads" ? "aged" : "applied"}
                      </span>
                    </div>
                  </button>
                );
              })}
              {leads.length - currentIndex - 1 <= 0 && (
                <p className="px-3 py-8 text-center text-xs text-muted-foreground">
                  No more leads in the queue.
                </p>
              )}
            </div>
          </GlassCard>
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

      {/* Hire Confirmation Modal */}
      {currentLead && (
        <HireConfirmModal
          open={showHireConfirm}
          onOpenChange={setShowHireConfirm}
          onConfirm={handleHireConfirm}
          applicantName={`${currentLead.firstName} ${currentLead.lastName || ""}`.trim()}
          isUnlicensed={currentLead.licenseStatus !== "licensed"}
        />
      )}

      {/* Schedule Meeting Modal — full date+time+type picker, posts to
          schedule-interview edge fn, sends email + Google Calendar URL. */}
      {currentLead && currentLead.source === "applications" && (
        <InterviewScheduler
          open={showScheduleModal}
          onOpenChange={setShowScheduleModal}
          applicationId={currentLead.id}
          applicantName={`${currentLead.firstName} ${currentLead.lastName || ""}`.trim()}
          applicantEmail={currentLead.email || ""}
          onScheduled={() => {
            toast.success("Meeting scheduled — applicant emailed");
            setShowScheduleModal(false);
            // MP-260 log reschedule outcome + advance so the caller keeps flowing.
            if (currentLead?.source === "applications") {
              logContactAttempt(currentLead.id, "reschedule_confirmed");
            }
            handleSkip();
          }}
        />
      )}

      {/* MP-260 expanded detail drawer — reuses the existing sheet
          (never duplicate). Only mounted for source='applications' since
          it queries by application_id. */}
      {detailAppId && (
        <ApplicationDetailSheet
          open={!!detailAppId}
          onOpenChange={(v) => { if (!v) setDetailAppId(null); }}
          applicationId={detailAppId}
        />
      )}

      {/* Confetti Celebration */}
      <ConfettiCelebration trigger={showConfetti} />
    </div>
  );
}
