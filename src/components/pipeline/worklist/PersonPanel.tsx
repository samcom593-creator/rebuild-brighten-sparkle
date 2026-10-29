import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, Ban, CalendarCheck, ChevronRight, Clock, Loader2, Mail, MessageSquare, Pencil, Phone, PhoneMissed, PhoneOff, ThumbsDown, ThumbsUp, UserPlus, type LucideIcon } from "lucide-react";
import { toast } from "sonner";

import { celebrate, type CelebrationKind, type CelebrationOrigin } from "@/lib/celebrate";
import { TONE_CLASS, type Tone } from "@/lib/tones";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { StatusPill } from "@/components/recruiting/StatusPill";
import { contactLinkProps, formatPhoneDisplay, isDialablePhone, phoneHref, smsHref } from "@/lib/phone";
import {
  CHANNEL_LABELS,
  CONTACT_CHANNELS,
  EMPTY_DRAFT,
  OUTCOME_DEFINITIONS,
  blockersOf,
  channelAvailability,
  describeSaveError,
  fullName,
  localInputToIso,
  outcomeDefinition,
  outcomeLabel,
  planCheck,
  validateOutcomeDraft,
  type ContactChannel,
  type ContactOutcome,
  type OutcomeDraft,
  type WorklistRow,
} from "@/lib/recruitingQueues";
import { clearDraft, loadDraft, saveDraft } from "@/lib/worklistDraftStore";
import { cn } from "@/lib/utils";
import {
  useContactHistory,
  useWorklistMutations,
  type StaffMember,
  type StageDefinition,
} from "./useRecruitingWorklist";
import { NextStepCallout } from "./UpNext";
import { FactLine, PersonBubble } from "./WorklistViews";
import {
  VERIFIED_ZONE_OPTIONS,
  formatDay,
  formatNextAction,
  formatSince,
  formatWhen,
  humanizeKey,
  isoToLocalInput,
  ownerName,
  personLocalTime,
} from "./worklistFormat";
import { nextStepFor } from "./worklistNextStep";
import { licenseWord, rowStatus } from "./worklistStatus";

const UNASSIGNED = "__unassigned__";

interface PersonPanelProps {
  row: WorklistRow;
  userId: string | null;
  backendReady: boolean;
  canAssign: boolean;
  staff: StaffMember[];
  staffAvailable: boolean;
  stagesByKey: Map<string, StageDefinition>;
  /** The person after this one in the current queue order, as rendered when the save was clicked. */
  nextId: string | null;
  /** That person's name, said under the save buttons so the caller knows who comes up next. */
  nextName?: string | null;
  /** Called after a confirmed save; `advance` moves the queue to `nextId` captured at click time. */
  onSaved: (advance: boolean, nextId: string | null) => void;
}

function actorName(actorId: string | null, staff: StaffMember[]): string {
  if (!actorId) return "System";
  return staff.find((s) => s.user_id === actorId)?.display_name ?? "Another user";
}

/** Tomorrow at 10:00 in the viewer's clock: the quick pick, and the time a suggested follow-up starts with. */
const tomorrowTen = (now: Date): Date => { const d = new Date(now); d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0); return d; };

/**
 * Quick picks for the next step, in the viewer's own clock (the field is labelled
 * "your time"). Each returns a datetime-local value, so the field below shows exactly
 * what will be saved and can still be edited by hand.
 */
const TOMORROW_LABEL = "Tomorrow 10 AM";
const QUICK_PICKS: Array<{ label: string; at: (now: Date) => Date }> = [
  { label: "In 2 hours", at: (now) => new Date(now.getTime() + 2 * 60 * 60 * 1000) },
  { label: TOMORROW_LABEL, at: tomorrowTen },
  { label: "In 3 days", at: (now) => { const d = new Date(now); d.setDate(d.getDate() + 3); d.setHours(10, 0, 0, 0); return d; } },
  { label: "Next week", at: (now) => { const d = new Date(now); d.setDate(d.getDate() + 7); d.setHours(10, 0, 0, 0); return d; } },
];

/**
 * The panel sits on a card. The outline variant is transparent with the input border,
 * which in light mode is within one lightness step of the card, so the buttons read as
 * a list of words. A page-background fill and the border token raise them on both themes.
 */
const RAISED = "border-border bg-background";

/**
 * What each outcome means, in the shared tones (src/lib/tones.ts, 2026-10-28), with a small
 * icon beside the unchanged words: a booked meeting is "scheduled", a callback "needs a
 * nudge", no answer quiet, a no or a bad number "act now", interest "going well". The chosen
 * button wears its tint; the words still carry the meaning.
 */
const OUTCOME_LOOK: Record<ContactOutcome, { tone: Tone; icon: LucideIcon }> = {
  no_answer: { tone: "slate", icon: PhoneMissed },
  callback: { tone: "warm", icon: Clock },
  interested: { tone: "good", icon: ThumbsUp },
  appointment_booked: { tone: "cool", icon: CalendarCheck },
  not_interested: { tone: "hot", icon: ThumbsDown },
  wrong_number: { tone: "hot", icon: PhoneOff },
  do_not_contact: { tone: "hot", icon: Ban },
};

/** A chosen button's hover, one step deeper than its resting tint. Written out so Tailwind can see each class. */
const TONE_HOVER: Record<Tone, string> = {
  good: "hover:bg-tone-good/20",
  warm: "hover:bg-tone-warm/20",
  hot: "hover:bg-tone-hot/20",
  cool: "hover:bg-tone-cool/20",
  royal: "hover:bg-tone-royal/20",
  gold: "hover:bg-tone-gold/20",
  slate: "hover:bg-tone-slate/20",
};

/** The tint, hairline and hover of a chosen choice button; the text stays the foreground so the words read on both themes. */
const chosenLook = (tone: Tone): string => cn("border text-foreground", TONE_CLASS[tone].soft, TONE_CLASS[tone].border, TONE_HOVER[tone]);

/**
 * The celebration a saved outcome earns: a chime for a booked meeting, a pop for any other
 * call recorded (a no answer or a no is still work done). Stopping all contact is nothing
 * to cheer, so it gets no bubbles and no sound.
 */
export function celebrationFor(outcome: ContactOutcome | null): CelebrationKind | null {
  if (!outcome || outcome === "do_not_contact") return null;
  return outcome === "appointment_booked" ? "booked" : "save";
}

/**
 * Where the finger was, read before the save: "Save & next person" swaps the panel for the
 * next person while the bubbles are still loading, and a detached button has no position.
 */
function pressedAt(control: Element | null): CelebrationOrigin {
  if (!control || typeof window === "undefined") return control;
  const r = control.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return control;
  return { x: (r.left + r.width / 2) / window.innerWidth, y: (r.top + r.height / 2) / window.innerHeight };
}

/** A labelled fold: the header shows the current value, so most people never need to open it. */
function Fold({ title, value, children, tone }: { title: string; value?: ReactNode; children: ReactNode; tone?: "warning" }) {
  return (
    <details className="group">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-2 text-base focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)] [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        <span className="font-medium text-foreground">{title}</span>
        {value !== undefined && (
          <span className={cn("ml-auto min-w-0 truncate text-sm", tone === "warning" ? TONE_CLASS.warm.text : "text-muted-foreground")}>{value}</span>
        )}
      </summary>
      <div className="space-y-3 px-4 pb-4">{children}</div>
    </details>
  );
}

export function PersonPanel({ row, userId, backendReady, canAssign, staff, staffAvailable, stagesByKey, nextId, nextName = null, onSaved }: PersonPanelProps) {
  const [draft, setDraft] = useState<OutcomeDraft>(() => loadDraft(userId, row.id) ?? EMPTY_DRAFT);
  const [planMode, setPlanMode] = useState<"action" | "waiting">(() =>
    draft.waitingReason && !draft.nextAction ? "waiting" : "action");
  // "Just change the next step" opens the plan editor without an outcome (no contact recorded).
  const [planOnly, setPlanOnly] = useState(false);
  // "Do not contact" stops all outreach and only an admin can undo it, so it takes a second tap.
  const [confirmingDnc, setConfirmingDnc] = useState(false);
  // The channel is one line ("Reached by Call · Change") until someone asks to change it.
  const [channelOpen, setChannelOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoneChoice, setZoneChoice] = useState<string>("");
  // The quick pick whose time sits in the field below, so it can wear the gold tint. Cleared
  // when the time is typed by hand, the plan mode flips, or the save lands.
  const [quickPick, setQuickPick] = useState<string | null>(null);
  const { recordOutcome, setPlan } = useWorklistMutations();
  const history = useContactHistory(row.id, backendReady);

  useEffect(() => {
    saveDraft(userId, row.id, draft);
  }, [draft, row.id, userId]);

  const availability = useMemo(() => channelAvailability(row), [row]);
  const blockers = useMemo(() => blockersOf(row).filter((b) => b.hard), [row]);
  const plan = useMemo(() => planCheck(row), [row]);
  const status = rowStatus(row, Date.now());
  // The one thing to do next with this person, from the record (worklistNextStep.ts), on the same
  // clock as the status pill so "Due today" turns "Was due" when the time passes.
  const step = nextStepFor(row, Date.now());
  const selectedDef = outcomeDefinition(draft.outcome);
  const closes = selectedDef?.closes ?? false;
  const stage = row.next_step_stage_key ? stagesByKey.get(row.next_step_stage_key) : null;
  const localTime = personLocalTime(row.time_zone);
  const saving = recordOutcome.isPending || setPlan.isPending;
  const showPlan = Boolean(draft.outcome) || planOnly || Boolean(draft.notes.trim());
  const owner = ownerName(row.recruiting_owner_user_id, staff, staffAvailable);
  // Only a recorded contact counts as "last time": owner, plan and time-zone saves also write
  // history rows (with notes), and must never read as a conversation that just happened.
  const lastEntry = (history.data ?? []).find((h) => h.contact_outcome);
  const historyCount = (history.data ?? []).length;

  const update = (patch: Partial<OutcomeDraft>) => {
    setError(null);
    setDraft((prev) => ({ ...prev, ...patch }));
  };

  const pickOutcome = (value: OutcomeDraft["outcome"]) => {
    const def = outcomeDefinition(value);
    const patch: Partial<OutcomeDraft> = { outcome: value };
    if (def?.suggestedAction && !draft.nextAction.trim()) patch.nextAction = def.suggestedAction;
    // A suggested follow-up ("Try again") gets a suggested time too, the same value as the
    // "Tomorrow 10 AM" quick pick and just as editable, so "No answer" saves in one tap.
    // Outcomes whose time the person named (a callback, an appointment) stay blank: guessing
    // their time would write a false record.
    if (def?.suggestedAction && !def.closes && !def.requiresDatedAction && !draft.nextActionDue) {
      patch.nextActionDue = isoToLocalInput(tomorrowTen(new Date()).toISOString());
      setQuickPick(TOMORROW_LABEL);
    }
    if (def?.requiresDatedAction) setPlanMode("action");
    setPlanOnly(false);
    setConfirmingDnc(false);
    setChannelOpen(false);
    update(patch);
  };

  const noteChannel = (channel: ContactChannel) => update({ channel });

  const pickTime = (label: string, at: Date) => {
    const value = isoToLocalInput(at.toISOString());
    setQuickPick(label);
    update(planMode === "action" ? { nextActionDue: value } : { nextReview: value });
  };

  const flipPlanMode = () => {
    setQuickPick(null);
    setPlanMode(planMode === "action" ? "waiting" : "action");
  };

  const submitOutcome = async (advance: boolean, control: Element | null) => {
    // Captured now: once the save lands this row may leave the queue and reorder it, and
    // the button pressed may be gone.
    const advanceTo = nextId;
    const origin = pressedAt(control);
    const problem = validateOutcomeDraft(draft, row);
    if (problem) {
      setError(problem);
      return;
    }
    const def = outcomeDefinition(draft.outcome);
    const closesItem = def?.closes ?? false;
    const useAction = !closesItem && planMode === "action";
    const useWaiting = !closesItem && planMode === "waiting";
    try {
      await recordOutcome.mutateAsync({
        applicationId: row.id,
        outcome: draft.outcome as NonNullable<OutcomeDraft["outcome"]>,
        channel: draft.channel,
        notes: draft.notes.trim() || null,
        nextAction: useAction || (def?.requiresDatedAction ?? false) ? draft.nextAction.trim() || null : null,
        nextActionDueAt: useAction || (def?.requiresDatedAction ?? false) ? localInputToIso(draft.nextActionDue) : null,
        waitingReason: useWaiting ? draft.waitingReason.trim() || null : null,
        nextReviewAt: useWaiting ? localInputToIso(draft.nextReview) : null,
        ownerUserId: null,
        expectedLastOutcomeAt: row.last_contact_outcome_at,
      });
      clearDraft(userId, row.id);
      setDraft(EMPTY_DRAFT);
      setQuickPick(null);
      toast.success(`${outcomeLabel(draft.outcome)} saved for ${fullName(row)}`);
      // Only now, after the server confirmed it: bubbles from the button pressed. Never on an
      // error (the catch below keeps the draft and says what went wrong).
      const kind = celebrationFor(draft.outcome);
      if (kind) void celebrate(kind, origin);
      onSaved(advance, advanceTo);
    } catch (e) {
      // The draft is deliberately kept exactly as typed.
      setError(describeSaveError(e instanceof Error ? e.message : String(e)).text);
    }
  };

  const submitPlanOnly = async (control: Element | null) => {
    const origin = pressedAt(control);
    const hasAction = Boolean(draft.nextAction.trim()) && Boolean(draft.nextActionDue);
    const hasWait = Boolean(draft.waitingReason.trim()) && Boolean(draft.nextReview);
    if (planMode === "action" ? !hasAction : !hasWait) {
      setError(planMode === "action"
        ? "A next step needs both what to do and when."
        : "Waiting needs both what you're waiting for and a date to check back.");
      return;
    }
    try {
      await setPlan.mutateAsync({
        applicationId: row.id,
        updateOwner: false,
        ownerUserId: null,
        updatePlan: true,
        nextAction: planMode === "action" ? draft.nextAction.trim() : null,
        nextActionDueAt: planMode === "action" ? localInputToIso(draft.nextActionDue) : null,
        waitingReason: planMode === "waiting" ? draft.waitingReason.trim() : null,
        nextReviewAt: planMode === "waiting" ? localInputToIso(draft.nextReview) : null,
        timeZone: null,
        notes: draft.notes.trim() || null,
        expectedPlanSetAt: row.next_action_set_at,
      });
      clearDraft(userId, row.id);
      setDraft(EMPTY_DRAFT);
      setQuickPick(null);
      setPlanOnly(false);
      toast.success("Next step updated — no contact was recorded");
      void celebrate("save", origin);
      onSaved(false, null);
    } catch (e) {
      setError(describeSaveError(e instanceof Error ? e.message : String(e)).text);
    }
  };

  const changeOwner = async (value: string) => {
    const ownerId = value === UNASSIGNED ? null : value;
    try {
      await setPlan.mutateAsync({
        applicationId: row.id,
        updateOwner: true,
        ownerUserId: ownerId,
        updatePlan: false,
        nextAction: null,
        nextActionDueAt: null,
        waitingReason: null,
        nextReviewAt: null,
        timeZone: null,
        notes: null,
        expectedPlanSetAt: null,
      });
      toast.success(ownerId ? `Owner set to ${ownerName(ownerId, staff, staffAvailable)}` : "Owner cleared");
    } catch (e) {
      // The inline alert sits with the outcome form, which may be folded away; say it out loud too.
      const text = describeSaveError(e instanceof Error ? e.message : String(e)).text;
      setError(text);
      toast.error(text);
    }
  };

  const confirmZone = async () => {
    if (!zoneChoice) return;
    try {
      await setPlan.mutateAsync({
        applicationId: row.id,
        updateOwner: false,
        ownerUserId: null,
        updatePlan: false,
        nextAction: null,
        nextActionDueAt: null,
        waitingReason: null,
        nextReviewAt: null,
        timeZone: zoneChoice,
        notes: null,
        expectedPlanSetAt: null,
      });
      setZoneChoice("");
      toast.success("Time zone confirmed");
    } catch (e) {
      const text = describeSaveError(e instanceof Error ? e.message : String(e)).text;
      setError(text);
      toast.error(text);
    }
  };

  const callHref = availability.call.allowed ? phoneHref(row.phone) : null;
  const textHref = availability.sms.allowed ? smsHref(row.phone) : null;
  const emailHref = availability.email.allowed && row.email ? `mailto:${row.email}` : null;
  // A number on file that is too short or garbled to dial builds no link; say so instead of
  // leaving a grey Call button with no reason (OVERHAUL-calllist).
  const undialable = availability.call.allowed && !isDialablePhone(row.phone) ? "The number on file can't be dialed" : null;
  // Older users don't hover, so a blocked channel says why in words, not only in a tooltip.
  const blockedReasons = [
    !callHref && (availability.call.reason ?? undialable) ? `Call: ${availability.call.reason ?? undialable}` : null,
    !textHref && availability.sms.reason && availability.sms.reason !== availability.call.reason ? `Text: ${availability.sms.reason}` : null,
    !emailHref && availability.email.reason ? `Email: ${availability.email.reason}` : null,
  ].filter(Boolean) as string[];
  // One gold button at a time: Call until an outcome is picked, then Save & next person.
  const callVariant = draft.outcome || planOnly ? "outline" : "default";

  const who = [
    row.phone ? formatPhoneDisplay(row.phone) : "No phone",
    localTime ? `${localTime} their time` : null,
    row.state,
    licenseWord(row.license_status),
  ];

  return (
    // pb-5: the panel owns its bottom padding so the containers (the aside and the sheet) can
    // end flush with the sticky save row. See the note on that row.
    <div className="flex h-full flex-col gap-6 pb-5">
      {/* Who: the initials bubble in the status tone, the name, the status in words, the facts. */}
      <header className="space-y-2">
        <div className="flex items-start gap-3">
          <PersonBubble row={row} status={status} size="lg" className="apex-pop mt-0.5" />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2 className="min-w-0 text-xl font-semibold leading-7 tracking-[-0.01em] text-foreground">{fullName(row)}</h2>
              <StatusPill status={status} />
            </div>
            <p className="text-base leading-6 text-muted-foreground"><FactLine facts={who} /></p>
          </div>
        </div>
        {blockers.length > 0 && (
          <p className="flex flex-wrap gap-x-3 text-sm font-medium text-destructive">
            {blockers.map((b) => <span key={b.key}>{b.label}</span>)}
          </p>
        )}
      </header>

      {/* Last time: the one fact a caller needs before dialling. A history entry wins as a whole
          (outcome, time, who, note); the row's own outcome is the fallback while history loads. */}
      {(lastEntry || row.last_contact_outcome) && (
        <p className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm leading-6 text-foreground">
          <span className="font-semibold">Last time</span>
          <span className="text-muted-foreground">
            {" · "}
            {lastEntry ? formatSince(lastEntry.logged_at) : formatSince(row.last_contact_outcome_at)}
            {lastEntry ? ` · ${actorName(lastEntry.logged_by, staff)}` : ""}
          </span>
          {": "}
          {outcomeLabel(lastEntry ? lastEntry.contact_outcome : row.last_contact_outcome)}
          {lastEntry?.notes ? <span className="text-muted-foreground"> — “{lastEntry.notes}”</span> : null}
        </p>
      )}

      {/* What to do: the one next action, worked out from the record, right before the buttons
          that do it. After "Last time", so the caller reads what happened, then what to do now. */}
      <NextStepCallout step={step} />

      {/* Reach them — opening a link records nothing; the outcome below is the record. */}
      <section aria-label="Contact" className="space-y-2">
        <div className="grid grid-cols-3 gap-2">
          {callHref ? (
            <Button asChild variant={callVariant} className={cn("h-12 text-base", callVariant === "outline" && RAISED)} onClick={() => noteChannel("call")}>
              <a href={callHref} {...contactLinkProps(callHref)} aria-label={`Call ${fullName(row)}`}>
                <Phone className="h-5 w-5" /> Call
              </a>
            </Button>
          ) : (
            <Button variant="outline" className={cn("h-12 text-base", RAISED)} disabled title={availability.call.reason ?? undefined} aria-label="Call unavailable">
              <Phone className="h-5 w-5" /> Call
            </Button>
          )}
          {textHref ? (
            <Button asChild variant="outline" className={cn("h-12 text-base", RAISED)} onClick={() => noteChannel("sms")}>
              <a href={textHref} {...contactLinkProps(textHref)} aria-label={`Text ${fullName(row)}`}>
                <MessageSquare className="h-5 w-5" /> Text
              </a>
            </Button>
          ) : (
            <Button variant="outline" className={cn("h-12 text-base", RAISED)} disabled title={availability.sms.reason ?? undefined} aria-label="Text unavailable">
              <MessageSquare className="h-5 w-5" /> Text
            </Button>
          )}
          {emailHref ? (
            <Button asChild variant="outline" className={cn("h-12 text-base", RAISED)} onClick={() => noteChannel("email")}>
              <a href={emailHref} aria-label={`Email ${fullName(row)}`}>
                <Mail className="h-5 w-5" /> Email
              </a>
            </Button>
          ) : (
            <Button variant="outline" className={cn("h-12 text-base", RAISED)} disabled title={availability.email.reason ?? undefined} aria-label="Email unavailable">
              <Mail className="h-5 w-5" /> Email
            </Button>
          )}
        </div>
        {blockedReasons.length > 0 && (
          <ul className="space-y-0.5 text-sm text-muted-foreground">
            {blockedReasons.map((r) => <li key={r}>{r}</li>)}
          </ul>
        )}
        <p className="text-sm text-muted-foreground">
          Tapping these doesn't record anything. After you talk, tap what happened.
        </p>
      </section>

      {/* What happened */}
      <section aria-label="Record outcome" className="space-y-5">
        {!backendReady && (
          <p className="text-sm text-destructive">
            Outcome recording is unavailable until the workspace database update is applied. Nothing typed here is lost.
          </p>
        )}
        <div>
          <h3 id={`outcome-${row.id}`} className="text-base font-semibold text-foreground">What happened?</h3>
          <div role="group" aria-labelledby={`outcome-${row.id}`} className="mt-3 grid grid-cols-2 gap-2">
            {OUTCOME_DEFINITIONS.filter((def) => def.value !== "do_not_contact").map((def) => {
              const look = OUTCOME_LOOK[def.value];
              const Icon = look.icon;
              const chosen = draft.outcome === def.value;
              return (
                // min-h-12 and a wrapping label: "Appointment booked" with its icon is two lines on a
                // 390px phone, and a clipped word would be a worse button than a taller one.
                <Button
                  key={def.value}
                  type="button"
                  variant={chosen ? "secondary" : "outline"}
                  aria-pressed={chosen}
                  title={def.hint}
                  className={cn("h-auto min-h-12 justify-start whitespace-normal py-2 text-left text-base leading-5", chosen ? chosenLook(look.tone) : RAISED)}
                  onClick={() => pickOutcome(def.value)}
                >
                  <Icon aria-hidden="true" className={cn("shrink-0", TONE_CLASS[look.tone].text)} />
                  {def.label}
                </Button>
              );
            })}
          </div>
          {/* What the chosen outcome does, in words under the buttons; the title tooltip alone needs a mouse. */}
          {selectedDef && draft.outcome !== "do_not_contact" && (
            <p className="mt-2 text-sm text-muted-foreground">{selectedDef.label}: {selectedDef.hint}.</p>
          )}

          {draft.outcome === "do_not_contact" ? (
            <p className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
              <span>Do not contact is selected. Saving stops all outreach.</span>
              <Button type="button" variant="ghost" className="h-11" onClick={() => update({ outcome: null })}>Undo</Button>
            </p>
          ) : confirmingDnc ? (
            <div role="group" aria-label="Confirm do not contact" className="mt-3 space-y-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
              <p className="text-sm text-foreground">
                Stop all calls, texts and emails to {fullName(row)}? This includes automated email, and only an admin can undo it.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="destructive" className="h-11" onClick={() => pickOutcome("do_not_contact")}>Yes, do not contact</Button>
                <Button type="button" variant="ghost" className="h-11" onClick={() => setConfirmingDnc(false)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4">
              <Button type="button" variant="link" className="h-11 px-0 text-sm text-muted-foreground" onClick={() => { setPlanOnly(true); update({ outcome: null }); }} disabled={!backendReady}>
                <Clock className="h-4 w-4" /> Just change the next step
              </Button>
              <Button type="button" variant="link" className="h-11 px-0 text-sm text-destructive" onClick={() => setConfirmingDnc(true)}>
                Do not contact…
              </Button>
            </div>
          )}
        </div>

        {showPlan && (
          <div className="space-y-5 border-t border-border pt-5">
            {/* The channel defaults to the button they tapped (Call, Text, Email) and stays one
                line; the five chips only appear when someone asks to change it. */}
            {draft.outcome && (
              channelOpen ? (
                <div>
                  <p id={`channel-${row.id}`} className="text-sm font-medium text-foreground">How did you reach them?</p>
                  <div role="group" aria-labelledby={`channel-${row.id}`} className="mt-2 flex flex-wrap gap-1.5">
                    {CONTACT_CHANNELS.map((ch) => {
                      const allowed = draft.outcome === "do_not_contact" || availability[ch].allowed;
                      return (
                        <Button
                          key={ch}
                          type="button"
                          variant={draft.channel === ch ? "secondary" : "outline"}
                          aria-pressed={draft.channel === ch}
                          disabled={!allowed}
                          title={allowed ? undefined : availability[ch].reason ?? undefined}
                          className={cn("h-11 px-4 text-sm", draft.channel !== ch && RAISED)}
                          onClick={() => { update({ channel: ch }); setChannelOpen(false); }}
                        >
                          {CHANNEL_LABELS[ch]}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-x-2 text-sm text-foreground">
                  <span>Reached by {CHANNEL_LABELS[draft.channel]}</span>
                  <span aria-hidden="true">·</span>
                  <Button
                    type="button"
                    variant="link"
                    className="h-11 px-0 text-sm"
                    aria-label={`Change how you reached them (now ${CHANNEL_LABELS[draft.channel]})`}
                    onClick={() => setChannelOpen(true)}
                  >
                    <Pencil className="h-4 w-4" /> Change
                  </Button>
                </div>
              )
            )}

            {!closes && (
              <div className="space-y-3">
                <p className="text-sm font-medium text-foreground">
                  {planMode === "action" ? "Next step" : "Waiting on them"}
                  {!plan.ok && plan.missing.includes("plan") && (
                    <span className="font-normal text-muted-foreground"> · this person has none yet</span>
                  )}
                </p>
                {planMode === "action" ? (
                  <div className="space-y-1.5">
                    <Label htmlFor={`na-${row.id}`} className="text-sm text-muted-foreground">What to do</Label>
                    <Input id={`na-${row.id}`} className="h-12 text-base" value={draft.nextAction} onChange={(e) => update({ nextAction: e.target.value })} placeholder="Call back" />
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label htmlFor={`wr-${row.id}`} className="text-sm text-muted-foreground">Waiting for</Label>
                    <Input id={`wr-${row.id}`} className="h-12 text-base" value={draft.waitingReason} onChange={(e) => update({ waitingReason: e.target.value })} placeholder="Reply to text" />
                  </div>
                )}
                {/* The pick whose time is in the field below wears the gold tint; the field stays the record. */}
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Pick a time">
                  {QUICK_PICKS.map((p) => {
                    const chosen = quickPick === p.label;
                    return (
                      <Button
                        key={p.label}
                        type="button"
                        variant="outline"
                        aria-pressed={chosen}
                        className={cn("h-11 px-3.5 text-sm", chosen ? chosenLook("gold") : RAISED)}
                        onClick={() => pickTime(p.label, p.at(new Date()))}
                      >
                        {p.label}
                      </Button>
                    );
                  })}
                </div>
                {planMode === "action" ? (
                  <div className="space-y-1.5">
                    <Label htmlFor={`nad-${row.id}`} className="text-sm text-muted-foreground">Due (your time)</Label>
                    <Input id={`nad-${row.id}`} className="h-12 text-base" type="datetime-local" value={draft.nextActionDue} onChange={(e) => { setQuickPick(null); update({ nextActionDue: e.target.value }); }} />
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label htmlFor={`nr-${row.id}`} className="text-sm text-muted-foreground">Review by (your time)</Label>
                    <Input id={`nr-${row.id}`} className="h-12 text-base" type="datetime-local" value={draft.nextReview} onChange={(e) => { setQuickPick(null); update({ nextReview: e.target.value }); }} />
                  </div>
                )}
                <Button
                  type="button"
                  variant="link"
                  className="h-11 px-0 text-sm"
                  disabled={planMode === "action" && (selectedDef?.requiresDatedAction ?? false)}
                  onClick={flipPlanMode}
                >
                  {planMode === "action" ? "They'll get back to me instead" : "Set a next step instead"}
                </Button>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor={`notes-${row.id}`} className="text-sm text-muted-foreground">Notes</Label>
              <Textarea
                id={`notes-${row.id}`}
                value={draft.notes}
                onChange={(e) => update({ notes: e.target.value })}
                rows={3}
                className="text-base"
                placeholder="What was said, objections, details for the next person (optional)"
              />
            </div>

            {error && (
              <p role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </p>
            )}

            {/* The save row sticks to the bottom of the panel's scroll (and the sheet's), so on a
                900px laptop or a phone it is never below the fold once an outcome is picked. The
                negative side margins let it span the container's px-5 on the card colour; the
                containers carry no bottom padding (this panel does, see the root), because the
                browser pins bottom-0 to the scroller's content edge and a padded bottom left a
                20px strip of scrolled text showing under the row. */}
            {draft.outcome ? (
              <div className="sticky bottom-0 z-10 -mx-5 border-t border-border bg-card px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]">
                {/* Side by side at every width: on a 390px phone the two fit in one row, which keeps the
                    sticky bar short enough to leave the form visible above it. */}
                <div className="flex gap-2">
                  <Button type="button" className="h-12 min-w-0 flex-1 text-base" disabled={saving || !backendReady} onClick={(e) => void submitOutcome(true, e.currentTarget)}>
                    {recordOutcome.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                    Save &amp; next person
                  </Button>
                  <Button type="button" variant="outline" className={cn("h-12 w-24 shrink-0 text-base", RAISED)} disabled={saving || !backendReady} onClick={(e) => void submitOutcome(false, e.currentTarget)}>
                    Save
                  </Button>
                </div>
                {nextId && nextName && (
                  <p className="mt-2 truncate text-sm text-muted-foreground">
                    Next up: <span className="font-medium text-foreground">{nextName}</span>
                  </p>
                )}
              </div>
            ) : (
              <div className="sticky bottom-0 z-10 -mx-5 flex gap-2 border-t border-border bg-card px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]">
                <Button type="button" className="h-12 min-w-0 flex-1 text-base" disabled={saving || !backendReady} onClick={(e) => void submitPlanOnly(e.currentTarget)}>
                  {setPlan.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  <span className="truncate">Save next step (no contact)</span>
                </Button>
                <Button type="button" variant="ghost" className="h-12 shrink-0 text-base" onClick={() => { setPlanOnly(false); setError(null); }}>
                  Cancel
                </Button>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Everything else, folded. Headers show the current value. */}
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
        <Fold
          title="Owner"
          value={row.recruiting_owner_user_id === userId && userId ? `${owner} (you)` : row.recruiting_owner_user_id ? owner : "No owner yet"}
          tone={row.recruiting_owner_user_id ? undefined : "warning"}
        >
          {canAssign && backendReady ? (
            <Select value={row.recruiting_owner_user_id ?? UNASSIGNED} onValueChange={changeOwner} disabled={saving}>
              <SelectTrigger className="h-12 text-base" aria-label="Accountable owner">
                <SelectValue placeholder="Unassigned" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                {staff.map((s) => (
                  <SelectItem key={s.user_id} value={s.user_id}>
                    {s.display_name}{s.user_id === userId ? " (you)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="flex items-center justify-between gap-2 text-base">
              <span className="text-foreground">{owner}</span>
              {backendReady && !row.recruiting_owner_user_id && userId && (
                <Button variant="outline" className={cn("h-11", RAISED)} disabled={saving} onClick={() => changeOwner(userId)}>
                  <UserPlus className="h-4 w-4" /> Take it
                </Button>
              )}
            </div>
          )}
        </Fold>

        <Fold title="Details" value={row.next_step_stage_key ? stage?.display_name ?? humanizeKey(row.next_step_stage_key) : "Not staged"}>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Phone</dt>
            <dd className="text-right tabular-nums text-foreground">{row.phone ? formatPhoneDisplay(row.phone) : "—"}</dd>
            <dt className="text-muted-foreground">Email</dt>
            <dd className="truncate text-right text-foreground" title={row.email ?? undefined}>{row.email ?? "—"}</dd>
            <dt className="text-muted-foreground">Applied</dt>
            <dd className="text-right text-foreground">{formatDay(row.created_at)}</dd>
            <dt className="text-muted-foreground">Residence state</dt>
            <dd className="text-right text-foreground">{row.state ?? "Not provided"}</dd>
            <dt className="text-muted-foreground">Local time</dt>
            <dd className="text-right text-foreground">
              {localTime ? `${localTime}${row.time_zone_source === "confirmed_by_staff" ? " · confirmed" : " · from form"}` : "Not verified"}
            </dd>
            <dt className="text-muted-foreground">License</dt>
            <dd className="text-right text-foreground">
              {humanizeKey(row.license_status)}
              {row.license_status === "licensed" && <span className="text-muted-foreground"> · self-reported</span>}
            </dd>
            <dt className="text-muted-foreground">Last contact</dt>
            <dd className="text-right text-foreground">
              {row.last_contact_outcome
                ? `${outcomeLabel(row.last_contact_outcome)} · ${formatWhen(row.last_contact_outcome_at)}`
                : row.last_contacted_at
                  ? formatWhen(row.last_contacted_at)
                  : "Never recorded"}
            </dd>
            <dt className="text-muted-foreground">Next action</dt>
            <dd className="text-right text-foreground">
              {row.next_action
                ? `${formatNextAction(row.next_action, Boolean(row.next_action_set_at))} · ${formatWhen(row.next_action_due_at)}`
                : row.waiting_reason
                  ? `Waiting: ${row.waiting_reason} · review ${formatWhen(row.next_review_at)}`
                  : "None"}
            </dd>
          </dl>
          {/* Time zone: only ever from a verified source. */}
          {backendReady && !row.time_zone && (
            <div className="flex items-center gap-2">
              <Select value={zoneChoice} onValueChange={setZoneChoice}>
                <SelectTrigger className="h-11" aria-label="Confirm the person's time zone">
                  <SelectValue placeholder="Confirm time zone with the person" />
                </SelectTrigger>
                <SelectContent>
                  {VERIFIED_ZONE_OPTIONS.map((z) => (
                    <SelectItem key={z.value} value={z.value}>{z.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" className={cn("h-11", RAISED)} disabled={!zoneChoice || saving} onClick={confirmZone}>Confirm</Button>
            </div>
          )}
        </Fold>

        <Fold
          title="History"
          value={history.isLoading
            ? "Loading…"
            : history.isError
              ? "Couldn't load"
              : historyCount >= 50
                ? "Newest 50"
                : `${historyCount} ${historyCount === 1 ? "entry" : "entries"}`}
        >
          {history.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading history…</p>
          ) : history.isError ? (
            <p className="text-sm text-destructive">History could not be loaded: {(history.error as Error).message}</p>
          ) : (history.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No recorded contact.</p>
          ) : (
            <ul aria-label="Contact history" className="space-y-2">
              {(history.data ?? []).map((h) => (
                <li key={h.id} className="rounded-lg border border-border/70 p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-foreground">
                      {h.contact_outcome
                        ? outcomeLabel(h.contact_outcome)
                        : h.outcome === "initiated"
                          ? "Link opened (not a contact)"
                          : h.outcome === "plan_updated"
                            ? "Plan updated"
                            : humanizeKey(h.outcome)}
                    </span>
                    <span className="text-muted-foreground" title={formatWhen(h.logged_at)}>{formatWhen(h.logged_at)}</span>
                  </div>
                  <div className="mt-0.5 text-muted-foreground">
                    {humanizeKey(h.channel)}
                    {h.contact_outcome ? (h.is_manual === false ? " · provider event" : " · manual") : ""}
                    {" · "}
                    {actorName(h.logged_by, staff)}
                  </div>
                  {h.notes && <p className="mt-1 whitespace-pre-wrap text-foreground">{h.notes}</p>}
                  {(h.next_action || h.waiting_reason) && (
                    <p className="mt-1 text-muted-foreground">
                      {h.next_action ? `Next: ${h.next_action} · ${formatWhen(h.next_action_due_at)}` : `Waiting: ${h.waiting_reason} · review ${formatWhen(h.next_review_at)}`}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Fold>
      </div>
    </div>
  );
}
