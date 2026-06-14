import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Users,
  Phone,
  Mail,
  MapPin,
  Clock,
  Filter,
  Search,
  Instagram,
  CheckCircle,
  UserCheck,
  MessageCircle,
  Award,
  GraduationCap,
  ExternalLink,
  StickyNote,
  Mic,
  Building2,
  XCircle,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Send,
  FileCheck,
  Calendar,
  LayoutGrid,
  List,
  Copy,
  Sparkles,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
// DashboardLayout removed — AuthenticatedShell already provides SidebarLayout
import { useSoundEffects } from "@/hooks/useSoundEffects";
import { GlassCard } from "@/components/ui/glass-card";
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
import { ApplicantNotes } from "@/components/dashboard/ApplicantNotes";
import { InterviewRecorder } from "@/components/dashboard/InterviewRecorder";
import { ApplicantSummary } from "@/components/dashboard/ApplicantSummary";
import { LeadQualificationChat } from "@/components/dashboard/LeadQualificationChat";
import { QuickEmailMenu } from "@/components/dashboard/QuickEmailMenu";
import { QuickAssignMenu } from "@/components/dashboard/QuickAssignMenu";
import { LastContactedBadge } from "@/components/dashboard/LastContactedBadge";
import { LicenseProgressSelector } from "@/components/dashboard/LicenseProgressSelector";
import { ContractedModal } from "@/components/dashboard/ContractedModal";
import { ResendLicensingButton } from "@/components/callcenter/ResendLicensingButton";
import { InterviewScheduler } from "@/components/dashboard/InterviewScheduler";
import { KanbanBoard, type KanbanStage } from "@/components/pipeline/KanbanBoard";
import type { PipelineCardData } from "@/components/pipeline/PipelineCard";
import { logLeadActivity } from "@/lib/logLeadActivity";
import { PageLoadingSkeleton } from "@/components/ui/page-loading-skeleton";

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
  lead_score: number | null;
  ai_score_tier: string | null;
  course_purchased_at?: string | null;
  is_duplicate?: boolean;
  is_ghosted?: boolean;
  first_contact_attempt_at?: string | null;
}

const APPLICATION_SELECT =
  "id, first_name, last_name, email, phone, city, state, license_status, license_progress, started_training, contacted_at, contracted_at, closed_at, terminated_at, created_at, assigned_agent_id, recruiter_id, referral_manager_id, notes, previous_company, years_experience, has_insurance_experience, instagram_handle, lead_score, ai_score_tier, termination_reason, is_ghosted, is_duplicate, onboarding_stage, recruiter, course_purchased_at, course_started_at, exam_scheduled_at, exam_passed_at, licensed_at, ica_paid, ica_paid_at, first_deal_at, next_action, next_action_due_at, last_contact_at, next_step_due_at, referral_source";

const statusColors: Record<string, string> = {
  new: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  hired: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  contracted: "bg-violet-500/20 text-primary border-violet-500/30",
  terminated: "bg-red-500/20 text-red-400 border-red-500/30",
};

const licenseColors: Record<string, string> = {
  licensed: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  unlicensed: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  pending: "bg-blue-500/20 text-blue-400 border-blue-500/30",
};

export default function DashboardApplicants() {
  const { user, isAdmin, isManager } = useAuth();
  const { playSound } = useSoundEffects();
  const [searchParams, setSearchParams] = useSearchParams();
  const highlightedLeadId = searchParams.get("lead") || searchParams.get("id");
  const managerFilter = searchParams.get("manager");
  const stageFilter = searchParams.get("stage");
  // Deep-link filters from engine emails: ?license=licensed&status=new&contacted=untouched
  const licenseParam = searchParams.get("license");
  const statusParam = searchParams.get("status");
  const contactedParam = searchParams.get("contacted"); // 'untouched' | 'recent'

  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>(statusParam || "all");
  const [licenseFilter, setLicenseFilter] = useState<string>(licenseParam || "all");
  const [sortOrder, setSortOrder] = useState<string>("newest");
  const [myDirectsOnly, setMyDirectsOnly] = useState(false);
  const [hotLeadsOnly, setHotLeadsOnly] = useState(false);
  const [showDuplicates, setShowDuplicates] = useState(true);
  // Notes modal state
  const [notesApp, setNotesApp] = useState<Application | null>(null);
  
  // Interview recorder state
  const [recorderApp, setRecorderApp] = useState<Application | null>(null);

  // Terminate modal state
  const [terminateApp, setTerminateApp] = useState<Application | null>(null);
  const [terminateReason, setTerminateReason] = useState("");
  const [isTerminating, setIsTerminating] = useState(false);

  // Terminated section expanded state
  const [showTerminated, setShowTerminated] = useState(false);

  // Manual follow-up state
  const [sendingFollowupId, setSendingFollowupId] = useState<string | null>(null);

  // Contracted modal state
  const [contractedApp, setContractedApp] = useState<Application | null>(null);
  const [schedulerApp, setSchedulerApp] = useState<Application | null>(null);
  const [schedulerOpen, setSchedulerOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "kanban">("list");
  
  // When deep linking, clear filters to ensure lead is visible
  useEffect(() => {
    if (highlightedLeadId) {
      setStatusFilter("all");
      setLicenseFilter("all");
      setSearchQuery("");
    }
  }, [highlightedLeadId]);
  
  // Scroll to highlighted lead — moved after applications declaration

  const fetchApplicationsQuery = useCallback(async () => {
    if (!user) {
      return {
        apps: [] as Application[],
        terminatedApps: [] as Application[],
        names: new Map<string, string>(),
        myAgentId: null as string | null,
      };
    }

    // 2026-06-14 BUG FIX: was .single() which errors when a user has multiple
    // agent rows (Sam has SJAMES01 + SJAMES02). Switched to maybeSingle with
    // limit(1) — even if the error path triggers, isAdmin still passes through.
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

    // Attribution can live in any of 3 columns (assigned_agent_id,
    // referral_manager_id, recruiter_id). Always filter with .or() so a lead
    // credited via the referral column still shows up to the right agent.
    const orForAgentId = (id: string) =>
      `assigned_agent_id.eq.${id},referral_manager_id.eq.${id},recruiter_id.eq.${id}`;

    // If admin/manager with manager filter, filter by that manager (any column)
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
        if (!agentData) return { rows: [] as Application[], count: 0 };
        query = query.or(orForAgentId(agentData.id));
      }

      const { data, error, count } = await query.order("created_at", { ascending: false });
      if (error) {
        console.warn("[DashboardApplicants] applications fetch error:", {
          includeTerminated,
          managerFilter,
          error,
        });
        return { rows: [] as Application[], count: 0 };
      }

      return { rows: (data || []) as Application[], count: count ?? data?.length ?? 0 };
    };

    const activeResult = await fetchScopedApplications(false);
    const terminatedResult = await fetchScopedApplications(true);
    fetchedApps = activeResult.rows;

    const duplicateCount = fetchedApps.filter(app => app.is_duplicate).length;
    const coursePurchasedCount = fetchedApps.filter(app => Boolean(app.course_purchased_at)).length;
    console.info("[DashboardApplicants] fetched applications", {
      role: isAdmin ? "admin" : isManager ? "manager" : "agent",
      activeFetched: fetchedApps.length,
      activeCount: activeResult.count,
      terminatedFetched: terminatedResult.rows.length,
      terminatedCount: terminatedResult.count,
      duplicateCount,
      coursePurchasedCount,
      managerFilter: managerFilter || null,
    });

    // Batch fetch manager names for all assigned agents
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

    return {
      apps: fetchedApps,
      terminatedApps: terminatedResult.rows,
      names: nameMap,
      myAgentId: agentData?.id || null,
    };
  }, [user?.id, isAdmin, isManager, managerFilter]);

  const { data: queryData, isLoading } = useQuery({
    queryKey: ["applicants", user?.id, isAdmin, isManager, managerFilter],
    queryFn: fetchApplicationsQuery,
    enabled: !!user,
    staleTime: 60000,
  });

  const applications = queryData?.apps || [];
  const archivedApplications = queryData?.terminatedApps || [];
  const managerNames = queryData?.names || new Map<string, string>();
  const agentId = queryData?.myAgentId || null;

  const fetchApplications = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["applicants"] });
  }, [queryClient]);

  // Scroll to highlighted lead when data loads
  useEffect(() => {
    if (highlightedLeadId && applications.length > 0) {
      const timer = setTimeout(() => {
        const leadElement = document.getElementById(`lead-${highlightedLeadId}`);
        if (leadElement) {
          leadElement.scrollIntoView({ behavior: "smooth", block: "center" });
          setTimeout(() => setSearchParams({}), 2000);
        } else {
          const isTerminatedLead = applications.find(
            app => app.id === highlightedLeadId && app.terminated_at
          );
          if (isTerminatedLead) {
            setShowTerminated(true);
            setTimeout(() => {
              const leadEl = document.getElementById(`lead-${highlightedLeadId}`);
              if (leadEl) {
                leadEl.scrollIntoView({ behavior: "smooth", block: "center" });
                setTimeout(() => setSearchParams({}), 2000);
              }
            }, 300);
          }
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
    const diffMs = now.getTime() - date.getTime();
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
    
    // Send hire email to recruit (fire and forget)
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

    // Broadcast hire announcement to all managers
    supabase.functions.invoke("notify-hire-announcement", {
      body: { applicationId: id, agentId }
    }).then(({ error: announceErr }) => {
      if (announceErr) console.error("Failed to send hire announcement:", announceErr);
    });

    // Auto-create agent + enroll in course for LICENSED applicants
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
      // Send licensing instructions for unlicensed/unknown applicants
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
      toast.error("Could not terminate this lead — you may not have permission");
      playSound("error");
    } else {
      // Optimistic — just refetch
      fetchApplications();
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
    window.open(`https://instagram.com/${handle}`, "_blank");
  };

  const handleNotesSave = (notes: string) => {
    if (notesApp) {
      fetchApplications();
      setNotesApp(null);
    }
  };

  // Kanban stage change handler with activity logging
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

  

  const handleManualFollowup = async (applicationId: string) => {
    setSendingFollowupId(applicationId);
    try {
      const { error } = await supabase.functions.invoke("send-manual-followup", {
        body: { applicationId, agentId }
      });
      
      if (error) throw error;
      
      toast.success("Follow-up email sent!");
      fetchApplications();
    } catch (err) {
      console.error("Failed to send follow-up:", err);
      toast.error("Failed to send follow-up email");
    } finally {
      setSendingFollowupId(null);
    }
  };

  // Split applications into active and terminated — stable refs via useMemo
  const activeApplications = useMemo(
    () => applications.filter(app => !app.terminated_at),
    [applications]
  );
  const terminatedApplications = archivedApplications;

  // Map applications to PipelineCardData for Kanban
  const kanbanApps: PipelineCardData[] = useMemo(() =>
    activeApplications.map((app) => ({
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
    [activeApplications, managerNames]
  );

  // When status filter is "terminated", filter from terminated list instead
  const baseApplications = statusFilter === "terminated" ? terminatedApplications : activeApplications;

  const filteredApplications = useMemo(() =>
    baseApplications
      .filter((app) => {
        const q = searchQuery.toLowerCase();
        const name = `${app.first_name} ${app.last_name}`.toLowerCase();
        const matchesSearch = !q || name.includes(q) ||
          app.email.toLowerCase().includes(q) ||
          (app.phone && app.phone.includes(q));

        const appStatus = getApplicationStatus(app);
        const matchesStatus =
          statusFilter === "all" ||
          statusFilter === "terminated" ||
          (statusFilter === "course_bought" && Boolean(app.course_purchased_at)) ||
          appStatus === statusFilter;
        const matchesLicense = licenseFilter === "all" || app.license_status === licenseFilter;
        const matchesDirects = !myDirectsOnly || app.assigned_agent_id === agentId;
        const matchesHot = !hotLeadsOnly || (app as any).ai_score_tier === "hot" || (app as any).ai_score_tier === "warm";
        const matchesDuplicates = showDuplicates || !app.is_duplicate;

        // ?contacted=untouched → only rows where contacted_at AND last_contacted_at are null
        // ?contacted=recent → rows touched in last 24h
        const matchesContacted =
          contactedParam === "untouched"
            ? !app.contacted_at && !(app as any).last_contacted_at
            : contactedParam === "recent"
            ? (app as any).last_contacted_at && new Date((app as any).last_contacted_at).getTime() > Date.now() - 86_400_000
            : true;

        // Stage filter from query string (?stage=in_course etc.)
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

        return matchesSearch && matchesStatus && matchesLicense && matchesDirects && matchesHot && matchesDuplicates && matchesStage && matchesContacted;
      })
      .sort((a, b) => {
        const dateA = new Date(a.created_at).getTime();
        const dateB = new Date(b.created_at).getTime();
        return sortOrder === "newest" ? dateB - dateA : dateA - dateB;
      }),
    [baseApplications, searchQuery, statusFilter, licenseFilter, myDirectsOnly, hotLeadsOnly, showDuplicates, contactedParam, stageFilter, sortOrder, agentId]
  );

  const activeDuplicateCount = useMemo(
    () => activeApplications.filter(app => app.is_duplicate).length,
    [activeApplications]
  );

  const counterTotal = statusFilter === "terminated" ? terminatedApplications.length : activeApplications.length;
  const counterLabel = statusFilter === "terminated" ? "terminated applications" : "active applications";

  // Stats - exclude terminated from active stats — single pass
  const { totalLeads, hired, contracted, coursePurchased } = useMemo(() => {
    let hired = 0, contracted = 0, coursePurchased = 0;
    for (const a of activeApplications) {
      if (a.closed_at && !a.contracted_at) hired++;
      if (a.contracted_at) contracted++;
      const lp = a.license_progress as string | null;
      if (a.course_purchased_at || lp === "course_purchased" || lp === "finished_course") coursePurchased++;
    }
    return { totalLeads: activeApplications.length, hired, contracted, coursePurchased };
  }, [activeApplications]);

  // Helper for urgency badge
  const getUrgencyBadge = (app: Application) => {
    if (app.contacted_at || app.terminated_at) return null;
    const daysSinceCreated = Math.floor(
      (new Date().getTime() - new Date(app.created_at).getTime()) / (1000 * 60 * 60 * 24)
    );
    if (daysSinceCreated >= 3) {
      return <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-[10px] gap-1">🔴 {daysSinceCreated}d uncontacted</Badge>;
    }
    if (daysSinceCreated >= 2) {
      return <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[10px] gap-1">🟡 {daysSinceCreated}d uncontacted</Badge>;
    }
    return null;
  };

  const renderApplicationCard = (app: Application, index: number, isTerminated = false) => {
    const status = getApplicationStatus(app);
    const isHighlighted = highlightedLeadId === app.id;
    return (
      <div
        key={app.id}
        id={`lead-${app.id}`}
        className="opacity-100"
      >
        <GlassCard className={cn(
          "p-4 hover:bg-muted/50 transition-all duration-300 card-hover-lift",
          isTerminated && "opacity-60",
          isHighlighted && "ring-2 ring-primary shadow-lg shadow-primary/20 animate-pulse"
        )}>
          <div className="flex flex-col gap-4">
            {/* Top Row: Avatar, Name, Contact Info, Badges */}
            <div className="flex flex-col lg:flex-row lg:items-center gap-4">
              {/* Avatar & Name */}
              <div className="flex items-center gap-4 flex-1">
                <div className={cn(
                  "w-12 h-12 rounded-full flex items-center justify-center",
                  isTerminated ? "bg-red-500/20" : "bg-primary/20"
                )}>
                  <Users className={cn("h-6 w-6", isTerminated ? "text-red-400" : "text-primary")} />
                </div>
                <div>
                   <h3 className="font-semibold">{app.first_name} {app.last_name}</h3>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    <span>{getTimeAgo(app.created_at)}</span>
                    {getUrgencyBadge(app)}
                  </div>
                </div>
              </div>

              {/* Contact Info */}
              <div className="flex flex-wrap gap-4 text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Mail className="h-4 w-4" />
                  <span>{app.email}</span>
                </div>
                {app.phone && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Phone className="h-4 w-4" />
                    <span className="select-all cursor-text" title="Click to copy">{app.phone}</span>
                  </div>
                )}
                {app.city && app.state && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <MapPin className="h-4 w-4" />
                    <span>{app.city}, {app.state}</span>
                  </div>
                )}
              </div>

              {/* Badges */}
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className={cn("capitalize", statusColors[status])}>
                  {status}
                </Badge>
                
                {/* License Progress Selector (replaces static badge for unlicensed leads) */}
                {!isTerminated && app.license_status !== "licensed" ? (
                  <LicenseProgressSelector
                    applicationId={app.id}
                    currentProgress={app.license_progress}
                    onProgressUpdated={fetchApplications}
                  />
                ) : (
                  <Badge variant="outline" className={cn("capitalize", licenseColors[app.license_status])}>
                    {app.license_status === "licensed" && <Award className="h-3 w-3 mr-1" />}
                    {app.license_status === "unlicensed" && <GraduationCap className="h-3 w-3 mr-1" />}
                    {app.license_status}
                  </Badge>
                )}
                
                {app.started_training && (
                  <Badge variant="outline" className="bg-primary/20 text-primary border-primary/30">
                    Started Training
                  </Badge>
                )}

                {/* Manager Assignment Badge */}
                {app.assigned_agent_id ? (
                  <Badge variant="outline" className="bg-violet-500/10 text-primary border-violet-500/30 text-[10px]">
                    <Users className="h-3 w-3 mr-1" />
                    Under {managerNames.get(app.assigned_agent_id) || "Manager"}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground border-border text-[10px]">
                    Unassigned
                  </Badge>
                )}
              </div>
            </div>

            {/* Previous Experience Row */}
            {app.has_insurance_experience && app.previous_company && (
              <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-muted/50 w-fit">
                <Building2 className="h-4 w-4 text-amber-500" />
                <span className="text-sm text-muted-foreground">
                  Previously at <span className="text-foreground font-medium">{app.previous_company}</span>
                  {app.years_experience && app.years_experience > 0 && (
                    <span className="text-muted-foreground"> • {app.years_experience} yr{app.years_experience > 1 ? 's' : ''} exp</span>
                  )}
                </span>
              </div>
            )}

            {/* Termination Reason */}
            {isTerminated && app.termination_reason && (
              <div className="text-sm text-red-400 bg-red-500/10 rounded-md px-3 py-2 border-l-2 border-red-500/50">
                <span className="font-medium">Reason:</span> {app.termination_reason}
              </div>
            )}

            {/* Notes Preview */}
            {app.notes && !isTerminated && (
              <div className="text-sm text-muted-foreground bg-muted/30 rounded-md px-3 py-2 border-l-2 border-primary/50">
                <span className="line-clamp-2">{app.notes}</span>
              </div>
            )}

            {/* AI Summary */}
            {!isTerminated && (
              <ApplicantSummary 
                applicant={{
                  id: app.id,
                  full_name: `${app.first_name} ${app.last_name}`,
                  email: app.email,
                  phone: app.phone,
                  city: app.city || '',
                  state: app.state || '',
                  instagram_handle: app.instagram_handle || '',
                  has_license: app.license_status === 'licensed',
                  years_experience: app.years_experience?.toString() || '',
                  current_occupation: app.previous_company || '',
                  why_join: '',
                  status: status,
                  created_at: app.created_at,
                }}
              />
            )}

            {/* Actions Row */}
            <div className="flex items-center gap-1.5 flex-wrap pt-2 border-t border-border/50">
              {/* Last contacted badge */}
              <LastContactedBadge applicationId={app.id} />
              
              {app.instagram_handle && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-foreground hover:text-pink-300 hover:bg-rose-500/10"
                  onClick={() => openInstagram(app.instagram_handle!)}
                  title={`@${app.instagram_handle}`}
                  aria-label="Open Instagram"
                >
                  <Instagram className="h-4 w-4" />
                </Button>
              )}

              {!isTerminated && app.phone && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                  title={`Call ${app.phone}`}
                  aria-label="Call"
                  asChild
                >
                  <a href={`tel:${app.phone}`}>
                    <Phone className="h-4 w-4" />
                  </a>
                </Button>
              )}

              {!isTerminated && app.phone && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                  title={`Text ${app.phone}`}
                  aria-label="Text"
                  asChild
                >
                  <a href={`sms:${app.phone}`}>
                    <MessageCircle className="h-4 w-4" />
                  </a>
                </Button>
              )}

              {!isTerminated && app.email && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                  title={`Email ${app.email}`}
                  aria-label="Email"
                  asChild
                >
                  <a href={`mailto:${app.email}`}>
                    <Mail className="h-4 w-4" />
                  </a>
                </Button>
              )}
              
              {!isTerminated && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground",
                      app.notes && "text-primary"
                    )}
                    onClick={() => setNotesApp(app)}
                    title="Notes"
                    aria-label="Notes"
                  >
                    <StickyNote className="h-4 w-4" />
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                    onClick={() => setRecorderApp(app)}
                    title="Record"
                    aria-label="Record"
                  >
                    <Mic className="h-4 w-4" />
                  </Button>

                  {app.license_status !== "licensed" && (
                    <ResendLicensingButton
                      recipientEmail={app.email}
                      recipientName={app.first_name}
                      licenseStatus={app.license_status}
                      agentId={app.assigned_agent_id || undefined}
                    />
                  )}

                  {status !== "closed" && (
                    <QuickEmailMenu
                      applicationId={app.id}
                      agentId={agentId}
                      licenseStatus={app.license_status}
                      recipientEmail={app.email}
                      recipientName={`${app.first_name} ${app.last_name}`}
                      onEmailSent={fetchApplications}
                      displayMode="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-primary"
                    />
                  )}

                  {/* Admin-only quick assign */}
                  {isAdmin && (
                    <QuickAssignMenu
                      applicationId={app.id}
                      currentAgentId={app.assigned_agent_id}
                      onAssigned={fetchApplications}
                      displayMode="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-primary"
                    />
                  )}
                </>
              )}
              
              <div className="flex-1" />

              {isTerminated ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleRestoreLead(app.id)}
                  className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
                >
                  <RotateCcw className="h-4 w-4 mr-1" />
                  Restore
                </Button>
              ) : (
                <>
                  {/* Hired button */}
                  {status !== "hired" && status !== "contracted" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-emerald-400 hover:bg-emerald-500/10"
                      onClick={() => handleMarkAsHired(app.id)}
                      title="Mark as Hired"
                      aria-label="Hired"
                    >
                      <UserCheck className="h-4 w-4" />
                    </Button>
                  )}

                  {/* Contracted button */}
                  {!app.contracted_at && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-primary hover:bg-violet-500/10"
                      onClick={() => setContractedApp(app)}
                      title="Contract"
                      aria-label="Contracted"
                    >
                      <FileCheck className="h-4 w-4" />
                    </Button>
                  )}

                  {status !== "hired" && status !== "contracted" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-red-400 hover:bg-red-500/10"
                      onClick={() => setTerminateApp(app)}
                      title="Terminate"
                      aria-label="Terminate"
                    >
                      <XCircle className="h-4 w-4" />
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </GlassCard>
      </div>
    );
  };

  if (isLoading && applications.length === 0) {
    return <PageLoadingSkeleton variant="cards" />;
  }

  return (
    <>
      <PageHeader
        accent="cyan"
        eyebrow="Recruiting · Applicants"
        eyebrowIcon={<Users className="h-3 w-3" />}
        title="Applicants"
        subtitle="Manage and track every applicant in your recruiting funnel — assigned, referred, or recruited."
        actions={
          (isAdmin || isManager) && agentId
            ? <Button
                variant={myDirectsOnly ? "default" : "outline"}
                size="sm"
                className="h-8 text-xs gap-1.5"
                onClick={() => setMyDirectsOnly(!myDirectsOnly)}
              >
                <Users className="h-3.5 w-3.5" />
                {myDirectsOnly ? "My Directs" : "Full Team"}
              </Button>
            : null
        }
      />
      <div className="mb-5">
        <div className="flex items-center justify-end flex-wrap gap-3">
          <div className="flex items-center gap-2">
            {/* (header buttons relocated to PageHeader actions; this row keeps the toolbar below) */}
          {/* View Toggle */}
          <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
            <Button
              variant={viewMode === "list" ? "default" : "ghost"}
              size="sm"
              className="h-8 px-3"
              onClick={() => setViewMode("list")}
            >
              <List className="h-4 w-4 mr-1" />
              List
            </Button>
            <Button
              variant={viewMode === "kanban" ? "default" : "ghost"}
              size="sm"
              className="h-8 px-3"
              onClick={() => setViewMode("kanban")}
            >
              <LayoutGrid className="h-4 w-4 mr-1" />
              Kanban
            </Button>
          </div>
          </div>
        </div>
      </div>

      {/* 2026-06-14 v6.2 BIG-PROMPT · Premium hero band replacing the 4 flat GlassCards.
          Sam: "Applications · 0/0/0/0 · No applicants found" while 519 active in DB.
          The flat-row design hid the bug behind 4 gray tiles. New design surfaces
          the actual data PLUS makes the page look unrecognizable per v6 §31. */}
      <div className="relative overflow-hidden rounded-3xl border border-amber-500/25 bg-gradient-to-br from-slate-950 via-slate-900 to-amber-950 text-white shadow-[0_0_48px_-12px_hsl(45_85%_55%/0.25)] mb-5">
        <div className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-amber-500/15 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-32 -left-24 h-80 w-80 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />

        <div className="relative p-5">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <div className="flex items-center gap-2.5">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75 animate-ping" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
              </span>
              <p className="text-[11px] uppercase tracking-[0.32em] font-bold text-amber-300">RECRUITING PIPELINE · LIVE</p>
            </div>
            <Badge variant="outline" className="text-[10px] uppercase tracking-widest border-amber-400/40 bg-amber-400/10 text-amber-200">
              click to filter
            </Badge>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Total Active", value: totalLeads, color: "text-white",         tone: "bg-white/[0.04] border-white/[0.06] hover:border-white/20", filter: "all" },
              { label: "Course bought", value: coursePurchased, color: "text-emerald-300", tone: "bg-emerald-500/[0.08] border-emerald-500/20 hover:border-emerald-400/50", filter: "course_bought" },
              { label: "Contracted",  value: contracted,    color: "text-amber-300",   tone: "bg-amber-500/[0.08] border-amber-500/20 hover:border-amber-400/50", filter: "contracted" },
              { label: "Hired",       value: hired,         color: "text-emerald-300", tone: "bg-emerald-500/[0.08] border-emerald-500/20 hover:border-emerald-400/50", filter: "hired" },
            ].map((stat) => (
              <button
                key={stat.label}
                onClick={() => setStatusFilter(stat.filter === "terminated" ? "all" : stat.filter)}
                className={cn(
                  "group p-4 rounded-2xl border transition-all text-left",
                  stat.tone,
                  statusFilter === stat.filter && "ring-2 ring-amber-400/60 ring-offset-2 ring-offset-slate-950"
                )}
              >
                <p className="text-[10px] uppercase tracking-widest text-white/50 mb-1.5 font-bold">{stat.label}</p>
                <p className={cn("text-[32px] leading-none font-black tabular-nums", stat.color)}>{stat.value}</p>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 2026-06-14 BIG-PROMPT · Visible counter so Sam can SEE every applicant is loaded.
          Sam's repeating complaint: "missing applications". This proves none are hidden. */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          <p className="text-xs sm:text-sm font-semibold text-white tabular-nums">
            Showing <span className="text-amber-300 font-black">{filteredApplications.length.toLocaleString()}</span>
            <span className="text-white/60"> of </span>
            <span className="text-emerald-300 font-black">{counterTotal.toLocaleString()}</span>
            <span className="text-white/60"> total {counterLabel}</span>
            {statusFilter !== "terminated" && (
              <>
                <span className="text-white/30"> · </span>
                <span className="text-white/60">duplicates </span>
                <span className="text-amber-300 font-black">{activeDuplicateCount.toLocaleString()}</span>
                <span className="text-white/60">{showDuplicates ? " shown" : " hidden"}</span>
              </>
            )}
          </p>
        </div>
        {filteredApplications.length < counterTotal && (
          <Badge variant="outline" className="text-[10px] uppercase tracking-widest border-amber-400/40 bg-amber-400/10 text-amber-200">
            {counterTotal - filteredApplications.length} hidden by filters
          </Badge>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search applicants..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 bg-input"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-40 bg-input">
            <Filter className="h-4 w-4 mr-2" />
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
          <SelectTrigger className="w-full sm:w-40 bg-input">
            <Award className="h-4 w-4 mr-2" />
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
          <SelectTrigger className="w-full sm:w-40 bg-input">
            <Clock className="h-4 w-4 mr-2" />
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">Newest First</SelectItem>
            <SelectItem value="oldest">Oldest First</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant={hotLeadsOnly ? "default" : "outline"}
          size="sm"
          onClick={() => setHotLeadsOnly(!hotLeadsOnly)}
          className={cn("gap-1.5", hotLeadsOnly && "bg-orange-500 hover:bg-orange-600")}
        >
          🔥 Hot Leads
        </Button>
        <Button
          variant={showDuplicates ? "default" : "outline"}
          size="sm"
          onClick={() => setShowDuplicates(!showDuplicates)}
          className={cn(
            "gap-1.5 whitespace-nowrap",
            showDuplicates && "bg-amber-500 text-slate-950 hover:bg-amber-400"
          )}
        >
          <Copy className="h-3.5 w-3.5" />
          {showDuplicates ? "Duplicates shown" : "Show duplicates"} ({activeDuplicateCount.toLocaleString()})
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
            className="gap-1.5"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Score All
          </Button>
        )}
      </div>

      {/* Kanban View */}
      {viewMode === "kanban" ? (
        <div>
          <KanbanBoard
            applications={kanbanApps}
            onStageChange={handleKanbanStageChange}
            onCardClick={(app) => setNotesApp(applications.find(a => a.id === app.id) || null)}
            onScheduleInterview={(app) => {
              setSchedulerApp(applications.find(a => a.id === app.id) || null);
              setSchedulerOpen(true);
            }}
            readOnly={!isAdmin && !isManager}
          />
        </div>
      ) : (
        <>
          {/* Applicants Table */}
          <div>
            {filteredApplications.length > 0 ? (
              <div className="relative w-full overflow-auto border border-border rounded-md max-h-[calc(100vh-280px)] overflow-y-auto">
                <table className="w-full caption-bottom text-sm min-w-[1100px]">
                  <thead className="[&_tr]:border-b">
                    <tr className="border-b bg-muted/50">
                      <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">Name</th>
                      <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">Score</th>
                      <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">Email</th>
                      <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">Phone</th>
                      <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">Status</th>
                      <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">License</th>
                      <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">Location</th>
                      <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">Manager</th>
                      <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">Created</th>
                      <th className="h-10 px-4 text-right align-middle font-medium text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="[&_tr:last-child]:border-0">
                    {filteredApplications.map((app) => {
                      const status = getApplicationStatus(app);
                      const isTerminated = statusFilter === "terminated";
                      const isHighlighted = highlightedLeadId === app.id;
                      return (
                        <tr
                          key={app.id}
                          id={`lead-${app.id}`}
                          className={cn(
                            "border-b transition-colors hover:bg-muted/50",
                            isTerminated && "opacity-60",
                            isHighlighted && "ring-2 ring-primary bg-primary/5"
                          )}
                        >
                          <td className="p-3 align-middle">
                            <div className="flex items-center gap-2">
                              <div className={cn(
                                "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
                                isTerminated ? "bg-destructive/20" : "bg-primary/20"
                              )}>
                                <Users className={cn("h-4 w-4", isTerminated ? "text-destructive" : "text-primary")} />
                              </div>
                              <div className="min-w-0 flex items-center gap-1.5">
                                <p className="font-medium truncate">{app.first_name} {app.last_name}</p>
                                {app.is_duplicate && <Badge variant="outline" className="text-[9px] bg-amber-500/20 text-amber-400 border-amber-500/30 px-1">DUP</Badge>}
                                {app.is_ghosted && <Badge variant="outline" className="text-[9px] bg-red-500/20 text-red-400 border-red-500/30 px-1">👻</Badge>}
                              </div>
                            </div>
                          </td>
                          <td className="p-3 align-middle">
                            {app.ai_score_tier ? (
                              <Badge variant="outline" className={cn("text-[10px] font-bold uppercase",
                                app.ai_score_tier === "hot" && "bg-orange-500/20 text-amber-500 border-orange-500/30",
                                app.ai_score_tier === "warm" && "bg-amber-500/20 text-amber-400 border-amber-500/30",
                                app.ai_score_tier === "cool" && "bg-blue-500/20 text-blue-400 border-blue-500/30",
                                app.ai_score_tier === "cold" && "bg-slate-500/20 text-slate-400 border-slate-500/30",
                              )}>
                                {app.ai_score_tier === "hot" && "🔥"}{app.ai_score_tier === "warm" && "🌤"}{app.ai_score_tier === "cool" && "❄️"}{app.ai_score_tier === "cold" && "🧊"} {app.lead_score}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </td>
                          <td className="p-3 align-middle">
                            <span className="text-muted-foreground">{app.email}</span>
                          </td>
                          <td className="p-3 align-middle">
                            {app.phone ? (
                              <span className="text-muted-foreground select-all cursor-text" onClick={(e) => e.stopPropagation()}>{app.phone}</span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="p-3 align-middle">
                            <Badge variant="outline" className={cn("capitalize text-[10px]", statusColors[status])}>
                              {status}
                            </Badge>
                          </td>
                          <td className="p-3 align-middle">
                            {!isTerminated && app.license_status !== "licensed" ? (
                              <LicenseProgressSelector
                                applicationId={app.id}
                                currentProgress={app.license_progress}
                                onProgressUpdated={fetchApplications}
                              />
                            ) : (
                              <Badge variant="outline" className={cn("capitalize text-[10px]", licenseColors[app.license_status])}>
                                {app.license_status}
                              </Badge>
                            )}
                          </td>
                          <td className="p-3 align-middle text-muted-foreground text-xs">
                            {app.city && app.state ? `${app.city}, ${app.state}` : "—"}
                          </td>
                          <td className="p-3 align-middle text-xs">
                            {app.assigned_agent_id ? (
                              <Badge variant="outline" className="bg-violet-500/10 text-primary border-violet-500/30 text-[10px]">
                                {managerNames.get(app.assigned_agent_id) || "Manager"}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">Unassigned</span>
                            )}
                          </td>
                          <td className="p-3 align-middle text-muted-foreground text-xs">
                            {getTimeAgo(app.created_at)}
                          </td>
                          <td className="p-3 align-middle text-right">
                            <div className="flex items-center justify-end gap-1">
                              {!isTerminated && (
                                <>
                                  {app.instagram_handle && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 text-foreground hover:text-pink-300 hover:bg-rose-500/10"
                                      onClick={() => openInstagram(app.instagram_handle!)}
                                      title={`@${app.instagram_handle}`}
                                    >
                                      <Instagram className="h-3.5 w-3.5" />
                                    </Button>
                                  )}
                                  {app.phone && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7"
                                      title={`Call ${app.phone}`}
                                      asChild
                                    >
                                      <a href={`tel:${app.phone}`}>
                                        <Phone className="h-3.5 w-3.5" />
                                      </a>
                                    </Button>
                                  )}
                                  {app.phone && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7"
                                      title={`Text ${app.phone}`}
                                      asChild
                                    >
                                      <a href={`sms:${app.phone}`}>
                                        <MessageCircle className="h-3.5 w-3.5" />
                                      </a>
                                    </Button>
                                  )}
                                  {app.email && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7"
                                      title={`Email ${app.email}`}
                                      asChild
                                    >
                                      <a href={`mailto:${app.email}`}>
                                        <Mail className="h-3.5 w-3.5" />
                                      </a>
                                    </Button>
                                  )}
                                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setNotesApp(app)} title="Notes">
                                    <StickyNote className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setRecorderApp(app)} title="Record">
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
                                      className="h-7 w-7 text-muted-foreground hover:text-primary"
                                    />
                                  )}
                                  {status !== "hired" && status !== "contracted" && (
                                    <Button variant="ghost" size="icon" className="h-7 w-7 text-primary" onClick={() => handleMarkAsHired(app.id)} title="Hired">
                                      <UserCheck className="h-3.5 w-3.5" />
                                    </Button>
                                  )}
                                  {status !== "hired" && status !== "contracted" && (
                                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setTerminateApp(app)} title="Terminate">
                                      <XCircle className="h-3.5 w-3.5" />
                                    </Button>
                                  )}
                                </>
                              )}
                              {isTerminated && (
                                <Button variant="outline" size="sm" onClick={() => handleRestoreLead(app.id)} className="text-emerald-400 border-emerald-500/30 h-7 text-xs">
                                  <RotateCcw className="h-3 w-3 mr-1" /> Restore
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="border border-border rounded-md p-12 text-center">
                <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">
                  {isLoading ? "Loading applications…" : activeApplications.length === 0 ? "No active applications fetched" : "Filters are hiding everything"}
                </h3>
                {/* 2026-06-15 v7.1 · Sam: "I still see no applications." 99% of
                    the time the fetch returned hundreds of rows but client-side
                    filters reduced them to 0. Diagnostic panel below makes that
                    visible + offers a one-tap reset. */}
                {!isLoading && (
                  <div className="space-y-3 max-w-md mx-auto">
                    <p className="text-13 text-muted-foreground">
                      Fetched <span className="font-bold text-foreground tabular-nums">{activeApplications.length.toLocaleString()}</span> active applications
                      from the database{terminatedApplications.length > 0 && <> · <span className="font-bold text-foreground tabular-nums">{terminatedApplications.length.toLocaleString()}</span> terminated</>}.
                    </p>
                    {activeApplications.length === 0 ? (
                      <div className="text-12 text-rose-600 dark:text-rose-400">
                        Zero rows came back from the database. Likely causes:
                        <ul className="list-disc list-inside mt-2 text-left">
                          <li>Your session expired (try logging out + back in)</li>
                          <li>Your role lost admin grant (check user_roles)</li>
                          <li>RLS policy regression (check Supabase logs)</li>
                        </ul>
                      </div>
                    ) : (
                      <>
                        <p className="text-12 text-amber-600 dark:text-amber-400">
                          But the filters below match <span className="font-bold tabular-nums">0</span>.
                          The data IS there — your filters are hiding it.
                        </p>
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => {
                            setSearchQuery("");
                            setStatusFilter("all");
                            setLicenseFilter("all");
                            setMyDirectsOnly(false);
                            setHotLeadsOnly(false);
                            setShowDuplicates(true);
                            // Clear URL params that may also be filtering
                            const params = new URLSearchParams(searchParams);
                            params.delete("status");
                            params.delete("license");
                            params.delete("contacted");
                            params.delete("stage");
                            setSearchParams(params, { replace: true });
                          }}
                          className="bg-amber-500 hover:bg-amber-400 text-slate-950"
                        >
                          Clear all filters · show {activeApplications.length.toLocaleString()} applications
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

      {/* Terminated Leads Section - Only show when not filtering by terminated */}
      {statusFilter !== "terminated" && terminatedApplications.length > 0 && (
        <div className="mt-8">
          <button
            onClick={() => setShowTerminated(!showTerminated)}
            className="w-full flex items-center justify-between p-4 rounded-lg bg-red-500/10 border border-red-500/20 hover:bg-red-500/15 transition-colors"
          >
            <div className="flex items-center gap-3">
              <XCircle className="h-5 w-5 text-red-400" />
              <span className="font-semibold text-red-400">
                Terminated Leads ({terminatedApplications.length})
              </span>
            </div>
            {showTerminated ? (
              <ChevronUp className="h-5 w-5 text-red-400" />
            ) : (
              <ChevronDown className="h-5 w-5 text-red-400" />
            )}
          </button>

          {showTerminated && (
            <div className="space-y-4 mt-4 animate-in fade-in-0 slide-in-from-top-1 duration-200">
              {terminatedApplications.map((app, index) => renderApplicationCard(app, index, true))}
            </div>
          )}
        </div>
      )}
        </>
      )}

      {/* Notes Modal */}
      {notesApp && (
        <ApplicantNotes
          applicationId={notesApp.id}
          applicantName={`${notesApp.first_name} ${notesApp.last_name}`}
          initialNotes={notesApp.notes}
          onClose={() => setNotesApp(null)}
          onSave={handleNotesSave}
        />
      )}

      {/* Interview Recorder Modal */}
      {recorderApp && agentId && (
        <InterviewRecorder
          applicationId={recorderApp.id}
          agentId={agentId}
          applicantName={`${recorderApp.first_name} ${recorderApp.last_name}`}
          onClose={() => setRecorderApp(null)}
          onTranscriptionSaved={fetchApplications}
        />
      )}

      {/* Terminate Confirmation Modal */}
      <Dialog open={!!terminateApp} onOpenChange={(open) => !open && setTerminateApp(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-400">
              <XCircle className="h-5 w-5" />
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
            <Button variant="outline" onClick={() => setTerminateApp(null)}>
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              onClick={handleTerminate}
              disabled={isTerminating}
            >
              {isTerminating ? "Terminating..." : "Terminate Lead"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Contracted Modal */}
      {contractedApp && agentId && (
        <ContractedModal
          open={!!contractedApp}
          onOpenChange={(open) => !open && setContractedApp(null)}
          application={contractedApp}
          agentId={agentId}
          onSuccess={() => {
            fetchApplications();
          }}
        />
      )}

      {/* Lead Qualification Chat */}
      <LeadQualificationChat />
    </>
  );
}
