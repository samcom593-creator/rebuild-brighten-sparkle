import React, { useState, useEffect, useCallback, useMemo } from "react";
import { AgentAvatar, getAvatarUrl } from "@/components/ui/AgentAvatar";
import { useSearchParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Users, Search, RefreshCw, Clock, AlertTriangle, ChevronRight,
  Mail, Phone, UserX, Filter, GraduationCap, Briefcase, Sparkles,
  Instagram, X, Send, CheckSquare, EyeOff, Link2, Eye, FileText,
  KeyRound, Copy, StickyNote, ClipboardCheck, Circle, CircleCheck,
  MoreHorizontal, TrendingUp, BadgeCheck, ArrowUpRight, Network, UserCheck, Flame,
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
import { GlassCard } from "@/components/ui/glass-card";
import { EmptyState } from "@/components/ui/empty-state";
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
import { ProductionMetricsCard } from "@/components/dashboard/ProductionMetricsCard";
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
  critical: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
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
    return { label: "Never", color: "text-rose-600 dark:text-rose-400" };
  }
  const days = (Date.now() - new Date(agent.lastContactedAt).getTime()) / (1000 * 60 * 60 * 24);
  if (days < 3) return { label: getTimeAgo(agent.lastContactedAt), color: "text-emerald-600 dark:text-emerald-400" };
  if (days < 6) return { label: getTimeAgo(agent.lastContactedAt), color: "text-amber-600 dark:text-amber-400" };
  return { label: getTimeAgo(agent.lastContactedAt), color: "text-rose-600 dark:text-rose-400" };
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
// 2026-07-26 visual pass — the per-section accent / headerBg / iconColor rainbow
// (blue · purple · yellow · orange · teal · red · slate · gray · zinc) was the
// loudest "different app" tell on this page. Severity is now carried by the row
// itself in the three contract tokens (emerald / amber / rose); the segment
// identity is carried by its label, icon, and one-sentence description.
const SECTIONS = [
  { key: "applied", bucket: "unlicensed" as PipelineBucket, label: "Applied", icon: Users, stages: ["applied"] as OnboardingStage[], desc: "Brand-new applications waiting on a first touch — every hour a row sits here is a hire cooling off." },
  { key: "meeting_attendance", bucket: "unlicensed" as PipelineBucket, label: "Meeting Attendance", icon: ClipboardCheck, stages: ["meeting_attendance"] as OnboardingStage[], desc: "Today's agency meeting roll for licensed agents — an unfilled circle means attendance was never taken." },
  { key: "pre_licensed", bucket: "unlicensed" as PipelineBucket, label: "Pre-Licensed", icon: GraduationCap, stages: ["pre_licensed", "onboarding", "training_online"] as OnboardingStage[], desc: "Recruits still working through licensing — a row stuck here is a seat that cannot earn yet." },
  { key: "transfer", bucket: "licensed" as PipelineBucket, label: "Transfer", icon: Users, stages: ["transfer"] as OnboardingStage[], desc: "Licensed agents moving in from another agency — they stall until contracting and access are finished." },
  { key: "in_training", bucket: "licensed" as PipelineBucket, label: "In-Field Training", icon: GraduationCap, stages: ["in_field_training"] as OnboardingStage[], desc: "Agents riding along in the field — they need a mentor touch every week or the ramp slips." },
  { key: "below_10k", bucket: "licensed" as PipelineBucket, label: "Below $20K (last 30d)", icon: AlertTriangle, stages: ["below_10k"] as OnboardingStage[], desc: "Licensed producers under $20K in the last 30 days, weakest first — this is the coaching list." },
  { key: "live", bucket: "licensed" as PipelineBucket, label: "Live", icon: Briefcase, stages: ["live", "evaluated"] as OnboardingStage[], desc: "Fully live producers ranked by month ALP — the board the agency's revenue actually runs on." },
  { key: "needs_followup", bucket: "licensed" as PipelineBucket, label: "Needs Follow-Up", icon: AlertTriangle, stages: ["need_followup"] as OnboardingStage[], desc: "Under $10K this month or six days with no contact — call these before the week closes." },
  { key: "hasnt_sold", bucket: "licensed" as PipelineBucket, label: "Hasn't Sold Yet", icon: AlertTriangle, stages: [] as OnboardingStage[], desc: "Licensed with zero lifetime deals, longest-hired first — every row is a recruit who never activated." },
  { key: "missing", bucket: "licensed" as PipelineBucket, label: "Missing / Silent", icon: Clock, stages: [] as OnboardingStage[], desc: "No production, contact, or record change in seven days — silence is the first sign of an agent leaving." },
  { key: "inactive", bucket: "licensed" as PipelineBucket, label: "Inactive", icon: UserX, stages: ["inactive"] as OnboardingStage[], desc: "Hidden by hand or dormant for 35 days — confirm they are gone before the seat counts as active." },
  { key: "deactivated", bucket: "licensed" as PipelineBucket, label: "Deactivated", icon: UserX, stages: [] as OnboardingStage[], desc: "Removed from the active roster, kept visible so a wrong removal can be caught and reversed." },
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
    <div className="flex flex-wrap items-center gap-2">
      {agent.phone && (
        <Button variant="outline" size="sm" className="h-10 gap-1 text-xs sm:h-8" asChild>
          <a href={`tel:${agent.phone}`}><Phone className="h-3 w-3" /> Call</a>
        </Button>
      )}
      {agent.email && (
        <Button variant="outline" size="sm" className="h-10 gap-1 text-xs sm:h-8" asChild>
          <a href={`mailto:${agent.email}`}><Mail className="h-3 w-3" /> Email</a>
        </Button>
      )}
      {agent.instagramHandle && (
        <Button variant="outline" size="sm" className="h-10 gap-1 text-xs sm:h-8" asChild>
          <a href={`https://instagram.com/${agent.instagramHandle.replace('@', '')}`} target="_blank" rel="noopener noreferrer">
            <Instagram className="h-3 w-3" /> IG
          </a>
        </Button>
      )}
      <Button variant="outline" size="sm" className="h-10 gap-1 text-xs sm:h-8" onClick={() => onViewApp(agent.id)}>
        <FileText className="h-3 w-3" /> App
      </Button>
      {agent.userId && (
        <>
          <Button variant="outline" size="sm" className="h-10 gap-1 text-xs sm:h-8"
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
          <Button variant="outline" size="sm" className="h-10 gap-1 text-xs sm:h-8"
            onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/login`); toast.success("Login link copied!"); }}>
            <Copy className="h-3 w-3" /> Link
          </Button>
          <Button variant="outline" size="sm" className="h-10 gap-1 border-amber-500/30 text-xs text-amber-600 hover:bg-amber-500/10 dark:text-amber-400 sm:h-8"
            onClick={() => onEditLogin(agent)}>
            <KeyRound className="h-3 w-3" /> Login
          </Button>
        </>
      )}
      <div className="flex-1" />
      <Button variant="ghost" size="sm" className="h-10 gap-1 text-xs text-amber-600 hover:bg-amber-500/10 dark:text-amber-400 sm:h-8"
        onClick={async () => {
          try {
            await supabase.from("agents").update({ is_inactive: true }).eq("id", agent.id);
            onAgentUpdate(agent.id, { isInactive: true });
            toast.success(`${agent.name} hidden`);
          } catch { toast.error("Failed"); }
        }}>
        <EyeOff className="h-3 w-3" /> Hide
      </Button>
      <Button variant="ghost" size="sm" className="h-10 gap-1 text-xs text-destructive hover:bg-destructive/10 sm:h-8"
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
    <div className="border-t border-border bg-muted/20 px-3 py-3 sm:px-4">
      <ContactActions agent={agent} onViewApp={onViewApp} onEditLogin={onEditLogin} onDeactivate={onDeactivate} onAgentUpdate={onAgentUpdate} />
      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={cn("text-[10px] font-bold uppercase tracking-wide", agent.agentLicenseStatus === "licensed" ? "border-success/30 bg-success/15 text-success" : "bg-muted text-muted-foreground")}>
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
            <summary className="flex min-h-10 cursor-pointer select-none items-center gap-2 rounded-md py-2 text-[10px] font-bold uppercase tracking-wide text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)] sm:min-h-0">
              <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" />
              Access &amp; Credentials
              <ChevronRight className="h-4 w-4 shrink-0 transition-base group-open:rotate-90" />
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

/* ────────────────────────────────────────────────────────────────────────────
   CANONICAL ROSTER
   ────────────────────────────────────────────────────────────────────────────
   Sam: "fix profiles and crm to have all agents". The pipeline view below is a
   RECRUITING funnel — it merges `agents` with open `applications` rows, so its
   array length answered "agents + applicants I can see" (664) when the question
   asked was "how big is the team" (181). That is the same class of defect as
   deriving a headline from a client array: the number was real, the SENTENCE
   was false.

   Every number in this panel comes from the canonical roster the backend
   already owns — crm_roster_segments() for the headline tiles, crm_agent_roster()
   for the rows. No second roster definition is invented here, and roster_exclusions
   (Sam removed Alyjah Rowland) is enforced inside those functions, so an excluded
   agent cannot reappear on this surface by way of a client-side filter someone
   forgets to copy.
──────────────────────────────────────────────────────────────────────────── */

interface RosterRow {
  agent_id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  agent_code: string | null;
  status: string | null;
  is_deactivated: boolean | null;
  is_inactive: boolean | null;
  is_sync_only: boolean | null;
  license_status: string | null;
  license_progress: string | null;
  onboarding_stage: string | null;
  training_stage: string | null;
  manager_id: string | null;
  manager_name: string | null;
  downline_count: number | null;
  contracts_total: number | null;
  contracts_active: number | null;
  mtd_alp: number | string | null;
  mtd_deals: number | null;
  today_alp: number | string | null;
  today_deals: number | null;
  selling_streak_days: number | null;
  l30_alp: number | string | null;
  l30_deals: number | null;
  lifetime_alp: number | string | null;
  lifetime_deals: number | null;
  first_posted_date: string | null;
  last_posted_date: string | null;
  last_contacted_at: string | null;
  created_at: string | null;
  tenure_days: number | null;
}

interface RosterContact {
  agent_id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
}

interface RosterSegments {
  total: number; active: number; inactive: number; terminated: number;
  licensed: number; unlicensed: number; sync_only: number;
  producing_mtd: number; mtd_alp: number | string; active_mtd_alp: number | string;
  offroster_mtd_alp: number | string; never_produced: number; dormant_60d: number;
  no_contact_14d: number; book_last_posted: string | null;
}

interface TodayProduction {
  today_alp: number | string;
  today_policies: number;
  selling_streak_days: number;
  business_date: string;
}

const num = (v: number | string | null | undefined): number => Number(v ?? 0) || 0;

/** Compact USD. Returns null (never "$0") when there is genuinely nothing on file. */
function usdOrNull(v: number | string | null | undefined): string | null {
  const n = num(v);
  if (n <= 0) return null;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

const daysSince = (iso: string | null): number | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
};

type RosterSegmentKey =
  | "all" | "new_hires" | "producing" | "never_produced"
  | "no_longer_here" | "unlicensed" | "inactive" | "terminated";

/**
 * Honest segmentation — every predicate reads a column the row actually carries,
 * and the chip count is the length of the very list the chip renders, so a chip
 * can never advertise a number the table below disagrees with.
 */
const ROSTER_SEGMENTS: Array<{
  key: RosterSegmentKey; label: string; icon: typeof Users; desc: string;
  match: (r: RosterRow) => boolean;
}> = [
  { key: "all", label: "All agents", icon: Users,
    desc: "Active agents who have produced. Never-produced and departed seats stay in their own review queues.",
    match: (r) => r.status === "active" && (r.lifetime_deals ?? 0) > 0 },
  { key: "new_hires", label: "New hires", icon: UserCheck,
    desc: "Joined in the last 30 days. Open a profile to control login, licensing, onboarding, contracting, and assigned work.",
    match: (r) => r.status === "active" && r.tenure_days !== null && r.tenure_days <= 30 },
  { key: "producing", label: "Producing", icon: TrendingUp,
    desc: "Wrote business this month. This is the bench the agency's revenue is actually standing on.",
    match: (r) => r.status === "active" && num(r.mtd_alp) > 0 },
  { key: "never_produced", label: "Never produced", icon: UserX,
    desc: "Active roster seats with zero lifetime deals — the activation and coaching queue.",
    match: (r) => r.status === "active" && (r.lifetime_deals ?? 0) === 0 },
  { key: "no_longer_here", label: "No longer here", icon: EyeOff,
    desc: "Previously produced but no business in 60+ days. Review these seats before formally marking them inactive or terminated.",
    match: (r) => {
      const d = daysSince(r.last_posted_date);
      return r.status === "active" && (r.lifetime_deals ?? 0) > 0 && d !== null && d >= 60;
    } },
  { key: "unlicensed", label: "Unlicensed", icon: GraduationCap,
    desc: "Still working through licensing — these seats cannot legally earn yet.",
    match: (r) => r.license_status !== "licensed" },
  { key: "inactive", label: "Inactive", icon: EyeOff,
    desc: "Dormant or hidden by hand. Confirm they are gone before the seat stops counting.",
    match: (r) => r.status === "inactive" },
  { key: "terminated", label: "Terminated", icon: X,
    desc: "Off the roster. Kept visible so a wrong removal can be caught and reversed.",
    match: (r) => r.status === "terminated" },
];

type RosterSortKey = "mtd_desc" | "l30_desc" | "lifetime_desc" | "streak_desc" | "name" | "stalest" | "newest";

function RosterStatusBadge({ row }: { row: RosterRow }) {
  const s = row.status ?? "unknown";
  const tone =
    s === "active" ? "border-success/30 bg-success/15 text-success"
    : s === "terminated" ? "border-destructive/30 bg-destructive/10 text-destructive"
    : "bg-muted text-muted-foreground";
  return (
    <Badge variant="outline" className={cn("text-[10px] font-bold uppercase tracking-wide", tone)}>
      {s}
    </Badge>
  );
}

function RosterPanel({ rows, isLoading, isError, onRetry }: {
  rows: RosterRow[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}) {
  const [segment, setSegment] = useState<RosterSegmentKey>("all");
  const [q, setQ] = useState("");
  const [managerFilter, setManagerFilter] = useState("all");
  const [sort, setSort] = useState<RosterSortKey>("mtd_desc");

  const managers = useMemo(() => {
    const m = new Map<string, string>();
    rows.forEach((r) => { if (r.manager_id && r.manager_name) m.set(r.manager_id, r.manager_name); });
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const searched = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (managerFilter !== "all" && r.manager_id !== managerFilter) return false;
      if (!needle) return true;
      return (
        (r.full_name ?? "").toLowerCase().includes(needle) ||
        (r.email ?? "").toLowerCase().includes(needle) ||
        (r.phone ?? "").toLowerCase().includes(needle) ||
        (r.agent_code ?? "").toLowerCase().includes(needle) ||
        (r.manager_name ?? "").toLowerCase().includes(needle) ||
        (r.license_status ?? "").toLowerCase().includes(needle) ||
        (r.onboarding_stage ?? "").toLowerCase().includes(needle) ||
        (r.status ?? "").toLowerCase().includes(needle)
      );
    });
  }, [rows, q, managerFilter]);

  // Chip counts are computed from the SAME searched list the table renders, so a
  // chip can never claim a number the rows below contradict.
  const bySegment = useMemo(() => {
    const m = new Map<RosterSegmentKey, RosterRow[]>();
    for (const seg of ROSTER_SEGMENTS) m.set(seg.key, searched.filter(seg.match));
    return m;
  }, [searched]);

  const visible = useMemo(() => {
    const list = [...(bySegment.get(segment) ?? [])];
    switch (sort) {
      case "mtd_desc": list.sort((a, b) => num(b.mtd_alp) - num(a.mtd_alp)); break;
      case "l30_desc": list.sort((a, b) => num(b.l30_alp) - num(a.l30_alp)); break;
      case "lifetime_desc": list.sort((a, b) => num(b.lifetime_alp) - num(a.lifetime_alp)); break;
      case "streak_desc": list.sort((a, b) => num(b.selling_streak_days) - num(a.selling_streak_days) || num(b.today_alp) - num(a.today_alp)); break;
      case "name": list.sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? "")); break;
      case "newest": list.sort((a, b) => (b.tenure_days ?? -1) === (a.tenure_days ?? -1) ? 0 : (a.tenure_days ?? 1e9) - (b.tenure_days ?? 1e9)); break;
      case "stalest": list.sort((a, b) => {
        const at = a.last_posted_date ? new Date(a.last_posted_date).getTime() : 0;
        const bt = b.last_posted_date ? new Date(b.last_posted_date).getTime() : 0;
        return at - bt;
      }); break;
    }
    return list;
  }, [bySegment, segment, sort]);

  const activeSeg = ROSTER_SEGMENTS.find((s) => s.key === segment)!;

  if (isError) {
    return (
      <GlassCard className="p-4">
        <EmptyState
          icon={<Users className="h-7 w-7" />}
          variant="warning"
          title="The roster could not be read"
          description="crm_agent_roster() did not answer. Nothing is being guessed at in its place — retry, and if it keeps failing the roster functions need looking at."
          actions={<Button variant="outline" size="sm" onClick={onRetry}>Retry</Button>}
        />
      </GlassCard>
    );
  }

  return (
    <div className="space-y-3">
      <GlassCard className="p-4">
        <div className="flex flex-col flex-wrap gap-2 sm:flex-row">
          <div className="relative min-w-0 flex-1 sm:min-w-[200px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 shrink-0 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, email, phone, code, upline, or status..."
              aria-label="Search the canonical roster"
              className="h-10 pl-9 text-sm sm:h-9"
            />
          </div>
          {managers.length > 0 && (
            <Select value={managerFilter} onValueChange={setManagerFilter}>
              <SelectTrigger aria-label="Filter roster by upline" className="h-10 w-full text-sm sm:h-9 sm:w-[170px]">
                <Network className="mr-1.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <SelectValue placeholder="All uplines" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All uplines</SelectItem>
                {managers.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Select value={sort} onValueChange={(v) => setSort(v as RosterSortKey)}>
            <SelectTrigger aria-label="Sort the roster" className="h-10 w-full text-sm sm:h-9 sm:w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="mtd_desc">Month ALP (high → low)</SelectItem>
              <SelectItem value="l30_desc">Last 30d ALP</SelectItem>
              <SelectItem value="lifetime_desc">Lifetime ALP</SelectItem>
              <SelectItem value="streak_desc">Current sales streak</SelectItem>
              <SelectItem value="stalest">Longest since a sale</SelectItem>
              <SelectItem value="newest">Newest on the roster</SelectItem>
              <SelectItem value="name">Name (A → Z)</SelectItem>
            </SelectContent>
          </Select>
          {(q.trim() !== "" || managerFilter !== "all") && (
            <Button variant="ghost" size="sm" className="h-10 gap-1.5 text-muted-foreground hover:text-foreground sm:ml-auto sm:h-9"
              onClick={() => { setQ(""); setManagerFilter("all"); }}>
              <X className="h-4 w-4 shrink-0" /> Clear
            </Button>
          )}
        </div>
      </GlassCard>

      <div className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        <div className="flex min-w-max gap-1.5 rounded-lg border border-border bg-card p-1.5">
          {ROSTER_SEGMENTS.map((seg) => {
            const Icon = seg.icon;
            const count = (bySegment.get(seg.key) ?? []).length;
            const isActive = seg.key === segment;
            return (
              <button
                key={seg.key}
                type="button"
                onClick={() => setSegment(seg.key)}
                aria-pressed={isActive}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                  "focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]",
                  isActive
                    ? "bg-primary/10 text-foreground ring-1 ring-primary/60"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {seg.label}
                <Badge variant="outline" className="h-4 px-1.5 text-[10px] font-bold tabular-nums">{count}</Badge>
              </button>
            );
          })}
        </div>
      </div>

      <GlassCard className="overflow-hidden p-4">
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
            <activeSeg.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{activeSeg.label}</span>
          </h3>
          <span className="shrink-0 text-sm font-bold tabular-nums text-muted-foreground">{visible.length}</span>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">{activeSeg.desc}</p>

        {isLoading ? (
          <div className="space-y-2">
            {[...Array(8)].map((_, i) => (
              // stable-key-allow:skeleton — static Array(N) decorative loader, no reorder
              <div key={i} className="h-[56px] animate-pulse rounded-lg bg-muted/30" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<Users className="h-7 w-7" />}
            title="No agents sit in this segment"
            description={
              q.trim() || managerFilter !== "all"
                ? "The search or upline filter may be too tight — clear them to see the whole segment."
                : "Nothing on the roster matches this definition right now. That is the honest answer, not a loading state."
            }
            actions={(q.trim() || managerFilter !== "all") ? (
              <Button variant="outline" size="sm" onClick={() => { setQ(""); setManagerFilter("all"); }}>Clear filters</Button>
            ) : undefined}
          />
        ) : (
          <div className="-mx-4 overflow-x-auto sm:mx-0">
            <Table className="min-w-[1160px]">
              <TableHeader>
                <TableRow className="border-b border-border hover:bg-transparent [&_th]:h-9 [&_th]:text-[10px] [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-muted-foreground">
                  <TableHead className="w-[270px] px-2">Agent &amp; contact</TableHead>
                  <TableHead className="w-[120px] px-2">Upline</TableHead>
                  <TableHead className="w-[100px] px-2">Status</TableHead>
                  <TableHead className="w-[100px] px-2">License</TableHead>
                  <TableHead className="w-[120px] px-2">Today</TableHead>
                  <TableHead className="w-[90px] px-2 text-center">Streak</TableHead>
                  <TableHead className="w-[110px] px-2 text-right">Month ALP</TableHead>
                  <TableHead className="w-[110px] px-2 text-right">Last 30d</TableHead>
                  <TableHead className="w-[120px] px-2 text-right">Lifetime</TableHead>
                  <TableHead className="w-[120px] px-2">Last sale</TableHead>
                  <TableHead className="w-[90px] px-2 text-right">Tenure</TableHead>
                  <TableHead className="w-[80px] px-2 text-right">Profile</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((r) => {
                  const mtd = usdOrNull(r.mtd_alp);
                  const l30 = usdOrNull(r.l30_alp);
                  const life = usdOrNull(r.lifetime_alp);
                  const sinceSale = daysSince(r.last_posted_date);
                  return (
                    <TableRow key={r.agent_id} className="border-b border-border/60 transition-colors hover:bg-muted/30">
                      <TableCell className="px-2 py-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <AgentAvatar avatarUrl={getAvatarUrl(r.avatar_url ?? undefined)} name={r.full_name ?? "—"} size="sm" className="shrink-0 shadow-sm ring-2 ring-background" />
                          <div className="min-w-0">
                            <Link
                              to={`/dashboard/profile?agentId=${r.agent_id}`}
                              className="block truncate text-sm font-medium text-foreground underline-offset-2 decoration-dotted hover:text-primary hover:underline"
                            >
                              {r.full_name ?? "Name not on file"}
                            </Link>
                            {r.email ? (
                              <a href={`mailto:${r.email}`} className="block truncate text-[11px] text-muted-foreground hover:text-primary hover:underline">
                                <Mail className="mr-1 inline h-3 w-3" />{r.email}
                              </a>
                            ) : <p className="truncate text-[11px] italic text-muted-foreground">No email on file</p>}
                            {r.phone ? (
                              <a href={`tel:${r.phone}`} className="block truncate text-[11px] tabular-nums text-muted-foreground hover:text-primary hover:underline">
                                <Phone className="mr-1 inline h-3 w-3" />{r.phone}
                              </a>
                            ) : <p className="truncate text-[11px] italic text-muted-foreground">No phone on file</p>}
                            {r.agent_code && (
                              <p className="truncate text-[11px] tabular-nums text-muted-foreground/70">{r.agent_code}</p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="px-2 py-2">
                        <span className="inline-block max-w-[112px] truncate text-[11px] text-muted-foreground">
                          {r.manager_name ?? "—"}
                        </span>
                      </TableCell>
                      <TableCell className="px-2 py-2"><RosterStatusBadge row={r} /></TableCell>
                      <TableCell className="px-2 py-2">
                        <Badge variant="outline" className={cn(
                          "text-[10px] font-bold uppercase tracking-wide",
                          r.license_status === "licensed" ? "border-success/30 bg-success/15 text-success" : "bg-muted text-muted-foreground",
                        )}>
                          {r.license_status ?? "unknown"}
                        </Badge>
                      </TableCell>
                      <TableCell className="px-2 py-2">
                        {(r.today_deals ?? 0) > 0 ? (
                          <div>
                            <Badge variant="outline" className="border-success/30 bg-success/15 text-[10px] font-bold uppercase tracking-wide text-success">
                              Sold today
                            </Badge>
                            <p className="mt-0.5 text-[10px] tabular-nums text-muted-foreground">
                              {usdOrNull(r.today_alp) ?? "$0"} · {r.today_deals} {r.today_deals === 1 ? "deal" : "deals"}
                            </p>
                          </div>
                        ) : (
                          <Badge variant="outline" className="bg-muted text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                            No sale today
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="px-2 py-2 text-center">
                        {(r.selling_streak_days ?? 0) > 0 ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning/10 px-2 py-1 text-[11px] font-bold tabular-nums text-warning">
                            <Flame className="h-3.5 w-3.5" /> {r.selling_streak_days}d
                          </span>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="px-2 py-2 text-right">
                        <span className={cn("text-sm font-bold tabular-nums", mtd ? "text-success" : "text-muted-foreground")}>
                          {mtd ?? "—"}
                        </span>
                        {(r.mtd_deals ?? 0) > 0 && (
                          <span className="ml-1 text-[10px] tabular-nums text-muted-foreground">×{r.mtd_deals}</span>
                        )}
                      </TableCell>
                      <TableCell className="px-2 py-2 text-right">
                        <span className={cn("text-sm tabular-nums", l30 ? "text-foreground" : "text-muted-foreground")}>{l30 ?? "—"}</span>
                      </TableCell>
                      <TableCell className="px-2 py-2 text-right">
                        <span className={cn("text-sm tabular-nums", life ? "text-foreground" : "text-muted-foreground")}>{life ?? "—"}</span>
                        {(r.lifetime_deals ?? 0) > 0 && (
                          <span className="ml-1 text-[10px] tabular-nums text-muted-foreground">×{r.lifetime_deals}</span>
                        )}
                      </TableCell>
                      <TableCell className="px-2 py-2">
                        {r.last_posted_date ? (
                          <span className={cn(
                            "text-[11px] font-medium tabular-nums",
                            sinceSale !== null && sinceSale >= 60 ? "text-rose-600 dark:text-rose-400"
                              : sinceSale !== null && sinceSale >= 14 ? "text-amber-600 dark:text-amber-400"
                              : "text-emerald-600 dark:text-emerald-400",
                          )}>
                            {r.last_posted_date}{sinceSale !== null && <span className="ml-1 text-muted-foreground">· {sinceSale}d</span>}
                          </span>
                        ) : (
                          <span className="text-[11px] italic text-muted-foreground">never sold</span>
                        )}
                      </TableCell>
                      <TableCell className="px-2 py-2 text-right">
                        <span className="text-[11px] tabular-nums text-muted-foreground">
                          {r.tenure_days === null || r.tenure_days === undefined ? "—" : `${r.tenure_days}d`}
                        </span>
                      </TableCell>
                      <TableCell className="px-2 py-2 text-right">
                        <Button asChild variant="ghost" size="sm" className="h-8 w-8 p-0" aria-label={`Open producer profile for ${r.full_name ?? "this agent"}`}>
                          <Link to={`/dashboard/profile?agentId=${r.agent_id}`}><ArrowUpRight className="h-4 w-4" /></Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </GlassCard>
    </div>
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
  const [crmView, setCrmView] = useState<"roster" | "pipeline">(() => {
    try { return localStorage.getItem("crm.view.v1") === "pipeline" ? "pipeline" : "roster"; }
    catch { return "roster"; } // empty-catch-allow:localstorage-incognito
  });
  useEffect(() => {
    try { localStorage.setItem("crm.view.v1", crmView); }
    catch { /* ignore quota / disabled storage */ } // empty-catch-allow:localstorage-incognito
  }, [crmView]);

  // Canonical roster — the two functions that own "who is on this team".
  const rosterSegmentsQuery = useQuery({
    queryKey: ["crm-roster-segments"],
    enabled: !authLoading && !!user,
    staleTime: 60_000,
    queryFn: async (): Promise<RosterSegments | null> => {
      const { data, error } = await supabase.rpc("crm_roster_segments" as never);
      if (error) throw error;
      const value = data as unknown;
      const row = Array.isArray(value) ? value[0] : value;
      return (row as RosterSegments) ?? null;
    },
  });

  const todayProductionQuery = useQuery({
    queryKey: ["crm-today-production"],
    enabled: !authLoading && !!user,
    staleTime: 15_000,
    refetchInterval: 30_000,
    queryFn: async (): Promise<TodayProduction | null> => {
      const { data, error } = await supabase.rpc("crm_today_production" as never);
      if (error) throw error;
      const value = data as unknown;
      const row = Array.isArray(value) ? value[0] : value;
      return (row as TodayProduction) ?? null;
    },
  });

  const rosterQuery = useQuery({
    queryKey: ["crm-agent-roster"],
    enabled: !authLoading && !!user,
    staleTime: 60_000,
    queryFn: async (): Promise<RosterRow[]> => {
      const [rosterResult, pulseResult, contactResult] = await Promise.all([
        supabase.rpc("crm_agent_roster" as never),
        supabase.rpc("crm_agent_sales_pulse" as never),
        supabase.rpc("crm_agent_contacts" as never),
      ]);
      if (rosterResult.error) throw rosterResult.error;
      if (pulseResult.error) throw pulseResult.error;
      if (contactResult.error) throw contactResult.error;
      const pulseByAgent = new Map(
        ((pulseResult.data as unknown as Array<Pick<RosterRow, "agent_id" | "today_alp" | "today_deals" | "selling_streak_days">>) ?? [])
          .map((row) => [row.agent_id, row] as const),
      );
      const contactByAgent = new Map(
        ((contactResult.data as unknown as RosterContact[]) ?? []).map((row) => [row.agent_id, row] as const),
      );
      return ((rosterResult.data as unknown as RosterRow[]) ?? []).map((row) => ({
        ...row,
        full_name: contactByAgent.get(row.agent_id)?.full_name ?? row.full_name,
        email: contactByAgent.get(row.agent_id)?.email ?? row.email,
        phone: contactByAgent.get(row.agent_id)?.phone ?? row.phone,
        today_alp: pulseByAgent.get(row.agent_id)?.today_alp ?? 0,
        today_deals: pulseByAgent.get(row.agent_id)?.today_deals ?? 0,
        selling_streak_days: pulseByAgent.get(row.agent_id)?.selling_streak_days ?? 0,
      }));
    },
  });

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
      // These early exits must NOT return from the whole function — the agent
      // roster fetch below has to run regardless of whether the manager dropdown
      // populates. (A bare `return` here left the CRM roster empty.)
      const { data: managerRoles } = await supabase.from("user_roles").select("user_id").eq("role", "manager");
      const managerUserIds = (managerRoles ?? []).map(r => r.user_id);
      if (managerUserIds.length) {
        const { data: managerAgents } = await supabase.from("agents").select("id, user_id").in("user_id", managerUserIds).eq("status", "active");
        const { data: profiles } = await supabase.from("profiles").select("user_id, full_name").in("user_id", managerUserIds);
        const profileMap = new Map(profiles?.map(p => [p.user_id, p.full_name]) || []);
        setManagers((managerAgents ?? []).map(a => ({ id: a.id, name: profileMap.get(a.user_id) || "—" })));
      } else {
        setManagers([]);
      }
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
          ? (supabase as any)
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
        const monthlyALP = monthlyProductionMap.get(agent.id) || 0;
        const lifetimeDeals = lifetimeMap.get(agent.id)?.deals ?? 0;
        // Production is conclusive evidence of a producer license. Normalize
        // once here so every filter, badge, section, and next-best action uses
        // the same truth even when a legacy agent row has stale license_status.
        const effectiveLicenseStatus = agent.license_status === "licensed"
          || lifetimeDeals > 0
          || monthlyALP > 0
          ? "licensed"
          : (agent.license_status || "unlicensed");

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
          monthlyALP, monthlyDeals: monthlyDealsMap.get(agent.id) || 0,
          prevWeekALP: prevWeekALPMap.get(agent.id) || 0,
          lastContactedAt: lastContactMap.get(agent.id) || null, standardPaid: pay.standard, premiumPaid: pay.premium,
          licenseProgress: licenseEntry?.progress || null, testScheduledDate: licenseEntry?.testDate || null,
          agentLicenseStatus: effectiveLicenseStatus,
          aiScoreTier: licenseEntry?.aiScore || null,
          lifetimeDeals,
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
        // NOTE: applications has no user_id column — selecting it 400'd the whole
        // query (error swallowed), so every unlicensed applicant was silently
        // invisible on the CRM (~627 rows). Removed here and from the OR clause below.
        .select("id, first_name, last_name, email, phone, license_status, license_progress, test_scheduled_date, status, instagram_handle, started_training, ai_score_tier, assigned_agent_id, referral_manager_id, recruiter_id, hiring_manager_user_id, created_at")
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
      // Chunk the id list — a single ~200-id `.in()` built a URL long enough to
      // 400 the gateway, which silently dropped every attendance badge.
      const CHUNK = 100;
      const map = new Map<string, "present" | "absent" | "unmarked">();
      for (let i = 0; i < agentIds.length; i += CHUNK) {
        const { data } = await supabase.from("agent_attendance")
          .select("agent_id, status")
          .in("agent_id", agentIds.slice(i, i + CHUNK))
          .eq("attendance_date", todayStr)
          .eq("attendance_type", "agency_meeting" as any);
        data?.forEach(r => map.set(r.agent_id, r.status as any));
      }
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
  const fetchAgents = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["crm-agents"] });
    // Refresh must move BOTH views, or the header tiles go stale behind a
    // pipeline that just reloaded and the two start telling different stories.
    queryClient.invalidateQueries({ queryKey: ["crm-agent-roster"] });
    queryClient.invalidateQueries({ queryKey: ["crm-roster-segments"] });
    queryClient.invalidateQueries({ queryKey: ["crm-today-production"] });
  }, [queryClient]);

  // Phase 5: Live updates — invalidate when agents/applications change anywhere
  useRealtimeTable({ table: "agents", channelSuffix: "crm" }, () => {
    queryClient.invalidateQueries({ queryKey: ["crm-agents"] });
  });
  useRealtimeTable({ table: "applications", channelSuffix: "crm" }, () => {
    queryClient.invalidateQueries({ queryKey: ["crm-agents"] });
  });
  useRealtimeTable({ table: "deals", channelSuffix: "crm-production" }, () => {
    queryClient.invalidateQueries({ queryKey: ["crm-today-production"] });
    queryClient.invalidateQueries({ queryKey: ["crm-agent-roster"] });
    queryClient.invalidateQueries({ queryKey: ["crm-roster-segments"] });
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
      // set_agent_active writes status + is_inactive + is_deactivated together.
      // Writing only is_deactivated (what this did) left the three fields out of
      // step, and v_apex_roster reads status — so a deactivated agent kept
      // appearing in the roster and Sam's clear-house never took effect. One RPC
      // so those flags cannot drift apart again.
      const { error } = await supabase.rpc("set_agent_active" as never, {
        p_agent_ids: ids,
        p_active: false,
      } as never);
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

  // 2026-08-23 — the old `teamKpis` memo lived here and rendered "Team size" from
  // `activeAgents.length`. That array is agents UNION open applications, so the
  // tile read 664 against a 181-agent roster. Deleted rather than relabelled:
  // headline team numbers now come from crm_roster_segments() (see RosterKpis),
  // and there is no longer a second place on this page that can answer the
  // question differently.

  // MP-261 — unified 11-col table shape. Chips filter rows; columns stay stable.
  // Agent / Mentor / Stage / License / Present / Homework / Week ALP / Month ALP /
  // Last Activity / Next Best Action / Actions.
  const getTableHeaders = (_sectionKey: string) => (
    <>
      <TableHead className="w-[220px] px-2">Agent</TableHead>
      <TableHead className="w-[110px] px-2">Mentor</TableHead>
      <TableHead className="w-[110px] px-2">Stage</TableHead>
      <TableHead className="w-[100px] px-2">License</TableHead>
      <TableHead className="w-[80px] px-2 text-center">Present</TableHead>
      <TableHead className="w-[100px] px-2 text-right">Week ALP</TableHead>
      <TableHead className="w-[100px] px-2 text-right">Month ALP</TableHead>
      <TableHead className="w-[110px] px-2">Last Activity</TableHead>
      <TableHead className="w-[200px] px-2">Next Best Action</TableHead>
      <TableHead className="w-[70px] px-2 text-right">Actions</TableHead>
    </>
  );

  const renderNBACell = (agent: AgentCRM) => {
    const nba = computeAgentNBA(agent);
    const badge = priorityBadgeClasses(nba.priority);
    return (
      <TableCell className="px-2 py-2">
        <div className="flex min-w-0 max-w-[200px] flex-col gap-1">
          <Badge variant="outline" className={cn("w-fit text-[10px] font-bold uppercase tracking-wide", badge.className)}>
            {badge.text}
          </Badge>
          <span className="truncate text-[11px] font-medium text-foreground" title={nba.reason}>{nba.action}</span>
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
    <TableCell className="px-2 py-2 text-right" onClick={(e) => e.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-10 w-10 p-0 sm:h-8 sm:w-8" aria-label={`Actions for ${agent.name}`}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel className="truncate text-[11px]">{agent.name}</DropdownMenuLabel>
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
    const isLicensed = agent.agentLicenseStatus === "licensed"
      || agent.lifetimeDeals > 0
      || agent.monthlyALP > 0;
    const stageLabel = isLicensed
      ? agent.onboardingStage.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())
      : (PROGRESS_LABELS[agent.licenseProgress || "unlicensed"] || "In Course");
    const isTrainee = agent.onboardingStage === "in_field_training";
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
      else activityColor = "text-rose-600 dark:text-rose-400";
    } else {
      activityColor = "text-rose-600 dark:text-rose-400";
    }
    return (
      <>
        <TableCell className="px-2 py-2">
          <span className="inline-block max-w-[110px] truncate text-[11px] text-muted-foreground">
            {agent.managerName?.split(" ")[0] || "—"}
          </span>
        </TableCell>
        <TableCell className="px-2 py-2">
          <Badge variant="outline" className="max-w-[104px] truncate text-[10px] font-bold uppercase tracking-wide">{stageLabel}</Badge>
        </TableCell>
        <TableCell className="px-2 py-2">
          <Badge
            variant="outline"
            className={cn(
              "text-[10px] font-bold uppercase tracking-wide",
              isLicensed
                ? "border-success/30 bg-success/15 text-success"
                : "bg-muted text-muted-foreground",
            )}
          >
            {isLicensed ? "Licensed" : "Unlicensed"}
          </Badge>
        </TableCell>
        <TableCell className="px-2 py-2 text-center" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => {
              if (isApplicantRow) {
                toast.info(`Hire ${agent.name} first — attendance is agent-scoped.`);
                return;
              }
              toggleMeetingAttendance(agent.id);
            }}
            disabled={isApplicantRow}
            aria-pressed={attendancePresent}
            className={cn(
              "mx-auto inline-flex h-10 w-10 items-center justify-center rounded-full transition-colors",
              "focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]",
              "sm:h-8 sm:w-8",
              isApplicantRow ? "cursor-not-allowed opacity-40" : "hover:bg-muted/60",
            )}
            aria-label={`Toggle meeting attendance for ${agent.name}`}
            title={isApplicantRow ? "Hire this applicant first to track attendance" : undefined}
          >
            {attendancePresent ? (
              <CircleCheck className="h-5 w-5 fill-emerald-500/20 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <Circle
                className={cn(
                  "h-5 w-5",
                  attendanceState === "absent" ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground/40",
                )}
              />
            )}
          </button>
        </TableCell>
        <TableCell className="px-2 py-2 text-right">
          <span className={cn(
            "text-sm font-bold tabular-nums",
            agent.weeklyALP > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
          )}>
            {agent.weeklyALP > 0 ? `$${agent.weeklyALP.toLocaleString()}` : "—"}
          </span>
        </TableCell>
        <TableCell className="px-2 py-2 text-right">
          <span className={cn(
            "text-sm font-bold tabular-nums",
            agent.monthlyALP > 0 ? "text-foreground" : "text-muted-foreground",
          )}>
            {agent.monthlyALP > 0 ? `$${agent.monthlyALP.toLocaleString()}` : "—"}
          </span>
        </TableCell>
        <TableCell className="px-2 py-2">
          <span className={cn("text-[11px] font-medium tabular-nums", activityColor)}>{lastActivityLabel}</span>
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
    return <PageLoadingSkeleton variant="table" />;
  }

  return (
    <>
      {/* max-w-[1400px] (not max-w-6xl) — the primary content is an 11-column
          table, the one width exception the visual contract allows. px-4 sm:px-6
          is required so PageHeader's -mx-4 sm:-mx-6 cancels exactly. */}
      <div className="page-enter mx-auto w-full max-w-[1400px] space-y-5 px-4 pb-24 sm:px-6">
        <PageHeader
          accent="cyan"
          eyebrow="Team"
          eyebrowIcon={<Users className="h-3.5 w-3.5" />}
          title="CRM"
          subtitle="Every agent, status, production, access, and follow-up in one team view."
          actions={
            <>
              {(isAdmin || isManager) && (
                <Button variant={bulkMode ? "secondary" : "outline"} size="sm" aria-pressed={bulkMode} className="h-10 gap-1.5 sm:h-9" onClick={() => {
                  const next = !bulkMode;
                  setBulkMode(next);
                  setSelectedAgents(new Set());
                  // The row checkboxes and BulkStageActions live in the
                  // "pipeline" branch only. The page defaults to "roster", so
                  // pressing Bulk Actions there entered bulk mode and rendered
                  // ZERO checkboxes — nothing to select, nothing to deactivate,
                  // and no way to tell it was the wrong view. Measured live
                  // before this change: bulkMode true, checkboxes 0.
                  if (next && crmView === "roster") setCrmView("pipeline");
                }}>
                  <CheckSquare className="h-4 w-4 shrink-0" /> {bulkMode ? "Exit Bulk" : "Bulk Actions"}
                </Button>
              )}
              {isAdmin && (
                <Button onClick={handleBulkSendPortalLogins} variant="outline" size="sm" className="h-10 gap-1.5 sm:h-9" disabled={sendingBulkLogins}>
                  <Mail className="h-4 w-4 shrink-0" /> {sendingBulkLogins ? "Sending..." : "Email All Logins"}
                </Button>
              )}
              <AddAgentModal onAgentAdded={fetchAgents} />
              <Button variant="outline" size="sm" className="h-10 gap-1.5 sm:h-9" onClick={() => { navigator.clipboard.writeText("https://apex-financial.org/agent-login"); toast.success("Check-in link copied! Paste into WhatsApp"); }}>
                <Link2 className="h-4 w-4 shrink-0" /> Check-In Link
              </Button>
              <Button onClick={fetchAgents} variant="outline" size="sm" className="h-10 gap-1.5 sm:h-9">
                <RefreshCw className="h-4 w-4 shrink-0" /> Refresh
              </Button>
            </>
          }
        />

        <ProductionMetricsCard
          snapshot={rosterSegmentsQuery.data ?? null}
          isLoading={rosterSegmentsQuery.isLoading}
          todayProduction={todayProductionQuery.data ?? null}
          isTodayLoading={todayProductionQuery.isLoading}
        />

        {/* Two questions, two views, one set of headline numbers above.
            Roster answers "who is on this team" from the canonical roster.
            Pipeline answers "who is moving through recruiting" and therefore
            legitimately counts open applications alongside hired agents — which
            is exactly why its row count must never be labelled "team size". */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-border bg-card p-1">
            {([
              { key: "roster" as const, label: "Roster", icon: BadgeCheck, count: rosterSegmentsQuery.data?.total ?? null },
              { key: "pipeline" as const, label: "Recruiting pipeline", icon: Briefcase, count: null },
            ]).map((m) => {
              const Icon = m.icon;
              const isActive = crmView === m.key;
              return (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => { setCrmView(m.key); playSound("click"); }}
                  aria-pressed={isActive}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                    "focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]",
                    isActive ? "bg-primary/10 text-foreground ring-1 ring-primary/60" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {m.label}
                  {m.count !== null && (
                    <Badge variant="outline" className="h-4 px-1.5 text-[10px] font-bold tabular-nums">{m.count}</Badge>
                  )}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {crmView === "roster"
              ? "Canonical roster — every hired agent, segmented by what they are actually doing."
              : "Recruiting funnel — hired agents plus open applications, so counts here exceed team size by design."}
          </p>
        </div>

        {crmView === "roster" ? (
          <RosterPanel
            rows={rosterQuery.data ?? []}
            isLoading={rosterQuery.isLoading}
            isError={rosterQuery.isError}
            onRetry={() => { rosterQuery.refetch(); rosterSegmentsQuery.refetch(); }}
          />
        ) : (
        <>
        {bulkMode && (
          <div className="space-y-2">
            <BulkStageActions
              agents={filteredAgents.map(a => ({ id: a.id, name: a.name, onboardingStage: a.onboardingStage }))}
              selectedIds={selectedAgents} onSelectionChange={setSelectedAgents}
              onBulkUpdate={() => { fetchAgents(); setSelectedAgents(new Set()); }}
              isEnabled={bulkMode} onToggle={() => { setBulkMode(false); setSelectedAgents(new Set()); }}
            />
            {selectedAgents.size > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3 sm:p-4">
                <span className="mr-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">More actions</span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-10 gap-1.5 sm:h-8"
                  onClick={() => { setComposeChannel("email"); setComposeOpen(true); }}
                >
                  <Mail className="h-4 w-4 shrink-0" /> Compose Email
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-10 gap-1.5 sm:h-8"
                  onClick={() => { setComposeChannel("sms"); setComposeOpen(true); }}
                >
                  <Send className="h-4 w-4 shrink-0" /> Compose SMS
                </Button>
                {/* Was gated on VITE_ENABLE_CRM_BULK_DELETE, which defaults to
                    "false" in .env.example — so the control was invisible in
                    production and clearing house was impossible from the UI.
                    Bulk deactivation is reversible (rows stay, flags flip) and
                    already confirms before running, so admin is the right gate. */}
                {isAdmin && (
                  <Button
                    size="sm"
                    variant="destructive"
                    className="ml-auto h-10 gap-1.5 sm:h-8"
                    disabled={bulkDeleting}
                    onClick={handleBulkDelete}
                  >
                    <UserX className="h-4 w-4 shrink-0" />
                    <span className="tabular-nums">{bulkDeleting ? "Deactivating…" : `Deactivate (${selectedAgents.size})`}</span>
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        <GlassCard className="p-4">
          <div className="flex flex-col flex-wrap gap-2 sm:flex-row">
            <div className="relative min-w-0 flex-1 sm:min-w-[180px]">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 shrink-0 text-muted-foreground" />
              <Input placeholder="Search agents..." aria-label="Search agents by name or email" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="h-10 pl-9 text-sm sm:h-9" />
            </div>
            {isAdmin && managers.length > 0 && (
              <Select value={managerFilter} onValueChange={setManagerFilter}>
                <SelectTrigger aria-label="Filter by manager" className="h-10 w-full text-sm sm:h-9 sm:w-[140px]"><Filter className="mr-1.5 h-4 w-4 shrink-0 text-muted-foreground" /><SelectValue placeholder="All Managers" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Managers</SelectItem>
                  {managers.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <Select value={licenseFilter} onValueChange={setLicenseFilter}>
              <SelectTrigger aria-label="Filter by license status" className="h-10 w-full text-sm sm:h-9 sm:w-[130px]"><SelectValue placeholder="License" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All License</SelectItem>
                <SelectItem value="licensed">Licensed</SelectItem>
                <SelectItem value="unlicensed">Unlicensed</SelectItem>
              </SelectContent>
            </Select>
            <Select value={aiScoreFilter} onValueChange={setAiScoreFilter}>
              <SelectTrigger aria-label="Filter by AI score" className="h-10 w-full text-sm sm:h-9 sm:w-[120px]"><Sparkles className="mr-1 h-4 w-4 shrink-0 text-muted-foreground" /><SelectValue placeholder="AI Score" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Scores</SelectItem>
                <SelectItem value="hot">🔥 Hot</SelectItem>
                <SelectItem value="warm">☀️ Warm</SelectItem>
                <SelectItem value="cool">❄️ Cool</SelectItem>
                <SelectItem value="cold">🧊 Cold</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortMode} onValueChange={setSortMode}>
              <SelectTrigger aria-label="Sort rows" className="h-10 w-full text-sm sm:h-9 sm:w-[160px]"><SelectValue placeholder="Sort" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Default order</SelectItem>
                <SelectItem value="alp_desc">Highest ALP</SelectItem>
                <SelectItem value="newest">Newest</SelectItem>
                <SelectItem value="stalest">Most Stale</SelectItem>
                <SelectItem value="needs_followup">Needs Follow-Up</SelectItem>
                <SelectItem value="by_stage">By Stage</SelectItem>
              </SelectContent>
            </Select>
            <Button variant={showDeactivated ? "secondary" : "outline"} size="sm" aria-pressed={showDeactivated} onClick={() => setShowDeactivated(!showDeactivated)} className="h-10 gap-1.5 sm:h-9">
              <UserX className="h-4 w-4 shrink-0" /> {showDeactivated ? "Deactivated ✓" : "Deactivated"}
            </Button>
            <Button variant={showInactive ? "secondary" : "outline"} size="sm" aria-pressed={showInactive} onClick={() => setShowInactive(!showInactive)} className="h-10 gap-1.5 sm:h-9">
              <Eye className="h-4 w-4 shrink-0" /> {showInactive ? "Inactive ✓" : "Inactive"}
            </Button>
            {activeFilterCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearAllFilters}
                className="h-10 gap-1.5 text-muted-foreground hover:text-foreground sm:ml-auto sm:h-9"
              >
                <X className="h-4 w-4 shrink-0" />
                Clear filters
                <Badge variant="secondary" className="ml-1 h-4 px-1.5 text-[10px] font-bold tabular-nums">
                  {activeFilterCount}
                </Badge>
              </Button>
            )}
          </div>
        </GlassCard>

        {loading ? (
          <GlassCard className="p-4">
            <div className="mb-3 h-4 w-40 animate-pulse rounded bg-muted/40" />
            <div className="space-y-2">
              {[...Array(8)].map((_, i) => (
                // stable-key-allow:skeleton — static Array(N) decorative loader, no reorder
                <div key={i} className="h-[64px] animate-pulse rounded-lg bg-muted/30" />
              ))}
            </div>
          </GlassCard>
        ) : (
          <>
          <Tabs value={activeStageTab} onValueChange={(v) => { setActiveStageTab(v); playSound("click"); }} className="space-y-3">
            {/* Segment chips. One scroll rail on phones so twelve chips never
                wrap into six rows and never push the page body sideways. */}
            <div className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
              <TabsList className="flex h-auto min-w-max justify-start gap-1.5 rounded-lg border border-border bg-card p-1.5">
                {SECTIONS.map(section => {
                  const count = (agentsBySection.get(section.key) ?? []).length;
                  const Icon = section.icon;
                  return (
                    <TabsTrigger
                      key={section.key}
                      value={section.key}
                      className={cn(
                        "shrink-0 gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors",
                        "hover:bg-muted/60 hover:text-foreground",
                        "data-[state=active]:bg-primary/10 data-[state=active]:text-foreground",
                        "data-[state=active]:ring-1 data-[state=active]:ring-primary/60",
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {section.label}
                      <Badge
                        variant="outline"
                        className="h-4 px-1.5 text-[10px] font-bold tabular-nums"
                      >
                        {count}
                      </Badge>
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </div>

            {SECTIONS.map(section => {
              const sectionAgents = agentsBySection.get(section.key) ?? [];
              const SectionIcon = section.icon;

              return (
                <TabsContent key={section.key} value={section.key}>
                  <GlassCard className="overflow-hidden p-4">
                    <div className="mb-1 flex items-baseline justify-between gap-2">
                      <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
                        <SectionIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{section.label}</span>
                      </h3>
                      <span className="shrink-0 text-sm font-bold tabular-nums text-muted-foreground">
                        {sectionAgents.length}
                      </span>
                    </div>
                    <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
                      {section.desc}
                    </p>
                  {sectionAgents.length === 0 ? (
                    <EmptyState
                      icon={<Users className="h-7 w-7" />}
                      variant={agents.length === 0 ? "warning" : "default"}
                      title={agents.length === 0 ? "No active agents fetched" : "No agents match this stage and filter set"}
                      description={
                        agents.length === 0
                          ? "The roster query came back with nothing — hit Refresh, or check that this view is loading for your role."
                          : "The segment itself may be clear, or the filters may be too tight. Clear them to see who really sits here."
                      }
                      actions={agents.length > 0 ? (
                        <Button variant="outline" size="sm" className="h-10 sm:h-9" onClick={clearAllFilters}>
                          Clear filters
                        </Button>
                      ) : undefined}
                    />
                  ) : (
                    // The table's own wrapper supplies overflow-auto; -mx-4 lets that
                    // scroll rail bleed to the card edge on a phone and inset on sm+.
                    // The PAGE body never scrolls sideways.
                    <div className="-mx-4 sm:mx-0">
                      <Table className="min-w-[900px]">
                        <TableHeader>
                          <TableRow className="border-b border-border hover:bg-transparent [&_th]:h-9 [&_th]:text-[10px] [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-muted-foreground">
                            {bulkMode && <TableHead className="w-8 px-2" />}
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
                                    "cursor-pointer border-b border-border/60 transition-colors hover:bg-muted/30",
                                    isExpanded && "bg-muted/40",
                                    isStaleAgent(agent) && !isExpanded && "border-l-2 border-l-rose-500/50 bg-rose-500/[0.05] hover:bg-rose-500/10",
                                    agent.isDeactivated && "opacity-50"
                                  )}
                                  onClick={() => { setExpandedAgentId(isExpanded ? null : agent.id); playSound(isExpanded ? "click" : "whoosh"); }}
                                >
                                  {bulkMode && (
                                    <TableCell className="px-2 py-2" onClick={e => e.stopPropagation()}>
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
                                  <TableCell className="px-2 py-2">
                                    <div className="flex min-w-0 items-center gap-2">
                                      <div className="relative shrink-0">
                                        <AgentAvatar avatarUrl={getAvatarUrl(agent.avatarUrl)} name={agent.name} size="sm" className="shadow-sm ring-2 ring-background" />
                                        {isStaleAgent(agent) && (
                                          <div className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-rose-500" />
                                        )}
                                      </div>
                                      <div className="min-w-0">
                                        {/* 2026-06-15 — clickable name opens AgentProfileDrawer in-place */}
                                        <p className="truncate text-sm font-medium text-foreground">
                                          <AgentNameLink agentId={agent.id}>{agent.name}</AgentNameLink>
                                        </p>
                                        <div className="mt-0.5 flex flex-wrap items-center gap-1">
                                          {duplicateAgentIds.has(agent.id) && <Badge variant="outline" className="h-4 border-amber-500/20 bg-amber-500/10 px-1 text-[10px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400">Dupe</Badge>}
                                          {!agent.avatarUrl && <Badge variant="outline" className="h-4 border-rose-500/20 bg-rose-500/10 px-1 text-[10px] font-bold uppercase tracking-wide text-rose-600 dark:text-rose-400">📷 Photo</Badge>}
                                          {agent.aiScoreTier && (
                                            <Badge variant="outline" className={cn("h-4 px-1 text-[10px] font-bold uppercase tracking-wide", {
                                              "border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-400": agent.aiScoreTier === "hot",
                                              "border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400": agent.aiScoreTier === "warm",
                                              "bg-muted text-muted-foreground": agent.aiScoreTier === "cool" || agent.aiScoreTier === "cold",
                                            })}>
                                              {agent.aiScoreTier === "hot" ? "🔥" : agent.aiScoreTier === "warm" ? "☀️" : agent.aiScoreTier === "cool" ? "❄️" : "🧊"} {agent.aiScoreTier}
                                            </Badge>
                                          )}
                                          {agent.managerId && agent.managerName && agent.managerId !== currentAgentId && (
                                            <Badge variant="outline" className="h-4 max-w-[96px] truncate px-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{agent.managerName.split(" ")[0]}</Badge>
                                          )}
                                        </div>
                                        <p className="truncate text-[11px] text-muted-foreground">{agent.email}</p>
                                        {agent.phone && <p className="cursor-text select-all truncate text-[11px] tabular-nums text-muted-foreground" onClick={e => e.stopPropagation()}>{agent.phone}</p>}
                                      </div>
                                    </div>
                                  </TableCell>
                                  {getTableCells(section.key, agent)}
                                  <TableCell className="px-2 py-2">
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
                  </GlassCard>
                </TabsContent>
              );
            })}
          </Tabs>


          </>
        )}
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
