import { Fragment, useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Users,
  Phone,
  PhoneOff,
  Loader2,
  Mail,
  Clock,
  Filter,
  Search,
  Instagram,
  UserCheck,
  MessageCircle,
  Award,
  ExternalLink,
  StickyNote,
  Mic,
  XCircle,
  RotateCcw,
  Send,
  Calendar,
  LayoutGrid,
  List,
  Copy,
  Sparkles,
  Flame,
  Bell,
  GraduationCap,
  Rocket,
  ArrowRight,
  X as XIcon,
  Columns3,
  AlertTriangle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { logger } from "@/shared/lib/logger";
import { useAuth } from "@/hooks/useAuth";
import { useSoundEffects } from "@/hooks/useSoundEffects";
import { AgentNameLink } from "@/components/dashboard/AgentNameLink";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getPriorityLabel, priorityBadgeClasses } from "@/lib/priority";
import { getNextBestAction, type NBAInput } from "@/lib/nextBestAction";
import { ApplicantNotes } from "@/components/dashboard/ApplicantNotes";
import { InterviewRecorder } from "@/components/dashboard/InterviewRecorder";
import { LeadQualificationChat } from "@/components/dashboard/LeadQualificationChat";
import { QuickAssignMenu } from "@/components/dashboard/QuickAssignMenu";
import { LicenseProgressSelector } from "@/components/dashboard/LicenseProgressSelector";
import { PromoteApplicantButton } from "@/components/applicants/PromoteApplicantButton";
import { ReassignManagerButton } from "@/components/agents/ReassignManagerButton";
import { InlineEditApplicantField } from "@/components/applicants/InlineEditApplicantField";
import { ResendLicensingButton } from "@/components/callcenter/ResendLicensingButton";
import { ApplicationDispositionCluster } from "@/components/applicants/ApplicationDispositionCluster";
import { KanbanBoard, type KanbanStage } from "@/components/pipeline/KanbanBoard";
import type { PipelineCardData } from "@/components/pipeline/PipelineCard";
import { logLeadActivity } from "@/lib/logLeadActivity";
import { PageLoadingSkeleton } from "@/components/ui/page-loading-skeleton";
import { ApplicationDetailSheet } from "@/components/dashboard/ApplicationDetailSheet";
import { GlassCard } from "@/components/ui/glass-card";
import { EmptyState } from "@/components/ui/empty-state";

interface Application {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  city: string | null;
  state: string | null;
  license_status: "licensed" | "unlicensed" | "pending";
  license_progress: "unlicensed" | "course_purchased" | "passed_test" | "waiting_on_license" | "licensed" | null;
  status: string;
  instagram_handle: string | null;
  contacted_at: string | null;
  qualified_at: string | null;
  closed_at: string | null;
  contracted_at: string | null;
  terminated_at: string | null;
  termination_reason: string | null;
  started_training: boolean | null;
  created_at: string;
  notes: string | null;
  has_insurance_experience: boolean | null;
  previous_company: string | null;
  years_experience: number | null;
  assigned_agent_id: string | null;
  recruiter_id: string | null;
  lead_score: number | null;
  ai_score_tier: string | null;
  course_purchased_at?: string | null;
  is_duplicate?: boolean;
  is_ghosted?: boolean;
  first_contact_attempt_at?: string | null;
  phone_bad_at?: string | null;
  phone_bad_reason?: string | null;
  couldnt_reach_email_sent_at?: string | null;
}

const APPLICATION_SELECT =
  "id, first_name, last_name, email, phone, city, state, license_status, license_progress, started_training, contacted_at, contracted_at, closed_at, terminated_at, created_at, assigned_agent_id, recruiter_id, referral_manager_id, notes, previous_company, years_experience, has_insurance_experience, instagram_handle, lead_score, ai_score_tier, termination_reason, is_ghosted, is_duplicate, course_purchased_at, course_started_at, exam_scheduled_at, exam_passed_at, licensed_at, ica_paid, ica_paid_at, first_deal_at, next_action, next_action_due_at, last_contacted_at, next_step_due_at, referral_source, phone_bad_at, phone_bad_reason, couldnt_reach_email_sent_at";

// MP-268 pipeline ladder. Sam asked for one filter per recruiting stage:
// applied · course · passed test · fingerprints · onboarding · carrier appointments · first sale.
//
// Only the rungs below are actually captured. Verified against production 2026-07-27:
//   fingerprints          — applications.fingerprints_submitted_at has 1 row total
//   carrier appointments  — agentlink_appointments has 0 rows, ever
//   first sale            — applications.first_deal_at is bulk-backfilled and unusable
//                           (600 rows across 65 timestamps; 199 share one minute).
//                           agents.first_deal_at is clean and is where that rung belongs.
// Shipping empty chips for uncaptured stages would be the same fake-success pattern as the
// 465 InsuraCloud rows: a control that looks live but can never populate. Those three rungs
// are deliberately absent until capture exists.
//
// The ladder is resolved MOST-ADVANCED-FIRST so every applicant lands in exactly one stage and
// the chip counts sum to the roster. license_progress alone overlaps (someone can be
// 'course_purchased' AND contracted), which is why the raw column is not used as the filter.
const PIPELINE_STAGES = [
  { key: "applied", label: "Applied" },
  { key: "course", label: "Course" },
  { key: "finished_course", label: "Finished Course" },
  { key: "test_scheduled", label: "Test Scheduled" },
  { key: "passed_test", label: "Passed Test" },
  { key: "licensed", label: "Licensed" },
  { key: "contracted", label: "Contracted" },
] as const;

type PipelineStageKey = (typeof PIPELINE_STAGES)[number]["key"];

function resolvePipelineStage(app: Application): PipelineStageKey {
  const lp = String((app as any).license_progress ?? "");
  if (app.contracted_at || (app as any).ica_paid) return "contracted";
  if (lp === "licensed" || (app as any).licensed_at || app.license_status === "licensed") return "licensed";
  if (lp === "passed_test" || lp === "waiting_on_license" || (app as any).exam_passed_at) return "passed_test";
  if (lp === "test_scheduled" || (app as any).exam_scheduled_at) return "test_scheduled";
  if (lp === "finished_course") return "finished_course";
  if (lp === "course_purchased" || app.course_purchased_at) return "course";
  return "applied";
}

const statusColors: Record<string, string> = {
  new: "border-border bg-muted/50 text-muted-foreground",
  contacted: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  hired: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  contracted: "border-primary/30 bg-primary/10 text-primary",
  terminated: "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400",
};

const licenseColors: Record<string, string> = {
  licensed: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  unlicensed: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  pending: "border-border bg-muted/50 text-muted-foreground",
};

export default function DashboardApplicants() {
  const { user, isAdmin, isManager } = useAuth();
  const { playSound } = useSoundEffects();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const highlightedLeadId = searchParams.get("lead") || searchParams.get("id");
  const managerFilter = searchParams.get("manager");
  const stageFilter = searchParams.get("stage");
  const licenseParam = searchParams.get("license");
  const statusParam = searchParams.get("status");
  const contactedParam = searchParams.get("contacted");

  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>(statusParam || "all");
  const [licenseFilter, setLicenseFilter] = useState<string>(licenseParam || "all");
  const [sortOrder, setSortOrder] = useState<string>("newest");
  const [myDirectsOnly, setMyDirectsOnly] = useState(false);
  const [hotLeadsOnly, setHotLeadsOnly] = useState(false);
  const [showDuplicates, setShowDuplicates] = useState(true);
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [uplineFilter, setUplineFilter] = useState<string>("all");
  const [interviewFilter, setInterviewFilter] = useState<string>("all");
  const [needsFollowupOnly, setNeedsFollowupOnly] = useState(false);
  const [notesApp, setNotesApp] = useState<Application | null>(null);
  const [recorderApp, setRecorderApp] = useState<Application | null>(null);
  const [terminateApp, setTerminateApp] = useState<Application | null>(null);
  const [terminateReason, setTerminateReason] = useState("");
  const [isTerminating, setIsTerminating] = useState(false);

  const [viewMode, setViewMode] = useState<"list" | "kanban" | "pipeline">("list");
  const [metricFilter, setMetricFilter] = useState<string>("total");
  // MP-268: null = no stage constraint ("All stages" chip).
  const [pipelineStage, setPipelineStage] = useState<PipelineStageKey | null>(null);
  const [duplicatesOnly, setDuplicatesOnly] = useState(false);
  // Speed-to-Lead workflow
  const [speedActive, setSpeedActive] = useState(false);
  const [speedIndex, setSpeedIndex] = useState(0);
  const [detailAppId, setDetailAppId] = useState<string | null>(null);

  const autoHealedRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.auth.refreshSession();
        if (cancelled) return;
        if (error || !data?.session) {
          console.warn("[DashboardApplicants] session refresh failed:", error);
        } else {
          queryClient.invalidateQueries({ queryKey: ["applicants"] });
        }
      } catch (e) {
        console.warn("[DashboardApplicants] session refresh threw:", e);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (highlightedLeadId) {
      setStatusFilter("all");
      setLicenseFilter("all");
      setSearchQuery("");
    }
  }, [highlightedLeadId]);
  const fetchApplicationsQuery = useCallback(async () => {
    if (!user) {
      return {
        apps: [] as Application[],
        terminatedApps: [] as Application[],
        names: new Map<string, string>(),
        myAgentId: null as string | null,
      };
    }

    const { data: agentData, error: agentLookupError } = await supabase
      .from("agents")
      .select("id")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (agentLookupError) {
      console.warn("[DashboardApplicants] agent lookup error:", agentLookupError);
    }

    let fetchedApps: Application[] = [];

    const orForAgentId = (id: string) =>
      `assigned_agent_id.eq.${id},referral_manager_id.eq.${id},recruiter_id.eq.${id}`;

    const fetchScopedApplications = async (includeTerminated: boolean) => {
      let query = supabase
        .from("applications")
        .select(APPLICATION_SELECT, { count: "exact" });

      query = includeTerminated
        ? query.not("terminated_at", "is", null)
        : query.is("terminated_at", null);

      if (managerFilter && (isAdmin || isManager)) {
        query = query.or(orForAgentId(managerFilter));
      } else if (!isAdmin && !isManager) {
        if (!agentData) {
          throw new Error(
            "Agent lookup returned no row · cannot scope applications. " +
            "Either the user has no `agents` row OR the lookup failed. " +
            "Check console for [DashboardApplicants] agent lookup error."
          );
        }
        query = query.or(orForAgentId(agentData.id));
      }

      const { data, error, count } = await query.order("created_at", { ascending: false });
      if (error) {
        const tag = `[DashboardApplicants] ${includeTerminated ? "terminated" : "active"} fetch failed`;
        console.error(tag, { error, managerFilter, isAdmin, isManager });
        throw Object.assign(
          new Error(`${error.code ?? "??"}: ${error.message ?? "Supabase rejected the query"}`),
          { supabaseError: error, includeTerminated, managerFilter }
        );
      }
      if (data == null) {
        throw new Error("Supabase returned null data without an error · investigate client config.");
      }

      return { rows: data as Application[], count: count ?? data.length };
    };

    const activeResult = await fetchScopedApplications(false);
    const terminatedResult = await fetchScopedApplications(true);
    fetchedApps = activeResult.rows;

    const duplicateCount = fetchedApps.filter(app => app.is_duplicate).length;
    const coursePurchasedCount = fetchedApps.filter(app => Boolean(app.course_purchased_at)).length;
    logger.info("[DashboardApplicants] fetched applications", {
      role: isAdmin ? "admin" : isManager ? "manager" : "agent",
      activeFetched: fetchedApps.length,
      activeCount: activeResult.count,
      terminatedFetched: terminatedResult.rows.length,
      terminatedCount: terminatedResult.count,
      duplicateCount,
      coursePurchasedCount,
      managerFilter: managerFilter || null,
    });

    const nameMap = new Map<string, string>();
    const allFetchedApps = [...fetchedApps, ...terminatedResult.rows];
    const assignedIds = [...new Set(allFetchedApps.map(a => a.assigned_agent_id).filter(Boolean))] as string[];
    if (assignedIds.length > 0) {
      const { data: assignedAgents } = await supabase
        .from("agents")
        .select("id, profiles!agents_profile_id_fkey(full_name)")
        .in("id", assignedIds);
      assignedAgents?.forEach((a: any) => {
        nameMap.set(a.id, a.profiles?.full_name || "—");
      });
    }

    const recruiterMap = new Map<string, { name: string; uplineId: string | null }>();
    const uplineMap = new Map<string, string>();
    const recruiterIds = [
      ...new Set(allFetchedApps.map(a => a.recruiter_id).filter(Boolean)),
    ] as string[];
    if (recruiterIds.length > 0) {
      const { data: recruiterRows } = await supabase
        .from("agents")
        .select("id, manager_id, profiles!agents_profile_id_fkey(full_name)")
        .in("id", recruiterIds);
      recruiterRows?.forEach((r: any) => {
        recruiterMap.set(r.id, {
          name: r.profiles?.full_name || "—",
          uplineId: r.manager_id || null,
        });
      });

      const uplineIds = [
        ...new Set(
          (recruiterRows || [])
            .map((r: any) => r.manager_id)
            .filter(Boolean) as string[]
        ),
      ];
      if (uplineIds.length > 0) {
        const { data: uplineRows } = await supabase
          .from("agents")
          .select("id, profiles!agents_profile_id_fkey(full_name)")
          .in("id", uplineIds);
        uplineRows?.forEach((u: any) => {
          uplineMap.set(u.id, u.profiles?.full_name || "—");
        });
      }
    }

    const interviewMap = new Map<string, string>();
    const allAppIds = allFetchedApps.map(a => a.id);
    if (allAppIds.length > 0) {
      const { data: interviewRows, error: interviewErr } = await supabase
        .from("scheduled_interviews")
        .select("application_id, status")
        .in("application_id", allAppIds);
      if (interviewErr) {
        // Don't fail the page over an interview lookup. Log + continue.
        console.warn("[DashboardApplicants] scheduled_interviews lookup failed:", interviewErr);
      } else {
        (interviewRows || []).forEach((row: any) => {
          if (row.application_id) interviewMap.set(row.application_id, row.status ?? "scheduled");
        });
      }
    }

    return {
      apps: fetchedApps,
      terminatedApps: terminatedResult.rows,
      names: nameMap,
      recruiters: recruiterMap,
      uplines: uplineMap,
      interviews: interviewMap,
      myAgentId: agentData?.id || null,
    };
  }, [user?.id, isAdmin, isManager, managerFilter]);

  const { data: queryData, isLoading, error: queryError } = useQuery({
    queryKey: ["applicants", user?.id, isAdmin, isManager, managerFilter],
    queryFn: fetchApplicationsQuery,
    enabled: !!user,
    staleTime: 60000,
  });

  const applications = queryData?.apps || [];
  const archivedApplications = queryData?.terminatedApps || [];
  const managerNames = queryData?.names || new Map<string, string>();
  const recruiterDirectory =
    queryData?.recruiters || new Map<string, { name: string; uplineId: string | null }>();
  const uplineNames = queryData?.uplines || new Map<string, string>();
  const interviewByAppId = queryData?.interviews || new Map<string, string>();
  const agentId = queryData?.myAgentId || null;

  const recruiterOptions = useMemo(() => {
    const ids = new Set<string>();
    applications.forEach(a => { if (a.recruiter_id) ids.add(a.recruiter_id); });
    archivedApplications.forEach(a => { if (a.recruiter_id) ids.add(a.recruiter_id); });
    return Array.from(ids)
      .map(id => ({ id, name: recruiterDirectory.get(id)?.name || "—" }))
      .filter(o => o.name && o.name !== "—")
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [applications, archivedApplications, recruiterDirectory]);

  const uplineOptions = useMemo(() => {
    const ids = new Set<string>();
    const collect = (appList: Application[]) => {
      appList.forEach(a => {
        if (!a.recruiter_id) return;
        const upId = recruiterDirectory.get(a.recruiter_id)?.uplineId;
        if (upId) ids.add(upId);
      });
    };
    collect(applications);
    collect(archivedApplications);
    return Array.from(ids)
      .map(id => ({ id, name: uplineNames.get(id) || "—" }))
      .filter(o => o.name && o.name !== "—")
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [applications, archivedApplications, recruiterDirectory, uplineNames]);

  const fetchApplications = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["applicants"] });
  }, [queryClient]);

  useEffect(() => {
    if (autoHealedRef.current) return;
    if (isLoading) return;
    if (!queryData) return;
    if (applications.length > 0) return;

    autoHealedRef.current = true;
    console.warn("[DashboardApplicants] auto-heal: 0 apps fetched · refreshing session + retrying");
    (async () => {
      try {
        const { data, error } = await supabase.auth.refreshSession();
        if (error || !data?.session) {
          console.warn("[auto-heal] session refresh failed:", error);
          toast.error("Session expired · signing you out for fresh login");
          await supabase.auth.signOut();
          setTimeout(() => { navigate("/login"); }, 400);
          return;
        }
        toast.success("Session refreshed · reloading applications");
        queryClient.invalidateQueries({ queryKey: ["applicants"] });
      } catch (e) {
        console.error("[auto-heal] threw:", e);
      }
    })();
  }, [queryData, applications.length, isLoading, queryClient]);

  useEffect(() => {
    if (highlightedLeadId && applications.length > 0) {
      const timer = setTimeout(() => {
        const leadElement = document.getElementById(`lead-${highlightedLeadId}`);
        if (leadElement) {
          leadElement.scrollIntoView({ behavior: "smooth", block: "center" });
          setTimeout(() => setSearchParams({}), 2000);
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [highlightedLeadId, applications, setSearchParams]);

  const getApplicationStatus = (app: Application): string => {
    if (app.terminated_at) return "terminated";
    if (app.contracted_at) return "contracted";
    if (app.closed_at) return "hired";
    if (app.contacted_at) return "contacted";
    return "new";
  };

  const getTimeAgo = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = Math.max(0, now.getTime() - date.getTime());
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    
    if (diffHours < 1) return "Just now";
    if (diffHours < 24) return `${diffHours} hours ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return "1 day ago";
    if (diffDays < 7) return `${diffDays} days ago`;
    return `${Math.floor(diffDays / 7)} week(s) ago`;
  };

  const handleMarkAsHired = async (id: string) => {
    const app = applications.find(a => a.id === id);
    if (!app) return;

    const { error } = await supabase
      .from("applications")
      .update({ 
        closed_at: new Date().toISOString(),
        contacted_at: app.contacted_at || new Date().toISOString(),
      })
      .eq("id", id);

    if (error) {
      toast.error("Failed to mark as hired");
      playSound("error");
      return;
    }
    
    toast.success("Marked as hired!");
    playSound("celebrate");
    fetchApplications();
    
    supabase.functions.invoke("send-post-call-followup", {
      body: {
        firstName: app.first_name,
        email: app.email,
        licenseStatus: app.license_status,
        actionType: "hired",
        agentId: agentId,
      }
    }).then(({ error: emailErr }) => {
      if (emailErr) console.error("Failed to send hire email:", emailErr);
    });

    supabase.functions.invoke("notify-hire-announcement", {
      body: { applicationId: id, agentId }
    }).then(({ error: announceErr }) => {
      if (announceErr) console.error("Failed to send hire announcement:", announceErr);
    });

    if (app.license_status === "licensed") {
      supabase.functions.invoke("add-agent", {
        body: {
          firstName: app.first_name,
          lastName: app.last_name,
          email: app.email,
          phone: app.phone || "",
          managerId: agentId,
          licenseStatus: "licensed",
          hasTrainingCourse: true,
          city: app.city || undefined,
          state: app.state || undefined,
          instagramHandle: app.instagram_handle || undefined,
        }
      }).then(({ data, error: addErr }) => {
        if (addErr) {
          console.error("Failed to auto-create agent:", addErr);
        } else {
          toast.success(`${app.first_name} added as agent & enrolled in course!`);
        }
      });
    } else {
      supabase.functions.invoke("send-licensing-instructions", {
        body: {
          email: app.email,
          firstName: app.first_name,
          licenseStatus: app.license_status,
          state: app.state,
        }
      }).then(({ error: licenseErr }) => {
        if (licenseErr) console.error("Failed to send licensing instructions:", licenseErr);
      });
    }
  };

  const handleTerminate = async () => {
    if (!terminateApp) return;
    
    setIsTerminating(true);
    const terminatedId = terminateApp.id;
    const { data, error } = await supabase
      .from("applications")
      .update({ 
        terminated_at: new Date().toISOString(),
        termination_reason: terminateReason.trim() || null
      })
      .eq("id", terminatedId)
      .select("id");

    if (error) {
      toast.error("Failed to terminate lead");
      playSound("error");
    } else if (!data || data.length === 0) {
      toast.error("Could not terminate this lead. Check your permissions.");
      playSound("error");
    } else {
      toast.success("Lead terminated");
      playSound("success");
      setTerminateApp(null);
      setTerminateReason("");
      fetchApplications();
    }
    setIsTerminating(false);
  };

  const handleRestoreLead = async (id: string) => {
    const { error } = await supabase
      .from("applications")
      .update({ 
        terminated_at: null,
        termination_reason: null
      })
      .eq("id", id);

    if (error) {
      toast.error("Failed to restore lead");
      playSound("error");
    } else {
      toast.success("Lead restored");
      playSound("success");
      fetchApplications();
    }
  };

  const openInstagram = (handle: string) => {
    const clean = handle.replace(/^@+/, "").trim();
    if (!clean) return;
    window.open(`https://instagram.com/${clean}`, "_blank", "noopener,noreferrer");
  };

  // 2026-07-07 Sam: fire-and-forget contact-attempt log. Never blocks tel:/sms:/mailto: navigation.
  const logContactAttempt = (
    applicationId: string,
    channel: "call" | "sms" | "email",
  ) => {
    void supabase
      .rpc("log_contact_attempt" as any, {
        p_application_id: applicationId,
        p_channel: channel,
        p_outcome: "initiated",
      })
      .then(() => undefined)
      // empty-catch-allow:fire-and-forget telemetry — must not block tel:/sms:/mailto: navigation
      .catch(() => undefined);
  };

  const [badPhoneBusy, setBadPhoneBusy] = useState<string | null>(null);
  const handleMarkBadPhone = async (app: Application) => {
    if (badPhoneBusy === app.id) return;
    setBadPhoneBusy(app.id);
    try {
      // 1. Mark phone as bad on the applicant record (idempotent RPC).
      const { error: rpcErr } = await supabase.rpc("mark_phone_bad" as any, {
        p_application_id: app.id,
        p_reason: "user_marked_bad",
      });
      if (rpcErr) {
        toast.error(`Couldn't mark bad: ${rpcErr.message}`);
        playSound("error");
        setBadPhoneBusy(null);
        return;
      }

      // 2. If we have an email, fire the templated "couldn't reach you" send.
      if (app.email) {
        const { data: sent, error: fnErr } = await supabase.functions.invoke(
          "send-couldnt-reach-email",
          { body: { application_id: app.id, reason: "user_marked_bad" } },
        );
        if (fnErr || (sent as any)?.ok === false) {
          const detail = (sent as any)?.error ?? fnErr?.message ?? "unknown";
          toast.error(`Marked bad, but email failed: ${detail}`);
        } else {
          toast.success(`Marked bad · emailed ${app.email}`);
          playSound("success");
        }
      } else {
        toast.warning("Marked bad — no email on file to notify");
        playSound("success");
      }
      fetchApplications();
    } finally {
      setBadPhoneBusy(null);
    }
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`Copied ${label}`);
    } catch {
      toast.error("Copy failed");
    }
  };

  const handleNotesSave = (notes: string) => {
    if (notesApp) {
      fetchApplications();
      setNotesApp(null);
    }
  };

  const handleKanbanStageChange = async (applicationId: string, newStage: KanbanStage) => {
    const dbStage = newStage === "new_applicant" || newStage === "dormant" ? "unlicensed" : newStage;

    const { error } = await supabase
      .from("applications")
      .update({ license_progress: dbStage as any })
      .eq("id", applicationId);

    if (error) {
      toast.error("Failed to update stage");
      playSound("error");
      return;
    }

    toast.success("Stage updated!");
    playSound("success");
    logLeadActivity({
      leadId: applicationId,
      type: "stage_update",
      title: `Stage changed to ${newStage}`,
      details: { from: "kanban_drag", to: newStage },
    });
    fetchApplications();
  };

  const activeApplications = useMemo(
    () => applications.filter(app => !app.terminated_at),
    [applications]
  );
  const terminatedApplications = archivedApplications;

  const applicationMatchesFilters = useCallback((app: Application): boolean => {
    const q = searchQuery.toLowerCase();
    const name = `${app.first_name} ${app.last_name}`.toLowerCase();
    const matchesSearch = !q || name.includes(q) ||
      app.email.toLowerCase().includes(q) ||
      (app.phone && app.phone.includes(q));

    const appStatus = getApplicationStatus(app);
    const lowerStatus = (app.status ?? "").toLowerCase();
    const matchesStatus =
      statusFilter === "all" ||
      statusFilter === "terminated" ||
      (statusFilter === "in_funnel" && !app.closed_at && !app.contracted_at) ||
      (statusFilter === "course_bought" && Boolean(app.course_purchased_at)) ||
      (statusFilter === "rejected" && (lowerStatus === "rejected" || lowerStatus === "disqualified")) ||
      appStatus === statusFilter;
    const matchesLicense = licenseFilter === "all" || app.license_status === licenseFilter;
    const matchesDirects = !myDirectsOnly || app.assigned_agent_id === agentId;
    const matchesHot = !hotLeadsOnly || (app as any).ai_score_tier === "hot" || (app as any).ai_score_tier === "warm";
    const matchesDuplicates = showDuplicates || !app.is_duplicate;
    const matchesDuplicatesOnly = !duplicatesOnly || Boolean(app.is_duplicate);

    const matchesAgent = agentFilter === "all" || app.recruiter_id === agentFilter;

    let matchesUpline = true;
    if (uplineFilter !== "all") {
      const recruiter = app.recruiter_id ? recruiterDirectory.get(app.recruiter_id) : null;
      matchesUpline = recruiter?.uplineId === uplineFilter;
    }

    let matchesInterview = true;
    if (interviewFilter !== "all") {
      const intStatus = interviewByAppId.get(app.id);
      if (interviewFilter === "scheduled") matchesInterview = intStatus === "scheduled";
      else if (interviewFilter === "none") matchesInterview = !intStatus;
      else matchesInterview = intStatus === interviewFilter;
    }

    let matchesNeedsFollowup = true;
    if (needsFollowupOnly) {
      const ageMs = Date.now() - new Date(app.created_at).getTime();
      const hasContact = Boolean(app.contacted_at) || Boolean((app as any).last_contacted_at);
      matchesNeedsFollowup = ageMs > 48 * 60 * 60 * 1000 && !hasContact;
    }

    const matchesContacted =
      contactedParam === "untouched"
        ? !app.contacted_at && !(app as any).last_contacted_at
        : contactedParam === "recent"
        ? (app as any).last_contacted_at && new Date((app as any).last_contacted_at).getTime() > Date.now() - 86_400_000
        : true;

    let matchesStage = true;
    if (stageFilter) {
      const lp = (app as any).license_progress;
      const map: Record<string, string[]> = {
        pre_course: ["unlicensed", "not_started", "applied"],
        course_bought: ["course_purchased", "in_course", "studying"],
        in_course: ["course_purchased", "in_course", "studying"],
        exam_scheduled: ["test_scheduled", "exam_scheduled"],
        passed: ["passed_test", "exam_passed", "test_passed"],
        pending_state: ["fingerprints_done", "waiting_on_license", "pending_state"],
      };
      const allowed = map[stageFilter] || [];
      if (stageFilter === "pre_course") {
        matchesStage = !lp || allowed.includes(lp);
      } else if (stageFilter === "course_bought") {
        matchesStage = Boolean(app.course_purchased_at) || allowed.includes(lp);
      } else {
        matchesStage = allowed.includes(lp);
      }
    }

    const matchesPipelineStage =
      pipelineStage === null || resolvePipelineStage(app) === pipelineStage;

    return matchesSearch && matchesStatus && matchesLicense && matchesDirects && matchesHot &&
      matchesDuplicates && matchesDuplicatesOnly && matchesAgent && matchesUpline && matchesInterview &&
      matchesNeedsFollowup && matchesStage && matchesContacted && matchesPipelineStage;
  }, [
    searchQuery, statusFilter, licenseFilter, myDirectsOnly, hotLeadsOnly, showDuplicates,
    duplicatesOnly, agentFilter, uplineFilter, interviewFilter, needsFollowupOnly,
    contactedParam, stageFilter, agentId, recruiterDirectory, interviewByAppId, pipelineStage,
  ]);

  // Counts are computed off the live roster, not hardcoded, so a stage that stops being
  // captured shows 0 on its own chip instead of silently rendering an empty list.
  const pipelineStageCounts = useMemo(() => {
    const counts = Object.fromEntries(
      PIPELINE_STAGES.map((s) => [s.key, 0])
    ) as Record<PipelineStageKey, number>;
    for (const app of activeApplications) counts[resolvePipelineStage(app)] += 1;
    return counts;
  }, [activeApplications]);

  const kanbanApps: PipelineCardData[] = useMemo(() =>
    activeApplications
      .filter(applicationMatchesFilters)
      .map((app) => ({
        id: app.id,
        first_name: app.first_name,
        last_name: app.last_name,
        email: app.email,
        phone: app.phone,
        license_progress: app.license_progress,
        license_status: app.license_status,
        last_contacted_at: (app as any).last_contacted_at || null,
        contacted_at: app.contacted_at,
        created_at: app.created_at,
        assigned_agent_id: app.assigned_agent_id,
        lead_score: (app as any).lead_score || null,
        next_action_type: (app as any).next_action_type || null,
        assigned_manager_name: app.assigned_agent_id ? managerNames.get(app.assigned_agent_id) || null : null,
      })),
    [activeApplications, managerNames, applicationMatchesFilters]
  );

  const baseApplications = statusFilter === "terminated" ? terminatedApplications : activeApplications;

  const filteredApplications = useMemo(() =>
    baseApplications
      .filter(applicationMatchesFilters)
      .sort((a, b) => {
        const dateA = new Date(a.created_at).getTime();
        const dateB = new Date(b.created_at).getTime();
        return sortOrder === "newest" ? dateB - dateA : dateA - dateB;
      }),
    [baseApplications, applicationMatchesFilters, sortOrder]
  );

  const needsFollowupCount = useMemo(() => {
    let n = 0;
    for (const a of activeApplications) {
      const ageMs = Date.now() - new Date(a.created_at).getTime();
      const hasContact = Boolean(a.contacted_at) || Boolean((a as any).last_contacted_at);
      if (ageMs > 48 * 60 * 60 * 1000 && !hasContact) n++;
    }
    return n;
  }, [activeApplications]);

  const activeDuplicateCount = useMemo(
    () => activeApplications.filter(app => app.is_duplicate).length,
    [activeApplications]
  );

  const hotLeadsCount = useMemo(
    () => activeApplications.filter(
      app => (app as any).ai_score_tier === "hot" || (app as any).ai_score_tier === "warm"
    ).length,
    [activeApplications]
  );

  // 2026-07-08 MP-256: Duplicate-review pairing — group by email or normalized phone digits.
  const duplicatePairs = useMemo(() => {
    if (!duplicatesOnly) return [] as Array<{ key: string; apps: Application[] }>;
    const groups = new Map<string, Application[]>();
    for (const a of activeApplications) {
      if (!a.is_duplicate) continue;
      const emailKey = a.email?.toLowerCase().trim() || "";
      const phoneDigits = (a.phone || "").replace(/\D+/g, "").slice(-10);
      const key = emailKey || (phoneDigits ? `p:${phoneDigits}` : `id:${a.id}`);
      const bucket = groups.get(key) || [];
      bucket.push(a);
      groups.set(key, bucket);
    }
    return Array.from(groups.entries())
      .filter(([, apps]) => apps.length >= 2)
      .map(([key, apps]) => ({ key, apps }));
  }, [duplicatesOnly, activeApplications]);

  // 2026-07-08 MP-256: Speed-to-Lead queue — hot/new/follow-up-due-today sorted by priority signal count.
  const speedQueue = useMemo(() => {
    if (!speedActive) return [] as Application[];
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    const eligible = activeApplications.filter((app) => {
      const isNew = !app.contacted_at && !app.terminated_at && !app.closed_at;
      const isHot = app.ai_score_tier === "hot" || app.ai_score_tier === "warm";
      const nextDue = (app as any).next_action_due_at as string | null | undefined;
      const dueToday = nextDue ? new Date(nextDue) <= endOfToday : false;
      return isNew || isHot || dueToday;
    });
    return eligible.sort((a, b) => {
      const rank = (x: Application) =>
        (x.ai_score_tier === "hot" ? 3 : x.ai_score_tier === "warm" ? 2 : 0) +
        (!x.contacted_at ? 2 : 0);
      return rank(b) - rank(a);
    });
  }, [speedActive, activeApplications]);

  useEffect(() => {
    if (!speedActive) return;
    if (speedQueue.length === 0) {
      toast.info("Speed-to-Lead queue is empty — nothing to work.");
      setSpeedActive(false);
      return;
    }
    const clamped = Math.min(speedIndex, speedQueue.length - 1);
    setDetailAppId(speedQueue[clamped]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speedActive, speedIndex, speedQueue.length]);

  const activeFilterChips = useMemo(() => {
    const chips: Array<{ key: string; label: string; clear: () => void }> = [];
    if (searchQuery) chips.push({ key: "search", label: `Search: "${searchQuery}"`, clear: () => setSearchQuery("") });
    if (statusFilter !== "all") chips.push({ key: "status", label: `Status: ${statusFilter}`, clear: () => setStatusFilter("all") });
    if (licenseFilter !== "all") chips.push({ key: "license", label: `License: ${licenseFilter}`, clear: () => setLicenseFilter("all") });
    if (myDirectsOnly) chips.push({ key: "directs", label: "My directs only", clear: () => setMyDirectsOnly(false) });
    if (hotLeadsOnly) chips.push({ key: "hot", label: "Hot leads only", clear: () => setHotLeadsOnly(false) });
    if (duplicatesOnly) chips.push({ key: "dups", label: "Duplicates only", clear: () => setDuplicatesOnly(false) });
    if (needsFollowupOnly) chips.push({ key: "needs", label: "Needs follow-up", clear: () => setNeedsFollowupOnly(false) });
    if (agentFilter !== "all") chips.push({ key: "agent", label: `Agent: ${recruiterDirectory.get(agentFilter)?.name || agentFilter}`, clear: () => setAgentFilter("all") });
    if (uplineFilter !== "all") chips.push({ key: "upline", label: `Upline: ${uplineNames.get(uplineFilter) || uplineFilter}`, clear: () => setUplineFilter("all") });
    if (interviewFilter !== "all") chips.push({ key: "interview", label: `Interview: ${interviewFilter}`, clear: () => setInterviewFilter("all") });
    if (pipelineStage) {
      const stage = PIPELINE_STAGES.find((s) => s.key === pipelineStage);
      chips.push({ key: "stage", label: `Stage: ${stage?.label ?? pipelineStage}`, clear: () => setPipelineStage(null) });
    }
    return chips;
  }, [
    searchQuery, statusFilter, licenseFilter, myDirectsOnly, hotLeadsOnly, duplicatesOnly,
    needsFollowupOnly, agentFilter, uplineFilter, interviewFilter, recruiterDirectory, uplineNames,
    pipelineStage,
  ]);

  const resetAllFilters = () => {
    setSearchQuery("");
    setStatusFilter("all");
    setLicenseFilter("all");
    setMyDirectsOnly(false);
    setHotLeadsOnly(false);
    setDuplicatesOnly(false);
    setNeedsFollowupOnly(false);
    setAgentFilter("all");
    setUplineFilter("all");
    setInterviewFilter("all");
    setMetricFilter("total");
    setShowDuplicates(true);
    setPipelineStage(null);
  };

  const counterTotal = statusFilter === "terminated" ? terminatedApplications.length : activeApplications.length;
  const counterLabel = statusFilter === "terminated" ? "terminated applications" : "active applications";

  const { totalLeads, hired, coursePurchased, inFunnel, rejected, todayCount, hiredThisMonth } = useMemo(() => {
    const tzNow = new Date();
    const todayDate = new Date(tzNow.getFullYear(), tzNow.getMonth(), tzNow.getDate());
    const todayIso = todayDate.toISOString().slice(0, 10);
    const monthStartMs = new Date(tzNow.getFullYear(), tzNow.getMonth(), 1).getTime();
    let hired = 0, coursePurchased = 0, inFunnel = 0, rejected = 0, todayCount = 0, hiredThisMonth = 0;
    const all = [...activeApplications, ...terminatedApplications];
    for (const a of all) {
      if (a.closed_at && !a.contracted_at) hired++;
      if (a.closed_at) {
        const t = new Date(a.closed_at).getTime();
        if (!Number.isNaN(t) && t >= monthStartMs) hiredThisMonth++;
      }
      const lp = a.license_progress as string | null;
      if (a.course_purchased_at || lp === "course_purchased" || lp === "finished_course") coursePurchased++;
      if (!a.closed_at && !a.contracted_at && !a.terminated_at) inFunnel++;
      const status = (a.status ?? "").toLowerCase();
      if (status === "rejected" || status === "disqualified") rejected++;
      if (a.created_at && a.created_at.slice(0, 10) === todayIso) todayCount++;
    }
    return { totalLeads: activeApplications.length, hired, coursePurchased, inFunnel, rejected, todayCount, hiredThisMonth };
  }, [activeApplications, terminatedApplications]);

  if (isLoading && applications.length === 0) {
    return <PageLoadingSkeleton variant="cards" />;
  }

  return (
    <div className="apex-fullbleed-page -mx-4 sm:-mx-6 lg:-mx-8 w-[calc(100%+2rem)] sm:w-[calc(100%+3rem)] lg:w-[calc(100%+4rem)]">
      {/* Root wrapper padding is px-4 sm:px-6 so PageHeader's -mx-4 sm:-mx-6 cancels exactly.
          The full-bleed opt-out above is deliberate (11-column table on ultrawide). */}
      <div className="page-enter w-full space-y-5 px-4 pb-24 sm:px-6">
      <PageHeader
        accent="cyan"
        eyebrow="Recruiting · Applicants"
        eyebrowIcon={<Users className="h-3 w-3" />}
        title="Applicants"
        subtitle="Every applicant. Assigned, referred, recruited."
        actions={
          (isAdmin || isManager) && agentId
            ? <Button
                variant={myDirectsOnly ? "default" : "outline"}
                size="sm"
                aria-pressed={myDirectsOnly}
                className="h-10 w-full gap-1.5 sm:h-9 sm:w-auto"
                onClick={() => setMyDirectsOnly(!myDirectsOnly)}
              >
                <Users className="h-4 w-4 shrink-0" />
                {myDirectsOnly ? "My Directs" : "Full Team"}
              </Button>
            : null
        }
      />

      {(isAdmin || isManager) && agentId && (
        <ReferralLinkBanner agentId={agentId} />
      )}

      <GlassCard className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-2xl font-bold leading-none tabular-nums text-foreground">
              {filteredApplications.length.toLocaleString()}
            </span>
            <span className="text-sm font-bold tabular-nums text-muted-foreground">
              / {counterTotal.toLocaleString()}
            </span>
            <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              {counterLabel}
            </span>
            {todayCount > 0 && (
              <Badge variant="outline" className="text-[10px] tabular-nums">{todayCount.toLocaleString()} today</Badge>
            )}
            {hiredThisMonth > 0 && (
              <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-[10px] tabular-nums text-emerald-600 dark:text-emerald-400">
                {hiredThisMonth.toLocaleString()} hired this mo.
              </Badge>
            )}
            {terminatedApplications.length > 0 && (
              <Badge variant="outline" className="text-[10px] tabular-nums">{terminatedApplications.length.toLocaleString()} terminated</Badge>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1 rounded-md bg-muted p-1">
            <Button variant={viewMode === "list" ? "default" : "ghost"} size="sm" aria-pressed={viewMode === "list"} className="h-10 gap-1.5 px-2.5 sm:h-9" onClick={() => setViewMode("list")}>
              <List className="h-4 w-4 shrink-0" />
              List
            </Button>
            <Button variant={viewMode === "kanban" ? "default" : "ghost"} size="sm" aria-pressed={viewMode === "kanban"} className="h-10 gap-1.5 px-2.5 sm:h-9" onClick={() => setViewMode("kanban")}>
              <LayoutGrid className="h-4 w-4 shrink-0" />
              Kanban
            </Button>
            <Button variant={viewMode === "pipeline" ? "default" : "ghost"} size="sm" aria-pressed={viewMode === "pipeline"} className="h-10 gap-1.5 px-2.5 sm:h-9" onClick={() => setViewMode("pipeline")}>
              <Columns3 className="h-4 w-4 shrink-0" />
              Pipeline
            </Button>
          </div>
        </div>
      </GlassCard>

      {/* Query error — same branch as before, promoted out of the counter strip into the
          canonical severity callout so a failed fetch cannot read as "zero applicants". */}
      {queryError && (
        <div className="rounded-lg border border-rose-500/35 bg-rose-500/5 p-3 sm:p-4">
          <div className="flex min-w-0 items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400" />
            <div className="min-w-0">
              <p className="text-sm font-semibold">Applicants could not load</p>
              <p className="mt-0.5 break-words text-xs text-muted-foreground">
                {(queryError as any)?.message?.slice(0, 100) ?? String(queryError).slice(0, 100)}
              </p>
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                The counts above are missing, not zero.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 2026-07-08 MP-256: 8-card applicant metric grid — each card is a click-filter. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        {[
          { key: "total", label: "Total Active", value: totalLeads, icon: Users, tone: "neutral", meaning: "All active applicants" },
          { key: "in_funnel", label: "In Funnel", value: inFunnel, icon: Filter, tone: "neutral", meaning: "Not hired, not terminated" },
          { key: "course_bought", label: "Course Bought", value: coursePurchased, icon: GraduationCap, tone: "neutral", meaning: "Course purchased" },
          { key: "hired", label: "Hired", value: hired, icon: UserCheck, tone: "good", meaning: "Marked hired" },
          { key: "rejected", label: "Rejected", value: rejected, icon: XCircle, tone: "bad", meaning: "Rejected / disqualified" },
          { key: "needs_followup", label: "Needs Follow-Up", value: needsFollowupCount, icon: Bell, tone: "warn", meaning: "48h+ no contact" },
          { key: "hot", label: "Hot Leads", value: hotLeadsCount, icon: Flame, tone: "warn", meaning: "Hot + warm score" },
          { key: "duplicates", label: "Duplicates", value: activeDuplicateCount, icon: Copy, tone: "warn", meaning: "Flagged is_duplicate" },
        ].map((card) => {
          const active = metricFilter === card.key;
          const Icon = card.icon;
          const toneValue: Record<string, string> = {
            neutral: "text-foreground",
            good: "text-emerald-600 dark:text-emerald-400",
            warn: "text-amber-600 dark:text-amber-400",
            bad: "text-rose-600 dark:text-rose-400",
          };
          const toneIcon: Record<string, string> = {
            neutral: "text-muted-foreground",
            good: "text-emerald-600 dark:text-emerald-400",
            warn: "text-amber-600 dark:text-amber-400",
            bad: "text-rose-600 dark:text-rose-400",
          };
          return (
            <button
              key={card.key}
              type="button"
              onClick={() => {
                setMetricFilter(card.key);
                // Reset dependent filters first
                setStatusFilter("all");
                setHotLeadsOnly(false);
                setNeedsFollowupOnly(false);
                setDuplicatesOnly(false);
                if (card.key === "in_funnel") setStatusFilter("in_funnel");
                else if (card.key === "course_bought") setStatusFilter("course_bought");
                else if (card.key === "hired") setStatusFilter("hired");
                else if (card.key === "rejected") setStatusFilter("rejected");
                else if (card.key === "needs_followup") setNeedsFollowupOnly(true);
                else if (card.key === "hot") setHotLeadsOnly(true);
                else if (card.key === "duplicates") setDuplicatesOnly(true);
              }}
              title={card.meaning}
              aria-pressed={active}
              aria-label={`Filter to ${card.label} — ${card.meaning}`}
              className={cn(
                "min-w-0 rounded-lg border bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted/40",
                "focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]",
                active ? "border-primary/40 ring-2 ring-primary/60" : "border-border"
              )}
            >
              <div className="flex min-w-0 items-center gap-2">
                <Icon className={cn("h-4 w-4 shrink-0", toneIcon[card.tone] || "text-muted-foreground")} />
                <span className="truncate text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{card.label}</span>
              </div>
              <div className={cn("mt-1.5 text-2xl font-bold leading-none tabular-nums", toneValue[card.tone] || "text-foreground")}>
                {card.value.toLocaleString()}
              </div>
            </button>
          );
        })}
      </div>

      {/* MP-268 pipeline ladder — one chip per captured recruiting stage, mutually exclusive
          so the counts sum to the active roster. See PIPELINE_STAGES for why fingerprints,
          carrier appointments and first sale are not rungs here yet. */}
      <GlassCard className="p-4">
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
            <GraduationCap className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">Pipeline stage</span>
          </h3>
          <span className="shrink-0 text-sm font-bold tabular-nums text-muted-foreground">
            {activeApplications.length.toLocaleString()}
          </span>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
          Every active applicant sits on exactly one rung. Pick a rung to work just that group.
        </p>
        <div className="flex flex-wrap gap-2">
          {[{ key: null, label: "All stages", count: activeApplications.length }, ...PIPELINE_STAGES.map((s) => ({
            key: s.key as PipelineStageKey | null,
            label: s.label,
            count: pipelineStageCounts[s.key],
          }))].map((chip) => {
            const active = pipelineStage === chip.key;
            const empty = chip.count === 0;
            return (
              <button
                key={chip.key ?? "all"}
                type="button"
                onClick={() => setPipelineStage(chip.key)}
                aria-pressed={active}
                aria-label={`Filter to ${chip.label} — ${chip.count} applicants`}
                className={cn(
                  "inline-flex min-w-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                  "focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]",
                  active
                    ? "border-primary/40 bg-primary/10 text-primary ring-2 ring-primary/60"
                    : "border-border bg-card text-foreground hover:bg-muted/40",
                  empty && !active && "opacity-55"
                )}
              >
                <span className="truncate">{chip.label}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{chip.count.toLocaleString()}</span>
              </button>
            );
          })}
        </div>
      </GlassCard>

      <GlassCard className="p-4">
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
            <Filter className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">Filters</span>
          </h3>
          <span className="shrink-0 text-sm font-bold tabular-nums text-muted-foreground">
            {activeFilterChips.length.toLocaleString()}
          </span>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
          Narrow the feed down to the applicants you are actually going to work in the next hour.
        </p>

        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search applicants..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-10 bg-input pl-9 sm:h-9"
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-10 w-full bg-input sm:h-9">
            <Filter className="mr-2 h-4 w-4 shrink-0" />
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="new">New</SelectItem>
            <SelectItem value="course_bought">Course bought</SelectItem>
            <SelectItem value="hired">Hired</SelectItem>
            <SelectItem value="contracted">Contracted</SelectItem>
            <SelectItem value="terminated">Terminated</SelectItem>
          </SelectContent>
        </Select>
        <Select value={licenseFilter} onValueChange={setLicenseFilter}>
          <SelectTrigger className="h-10 w-full bg-input sm:h-9">
            <Award className="mr-2 h-4 w-4 shrink-0" />
            <SelectValue placeholder="License" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Licenses</SelectItem>
            <SelectItem value="licensed">Licensed</SelectItem>
            <SelectItem value="unlicensed">Unlicensed</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sortOrder} onValueChange={setSortOrder}>
          <SelectTrigger className="h-10 w-full bg-input sm:h-9">
            <Clock className="mr-2 h-4 w-4 shrink-0" />
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">Newest First</SelectItem>
            <SelectItem value="oldest">Oldest First</SelectItem>
          </SelectContent>
        </Select>
        {recruiterOptions.length > 0 && (
          <Select value={agentFilter} onValueChange={setAgentFilter}>
            <SelectTrigger className="h-10 w-full bg-input sm:h-9">
              <Users className="mr-2 h-4 w-4 shrink-0" />
              <SelectValue placeholder="Agent" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Agents</SelectItem>
              {recruiterOptions.map(opt => (
                <SelectItem key={opt.id} value={opt.id}>{opt.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {uplineOptions.length > 0 && (
          <Select value={uplineFilter} onValueChange={setUplineFilter}>
            <SelectTrigger className="h-10 w-full bg-input sm:h-9">
              <Users className="mr-2 h-4 w-4 shrink-0" />
              <SelectValue placeholder="Upline" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Uplines</SelectItem>
              {uplineOptions.map(opt => (
                <SelectItem key={opt.id} value={opt.id}>{opt.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select value={interviewFilter} onValueChange={setInterviewFilter}>
          <SelectTrigger className="h-10 w-full bg-input sm:h-9">
            <Calendar className="mr-2 h-4 w-4 shrink-0" />
            <SelectValue placeholder="Interview" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Interview Status</SelectItem>
            <SelectItem value="scheduled">Interview scheduled</SelectItem>
            <SelectItem value="none">No interview yet</SelectItem>
          </SelectContent>
        </Select>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          variant={needsFollowupOnly ? "default" : "outline"}
          size="sm"
          aria-pressed={needsFollowupOnly}
          onClick={() => setNeedsFollowupOnly(!needsFollowupOnly)}
          className="h-10 gap-1.5 whitespace-nowrap sm:h-9"
          title="Created over 48h ago with no contact attempt yet"
        >
          <Clock className="h-4 w-4 shrink-0" />
          Needs follow-up
          <span className="tabular-nums">({needsFollowupCount.toLocaleString()})</span>
        </Button>
        <Button
          variant={hotLeadsOnly ? "default" : "outline"}
          size="sm"
          aria-pressed={hotLeadsOnly}
          onClick={() => setHotLeadsOnly(!hotLeadsOnly)}
          className="h-10 gap-1.5 whitespace-nowrap sm:h-9"
        >
          <Flame className="h-4 w-4 shrink-0" />
          Hot Leads
        </Button>
        <Button
          variant={showDuplicates ? "default" : "outline"}
          size="sm"
          aria-pressed={showDuplicates}
          onClick={() => setShowDuplicates(!showDuplicates)}
          className="h-10 gap-1.5 whitespace-nowrap sm:h-9"
        >
          <Copy className="h-4 w-4 shrink-0" />
          {showDuplicates ? "Duplicates shown" : "Show duplicates"}
          <span className="tabular-nums">({activeDuplicateCount.toLocaleString()})</span>
        </Button>
        {(isAdmin || isManager) && (
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              toast.info("Scoring all applicants...");
              const { error } = await supabase.functions.invoke("score-applicant", {
                body: { scoreAll: true }
              });
              if (error) toast.error("Scoring failed");
              else {
                toast.success("All applicants scored!");
                fetchApplications();
              }
            }}
            className="h-10 gap-1.5 whitespace-nowrap sm:h-9"
          >
            <Sparkles className="h-4 w-4 shrink-0" />
            Score All
          </Button>
        )}
        <Button
          variant={speedActive ? "default" : "outline"}
          size="sm"
          aria-pressed={speedActive}
          onClick={() => {
            if (speedActive) {
              setSpeedActive(false);
              setSpeedIndex(0);
              setDetailAppId(null);
            } else {
              setSpeedIndex(0);
              setSpeedActive(true);
            }
          }}
          className="h-10 gap-1.5 whitespace-nowrap sm:h-9"
          aria-label={speedActive ? "Exit Speed-to-Lead workflow" : "Start Speed-to-Lead workflow"}
          title="Auto-focus hottest, newest, and follow-up-due-today applicants back-to-back"
        >
          <Rocket className="h-4 w-4 shrink-0" />
          {speedActive ? "Exit Speed-to-Lead" : "Start Speed-to-Lead"}
        </Button>
        {activeFilterChips.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={resetAllFilters}
            className="h-10 gap-1.5 whitespace-nowrap text-muted-foreground sm:h-9"
            aria-label="Reset all filters"
          >
            <RotateCcw className="h-4 w-4 shrink-0" />
            Reset filters
          </Button>
        )}
        </div>

        {activeFilterChips.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
            <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Active</span>
            {activeFilterChips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                onClick={chip.clear}
                className="inline-flex h-8 min-w-0 items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/20 focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]"
                aria-label={`Clear filter: ${chip.label}`}
              >
                <span className="truncate">{chip.label}</span>
                <XIcon className="h-3 w-3 shrink-0" />
              </button>
            ))}
          </div>
        )}
      </GlassCard>

      {duplicatesOnly && duplicatePairs.length > 0 && (
        <DuplicateReviewPanel
          pairs={duplicatePairs}
          onMarkDup={async (id) => {
            const { error } = await supabase
              .from("applications")
              .update({ is_duplicate: true })
              .eq("id", id);
            if (error) {
              toast.error("Couldn't mark duplicate");
              return;
            }
            toast.success("Marked as duplicate");
            fetchApplications();
          }}
          onKeepBoth={async (aId, bId) => {
            const { error } = await supabase
              .from("applications")
              .update({ is_duplicate: false })
              .in("id", [aId, bId]);
            if (error) {
              toast.error("Couldn't unflag duplicates");
              return;
            }
            toast.success("Both kept as-is");
            fetchApplications();
          }}
          onOpen={(id) => setDetailAppId(id)}
        />
      )}

      {viewMode === "kanban" ? (
        <GlassCard className="p-4">
          <KanbanBoard
            applications={kanbanApps}
            onStageChange={handleKanbanStageChange}
            onCardClick={(app) => setNotesApp(applications.find(a => a.id === app.id) || null)}
            readOnly={!isAdmin && !isManager}
          />
        </GlassCard>
      ) : viewMode === "pipeline" ? (
        <PipelineView
          applications={filteredApplications}
          getStatus={getApplicationStatus}
          onCardClick={(id) => setDetailAppId(id)}
        />
      ) : (
        <GlassCard className="p-4">
          <div className="min-w-0">
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
                <List className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate">Applicant feed</span>
              </h3>
              <span className="shrink-0 text-sm font-bold tabular-nums text-muted-foreground">
                {filteredApplications.length.toLocaleString()}
              </span>
            </div>
            <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
              Every applicant in scope with their next best action — a row sitting here uncontacted is a lead going cold.
            </p>
            {filteredApplications.length > 0 ? (
              <div className="-mx-4 max-h-[calc(100vh-170px)] overflow-auto px-4 sm:mx-0 sm:px-0">
                <table className="w-full min-w-[1100px] text-sm">
                  <thead className="sticky top-0 z-10">
                    <tr className="border-b border-border text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                      <th className="bg-card px-2 py-2 text-left">Name</th>
                      <th className="bg-card px-2 py-2 text-left">Score</th>
                      <th className="bg-card px-2 py-2 text-left">Email</th>
                      <th className="bg-card px-2 py-2 text-left">Phone</th>
                      <th className="bg-card px-2 py-2 text-left">Status</th>
                      <th className="bg-card px-2 py-2 text-left">License</th>
                      <th className="bg-card px-2 py-2 text-left">Location</th>
                      <th className="bg-card px-2 py-2 text-left">Manager</th>
                      <th
                        className="bg-card px-2 py-2 text-left"
                        title="Recruiter's upline manager — who the referring agent reports to"
                      >
                        Upline
                      </th>
                      <th className="bg-card px-2 py-2 text-left">Created</th>
                      <th className="bg-card px-2 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="[&_tr:last-child]:border-0">
                    {filteredApplications.map((app) => {
                      const status = getApplicationStatus(app);
                      const isTerminated = statusFilter === "terminated";
                      const isHighlighted = highlightedLeadId === app.id;
                      // 2026-07-07 Sam: Next Best Action derivation per applicant row.
                      // Map Application → NBAInput exactly per priority.ts contract.
                      const endOfToday = new Date();
                      endOfToday.setHours(23, 59, 59, 999);
                      const nextActionDueRaw = (app as any).next_action_due_at as string | null | undefined;
                      const lastContactedRaw = (app as any).last_contacted_at as string | null | undefined;
                      const examPassedRaw = (app as any).exam_passed_at as string | null | undefined;
                      const nbaInput: NBAInput = {
                        kind: 'applicant',
                        is_new_applicant: !app.contacted_at && !app.terminated_at && !app.closed_at,
                        is_hot_lead: app.ai_score_tier === 'hot',
                        follow_up_due_today: !!(nextActionDueRaw && new Date(nextActionDueRaw) <= endOfToday),
                        no_contact_logged: !lastContactedRaw,
                        course_bought: !!app.course_purchased_at,
                        interview_scheduled: false,
                        duplicate_needs_review: !!app.is_duplicate,
                        rejected: app.status === 'rejected',
                        suppressed: !!app.terminated_at,
                        passed_test: !!examPassedRaw,
                        license_progress: app.license_progress,
                        license_status: app.license_status,
                        days_stale: lastContactedRaw
                          ? Math.floor((Date.now() - new Date(lastContactedRaw).getTime()) / 86400000)
                          : null,
                      };
                      const nba = getNextBestAction(nbaInput);
                      // getPriorityLabel is imported per Sam's contract; nba.priority already carries the label.
                      void getPriorityLabel;
                      const nbaDotClasses = priorityBadgeClasses(nba.priority)
                        .className.split(' ')
                        .filter((c) => c.startsWith('bg-'))
                        .join(' ');
                      return (
                        <Fragment key={app.id}>
                        <tr
                          id={`lead-${app.id}`}
                          className={cn(
                            "border-b border-border/60 transition-colors hover:bg-muted/30",
                            status === "new" && "bg-primary/[0.04]",
                            status === "contacted" && "bg-amber-500/[0.04]",
                            status === "contracted" && "bg-emerald-500/[0.04]",
                            status === "hired" && "bg-emerald-500/[0.06]",
                            isTerminated && "opacity-60",
                            isHighlighted && "bg-primary/5 ring-2 ring-primary"
                          )}
                        >
                          <td className="px-2 py-2 align-middle">
                            <div className="flex items-center gap-2">
                              <div className={cn(
                                "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold uppercase",
                                isTerminated ? "bg-destructive/20 text-destructive" : "bg-primary/20 text-primary"
                              )}>
                                {(app.first_name?.[0] || "") + (app.last_name?.[0] || "") || <Users className="h-4 w-4" />}
                              </div>
                              <div className="flex min-w-0 items-center gap-1.5">
                                {/* 2026-06-18 Sam: inline-edit first + last name */}
                                <div className="flex flex-col min-w-0">
                                  <InlineEditApplicantField
                                    applicationId={app.id}
                                    field="first_name"
                                    value={app.first_name}
                                    placeholder="First name"
                                    className="text-sm font-medium text-foreground"
                                    onSaved={fetchApplications}
                                  />
                                  <InlineEditApplicantField
                                    applicationId={app.id}
                                    field="last_name"
                                    value={app.last_name}
                                    placeholder="Last name"
                                    className="text-[11px] text-muted-foreground"
                                    onSaved={fetchApplications}
                                  />
                                </div>
                                {app.is_duplicate && <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 px-1 text-[9px] font-bold text-amber-600 dark:text-amber-400">DUP</Badge>}
                                {app.is_ghosted && <Badge variant="outline" className="border-rose-500/30 bg-rose-500/10 px-1 text-[9px] text-rose-600 dark:text-rose-400">👻</Badge>}
                              </div>
                            </div>
                            <div className="ml-11 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                              {app.instagram_handle && (
                                <a
                                  href={`https://instagram.com/${app.instagram_handle.replace(/^@+/, "")}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="inline-flex min-w-0 items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]"
                                  title={`Open @${app.instagram_handle.replace(/^@+/, "")} on Instagram`}
                                >
                                  <Instagram className="h-3 w-3 shrink-0" />
                                  <span className="truncate">@{app.instagram_handle.replace(/^@+/, "")}</span>
                                </a>
                              )}
                              {app.phone_bad_at && (
                                <Badge
                                  variant="outline"
                                  className="gap-1 border-rose-500/30 bg-rose-500/10 text-[10px] text-rose-600 dark:text-rose-400"
                                  title={
                                    app.couldnt_reach_email_sent_at
                                      ? `Bad number since ${new Date(app.phone_bad_at).toLocaleDateString()} · we emailed them ${new Date(app.couldnt_reach_email_sent_at).toLocaleDateString()}`
                                      : `Bad number since ${new Date(app.phone_bad_at).toLocaleDateString()} — no email sent (missing address)`
                                  }
                                >
                                  <PhoneOff className="h-2.5 w-2.5" />
                                  bad #{app.couldnt_reach_email_sent_at ? " · emailed" : ""}
                                </Badge>
                              )}
                            </div>
                            {/* 2026-07-07 Sam: compact Next Best Action row. */}
                            <div className="ml-11 mt-1 flex min-w-0 items-center gap-1.5 text-[11px]">
                              <span className={cn('h-2 w-2 shrink-0 rounded-full', nbaDotClasses)} />
                              <span className="truncate text-muted-foreground">{nba.action}</span>
                            </div>
                          </td>
                          <td className="px-2 py-2 align-middle">
                            {app.ai_score_tier ? (
                              <Badge variant="outline" className={cn("text-[10px] font-bold uppercase tabular-nums",
                                app.ai_score_tier === "hot" && "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400",
                                app.ai_score_tier === "warm" && "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
                                app.ai_score_tier === "cool" && "border-border bg-muted/50 text-muted-foreground",
                                app.ai_score_tier === "cold" && "border-border bg-muted/50 text-muted-foreground",
                              )}>
                                {app.ai_score_tier === "hot" && "🔥"}{app.ai_score_tier === "warm" && "🌤"}{app.ai_score_tier === "cool" && "❄️"}{app.ai_score_tier === "cold" && "🧊"} {app.lead_score}
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="max-w-[220px] px-2 py-2 align-middle text-[11px] text-muted-foreground">
                            {/* 2026-06-17 Sam: inline-edit any applicant field. */}
                            <InlineEditApplicantField
                              applicationId={app.id}
                              field="email"
                              value={app.email}
                              placeholder="email"
                              onSaved={fetchApplications}
                            />
                          </td>
                          <td className="max-w-[160px] px-2 py-2 align-middle text-[11px] tabular-nums text-muted-foreground">
                            <InlineEditApplicantField
                              applicationId={app.id}
                              field="phone"
                              value={app.phone}
                              placeholder="phone"
                              onSaved={fetchApplications}
                            />
                          </td>
                          <td className="px-2 py-2 align-middle">
                            <Badge variant="outline" className={cn("text-[10px] capitalize", statusColors[status])}>
                              {status}
                            </Badge>
                          </td>
                          <td className="px-2 py-2 align-middle">
                            {!isTerminated && app.license_status !== "licensed" ? (
                              <LicenseProgressSelector
                                applicationId={app.id}
                                currentProgress={app.license_progress}
                                onProgressUpdated={fetchApplications}
                              />
                            ) : (
                              <Badge variant="outline" className={cn("text-[10px] capitalize", licenseColors[app.license_status])}>
                                {app.license_status}
                              </Badge>
                            )}
                          </td>
                          <td className="max-w-[160px] px-2 py-2 align-middle text-[11px] text-muted-foreground">
                            <div className="truncate">{app.city && app.state ? `${app.city}, ${app.state}` : "—"}</div>
                          </td>
                          <td className="max-w-[160px] px-2 py-2 align-middle text-[11px]">
                            {app.assigned_agent_id ? (
                              <AgentNameLink agentId={app.assigned_agent_id} variant="bare">
                                <Badge variant="outline" className="cursor-pointer border-primary/30 bg-primary/10 text-[10px] text-primary transition-colors hover:bg-primary/20">
                                  {managerNames.get(app.assigned_agent_id) || "Manager"}
                                </Badge>
                              </AgentNameLink>
                            ) : (
                              <span className="text-muted-foreground">Unassigned</span>
                            )}
                          </td>
                          <td className="max-w-[160px] px-2 py-2 align-middle text-[11px]">
                            {(() => {
                              const recruiter = app.recruiter_id
                                ? recruiterDirectory.get(app.recruiter_id)
                                : null;
                              const uplineName = recruiter?.uplineId
                                ? uplineNames.get(recruiter.uplineId)
                                : null;
                              if (!recruiter) {
                                return <span className="text-muted-foreground">—</span>;
                              }
                              if (!uplineName) {
                                return (
                                  <span
                                    className="text-muted-foreground"
                                    title={`Referred by ${recruiter.name}; recruiter has no manager_id on file`}
                                  >
                                    —
                                  </span>
                                );
                              }
                              return (
                                recruiter?.uplineId ? (
                                  <AgentNameLink agentId={recruiter.uplineId} variant="bare">
                                    <Badge
                                      variant="outline"
                                      className="cursor-pointer border-border bg-muted/50 text-[10px] text-foreground transition-colors hover:bg-muted"
                                      title={`Referred by ${recruiter.name} — under ${uplineName}`}
                                    >
                                      {uplineName}
                                    </Badge>
                                  </AgentNameLink>
                                ) : (
                                  <Badge
                                    variant="outline"
                                    className="border-border bg-muted/50 text-[10px] text-foreground"
                                    title={`Referred by ${recruiter.name} — under ${uplineName}`}
                                  >
                                    {uplineName}
                                  </Badge>
                                )
                              );
                            })()}
                          </td>
                          <td className="whitespace-nowrap px-2 py-2 align-middle text-[11px] tabular-nums text-muted-foreground">
                            {getTimeAgo(app.created_at)}
                          </td>
                          <td className="px-2 py-2 align-middle text-right">
                            <div className="flex items-center justify-end gap-1">
                              {!isTerminated && (
                                <>
                                  {/* 2026-06-17 Sam directive: "I didn't type in
                                      anybody in CRM. I took the applicant and
                                      pushed them through." One-tap Promote → Agent. */}
                                  <PromoteApplicantButton
                                    applicationId={app.id}
                                    applicantName={`${app.first_name} ${app.last_name}`}
                                    compact
                                  />
                                  {/* 2026-06-17 Sam: "change the manager's things" */}
                                  <ReassignManagerButton
                                    kind="applicant"
                                    targetId={app.id}
                                    currentManagerId={app.assigned_agent_id ?? null}
                                    compact
                                    onReassigned={() => fetchApplications()}
                                  />
                                  {app.instagram_handle && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8"
                                      onClick={() => openInstagram(app.instagram_handle!)}
                                      title={`@${app.instagram_handle}`}
                                      aria-label={`Open Instagram profile @${app.instagram_handle.replace(/^@+/, "")}`}
                                    >
                                      <Instagram className="h-3.5 w-3.5" />
                                    </Button>
                                  )}
                                  {app.phone && !app.phone_bad_at && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8"
                                      title={`Call ${app.phone}`}
                                      aria-label={`Call ${app.first_name} ${app.last_name}`}
                                      asChild
                                    >
                                      <a
                                        href={`tel:${app.phone}`}
                                        onClick={() => logContactAttempt(app.id, "call")}
                                      >
                                        <Phone className="h-3.5 w-3.5" />
                                      </a>
                                    </Button>
                                  )}
                                  {app.phone && !app.phone_bad_at && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8"
                                      title={`Text ${app.phone}`}
                                      aria-label={`Text ${app.first_name} ${app.last_name}`}
                                      asChild
                                    >
                                      <a
                                        href={`sms:${app.phone}`}
                                        onClick={() => logContactAttempt(app.id, "sms")}
                                      >
                                        <MessageCircle className="h-3.5 w-3.5" />
                                      </a>
                                    </Button>
                                  )}
                                  {app.phone && !app.phone_bad_at && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8 text-rose-600 dark:text-rose-400"
                                      title="Mark number bad + email applicant we couldn't reach them"
                                      aria-label={`Mark ${app.first_name} ${app.last_name}'s phone as bad`}
                                      disabled={badPhoneBusy === app.id}
                                      onClick={() => handleMarkBadPhone(app)}
                                    >
                                      {badPhoneBusy === app.id
                                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        : <PhoneOff className="h-3.5 w-3.5" />}
                                    </Button>
                                  )}
                                  {app.email && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8"
                                      title={`Email ${app.email}`}
                                      aria-label={`Email ${app.first_name} ${app.last_name}`}
                                      asChild
                                    >
                                      <a
                                        href={`mailto:${app.email}`}
                                        onClick={() => logContactAttempt(app.id, "email")}
                                      >
                                        <Mail className="h-3.5 w-3.5" />
                                      </a>
                                    </Button>
                                  )}
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => setNotesApp(app)}
                                    title="Notes"
                                    aria-label={`Open notes for ${app.first_name} ${app.last_name}`}
                                  >
                                    <StickyNote className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => setRecorderApp(app)}
                                    title="Record"
                                    aria-label={`Record interview with ${app.first_name} ${app.last_name}`}
                                  >
                                    <Mic className="h-3.5 w-3.5" />
                                  </Button>
                                  {app.license_status !== "licensed" && (
                                    <ResendLicensingButton
                                      recipientEmail={app.email}
                                      recipientName={`${app.first_name} ${app.last_name}`}
                                      licenseStatus={app.license_status as "licensed" | "unlicensed" | "pending"}
                                      recipientPhone={app.phone || undefined}
                                      agentId={app.assigned_agent_id || undefined}
                                    />
                                  )}
                                  {isAdmin && (
                                    <QuickAssignMenu
                                      applicationId={app.id}
                                      currentAgentId={app.assigned_agent_id}
                                      onAssigned={fetchApplications}
                                      displayMode="icon"
                                      className="h-8 w-8 text-muted-foreground hover:text-primary"
                                    />
                                  )}
                                  {status !== "hired" && status !== "contracted" && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8 text-primary"
                                      onClick={() => handleMarkAsHired(app.id)}
                                      title="Hired"
                                      aria-label={`Mark ${app.first_name} ${app.last_name} as hired`}
                                    >
                                      <UserCheck className="h-3.5 w-3.5" />
                                    </Button>
                                  )}
                                  {status !== "hired" && status !== "contracted" && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8 text-destructive"
                                      onClick={() => setTerminateApp(app)}
                                      title="Terminate"
                                      aria-label={`Terminate ${app.first_name} ${app.last_name}`}
                                    >
                                      <XCircle className="h-3.5 w-3.5" />
                                    </Button>
                                  )}
                                </>
                              )}
                              {isTerminated && (
                                <Button variant="outline" size="sm" onClick={() => handleRestoreLead(app.id)} className="h-8 border-emerald-500/30 text-xs text-emerald-600 dark:text-emerald-400">
                                  <RotateCcw className="h-3 w-3 mr-1" /> Restore
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                        {!isTerminated && (
                          <tr
                            id={`lead-disp-${app.id}`}
                            className={cn(
                              "border-b border-border/60 bg-muted/20",
                              isHighlighted && "bg-primary/5",
                            )}
                          >
                            <td colSpan={11} className="px-2 py-2">
                              <ApplicationDispositionCluster
                                applicationId={app.id}
                                applicantEmail={app.email}
                                applicantFirstName={app.first_name}
                                applicantPhone={app.phone}
                                licenseStatus={app.license_status}
                                agentId={app.assigned_agent_id}
                                onMarkBad={() => handleMarkBadPhone(app)}
                              />
                            </td>
                          </tr>
                        )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                icon={<Users className="h-7 w-7" />}
                variant={activeApplications.length === 0 ? "warning" : "default"}
                title={activeApplications.length === 0 ? "No active applications fetched" : "No applicants match these filters"}
                description={
                  activeApplications.length === 0
                    ? "Nothing came back for your scope. If you expect rows here, your session or assignment scope is the thing to check."
                    : "The feed is filtered down to nothing. Clear the filters to get the full applicant list back."
                }
                actions={
                  activeApplications.length > 0 ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-10 w-full sm:h-9 sm:w-auto"
                      onClick={() => {
                        setSearchQuery("");
                        setStatusFilter("all");
                        setLicenseFilter("all");
                        setMyDirectsOnly(false);
                        setHotLeadsOnly(false);
                        setShowDuplicates(true);
                        setAgentFilter("all");
                        setUplineFilter("all");
                        setInterviewFilter("all");
                        setNeedsFollowupOnly(false);
                        const params = new URLSearchParams(searchParams);
                        ["status", "license", "contacted", "stage"].forEach((key) => params.delete(key));
                        setSearchParams(params, { replace: true });
                      }}
                    >
                      Clear filters
                    </Button>
                  ) : null
                }
              />
            )}
          </div>
        </GlassCard>
      )}

      {notesApp && (
        <ApplicantNotes
          applicationId={notesApp.id}
          applicantName={`${notesApp.first_name} ${notesApp.last_name}`}
          initialNotes={notesApp.notes}
          onClose={() => setNotesApp(null)}
          onSave={handleNotesSave}
        />
      )}

      {recorderApp && agentId && (
        <InterviewRecorder
          applicationId={recorderApp.id}
          agentId={agentId}
          applicantName={`${recorderApp.first_name} ${recorderApp.last_name}`}
          onClose={() => setRecorderApp(null)}
          onTranscriptionSaved={fetchApplications}
        />
      )}

      <Dialog open={!!terminateApp} onOpenChange={(open) => !open && setTerminateApp(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
              <XCircle className="h-5 w-5 shrink-0" />
              Terminate Lead
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to terminate {terminateApp?.first_name} {terminateApp?.last_name}? 
              This will move them to the terminated leads section.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-2 py-4">
            <Label htmlFor="reason">Reason (optional)</Label>
            <Textarea
              id="reason"
              placeholder="e.g., Not interested, Wrong number, Duplicate..."
              value={terminateReason}
              onChange={(e) => setTerminateReason(e.target.value)}
              className="bg-input"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" className="h-10 w-full sm:h-9 sm:w-auto" onClick={() => setTerminateApp(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="h-10 w-full sm:h-9 sm:w-auto"
              onClick={handleTerminate}
              disabled={isTerminating}
            >
              {isTerminating ? "Terminating..." : "Terminate Lead"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <LeadQualificationChat />

      <ApplicationDetailSheet
        open={!!detailAppId}
        onOpenChange={(open) => {
          if (!open) {
            setDetailAppId(null);
            // Do not auto-exit Speed-to-Lead — Sam presses Next / Skip.
          }
        }}
        applicationId={detailAppId ?? undefined}
        agentId={agentId ?? undefined}
        onRefresh={fetchApplications}
      />

      {speedActive && speedQueue.length > 0 && (
        <SpeedToLeadBar
          index={speedIndex}
          total={speedQueue.length}
          current={speedQueue[Math.min(speedIndex, speedQueue.length - 1)]}
          onSkip={() => {
            const next = speedIndex + 1;
            if (next >= speedQueue.length) {
              toast.success("Speed-to-Lead sweep complete.");
              setSpeedActive(false);
              setSpeedIndex(0);
              setDetailAppId(null);
              return;
            }
            setSpeedIndex(next);
          }}
          onExit={() => {
            setSpeedActive(false);
            setSpeedIndex(0);
            setDetailAppId(null);
          }}
          onLogCall={async (app) => {
            void logContactAttempt(app.id, "call");
            window.location.href = `tel:${app.phone || ""}`;
          }}
          onLogText={async (app) => {
            void logContactAttempt(app.id, "sms");
            window.location.href = `sms:${app.phone || ""}`;
          }}
          onLogEmail={async (app) => {
            void logContactAttempt(app.id, "email");
            window.location.href = `mailto:${app.email || ""}`;
          }}
        />
      )}
      </div>
    </div>
  );
}

interface DuplicatePairsProps {
  pairs: Array<{ key: string; apps: Application[] }>;
  onMarkDup: (id: string) => void | Promise<void>;
  onKeepBoth: (aId: string, bId: string) => void | Promise<void>;
  onOpen: (id: string) => void;
}

function DuplicateReviewPanel({ pairs, onMarkDup, onKeepBoth, onOpen }: DuplicatePairsProps) {
  return (
    <GlassCard className="p-4">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
          <Copy className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate">Duplicate review</span>
        </h3>
        <span className="shrink-0 text-sm font-bold tabular-nums text-muted-foreground">
          {pairs.length.toLocaleString()}
        </span>
      </div>
      <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
        Grouped by the same email or the last 10 phone digits — two rows here means one person is being worked twice.
      </p>
      <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
        {pairs.slice(0, 25).map(({ key, apps }) => {
          const [left, right] = apps;
          if (!left || !right) return null;
          return (
            <div key={key} className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-card p-3 sm:p-4 md:grid-cols-[1fr_auto_1fr]">
              <DupMiniCard app={left} onOpen={() => onOpen(left.id)} onMarkDup={() => onMarkDup(left.id)} />
              <div className="flex flex-col items-center justify-center gap-2 self-center">
                <Button size="sm" variant="outline" className="h-10 w-full whitespace-nowrap text-[11px] sm:h-9 sm:w-auto" onClick={() => onKeepBoth(left.id, right.id)}>
                  Keep both
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-10 w-full whitespace-nowrap text-[11px] text-muted-foreground sm:h-9 sm:w-auto"
                  disabled
                  title="Merge coming next wave"
                >
                  Merge into left
                </Button>
                <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">vs</span>
              </div>
              <DupMiniCard app={right} onOpen={() => onOpen(right.id)} onMarkDup={() => onMarkDup(right.id)} />
            </div>
          );
        })}
      </div>
    </GlassCard>
  );
}

function DupMiniCard({ app, onOpen, onMarkDup }: { app: Application; onOpen: () => void; onMarkDup: () => void }) {
  return (
    <div className="rounded-lg border border-border bg-card/60 p-3 sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 rounded-md text-left transition-colors hover:text-primary focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]"
          aria-label={`Open ${app.first_name} ${app.last_name}`}
        >
          <div className="truncate text-sm font-medium text-foreground">
            {app.first_name} {app.last_name}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{app.email || "no email"} · {app.phone || "no phone"}</div>
          <div className="text-[10px] tabular-nums text-muted-foreground">Applied {new Date(app.created_at).toLocaleDateString()}</div>
        </button>
        <Button size="sm" variant="outline" className="h-10 shrink-0 text-[11px] sm:h-9" onClick={onMarkDup} aria-label={`Mark ${app.first_name} as duplicate`}>
          Mark dup
        </Button>
      </div>
    </div>
  );
}

interface PipelineViewProps {
  applications: Application[];
  getStatus: (app: Application) => string;
  onCardClick: (id: string) => void;
}

function PipelineView({ applications, getStatus, onCardClick }: PipelineViewProps) {
  const columns: Array<{ key: string; label: string; match: (a: Application) => boolean }> = [
    { key: "applied", label: "Applied", match: (a) => getStatus(a) === "new" },
    { key: "contacted", label: "Contacted", match: (a) => getStatus(a) === "contacted" && !a.course_purchased_at },
    { key: "interview", label: "Interview Scheduled", match: (a) => Boolean((a as any).interview_scheduled_at) },
    { key: "course_bought", label: "Course Bought", match: (a) => Boolean(a.course_purchased_at) && a.license_progress !== "passed_test" && a.license_progress !== "waiting_on_license" && a.license_progress !== "licensed" },
    { key: "course_started", label: "Course Started", match: (a) => Boolean((a as any).course_started_at) && a.license_progress !== "passed_test" && a.license_progress !== "licensed" },
    { key: "course_complete", label: "Course Complete", match: (a) => a.license_progress === "passed_test" },
    { key: "licensed", label: "Licensed", match: (a) => a.license_status === "licensed" && !a.contracted_at },
    { key: "contracted", label: "Contracted", match: (a) => Boolean(a.contracted_at) && !(a as any).first_deal_at },
    { key: "producing", label: "Producing", match: (a) => Boolean((a as any).first_deal_at) },
    { key: "rejected", label: "Rejected", match: (a) => (a.status ?? "").toLowerCase() === "rejected" || (a.status ?? "").toLowerCase() === "disqualified" },
  ];
  const buckets = columns.map((c) => ({ ...c, apps: applications.filter(c.match) }));
  return (
    <div className="-mx-4 w-auto overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
      <div className="flex min-w-max gap-3">
        {buckets.map((col) => (
          <div key={col.key} className="w-64 shrink-0 rounded-lg border border-border bg-card/60">
            <div className="sticky top-0 flex items-center justify-between gap-2 rounded-t-lg border-b border-border bg-card px-3 py-2">
              <span className="min-w-0 truncate text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{col.label}</span>
              <span className="shrink-0 text-sm font-bold tabular-nums text-muted-foreground">{col.apps.length.toLocaleString()}</span>
            </div>
            <div className="max-h-[70vh] space-y-2 overflow-y-auto p-2">
              {col.apps.slice(0, 100).map((a) => {
                const endOfToday = new Date();
                endOfToday.setHours(23, 59, 59, 999);
                const nextDue = (a as any).next_action_due_at as string | null | undefined;
                const nbaInput: NBAInput = {
                  kind: 'applicant',
                  is_new_applicant: !a.contacted_at && !a.terminated_at && !a.closed_at,
                  is_hot_lead: a.ai_score_tier === 'hot',
                  follow_up_due_today: !!(nextDue && new Date(nextDue) <= endOfToday),
                  no_contact_logged: !((a as any).last_contacted_at),
                  course_bought: !!a.course_purchased_at,
                  duplicate_needs_review: !!a.is_duplicate,
                  rejected: a.status === 'rejected',
                  suppressed: !!a.terminated_at,
                  license_progress: a.license_progress,
                  license_status: a.license_status,
                };
                const nba = getNextBestAction(nbaInput);
                const dot = priorityBadgeClasses(nba.priority)
                  .className.split(' ')
                  .filter((c) => c.startsWith('bg-'))
                  .join(' ');
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => onCardClick(a.id)}
                    className="w-full rounded-lg border border-border/60 bg-card/60 px-3 py-2.5 text-left transition-colors hover:border-border hover:bg-card focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]"
                    aria-label={`Open ${a.first_name} ${a.last_name}`}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={cn("h-2 w-2 shrink-0 rounded-full", dot)} />
                      <span className="min-w-0 truncate text-sm font-medium text-foreground">
                        {a.first_name} {a.last_name}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {a.phone || a.email || "—"}
                    </div>
                  </button>
                );
              })}
              {col.apps.length === 0 && (
                <div className="rounded-lg border border-dashed border-border/60 p-3 text-center text-[11px] text-muted-foreground">
                  Nobody sits here
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface SpeedToLeadBarProps {
  index: number;
  total: number;
  current: Application | undefined;
  onSkip: () => void;
  onExit: () => void;
  onLogCall: (app: Application) => void | Promise<void>;
  onLogText: (app: Application) => void | Promise<void>;
  onLogEmail: (app: Application) => void | Promise<void>;
}

function SpeedToLeadBar({ index, total, current, onSkip, onExit, onLogCall, onLogText, onLogEmail }: SpeedToLeadBarProps) {
  if (!current) return null;
  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-card/95 px-4 py-2 shadow-sm sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Rocket className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              Speed-to-Lead · <span className="tabular-nums">{index + 1} of {total}</span>
            </div>
            <div className="truncate text-sm font-medium text-foreground">
              {current.first_name} {current.last_name} · {current.phone || current.email || "no contact"}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {current.phone && (
            <Button size="sm" variant="outline" className="h-10 gap-1.5 sm:h-9" onClick={() => onLogCall(current)} aria-label={`Call ${current.first_name}`}>
              <Phone className="h-4 w-4 shrink-0" /> Call
            </Button>
          )}
          {current.phone && (
            <Button size="sm" variant="outline" className="h-10 gap-1.5 sm:h-9" onClick={() => onLogText(current)} aria-label={`Text ${current.first_name}`}>
              <MessageCircle className="h-4 w-4 shrink-0" /> Text
            </Button>
          )}
          {current.email && (
            <Button size="sm" variant="outline" className="h-10 gap-1.5 sm:h-9" onClick={() => onLogEmail(current)} aria-label={`Email ${current.first_name}`}>
              <Mail className="h-4 w-4 shrink-0" /> Email
            </Button>
          )}
          <Button size="sm" variant="default" className="h-10 gap-1.5 sm:h-9" onClick={onSkip} aria-label="Next applicant">
            Next <ArrowRight className="h-4 w-4 shrink-0" />
          </Button>
          <Button size="sm" variant="ghost" className="h-10 gap-1.5 text-muted-foreground sm:h-9" onClick={onExit} aria-label="Exit Speed-to-Lead">
            <XIcon className="h-4 w-4 shrink-0" /> Exit
          </Button>
        </div>
      </div>
    </div>
  );
}

function ReferralLinkBanner({ agentId }: { agentId: string }) {
  const [copied, setCopied] = useState(false);
  const codeQuery = useQuery({
    queryKey: ["referral-agent-code", agentId],
    queryFn: async () => {
      const { data } = await supabase
        .from("agents")
        .select("agent_code, display_name")
        .eq("id", agentId)
        .maybeSingle();
      return data as { agent_code: string | null; display_name: string | null } | null;
    },
    staleTime: 30 * 60_000,
  });
  const agentCode = codeQuery.data?.agent_code ?? null;
  if (!agentCode) return null;
  const base = typeof window !== "undefined" ? window.location.origin : "https://apex-financial.org";
  const url = `${base}/apply?ref=${encodeURIComponent(agentCode)}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Referral link copied · ready to paste");
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error("Couldn't copy · select the link manually");
    }
  };
  const shareIfSupported = async () => {
    if (typeof navigator !== "undefined" && (navigator as any).share) {
      try {
        await (navigator as any).share({
          title: "Apply to APEX Financial",
          text: "Apply to APEX. Fast-track your insurance career.",
          url,
        });
      } catch {
        void 0;
      }
    } else {
      copy();
    }
  };
  return (
    <div className="rounded-lg border border-amber-500/35 bg-amber-500/5 p-3 sm:p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <Award className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="min-w-0 flex-1">
            <p className="mb-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Your referral link · paste anywhere</p>
            <p className="truncate font-mono text-xs text-foreground">{url}</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button size="sm" variant={copied ? "default" : "outline"} className="h-10 gap-1.5 sm:h-9" onClick={copy}>
            <Copy className="h-4 w-4 shrink-0" />
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button size="sm" variant="outline" className="h-10 gap-1.5 sm:h-9" onClick={shareIfSupported}>
            <Send className="h-4 w-4 shrink-0" />
            Share
          </Button>
          <Button asChild size="sm" variant="outline" className="h-10 gap-1.5 sm:h-9">
            <a href={url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4 shrink-0" />
              Open
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}
