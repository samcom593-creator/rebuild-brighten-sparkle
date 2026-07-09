/**
 * MP-257 — VA Recovery Batch Drawer
 *
 * Structured single-record walkthrough for the Unlicensed Queue.
 * Cohort-based recovery script, contact block, outcome selector, notes composer,
 * follow-up scheduler, and next-record navigation. J/K keyboard shortcuts.
 *
 * Consumed by src/pages/admin/UnlicensedAll.tsx.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Ghost,
  GraduationCap,
  Instagram,
  Loader2,
  Mail,
  Phone,
  PhoneOff,
  ShieldOff,
  Sparkles,
  Trophy,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export interface RecoveryBatchRow {
  id: string;
  source: "applied" | "aged_lead";
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  state: string | null;
  license_progress: string | null;
  days_since_touch: number | null;
  assigned_va_email?: string | null;
  instagram_handle?: string | null;
  phone_bad_at?: string | null;
}

export type RecoveryOutcome =
  | "contacted"
  | "left_vm"
  | "text_sent"
  | "email_sent"
  | "wrong_number"
  | "no_answer"
  | "not_interested"
  | "course_restarted"
  | "exam_scheduled"
  | "passed_test"
  | "licensed"
  | "suppress";

interface OutcomePill {
  key: RecoveryOutcome;
  label: string;
  tone: string;
  icon?: React.ReactNode;
}

const OUTCOMES: OutcomePill[] = [
  { key: "contacted",        label: "Contacted",        tone: "border-emerald-500/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25", icon: <CheckCircle2 className="h-3 w-3" /> },
  { key: "left_vm",          label: "Left VM",          tone: "border-sky-500/40 bg-sky-500/15 text-sky-200 hover:bg-sky-500/25" },
  { key: "text_sent",        label: "Text sent",        tone: "border-sky-500/40 bg-sky-500/15 text-sky-200 hover:bg-sky-500/25" },
  { key: "email_sent",       label: "Email sent",       tone: "border-sky-500/40 bg-sky-500/15 text-sky-200 hover:bg-sky-500/25" },
  { key: "wrong_number",     label: "Wrong number",     tone: "border-rose-500/40 bg-rose-500/15 text-rose-200 hover:bg-rose-500/25", icon: <PhoneOff className="h-3 w-3" /> },
  { key: "no_answer",        label: "No answer",        tone: "border-amber-500/40 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25" },
  { key: "not_interested",   label: "Not interested",   tone: "border-slate-500/40 bg-slate-500/15 text-slate-200 hover:bg-slate-500/25" },
  { key: "course_restarted", label: "Course restarted", tone: "border-teal-500/40 bg-teal-500/15 text-teal-200 hover:bg-teal-500/25", icon: <GraduationCap className="h-3 w-3" /> },
  { key: "exam_scheduled",   label: "Exam scheduled",   tone: "border-amber-500/40 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25" },
  { key: "passed_test",      label: "Passed test",      tone: "border-emerald-500/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25", icon: <Trophy className="h-3 w-3" /> },
  { key: "licensed",         label: "Licensed",         tone: "border-emerald-500/40 bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/30" },
  { key: "suppress",         label: "Suppress",         tone: "border-rose-500/50 bg-rose-500/20 text-rose-100 hover:bg-rose-500/30", icon: <ShieldOff className="h-3 w-3" /> },
];

/**
 * Structured recovery script per cohort. Keyed by license_progress stage.
 * The 7 stages match Sam's brief exactly.
 */
function recoveryScript(row: RecoveryBatchRow): { title: string; body: string; hint: string } {
  const first = row.first_name?.trim() || "there";
  const stage = row.license_progress ?? "unlicensed";
  switch (stage) {
    case "waiting_on_license":
      return {
        title: "Waiting on License",
        body: `Hi ${first}, this is APEX Financial. Congrats on passing your test. We're calling to confirm your state license number came through. What's the status?`,
        hint: "Confirm license number arrived. If yes, log Licensed. If not, get expected date.",
      };
    case "passed_test":
      return {
        title: "Passed Test",
        body: `Hi ${first}, checking in on your license issuance. You passed your test — how many days until your state license comes through?`,
        hint: "Get expected issuance date. Set follow-up for that date.",
      };
    case "test_scheduled":
      return {
        title: "Test Scheduled",
        body: `Hi ${first}, reminder your exam is coming up. Are you feeling prepared? Any last questions before you take it?`,
        hint: "Confirm exam date. Offer study help if wobbly. Set follow-up for day after exam.",
      };
    case "finished_course":
      return {
        title: "Finished Course",
        body: `Hi ${first}, you finished your course — congrats. Let's get your exam scheduled. What day works best this week or next?`,
        hint: "Push to schedule TODAY. Suppress only if truly not moving forward.",
      };
    case "in_course":
      return {
        title: "Course In Progress",
        body: `Hi ${first}, checking your course progress. Where are you at right now? Any sections giving you trouble?`,
        hint: "Get % complete. Set follow-up 3-5 days out.",
      };
    case "course_purchased":
      return {
        title: "Bought Never Started",
        body: `Hi ${first}, we haven't seen you start the course yet — what's blocking you? Let's knock out module 1 together right now.`,
        hint: "Highest leverage. Get them into module 1 on the call.",
      };
    case "unlicensed":
    default:
      return {
        title: "Unlicensed Stale",
        body: `Hi ${first}, we've reached out several times. Are you still interested in getting licensed with APEX? Straight answer either way is fine.`,
        hint: "Straight yes/no. Suppress if no. Restart cadence if yes.",
      };
  }
}

function formatPhoneDisplay(raw: string | null): string {
  if (!raw) return "";
  const d = raw.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return raw;
}

function telHref(raw: string | null): string {
  if (!raw) return "#";
  const d = raw.replace(/\D/g, "");
  return `tel:${d.startsWith("1") ? "+" : "+1"}${d}`;
}

function displayName(r: RecoveryBatchRow): string {
  return [r.first_name, r.last_name].filter(Boolean).join(" ") || "(unknown)";
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  queue: RecoveryBatchRow[];
  startIndex?: number;
  onRequestSuppress: (row: RecoveryBatchRow) => void;
}

export function RecoveryBatchDrawer({
  open,
  onOpenChange,
  queue,
  startIndex = 0,
  onRequestSuppress,
}: Props) {
  const qc = useQueryClient();
  const [index, setIndex] = useState<number>(startIndex);
  const [notes, setNotes] = useState<string>("");
  const [followUp, setFollowUp] = useState<Date | undefined>(undefined);

  // Re-anchor whenever the drawer opens or the queue changes shape.
  useEffect(() => {
    if (open) {
      setIndex(Math.min(startIndex, Math.max(0, queue.length - 1)));
    }
  }, [open, startIndex, queue.length]);

  useEffect(() => {
    setNotes("");
    setFollowUp(undefined);
  }, [index]);

  const row = queue[index];

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["v_unlicensed_all"] });
    qc.invalidateQueries({ queryKey: ["mp257_kpis"] });
  }, [qc]);

  const gotoNext = useCallback(() => {
    if (index + 1 < queue.length) setIndex((i) => i + 1);
    else {
      toast.success("Queue complete — you finished the batch");
      onOpenChange(false);
    }
  }, [index, queue.length, onOpenChange]);

  const gotoPrev = useCallback(() => {
    if (index > 0) setIndex((i) => i - 1);
  }, [index]);

  const logOutcome = useMutation({
    mutationFn: async ({ outcome, extraNotes }: { outcome: RecoveryOutcome; extraNotes?: string }) => {
      if (!row) return;
      const notesPayload = [notes.trim(), extraNotes?.trim()].filter(Boolean).join(" | ") || null;

      // Wrong number = mark bad phone via the existing unified RPC
      if (outcome === "wrong_number") {
        await supabase.rpc("unified_mark_phone_bad" as any, {
          p_id: row.id,
          p_source: row.source,
          p_reason: "wrong_number",
        });
      }

      // Passed test / Licensed / Exam scheduled / Course restarted → advance stage
      const stageMap: Partial<Record<RecoveryOutcome, string>> = {
        passed_test: "passed_test",
        licensed: "waiting_on_license",
        exam_scheduled: "test_scheduled",
        course_restarted: "in_course",
      };
      const targetStage = stageMap[outcome];
      if (targetStage) {
        await supabase.rpc("unified_set_license_progress" as any, {
          p_id: row.id,
          p_progress: targetStage,
          p_source: row.source,
        });
      }

      // Any real contact touch → bump last_contacted_at via unified_mark_contacted.
      const contactedOutcomes: RecoveryOutcome[] = [
        "contacted", "left_vm", "text_sent", "email_sent", "no_answer",
      ];
      if (contactedOutcomes.includes(outcome)) {
        await supabase.rpc("unified_mark_contacted" as any, {
          p_id: row.id,
          p_source: row.source,
        });
      }

      // If licensed, stamp licensed_at + license_status on applications (aged_leads have no licensed_at).
      if (outcome === "licensed" && row.source === "applied") {
        await supabase
          .from("applications")
          .update({
            license_status: "licensed",
            licensed_at: new Date().toISOString(),
          } as any)
          .eq("id", row.id);
      }

      // Log every outcome (skips silently for aged_lead — RPC only accepts application_id).
      if (row.source === "applied") {
        try {
          await supabase.rpc("log_contact_attempt" as any, {
            p_application_id: row.id,
            p_channel: "recovery_batch",
            p_outcome: outcome,
            p_notes: notesPayload,
          });
        } catch { // empty-catch-allow:fire-and-forget-telemetry
          // outcome log must not block state changes.
        }
      }

      // Persist notes to the source row when we have content.
      if (notesPayload) {
        const table = row.source === "applied" ? "applications" : "aged_leads";
        await supabase
          .from(table as any)
          .update({ notes: notesPayload } as any)
          .eq("id", row.id);
      }
    },
    onSuccess: (_v, vars) => {
      toast.success(`Logged: ${vars.outcome.replaceAll("_", " ")}`);
      invalidate();
      // Auto-advance for the "moving on" outcomes; hold for reviewy ones.
      const advance: RecoveryOutcome[] = [
        "contacted", "left_vm", "text_sent", "email_sent",
        "no_answer", "not_interested", "wrong_number", "licensed",
        "passed_test", "exam_scheduled", "course_restarted",
      ];
      if (advance.includes(vars.outcome)) gotoNext();
    },
    onError: (e) => toast.error(`Log failed: ${String(e)}`),
  });

  const scheduleFollowUp = useMutation({
    mutationFn: async () => {
      if (!row || !followUp) return;
      const iso = followUp.toISOString();
      const table = row.source === "applied" ? "applications" : "aged_leads";
      const { error } = await supabase
        .from(table as any)
        .update({ next_action_due_at: iso } as any)
        .eq("id", row.id);
      if (error) throw error;
      // Log the follow-up as a contact attempt so the timeline reflects it.
      if (row.source === "applied") {
        try {
          await supabase.rpc("log_contact_attempt" as any, {
            p_application_id: row.id,
            p_channel: "recovery_batch",
            p_outcome: "follow_up_scheduled",
            p_notes: `Follow up: ${format(followUp, "PPP")}`,
          });
        } catch { // empty-catch-allow:fire-and-forget-telemetry
          // follow-up log must not block the update.
        }
      }
    },
    onSuccess: () => {
      toast.success(followUp ? `Follow-up ${format(followUp, "PPP")}` : "Scheduled");
      invalidate();
      gotoNext();
    },
    onError: (e) => toast.error(`Schedule failed: ${String(e)}`),
  });

  // Keyboard: J = next, K = previous, ESC handled by Sheet.
  useEffect(() => {
    if (!open) return;
    function handler(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "j" || e.key === "J") { e.preventDefault(); gotoNext(); }
      if (e.key === "k" || e.key === "K") { e.preventDefault(); gotoPrev(); }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, gotoNext, gotoPrev]);

  const script = useMemo(() => (row ? recoveryScript(row) : null), [row]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl overflow-y-auto bg-[#0B1118] text-slate-100 border-white/10"
      >
        <SheetHeader className="text-left">
          <div className="flex items-center justify-between gap-2">
            <SheetTitle className="text-slate-100 inline-flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-teal-300" />
              VA Recovery Batch
            </SheetTitle>
            <span className="text-[10px] uppercase tracking-widest text-slate-500">
              {queue.length === 0 ? "empty" : `${index + 1} of ${queue.length}`}
            </span>
          </div>
          <SheetDescription className="text-slate-400 text-xs">
            Work the highest-priority ghosted 30d+ unassigned pile top-to-bottom. Press J for next, K for previous.
          </SheetDescription>
        </SheetHeader>

        {!row && (
          <div className="mt-8 rounded-xl border border-white/10 bg-white/[0.03] p-6 text-center text-sm text-slate-400">
            No records match this batch. Adjust filters or wait for tomorrow's ghost pile.
          </div>
        )}

        {row && script && (
          <div className="mt-4 space-y-4">
            {/* Identity */}
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-lg font-semibold text-slate-100">{displayName(row)}</div>
                  <div className="mt-0.5 text-xs text-slate-400">
                    {row.state && <span>{row.state} · </span>}
                    <span className="uppercase tracking-wide">{(row.license_progress ?? "unlicensed").replaceAll("_", " ")}</span>
                    {(row.days_since_touch ?? 0) > 0 && (
                      <span className="inline-flex items-center gap-1 ml-2 text-rose-300/80">
                        <Ghost className="h-3 w-3" />
                        {row.days_since_touch}d ghosted
                      </span>
                    )}
                  </div>
                </div>
                {row.assigned_va_email && (
                  <span className="text-[10px] text-emerald-300/80 max-w-[140px] truncate">→ {row.assigned_va_email}</span>
                )}
              </div>
            </div>

            {/* Script */}
            <div className="rounded-xl border border-teal-500/25 bg-teal-500/[0.06] p-4">
              <div className="text-[10px] uppercase tracking-widest text-teal-300/80">Recovery script · {script.title}</div>
              <p className="mt-2 text-sm text-slate-100 leading-relaxed">{script.body}</p>
              <p className="mt-2 text-[11px] text-slate-400 italic">Coach: {script.hint}</p>
            </div>

            {/* Contact block */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {row.phone && !row.phone_bad_at && (
                <a
                  href={telHref(row.phone)}
                  aria-label={`Call ${displayName(row)}`}
                  className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-200 px-3 py-3 text-sm font-semibold"
                >
                  <Phone className="h-4 w-4" /> {formatPhoneDisplay(row.phone)}
                </a>
              )}
              {row.phone && row.phone_bad_at && (
                <div className="inline-flex items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-200 px-3 py-3 text-sm">
                  <PhoneOff className="h-4 w-4" /> bad number
                </div>
              )}
              {row.email && (
                <a
                  href={`mailto:${row.email}`}
                  aria-label={`Email ${row.email}`}
                  className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.05] hover:bg-white/[0.10] text-slate-200 px-3 py-3 text-sm font-semibold truncate"
                  title={row.email}
                >
                  <Mail className="h-4 w-4 shrink-0" />
                  <span className="truncate">{row.email}</span>
                </a>
              )}
              {row.instagram_handle && (
                <a
                  href={`https://instagram.com/${row.instagram_handle.replace(/^@+/, "")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Instagram @${row.instagram_handle.replace(/^@+/, "")}`}
                  className="inline-flex items-center gap-2 rounded-lg border border-pink-500/40 bg-pink-500/10 hover:bg-pink-500/20 text-pink-200 px-3 py-3 text-sm font-semibold"
                >
                  <Instagram className="h-4 w-4" /> @{row.instagram_handle.replace(/^@+/, "")}
                </a>
              )}
            </div>

            {/* Notes composer */}
            <div>
              <label htmlFor="mp257-notes" className="text-[10px] uppercase tracking-widest text-slate-500">
                Notes (optional — logged with the outcome)
              </label>
              <Textarea
                id="mp257-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Reached mom. Said Jason is at work — call back after 6pm."
                className="mt-1 min-h-[80px] bg-white/[0.03] border-white/10 text-slate-100 placeholder:text-slate-500"
              />
            </div>

            {/* Outcome pills */}
            <div>
              <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-2">Outcome</div>
              <div className="flex flex-wrap gap-1.5">
                {OUTCOMES.map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    onClick={() => {
                      if (o.key === "suppress") {
                        onRequestSuppress(row);
                        return;
                      }
                      logOutcome.mutate({ outcome: o.key });
                    }}
                    disabled={logOutcome.isPending}
                    aria-label={`Log outcome: ${o.label}`}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                      o.tone,
                      logOutcome.isPending && "opacity-60 cursor-not-allowed",
                    )}
                  >
                    {o.icon}
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Follow-up scheduler */}
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-2">Schedule follow-up</div>
              <div className="flex flex-wrap items-center gap-2">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 justify-start bg-white/[0.03] border-white/10 text-slate-200"
                      aria-label="Pick follow-up date"
                    >
                      <CalendarClock className="h-3.5 w-3.5 mr-2" />
                      {followUp ? format(followUp, "PPP") : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0 bg-[#0B1118] border-white/10" align="start">
                    <Calendar
                      mode="single"
                      selected={followUp}
                      onSelect={setFollowUp}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
                <Button
                  size="sm"
                  className="h-9 bg-teal-500 text-slate-950 hover:bg-teal-400 disabled:opacity-60"
                  onClick={() => scheduleFollowUp.mutate()}
                  disabled={!followUp || scheduleFollowUp.isPending}
                  aria-label="Confirm follow-up date"
                >
                  {scheduleFollowUp.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                  Schedule + next
                </Button>
              </div>
            </div>

            {/* Nav footer */}
            <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/10">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={gotoPrev}
                disabled={index === 0}
                className="text-slate-300 hover:text-slate-100"
                aria-label="Previous record"
              >
                <ArrowLeft className="h-3.5 w-3.5 mr-1.5" /> Prev (K)
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onOpenChange(false)}
                className="text-slate-400"
                aria-label="Close drawer"
              >
                <X className="h-3.5 w-3.5 mr-1.5" /> Close
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={gotoNext}
                className="bg-white/10 hover:bg-white/20 text-slate-100"
                aria-label="Next record"
              >
                Next (J) <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
