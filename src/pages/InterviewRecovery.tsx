// MP-264 — Interview Recovery & Scheduling Command Center
//
// WHY THIS PAGE EXISTS:
//   105 Calendly bookings between 2026-06-15 and 2026-08-10 never reached the
//   database. calendly-webhook classified "Licensed Call" / "Leader Call " as
//   unknown and returned 200 without writing a row, so there was nowhere in the
//   product to log an interview outcome. This page is that missing surface.
//
// Reads public.v_interview_pipeline (one bucket per interview, America/Chicago
// date math, nothing filtered out) and writes through cc_dispose_interview.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Instagram,
  Link2Off,
  Loader2,
  Mail,
  Phone,
  PhoneOff,
  RefreshCw,
  Rocket,
  Search,
  SkipForward,
  UserCheck,
  UserX,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { ApplicationDetailSheet } from "@/components/dashboard/ApplicationDetailSheet";

// ---------------------------------------------------------------------------
// Types — mirror v_interview_pipeline
// ---------------------------------------------------------------------------
type Bucket =
  | "starting_soon" | "overdue_today" | "today" | "confirmed"
  | "missed_yesterday" | "missed_2_7" | "missed_7_plus"
  | "needs_reschedule" | "contacted_waiting" | "completed"
  | "no_show" | "not_interested" | "canceled" | "upcoming";

type Outcome =
  | "completed" | "hired" | "contracted" | "passed" | "no_show" | "no_answer"
  | "rescheduled" | "bad_number" | "callback" | "not_interested" | "not_a_fit";

interface PipelineRow {
  id: string;
  application_id: string | null;
  display_name: string;
  best_phone: string | null;
  best_email: string | null;
  instagram_handle: string | null;
  invitee_status: string | null;
  prep_notes: string | null;
  reschedule_url: string | null;
  call_track: "licensed" | "leader" | "seminar" | "exam" | "other" | null;
  event_type_name: string | null;
  scheduled_at: string;
  scheduled_at_chicago: string;
  bucket: Bucket;
  is_backlog: boolean;
  days_overdue: number;
  priority_score: number;
  match_method: string | null;
  outcome: Outcome | null;
  notes: string | null;
  license_status: string | null;
  previous_company: string | null;
  years_experience: number | null;
  previous_production: number | null;
  previous_team_size: number | null;
  desired_income: number | null;
  state: string | null;
  application_status: string | null;
  has_insurance_experience: boolean | null;
  referral_source: string | null;
  was_rescheduled: boolean | null;
}

// Mirrors public.v_prospect_review_queue — Calendly bookings with no
// application_id AND no agent_id. Licensed agents and team leaders who booked
// a recruiting call and exist in no other Apex system: real inbound demand
// that is currently invisible. Zero of them have ever had an outcome recorded,
// which is why disposition is the only action this bucket needs to make easy.
interface ProspectRow {
  interview_event_id: string;
  invitee_name: string | null;
  invitee_email: string | null;
  invitee_phone: string | null;
  instagram_handle: string | null;
  event_type_name: string | null;
  call_track: "licensed" | "leader" | "other" | null;
  scheduled_at: string;
  owner: string | null;
  last_action_at: string | null;
  next_action: string | null;
  due_at: string | null;
  // numeric(8,1) and bigint — coerce with Number() rather than trusting the wire type.
  days_stuck: number | string | null;
  priority: number;
  outcome: string | null;
  notes: string | null;
  va_notes: string | null;
  candidate_count: number | string | null;
}

// ---------------------------------------------------------------------------
// Severity vocabulary — three levels, theme-paired so every one of them stays
// legible on the white light-theme card and the dark card. Colour is never the
// only signal: every use below sits next to an icon, a word, or a numeral.
// ---------------------------------------------------------------------------
const GOOD = "text-emerald-600 dark:text-emerald-400";
const WARN = "text-amber-600 dark:text-amber-400";
const BAD = "text-rose-600 dark:text-rose-400";
const NEUTRAL = "text-muted-foreground";

// A category chip carries meaning in its label, not its hue — tinting it would
// collide with the severity vocabulary above.
const CATEGORY_CHIP =
  "border-border bg-muted/40 text-[10px] font-bold uppercase tracking-wide text-muted-foreground";

// ---------------------------------------------------------------------------
// Bucket presentation — colour is never the only signal, every chip has a label
// ---------------------------------------------------------------------------
const BUCKETS: { key: Bucket; label: string; tone: string }[] = [
  { key: "starting_soon",     label: "Starting in 15 min", tone: WARN },
  { key: "overdue_today",     label: "Overdue Today",      tone: BAD },
  { key: "today",             label: "Today",              tone: GOOD },
  { key: "missed_yesterday",  label: "Missed Yesterday",   tone: BAD },
  { key: "missed_2_7",        label: "Missed 2–7 Days",    tone: BAD },
  { key: "missed_7_plus",     label: "Missed 7+ Days",     tone: BAD },
  { key: "needs_reschedule",  label: "Needs Reschedule",   tone: WARN },
  { key: "contacted_waiting", label: "Contacted · Waiting",tone: WARN },
  { key: "confirmed",         label: "Confirmed",          tone: GOOD },
  { key: "upcoming",          label: "Upcoming",           tone: NEUTRAL },
  { key: "completed",         label: "Completed",          tone: GOOD },
  { key: "no_show",           label: "No Show",            tone: NEUTRAL },
  { key: "not_interested",    label: "Not Interested",     tone: NEUTRAL },
  { key: "canceled",          label: "Canceled",           tone: NEUTRAL },
];

const DISPOSITIONS: { key: Outcome; label: string; icon: typeof Check; tone: string; hotkey: string }[] = [
  { key: "completed",      label: "Completed",   icon: CheckCircle2, tone: GOOD,    hotkey: "1" },
  { key: "hired",          label: "Hired",       icon: UserCheck,    tone: GOOD,    hotkey: "2" },
  { key: "no_answer",      label: "No Answer",   icon: PhoneOff,     tone: NEUTRAL, hotkey: "3" },
  { key: "no_show",        label: "No Show",     icon: UserX,        tone: NEUTRAL, hotkey: "4" },
  { key: "rescheduled",    label: "Reschedule",  icon: CalendarClock,tone: WARN,    hotkey: "5" },
  { key: "callback",       label: "Call Back",   icon: Phone,        tone: WARN,    hotkey: "6" },
  { key: "not_interested", label: "Not Interested", icon: XCircle,   tone: BAD,     hotkey: "7" },
  { key: "bad_number",     label: "Bad Number",  icon: PhoneOff,     tone: BAD,     hotkey: "8" },
];

// One disposition button, identical in Catch Up, the pipeline rows and the
// prospect rows. Severity lives on the icon + label; the surface stays neutral.
const dispositionClass = (tone: string) =>
  cn("h-10 justify-start px-2.5 text-xs sm:h-9", tone);

const CHICAGO = "America/Chicago";

function fmtChicago(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: CHICAGO, weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

function relativeDays(days: number): string {
  const d = Math.max(0, days);
  if (d <= 0) return "today";
  if (d === 1) return "1 day ago";
  return `${d} days ago`;
}

// Why this row scores where it does. A ranking without its basis is not
// intelligence — surface the fields that produced it.
function priorityReasons(r: PipelineRow): string[] {
  const out: string[] = [];
  if (r.bucket === "today" || r.bucket === "overdue_today") out.push("today");
  if (r.bucket === "starting_soon") out.push("starting soon");
  if (r.license_status === "licensed") out.push("licensed");
  if (r.invitee_status) out.push(r.invitee_status.toLowerCase());
  if (r.has_insurance_experience) out.push("has experience");
  if ((r.previous_production ?? 0) > 0) out.push("proven producer");
  if ((r.previous_team_size ?? 0) > 0) out.push("has a team");
  if (r.days_overdue > 0) out.push(relativeDays(r.days_overdue));
  return out;
}

// --- prospect helpers ------------------------------------------------------
const num = (v: number | string | null | undefined): number => Number(v ?? 0) || 0;

const prospectName = (p: ProspectRow): string =>
  p.invitee_name?.trim() || "Unnamed booking";

// The view's priority is 1 for anything still in the future. Comparison only —
// nothing here renders a signed duration.
const isUpcoming = (p: ProspectRow): boolean => p.priority === 1;

// What this row is waiting on, in the fewest words that still decide the action.
function prospectUrgency(p: ProspectRow): string {
  if (isUpcoming(p)) return "upcoming";
  if (p.outcome) return `logged ${p.outcome.replace(/_/g, " ")}`;
  return `no outcome · ${relativeDays(Math.floor(Math.max(0, num(p.days_stuck))))}`;
}

const TRACK_LABEL: Record<string, string> = {
  licensed: "Licensed",
  leader: "Leader",
  other: "Other",
};

// ---------------------------------------------------------------------------
export default function InterviewRecovery() {
  usePageTitle("Interview Recovery");
  const qc = useQueryClient();

  const [activeBucket, setActiveBucket] = useState<Bucket | "backlog" | "all" | "prospects">("backlog");
  const [search, setSearch] = useState("");
  const [catchUp, setCatchUp] = useState(false);
  const [catchIndex, setCatchIndex] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailAppId, setDetailAppId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [noteDraft, setNoteDraft] = useState("");
  // 0 = no follow-up scheduled. Days from now, applied on the next disposition.
  const [followupDays, setFollowupDays] = useState(0);
  const [busy, setBusy] = useState(false);

  const pipeline = useQuery({
    queryKey: ["interview-pipeline"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("v_interview_pipeline")
        .select("*")
        .order("priority_score", { ascending: false })
        .order("scheduled_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as PipelineRow[];
    },
    refetchInterval: 60_000,
  });

  const prospects = useQuery({
    queryKey: ["prospect-review-queue"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("v_prospect_review_queue")
        .select("*")
        .order("priority", { ascending: true })
        .order("scheduled_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as ProspectRow[];
    },
    refetchInterval: 60_000,
  });

  const rows = useMemo(() => pipeline.data ?? [], [pipeline.data]);
  const prospectRows = useMemo(() => prospects.data ?? [], [prospects.data]);

  // The money number for this bucket. Disposed rows stay in the view (they only
  // leave once linked to an application), so "still open" is what must count
  // down as Sam works — not the raw row total.
  const prospectsOpen = useMemo(
    () => prospectRows.filter((p) => !p.outcome).length,
    [prospectRows],
  );

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of rows) m[r.bucket] = (m[r.bucket] ?? 0) + 1;
    return m;
  }, [rows]);

  // Measured across both queues, deduped by interview_events.id — the two views overlap,
  // so a naive sum would inflate the denominator and flatter the rate.
  const dispositionRate = useMemo(() => {
    const seen = new Map<string, boolean>();
    for (const r of rows) seen.set(r.id, Boolean(r.outcome));
    for (const p of prospectRows) {
      if (p.interview_event_id) seen.set(p.interview_event_id, Boolean(p.outcome));
    }
    const total = seen.size;
    let done = 0;
    for (const hasOutcome of seen.values()) if (hasOutcome) done += 1;
    return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
  }, [rows, prospectRows]);

  const backlog = useMemo(() => rows.filter((r) => r.is_backlog), [rows]);

  const filtered = useMemo(() => {
    // The prospect bucket reads a different view and renders through its own
    // list below — keeping this memo single-typed avoids a union guard on
    // every field access in the pipeline row path.
    if (activeBucket === "prospects") return [] as PipelineRow[];

    let base =
      activeBucket === "backlog" ? backlog
      : activeBucket === "all"   ? rows
      : rows.filter((r) => r.bucket === activeBucket);

    const q = search.trim().toLowerCase();
    if (q) {
      base = base.filter((r) =>
        [r.display_name, r.best_phone, r.best_email, r.instagram_handle,
         r.previous_company, r.state, r.event_type_name]
          .some((f) => (f ?? "").toLowerCase().includes(q)),
      );
    }
    return base;
  }, [rows, backlog, activeBucket, search]);

  const filteredProspects = useMemo(() => {
    if (activeBucket !== "prospects") return [] as ProspectRow[];

    let base = prospectRows;
    const q = search.trim().toLowerCase();
    if (q) {
      base = base.filter((p) =>
        [p.invitee_name, p.invitee_email, p.invitee_phone, p.instagram_handle,
         p.owner, p.event_type_name]
          .some((f) => (f ?? "").toLowerCase().includes(q)),
      );
    }
    // Already-logged rows sink; the rest keep the view's priority order.
    return [...base].sort((a, b) =>
      Number(Boolean(a.outcome)) - Number(Boolean(b.outcome)) ||
      a.priority - b.priority ||
      // relative-time-guard-allow: Array.sort comparator — the delta orders rows and is never rendered as a duration.
      new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime(),
    );
  }, [prospectRows, activeBucket, search]);

  // Catch Up works the backlog in priority order — today's first, then
  // starting-soon, then high-value recruits, then oldest missed.
  const catchQueue = useMemo(
    () => [...backlog].sort((a, b) =>
      b.priority_score - a.priority_score ||
      new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime(),
    ),
    [backlog],
  );
  const current = catchQueue[catchIndex] ?? null;

  useEffect(() => {
    if (catchUp && catchIndex >= catchQueue.length && catchQueue.length > 0) {
      setCatchIndex(catchQueue.length - 1);
    }
  }, [catchUp, catchIndex, catchQueue.length]);

  useEffect(() => { setNoteDraft(current?.notes ?? ""); }, [current?.id, current?.notes]);

  // Both queues read the same interview_events rows, so every write has to
  // refresh both or one surface keeps rendering a stale outcome.
  const invalidateQueues = useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["interview-pipeline"] }),
      qc.invalidateQueries({ queryKey: ["prospect-review-queue"] }),
    ]);
  }, [qc]);

  // v_prospect_review_queue.interview_event_id IS interview_events.id, so the
  // pipeline and prospect buckets dispose through one identical path.
  const disposeById = useCallback(
    async (
      id: string,
      label: string,
      outcome: Outcome,
      notes?: string,
      followupDueAt?: string | null,
    ) => {
      setBusy(true);
      try {
        // cc_dispose_interview has always accepted p_followup_due_at; the UI hardcoded
        // null, so "call them back Tuesday" had nowhere to live and the callback outcome
        // was a dead end. Now the caller can schedule the next touch in the same tap.
        const { error } = await (supabase as any).rpc("cc_dispose_interview", {
          p_id: id,
          p_outcome: outcome,
          p_notes: notes && notes.trim() ? notes.trim() : null,
          p_followup_due_at: followupDueAt ?? null,
        });
        if (error) throw error;

        toast.success(`${label} → ${outcome.replace(/_/g, " ")}`, {
          action: {
            label: "Undo",
            onClick: async () => {
              const { error: undoErr } = await (supabase as any)
                .from("interview_events")
                .update({ outcome: null, outcome_at: null })
                .eq("id", id);
              if (undoErr) toast.error(`Undo failed: ${undoErr.message}`);
              else {
                toast.success("Reverted");
                await invalidateQueues();
              }
            },
          },
        });
        await invalidateQueues();
      } catch (err) {
        // Never swallow — a silent failure here is the exact bug this page fixes.
        toast.error(`Could not log outcome: ${(err as Error).message}`);
      } finally {
        setBusy(false);
      }
    },
    [invalidateQueues],
  );

  const dispose = useCallback(
    (row: PipelineRow, outcome: Outcome, notes?: string, followupDueAt?: string | null) =>
      disposeById(row.id, row.display_name, outcome, notes, followupDueAt),
    [disposeById],
  );

  const disposeProspect = useCallback(
    (p: ProspectRow, outcome: Outcome) =>
      disposeById(p.interview_event_id, prospectName(p), outcome),
    [disposeById],
  );

  const disposeAndAdvance = useCallback(
    async (outcome: Outcome) => {
      if (!current) return;
      const due =
        followupDays > 0
          ? new Date(Date.now() + followupDays * 86_400_000).toISOString()
          : null;
      await dispose(current, outcome, noteDraft, due);
      setNoteDraft("");
      setFollowupDays(0);
      setCatchIndex((i) => Math.min(i + 1, Math.max(0, catchQueue.length - 2)));
    },
    [current, dispose, noteDraft, followupDays, catchQueue.length],
  );

  const bulkDispose = useCallback(
    async (outcome: Outcome) => {
      const ids = Array.from(selected);
      if (!ids.length) return;
      setBusy(true);
      let ok = 0;
      const failures: string[] = [];
      for (const id of ids) {
        const { error } = await (supabase as any).rpc("cc_dispose_interview", {
          p_id: id, p_outcome: outcome, p_notes: null, p_followup_due_at: null,
        });
        if (error) failures.push(error.message);
        else ok += 1;
      }
      setBusy(false);
      setSelected(new Set());
      await invalidateQueues();
      if (failures.length) toast.error(`${ok} logged, ${failures.length} failed: ${failures[0]}`);
      else toast.success(`${ok} logged as ${outcome.replace(/_/g, " ")}`);
    },
    [selected, invalidateQueues],
  );

  // Selection is an id set shared by both buckets. Clearing it on every bucket
  // change stops a bulk disposition from firing at rows Sam can no longer see.
  const goBucket = useCallback((b: Bucket | "backlog" | "all" | "prospects") => {
    setActiveBucket(b);
    setSelected(new Set());
    setExpandedId(null);
  }, []);

  // Keyboard shortcuts for Catch Up mode
  useEffect(() => {
    if (!catchUp) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      if (t?.isContentEditable) return;

      const hit = DISPOSITIONS.find((d) => d.hotkey === e.key);
      if (hit) { e.preventDefault(); void disposeAndAdvance(hit.key); return; }
      if (e.key === "n") { e.preventDefault(); setCatchIndex((i) => Math.min(i + 1, catchQueue.length - 1)); }
      if (e.key === "p") { e.preventDefault(); setCatchIndex((i) => Math.max(0, i - 1)); }
      if (e.key === "Escape") { e.preventDefault(); setCatchUp(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [catchUp, catchQueue.length, disposeAndAdvance]);

  const oldest = backlog.length
    ? Math.max(...backlog.map((r) => r.days_overdue))
    : 0;

  // The heading the list section carries — same vocabulary as the chip strip,
  // so the selected chip and the section title always read the same.
  const activeLabel =
    activeBucket === "backlog" ? "Catch Up Queue"
    : activeBucket === "prospects" ? "Prospect Review"
    : activeBucket === "all" ? "All interviews"
    : BUCKETS.find((b) => b.key === activeBucket)?.label ?? "Interviews";

  // -------------------------------------------------------------------------
  // Catch Up — one candidate at a time, full screen
  // -------------------------------------------------------------------------
  if (catchUp) {
    if (!current) {
      return (
        <div className="page-enter mx-auto w-full max-w-6xl space-y-5 px-4 pb-24 sm:px-6">
          <PageHeader
            eyebrow="Catch Up"
            eyebrowIcon={<Rocket className="h-3.5 w-3.5" />}
            title="Backlog clear"
            subtitle="Nothing is waiting on an outcome."
            actions={
              <Button
                variant="outline"
                className="h-10 w-full sm:h-9 sm:w-auto"
                onClick={() => setCatchUp(false)}
              >
                Back to queue
              </Button>
            }
          />
          <EmptyState
            icon={<CheckCircle2 className="h-7 w-7" />}
            variant="success"
            title="Backlog clear"
            description="Every interview has an outcome logged. Head back to the queue to work upcoming calls or the prospect review bucket."
          />
        </div>
      );
    }

    const reasons = priorityReasons(current);

    return (
      <div className="page-enter mx-auto w-full max-w-6xl space-y-5 px-4 pb-24 sm:px-6">
        <PageHeader
          eyebrow="Catch Up"
          eyebrowIcon={<Rocket className="h-3.5 w-3.5" />}
          title={current.display_name}
          subtitle={
            <>
              {current.event_type_name?.trim() || "Interview"} · scheduled {fmtChicago(current.scheduled_at)}
              {current.days_overdue > 0 && (
                <span className={BAD}> · {relativeDays(current.days_overdue)}</span>
              )}
            </>
          }
          actions={
            <Button
              variant="outline"
              className="h-10 w-full sm:h-9 sm:w-auto"
              onClick={() => setCatchUp(false)}
              aria-label="Exit Catch Up mode"
            >
              <X className="mr-1.5 h-4 w-4" /> Exit
            </Button>
          }
        />

        {/* progress */}
        <GlassCard className="p-4">
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
              <Rocket className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate">Catch Up progress</span>
            </h3>
            <span className="shrink-0 text-sm font-bold tabular-nums text-muted-foreground">
              {catchIndex + 1} of {catchQueue.length}
            </span>
          </div>
          <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
            <span className="font-bold tabular-nums text-foreground">
              {catchQueue.length - catchIndex - 1}
            </span>{" "}
            interviews still have no outcome after this one.
          </p>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${((catchIndex + 1) / Math.max(1, catchQueue.length)) * 100}%` }}
            />
          </div>

          {/* Disposition rate is the number that says whether this queue is actually being
              worked. It started at 1 of 164 — every other interview ever held has no
              recorded outcome. Showing it makes the habit visible instead of theoretical. */}
          <div className="mt-3 flex items-baseline justify-between gap-2 border-t border-border pt-3">
            <span className="min-w-0 text-xs leading-relaxed text-muted-foreground">
              Interviews with an outcome logged
            </span>
            <span className="shrink-0 text-sm font-bold tabular-nums text-foreground">
              {dispositionRate.done.toLocaleString()} / {dispositionRate.total.toLocaleString()}
              <span className="ml-1.5 font-semibold text-muted-foreground">
                {dispositionRate.pct}%
              </span>
            </span>
          </div>
        </GlassCard>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
          {/* main */}
          <GlassCard className="p-4">
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
                <UserCheck className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate">Who you are calling</span>
              </h3>
              <Badge variant="outline" className={cn("shrink-0", CATEGORY_CHIP)}>
                {current.call_track === "licensed" ? "Licensed Call" : "Leader Call"}
              </Badge>
            </div>
            <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
              Every contact route and the whole application, so the call starts without a lookup.
            </p>

            {reasons.length > 0 && (
              <p className="mb-3 text-[11px] text-muted-foreground">{reasons.join(" · ")}</p>
            )}

            {/* contact actions */}
            <div className="flex flex-wrap gap-2">
              {current.best_phone && (
                <Button asChild className="h-10 sm:h-9">
                  <a href={`tel:${current.best_phone.replace(/[^\d+]/g, "")}`} aria-label={`Call ${current.display_name}`}>
                    <Phone className="mr-2 h-4 w-4" /> Call{" "}
                    <span className="tabular-nums">{current.best_phone}</span>
                  </a>
                </Button>
              )}
              {current.best_email && (
                <Button asChild variant="outline" className="h-10 sm:h-9">
                  <a href={`mailto:${current.best_email}`} aria-label={`Email ${current.display_name}`}>
                    <Mail className="mr-2 h-4 w-4" /> Email
                  </a>
                </Button>
              )}
              {current.instagram_handle && (
                <Button asChild variant="outline" className="h-10 max-w-full sm:h-9">
                  <a href={`https://instagram.com/${current.instagram_handle.replace(/^@/, "")}`}
                     target="_blank" rel="noopener noreferrer"
                     aria-label={`Open Instagram for ${current.display_name}`}>
                    <Instagram className="mr-2 h-4 w-4" />
                    <span className="truncate">@{current.instagram_handle.replace(/^@/, "")}</span>
                  </a>
                </Button>
              )}
              {current.reschedule_url && (
                <Button asChild variant="outline" className="h-10 sm:h-9">
                  <a href={current.reschedule_url} target="_blank" rel="noopener noreferrer"
                     aria-label={`Reschedule ${current.display_name}`}>
                    <CalendarClock className="mr-2 h-4 w-4" /> Reschedule link
                  </a>
                </Button>
              )}
            </div>

            {/* the full application, inline */}
            <div className="mt-3">
              {current.application_id ? (
                <ApplicationFacts row={current} onOpenFull={() => setDetailAppId(current.application_id)} />
              ) : (
                <UnmatchedPanel
                  name={current.display_name}
                  phone={current.best_phone}
                  email={current.best_email}
                  instagram={current.instagram_handle}
                  theySaid={current.invitee_status}
                  eventType={current.event_type_name}
                />
              )}
            </div>

            {current.prep_notes && (
              <div className="mt-3 rounded-lg border border-border bg-card p-3 sm:p-4">
                <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">They wrote</p>
                <p className="mt-1 break-words text-sm text-foreground">{current.prep_notes}</p>
              </div>
            )}
          </GlassCard>

          {/* right rail */}
          <div className="space-y-3">
            <GlassCard className="p-4">
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
                  <Check className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">Call agenda</span>
                </h3>
              </div>
              <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
                The five beats this track has to cover before the call ends.
              </p>
              <ul className="space-y-2">
                {(current.call_track === "licensed"
                  ? ["Confirm license + states", "Current production", "Why leaving", "Apex comp", "Close to contracting"]
                  : ["Team size today", "Income goal", "Leadership history", "Apex override structure", "Close to next step"]
                ).map((line) => (
                  <li key={line} className="flex items-start gap-2">
                    <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 text-sm font-medium text-foreground">{line}</span>
                  </li>
                ))}
              </ul>
            </GlassCard>

            <GlassCard className="p-4">
              <label
                htmlFor="catchup-notes"
                className="mb-1 block text-sm font-semibold text-foreground"
              >
                Call notes
              </label>
              <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
                Whatever is typed here is filed with the outcome you log next.
              </p>
              <Textarea
                id="catchup-notes"
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                placeholder="What happened on this call…"
                rows={5}
              />

              {/* Follow-up rides along with the next disposition. Without this, "callback"
                  was a dead end — you could log that they want calling back, but not when,
                  so nothing ever resurfaced them. */}
              <div className="mt-4 border-t border-border pt-3">
                <p className="text-sm font-semibold text-foreground">Follow up</p>
                <p className="mb-2 mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  Filed with the outcome, so they come back to you instead of going quiet.
                </p>
                <div className="flex flex-wrap gap-2">
                  {[
                    { days: 0, label: "None" },
                    { days: 1, label: "Tomorrow" },
                    { days: 3, label: "In 3 days" },
                    { days: 7, label: "Next week" },
                  ].map((opt) => {
                    const active = followupDays === opt.days;
                    return (
                      <button
                        key={opt.days}
                        type="button"
                        onClick={() => setFollowupDays(opt.days)}
                        aria-pressed={active}
                        className={cn(
                          "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                          "focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]",
                          active
                            ? "border-primary/40 bg-primary/10 text-primary ring-2 ring-primary/60"
                            : "border-border bg-card text-foreground hover:bg-muted/40",
                        )}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </GlassCard>

            <GlassCard className="p-4">
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">Log the outcome</span>
                </h3>
              </div>
              <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
                One tap files this interview and advances the queue. Number keys do the same thing.
              </p>
              <div className="grid grid-cols-2 gap-3">
                {DISPOSITIONS.map((d) => (
                  <Button
                    key={d.key}
                    variant="outline"
                    disabled={busy}
                    className={dispositionClass(d.tone)}
                    onClick={() => void disposeAndAdvance(d.key)}
                    aria-label={`${d.label} — ${current.display_name}`}
                  >
                    <d.icon className="mr-1.5 h-4 w-4 shrink-0" />
                    <span className="truncate">{d.label}</span>
                    <kbd className="ml-auto hidden shrink-0 text-[10px] font-bold tabular-nums text-muted-foreground sm:inline">
                      {d.hotkey}
                    </kbd>
                  </Button>
                ))}
              </div>

              <div className="mt-3 flex gap-2">
                <Button variant="outline" className="h-10 flex-1 sm:h-9" disabled={catchIndex === 0}
                        onClick={() => setCatchIndex((i) => Math.max(0, i - 1))} aria-label="Previous candidate">
                  Previous
                </Button>
                <Button variant="outline" className="h-10 flex-1 sm:h-9"
                        onClick={() => setCatchIndex((i) => Math.min(i + 1, catchQueue.length - 1))}
                        aria-label="Skip to next candidate">
                  <SkipForward className="mr-1.5 h-4 w-4" /> Skip
                </Button>
              </div>
            </GlassCard>
          </div>
        </div>

        <ApplicationDetailSheet
          open={Boolean(detailAppId)}
          onOpenChange={(o) => { if (!o) setDetailAppId(null); }}
          applicationId={detailAppId ?? ""}
        />
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Queue view
  // -------------------------------------------------------------------------
  return (
    <div className="page-enter mx-auto w-full max-w-6xl space-y-5 px-4 pb-24 sm:px-6">
      <PageHeader
        title="Interview Recovery"
        subtitle={
          backlog.length
            ? `${backlog.length} interviews waiting to be logged · oldest ${relativeDays(oldest)}`
            : "Every interview has an outcome logged."
        }
        actions={
          <Button
            className="h-10 w-full sm:h-9 sm:w-auto"
            disabled={!backlog.length}
            onClick={() => { setCatchIndex(0); setCatchUp(true); }}
          >
            <Rocket className="mr-2 h-4 w-4" />
            Catch Up{backlog.length ? ` (${backlog.length})` : ""}
          </Button>
        }
      />

      {/* KPI strip */}
      <GlassCard className="p-4">
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
            <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">Where the queue stands</span>
          </h3>
          <span className="shrink-0 text-sm font-bold tabular-nums text-muted-foreground">
            {rows.length.toLocaleString()}
          </span>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
          Backlog is every interview that happened with no outcome written down — that is the number this
          page exists to drive to zero.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Kpi label="Backlog"        value={backlog.length}                     tone="bad"     icon={AlertTriangle} />
          <Kpi label="Today"          value={(counts.today ?? 0) + (counts.overdue_today ?? 0)} tone="good" icon={Clock} />
          <Kpi label="Starting soon"  value={counts.starting_soon ?? 0}          tone="warn"    icon={Zap} />
          <Kpi label="Upcoming"       value={counts.upcoming ?? 0}               tone="neutral" icon={CalendarClock} />
          <Kpi label="Completed"      value={counts.completed ?? 0}              tone="good"    icon={CheckCircle2} />
          <Kpi label="Prospect Review" value={prospectsOpen} tone="warn" icon={Link2Off}
               active={activeBucket === "prospects"}
               onClick={() => goBucket("prospects")} />
        </div>
      </GlassCard>

      {/* search + bucket chips */}
      <GlassCard className="p-4">
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">Find and filter</span>
          </h3>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
          Search runs across name, phone, Instagram, company and state; the chips below narrow the list to
          one bucket.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, phone, IG, company…"
              className="h-10 pl-9 sm:h-9"
              aria-label="Search interviews"
            />
          </div>
          <Button variant="outline" size="icon" className="h-10 w-10 shrink-0 sm:h-9 sm:w-9"
                  aria-label="Refresh interview queue"
                  onClick={() => void Promise.all([pipeline.refetch(), prospects.refetch()])}>
            <RefreshCw className={cn("h-4 w-4",
              (pipeline.isFetching || prospects.isFetching) && "animate-spin")} />
          </Button>
        </div>

        {/* bucket chips — one scroll container, the page body never moves */}
        <div className="-mx-4 mt-3 overflow-x-auto pb-1 sm:mx-0">
          <div className="flex min-w-max gap-2 px-4 sm:px-0">
            <Chip active={activeBucket === "backlog"} tone={BAD}
                  label="Catch Up Queue" count={backlog.length} onClick={() => goBucket("backlog")} />
            <Chip active={activeBucket === "prospects"} tone={WARN}
                  label="Prospect Review" count={prospectsOpen} onClick={() => goBucket("prospects")} />
            <Chip active={activeBucket === "all"} tone={NEUTRAL}
                  label="All" count={rows.length} onClick={() => goBucket("all")} />
            {BUCKETS.filter((b) => (counts[b.key] ?? 0) > 0).map((b) => (
              <Chip key={b.key} active={activeBucket === b.key} tone={b.tone} label={b.label}
                    count={counts[b.key] ?? 0} onClick={() => goBucket(b.key)} />
            ))}
          </div>
        </div>
      </GlassCard>

      {/* bulk bar */}
      {selected.size > 0 && (
        <GlassCard className="p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-sm font-semibold text-foreground">
              <span className="tabular-nums">{selected.size}</span> selected
            </span>
            <Button size="sm" variant="outline" className="h-10 sm:h-9" disabled={busy}
                    onClick={() => void bulkDispose("no_answer")}>
              <PhoneOff className={cn("mr-1.5 h-4 w-4", NEUTRAL)} /> No Answer
            </Button>
            <Button size="sm" variant="outline" className="h-10 sm:h-9" disabled={busy}
                    onClick={() => void bulkDispose("no_show")}>
              <UserX className={cn("mr-1.5 h-4 w-4", NEUTRAL)} /> No Show
            </Button>
            <Button size="sm" variant="ghost" className="h-10 sm:h-9"
                    onClick={() => setSelected(new Set())}>Clear</Button>
          </div>
        </GlassCard>
      )}

      {/* list */}
      {activeBucket === "prospects" ? (
        <ProspectQueue
          query={prospects}
          rows={filteredProspects}
          total={prospectRows.length}
          open={prospectsOpen}
          searching={Boolean(search.trim())}
          expandedId={expandedId}
          selected={selected}
          busy={busy}
          onToggleSelect={(id) => setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
          })}
          onToggleExpand={(id) => setExpandedId((cur) => (cur === id ? null : id))}
          onDispose={(p, o) => void disposeProspect(p, o)}
        />
      ) : (
        <GlassCard className="p-4">
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
              <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{activeLabel}</span>
            </h3>
            <span className="shrink-0 text-sm font-bold tabular-nums text-muted-foreground">
              {filtered.length.toLocaleString()}
            </span>
          </div>
          <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
            Open a row to read the application and log what happened; the number on the right is how many
            days late that interview already is.
          </p>

          {pipeline.isLoading ? (
            <div className="space-y-2">
              {/* stable-key-allow:skeleton */}
              {[1, 2, 3, 4, 5].map((n) => <Skeleton key={n} className="h-[76px] w-full rounded-lg" />)}
            </div>
          ) : pipeline.isError ? (
            // A query that threw must say so. Without this branch a failed read
            // fell through to filtered.length === 0 and rendered the SUCCESS-toned
            // "This queue is clear" — a broken query presented as an all-clear,
            // the same fake-success class as the 465 InsuraCloud sync rows.
            <div className="rounded-lg border border-rose-500/35 bg-rose-500/5 p-3 sm:p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <AlertTriangle className={cn("mt-0.5 h-5 w-5 shrink-0", BAD)} />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">Interview queue did not load</p>
                    <p className="mt-0.5 break-words text-xs text-muted-foreground">
                      {(pipeline.error as Error | null)?.message ?? "The interview pipeline view could not be read."}
                    </p>
                  </div>
                </div>
                <Button size="sm" variant="outline" className="h-10 w-full sm:h-9 sm:w-auto"
                        onClick={() => void pipeline.refetch()}>
                  <RefreshCw className="mr-1.5 h-4 w-4" /> Try again
                </Button>
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<CheckCircle2 className="h-7 w-7" />}
              variant={search ? "default" : "success"}
              title={search ? "No interviews match that search" : "This queue is clear"}
              description={
                search
                  ? "Try a first name, a phone number, an Instagram handle, or the company they came from."
                  : "Every interview in this bucket already has an outcome logged. Switch buckets to find work."
              }
            />
          ) : (
            <ul className="space-y-2">
              {filtered.map((r) => (
                <InterviewRow
                  key={r.id}
                  row={r}
                  expanded={expandedId === r.id}
                  selected={selected.has(r.id)}
                  busy={busy}
                  onToggleSelect={() => {
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (next.has(r.id)) next.delete(r.id); else next.add(r.id);
                      return next;
                    });
                  }}
                  onToggleExpand={() => setExpandedId((cur) => (cur === r.id ? null : r.id))}
                  onDispose={(o) => void dispose(r, o)}
                  onOpenFull={() => setDetailAppId(r.application_id)}
                />
              ))}
            </ul>
          )}
        </GlassCard>
      )}

      <ApplicationDetailSheet
        open={Boolean(detailAppId)}
        onOpenChange={(o) => { if (!o) setDetailAppId(null); }}
        applicationId={detailAppId ?? ""}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Severity lives on the numeral, never on the tile surface — a filled tile
// reads as an alert even when the count is zero.
const KPI_TONES: Record<string, string> = {
  bad: BAD,
  good: GOOD,
  warn: WARN,
  neutral: NEUTRAL,
};

function Kpi({ label, value, tone, icon: Icon, onClick, active }: {
  label: string; value: number; tone: string; icon: typeof Clock;
  onClick?: () => void; active?: boolean;
}) {
  const body = (
    <>
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
      </div>
      <p className={cn("mt-2 text-2xl font-bold leading-none tabular-nums", KPI_TONES[tone] ?? NEUTRAL)}>
        {value.toLocaleString()}
      </p>
    </>
  );
  const base = "rounded-lg border border-border bg-card p-3 sm:p-4";

  if (!onClick) return <div className={base}>{body}</div>;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        base,
        "w-full text-left transition-colors hover:bg-muted/30",
        "focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]",
        active && "ring-2 ring-primary/60",
      )}
    >
      {body}
    </button>
  );
}

function Chip({ active, tone, label, count, onClick }: {
  active: boolean; tone: string; label: string; count: number; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex h-10 shrink-0 items-center gap-2 rounded-md border border-border bg-card px-3",
        "text-xs font-medium transition-colors hover:bg-muted/30 sm:h-9",
        "focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]",
        active && "ring-2 ring-primary/60",
      )}
    >
      <span className={cn("truncate", tone)}>{label}</span>
      <span className="shrink-0 text-sm font-bold tabular-nums text-muted-foreground">{count}</span>
    </button>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="truncate text-sm font-medium tabular-nums text-foreground">{value}</p>
    </div>
  );
}

// The full application, inline — no popup, no navigating away.
function ApplicationFacts({ row, onOpenFull }: { row: PipelineRow; onOpenFull: () => void }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 sm:p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          Application
        </p>
        <Button size="sm" variant="ghost" className="h-10 shrink-0 sm:h-9" onClick={onOpenFull}
                aria-label={`Open full application for ${row.display_name}`}>
          Full record <ArrowRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Fact label="License"      value={row.license_status} />
        <Fact label="Status"       value={row.application_status} />
        <Fact label="State"        value={row.state} />
        <Fact label="Prev company" value={row.previous_company} />
        <Fact label="Experience"   value={row.years_experience ? `${row.years_experience} yrs` : null} />
        <Fact label="Prev production" value={row.previous_production ? `$${Number(row.previous_production).toLocaleString()}` : null} />
        <Fact label="Team size"    value={row.previous_team_size || null} />
        <Fact label="Desired income" value={row.desired_income ? `$${Number(row.desired_income).toLocaleString()}` : null} />
        <Fact label="Source"       value={row.referral_source} />
      </div>
    </div>
  );
}

// Calendly-only recruit — booked by a VA straight from Instagram, never
// entered as an application. Surfacing it rather than hiding the row.
// Takes loose fields rather than a row type so the pipeline view and the
// prospect view explain "no application on file" in exactly one place.
function UnmatchedPanel({
  name, phone, email, instagram, theySaid, owner, eventType, matchCandidates,
}: {
  name: string;
  phone?: string | null;
  email?: string | null;
  instagram?: string | null;
  theySaid?: string | null;
  owner?: string | null;
  eventType?: string | null;
  matchCandidates?: number;
}) {
  const why =
    matchCandidates === undefined
      ? "Booked through Calendly without an APEX application. Everything known about them is below."
      : matchCandidates > 0
        ? `Booked through Calendly without an APEX application. ${matchCandidates} record${matchCandidates === 1 ? "" : "s"} in the system could be this person — nothing is linked yet.`
        : "Booked through Calendly without an APEX application, and no record in the system looks like them. This booking is everything Apex knows.";

  return (
    <div className="rounded-lg border border-amber-500/35 bg-amber-500/5 p-3 sm:p-4">
      <div className="flex items-start gap-3">
        <Link2Off className={cn("mt-0.5 h-5 w-5 shrink-0", WARN)} />
        <div className="min-w-0">
          <p className={cn("text-sm font-semibold", WARN)}>No application on file</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{why}</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Fact label="Name"      value={name} />
            <Fact label="Phone"     value={phone} />
            <Fact label="Instagram" value={instagram ? `@${instagram.replace(/^@/, "")}` : null} />
            <Fact label="Email"     value={email} />
            <Fact label="Booked"    value={eventType?.trim() || null} />
            <Fact label="Owner"     value={owner} />
            <Fact label="They said" value={theySaid} />
          </div>
        </div>
      </div>
    </div>
  );
}

function InterviewRow({
  row, expanded, selected, busy, onToggleSelect, onToggleExpand, onDispose, onOpenFull,
}: {
  row: PipelineRow;
  expanded: boolean;
  selected: boolean;
  busy: boolean;
  onToggleSelect: () => void;
  onToggleExpand: () => void;
  onDispose: (o: Outcome) => void;
  onOpenFull: () => void;
}) {
  const bucketMeta = BUCKETS.find((b) => b.key === row.bucket);
  const reasons = priorityReasons(row);

  return (
    <li className={cn(
      "rounded-lg border transition-colors",
      expanded
        ? "border-primary/50 bg-card"
        : "border-border/60 bg-card/60 hover:border-border hover:bg-card",
    )}>
      <div className="flex items-start gap-3 px-3 py-2.5 sm:items-center">
        <Checkbox
          checked={selected}
          onCheckedChange={onToggleSelect}
          aria-label={`Select ${row.display_name}`}
          className="mt-1 sm:mt-0"
        />

        <button
          type="button"
          onClick={onToggleExpand}
          className="min-w-0 flex-1 rounded-sm text-left focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]"
          aria-expanded={expanded}
          aria-label={`Toggle details for ${row.display_name}`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">{row.display_name}</span>
            {bucketMeta && (
              <Badge variant="outline" className={cn("shrink-0 border-border bg-muted/40 text-[10px] font-bold uppercase tracking-wide", bucketMeta.tone)}>
                {bucketMeta.label}
              </Badge>
            )}
            {!row.application_id && (
              <Badge variant="outline" className={cn("shrink-0", CATEGORY_CHIP)}>
                No application
              </Badge>
            )}
          </div>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {fmtChicago(row.scheduled_at)}
            {row.best_phone ? ` · ${row.best_phone}` : ""}
            {reasons.length ? ` · ${reasons.join(" · ")}` : ""}
          </p>
        </button>

        {row.days_overdue > 0 && (
          <div className="shrink-0 text-right">
            <div className={cn("text-sm font-bold tabular-nums", BAD)}>{row.days_overdue}d</div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">late</div>
          </div>
        )}

        <div className="flex shrink-0 items-center gap-1">
          {row.best_phone && (
            <Button asChild size="icon" variant="ghost" className="h-10 w-10 sm:h-9 sm:w-9"
                    aria-label={`Call ${row.display_name}`}>
              <a href={`tel:${row.best_phone.replace(/[^\d+]/g, "")}`}><Phone className="h-4 w-4" /></a>
            </Button>
          )}
          <Button size="icon" variant="ghost" className="h-10 w-10 sm:h-9 sm:w-9" onClick={onToggleExpand}
                  aria-label={expanded ? "Collapse" : "Expand"}>
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border/60 p-3">
          {row.application_id
            ? <ApplicationFacts row={row} onOpenFull={onOpenFull} />
            : <UnmatchedPanel
                name={row.display_name}
                phone={row.best_phone}
                email={row.best_email}
                instagram={row.instagram_handle}
                theySaid={row.invitee_status}
                eventType={row.event_type_name}
              />}

          {row.prep_notes && (
            <div className="mt-3 rounded-lg border border-border bg-card p-3 sm:p-4">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">They wrote</p>
              <p className="mt-1 break-words text-sm text-foreground">{row.prep_notes}</p>
            </div>
          )}

          {!row.outcome && (
            <div className="mt-3 flex flex-wrap gap-2">
              {DISPOSITIONS.map((d) => (
                <Button key={d.key} size="sm" variant="outline" disabled={busy}
                        className={dispositionClass(d.tone)}
                        onClick={() => onDispose(d.key)}
                        aria-label={`${d.label} — ${row.display_name}`}>
                  <d.icon className="mr-1.5 h-4 w-4 shrink-0" />{d.label}
                </Button>
              ))}
            </div>
          )}

          {row.outcome && (
            <p className="mt-3 break-words text-xs text-muted-foreground">
              Logged as <span className="font-medium text-foreground">{row.outcome.replace(/_/g, " ")}</span>
              {row.notes ? ` — ${row.notes}` : ""}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Prospect Review — the bucket for people who booked a recruiting call and
// exist in no other Apex system.
// ---------------------------------------------------------------------------
function ProspectQueue({
  query, rows, total, open, searching, expandedId, selected, busy,
  onToggleSelect, onToggleExpand, onDispose,
}: {
  query: { isLoading: boolean; isError: boolean; error: unknown; refetch: () => void };
  rows: ProspectRow[];
  total: number;
  open: number;
  searching: boolean;
  expandedId: string | null;
  selected: Set<string>;
  busy: boolean;
  onToggleSelect: (id: string) => void;
  onToggleExpand: (id: string) => void;
  onDispose: (p: ProspectRow, o: Outcome) => void;
}) {
  if (query.isLoading) {
    return (
      <GlassCard className="p-4">
        <div className="space-y-2">
          {/* stable-key-allow:skeleton */}
          {[1, 2, 3, 4, 5].map((n) => <Skeleton key={n} className="h-[76px] w-full rounded-lg" />)}
        </div>
      </GlassCard>
    );
  }

  // A query that threw must say so. A blank list would read as "all clear".
  if (query.isError) {
    return (
      <div className="rounded-lg border border-rose-500/35 bg-rose-500/5 p-3 sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <AlertTriangle className={cn("mt-0.5 h-5 w-5 shrink-0", BAD)} />
            <div className="min-w-0">
              <p className="text-sm font-semibold">Prospect queue did not load</p>
              <p className="mt-0.5 break-words text-xs text-muted-foreground">
                {(query.error as Error | null)?.message ?? "The prospect review view could not be read."}
              </p>
            </div>
          </div>
          <Button size="sm" variant="outline" className="h-10 w-full sm:h-9 sm:w-auto"
                  onClick={() => void query.refetch()}>
            <RefreshCw className="mr-1.5 h-4 w-4" /> Try again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <GlassCard className="p-4">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
          <Link2Off className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate">Prospect Review</span>
        </h3>
        <span className={cn("shrink-0 text-sm font-bold tabular-nums", open > 0 ? WARN : GOOD)}>
          {open.toLocaleString()} / {total.toLocaleString()}
        </span>
      </div>
      <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
        Licensed agents and team leaders who booked a call and exist nowhere else in Apex — no application,
        so no other screen in this product knows they are here.
      </p>

      {/* What these people are. This is the whole point of the bucket. */}
      <div className="mb-3 rounded-lg border border-amber-500/35 bg-amber-500/5 p-3 sm:p-4">
        <div className="flex items-start gap-3">
          <Link2Off className={cn("mt-0.5 h-5 w-5 shrink-0", WARN)} />
          <div className="min-w-0">
            <p className={cn("text-sm font-semibold", WARN)}>
              <span className="tabular-nums">{open}</span> of{" "}
              <span className="tabular-nums">{total}</span> still have no outcome recorded
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              This is real inbound recruiting demand. Recording an outcome is the action that puts them
              back in the pipeline.
            </p>
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 className="h-7 w-7" />}
          variant={searching ? "default" : "success"}
          title={searching ? "No prospect matches that search" : "Every booked prospect has an outcome"}
          description={
            searching
              ? "Try a first name, a phone number, or an Instagram handle."
              : "Every recruiting call booked outside an application has been dispositioned."
          }
        />
      ) : (
        <ul className="space-y-2">
          {rows.map((p) => (
            <ProspectRowCard
              key={p.interview_event_id}
              row={p}
              expanded={expandedId === p.interview_event_id}
              selected={selected.has(p.interview_event_id)}
              busy={busy}
              onToggleSelect={() => onToggleSelect(p.interview_event_id)}
              onToggleExpand={() => onToggleExpand(p.interview_event_id)}
              onDispose={(o) => onDispose(p, o)}
            />
          ))}
        </ul>
      )}
    </GlassCard>
  );
}

function ProspectRowCard({
  row, expanded, selected, busy, onToggleSelect, onToggleExpand, onDispose,
}: {
  row: ProspectRow;
  expanded: boolean;
  selected: boolean;
  busy: boolean;
  onToggleSelect: () => void;
  onToggleExpand: () => void;
  onDispose: (o: Outcome) => void;
}) {
  const name = prospectName(row);
  const track = row.call_track ?? "other";
  const handle = row.instagram_handle?.replace(/^@/, "") || null;
  const matches = Math.max(0, num(row.candidate_count));
  const stuck = Math.floor(Math.max(0, num(row.days_stuck)));

  return (
    <li className={cn(
      "rounded-lg border transition-colors",
      expanded
        ? "border-primary/50 bg-card"
        : "border-border/60 bg-card/60 hover:border-border hover:bg-card",
    )}>
      <div className="flex items-start gap-3 px-3 py-2.5 sm:items-center">
        <Checkbox
          checked={selected}
          onCheckedChange={onToggleSelect}
          aria-label={`Select ${name}`}
          className="mt-1 sm:mt-0"
        />

        <button
          type="button"
          onClick={onToggleExpand}
          className="min-w-0 flex-1 rounded-sm text-left focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]"
          aria-expanded={expanded}
          aria-label={`Toggle details for ${name}`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">{name}</span>
            <Badge variant="outline" className={cn("shrink-0", CATEGORY_CHIP)}>
              {TRACK_LABEL[track] ?? "Other"}
            </Badge>
            <Badge variant="outline" className={cn("shrink-0 border-border bg-muted/40 text-[10px] font-bold uppercase tracking-wide", WARN)}>
              {matches > 0 ? `No application · ${matches} possible match` : "No application"}
            </Badge>
            {isUpcoming(row) && (
              <Badge variant="outline" className={cn("shrink-0 border-border bg-muted/40 text-[10px] font-bold uppercase tracking-wide", GOOD)}>
                Upcoming
              </Badge>
            )}
          </div>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {fmtChicago(row.scheduled_at)}
            {` · ${prospectUrgency(row)}`}
            {row.invitee_phone ? ` · ${row.invitee_phone}` : handle ? ` · @${handle}` : ""}
          </p>
        </button>

        {!isUpcoming(row) && !row.outcome && (
          <div className="shrink-0 text-right">
            <div className={cn("text-sm font-bold tabular-nums", WARN)}>{stuck}d</div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">stuck</div>
          </div>
        )}

        {/* Sam works this from his phone — call and DM stay one tap away. */}
        <div className="flex shrink-0 items-center gap-1">
          {row.invitee_phone && (
            <Button asChild size="icon" variant="ghost" className="h-10 w-10 sm:h-9 sm:w-9"
                    aria-label={`Call ${name}`}>
              <a href={`tel:${row.invitee_phone.replace(/[^\d+]/g, "")}`}>
                <Phone className="h-4 w-4" />
              </a>
            </Button>
          )}
          {handle && (
            <Button asChild size="icon" variant="ghost" className="h-10 w-10 sm:h-9 sm:w-9"
                    aria-label={`Open Instagram for ${name}`}>
              <a href={`https://instagram.com/${handle}`} target="_blank" rel="noopener noreferrer">
                <Instagram className="h-4 w-4" />
              </a>
            </Button>
          )}
          <Button size="icon" variant="ghost" className="h-10 w-10 sm:h-9 sm:w-9" onClick={onToggleExpand}
                  aria-label={expanded ? "Collapse" : "Expand"}>
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border/60 p-3">
          <UnmatchedPanel
            name={name}
            phone={row.invitee_phone}
            email={row.invitee_email}
            instagram={row.instagram_handle}
            owner={row.owner}
            eventType={row.event_type_name}
            matchCandidates={matches}
          />

          {row.next_action && (
            <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
              <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 break-words">{row.next_action}</span>
            </p>
          )}

          {row.va_notes && (
            <div className="mt-3 rounded-lg border border-border bg-card p-3 sm:p-4">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">VA notes</p>
              <p className="mt-1 break-words text-sm text-foreground">{row.va_notes}</p>
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {row.invitee_phone && (
              <Button asChild size="sm" className="h-10 sm:h-9">
                <a href={`tel:${row.invitee_phone.replace(/[^\d+]/g, "")}`} aria-label={`Call ${name}`}>
                  <Phone className="mr-1.5 h-4 w-4" /> Call
                </a>
              </Button>
            )}
            {row.invitee_email && (
              <Button asChild size="sm" variant="outline" className="h-10 sm:h-9">
                <a href={`mailto:${row.invitee_email}`} aria-label={`Email ${name}`}>
                  <Mail className="mr-1.5 h-4 w-4" /> Email
                </a>
              </Button>
            )}
            {handle && (
              <Button asChild size="sm" variant="outline" className="h-10 max-w-full sm:h-9">
                <a href={`https://instagram.com/${handle}`} target="_blank" rel="noopener noreferrer"
                   aria-label={`Open Instagram for ${name}`}>
                  <Instagram className="mr-1.5 h-4 w-4" />
                  <span className="truncate">@{handle}</span>
                </a>
              </Button>
            )}
          </div>

          {!row.outcome && (
            <div className="mt-3 flex flex-wrap gap-2">
              {DISPOSITIONS.map((d) => (
                <Button key={d.key} size="sm" variant="outline" disabled={busy}
                        className={dispositionClass(d.tone)}
                        onClick={() => onDispose(d.key)}
                        aria-label={`${d.label} — ${name}`}>
                  <d.icon className="mr-1.5 h-4 w-4 shrink-0" />{d.label}
                </Button>
              ))}
            </div>
          )}

          {row.outcome && (
            <p className="mt-3 break-words text-xs text-muted-foreground">
              Logged as <span className="font-medium text-foreground">{row.outcome.replace(/_/g, " ")}</span>
              {row.notes ? ` — ${row.notes}` : ""}
            </p>
          )}
        </div>
      )}
    </li>
  );
}
