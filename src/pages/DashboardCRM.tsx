import React, { useState, useEffect, useCallback, useMemo } from "react";
import { AgentAvatar, getAvatarUrl } from "@/components/ui/AgentAvatar";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Users, Search, RefreshCw, Clock, AlertTriangle, ChevronRight,
  Mail, Phone, UserX, Filter, GraduationCap, Briefcase, Sparkles,
  Instagram, X, Send, CheckSquare, EyeOff, Link2, Eye, FileText,
  KeyRound, Copy, StickyNote, ClipboardCheck, Circle, CircleCheck,
  MoreHorizontal,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useConfirm } from "@/hooks/useConfirm";
import { toast } from "sonner";
import { AddAgentModal } from "@/components/dashboard/AddAgentModal";
import { AgentNotes } from "@/components/dashboard/AgentNotes";
import { DeactivateAgentDialog } from "@/components/dashboard/DeactivateAgentDialog";
import { BulkStageActions, AgentSelectCheckbox } from "@/components/crm/BulkStageActions";
import { cn } from "@/lib/utils";
import { Database } from "@/integrations/supabase/types";
import { ResendLicensingButton } from "@/components/callcenter/ResendLicensingButton";
import { LicenseProgressSelector } from "@/components/dashboard/LicenseProgressSelector";
import { ApplicationDetailSheet } from "@/components/dashboard/ApplicationDetailSheet";
import { AgentQuickEditDialog } from "@/components/dashboard/AgentQuickEditDialog";
import { useSoundEffects } from "@/hooks/useSoundEffects";
import { differenceInDays } from "date-fns";
import { BulkComposeDrawer } from "@/components/dashboard/BulkComposeDrawer";
import { AgentCredentialsPanel } from "@/components/dashboard/AgentCredentialsPanel";
import { AgentNameLink } from "@/components/dashboard/AgentNameLink";
import { AgentTrainingStageBar } from "@/components/dashboard/AgentTrainingStageBar";
import { useRealtimeTable } from "@/shared/realtime/useRealtimeTable";
import { PageLoadingSkeleton } from "@/components/ui/page-loading-skeleton";
import { getBusinessDayKey, getBusinessMonthBounds, getBusinessWeekBounds, getMatchedPriorWeekBounds } from "@/lib/dateUtils";
import { getCloseRate, sumAnnualPremium } from "@/lib/metricTruth";
import { DEAL_TRUTH_STATUS_FILTER } from "@/lib/dealTruth";
import { getNextBestAction, type NBAInput } from "@/lib/nextBestAction";
import { priorityBadgeClasses } from "@/lib/priority";

/** Feature flag: hide destructive bulk delete by default. Set VITE_ENABLE_CRM_BULK_DELETE=true to enable. */
const ENABLE_BULK_DELETE = import.meta.env.VITE_ENABLE_CRM_BULK_DELETE === "true";

/** localStorage key for persisted CRM filter state */
const CRM_FILTERS_STORAGE_KEY = "crm.filters.v1";

interface PersistedCrmFilters {
  searchTerm: string;
  managerFilter: string;
  licenseFilter: string;
  aiScoreFilter: string;
  showDeactivated: boolean;
  showInactive: boolean;
}

const DEFAULT_FILTERS: PersistedCrmFilters = {
  searchTerm: "",
  managerFilter: "all",
  licenseFilter: "all",
  aiScoreFilter: "all",
  showDeactivated: false,
  showInactive: false,
};

function loadPersistedFilters(): PersistedCrmFilters {
  try {
    const raw = localStorage.getItem(CRM_FILTERS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_FILTERS };
    return { ...DEFAULT_FILTERS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_FILTERS };
  }
}

type AttendanceStatus = Database["public"]["Enums"]["attendance_status"];
type PerformanceTier = Database["public"]["Enums"]["performance_tier"];
type OnboardingStage = Database["public"]["Enums"]["onboarding_stage"];

interface Manager { id: string; name: string; }

interface AgentCRM {
  id: string; userId: string; name: string; applicationId?: string;
  email: string; phone?: string; avatarUrl?: string; instagramHandle?: string;
  onboardingStage: OnboardingStage; attendanceStatus: AttendanceStatus;
  performanceTier: PerformanceTier; fieldTrainingStartedAt?: string; startDate?: string;
  onboardingCompletedAt?: string;
  totalEarnings: number; hasTrainingCourse: boolean; hasDialerLogin: boolean; hasDiscordAccess: boolean;
  potentialRating: number; evaluationResult?: string | null;
  isDeactivated: boolean; isInactive: boolean; managerId?: string; managerName?: string;
  weekly10kBadges: number; sortOrder: number;
  weeklyALP: number; weeklyPresentations: number; weeklyDeals: number; weeklyClosingRate: number;
  monthlyALP: number; monthlyDeals: number; prevWeekALP: number;
  lastContactedAt: string | null; standardPaid: boolean; premiumPaid: boolean;
  licenseProgress: string | null; testScheduledDate: string | null; agentLicenseStatus: string;
  aiScoreTier?: string | null;
  lifetimeDeals: number;
  lifetimeALP: number;
  lastActivityAt: string | null;
  daysSinceHire: number | null;
  hasReadymodeCreds: boolean;
  createdAt: string | null;
}

const attendanceColors: Record<AttendanceStatus, string> = {
  good: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  warning: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  critical: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
};
const attendanceLabels: Record<AttendanceStatus, string> = { good: "Good", warning: "Warning", critical: "Critical" };

const getTimeAgo = (dateString: string): string => {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "—";
  // Guard future-dated timestamps. "Last activity" is derived from production
  // dates, and an insurance policy's posted/effective date can legitimately be
  // in the future — so the delta must be clamped to 0, otherwise it renders as
  // a nonsensical negative ("-18690m ago"). A just-written future-dated policy
  // reads as "just now", which is the honest meaning of the activity.
  const diffMs = Math.max(0, Date.now() - date.getTime());
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffHours / 24);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

const isStaleAgent = (agent: AgentCRM): boolean => {
  if (!agent.lastContactedAt) {
    // Agents with no contact date are stale only if they've been around (have activity or are not brand new)
    return true;
  }
  const daysSince = (Date.now() - new Date(agent.lastContactedAt).getTime()) / (1000 * 60 * 60 * 24);
  return daysSince >= 6;
};

const getContactInfo = (agent: AgentCRM) => {
  if (!agent.lastContactedAt) {
    return { label: "Never", color: "text-red-500 dark:text-red-400" };
  }
  const days = (Date.now() - new Date(agent.lastContactedAt).getTime()) / (1000 * 60 * 60 * 24);
  if (days < 3) return { label: getTimeAgo(agent.lastContactedAt), color: "text-emerald-600 dark:text-emerald-400" };
  if (days < 6) return { label: getTimeAgo(agent.lastContactedAt), color: "text-amber-600 dark:text-amber-400" };
  return { label: getTimeAgo(agent.lastContactedAt), color: "text-red-500 dark:text-red-400" };
};

type PipelineBucket = "unlicensed" | "licensed";

const PRELICENSED_PROGRESS = new Set([
  "unlicensed", "course_purchased", "finished_course", "test_scheduled",
  "passed_test", "fingerprints_done", "waiting_fingerprints", "waiting_on_license",
]);

const PROGRESS_LABELS: Record<string, string> = {
  unlicensed: "Not Started",
  course_purchased: "In Course",
  finished_course: "Finished",
  test_scheduled: "Test Sched.",
  passed_test: "Passed",
  fingerprints_done: "Fingerprints",
  waiting_fingerprints: "Waiting FP",
  waiting_on_license: "Waiting Lic.",
  licensed: "Licensed",
};
const SECTIONS = [
  { key: "applied", bucket: "unlicensed" as PipelineBucket, label: "Applied", icon: Users, stages: ["applied"] as OnboardingStage[], accent: "border-l-blue-500", headerBg: "bg-blue-500/5", iconColor: "text-blue-500" },
  { key: "meeting_attendance", bucket: "unlicensed" as PipelineBucket, label: "Meeting Attendance", icon: ClipboardCheck, stages: ["meeting_attendance"] as OnboardingStage[], accent: "border-l-purple-500", headerBg: "bg-purple-500/5", iconColor: "text-purple-500" },
  { key: "pre_licensed", bucket: "unlicensed" as PipelineBucket, label: "Pre-Licensed", icon: GraduationCap, stages: ["pre_licensed", "onboarding", "training_online"] as OnboardingStage[], accent: "border-l-yellow-500", headerBg: "bg-yellow-500/5", iconColor: "text-amber-500" },
  { key: "transfer", bucket: "licensed" as PipelineBucket, label: "Transfer", icon: Users, stages: ["transfer"] as OnboardingStage[], accent: "border-l-orange-500", headerBg: "bg-orange-500/5", iconColor: "text-amber-500" },
  { key: "in_training", bucket: "licensed" as PipelineBucket, label: "In-Field Training", icon: GraduationCap, stages: ["in_field_training"] as OnboardingStage[], accent: "border-l-teal-500", headerBg: "bg-teal-500/5", iconColor: "text-teal-500" },
  { key: "below_10k", bucket: "licensed" as PipelineBucket, label: "Below $20K (last 30d)", icon: AlertTriangle, stages: ["below_10k"] as OnboardingStage[], accent: "border-l-red-500", headerBg: "bg-red-500/5", iconColor: "text-red-500" },
  { key: "live", bucket: "licensed" as PipelineBucket, label: "Live", icon: Briefcase, stages: ["live", "evaluated"] as OnboardingStage[], accent: "border-l-emerald-500", headerBg: "bg-emerald-500/5", iconColor: "text-emerald-500" },
  { key: "needs_followup", bucket: "licensed" as PipelineBucket, label: "Needs Follow-Up", icon: AlertTriangle, stages: ["need_followup"] as OnboardingStage[], accent: "border-l-amber-500", headerBg: "bg-amber-500/5", iconColor: "text-amber-500" },
  { key: "hasnt_sold", bucket: "licensed" as PipelineBucket, label: "Hasn't Sold Yet", icon: AlertTriangle, stages: [] as OnboardingStage[], accent: "border-l-rose-500", headerBg: "bg-rose-500/5", iconColor: "text-rose-500" },
  { key: "missing", bucket: "licensed" as PipelineBucket, label: "Missing / Silent", icon: Clock, stages: [] as OnboardingStage[], accent: "border-l-slate-500", headerBg: "bg-slate-500/5", iconColor: "text-slate-500" },
  { key: "inactive", bucket: "licensed" as PipelineBucket, label: "Inactive", icon: UserX, stages: ["inactive"] as OnboardingStage[], accent: "border-l-gray-500", headerBg: "bg-gray-500/5", iconColor: "text-gray-500" },
  { key: "deactivated", bucket: "licensed" as PipelineBucket, label: "Deactivated", icon: UserX, stages: [] as OnboardingStage[], accent: "border-l-zinc-500", headerBg: "bg-zinc-500/5", iconColor: "text-zinc-500" },
];

/** Compute the deterministic Next Best Action for an agent row. Producer-risk lane per MP-261 spec. */
function computeAgentNBA(agent: {
  onboardingStage: string;
  agentLicenseStatus: string;
  monthlyALP: number;
  weeklyALP: number;
  prevWeekALP: number;
  lifetimeDeals: number;
  lastContactedAt: string | null;
  lastActivityAt: string | null;
  daysSinceHire: number | null;
  hasReadymodeCreds: boolean;
  isDeactivated: boolean;
  isInactive: boolean;
}) {
  const daysSinceContact = agent.lastContactedAt
    ? (Date.now() - new Date(agent.lastContactedAt).getTime()) / (1000 * 60 * 60 * 24)
    : null;
  const input: NBAInput = {
    kind: "producer_risk",
    dropped_3_weeks: agent.weeklyALP === 0 && agent.prevWeekALP > 0,
    never_activated_60_days:
      agent.lifetimeDeals === 0 &&
      agent.agentLicenseStatus === "licensed" &&
      (agent.daysSinceHire ?? 0) >= 60,
    no_alp_30_days: agent.monthlyALP === 0 && agent.agentLicenseStatus === "licensed",
    down_this_week: agent.prevWeekALP > 0 && agent.weeklyALP < agent.prevWeekALP,
    no_agentlink: !agent.hasReadymodeCreds && agent.agentLicenseStatus === "licensed",
    no_recent_contact: daysSinceContact !== null && daysSinceContact >= 7,
    suppressed: agent.isDeactivated || agent.isInactive,
  };
  return getNextBestAction(input);
}

function ContactActions({ agent, onViewApp, onEditLogin, onDeactivate, onAgentUpdate }: {
  agent: AgentCRM; onViewApp: (id: string) => void;
  onEditLogin: (a: AgentCRM) => void; onDeactivate: (a: AgentCRM) => void;
  onAgentUpdate: (id: string, updates: Partial<AgentCRM>) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {agent.phone && (
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" asChild>
          <a href={`tel:${agent.phone}`}><Phone className="h-3 w-3" /> Call</a>
        </Button>
      )}
      {agent.email && (
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" asChild>
          <a href={`mailto:${agent.email}`}><Mail className="h-3 w-3" /> Email</a>
        </Button>
      )}
      {agent.instagramHandle && (
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" asChild>
          <a href={`https://instagram.com/${agent.instagramHandle.replace('@', '')}`} target="_blank" rel="noopener noreferrer">
            <Instagram className="h-3 w-3" /> IG
          </a>
        </Button>
      )}
      <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => onViewApp(agent.id)}>
        <FileText className="h-3 w-3" /> App
      </Button>
      {agent.userId && (
        <>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1"
            onClick={async () => {
              try {
                const { data, error } = await supabase.functions.invoke("send-agent-portal-login", { body: { agentId: agent.id } });
                if (error) throw error;
                if (data?.success === false) throw new Error(data.error || "Failed");
                toast.success(`Portal login sent to ${agent.email}`);
              } catch (err: any) { toast.error(err.message || "Failed to send"); }
            }}>
            <Send className="h-3 w-3" /> Portal
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1"
            onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/login`); toast.success("Login link copied!"); }}>
            <Copy className="h-3 w-3" /> Link
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1 border-amber-500/30 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
            onClick={() => onEditLogin(agent)}>
            <KeyRound className="h-3 w-3" /> Login
          </Button>
        </>
      )}
      <div className="flex-1" />
      <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
        onClick={async () => {
          try {
            await supabase.from("agents").update({ is_inactive: true }).eq("id", agent.id);
            onAgentUpdate(agent.id, { isInactive: true });
            toast.success(`${agent.name} hidden`);
          } catch { toast.error("Failed"); }
        }}>
        <EyeOff className="h-3 w-3" /> Hide
      </Button>
      <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-destructive hover:bg-destructive/10"
        onClick={() => onDeactivate(agent)}>
        <X className="h-3 w-3" /> Remove
      </Button>
    </div>
  );
}

function CompactExpandedRow({ agent, onRefresh, onDeactivate, onViewApp, onEditLogin, onAgentUpdate }: {
  agent: AgentCRM;
  onRefresh: () => void;
  onDeactivate: (agent: AgentCRM) => void;
  onViewApp: (id: string) => void;
  onEditLogin: (agent: AgentCRM) => void;
  onAgentUpdate: (id: string, updates: Partial<AgentCRM>) => void;
}) {
  return (
    <div className="border-t border-border bg-card/80 px-4 py-3">
      <ContactActions agent={agent} onViewApp={onViewApp} onEditLogin={onEditLogin} onDeactivate={onDeactivate} onAgentUpdate={onAgentUpdate} />
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={cn("text-xs", agent.agentLicenseStatus === "licensed" ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" : "bg-muted text-muted-foreground")}>
              {agent.agentLicenseStatus === "licensed" ? "Licensed" : "Unlicensed"}
            </Badge>
            {agent.agentLicenseStatus !== "licensed" && (
              <LicenseProgressSelector
                applicationId={agent.applicationId || agent.id}
                agentId={agent.userId ? agent.id : undefined}
                currentProgress={(agent.licenseProgress || "unlicensed") as any}
                testScheduledDate={agent.testScheduledDate}
                onProgressUpdated={onRefresh}
                className="h-6 text-xs"
              />
            )}
            {agent.agentLicenseStatus !== "licensed" && (
              <ResendLicensingButton recipientEmail={agent.email} recipientName={agent.name} licenseStatus="unlicensed" />
            )}
          </div>
          {agent.userId && <AgentTrainingStageBar agentId={agent.id} />}
          <details className="group">
            <summary className="flex cursor-pointer select-none items-center gap-1.5 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground">
              <KeyRound className="h-3 w-3 text-amber-500" />
              Access &amp; Credentials
              <ChevronRight className="h-3 w-3 transition-base group-open:rotate-90" />
            </summary>
            <AgentCredentialsPanel agentId={agent.id} agentName={agent.name} agentEmail={agent.email} />
          </details>
        </div>
        <div>
          <AgentNotes agentId={agent.id} onNoteAdded={() => {}} />
        </div>
      </div>
    </div>
  );
}
function InlineNotesButton({ agent }: { agent: AgentCRM }) {
  return (
    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" title={`Open notes for ${agent.name}`}>
      <StickyNote className="h-3.5 w-3.5 text-muted-foreground hover:text-primary" />
    </Button>
  );
}

export default function DashboardCRM() {
  const { user, isAdmin, isManager, isLoading: authLoading } = useAuth();
  const askConfirm = useConfirm();
  const { playSound } = useSoundEffects();
  const queryClient = useQueryClient();
  const [agents, setAgents] = useState<AgentCRM[]>([]);
  const [managers, setManagers] = useState<Manager[]>([]);
  // Persisted filter state — survives page reload via localStorage
  const [persistedFilters] = useState<PersistedCrmFilters>(() => loadPersistedFilters());
  const [searchTerm, setSearchTerm] = useState(persistedFilters.searchTerm);
  const [managerFilter, setManagerFilter] = useState<string>(persistedFilters.managerFilter);
  const [licenseFilter, setLicenseFilter] = useState<string>(persistedFilters.licenseFilter);
  const [aiScoreFilter, setAiScoreFilter] = useState<string>(persistedFilters.aiScoreFilter);
  const [showDeactivated, setShowDeactivated] = useState(persistedFilters.showDeactivated);
  const [showInactive, setShowInactive] = useState(persistedFilters.showInactive);
  const [deactivateAgent, setDeactivateAgent] = useState<AgentCRM | null>(null);
  const [sendingBulkLogins, setSendingBulkLogins] = useState(false);
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set());
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeChannel, setComposeChannel] = useState<"sms" | "email">("email");
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [viewAppTarget, setViewAppTarget] = useState<{ agentId?: string; applicationId?: string } | null>(null);
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null);
  const [editLoginAgent, setEditLoginAgent] = useState<AgentCRM | null>(null);
  const [activeStageTab, setActiveStageTab] = useState<string>("meeting_attendance");
  const [sortMode, setSortMode] = useState<string>("default");
  const [currentAgentId, setCurrentAgentId] = useState<string | null>(null);
  const [meetingAttendance, setMeetingAttendance] = useState<Map<string, "present" | "absent" | "unmarked">>(new Map());
  const [searchParams] = useSearchParams();

  const focusAgentId = searchParams.get('focusAgentId');
  useEffect(() => {
    if (focusAgentId && agents.length > 0) {
      setExpandedAgentId(focusAgentId);
      setTimeout(() => {
        const el = document.getElementById(`agent-row-${focusAgentId}`);
        if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); playSound("whoosh"); }
      }, 500);
    }
  }, [focusAgentId, agents.length]);

  // Persist filter state to localStorage on every change
  useEffect(() => {
    try {
      localStorage.setItem(
        CRM_FILTERS_STORAGE_KEY,
        JSON.stringify({
          searchTerm,
          managerFilter,
          licenseFilter,
          aiScoreFilter,
          showDeactivated,
          showInactive,
        } satisfies PersistedCrmFilters),
      );
    } catch { // empty-catch-allow:localstorage-incognito
      /* ignore quota / disabled storage */
    }
  }, [searchTerm, managerFilter, licenseFilter, aiScoreFilter, showDeactivated, showInactive]);

  // Count active (non-default) filters for the "Clear filters" affordance
  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (searchTerm.trim() !== "") n++;
    if (managerFilter !== "all") n++;
    if (licenseFilter !== "all") n++;
    if (aiScoreFilter !== "all") n++;
    if (showDeactivated) n++;
    if (showInactive) n++;
    return n;
  }, [searchTerm, managerFilter, licenseFilter, aiScoreFilter, showDeactivated, showInactive]);

  const clearAllFilters = useCallback(() => {
    setSearchTerm("");
    setManagerFilter("all");
    setLicenseFilter("all");
    setAiScoreFilter("all");
    setShowDeactivated(false);
    setShowInactive(false);
    playSound("click");
  }, [playSound]);

  const fetchAgentsQuery = useCallback(async () => {
    try {
      const { data: managerRoles } = await supabase.from("user_roles").select("user_id").eq("role", "manager");
      if (!managerRoles?.length) return;
      const managerUserIds = managerRoles.map(r => r.user_id);
      const { data: managerAgents } = await supabase.from("agents").select("id, user_id").in("user_id", managerUserIds).eq("status", "active");
      if (!managerAgents?.length) return;
      const { data: profiles } = await supabase.from("profiles").select("user_id, full_name").in("user_id", managerUserIds);
      const profileMap = new Map(profiles?.map(p => [p.user_id, p.full_name]) || []);
      setManagers(managerAgents.map(a => ({ id: a.id, name: profileMap.get(a.user_id) || "—" })));
    } catch (error) { console.error("Error fetching managers:", error); }
    try {
      const { data: currentAgent } = await supabase.from("agents").select("id").eq("user_id", user!.id).maybeSingle();
      if (!currentAgent && !isAdmin) { return []; }
      if (currentAgent) setCurrentAgentId(currentAgent.id);

      let query = supabase.from("agents").select("*").eq("status", "active").order("sort_order", { ascending: true, nullsFirst: false });
      if (isManager && !isAdmin) query = query.eq("invited_by_manager_id", currentAgent?.id);

      const { data: agentData, error } = await query;
      if (error) throw error;
      if (!agentData?.length) { return []; }

      const userIds = agentData.map(a => a.user_id).filter(Boolean);
      const managerIds = [...new Set(agentData.map(a => a.invited_by_manager_id).filter(Boolean))];
      const liveAgentIds = agentData.filter(a => a.onboarding_stage === "evaluated").map(a => a.id);
      const allAgentIds = agentData.map(a => a.id);

      const weekBounds = getBusinessWeekBounds();
      const monthBounds = getBusinessMonthBounds();
      const priorWeekBounds = getMatchedPriorWeekBounds();
      const weekStartStr = getBusinessDayKey(weekBounds.start);

      const weekEndStr = getBusinessDayKey();

      const [profilesResult, managerAgentsResult, monthlyDealsResult, weeklyDealsResult, prevWeekDealsResult, weeklyProductionResult, appContactsResult, appLicenseResult, paymentsResult] = await Promise.all([
        supabase.from("profiles").select("user_id, full_name, email, phone, avatar_url, instagram_handle").in("user_id", userIds),
        managerIds.length > 0 ? supabase.from("agents").select("id, user_id").in("id", managerIds) : Promise.resolve({ data: [] as any[] }),
        allAgentIds.length > 0
          ? supabase
              .from("deals")
              .select("agent_id, annual_premium")
              .in("agent_id", allAgentIds)
              .gte("posted_at", monthBounds.startIso)
              .lt("posted_at", monthBounds.endIso)
              .in("status", DEAL_TRUTH_STATUS_FILTER)
          : Promise.resolve({ data: [] as any[] }),
        allAgentIds.length > 0
          ? supabase
              .from("deals")
              .select("agent_id, annual_premium")
              .in("agent_id", allAgentIds)
              .gte("posted_at", weekBounds.startIso)
              .lt("posted_at", weekBounds.endIso)
              .in("status", DEAL_TRUTH_STATUS_FILTER)
          : Promise.resolve({ data: [] as any[] }),
        allAgentIds.length > 0
          ? supabase
              .from("deals")
              .select("agent_id, annual_premium")
              .in("agent_id", allAgentIds)
              .gte("posted_at", priorWeekBounds.startIso)
              .lt("posted_at", priorWeekBounds.endIso)
              .in("status", DEAL_TRUTH_STATUS_FILTER)
          : Promise.resolve({ data: [] as any[] }),
        allAgentIds.length > 0
          ? supabase
              .from("daily_production")
              .select("agent_id, presentations, production_date")
              .in("agent_id", allAgentIds)
              .gte("production_date", weekStartStr)
              .lte("production_date", weekEndStr)
          : Promise.resolve({ data: [] as any[] }),
        supabase.from("applications").select("assigned_agent_id, last_contacted_at").in("assigned_agent_id", allAgentIds).not("last_contacted_at", "is", null).order("last_contacted_at", { ascending: false }),
        supabase.from("applications").select("id, email, license_progress, test_scheduled_date, ai_score_tier").is("terminated_at", null),
        supabase.from("lead_payment_tracking").select("agent_id, tier, paid").eq("week_start", weekStartStr).eq("paid", true),
      ]);

      const profileMapData = new Map(profilesResult.data?.map(p => [p.user_id, p]) || []);

      const managerProfileMap = new Map<string, string>();
      const managerAgentsData = managerAgentsResult.data;
      if (managerAgentsData?.length) {
        const mUserIds = managerAgentsData.map((a: any) => a.user_id).filter(Boolean);
        const { data: mProfiles } = await supabase.from("profiles").select("user_id, full_name").in("user_id", mUserIds);
        const userToName = new Map(mProfiles?.map(p => [p.user_id, p.full_name]) || []);
        managerAgentsData.forEach((ma: any) => { if (ma.user_id) managerProfileMap.set(ma.id, userToName.get(ma.user_id) || "—"); });
      }

      const weeklyProductionMap = new Map<string, { alp: number; presentations: number; deals: number }>();
      const monthlyProductionMap = new Map<string, number>();
      const monthlyDealsMap = new Map<string, number>();
      for (const deal of monthlyDealsResult.data || []) {
        monthlyProductionMap.set(
          deal.agent_id,
          (monthlyProductionMap.get(deal.agent_id) || 0) + (Number(deal.annual_premium) || 0),
        );
        monthlyDealsMap.set(deal.agent_id, (monthlyDealsMap.get(deal.agent_id) || 0) + 1);
      }
      for (const deal of weeklyDealsResult.data || []) {
        const current = weeklyProductionMap.get(deal.agent_id) || { alp: 0, presentations: 0, deals: 0 };
        weeklyProductionMap.set(deal.agent_id, {
          alp: current.alp + (Number(deal.annual_premium) || 0),
          presentations: current.presentations,
          deals: current.deals + 1,
        });
      }
      for (const production of weeklyProductionResult.data || []) {
        const current = weeklyProductionMap.get(production.agent_id) || { alp: 0, presentations: 0, deals: 0 };
        weeklyProductionMap.set(production.agent_id, {
          alp: current.alp,
          presentations: current.presentations + (production.presentations || 0),
          deals: current.deals,
        });
      }

      // Previous week ALP
      const prevWeekALPMap = new Map<string, number>();
      for (const deal of prevWeekDealsResult.data || []) {
        prevWeekALPMap.set(
          deal.agent_id,
          (prevWeekALPMap.get(deal.agent_id) || 0) + (Number(deal.annual_premium) || 0),
        );
      }

      const lastContactMap = new Map<string, string>();
      for (const app of appContactsResult.data || []) {
        if (app.assigned_agent_id && app.last_contacted_at && !lastContactMap.has(app.assigned_agent_id)) lastContactMap.set(app.assigned_agent_id, app.last_contacted_at);
      }

      const progressOrder = ["unlicensed","course_purchased","finished_course","test_scheduled","passed_test","fingerprints_done","waiting_on_license","licensed"];
      const emailLicenseMap = new Map<string, { progress: string | null; testDate: string | null; appId: string; aiScore: string | null }>();
      for (const app of appLicenseResult.data || []) {
        const appEmail = app.email?.toLowerCase().trim();
        if (!appEmail) continue;
        const current = emailLicenseMap.get(appEmail);
        const newIdx = progressOrder.indexOf(app.license_progress || "unlicensed");
        const curIdx = current ? progressOrder.indexOf(current.progress || "unlicensed") : -1;
        if (newIdx > curIdx) emailLicenseMap.set(appEmail, { progress: app.license_progress, testDate: app.test_scheduled_date, appId: app.id, aiScore: app.ai_score_tier || null });
      }

      const paymentMap = new Map<string, { standard: boolean; premium: boolean }>();
      paymentsResult.data?.forEach((p: any) => {
        const e = paymentMap.get(p.agent_id) || { standard: false, premium: false };
        if (p.tier === "standard") e.standard = true;
        if (p.tier === "premium") e.premium = true;
        paymentMap.set(p.agent_id, e);
      });

      // Fetch last production date per agent for 35-day dormancy check
      const { data: lastProdData } = await supabase
        .from("daily_production")
        .select("agent_id, production_date")
        .in("agent_id", allAgentIds)
        .order("production_date", { ascending: false });
      const lastProdMap = new Map<string, string>();
      for (const p of lastProdData || []) {
        if (!lastProdMap.has(p.agent_id)) lastProdMap.set(p.agent_id, p.production_date);
      }

      // 2026-06-15 — lifetime production + ReadyMode credential coverage so the
      // new "Hasn't sold" / "Missing" tabs + hero KPIs render truthful counts.
      const [lifetimeRes, credsRes] = await Promise.all([
        allAgentIds.length > 0
          ? supabase
              .from("agent_lifetime_production")
              .select("agent_id, lifetime_alp, lifetime_deals, last_production_date")
              .in("agent_id", allAgentIds)
          : Promise.resolve({ data: [] as any[] }),
        // RLS hard-blocks non-admin reads — this returns 0 rows for managers
        // (and renders the hasReadymodeCreds flag as false, which is honest).
        allAgentIds.length > 0
          ? supabase
              .from("agent_credentials")
              .select("agent_id, service")
              .in("agent_id", allAgentIds)
              .eq("service", "readymode")
              .not("password_encrypted", "is", null)
          : Promise.resolve({ data: [] as any[] }),
      ]);
      const lifetimeMap = new Map<string, { deals: number; alp: number; lastProd: string | null }>();
      for (const row of (lifetimeRes.data as any[]) || []) {
        lifetimeMap.set(row.agent_id, {
          deals: Number(row.lifetime_deals) || 0,
          alp: Number(row.lifetime_alp) || 0,
          lastProd: row.last_production_date || null,
        });
      }
      const readymodeCredSet = new Set<string>(
        ((credsRes.data as any[]) || []).map((r) => r.agent_id),
      );

      const DORMANT_DAYS = 35;
      const now = Date.now();

      const crmAgents: AgentCRM[] = agentData.map((agent, index) => {
        const profile = profileMapData.get(agent.user_id);
        const ws = weeklyProductionMap.get(agent.id) || { alp: 0, presentations: 0, deals: 0 };
        const pay = paymentMap.get(agent.id) || { standard: false, premium: false };
        const emailKey = profile?.email?.toLowerCase().trim() || "";
        const licenseEntry = emailLicenseMap.get(emailKey);

        // Auto-detect 35-day dormancy → move to inactive
        let effectiveStage: OnboardingStage = agent.onboarding_stage || "onboarding";
        if (!agent.is_deactivated && effectiveStage !== "inactive") {
          const lastProd = lastProdMap.get(agent.id);
          const lastContact = lastContactMap.get(agent.id);
          const lastActivity = [lastProd, lastContact, agent.updated_at].filter(Boolean).map(d => new Date(d!).getTime());
          const mostRecent = lastActivity.length > 0 ? Math.max(...lastActivity) : new Date(agent.created_at).getTime();
          const daysSince = (now - mostRecent) / (1000 * 60 * 60 * 24);
          if (daysSince >= DORMANT_DAYS) {
            effectiveStage = "inactive" as OnboardingStage;
          }
        }

        return {
          id: agent.id, userId: agent.user_id || "", name: profile?.full_name || agent.display_name || "—",
          applicationId: licenseEntry?.appId || undefined,
          email: profile?.email || "", phone: profile?.phone || undefined, avatarUrl: profile?.avatar_url || undefined,
          instagramHandle: profile?.instagram_handle || undefined, onboardingStage: effectiveStage,
          attendanceStatus: agent.attendance_status || "good", performanceTier: agent.performance_tier || "below_10k",
          fieldTrainingStartedAt: agent.field_training_started_at || undefined, startDate: agent.start_date || undefined,
          onboardingCompletedAt: agent.onboarding_completed_at || undefined,
          totalEarnings: Number(agent.total_earnings) || 0, hasTrainingCourse: agent.has_training_course || false,
          hasDialerLogin: agent.has_dialer_login || false, hasDiscordAccess: agent.has_discord_access || false,
          potentialRating: agent.potential_rating || 0, evaluationResult: agent.evaluation_result,
          isDeactivated: agent.is_deactivated || false, isInactive: (agent as any).is_inactive || false,
          managerId: agent.invited_by_manager_id || undefined, managerName: agent.invited_by_manager_id ? managerProfileMap.get(agent.invited_by_manager_id) : undefined,
          weekly10kBadges: agent.weekly_10k_badges || 0, sortOrder: agent.sort_order ?? index,
          weeklyALP: ws.alp, weeklyPresentations: ws.presentations, weeklyDeals: ws.deals,
          weeklyClosingRate: Math.round(getCloseRate(ws.deals, ws.presentations)),
          monthlyALP: monthlyProductionMap.get(agent.id) || 0, monthlyDeals: monthlyDealsMap.get(agent.id) || 0,
          prevWeekALP: prevWeekALPMap.get(agent.id) || 0,
          lastContactedAt: lastContactMap.get(agent.id) || null, standardPaid: pay.standard, premiumPaid: pay.premium,
          licenseProgress: licenseEntry?.progress || null, testScheduledDate: licenseEntry?.testDate || null,
          agentLicenseStatus: agent.license_status || "unlicensed",
          aiScoreTier: licenseEntry?.aiScore || null,
          lifetimeDeals: lifetimeMap.get(agent.id)?.deals ?? 0,
          lifetimeALP: lifetimeMap.get(agent.id)?.alp ?? 0,
          lastActivityAt: (() => {
            const candidates = [
              lifetimeMap.get(agent.id)?.lastProd ?? null,
              lastProdMap.get(agent.id) ?? null,
              lastContactMap.get(agent.id) ?? null,
              agent.updated_at ?? null,
            ].filter(Boolean) as string[];
            if (candidates.length === 0) return null;
            const newest = candidates
              .map((d) => new Date(d).getTime())
              .filter((t) => !Number.isNaN(t))
              .sort((a, b) => b - a)[0];
            return newest ? new Date(newest).toISOString() : null;
          })(),
          daysSinceHire: agent.start_date
            ? Math.max(0, Math.floor((now - new Date(agent.start_date).getTime()) / (1000 * 60 * 60 * 24)))
            : (agent.created_at
                ? Math.max(0, Math.floor((now - new Date(agent.created_at).getTime()) / (1000 * 60 * 60 * 24)))
                : null),
          hasReadymodeCreds: readymodeCredSet.has(agent.id),
          createdAt: agent.created_at || null,
        };
      });

      // Applications visible in CRM: every application the viewer can see.
      // - Admin: all
      // - Manager (not admin): team (assigned to them) + their own
      // - Everyone else: their own application (plus team if they were ever
      //   made a hiring manager for someone else)
      // Widened status filter so "new" and "reviewing" apps also show up —
      // agents were complaining their own application wasn't visible at all.
      let appQuery = supabase.from("applications")
        .select("id, first_name, last_name, email, phone, license_status, license_progress, test_scheduled_date, status, instagram_handle, started_training, ai_score_tier, user_id, assigned_agent_id, referral_manager_id, recruiter_id, hiring_manager_user_id, created_at")
        .is("terminated_at", null).neq("license_status", "licensed");
      if (!isAdmin) {
        // Visibility OR — applicant is the user themselves, OR I am the
        // assigned agent, referral manager, recruiter (any of the three agent
        // attribution columns), OR I am the hiring manager (auth.uid). This
        // previously only checked user_id + assigned_agent_id, so leads
        // credited to KJ via referral_manager_id or recruiter_id were
        // invisible on the CRM even though they showed up on other pages.
        const clauses: string[] = [];
        if (user?.id) {
          clauses.push(`user_id.eq.${user.id}`);
          clauses.push(`hiring_manager_user_id.eq.${user.id}`);
        }
        if (currentAgent?.id) {
          clauses.push(`assigned_agent_id.eq.${currentAgent.id}`);
          clauses.push(`referral_manager_id.eq.${currentAgent.id}`);
          clauses.push(`recruiter_id.eq.${currentAgent.id}`);
        }
        if (clauses.length > 0) appQuery = appQuery.or(clauses.join(","));
      }

      const { data: unlicensedApplicants } = await appQuery;

      const existingEmails = new Set(crmAgents.map(a => a.email?.toLowerCase()).filter(Boolean));
      const newApplicants: AgentCRM[] = (unlicensedApplicants || [])
        .filter((app: any) => !existingEmails.has(app.email?.toLowerCase()))
        .map((app: any, index: number) => ({
          id: app.id, userId: "", name: `${app.first_name} ${app.last_name}`.trim(), applicationId: app.id, email: app.email || "",
          phone: app.phone || undefined, avatarUrl: undefined, instagramHandle: app.instagram_handle || undefined,
          onboardingStage: "onboarding" as OnboardingStage, attendanceStatus: "good" as AttendanceStatus,
          performanceTier: "below_10k" as PerformanceTier, fieldTrainingStartedAt: undefined, startDate: undefined,
          totalEarnings: 0, hasTrainingCourse: app.started_training || false, hasDialerLogin: false, hasDiscordAccess: false,
          potentialRating: 0, evaluationResult: null, isDeactivated: false, isInactive: false, managerId: undefined,
          managerName: undefined, weekly10kBadges: 0, sortOrder: crmAgents.length + index,
          weeklyALP: 0, weeklyPresentations: 0, weeklyDeals: 0, weeklyClosingRate: 0,
          monthlyALP: 0, monthlyDeals: 0, prevWeekALP: 0,
          lastContactedAt: null, standardPaid: false, premiumPaid: false,
          licenseProgress: app.license_progress || null, testScheduledDate: app.test_scheduled_date || null,
          agentLicenseStatus: app.license_status || "unlicensed",
          aiScoreTier: app.ai_score_tier || null,
          lifetimeDeals: 0,
          lifetimeALP: 0,
          lastActivityAt: app.created_at || null,
          daysSinceHire: app.created_at
            ? Math.max(0, Math.floor((Date.now() - new Date(app.created_at).getTime()) / (1000 * 60 * 60 * 24)))
            : null,
          hasReadymodeCreds: false,
          createdAt: app.created_at || null,
        }));

      return [...crmAgents, ...newApplicants];
    } catch (error) { console.error("Error fetching CRM agents:", error); toast.error("Failed to load agents"); return []; }
  }, [user?.id, isAdmin, isManager]);

  const { data: agentsData, isLoading: agentsLoading } = useQuery({
    queryKey: ["crm-agents", user?.id, isAdmin, isManager],
    queryFn: fetchAgentsQuery,
    enabled: !authLoading && !!user,
    staleTime: 60000,
  });

  useEffect(() => { if (agentsData) setAgents(agentsData); }, [agentsData]);

  // Fetch today's meeting attendance
  const todayStr = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

  useEffect(() => {
    if (!agents.length) return;
    const fetchAttendance = async () => {
      const agentIds = agents.map(a => a.id);
      const { data } = await supabase.from("agent_attendance")
        .select("agent_id, status")
        .in("agent_id", agentIds)
        .eq("attendance_date", todayStr)
        .eq("attendance_type", "agency_meeting" as any);
      const map = new Map<string, "present" | "absent" | "unmarked">();
      data?.forEach(r => map.set(r.agent_id, r.status as any));
      setMeetingAttendance(map);
    };
    fetchAttendance();
  }, [agents, todayStr]);

  const toggleMeetingAttendance = async (agentId: string) => {
    const current = meetingAttendance.get(agentId) || "unmarked";
    const next = current === "present" ? "absent" : "present";
    setMeetingAttendance(prev => { const m = new Map(prev); m.set(agentId, next); return m; });
    try {
      await supabase.from("agent_attendance").upsert({
        agent_id: agentId,
        attendance_date: todayStr,
        attendance_type: "agency_meeting" as any,
        status: next as any,
        marked_by: user?.id,
      }, { onConflict: "agent_id,attendance_date,attendance_type" as any });
    } catch { toast.error("Failed to save attendance"); }
  };

  const loading = agentsLoading;
  const fetchAgents = useCallback(() => { queryClient.invalidateQueries({ queryKey: ["crm-agents"] }); }, [queryClient]);

  // Phase 5: Live updates — invalidate when agents/applications change anywhere
  useRealtimeTable({ table: "agents", channelSuffix: "crm" }, () => {
    queryClient.invalidateQueries({ queryKey: ["crm-agents"] });
  });
  useRealtimeTable({ table: "applications", channelSuffix: "crm" }, () => {
    queryClient.invalidateQueries({ queryKey: ["crm-agents"] });
  });

  const handleBulkSendPortalLogins = async () => {
    const ok = await askConfirm({
      title: "Send portal login emails to all active agents?",
      description: "Each active agent gets the standard portal login email so they can sign in.",
      confirmText: "Send emails",
    });
    if (!ok) return;
    setSendingBulkLogins(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-bulk-portal-logins");
      if (error) throw error;
      toast.success(`Sent ${data?.results?.sent || 0} portal login emails!`);
    } catch { toast.error("Failed to send"); }
    finally { setSendingBulkLogins(false); }
  };

  const onAgentUpdate = (id: string, updates: Partial<AgentCRM>) => {
    setAgents(prev => prev.map(a => a.id === id ? { ...a, ...updates } : a));
  };

  /**
   * Bulk delete (flag-gated). Marks selected agents as deactivated rather than
   * hard-deleting rows — preserves referential integrity for production data,
   * applications, etc. Hidden behind VITE_ENABLE_CRM_BULK_DELETE.
   */
  const handleBulkDelete = async () => {
    if (!ENABLE_BULK_DELETE) return;
    if (selectedAgents.size === 0) return;
    const count = selectedAgents.size;
    const okDeact = await askConfirm({
      title: `Deactivate ${count} selected agent${count === 1 ? "" : "s"}?`,
      description: 'Rows stay in the database — reversible by toggling "Deactivated" back off.',
      confirmText: `Deactivate ${count}`,
      tone: "danger",
    });
    if (!okDeact) return;
    setBulkDeleting(true);
    try {
      const ids = Array.from(selectedAgents);
      const { error } = await supabase
        .from("agents")
        .update({ is_deactivated: true })
        .in("id", ids);
      if (error) throw error;
      toast.success(`Deactivated ${count} agent${count === 1 ? "" : "s"}`);
      setSelectedAgents(new Set());
      fetchAgents();
    } catch (err) {
      console.error("Bulk delete failed:", err);
      toast.error("Failed to deactivate selected agents");
    } finally {
      setBulkDeleting(false);
    }
  };

  const activeAgentsRaw = useMemo(() => agents.filter(a => {
    // "Deactivated" chip owns its own section — surface those agents regardless
    // of the top-level toggle when that chip is selected.
    if (activeStageTab === "deactivated") return true;
    if (!showDeactivated && a.isDeactivated) return false;
    if (!showInactive && a.isInactive) return false;
    return true;
  }), [agents, showDeactivated, showInactive, activeStageTab]);

  // Dedupe by lowercased email so tab counts + row lists stop double-counting
  // ghost duplicates (e.g. two "Samuel James" rows). Retain the canonical row —
  // prefer one with a real userId, then most-recent lastActivityAt, then lowest
  // sortOrder. The Dupe badge below still surfaces because duplicateAgentIds is
  // computed off activeAgentsRaw, not the deduped list.
  const activeAgents = useMemo(() => {
    const canonicalByEmail = new Map<string, AgentCRM>();
    const noEmail: AgentCRM[] = [];
    for (const a of activeAgentsRaw) {
      const key = a.email?.toLowerCase().trim();
      if (!key) { noEmail.push(a); continue; }
      const prev = canonicalByEmail.get(key);
      if (!prev) { canonicalByEmail.set(key, a); continue; }
      const prevHasUser = !!prev.userId;
      const nextHasUser = !!a.userId;
      if (nextHasUser !== prevHasUser) { if (nextHasUser) canonicalByEmail.set(key, a); continue; }
      const prevTs = prev.lastActivityAt ? new Date(prev.lastActivityAt).getTime() : 0;
      const nextTs = a.lastActivityAt ? new Date(a.lastActivityAt).getTime() : 0;
      if (nextTs !== prevTs) { if (nextTs > prevTs) canonicalByEmail.set(key, a); continue; }
      if (a.sortOrder < prev.sortOrder) canonicalByEmail.set(key, a);
    }
    return [...canonicalByEmail.values(), ...noEmail];
  }, [activeAgentsRaw]);

  const filteredAgents = useMemo(() => activeAgents.filter(a => {
    const matchesSearch = !searchTerm || a.name.toLowerCase().includes(searchTerm.toLowerCase()) || a.email.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesManager = managerFilter === "all" || a.managerId === managerFilter;
    const matchesLicense = licenseFilter === "all" || (licenseFilter === "licensed" ? a.agentLicenseStatus === "licensed" : a.agentLicenseStatus !== "licensed");
    const matchesAiScore = aiScoreFilter === "all" || a.aiScoreTier === aiScoreFilter;
    return matchesSearch && matchesManager && matchesLicense && matchesAiScore;
  }), [activeAgents, searchTerm, managerFilter, licenseFilter, aiScoreFilter]);

  const agentsBySection = useMemo(() => {
    const liveStages = ["in_field_training", "evaluated", "live", "below_10k"];
    const map = new Map<string, AgentCRM[]>();
    map.set("meeting_attendance", [...filteredAgents].filter(a => a.agentLicenseStatus === "licensed").sort((a, b) => a.name.localeCompare(b.name)));
    map.set("needs_followup", filteredAgents.filter(a => {
      if (a.isDeactivated || a.onboardingStage === "inactive") return false;
      if (a.agentLicenseStatus !== "licensed") return false;
      const lowProducer = (a.monthlyALP ?? 0) < 10000;
      const daysSinceContact = a.lastContactedAt
        ? (Date.now() - new Date(a.lastContactedAt).getTime()) / (1000 * 60 * 60 * 24)
        : 999;
      return lowProducer || daysSinceContact >= 6;
    }).sort((a, b) => {
      if ((a.monthlyALP ?? 0) !== (b.monthlyALP ?? 0)) return (a.monthlyALP ?? 0) - (b.monthlyALP ?? 0);
      if (!a.lastContactedAt && !b.lastContactedAt) return a.sortOrder - b.sortOrder;
      if (!a.lastContactedAt) return -1;
      if (!b.lastContactedAt) return 1;
      return new Date(a.lastContactedAt).getTime() - new Date(b.lastContactedAt).getTime();
    }));
    map.set("inactive", filteredAgents.filter(a => a.onboardingStage === "inactive" || a.isInactive));
    map.set("pre_licensed", filteredAgents.filter(a => {
      if (a.agentLicenseStatus === "licensed") return false;
      return PRELICENSED_PROGRESS.has((a as any).licenseProgress || "unlicensed");
    }));
    map.set("live", filteredAgents.filter(a =>
      a.agentLicenseStatus === "licensed" && liveStages.includes(a.onboardingStage) && !a.isDeactivated && !a.isInactive
    ).sort((a, b) => b.monthlyALP - a.monthlyALP));
    map.set("below_10k", filteredAgents.filter(a =>
      a.agentLicenseStatus === "licensed" && liveStages.includes(a.onboardingStage) && !a.isDeactivated && !a.isInactive && (a.monthlyALP ?? 0) < 20000
    ).sort((a, b) => b.monthlyALP - a.monthlyALP));
    map.set("transfer", filteredAgents.filter(a =>
      a.onboardingStage === "transfer" ||
      (a.hasTrainingCourse && a.agentLicenseStatus === "licensed" && !liveStages.includes(a.onboardingStage))
    ));
    // 2026-06-15 — "Hasn't sold yet": licensed, active, zero lifetime deals.
    // Sorted by daysSinceHire DESC so the oldest unsold sit at the top —
    // they're the biggest red flag and the loudest coaching signal.
    map.set("hasnt_sold", filteredAgents.filter(a =>
      a.agentLicenseStatus === "licensed"
      && !a.isDeactivated
      && !a.isInactive
      && a.onboardingStage !== "inactive"
      && a.lifetimeDeals === 0
    ).sort((a, b) => (b.daysSinceHire ?? 0) - (a.daysSinceHire ?? 0)));
    // 2026-06-15 — "Missing / Silent": active agents whose freshest signal
    // (lifetime last_production_date / daily_production / last_contacted_at
    // / agents.updated_at) is older than 7 days. Sorted by silence duration
    // DESC so the longest-quiet agents are first.
    map.set("missing", filteredAgents.filter(a => {
      if (a.isDeactivated || a.isInactive) return false;
      if (a.onboardingStage === "inactive") return false;
      if (a.onboardingStage === "applied" || a.onboardingStage === "meeting_attendance") return false;
      const lastTs = a.lastActivityAt ? new Date(a.lastActivityAt).getTime() : null;
      if (lastTs === null) return false;
      const days = (Date.now() - lastTs) / (1000 * 60 * 60 * 24);
      return days >= 7;
    }).sort((a, b) => {
      const at = a.lastActivityAt ? new Date(a.lastActivityAt).getTime() : 0;
      const bt = b.lastActivityAt ? new Date(b.lastActivityAt).getTime() : 0;
      return at - bt; // oldest first
    }));
    map.set("deactivated", filteredAgents.filter(a => a.isDeactivated).sort((a, b) => a.name.localeCompare(b.name)));
    for (const sec of SECTIONS) {
      if (!map.has(sec.key)) {
        map.set(sec.key, filteredAgents.filter(a => sec.stages.includes(a.onboardingStage)).sort((a, b) => {
          if (!a.lastContactedAt && !b.lastContactedAt) return a.sortOrder - b.sortOrder;
          if (!a.lastContactedAt) return -1;
          if (!b.lastContactedAt) return 1;
          return new Date(a.lastContactedAt).getTime() - new Date(b.lastContactedAt).getTime();
        }));
      }
    }
    if (sortMode !== "default") {
      for (const [k, arr] of Array.from(map.entries())) {
        const sorted = [...arr];
        if (sortMode === "alp_desc") sorted.sort((a, b) => b.monthlyALP - a.monthlyALP);
        else if (sortMode === "newest") sorted.sort((a, b) => {
          const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return bt - at;
        });
        else if (sortMode === "stalest") sorted.sort((a, b) => {
          const at = a.lastActivityAt ? new Date(a.lastActivityAt).getTime() : Number.MAX_SAFE_INTEGER;
          const bt = b.lastActivityAt ? new Date(b.lastActivityAt).getTime() : Number.MAX_SAFE_INTEGER;
          return at - bt;
        });
        else if (sortMode === "needs_followup") sorted.sort((a, b) => {
          const at = a.lastContactedAt ? new Date(a.lastContactedAt).getTime() : 0;
          const bt = b.lastContactedAt ? new Date(b.lastContactedAt).getTime() : 0;
          return at - bt;
        });
        else if (sortMode === "by_stage") sorted.sort((a, b) => a.onboardingStage.localeCompare(b.onboardingStage));
        map.set(k, sorted);
      }
    }
    return map;
  }, [filteredAgents, sortMode]);

  const unlicensedAgents = useMemo(
    () => filteredAgents.filter(a => a.agentLicenseStatus !== "licensed"),
    [filteredAgents]
  );

  // Detect emails with >1 row in the raw list so the canonical (deduped) row
  // still surfaces a "Dupe" badge to Sam even after dedupe collapses the second.
  const duplicateAgentIds = useMemo(() => {
    const emailCount = new Map<string, number>();
    activeAgentsRaw.forEach(a => { if (a.email) { const k = a.email.toLowerCase().trim(); emailCount.set(k, (emailCount.get(k) || 0) + 1); } });
    const dupeIds = new Set<string>();
    activeAgents.forEach(a => { if (a.email && (emailCount.get(a.email.toLowerCase().trim()) || 0) > 1) dupeIds.add(a.id); });
    return dupeIds;
  }, [activeAgentsRaw, activeAgents]);

  // MP-261 — unified 11-col table shape. Chips filter rows; columns stay stable.
  // Agent / Mentor / Stage / License / Present / Homework / Week ALP / Month ALP /
  // Last Activity / Next Best Action / Actions.
  const getTableHeaders = (_sectionKey: string) => (
    <>
      <TableHead className="w-[220px]">Agent</TableHead>
      <TableHead className="w-[110px]">Mentor</TableHead>
      <TableHead className="w-[110px]">Stage</TableHead>
      <TableHead className="w-[100px]">License</TableHead>
      <TableHead className="w-[80px] text-center">Present</TableHead>
      <TableHead className="w-[80px] text-center">Homework</TableHead>
      <TableHead className="w-[100px] text-right">Week ALP</TableHead>
      <TableHead className="w-[100px] text-right">Month ALP</TableHead>
      <TableHead className="w-[110px]">Last Activity</TableHead>
      <TableHead className="w-[200px]">Next Best Action</TableHead>
      <TableHead className="w-[70px] text-right">Actions</TableHead>
    </>
  );

  const renderNBACell = (agent: AgentCRM) => {
    const nba = computeAgentNBA(agent);
    const badge = priorityBadgeClasses(nba.priority);
    return (
      <TableCell className="py-2">
        <div className="flex flex-col gap-1 min-w-0 max-w-[200px]">
          <Badge variant="outline" className={cn("text-[10px] w-fit", badge.className)}>
            {badge.text}
          </Badge>
          <span className="text-[11px] font-medium truncate" title={nba.reason}>{nba.action}</span>
        </div>
      </TableCell>
    );
  };

  // MP-261 unified 11-col row. Sam's brief: table shape stays constant across
  // every segment chip; only the row set changes. Columns after Agent:
  // Mentor / Stage / License / Present / Homework / Week ALP / Month ALP /
  // Last Activity / Next Best Action / Actions.
  const renderKebabActions = (agent: AgentCRM) => {
    // Applicant rows (no auth user; id === applicationId) can't be hidden or
    // deactivated as agents — those UPDATEs silently no-op / FK-fail.
    const isApplicantRow = !agent.userId;
    return (
    <TableCell className="py-2 text-right" onClick={(e) => e.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" aria-label={`Actions for ${agent.name}`}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel className="text-[11px]">{agent.name}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setViewAppTarget({ agentId: agent.id, applicationId: agent.applicationId })}>
            <FileText className="h-3.5 w-3.5 mr-2" /> View application
          </DropdownMenuItem>
          {agent.email && (
            <DropdownMenuItem asChild>
              <a href={`mailto:${agent.email}`}><Mail className="h-3.5 w-3.5 mr-2" /> Email</a>
            </DropdownMenuItem>
          )}
          {agent.phone && (
            <DropdownMenuItem asChild>
              <a href={`tel:${agent.phone}`}><Phone className="h-3.5 w-3.5 mr-2" /> Call</a>
            </DropdownMenuItem>
          )}
          {agent.instagramHandle && (
            <DropdownMenuItem asChild>
              <a href={`https://instagram.com/${agent.instagramHandle.replace('@', '')}`} target="_blank" rel="noopener noreferrer">
                <Instagram className="h-3.5 w-3.5 mr-2" /> Instagram
              </a>
            </DropdownMenuItem>
          )}
          {agent.userId && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={async () => {
                  try {
                    const { data, error } = await supabase.functions.invoke("send-agent-portal-login", { body: { agentId: agent.id } });
                    if (error) throw error;
                    if (data?.success === false) throw new Error(data.error || "Failed");
                    toast.success(`Portal login sent to ${agent.email}`);
                  } catch (err: any) { toast.error(err.message || "Failed to send"); }
                }}
              >
                <Send className="h-3.5 w-3.5 mr-2" /> Send portal login
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/login`); toast.success("Login link copied"); }}
              >
                <Copy className="h-3.5 w-3.5 mr-2" /> Copy login link
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setEditLoginAgent(agent)}>
                <KeyRound className="h-3.5 w-3.5 mr-2" /> Edit login
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={async () => {
              if (isApplicantRow) {
                toast.info(`${agent.name} is still an unhired applicant — remove from the Applicants queue instead.`);
                return;
              }
              try {
                const { error } = await supabase.from("agents").update({ is_inactive: true }).eq("id", agent.id);
                if (error) throw error;
                onAgentUpdate(agent.id, { isInactive: true });
                toast.success(`${agent.name} hidden`);
              } catch (err: any) { toast.error(err?.message || "Failed"); }
            }}
          >
            <EyeOff className="h-3.5 w-3.5 mr-2" /> Hide
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              if (isApplicantRow) {
                toast.info(`${agent.name} is still an unhired applicant — remove from the Applicants queue instead.`);
                return;
              }
              setDeactivateAgent(agent);
            }}
            className="text-destructive focus:text-destructive"
          >
            <X className="h-3.5 w-3.5 mr-2" /> Remove
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </TableCell>
    );
  };

  const getTableCells = (_sectionKey: string, agent: AgentCRM) => {
    const attendanceState = meetingAttendance.get(agent.id) || "unmarked";
    const attendancePresent = attendanceState === "present";
    const stageLabel = PROGRESS_LABELS[agent.licenseProgress || "unlicensed"]
      || agent.onboardingStage.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
    const isTrainee = agent.onboardingStage === "in_field_training";
    const isLicensed = agent.agentLicenseStatus === "licensed";
    // Applicant rows (still in applications table, no auth user) share id with
    // applicationId. Actions that write to agents/agent_attendance by agent.id
    // silently FK-fail — gate those actions and surface a helpful toast.
    const isApplicantRow = !agent.userId;
    // Derive color from the SAME timestamp the label reads so fresh activity
    // never renders red. Fall back to lastContactedAt only when both are absent.
    const activitySourceTs = agent.lastActivityAt || agent.lastContactedAt;
    const lastActivityLabel = activitySourceTs ? getTimeAgo(activitySourceTs) : "—";
    let activityColor = "text-muted-foreground";
    if (activitySourceTs) {
      // Math.max(0, …) so a stray future timestamp from a bad AgentLink sync
      // can't render as red-stale — relative-time-guard invariant.
      const days = Math.max(0, Date.now() - new Date(activitySourceTs).getTime()) / (1000 * 60 * 60 * 24);
      if (days < 3) activityColor = "text-emerald-600 dark:text-emerald-400";
      else if (days < 6) activityColor = "text-amber-600 dark:text-amber-400";
      else activityColor = "text-red-500 dark:text-red-400";
    } else {
      activityColor = "text-red-500 dark:text-red-400";
    }
    return (
      <>
        <TableCell className="py-2">
          <span className="text-xs text-muted-foreground truncate max-w-[110px] inline-block">
            {agent.managerName?.split(" ")[0] || "—"}
          </span>
        </TableCell>
        <TableCell className="py-2">
          <Badge variant="outline" className="text-[10px]">{stageLabel}</Badge>
        </TableCell>
        <TableCell className="py-2">
          <Badge
            variant="outline"
            className={cn(
              "text-[10px]",
              isLicensed
                ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                : "bg-muted text-muted-foreground",
            )}
          >
            {isLicensed ? "Licensed" : "Unlicensed"}
          </Badge>
        </TableCell>
        <TableCell className="py-2 text-center" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => {
              if (isApplicantRow) {
                toast.info(`Hire ${agent.name} first — attendance is agent-scoped.`);
                return;
              }
              toggleMeetingAttendance(agent.id);
            }}
            disabled={isApplicantRow}
            className={cn("focus:outline-none transition-base", isApplicantRow && "opacity-40 cursor-not-allowed")}
            aria-label={`Toggle meeting attendance for ${agent.name}`}
            title={isApplicantRow ? "Hire this applicant first to track attendance" : undefined}
          >
            {attendancePresent ? (
              <CircleCheck className="h-5 w-5 text-emerald-500 fill-emerald-500/20 mx-auto" />
            ) : (
              <Circle
                className={cn(
                  "h-5 w-5 mx-auto",
                  attendanceState === "absent" ? "text-red-500" : "text-muted-foreground/40",
                )}
              />
            )}
          </button>
        </TableCell>
        <TableCell className="py-2 text-center">
          {isTrainee ? (
            <Circle className="h-4 w-4 text-muted-foreground/30 mx-auto" />
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </TableCell>
        <TableCell className="py-2 text-right">
          <span className="text-xs font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
            {agent.weeklyALP > 0 ? `$${agent.weeklyALP.toLocaleString()}` : "—"}
          </span>
        </TableCell>
        <TableCell className="py-2 text-right">
          <span className="text-xs font-semibold tabular-nums">
            {agent.monthlyALP > 0 ? `$${agent.monthlyALP.toLocaleString()}` : "—"}
          </span>
        </TableCell>
        <TableCell className="py-2">
          <span className={cn("text-xs font-medium tabular-nums", activityColor)}>{lastActivityLabel}</span>
        </TableCell>
        {renderNBACell(agent)}
        {renderKebabActions(agent)}
      </>
    );
  };

  const renderExpandedRow = (_sectionKey: string, agent: AgentCRM) => (
    <CompactExpandedRow
      agent={agent}
      onRefresh={fetchAgents}
      onDeactivate={setDeactivateAgent}
      onViewApp={(id) => {
        const a = agents.find(ag => ag.id === id);
        setViewAppTarget({ agentId: id, applicationId: a?.applicationId });
      }}
      onEditLogin={setEditLoginAgent}
      onAgentUpdate={onAgentUpdate}
    />
  );

  if (authLoading) {
    return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <>
      <div className="space-y-5 page-enter relative p-4 md:p-6">
        <PageHeader
          accent="cyan"
          eyebrow="Team"
          title="CRM"
          subtitle="Every agent, status, production, access, and follow-up in one team view."
          actions={
            <>
              {(isAdmin || isManager) && (
                <Button variant={bulkMode ? "secondary" : "outline"} size="sm" className="gap-1.5" onClick={() => { setBulkMode(!bulkMode); setSelectedAgents(new Set()); }}>
                  <CheckSquare className="h-3.5 w-3.5" /> {bulkMode ? "Exit Bulk" : "Bulk Actions"}
                </Button>
              )}
              {isAdmin && (
                <Button onClick={handleBulkSendPortalLogins} variant="outline" size="sm" className="gap-1.5" disabled={sendingBulkLogins}>
                  <Mail className="h-3.5 w-3.5" /> {sendingBulkLogins ? "Sending..." : "Email All Logins"}
                </Button>
              )}
              <AddAgentModal onAgentAdded={fetchAgents} />
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { navigator.clipboard.writeText("https://apex-financial.org/agent-login"); toast.success("Check-in link copied! Paste into WhatsApp"); }}>
                <Link2 className="h-3.5 w-3.5" /> Check-In Link
              </Button>
              <Button onClick={fetchAgents} variant="outline" size="sm" className="gap-1.5">
                <RefreshCw className="h-3.5 w-3.5" /> Refresh
              </Button>
            </>
          }
        />

        {bulkMode && (
          <div className="space-y-2">
            <BulkStageActions
              agents={filteredAgents.map(a => ({ id: a.id, name: a.name, onboardingStage: a.onboardingStage }))}
              selectedIds={selectedAgents} onSelectionChange={setSelectedAgents}
              onBulkUpdate={() => { fetchAgents(); setSelectedAgents(new Set()); }}
              isEnabled={bulkMode} onToggle={() => { setBulkMode(false); setSelectedAgents(new Set()); }}
            />
            {selectedAgents.size > 0 && (
              <div className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-lg border border-border/60 bg-muted/30">
                <span className="text-xs text-muted-foreground mr-1">More actions:</span>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 h-8"
                  onClick={() => { setComposeChannel("email"); setComposeOpen(true); }}
                >
                  <Mail className="h-3.5 w-3.5" /> Compose Email
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 h-8"
                  onClick={() => { setComposeChannel("sms"); setComposeOpen(true); }}
                >
                  <Send className="h-3.5 w-3.5" /> Compose SMS
                </Button>
                {ENABLE_BULK_DELETE && isAdmin && (
                  <Button
                    size="sm"
                    variant="destructive"
                    className="gap-1.5 h-8 ml-auto"
                    disabled={bulkDeleting}
                    onClick={handleBulkDelete}
                  >
                    <UserX className="h-3.5 w-3.5" />
                    {bulkDeleting ? "Deactivating…" : `Deactivate (${selectedAgents.size})`}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        {/* palette-allow:mp261-apex-token-card-bg — APEX design-token bg #101720 per Sam MP-261 brief */}
        <div className="flex flex-col sm:flex-row gap-2 flex-wrap p-3 rounded-2xl bg-[#101720] border border-white/[0.08]">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input placeholder="Search agents..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-8 h-8 text-sm" />
          </div>
          {isAdmin && managers.length > 0 && (
            <Select value={managerFilter} onValueChange={setManagerFilter}>
              <SelectTrigger className="w-[140px] h-8 text-sm"><Filter className="h-3.5 w-3.5 mr-1.5" /><SelectValue placeholder="All Managers" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Managers</SelectItem>
                {managers.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Select value={licenseFilter} onValueChange={setLicenseFilter}>
            <SelectTrigger className="w-[130px] h-8 text-sm"><SelectValue placeholder="License" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All License</SelectItem>
              <SelectItem value="licensed">Licensed</SelectItem>
              <SelectItem value="unlicensed">Unlicensed</SelectItem>
            </SelectContent>
          </Select>
          <Select value={aiScoreFilter} onValueChange={setAiScoreFilter}>
            <SelectTrigger className="w-[120px] h-8 text-sm"><Sparkles className="h-3.5 w-3.5 mr-1" /><SelectValue placeholder="AI Score" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Scores</SelectItem>
              <SelectItem value="hot">🔥 Hot</SelectItem>
              <SelectItem value="warm">☀️ Warm</SelectItem>
              <SelectItem value="cool">❄️ Cool</SelectItem>
              <SelectItem value="cold">🧊 Cold</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortMode} onValueChange={setSortMode}>
            <SelectTrigger className="w-[160px] h-8 text-sm"><SelectValue placeholder="Sort" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="default">Default order</SelectItem>
              <SelectItem value="alp_desc">Highest ALP</SelectItem>
              <SelectItem value="newest">Newest</SelectItem>
              <SelectItem value="stalest">Most Stale</SelectItem>
              <SelectItem value="needs_followup">Needs Follow-Up</SelectItem>
              <SelectItem value="by_stage">By Stage</SelectItem>
            </SelectContent>
          </Select>
          <Button variant={showDeactivated ? "secondary" : "outline"} size="sm" onClick={() => setShowDeactivated(!showDeactivated)} className="gap-1.5 h-8">
            <UserX className="h-3.5 w-3.5" /> {showDeactivated ? "Deactivated ✓" : "Deactivated"}
          </Button>
          <Button variant={showInactive ? "secondary" : "outline"} size="sm" onClick={() => setShowInactive(!showInactive)} className="gap-1.5 h-8">
            <Eye className="h-3.5 w-3.5" /> {showInactive ? "Inactive ✓" : "Inactive"}
          </Button>
          {activeFilterCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearAllFilters}
              className="gap-1.5 h-8 text-muted-foreground hover:text-foreground ml-auto"
            >
              <X className="h-3.5 w-3.5" />
              Clear filters
              <Badge variant="secondary" className="ml-1 h-4 px-1.5 text-[10px] font-semibold">
                {activeFilterCount}
              </Badge>
            </Button>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" /></div>
        ) : (
          <>
          <Tabs value={activeStageTab} onValueChange={(v) => { setActiveStageTab(v); playSound("click"); }} className="space-y-3">
            {/* MP-261 — compact rounded-full segment chips with teal ring active state. */}
            <TabsList
              // palette-allow:mp261-apex-token-tabs-card — APEX design-token surface per Sam MP-261 brief
              className="w-full justify-start flex-wrap h-auto gap-1.5 rounded-2xl border border-white/[0.08] bg-[#101720] p-2 shadow-sm"
            >
              {SECTIONS.map(section => {
                const count = (agentsBySection.get(section.key) ?? []).length;
                const Icon = section.icon;
                return (
                  <TabsTrigger
                    key={section.key}
                    value={section.key}
                    className={cn(
                      // palette-allow:mp261-apex-token-chip-secondary — APEX text token #A8B3C5 per Sam MP-261 brief
                      "gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-[#A8B3C5] transition-base",
                      // palette-allow:mp261-apex-token-chip-primary — APEX text token #F5F7FA per Sam MP-261 brief
                      "hover:bg-white/[0.03] hover:text-[#F5F7FA]",
                      "data-[state=active]:bg-teal-500/10 data-[state=active]:text-teal-300",
                      "data-[state=active]:ring-1 data-[state=active]:ring-teal-400/70",
                    )}
                  >
                    <Icon className={cn("h-3.5 w-3.5", section.iconColor)} />
                    {section.label}
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px] h-4.5 px-1.5 font-bold tabular-nums",
                        section.headerBg, section.iconColor, "border-current/20",
                      )}
                    >
                      {count}
                    </Badge>
                  </TabsTrigger>
                );
              })}
            </TabsList>

            {SECTIONS.map(section => {
              const sectionAgents = agentsBySection.get(section.key) ?? [];

              return (
                <TabsContent key={section.key} value={section.key}>
                  {sectionAgents.length === 0 ? (
                    <div className="flex items-center justify-between gap-3 rounded-md border border-border px-4 py-3 text-sm">
                      <span className="text-muted-foreground">
                        {agents.length === 0 ? "No active agents fetched." : "No agents match this stage and filter set."}
                      </span>
                      {agents.length > 0 && (
                        <Button variant="outline" size="sm" onClick={clearAllFilters}>
                          Clear filters
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div
                      className={cn(
                        // palette-allow:mp261-apex-token-table-card — APEX card surface #101720 per Sam MP-261 brief
                        "rounded-2xl border border-white/[0.08] bg-[#101720] overflow-x-auto",
                        section.accent,
                        "border-l-4",
                      )}
                    >
                      <Table className="min-w-[900px]">
                        <TableHeader className="bg-white dark:bg-slate-950">
                          <TableRow className="border-slate-200 dark:border-slate-800 hover:bg-transparent [&_th]:h-10 [&_th]:text-white [&_th]:uppercase [&_th]:tracking-wide">
                            {bulkMode && <TableHead className="w-8" />}
                            {getTableHeaders(section.key)}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {sectionAgents.map(agent => {
                            const isExpanded = expandedAgentId === agent.id;
                            return (
                              <React.Fragment key={agent.id}>
                                <TableRow
                                  id={`agent-row-${agent.id}`}
                                  className={cn(
                                    "cursor-pointer transition-all duration-150 hover:bg-muted/40",
                                    isExpanded && "bg-muted/50",
                                    !isExpanded && "even:bg-muted/15",
                                    isStaleAgent(agent) && !isExpanded && "bg-red-500/[0.04] hover:bg-red-500/[0.08] border-l-2 border-l-red-500/40",
                                    agent.isDeactivated && "opacity-50"
                                  )}
                                  onClick={() => { setExpandedAgentId(isExpanded ? null : agent.id); playSound(isExpanded ? "click" : "whoosh"); }}
                                >
                                  {bulkMode && (
                                    <TableCell className="py-2" onClick={e => e.stopPropagation()}>
                                      <AgentSelectCheckbox agentId={agent.id} isSelected={selectedAgents.has(agent.id)}
                                        onToggle={(id) => {
                                          const s = new Set(selectedAgents);
                                          if (s.has(id)) s.delete(id);
                                          else s.add(id);
                                          setSelectedAgents(s);
                                        }}
                                        isEnabled={bulkMode} />
                                    </TableCell>
                                  )}
                                  <TableCell className="py-2">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <div className="relative shrink-0">
                                        <AgentAvatar avatarUrl={getAvatarUrl(agent.avatarUrl)} name={agent.name} size="sm" className="ring-2 ring-background shadow-sm" />
                                        {isStaleAgent(agent) && (
                                          <div className={cn("absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-red-500")} />
                                        )}
                                      </div>
                                      <div className="min-w-0">
                                        {/* 2026-06-15 — clickable name opens AgentProfileDrawer in-place */}
                                        <p className="font-medium text-xs truncate">
                                          <AgentNameLink agentId={agent.id}>{agent.name}</AgentNameLink>
                                        </p>
                                        <div className="flex items-center gap-1 mt-0.5">
                                          {duplicateAgentIds.has(agent.id) && <Badge variant="outline" className="text-[10px] h-3.5 px-1 bg-amber-500/10 text-amber-500 border-amber-500/20">Dupe</Badge>}
                                          {!agent.avatarUrl && <Badge variant="outline" className="text-[10px] h-3.5 px-1 bg-red-500/10 text-red-500 border-red-500/20">📷 Photo</Badge>}
                                          {agent.aiScoreTier && (
                                            <Badge variant="outline" className={cn("text-[10px] h-3.5 px-1", {
                                              "bg-red-500/10 text-red-500 border-red-500/20": agent.aiScoreTier === "hot",
                                              "bg-orange-500/10 text-amber-500 border-orange-500/20": agent.aiScoreTier === "warm",
                                              "bg-blue-500/10 text-blue-500 border-blue-500/20": agent.aiScoreTier === "cool",
                                              "bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-500/20": agent.aiScoreTier === "cold",
                                            })}>
                                              {agent.aiScoreTier === "hot" ? "🔥" : agent.aiScoreTier === "warm" ? "☀️" : agent.aiScoreTier === "cool" ? "❄️" : "🧊"} {agent.aiScoreTier}
                                            </Badge>
                                          )}
                                          {agent.managerId && agent.managerName && agent.managerId !== currentAgentId && (
                                            <Badge variant="outline" className="text-[11px] h-4.5 px-2 font-bold bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20">{agent.managerName.split(" ")[0]}</Badge>
                                          )}
                                        </div>
                                        <p className="text-[10px] text-muted-foreground truncate">{agent.email}</p>
                                        {agent.phone && <p className="text-[10px] text-muted-foreground select-all cursor-text" onClick={e => e.stopPropagation()}>{agent.phone}</p>}
                                      </div>
                                    </div>
                                  </TableCell>
                                  {getTableCells(section.key, agent)}
                                  <TableCell className="py-2">
                                    <div className={`transition-base ${isExpanded ? 'rotate-90' : ''}`}>
                                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                    </div>
                                  </TableCell>
                                </TableRow>
                                {isExpanded && (
                                  <tr><td colSpan={20} className="p-0">{renderExpandedRow(section.key, agent)}</td></tr>
                                )}
                              </React.Fragment>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </TabsContent>
              );
            })}
          </Tabs>

          
          </>
        )}
      </div>

      <ApplicationDetailSheet open={!!viewAppTarget} onOpenChange={(o) => !o && setViewAppTarget(null)} applicationId={viewAppTarget?.applicationId} agentId={viewAppTarget?.agentId} onRefresh={fetchAgents} />
      <DeactivateAgentDialog open={!!deactivateAgent} onOpenChange={(o) => !o && setDeactivateAgent(null)} agentId={deactivateAgent?.id || ""} agentName={deactivateAgent?.name || ""} currentManagerId={deactivateAgent?.managerId} onComplete={fetchAgents} />
      {editLoginAgent && (
        <AgentQuickEditDialog open={!!editLoginAgent} onOpenChange={(o) => !o && setEditLoginAgent(null)} agentId={editLoginAgent.id} currentName={editLoginAgent.name} onUpdate={fetchAgents} />
      )}
      <BulkComposeDrawer
        open={composeOpen}
        onOpenChange={setComposeOpen}
        defaultChannel={composeChannel}
        title={`Message ${selectedAgents.size} agent${selectedAgents.size === 1 ? "" : "s"}`}
        recipients={filteredAgents
          .filter((a) => selectedAgents.has(a.id))
          .map((a) => ({ id: a.id, name: a.name, email: a.email, phone: a.phone }))}
        onSent={() => {
          setComposeOpen(false);
          setSelectedAgents(new Set());
        }}
      />
    </>
  );
}
