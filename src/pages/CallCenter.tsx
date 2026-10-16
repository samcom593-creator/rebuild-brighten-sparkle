import { useState, useCallback, useEffect, useRef, useMemo, type ComponentProps } from "react";
import { AnimatePresence } from "framer-motion";
import { Phone, CheckCircle2, Sparkles, Instagram, Mail, PhoneCall, ListChecks, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { QueryState } from "@/components/ui/query-state";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useAgentIdentity } from "@/hooks/useAgentIdentity";
import { errorMessage, formatAsOf } from "@/lib/queryState";
import {
  EMPTY_COVERAGE,
  EMPTY_NOTE_DRAFT,
  QUEUE_PAGE_SIZE,
  SOURCE_NOT_REQUESTED,
  agedLeadQueueOps,
  appendNoteEntry,
  appendQueuePage,
  applicationQueueOps,
  applyFilterOps,
  asSentence,
  buildNoteEntry,
  classifyFollowUpResponse,
  combineCoverage,
  coverageLabel,
  cursorFromPage,
  discardNoteDraft,
  followUpKey,
  followUpToast,
  isUnattributed,
  keysetOps,
  markDraftSaved,
  mineFilterBlockedReason,
  nextHasMore,
  noteLanded,
  noteLockFits,
  pageHasMore,
  queueAccessMessage,
  recordTranscript,
  remainingLabel,
  resolveQueueAccess,
  sortQueueRows,
  zeroRowVerdict,
  type FollowUpOutcome,
  type FollowUpToast,
  type NoteDraft,
  type QueueAccess,
  type QueueCoverage,
  type QueueCursor,
  sinceIsoForRange,
  type QueuePreviewPlans,
} from "@/lib/callCenterQueue";
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
import { createCanonicalHire, promoteApplicationToAgent, type HireReceipt } from "@/lib/hireToOnboarding";
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
  /** created_at as stored, for queue order: undated rows sort last, as the server pages them. */
  queuedAt: string | null;
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

// Raw rows as the two source queries return them. Typed here so the mapping
// below is checked instead of cast to any.
interface AgedLeadRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  instagram_handle: string | null;
  notes: string | null;
  motivation: string | null;
  license_status: string | null;
  created_at: string | null;
  status: string | null;
  contacted_at: string | null;
  last_contacted_at: string | null;
  assigned_manager_id: string | null;
  agents: { display_name: string | null } | null;
}

interface ApplicationRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  instagram_handle: string | null;
  notes: string | null;
  license_status: string | null;
  license_progress: string | null;
  test_scheduled_date: string | null;
  created_at: string | null;
  status: string | null;
  contacted_at: string | null;
  last_contacted_at: string | null;
  previous_company: string | null;
  nipr_number: string | null;
  licensed_states: string[] | null;
  city: string | null;
  state: string | null;
  availability: string | null;
  assigned_agent_id: string | null;
  hiring_manager_user_id: string | null;
  referral_manager_id: string | null;
  recruiter_id: string | null;
  terminated_at: string | null;
  contracted_at: string | null;
  closed_at: string | null;
  agents: { display_name: string | null } | null;
}

const AGED_LEAD_SELECT =
  "id, first_name, last_name, email, phone, instagram_handle, notes, motivation, license_status, created_at, status, contacted_at, last_contacted_at, assigned_manager_id, agents!aged_leads_assigned_manager_id_fkey(display_name)";

// recruiter_id is selected so the badge and the no_referrer filter can share
// one definition of "credited" (F07).
const APPLICATION_SELECT =
  "id, first_name, last_name, email, phone, instagram_handle, notes, license_status, license_progress, test_scheduled_date, created_at, status, contacted_at, last_contacted_at, previous_company, nipr_number, licensed_states, city, state, availability, assigned_agent_id, hiring_manager_user_id, referral_manager_id, recruiter_id, terminated_at, contracted_at, closed_at, agents!applications_assigned_agent_id_fkey(display_name)";

function mapAgedLead(lead: AgedLeadRow): UnifiedLead {
  return {
    id: lead.id,
    source: "aged_leads",
    firstName: lead.first_name ?? "",
    lastName: lead.last_name || undefined,
    email: lead.email ?? "",
    phone: lead.phone || undefined,
    instagramHandle: lead.instagram_handle || undefined,
    notes: lead.notes || undefined,
    motivation: lead.motivation || undefined,
    licenseStatus: lead.license_status || "unknown",
    createdAt: lead.created_at || new Date().toISOString(),
    queuedAt: lead.created_at ?? null,
    status: lead.status || "new",
    contactedAt: lead.contacted_at || undefined,
    lastContactedAt: lead.last_contacted_at || undefined,
    assignedManagerName: lead.agents?.display_name || undefined,
  };
}

function mapApplication(app: ApplicationRow): UnifiedLead {
  return {
    id: app.id,
    source: "applications",
    firstName: app.first_name ?? "",
    lastName: app.last_name || undefined,
    email: app.email ?? "",
    phone: app.phone || undefined,
    instagramHandle: app.instagram_handle || undefined,
    notes: app.notes || undefined,
    motivation: app.notes || undefined,
    licenseStatus: app.license_status || "unknown",
    licenseProgress: app.license_progress || null,
    testScheduledDate: app.test_scheduled_date || null,
    createdAt: app.created_at || new Date().toISOString(),
    queuedAt: app.created_at ?? null,
    status: app.status || "new",
    contactedAt: app.contacted_at || undefined,
    lastContactedAt: app.last_contacted_at || undefined,
    previousCompany: app.previous_company || undefined,
    niprNumber: app.nipr_number || undefined,
    licensedStates: app.licensed_states || undefined,
    city: app.city || undefined,
    state: app.state || undefined,
    availability: app.availability || undefined,
    assignedManagerName: app.agents?.display_name || undefined,
    // Unattributed only when every attribution column is empty: the same
    // test the no_referrer filter runs on the server (F07).
    hasNoReferrer: isUnattributed(app),
  };
}

function leadDisplayName(lead: UnifiedLead): string {
  return `${lead.firstName ?? ""} ${lead.lastName ?? ""}`.trim() || "this lead";
}

function showFollowUpToast(t: FollowUpToast) {
  const options = { description: t.description, duration: t.level === "error" ? 10000 : 6000 };
  if (t.level === "success") toast.success(t.title, options);
  else if (t.level === "error") toast.error(t.title, options);
  else toast.info(t.title, options);
}

// functions.invoke wraps a non-2xx answer in FunctionsHttpError whose context
// is the Response. The function writes its reason into that body.
async function readInvokeErrorBody(error: unknown): Promise<unknown> {
  const context = (error as { context?: unknown } | null)?.context;
  if (typeof Response === "undefined" || !(context instanceof Response)) return null;
  try {
    return await context.clone().json();
  } catch {
    return null;
  }
}

/** The HTTP status of a non-2xx functions.invoke answer; null when there was no answer. */
function invokeErrorStatus(error: unknown): number | null {
  const context = (error as { context?: unknown } | null)?.context;
  if (typeof Response === "undefined" || !(context instanceof Response)) return null;
  return context.status;
}

/** The four pre-start states F02 asks for: loading, no identity, blocked, ready. */
function QueueAccessNotice({ access, onRetry }: { access: QueueAccess; onRetry: () => void }) {
  const body = queueAccessNoticeBody(access, onRetry);
  if (!body) return null;
  return <div className="container mx-auto max-w-4xl px-4 pt-6">{body}</div>;
}

function queueAccessNoticeBody(access: QueueAccess, onRetry: () => void) {
  if (access.kind === "loading") {
    return <QueryState status="loading" label="your Call Center access" compact />;
  }
  if (access.kind === "error") {
    return <QueryState status="error" label="your agent record" error={access.message} onRetry={onRetry} />;
  }
  if (access.kind === "ambiguous" || access.kind === "no_identity") {
    const message = queueAccessMessage(access);
    return <QueryState status="empty" title={message?.title} body={message?.body} />;
  }
  if (access.identityError) {
    return (
      <QueryState
        status="error"
        label="your agent record"
        error={`${access.identityError} You can still dial under your staff role; hires and contracts need the record.`}
        onRetry={onRetry}
        compact
      />
    );
  }
  if (access.staffWithoutAgentRow) {
    return (
      <p role="status" className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        Working as staff: the queue is what your role may see on the server. Hires and contracts need an agent record linked to this login.
      </p>
    );
  }
  if (access.identityNote) {
    return (
      <p role="status" className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        {access.identityNote}
      </p>
    );
  }
  return null;
}

type QueueLoad = { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready" };

type SourceKey = "aged" | "apps";

type CoverageBySource = Record<SourceKey, QueueCoverage>;

const NO_COVERAGE: CoverageBySource = { aged: EMPTY_COVERAGE, apps: EMPTY_COVERAGE };

interface SourceLoad {
  rows: UnifiedLead[];
  pageLength: number;
  cursor: QueueCursor | null;
  total: number | null;
  countError: string | null;
  remaining: number | null;
}

const SOURCE_SKIPPED: SourceLoad = { rows: [], pageLength: 0, cursor: null, total: 0, countError: null, remaining: 0 };

const NOTE_WRITE_ATTEMPTS = 3;

type SaveNotesResult = { ok: true; notes: string } | { ok: false; message: string };

/** The lead a draft of call notes belongs to. */
interface NoteTarget {
  id: string;
  source: UnifiedLead["source"];
  name: string;
}

interface LeadNoteDraft {
  target: NoteTarget;
  draft: NoteDraft;
}

function noteTargetOf(lead: UnifiedLead): NoteTarget {
  return { id: lead.id, source: lead.source, name: leadDisplayName(lead) };
}

type HeadCount = { count: number | null; error: string | null };

function headCount({ count, error }: { count: number | null; error: unknown }): HeadCount {
  if (error) return { count: null, error: errorMessage(error) };
  return { count: typeof count === "number" ? count : null, error: null };
}

type ContractedProgress = ComponentProps<typeof ContractedModal>["application"]["license_progress"];

/** Admin-only opt-in for closed records (F06). Off by default; do-not-contact and bad numbers stay out regardless. */
function IncludeClosedToggle({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="container mx-auto max-w-4xl px-4 pt-4">
      <div className="flex items-start gap-3 rounded-md border border-border bg-muted/40 px-3 py-2">
        <Switch
          id="call-center-include-closed"
          checked={checked}
          onCheckedChange={onChange}
          aria-describedby="call-center-include-closed-help"
          className="mt-0.5"
        />
        <div className="min-w-0">
          <Label htmlFor="call-center-include-closed" className="text-sm font-medium text-foreground">
            Include closed records
          </Label>
          <p id="call-center-include-closed-help" className="mt-1 text-xs text-muted-foreground">
            Off by default. Turn it on to add hired, contracted, terminated, not-a-fit and closed-lost leads to this
            session. Do-not-contact leads and bad numbers stay out either way.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function CallCenter() {
  const { isAdmin, isVa, isVaManager, isRecruiter, user, profile, isLoading: rolesLoading } = useAuth();
  const me = useAgentIdentity();
  const refetchIdentity = me.refetch;
  const { playSound } = useSoundEffects();
  const [leads, setLeads] = useState<UnifiedLead[]>([]);
  // The latest leads, for decisions made after an await. Every change goes
  // through updateLeads, so this never lags the state.
  const leadsRef = useRef<UnifiedLead[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [queueLoad, setQueueLoad] = useState<QueueLoad>({ kind: "idle" });
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  // Each reset starts a generation; a load that settles after a newer reset is dropped.
  const loadGenerationRef = useRef(0);
  const [coverage, setCoverage] = useState<CoverageBySource>(NO_COVERAGE);
  const coverageRef = useRef<CoverageBySource>(NO_COVERAGE);
  const [countedAt, setCountedAt] = useState<number | null>(null);
  const cursorsRef = useRef<Record<SourceKey, QueueCursor | null>>({ aged: null, apps: null });
  const [processing, setProcessing] = useState(false);
  // Held from the start of an action until it settles (F04). State lags a
  // render, so a second key press in the same tick reads this instead.
  const busyRef = useRef(false);
  const [started, setStarted] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  // Unsaved call notes, per lead (F04). A ref rather than state: every save in
  // one async chain reads and clears the same draft, so nothing is written
  // twice and nothing rides along to the next lead.
  const draftsRef = useRef<Map<string, LeadNoteDraft>>(new Map());
  // The lead each dialog acts on, fixed when it opens, so the queue moving
  // underneath cannot change who is hired or contracted.
  const [contractLead, setContractLead] = useState<UnifiedLead | null>(null);
  const [hireLead, setHireLead] = useState<UnifiedLead | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const confettiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (confettiTimerRef.current) clearTimeout(confettiTimerRef.current); }, []);
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
  // Closed records are a choice an admin makes, never a side effect of being
  // an admin (F06).
  const [includeClosed, setIncludeClosed] = useState(false);
  // MP-260 detail drawer for row-tap → expanded context (applications only).
  const [detailAppId, setDetailAppId] = useState<string | null>(null);

  const currentLead = leads[currentIndex];
  const totalLeads = leads.length;
  const processedCount = currentIndex;

  // Who may dial and under which scope (F02, F17). The agents row comes from
  // the shared resolver, never from .maybeSingle() on user_id, and a staff
  // role is enough: RLS already bounds what a VA or VA manager can read and
  // update, so no producer record has to be manufactured for them.
  const access = useMemo(
    () => resolveQueueAccess({ rolesLoading, isAdmin, isVa, isVaManager, isRecruiter, identity: me.identity }),
    [rolesLoading, isAdmin, isVa, isVaManager, isRecruiter, me.identity],
  );
  const agentId = access.kind === "ready" ? access.agentId : null;
  const identityError = access.kind === "ready" ? access.identityError : null;
  const closedIncluded = access.kind === "ready" && access.mayIncludeClosed && includeClosed;

  // The filter screen's preview counts exactly what Start Calling will load:
  // the same plans, scope and closed-records switch as loadQueue (F06).
  const previewPlans = useMemo<QueuePreviewPlans | null>(() => {
    if (access.kind !== "ready") return null;
    if (refererFilter === "mine" && !access.agentId) return null;
    const dateSinceIso = sinceIsoForRange(dateRangeFilter, Date.now());
    const wantAged = sourceFilter === "all" || sourceFilter === "aged_leads";
    const wantApps = sourceFilter === "all" || sourceFilter === "applications";
    return {
      aged: wantAged
        ? agedLeadQueueOps({ statusFilter, licenseFilter, dateSinceIso, ownerFilter, scopeAgentId: access.scopeAgentId, includeClosed: closedIncluded })
        : null,
      apps: wantApps
        ? applicationQueueOps({
            statusFilter,
            licenseFilter,
            progressFilter,
            dateSinceIso,
            stateFilter,
            ownerFilter,
            refererFilter,
            identityAgentId: access.agentId,
            scopeAgentId: access.scopeAgentId,
            includeClosed: closedIncluded,
          })
        : null,
    };
  }, [access, refererFilter, dateRangeFilter, sourceFilter, statusFilter, licenseFilter, ownerFilter, progressFilter, stateFilter, closedIncluded]);

  const updateLeads = useCallback((next: (prev: UnifiedLead[]) => UnifiedLead[]) => {
    leadsRef.current = next(leadsRef.current);
    setLeads(leadsRef.current);
  }, []);

  const commitCoverage = useCallback((next: CoverageBySource) => {
    coverageRef.current = next;
    setCoverage(next);
  }, []);

  /**
   * Load the first page of each requested source ("reset") or the next page
   * behind the last loaded row ("more"). One filter plan per source feeds the
   * exact count, the page and the count of rows past the page, so the header
   * and Load more describe one set of filters (F06). A failed read is an
   * error with Retry, never an empty queue.
   */
  const loadQueue = useCallback(async (mode: "reset" | "more") => {
    if (access.kind !== "ready") return;
    if (mode === "more" && loadingMoreRef.current) return;
    const { agentId: identityAgentId, scopeAgentId } = access;
    const generation = mode === "reset" ? ++loadGenerationRef.current : loadGenerationRef.current;

    if (mode === "reset") {
      // A new session starts empty: nothing from the last one may sit in the
      // header or on screen while this loads, or next to its error.
      cursorsRef.current = { aged: null, apps: null };
      commitCoverage(NO_COVERAGE);
      setCountedAt(null);
      updateLeads(() => []);
      setCurrentIndex(0);
    }

    if (refererFilter === "mine" && !identityAgentId) {
      if (mode === "reset") setQueueLoad({ kind: "error", message: mineFilterBlockedReason(access.identityError) });
      return;
    }

    // MP-260 shared date-range gate. `all` means no lower bound. The preview
    // on the filter screen uses the same helper.
    const dateSinceIso = sinceIsoForRange(dateRangeFilter, Date.now());

    const wantAged = sourceFilter === "all" || sourceFilter === "aged_leads";
    const wantApps = sourceFilter === "all" || sourceFilter === "applications";
    const ascending = sortOrder === "oldest_first";
    const prior = coverageRef.current;

    if (mode === "reset") {
      setQueueLoad({ kind: "loading" });
    } else {
      loadingMoreRef.current = true;
      setLoadingMore(true);
    }

    const loadAged = async (): Promise<SourceLoad> => {
      const plan = agedLeadQueueOps({ statusFilter, licenseFilter, dateSinceIso, ownerFilter, scopeAgentId, includeClosed: closedIncluded });
      const after = mode === "more" ? cursorsRef.current.aged : null;
      const skipPage = mode === "more" && !prior.aged.hasMore;
      const [page, total] = await Promise.all([
        skipPage
          ? Promise.resolve([] as AgedLeadRow[])
          : applyFilterOps(supabase.from("aged_leads").select(AGED_LEAD_SELECT), [...plan, ...keysetOps(after, sortOrder)])
              .order("created_at", { ascending, nullsFirst: false })
              .order("id", { ascending })
              .limit(QUEUE_PAGE_SIZE)
              .then(({ data, error }) => {
                if (error) throw error;
                return (data ?? []) as unknown as AgedLeadRow[];
              }),
        applyFilterOps(supabase.from("aged_leads").select("id", { count: "exact", head: true }), plan).then(headCount),
      ]);
      const cursor = cursorFromPage(page) ?? after;
      // Counting what sits past the page is the honest answer to "is there
      // more"; a full page alone can be the last one.
      const remaining =
        pageHasMore(page.length) && cursor
          ? await applyFilterOps(supabase.from("aged_leads").select("id", { count: "exact", head: true }), [...plan, ...keysetOps(cursor, sortOrder)]).then(headCount)
          : { count: 0, error: null };
      return { rows: page.map(mapAgedLead), pageLength: page.length, cursor, total: total.count, countError: total.error, remaining: remaining.count };
    };

    const loadApps = async (): Promise<SourceLoad> => {
      const plan = applicationQueueOps({
        statusFilter,
        licenseFilter,
        progressFilter,
        dateSinceIso,
        stateFilter,
        ownerFilter,
        refererFilter,
        identityAgentId,
        scopeAgentId,
        includeClosed: closedIncluded,
      });
      const after = mode === "more" ? cursorsRef.current.apps : null;
      const skipPage = mode === "more" && !prior.apps.hasMore;
      const [page, total] = await Promise.all([
        skipPage
          ? Promise.resolve([] as ApplicationRow[])
          : applyFilterOps(supabase.from("applications").select(APPLICATION_SELECT), [...plan, ...keysetOps(after, sortOrder)])
              .order("created_at", { ascending, nullsFirst: false })
              .order("id", { ascending })
              .limit(QUEUE_PAGE_SIZE)
              .then(({ data, error }) => {
                if (error) throw error;
                return (data ?? []) as unknown as ApplicationRow[];
              }),
        applyFilterOps(supabase.from("applications").select("id", { count: "exact", head: true }), plan).then(headCount),
      ]);
      const cursor = cursorFromPage(page) ?? after;
      const remaining =
        pageHasMore(page.length) && cursor
          ? await applyFilterOps(supabase.from("applications").select("id", { count: "exact", head: true }), [...plan, ...keysetOps(cursor, sortOrder)]).then(headCount)
          : { count: 0, error: null };
      return { rows: page.map(mapApplication), pageLength: page.length, cursor, total: total.count, countError: total.error, remaining: remaining.count };
    };

    try {
      const [aged, apps] = await Promise.all([
        wantAged ? loadAged() : Promise.resolve(SOURCE_SKIPPED),
        wantApps ? loadApps() : Promise.resolve(SOURCE_SKIPPED),
      ]);
      // A newer reset owns the screen now.
      if (generation !== loadGenerationRef.current) return;
      // Each page is sorted on its own and appended behind what is loaded, so
      // the lead on screen never moves when the next page arrives.
      const pageRows = sortQueueRows([...aged.rows, ...apps.rows], sortOrder);
      cursorsRef.current = { aged: aged.cursor, apps: apps.cursor };
      const base = mode === "reset" ? NO_COVERAGE : coverageRef.current;
      const nextCoverage = (prev: QueueCoverage, src: SourceLoad, wanted: boolean): QueueCoverage =>
        wanted
          ? {
              loaded: prev.loaded + src.pageLength,
              total: src.total,
              countError: src.countError,
              remaining: src.remaining,
              hasMore: nextHasMore(src.pageLength, src.cursor, src.remaining),
            }
          : SOURCE_NOT_REQUESTED;
      commitCoverage({ aged: nextCoverage(base.aged, aged, wantAged), apps: nextCoverage(base.apps, apps, wantApps) });
      setCountedAt(Date.now());
      if (mode === "reset") {
        updateLeads(() => pageRows);
        setCurrentIndex(0);
        setQueueLoad({ kind: "ready" });
      } else {
        updateLeads((prev) => appendQueuePage(prev, pageRows));
        if (pageRows.length === 0) toast.info("No further leads came back for these filters");
      }
    } catch (error) {
      if (generation !== loadGenerationRef.current) return;
      const message = errorMessage(error, "The dial queue could not load.");
      if (mode === "reset") {
        updateLeads(() => []);
        setQueueLoad({ kind: "error", message });
      } else {
        toast.error("More leads could not load", { description: message });
      }
      playSound("error");
    } finally {
      if (mode === "more") {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [access, closedIncluded, sourceFilter, licenseFilter, statusFilter, progressFilter, sortOrder, refererFilter, dateRangeFilter, ownerFilter, stateFilter, playSound, updateLeads, commitCoverage]);

  // A toast action outlives the render that made it, so it calls the latest loader.
  const loadQueueRef = useRef(loadQueue);
  useEffect(() => {
    loadQueueRef.current = loadQueue;
  }, [loadQueue]);

  const combinedCoverage = combineCoverage([coverage.aged, coverage.apps]);

  const handleStartCalling = () => {
    const blocked = queueAccessMessage(access);
    if (blocked) {
      toast.error(blocked.title, { description: blocked.body });
      playSound("error");
      return;
    }
    if (refererFilter === "mine" && !agentId) {
      // Refused here rather than opening a session that can only show this.
      toast.error("The Mine filter cannot run for this login", {
        description: mineFilterBlockedReason(identityError),
        ...(identityError ? { action: { label: "Retry", onClick: () => refetchIdentity() } } : {}),
      });
      playSound("error");
      return;
    }
    // Drafts that were saved or discarded have nothing left to keep.
    for (const [leadId, entry] of Array.from(draftsRef.current.entries())) {
      if (!entry.draft.pending.trim()) draftsRef.current.delete(leadId);
    }
    playSound("click");
    setStarted(true);
    void loadQueue("reset");
  };

  // One operation id per (lead, action, message) send attempt, kept until the
  // provider accepts, so a retry carries the same id. send-post-call-followup
  // does not dedupe on it yet; until it does, a retry is a second message and
  // the toast says so.
  const followUpOperationIds = useRef<Map<string, string>>(new Map());
  const followUpInFlight = useRef<Set<string>>(new Set());

  /** Send the post-call follow-up and report what actually happened (F03). Never throws. */
  const sendFollowUpEmail = useCallback(
    async (lead: UnifiedLead, actionType: string = "hired", calendarLink?: string): Promise<FollowUpOutcome> => {
      const key = followUpKey(lead.source, lead.id, actionType, calendarLink);
      if (followUpInFlight.current.has(key)) return { kind: "in_flight" };
      let operationId = followUpOperationIds.current.get(key);
      if (!operationId) {
        operationId =
          typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
        followUpOperationIds.current.set(key, operationId);
      }
      followUpInFlight.current.add(key);
      try {
        const result = await supabase.functions.invoke("send-post-call-followup", {
          // The function reads name, email and licence status off this row
          // (PL-WIB-POST-CALL-RELAY); it no longer accepts a recipient.
          body: {
            leadId: lead.id,
            leadSource: lead.source,
            actionType,
            agentId,
            operationId,
            ...(calendarLink ? { calendarLink } : {}),
          },
        });
        const errorBody = result.error ? await readInvokeErrorBody(result.error) : null;
        const outcome = classifyFollowUpResponse(result, errorBody, result.error ? invokeErrorStatus(result.error) : null);
        if (outcome.kind === "accepted") followUpOperationIds.current.delete(key);
        return outcome;
      } catch (err) {
        return { kind: "failed", message: errorMessage(err, "The follow-up request could not be sent."), permanent: false };
      } finally {
        followUpInFlight.current.delete(key);
      }
    },
    [agentId],
  );

  // Manual follow-up email from the summary panel. The recorder marks its
  // button green only when this resolves, so anything but an accepted send
  // throws after the honest toast.
  const handleSendFollowUp = useCallback(async (calendarLink?: string) => {
    if (!currentLead) return;
    const outcome = await sendFollowUpEmail(currentLead, "contacted", calendarLink);
    const t = followUpToast(outcome, leadDisplayName(currentLead));
    showFollowUpToast(t);
    if (outcome.kind !== "accepted") {
      playSound("error");
      throw new Error(t.title);
    }
    playSound("success");
  }, [currentLead, sendFollowUpEmail, playSound]);

  const noteAuthor = profile?.full_name?.trim() || user?.email || null;

  /**
   * Append call notes to a lead's notes on the server (F04). The text is
   * re-read right before the write so the append lands on the server's
   * current notes, not the copy loaded when the queue started, and the write
   * is guarded: on applications by the trigger-kept updated_at, on aged_leads
   * (no updated_at) by the notes text itself. A guarded write that matches no
   * row is re-read: a moved guard is a concurrent editor and the append is
   * retried on the fresh text; an unchanged one is a refusal. The write is
   * verified from the returned row. Any failure is reported; the caller keeps
   * the draft.
   */
  const saveNotes = useCallback(async (target: NoteTarget, draft: string): Promise<SaveNotesResult> => {
    const entry = buildNoteEntry(draft, new Date().toISOString(), noteAuthor);
    const isApplication = target.source === "applications";
    const what = isApplication ? "applicant" : "lead";

    const readCurrent = async (): Promise<{ notes: string | null; guard: string | null } | null> => {
      if (isApplication) {
        const { data, error } = await supabase.from("applications").select("notes, updated_at").eq("id", target.id).limit(1);
        if (error) throw error;
        const row = (data ?? [])[0] as { notes: string | null; updated_at: string | null } | undefined;
        return row ? { notes: row.notes, guard: row.updated_at } : null;
      }
      const { data, error } = await supabase.from("aged_leads").select("notes").eq("id", target.id).limit(1);
      if (error) throw error;
      const row = (data ?? [])[0] as { notes: string | null } | undefined;
      return row ? { notes: row.notes, guard: row.notes } : null;
    };

    // The guarded append; null when it matched no row.
    const writeGuarded = async (next: string, guard: string | null): Promise<{ notes: string | null } | null> => {
      if (isApplication) {
        let q = supabase.from("applications").update({ notes: next } as never).eq("id", target.id);
        q = guard === null ? q.is("updated_at", null) : q.eq("updated_at", guard);
        const { data, error } = await q.select("notes");
        if (error) throw error;
        return ((data ?? [])[0] as { notes: string | null } | undefined) ?? null;
      }
      let q = supabase.from("aged_leads").update({ notes: next } as never).eq("id", target.id);
      q = guard === null ? q.is("notes", null) : q.eq("notes", guard);
      const { data, error } = await q.select("notes");
      if (error) throw error;
      return ((data ?? [])[0] as { notes: string | null } | undefined) ?? null;
    };

    try {
      // The guard of the last write that matched no row; undefined until one does.
      let missedGuard: string | null | undefined;
      for (let attempt = 0; ; attempt += 1) {
        const current = await readCurrent();
        if (!current) {
          return { ok: false, message: `This ${what} could not be read back from the server, so nothing was written. Your note was kept.` };
        }
        if (missedGuard !== undefined && zeroRowVerdict(missedGuard, current.guard) === "refused") {
          return {
            ok: false,
            message: `The server would not update this ${what} (a permission limit, most likely), so nothing was written. Your note was kept.`,
          };
        }
        if (attempt >= NOTE_WRITE_ATTEMPTS) {
          return {
            ok: false,
            message: `Someone else saved this ${what} while you were typing, ${NOTE_WRITE_ATTEMPTS} times in a row, so nothing was written. Your note was kept; try again.`,
          };
        }
        if (!isApplication && !noteLockFits(current.notes)) {
          return {
            ok: false,
            message: "This lead's notes are too long to append safely from the Call Center, so nothing was written. Your note was kept.",
          };
        }
        const rowBack = await writeGuarded(appendNoteEntry(current.notes, entry), current.guard);
        if (!rowBack) {
          missedGuard = current.guard;
          continue;
        }
        if (!noteLanded(rowBack.notes, entry)) {
          return { ok: false, message: "The server answered without your note at the end of the text. Your note was kept." };
        }
        return { ok: true, notes: rowBack.notes ?? "" };
      }
    } catch (err) {
      return { ok: false, message: errorMessage(err, "The note could not be written.") };
    }
  }, [noteAuthor]);

  /** Fold the recorder's running transcript into that lead's draft. */
  const recordDraft = useCallback((target: NoteTarget, transcript: string) => {
    const prev = draftsRef.current.get(target.id);
    draftsRef.current.set(target.id, { target, draft: recordTranscript(prev?.draft ?? EMPTY_NOTE_DRAFT, transcript) });
  }, []);

  const discardDraft = useCallback((leadId: string) => {
    const entry = draftsRef.current.get(leadId);
    if (entry) draftsRef.current.set(leadId, { ...entry, draft: discardNoteDraft(entry.draft) });
  }, []);

  /**
   * Save every unsaved draft before anything moves (F04). Normally that is
   * the current lead's; words that arrive after their lead left the screen
   * are saved to that lead, never to the one now showing. True when nothing
   * was pending or everything saved; false after reporting a failure, with
   * the draft kept and a Discard action offered.
   */
  const flushDraftNotes = useCallback(async (consequence: string): Promise<boolean> => {
    for (const [leadId, entry] of Array.from(draftsRef.current.entries())) {
      const text = entry.draft.pending;
      if (!text.trim()) continue;
      const saved = await saveNotes(entry.target, text);
      if (saved.ok === false) {
        toast.error(`Call notes for ${entry.target.name} were NOT saved, so ${consequence}`, {
          description: saved.message,
          duration: 10000,
          action: { label: "Discard notes", onClick: () => discardDraft(leadId) },
        });
        playSound("error");
        return false;
      }
      const latest = draftsRef.current.get(leadId);
      if (latest) draftsRef.current.set(leadId, { ...latest, draft: markDraftSaved(latest.draft, text) });
      updateLeads((prev) => prev.map((l) => (l.id === leadId ? { ...l, notes: saved.notes } : l)));
    }
    return true;
  }, [saveNotes, discardDraft, playSound, updateLeads]);

  /**
   * One action at a time (F04). Every way of changing, removing or leaving
   * the current lead runs through here, so a second key press while notes
   * save is ignored instead of saving them twice or advancing twice.
   */
  const runExclusive = useCallback(async (task: () => Promise<void>): Promise<void> => {
    if (busyRef.current) return;
    busyRef.current = true;
    setProcessing(true);
    try {
      await task();
    } catch (error) {
      toast.error("That action did not finish", { description: errorMessage(error) });
      playSound("error");
    } finally {
      busyRef.current = false;
      setProcessing(false);
    }
  }, [playSound]);

  const celebrate = useCallback(() => {
    setShowConfetti(true);
    if (confettiTimerRef.current) clearTimeout(confettiTimerRef.current);
    confettiTimerRef.current = setTimeout(() => setShowConfetti(false), 3000);
  }, []);

  /** Move to the lead after `leadId`. False when it is the last loaded lead. */
  const advancePast = useCallback((leadId: string): boolean => {
    const list = leadsRef.current;
    const index = list.findIndex((l) => l.id === leadId);
    if (index === -1 || index >= list.length - 1) return false;
    setCurrentIndex(index + 1);
    return true;
  }, []);

  /** Take a lead out of the loaded queue; the lead after it moves up into its place. */
  const removeLead = useCallback((leadId: string) => {
    const index = leadsRef.current.findIndex((l) => l.id === leadId);
    if (index === -1) return;
    updateLeads((prev) => prev.filter((l) => l.id !== leadId));
    setCurrentIndex((prev) => (index < prev ? prev - 1 : prev));
  }, [updateLeads]);

  /** At the last loaded lead, say so, and offer the next page when one exists. */
  const lastLeadNotice = useCallback(() => {
    const current = combineCoverage([coverageRef.current.aged, coverageRef.current.apps]);
    if (current.hasMore) {
      toast.info("This is the last loaded lead", {
        description: remainingLabel(current),
        action: { label: "Load more", onClick: () => void loadQueueRef.current("more") },
      });
    } else {
      toast.info("You've reached the last lead");
    }
  }, []);

  /** After a lead leaves the queue: nothing loaded is left and nothing more matches. */
  const noticeIfAllProcessed = useCallback(() => {
    if (leadsRef.current.length > 0) return;
    if (combineCoverage([coverageRef.current.aged, coverageRef.current.apps]).hasMore) return;
    toast.info("All leads processed!");
  }, []);

  // MP-260 shared log_contact_attempt helper. Fire-and-forget so a 500
  // never blocks the disposition or auto-advance. Channel default = 'call'
  // since every disposition in the workflow implies a call attempt.
  const logContactAttempt = useCallback(
    (applicationId: string, outcome: string, channel: "call" | "sms" | "email" = "call") => {
      // MP-345: this used to swallow every failure. It was "fire-and-forget
      // telemetry", which sounds harmless until you check what actually landed:
      // application_contact_log holds 33 rows lifetime, and NOT ONE carries any
      // of the disposition outcomes this screen sends (no_pickup, not_a_fit,
      // needs_followup, reschedule_requested, contacted, hired, contracted).
      // Only "initiated" is there, 8 times. So the record of what happened on a
      // call has never been written, and the empty catch is precisely why
      // nobody found out.
      //
      // Still non-blocking — a logging failure must never stop the rep moving to
      // the next lead — but no longer silent. The RPC's own message is shown,
      // because "not_authorized: that recruit is not assigned to you" is a
      // different problem from a dropped connection and the rep can act on the
      // difference.
      Promise.resolve(
        supabase.rpc("log_contact_attempt" as any, {
          p_application_id: applicationId,
          p_channel: channel,
          p_outcome: outcome,
        }),
      )
        .then(({ error }: { error: { message?: string } | null }) => {
          if (error) {
            toast.error("Call outcome was NOT saved", {
              description: error.message ?? "The disposition did not reach the server.",
            });
          }
        })
        .catch((err: unknown) => {
          toast.error("Call outcome was NOT saved", {
            description: err instanceof Error ? err.message : "Network error reaching the server.",
          });
        });
    },
    [],
  );

  /**
   * Record a disposition on one lead and move the queue. The caller holds the
   * action lock and has already saved the call notes, so they are not saved
   * again here (F04). A refused or failed write is reported, and the queue
   * does not move. After a hire, a failure says the agent account exists.
   */
  const executeAction = useCallback(async (actionId: ActionId, lead: UnifiedLead, opts: { afterHire?: boolean } = {}): Promise<boolean> => {
    const failedTitle = opts.afterHire
      ? "The agent account was created, but this lead was not marked hired"
      : "The disposition was NOT saved";
    // .select("id") turns a write row security refused into zero rows instead
    // of a silent success.
    const refusedWrite = (what: string): boolean => {
      toast.error(failedTitle, {
        description: `The server would not update this ${what} (a permission limit, most likely), so the queue did not move.`,
        duration: 10000,
      });
      playSound("error");
      return false;
    };
    // Set when the server refused the phone-bad flag, so the toast below does
    // not claim the lead left the queue for good.
    let phoneFlagFailed = false;
    try {
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
      if (lead.source === "applications" && outcomeMap[actionId]) {
        logContactAttempt(lead.id, outcomeMap[actionId]);
      }

      if (lead.source === "aged_leads") {
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
          contacted_at: lead.contactedAt || nowIso,
          last_contacted_at: nowIso,
        };
        const { data, error } = await supabase
          .from("aged_leads")
          .update(patch as never)
          .eq("id", lead.id)
          .select("id");

        if (error) throw error;
        if (!data || data.length === 0) return refusedWrite("lead");
      } else {
        const nowIso = new Date().toISOString();
        const updateData: Record<string, string> = {
          contacted_at: lead.contactedAt || nowIso,
          last_contacted_at: nowIso,
        };

        if (actionId === "bad_applicant") {
          updateData.status = "rejected";
        } else if (actionId === "no_pickup") {
          updateData.status = "no_pickup";
        } else if (actionId === "contacted" || actionId === "needs_followup") {
          // "contacted" is not a member of application_status. Writing it made
          // PostgREST fail the whole request with 22P02, so both dispositions
          // threw and recorded nothing — proven against the live type on
          // 2026-08-29. Contact state is not a status on this table: this
          // payload already carries contacted_at/last_contacted_at, which is
          // exactly what every read-side filter uses to mean "contacted".
          // The one status worth touching is a stale no_pickup, because the
          // contacted filter excludes it and a lead we just reached would stay
          // invisible. Any other funnel stage is left alone.
          if (lead.status === "no_pickup") updateData.status = "reviewing";
          if (actionId === "needs_followup") {
            // Bump next-action to tomorrow so the follow-up cohort catches it.
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            (updateData as Record<string, unknown>).next_action_due_at = tomorrow.toISOString();
          }
        }

        const { data, error } = await supabase
          .from("applications")
          .update(updateData as never)
          .eq("id", lead.id)
          .select("id");

        if (error) throw error;
        if (!data || data.length === 0) return refusedWrite("applicant");

        // Bad number: phone_bad_at is what keeps the number out of every dial
        // queue (F06), so a failed flag is reported instead of swallowed.
        if (actionId === "bad_number") {
          const { error: flagError } = await supabase.rpc("unified_mark_phone_bad", {
            p_id: lead.id,
            p_source: "applied",
            p_reason: "call_center_marked_bad",
          });
          if (flagError) {
            phoneFlagFailed = true;
            toast.error("The bad number was NOT flagged on the server", {
              description: `${asSentence(errorMessage(flagError))} The lead can come back in the contacted queue.`,
              duration: 10000,
            });
          }
        }
      }

      // MP-260 outcome UX for new dispositions.
      if (actionId === "contacted") {
        toast.success("Marked contacted — advancing");
      } else if (actionId === "bad_number" && !phoneFlagFailed) {
        toast.warning("Bad number flagged — removed from queue");
      } else if (actionId === "needs_followup") {
        toast.success("Follow-up scheduled for tomorrow — advancing");
      }

      if (actionId === "hired") {
        const hiredFollowUp = await sendFollowUpEmail(lead, "hired");

        // Auto-send licensing instructions for unlicensed hires
        if (lead.licenseStatus === "unlicensed" || lead.licenseStatus === "unknown") {
          supabase.functions.invoke("send-licensing-instructions", {
            body: {
              email: lead.email,
              firstName: lead.firstName,
              licenseStatus: "unlicensed",
              agentId,
            },
          }).catch(err => console.error("Failed to send licensing instructions:", err));
        }

        // Notify all managers about the hire
        supabase.functions.invoke("notify-hire-announcement", {
          body: {
            hirerName: "Manager",
            hireeName: `${lead.firstName} ${lead.lastName || ""}`.trim(),
            actionType: "hired",
            agentId,
          },
        }).catch(err => console.error("Failed to send hire announcement:", err));

        celebrate();
        const hiredToast = followUpToast(hiredFollowUp, leadDisplayName(lead));
        if (hiredFollowUp.kind === "accepted") {
          toast.success("Lead marked as hired. Follow-up email accepted by the mail provider.", { description: hiredToast.description });
        } else {
          toast.success("Lead marked as hired");
          showFollowUpToast(hiredToast);
        }
        playSound("celebrate");
      } else if (actionId === "no_pickup") {
        // The "we tried calling you" email is reported when the provider
        // answers, never announced up front (F03).
        toast.info("Marked as no pickup. Sending the we-tried-calling email.");
        void sendFollowUpEmail(lead, "no_pickup").then((outcome) => {
          showFollowUpToast(followUpToast(outcome, leadDisplayName(lead)));
        });
      } else {
        toast.success(`Lead marked as ${actionId.replace("_", " ")}`);
        playSound("success");
      }

      // For no_pickup / contacted / needs_followup, don't remove from the
      // list — just advance so the caller can loop back later.
      const advanceOnly = actionId === "no_pickup" || actionId === "contacted" || actionId === "needs_followup";
      if (advanceOnly) {
        // Mirror what the write actually persisted. The old value showed
        // "contacted" on a row whose status the enum cannot hold, so the
        // optimistic state disagreed with the next refetch.
        const patchStatus = lead.source === "aged_leads"
          ? (actionId === "no_pickup" ? "no_pickup" : actionId)
          : actionId === "no_pickup"
            ? "no_pickup"
            : lead.status === "no_pickup"
              ? "reviewing"
              : lead.status;
        updateLeads((prev) => prev.map((l) => (l.id === lead.id ? { ...l, status: patchStatus } : l)));
        // Read from the latest queue, so a page loaded during this action
        // counts and the last lead before it is not reported as the end.
        if (!advancePast(lead.id)) lastLeadNotice();
      } else {
        removeLead(lead.id);
        noticeIfAllProcessed();
      }
      return true;
    } catch (error) {
      console.error("Error updating lead:", error);
      toast.error(failedTitle, { description: errorMessage(error), duration: 10000 });
      playSound("error");
      return false;
    }
  }, [logContactAttempt, sendFollowUpEmail, agentId, playSound, celebrate, updateLeads, advancePast, lastLeadNotice, removeLead, noticeIfAllProcessed]);

  const handleAction = useCallback((actionId: ActionId) => runExclusive(async () => {
    const lead = currentLead;
    if (!lead) return;

    // Contracting places the new agent under the caller's record, so a login
    // without one gets the reason instead of a modal that never mounts. A
    // record that failed to read is not the same as no record (F02).
    if (actionId === "contracted") {
      if (!agentId) {
        if (identityError) {
          toast.error("Your agent record could not be read, so contracting cannot start", {
            description: identityError,
            action: { label: "Retry", onClick: () => refetchIdentity() },
          });
        } else {
          toast.error("Contracting needs an agent record linked to your login", {
            description: "The new agent is placed under your record. Ask an admin to link one.",
          });
        }
        playSound("error");
        return;
      }
      if (!(await flushDraftNotes("the contracting form did not open"))) return;
      setContractLead(lead);
      return;
    }

    // For hired action, always show the hire confirm modal
    if (actionId === "hired") {
      setHireLead(lead);
      return;
    }

    // Reschedule opens the InterviewScheduler for applications. An aged lead
    // has no application row, and both the scheduler and log_contact_attempt
    // key on one, so the aged branch writes nothing and the queue stays put
    // instead of logging the lead under the wrong entity and advancing (F05).
    if (actionId === "reschedule") {
      if (lead.source === "applications") {
        setShowScheduleModal(true);
      } else {
        toast.error("Scheduling needs an application record", {
          description:
            "This aged lead has none, so no meeting or contact entry was written and the queue did not move. Use Needs follow-up to log this call instead.",
          duration: 10000,
        });
        playSound("error");
      }
      return;
    }

    // A failed save keeps the draft and stops the disposition (F04).
    if (!(await flushDraftNotes("nothing else was changed"))) return;
    await executeAction(actionId, lead);
  }), [runExclusive, currentLead, agentId, identityError, refetchIdentity, flushDraftNotes, executeAction, playSound]);

  const handleHireConfirm = useCallback((lead: UnifiedLead, boughtCourse: boolean, npn: string) => runExclusive(async () => {
    setHireLead(null);
    if (!(await flushDraftNotes("the hire was not started"))) return;
    let receipt: HireReceipt;
    try {
      const licenseStatus = lead.licenseStatus === "licensed"
        ? "licensed"
        : lead.licenseStatus === "pending"
          ? "pending"
          : "unlicensed";
      receipt = lead.source === "applications"
        ? await promoteApplicationToAgent(lead.id, { managerId: agentId, npn })
        : await createCanonicalHire({
            firstName: lead.firstName,
            lastName: lead.lastName || "",
            email: lead.email,
            phone: lead.phone || "",
            licenseStatus,
            npn,
            city: lead.city,
            state: lead.state,
            licenseStates: lead.licensedStates,
            instagramHandle: lead.instagramHandle,
            managerId: agentId,
          });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Hire could not start onboarding");
      playSound("error");
      return;
    }
    if (receipt.partial) toast.warning(receipt.message);
    else toast.success("Agent account created · onboarding started");
    // The notes were saved above; marking the lead hired does not save them
    // again, and a failure from here on says the account already exists (F04).
    await executeAction("hired", lead, { afterHire: true });

    // Log course purchase activity if checked
    if (boughtCourse) {
      const { logLeadActivity } = await import("@/lib/logLeadActivity");
      logLeadActivity({
        leadId: lead.id,
        type: "course_purchased_on_call",
        title: "Bought course on the phone",
        details: { source: lead.source },
      });

      // Also update the has_training_course flag if it's an application-linked agent
      if (lead.source === "applications") {
        supabase
          .from("applications")
          .update({ started_training: true })
          .eq("id", lead.id)
          .then(({ error }) => {
            if (error) { /* console.error stripped by v25 codemod */ }
          });
      }
    }
  }), [runExclusive, flushDraftNotes, agentId, executeAction, playSound]);

  const handleContractedSuccess = useCallback((leadId: string) => {
    // Remove the contracted lead, by id: the one the dialog was opened for.
    setContractLead(null);
    removeLead(leadId);
    celebrate();
    noticeIfAllProcessed();
  }, [removeLead, celebrate, noticeIfAllProcessed]);

  const handleSkip = useCallback(() => runExclusive(async () => {
    const lead = currentLead;
    if (!lead) return;
    // A draft that fails to save keeps the queue where it is (F04).
    if (!(await flushDraftNotes("the queue did not move"))) return;
    if (advancePast(lead.id)) playSound("whoosh");
    else lastLeadNotice();
  }), [runExclusive, currentLead, flushDraftNotes, advancePast, lastLeadNotice, playSound]);

  const handlePrevious = useCallback(() => runExclusive(async () => {
    if (!currentLead || currentIndex <= 0) return;
    if (!(await flushDraftNotes("the queue did not move"))) return;
    setCurrentIndex((prev) => Math.max(0, prev - 1));
  }), [runExclusive, currentLead, currentIndex, flushDraftNotes]);

  /** Queue-rail jump. By id, so a page appended meanwhile cannot move the target. */
  const jumpToLead = useCallback((leadId: string) => runExclusive(async () => {
    if (!(await flushDraftNotes("the queue did not move"))) return;
    const index = leadsRef.current.findIndex((l) => l.id === leadId);
    if (index !== -1) setCurrentIndex(index);
  }), [runExclusive, flushDraftNotes]);

  /** Back to the filters, with the notes saved first so they cannot follow the next session's first lead. */
  const exitSession = useCallback(() => runExclusive(async () => {
    if (!(await flushDraftNotes("the session stayed open"))) return;
    setStarted(false);
  }), [runExclusive, flushDraftNotes]);

  /** The reassignment already landed on the server; the lead's notes are saved before it leaves this queue. */
  const handleReassigned = useCallback((leadId: string) => runExclusive(async () => {
    if (!(await flushDraftNotes("the reassigned lead stays on screen until its notes are saved or discarded"))) return;
    removeLead(leadId);
  }), [runExclusive, flushDraftNotes, removeLead]);

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
      /* contact-scheme-allow: reached only inside the isMobile branch three lines up, where a native dialer exists. The desktop path below routes through Google Voice (MP-345). Correct as written. */
      window.open(`tel:${num}`, "_self");
      return;
    }
    // MP-345: on desktop this used to PICK a path silently — try Google Voice,
    // else copy to clipboard — and Sam reported getting neither a working call
    // nor any indication of what happened. Guessing is the problem: `tel:` is a
    // dead click without a softphone, Google Voice is unusable for the overseas
    // VAs (they work the ReadyMode seats), and a clipboard copy looks identical
    // to a no-op. So the number is always copied (the one action that works
    // everywhere) and the caller is TOLD what happened plus offered Google Voice
    // explicitly rather than having it chosen for them.
    navigator.clipboard?.writeText(num).catch(() => { // empty-catch-allow:clipboard blocked in insecure context; the number is still shown in the toast
      /* the toast below still shows the number, so this is recoverable */
    });
    toast.success(`${num} — copied, ready to dial`, {
      description: `${who}. Paste into ReadyMode, or open Google Voice.`,
      action: {
        label: "Google Voice",
        onClick: () => {
          if (!openGoogleVoice(num)) {
            toast.error("Google Voice could not dial that number", {
              description: `${num} is on your clipboard — paste it into ReadyMode.`,
            });
          }
        },
      },
      duration: 8000,
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

  const handleStageChange = useCallback((stage: LicensingStage) => runExclusive(async () => {
    const lead = currentLead;
    if (!lead) return;
    try {
      if (lead.source === "applications") {
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
          .update(updateData as never)
          .eq("id", lead.id);
      } else {
        // For aged_leads, just update status
        await supabase
          .from("aged_leads")
          .update({ status: stage })
          .eq("id", lead.id);
      }

      // Update local state
      updateLeads((prev) =>
        prev.map((l) =>
          l.id === lead.id ? { ...l, licenseProgress: stage } : l
        )
      );

      toast.success(`Stage updated to ${stage.replace("_", " ")}`);
      playSound("success");
    } catch (error) {
      console.error("Error updating stage:", error);
      toast.error("Failed to update stage");
      playSound("error");
    }
  }), [runExclusive, currentLead, updateLeads, playSound]);

  const handleStatusChange = useCallback((newStatus: string) => runExclusive(async () => {
    const lead = currentLead;
    if (!lead) return;
    try {
      const nowIso = new Date().toISOString();

      if (lead.source === "aged_leads") {
        const { error } = await supabase
          .from("aged_leads")
          .update({ status: newStatus, last_contacted_at: nowIso })
          .eq("id", lead.id);
        if (error) throw error;
      } else {
        const updateData: Record<string, string> = { status: newStatus, last_contacted_at: nowIso };
        if (newStatus === "contacted" && !lead.contactedAt) {
          updateData.contacted_at = nowIso;
        }
        const { error } = await supabase
          .from("applications")
          .update(updateData as never)
          .eq("id", lead.id);
        if (error) throw error;
      }

      updateLeads((prev) =>
        prev.map((l) => l.id === lead.id ? { ...l, status: newStatus } : l)
      );
      toast.success(`Status updated to ${newStatus.replace("_", " ")}`);
      playSound("success");
    } catch (error) {
      console.error("Error updating status:", error);
      toast.error("Failed to update status");
      playSound("error");
    }
  }), [runExclusive, currentLead, updateLeads, playSound]);

  const handleTestDateChange = useCallback((date: Date | undefined) => runExclusive(async () => {
    const lead = currentLead;
    if (!lead || lead.source !== "applications") return;
    try {
      const dateStr = date ? date.toISOString().split("T")[0] : null;

      await supabase
        .from("applications")
        .update({ test_scheduled_date: dateStr })
        .eq("id", lead.id);

      // Update local state
      updateLeads((prev) =>
        prev.map((l) =>
          l.id === lead.id ? { ...l, testScheduledDate: dateStr } : l
        )
      );

      toast.success(date ? `Test scheduled for ${date.toLocaleDateString()}` : "Test date cleared");
    } catch (error) {
      console.error("Error updating test date:", error);
      toast.error("Failed to update test date");
    }
  }), [runExclusive, currentLead, updateLeads]);

  // A dialog acts on the lead it opened for; keys behind it would act on the
  // queue instead, so they are ignored while one is open.
  const dialogOpen = Boolean(hireLead || contractLead || showScheduleModal || detailAppId);

  // Keyboard shortcuts
  useEffect(() => {
    if (!started) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (busyRef.current || dialogOpen) return;

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
          void handleAction("hired");
          break;
        case "2":
          void handleAction("contracted");
          break;
        case "3":
          void handleAction("bad_applicant");
          break;
        case "4":
          void handleAction("no_pickup");
          break;
        case "5":
          void handleAction("contacted");
          break;
        case "6":
          void handleAction("reschedule");
          break;
        case "7":
          void handleAction("bad_number");
          break;
        case "8":
          void handleAction("needs_followup");
          break;
        case "n":
          void handleSkip();
          break;
        case "p":
          void handlePrevious();
          break;
        case "escape":
          void exitSession();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [started, dialogOpen, handleAction, handleSkip, handlePrevious, exitSession]);

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

  // Filter selection UI, with the access state above it: loading, no
  // identity (and what to do), blocked, or ready (F02).
  if (!started) {
    return (
      <>
        <QueueAccessNotice access={access} onRetry={refetchIdentity} />
        {access.kind === "ready" && access.mayIncludeClosed && (
          <IncludeClosedToggle checked={includeClosed} onChange={setIncludeClosed} />
        )}
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
        disabled={access.kind !== "ready"}
        previewPlans={previewPlans}
      />
      </>
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
            {queueLoad.kind === "ready"
              ? ` · ${coverageLabel(combinedCoverage, countedAt ? formatAsOf(countedAt) : null)}`
              : ""}
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
              onClick={() => void exitSession()}
              disabled={processing}
              aria-label="Exit call center"
            >
              Exit
            </Button>
          </>
        }
      />

      {/* Content */}
      {queueLoad.kind === "loading" || queueLoad.kind === "idle" ? (
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
      ) : queueLoad.kind === "error" ? (
        <QueryState status="error" label="the dial queue" error={queueLoad.message} onRetry={() => void loadQueue("reset")} />
      ) : !currentLead ? (
        combinedCoverage.hasMore ? (
          <EmptyState
            icon={<ListChecks className="h-7 w-7" />}
            title="The loaded leads are done"
            description={`${coverageLabel(combinedCoverage, countedAt ? formatAsOf(countedAt) : null)}. ${remainingLabel(combinedCoverage)}`}
            actions={
              <>
                <Button className="h-10 w-full sm:h-9 sm:w-auto" onClick={() => void loadQueue("more")} disabled={loadingMore}>
                  {loadingMore ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                  Load more
                </Button>
                <Button variant="outline" className="h-10 w-full sm:h-9 sm:w-auto" onClick={() => void exitSession()} disabled={processing}>
                  Back to filters
                </Button>
              </>
            }
          />
        ) : (
          <EmptyState
            icon={<CheckCircle2 className="h-7 w-7" />}
            variant="success"
            title="No leads left in this queue"
            description="Every lead matching your filters has been worked. Head back and widen the filters to keep dialing."
            actions={
              <Button
                className="h-10 w-full sm:h-9 sm:w-auto"
                onClick={() => void exitSession()}
                disabled={processing}
              >
                Back to filters
              </Button>
            }
          />
        )
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
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
                          "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide",
                          currentBadge.className,
                        )}>
                          {currentBadge.text}
                        </span>
                        <span className="min-w-0 line-clamp-2 text-sm font-medium text-foreground">
                          Next best action: {currentNba.action}
                        </span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-[12px] text-muted-foreground">
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
                onTranscriptionUpdate={(text) => recordDraft(noteTargetOf(currentLead), text)}
                onStageChange={handleStageChange}
                onTestDateChange={handleTestDateChange}
                onCall={handleCall}
                isRecording={isRecording}
                onRecordingStateChange={setIsRecording}
                isAdmin={isAdmin}
                onReassigned={() => void handleReassigned(currentLead.id)}
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
                  <span className="text-[11px] font-bold uppercase tracking-wide">ahead</span>
                </span>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                The next ten leads in dial order. Tap a name to jump straight to it.
              </p>
            </div>
            <div className="min-w-0 flex-1 divide-y divide-border/60 overflow-y-auto">
              {leads.slice(currentIndex + 1, currentIndex + 11).map((l) => {
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
                    onClick={() => void jumpToLead(l.id)}
                    disabled={processing}
                    aria-label={`Jump to ${name}`}
                    className="w-full px-3 py-2.5 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 truncate text-sm font-medium text-foreground">{name}</div>
                      <span className={cn(
                        "shrink-0 rounded-full border px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide",
                        isLicensed
                          ? "border-emerald-500/35 text-emerald-600 dark:text-emerald-400"
                          : "border-rose-500/35 text-rose-600 dark:text-rose-400",
                      )}>
                        {isLicensed ? "Lic" : "Unlic"}
                      </span>
                    </div>
                    <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[12px] text-muted-foreground">
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
                      <span className="min-w-0 truncate text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                        {l.source === "aged_leads" ? "aged" : "applied"}
                      </span>
                    </div>
                  </button>
                );
              })}
              {leads.length - currentIndex - 1 <= 0 && !combinedCoverage.hasMore && (
                <p className="px-3 py-8 text-center text-xs text-muted-foreground">
                  No more leads in the queue.
                </p>
              )}
              {combinedCoverage.hasMore && (
                <div className="px-3 py-3">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => void loadQueue("more")}
                    disabled={loadingMore}
                    aria-label="Load more leads"
                  >
                    {loadingMore ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                    Load more
                    {combinedCoverage.remaining !== null ? ` · ${combinedCoverage.remaining.toLocaleString()} not loaded yet` : ""}
                  </Button>
                </div>
              )}
            </div>
          </GlassCard>
        </div>
      )}

      {/* Contracted Modal */}
      {contractLead && agentId && (
        <ContractedModal
          open
          onOpenChange={(open) => {
            if (!open) setContractLead(null);
          }}
          application={{
            id: contractLead.id,
            first_name: contractLead.firstName,
            last_name: contractLead.lastName || "",
            email: contractLead.email,
            phone: contractLead.phone || "",
            license_status: contractLead.licenseStatus as "licensed" | "unlicensed" | "pending",
            license_progress: contractLead.licenseProgress as ContractedProgress,
            source: contractLead.source,
          }}
          agentId={agentId}
          onSuccess={() => handleContractedSuccess(contractLead.id)}
        />
      )}

      {/* Hire Confirmation Modal */}
      {hireLead && (
        <HireConfirmModal
          open
          onOpenChange={(open) => {
            if (!open) setHireLead(null);
          }}
          onConfirm={(boughtCourse, npn) => handleHireConfirm(hireLead, boughtCourse, npn)}
          applicantName={`${hireLead.firstName} ${hireLead.lastName || ""}`.trim()}
          isUnlicensed={hireLead.licenseStatus !== "licensed"}
          initialNpn={hireLead.niprNumber || ""}
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
            void handleSkip();
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
