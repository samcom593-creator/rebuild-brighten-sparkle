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

// ---------------------------------------------------------------------------
// Bucket presentation — colour is never the only signal, every chip has a label
// ---------------------------------------------------------------------------
const BUCKETS: { key: Bucket; label: string; tone: string }[] = [
  { key: "starting_soon",     label: "Starting in 15 min", tone: "text-amber-300 border-amber-500/40 bg-amber-500/10" },
  { key: "overdue_today",     label: "Overdue Today",      tone: "text-rose-300 border-rose-500/40 bg-rose-500/10" },
  { key: "today",             label: "Today",              tone: "text-emerald-300 border-emerald-500/40 bg-emerald-500/10" },
  { key: "missed_yesterday",  label: "Missed Yesterday",   tone: "text-rose-300 border-rose-500/40 bg-rose-500/10" },
  { key: "missed_2_7",        label: "Missed 2–7 Days",    tone: "text-orange-300 border-orange-500/40 bg-orange-500/10" },
  { key: "missed_7_plus",     label: "Missed 7+ Days",     tone: "text-red-300 border-red-500/40 bg-red-500/10" },
  { key: "needs_reschedule",  label: "Needs Reschedule",   tone: "text-amber-300 border-amber-500/40 bg-amber-500/10" },
  { key: "contacted_waiting", label: "Contacted · Waiting",tone: "text-sky-300 border-sky-500/40 bg-sky-500/10" },
  { key: "confirmed",         label: "Confirmed",          tone: "text-teal-300 border-teal-500/40 bg-teal-500/10" },
  { key: "upcoming",          label: "Upcoming",           tone: "text-slate-300 border-slate-500/40 bg-slate-500/10" },
  { key: "completed",         label: "Completed",          tone: "text-emerald-300 border-emerald-500/40 bg-emerald-500/10" },
  { key: "no_show",           label: "No Show",            tone: "text-zinc-300 border-zinc-500/40 bg-zinc-500/10" },
  { key: "not_interested",    label: "Not Interested",     tone: "text-zinc-400 border-zinc-600/40 bg-zinc-600/10" },
  { key: "canceled",          label: "Canceled",           tone: "text-zinc-400 border-zinc-600/40 bg-zinc-600/10" },
];

const DISPOSITIONS: { key: Outcome; label: string; icon: typeof Check; tone: string; hotkey: string }[] = [
  { key: "completed",      label: "Completed",   icon: CheckCircle2, tone: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40", hotkey: "1" },
  { key: "hired",          label: "Hired",       icon: UserCheck,    tone: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40", hotkey: "2" },
  { key: "no_answer",      label: "No Answer",   icon: PhoneOff,     tone: "bg-slate-500/15 text-slate-300 border-slate-500/40",       hotkey: "3" },
  { key: "no_show",        label: "No Show",     icon: UserX,        tone: "bg-zinc-500/15 text-zinc-300 border-zinc-500/40",          hotkey: "4" },
  { key: "rescheduled",    label: "Reschedule",  icon: CalendarClock,tone: "bg-amber-500/15 text-amber-300 border-amber-500/40",       hotkey: "5" },
  { key: "callback",       label: "Call Back",   icon: Phone,        tone: "bg-sky-500/15 text-sky-300 border-sky-500/40",             hotkey: "6" },
  { key: "not_interested", label: "Not Interested", icon: XCircle,   tone: "bg-rose-500/15 text-rose-300 border-rose-500/40",          hotkey: "7" },
  { key: "bad_number",     label: "Bad Number",  icon: PhoneOff,     tone: "bg-rose-500/15 text-rose-300 border-rose-500/40",          hotkey: "8" },
];

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

// ---------------------------------------------------------------------------
export default function InterviewRecovery() {
  usePageTitle("Interview Recovery");
  const qc = useQueryClient();

  const [activeBucket, setActiveBucket] = useState<Bucket | "backlog" | "all">("backlog");
  const [search, setSearch] = useState("");
  const [catchUp, setCatchUp] = useState(false);
  const [catchIndex, setCatchIndex] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailAppId, setDetailAppId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [noteDraft, setNoteDraft] = useState("");
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

  const rows = useMemo(() => pipeline.data ?? [], [pipeline.data]);

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of rows) m[r.bucket] = (m[r.bucket] ?? 0) + 1;
    return m;
  }, [rows]);

  const backlog = useMemo(() => rows.filter((r) => r.is_backlog), [rows]);

  const filtered = useMemo(() => {
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

  const dispose = useCallback(
    async (row: PipelineRow, outcome: Outcome, notes?: string) => {
      setBusy(true);
      try {
        const { error } = await (supabase as any).rpc("cc_dispose_interview", {
          p_id: row.id,
          p_outcome: outcome,
          p_notes: notes && notes.trim() ? notes.trim() : null,
          p_followup_due_at: null,
        });
        if (error) throw error;

        toast.success(`${row.display_name} → ${outcome.replace(/_/g, " ")}`, {
          action: {
            label: "Undo",
            onClick: async () => {
              const { error: undoErr } = await (supabase as any)
                .from("interview_events")
                .update({ outcome: null, outcome_at: null })
                .eq("id", row.id);
              if (undoErr) toast.error(`Undo failed: ${undoErr.message}`);
              else {
                toast.success("Reverted");
                qc.invalidateQueries({ queryKey: ["interview-pipeline"] });
              }
            },
          },
        });
        await qc.invalidateQueries({ queryKey: ["interview-pipeline"] });
      } catch (err) {
        // Never swallow — a silent failure here is the exact bug this page fixes.
        toast.error(`Could not log outcome: ${(err as Error).message}`);
      } finally {
        setBusy(false);
      }
    },
    [qc],
  );

  const disposeAndAdvance = useCallback(
    async (outcome: Outcome) => {
      if (!current) return;
      await dispose(current, outcome, noteDraft);
      setNoteDraft("");
      setCatchIndex((i) => Math.min(i + 1, Math.max(0, catchQueue.length - 2)));
    },
    [current, dispose, noteDraft, catchQueue.length],
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
      await qc.invalidateQueries({ queryKey: ["interview-pipeline"] });
      if (failures.length) toast.error(`${ok} logged, ${failures.length} failed: ${failures[0]}`);
      else toast.success(`${ok} logged as ${outcome.replace(/_/g, " ")}`);
    },
    [selected, qc],
  );

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

  // -------------------------------------------------------------------------
  // Catch Up — one candidate at a time, full screen
  // -------------------------------------------------------------------------
  if (catchUp) {
    if (!current) {
      return (
        <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 p-6 text-center">
          <CheckCircle2 className="h-16 w-16 text-emerald-400" />
          <h2 className="text-2xl font-semibold">Backlog clear</h2>
          <p className="text-muted-foreground">Every interview has an outcome logged.</p>
          <Button onClick={() => setCatchUp(false)}>Back to queue</Button>
        </div>
      );
    }

    const reasons = priorityReasons(current);

    return (
      <div className="mx-auto w-full max-w-5xl p-4 sm:p-6">
        {/* progress */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Badge className="bg-teal-500/15 text-teal-300 border-teal-500/40">
              {catchIndex + 1} of {catchQueue.length}
            </Badge>
            <span className="text-sm text-muted-foreground">
              {catchQueue.length - catchIndex - 1} left
            </span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setCatchUp(false)} aria-label="Exit Catch Up mode">
            <X className="mr-1 h-4 w-4" /> Exit
          </Button>
        </div>

        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full rounded-full bg-teal-500 transition-all"
            style={{ width: `${((catchIndex + 1) / Math.max(1, catchQueue.length)) * 100}%` }}
          />
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          {/* main */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="truncate text-2xl font-semibold">{current.display_name}</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {current.event_type_name?.trim() || "Interview"} · scheduled {fmtChicago(current.scheduled_at)}
                  {current.days_overdue > 0 && (
                    <span className="text-rose-300"> · {relativeDays(current.days_overdue)}</span>
                  )}
                </p>
              </div>
              <Badge className={cn("shrink-0", current.call_track === "licensed"
                ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
                : "bg-violet-500/15 text-violet-300 border-violet-500/40")}>
                {current.call_track === "licensed" ? "Licensed Call" : "Leader Call"}
              </Badge>
            </div>

            {reasons.length > 0 && (
              <p className="mt-2 text-xs text-teal-300/90">{reasons.join(" · ")}</p>
            )}

            {/* contact actions */}
            <div className="mt-5 flex flex-wrap gap-2">
              {current.best_phone && (
                <Button asChild className="bg-teal-500 text-slate-950 hover:bg-teal-400">
                  <a href={`tel:${current.best_phone.replace(/[^\d+]/g, "")}`} aria-label={`Call ${current.display_name}`}>
                    <Phone className="mr-2 h-4 w-4" /> Call {current.best_phone}
                  </a>
                </Button>
              )}
              {current.best_email && (
                <Button asChild variant="outline">
                  <a href={`mailto:${current.best_email}`} aria-label={`Email ${current.display_name}`}>
                    <Mail className="mr-2 h-4 w-4" /> Email
                  </a>
                </Button>
              )}
              {current.instagram_handle && (
                <Button asChild variant="outline">
                  <a href={`https://instagram.com/${current.instagram_handle.replace(/^@/, "")}`}
                     target="_blank" rel="noopener noreferrer"
                     aria-label={`Open Instagram for ${current.display_name}`}>
                    <Instagram className="mr-2 h-4 w-4" /> @{current.instagram_handle.replace(/^@/, "")}
                  </a>
                </Button>
              )}
              {current.reschedule_url && (
                <Button asChild variant="outline">
                  <a href={current.reschedule_url} target="_blank" rel="noopener noreferrer"
                     aria-label={`Reschedule ${current.display_name}`}>
                    <CalendarClock className="mr-2 h-4 w-4" /> Reschedule link
                  </a>
                </Button>
              )}
            </div>

            {/* the full application, inline */}
            <div className="mt-6">
              {current.application_id ? (
                <ApplicationFacts row={current} onOpenFull={() => setDetailAppId(current.application_id)} />
              ) : (
                <UnmatchedPanel row={current} />
              )}
            </div>

            {current.prep_notes && (
              <div className="mt-4 rounded-lg border border-sky-500/30 bg-sky-500/5 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-sky-300">They wrote</p>
                <p className="mt-1 text-sm text-slate-200">{current.prep_notes}</p>
              </div>
            )}
          </div>

          {/* right rail */}
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Call agenda
              </p>
              <ul className="space-y-1.5 text-sm text-slate-300">
                {(current.call_track === "licensed"
                  ? ["Confirm license + states", "Current production", "Why leaving", "Apex comp", "Close to contracting"]
                  : ["Team size today", "Income goal", "Leadership history", "Apex override structure", "Close to next step"]
                ).map((line) => (
                  <li key={line} className="flex items-start gap-2">
                    <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-400" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
              <label htmlFor="catchup-notes" className="mb-2 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Call notes
              </label>
              <Textarea
                id="catchup-notes"
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                placeholder="What happened on this call…"
                rows={5}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              {DISPOSITIONS.map((d) => (
                <Button
                  key={d.key}
                  variant="outline"
                  disabled={busy}
                  className={cn("justify-start border", d.tone)}
                  onClick={() => void disposeAndAdvance(d.key)}
                  aria-label={`${d.label} — ${current.display_name}`}
                >
                  <d.icon className="mr-2 h-4 w-4" />
                  <span className="truncate">{d.label}</span>
                  <kbd className="ml-auto hidden text-[10px] opacity-60 sm:inline">{d.hotkey}</kbd>
                </Button>
              ))}
            </div>

            <div className="flex gap-2">
              <Button variant="ghost" className="flex-1" disabled={catchIndex === 0}
                      onClick={() => setCatchIndex((i) => Math.max(0, i - 1))} aria-label="Previous candidate">
                Previous
              </Button>
              <Button variant="ghost" className="flex-1"
                      onClick={() => setCatchIndex((i) => Math.min(i + 1, catchQueue.length - 1))}
                      aria-label="Skip to next candidate">
                <SkipForward className="mr-1 h-4 w-4" /> Skip
              </Button>
            </div>
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
    <div className="w-full max-w-full space-y-5 p-4 sm:p-6">
      <PageHeader
        title="Interview Recovery"
        subtitle={
          backlog.length
            ? `${backlog.length} interviews waiting to be logged · oldest ${relativeDays(oldest)}`
            : "Every interview has an outcome logged."
        }
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Backlog"        value={backlog.length}                     tone="rose"    icon={AlertTriangle} />
        <Kpi label="Today"          value={(counts.today ?? 0) + (counts.overdue_today ?? 0)} tone="emerald" icon={Clock} />
        <Kpi label="Starting soon"  value={counts.starting_soon ?? 0}          tone="amber"   icon={Zap} />
        <Kpi label="Upcoming"       value={counts.upcoming ?? 0}               tone="slate"   icon={CalendarClock} />
        <Kpi label="Completed"      value={counts.completed ?? 0}              tone="teal"    icon={CheckCircle2} />
        <Kpi label="Unmatched"      value={rows.filter((r) => !r.application_id).length} tone="violet" icon={Link2Off} />
      </div>

      {/* actions */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          className="bg-teal-500 text-slate-950 hover:bg-teal-400"
          disabled={!backlog.length}
          onClick={() => { setCatchIndex(0); setCatchUp(true); }}
        >
          <Rocket className="mr-2 h-4 w-4" />
          Catch Up{backlog.length ? ` (${backlog.length})` : ""}
        </Button>
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, phone, IG, company…"
            className="pl-9"
            aria-label="Search interviews"
          />
        </div>
        <Button variant="outline" size="icon" aria-label="Refresh interview queue"
                onClick={() => void pipeline.refetch()}>
          <RefreshCw className={cn("h-4 w-4", pipeline.isFetching && "animate-spin")} />
        </Button>
      </div>

      {/* bucket chips */}
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        <Chip active={activeBucket === "backlog"} tone="text-rose-300 border-rose-500/40 bg-rose-500/10"
              label="Catch Up Queue" count={backlog.length} onClick={() => setActiveBucket("backlog")} />
        <Chip active={activeBucket === "all"} tone="text-slate-300 border-slate-500/40 bg-slate-500/10"
              label="All" count={rows.length} onClick={() => setActiveBucket("all")} />
        {BUCKETS.filter((b) => (counts[b.key] ?? 0) > 0).map((b) => (
          <Chip key={b.key} active={activeBucket === b.key} tone={b.tone} label={b.label}
                count={counts[b.key] ?? 0} onClick={() => setActiveBucket(b.key)} />
        ))}
      </div>

      {/* bulk bar */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-teal-500/30 bg-teal-500/5 p-3">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <Button size="sm" variant="outline" disabled={busy}
                  onClick={() => void bulkDispose("no_answer")}>
            <PhoneOff className="mr-1.5 h-3.5 w-3.5" /> No Answer
          </Button>
          <Button size="sm" variant="outline" disabled={busy}
                  onClick={() => void bulkDispose("no_show")}>
            <UserX className="mr-1.5 h-3.5 w-3.5" /> No Show
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}

      {/* list */}
      {pipeline.isLoading ? (
        <div className="space-y-2">
          {/* stable-key-allow:skeleton */}
          {[1, 2, 3, 4, 5].map((n) => <Skeleton key={n} className="h-20 w-full" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-10 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-400" />
          <p className="mt-3 font-medium">Nothing here</p>
          <p className="text-sm text-muted-foreground">
            {search ? "No interviews match that search." : "This queue is empty."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
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
        </div>
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
function Kpi({ label, value, tone, icon: Icon }: {
  label: string; value: number; tone: string; icon: typeof Clock;
}) {
  const tones: Record<string, string> = {
    rose: "text-rose-300 border-rose-500/30",
    emerald: "text-emerald-300 border-emerald-500/30",
    amber: "text-amber-300 border-amber-500/30",
    slate: "text-slate-300 border-slate-500/30",
    teal: "text-teal-300 border-teal-500/30",
    violet: "text-violet-300 border-violet-500/30",
  };
  return (
    <div className={cn("rounded-lg border bg-slate-950/60 p-3", tones[tone])}>
      <div className="flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5" />
        <span className="truncate text-xs text-muted-foreground">{label}</span>
      </div>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
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
        "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition",
        tone,
        active && "ring-2 ring-teal-400/70",
      )}
    >
      {label}
      <span className="rounded-full bg-black/30 px-1.5 tabular-nums">{count}</span>
    </button>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="truncate text-sm text-slate-200">{value}</p>
    </div>
  );
}

// The full application, inline — no popup, no navigating away.
function ApplicationFacts({ row, onOpenFull }: { row: PipelineRow; onOpenFull: () => void }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Application</p>
        <Button size="sm" variant="ghost" onClick={onOpenFull} aria-label={`Open full application for ${row.display_name}`}>
          Full record <ArrowRight className="ml-1 h-3.5 w-3.5" />
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
function UnmatchedPanel({ row }: { row: PipelineRow }) {
  return (
    <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-4">
      <div className="flex items-start gap-2">
        <Link2Off className="mt-0.5 h-4 w-4 shrink-0 text-violet-300" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-violet-200">No application on file</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Booked through Calendly without an APEX application. Everything known
            about them is below.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Fact label="Name"      value={row.display_name} />
            <Fact label="Phone"     value={row.best_phone} />
            <Fact label="Instagram" value={row.instagram_handle ? `@${row.instagram_handle.replace(/^@/, "")}` : null} />
            <Fact label="Email"     value={row.best_email} />
            <Fact label="They said" value={row.invitee_status} />
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
    <div className={cn(
      "rounded-lg border bg-slate-950/60 transition",
      expanded ? "border-teal-500/40" : "border-slate-800",
    )}>
      <div className="flex items-start gap-3 p-3 sm:items-center">
        <Checkbox
          checked={selected}
          onCheckedChange={onToggleSelect}
          aria-label={`Select ${row.display_name}`}
          className="mt-1 sm:mt-0"
        />

        <button
          type="button"
          onClick={onToggleExpand}
          className="min-w-0 flex-1 text-left"
          aria-expanded={expanded}
          aria-label={`Toggle details for ${row.display_name}`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-medium">{row.display_name}</span>
            {bucketMeta && (
              <Badge className={cn("shrink-0 text-[10px]", bucketMeta.tone)}>{bucketMeta.label}</Badge>
            )}
            {!row.application_id && (
              <Badge className="shrink-0 border-violet-500/40 bg-violet-500/10 text-[10px] text-violet-300">
                No application
              </Badge>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {fmtChicago(row.scheduled_at)}
            {row.best_phone ? ` · ${row.best_phone}` : ""}
            {reasons.length ? ` · ${reasons.join(" · ")}` : ""}
          </p>
        </button>

        <div className="flex shrink-0 items-center gap-1">
          {row.best_phone && (
            <Button asChild size="icon" variant="ghost" aria-label={`Call ${row.display_name}`}>
              <a href={`tel:${row.best_phone.replace(/[^\d+]/g, "")}`}><Phone className="h-4 w-4" /></a>
            </Button>
          )}
          <Button size="icon" variant="ghost" onClick={onToggleExpand}
                  aria-label={expanded ? "Collapse" : "Expand"}>
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-slate-800 p-3">
          {row.application_id
            ? <ApplicationFacts row={row} onOpenFull={onOpenFull} />
            : <UnmatchedPanel row={row} />}

          {row.prep_notes && (
            <div className="mt-3 rounded-lg border border-sky-500/30 bg-sky-500/5 p-3">
              <p className="text-[11px] uppercase tracking-wide text-sky-300">They wrote</p>
              <p className="mt-1 text-sm text-slate-200">{row.prep_notes}</p>
            </div>
          )}

          {!row.outcome && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {DISPOSITIONS.map((d) => (
                <Button key={d.key} size="sm" variant="outline" disabled={busy}
                        className={cn("border text-xs", d.tone)}
                        onClick={() => onDispose(d.key)}
                        aria-label={`${d.label} — ${row.display_name}`}>
                  <d.icon className="mr-1.5 h-3.5 w-3.5" />{d.label}
                </Button>
              ))}
            </div>
          )}

          {row.outcome && (
            <p className="mt-3 text-xs text-muted-foreground">
              Logged as <span className="text-slate-200">{row.outcome.replace(/_/g, " ")}</span>
              {row.notes ? ` — ${row.notes}` : ""}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
