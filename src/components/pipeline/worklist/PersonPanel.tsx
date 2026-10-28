import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, ChevronRight, Clock, Loader2, Mail, MessageSquare, Phone, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { StatusPill } from "@/components/recruiting/StatusPill";
import { contactLinkProps, formatPhoneDisplay, phoneHref, smsHref } from "@/lib/phone";
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
  /** Called after a confirmed save; `advance` moves the queue to `nextId` captured at click time. */
  onSaved: (advance: boolean, nextId: string | null) => void;
}

function actorName(actorId: string | null, staff: StaffMember[]): string {
  if (!actorId) return "System";
  return staff.find((s) => s.user_id === actorId)?.display_name ?? "Another user";
}

/**
 * Quick picks for the next step, in the viewer's own clock (the field is labelled
 * "your time"). Each returns a datetime-local value, so the field below shows exactly
 * what will be saved and can still be edited by hand.
 */
const QUICK_PICKS: Array<{ label: string; at: (now: Date) => Date }> = [
  { label: "In 2 hours", at: (now) => new Date(now.getTime() + 2 * 60 * 60 * 1000) },
  { label: "Tomorrow 10 AM", at: (now) => { const d = new Date(now); d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0); return d; } },
  { label: "In 3 days", at: (now) => { const d = new Date(now); d.setDate(d.getDate() + 3); d.setHours(10, 0, 0, 0); return d; } },
  { label: "Next week", at: (now) => { const d = new Date(now); d.setDate(d.getDate() + 7); d.setHours(10, 0, 0, 0); return d; } },
];

/** A labelled fold: the header shows the current value, so most people never need to open it. */
function Fold({ title, value, children, tone }: { title: string; value?: ReactNode; children: ReactNode; tone?: "warning" }) {
  return (
    <details className="group">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-2 text-base focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)] [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        <span className="font-medium text-foreground">{title}</span>
        {value !== undefined && (
          <span className={cn("ml-auto min-w-0 truncate text-sm", tone === "warning" ? "text-warning" : "text-muted-foreground")}>{value}</span>
        )}
      </summary>
      <div className="space-y-3 px-4 pb-4">{children}</div>
    </details>
  );
}

export function PersonPanel({ row, userId, backendReady, canAssign, staff, staffAvailable, stagesByKey, nextId, onSaved }: PersonPanelProps) {
  const [draft, setDraft] = useState<OutcomeDraft>(() => loadDraft(userId, row.id) ?? EMPTY_DRAFT);
  const [planMode, setPlanMode] = useState<"action" | "waiting">(() =>
    draft.waitingReason && !draft.nextAction ? "waiting" : "action");
  // "Just change the next step" opens the plan editor without an outcome (no contact recorded).
  const [planOnly, setPlanOnly] = useState(false);
  // "Do not contact" stops all outreach and only an admin can undo it, so it takes a second tap.
  const [confirmingDnc, setConfirmingDnc] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoneChoice, setZoneChoice] = useState<string>("");
  const { recordOutcome, setPlan } = useWorklistMutations();
  const history = useContactHistory(row.id, backendReady);

  useEffect(() => {
    saveDraft(userId, row.id, draft);
  }, [draft, row.id, userId]);

  const availability = useMemo(() => channelAvailability(row), [row]);
  const blockers = useMemo(() => blockersOf(row).filter((b) => b.hard), [row]);
  const plan = useMemo(() => planCheck(row), [row]);
  const status = rowStatus(row, Date.now());
  const selectedDef = outcomeDefinition(draft.outcome);
  const closes = selectedDef?.closes ?? false;
  const stage = row.next_step_stage_key ? stagesByKey.get(row.next_step_stage_key) : null;
  const localTime = personLocalTime(row.time_zone);
  const saving = recordOutcome.isPending || setPlan.isPending;
  const showPlan = Boolean(draft.outcome) || planOnly || Boolean(draft.notes.trim());
  const owner = ownerName(row.recruiting_owner_user_id, staff, staffAvailable);
  const lastEntry = (history.data ?? []).find((h) => h.contact_outcome || h.notes);

  const update = (patch: Partial<OutcomeDraft>) => {
    setError(null);
    setDraft((prev) => ({ ...prev, ...patch }));
  };

  const pickOutcome = (value: OutcomeDraft["outcome"]) => {
    const def = outcomeDefinition(value);
    const patch: Partial<OutcomeDraft> = { outcome: value };
    if (def?.suggestedAction && !draft.nextAction.trim()) patch.nextAction = def.suggestedAction;
    if (def?.requiresDatedAction) setPlanMode("action");
    setPlanOnly(false);
    setConfirmingDnc(false);
    update(patch);
  };

  const noteChannel = (channel: ContactChannel) => update({ channel });

  const pickTime = (at: Date) => {
    const value = isoToLocalInput(at.toISOString());
    update(planMode === "action" ? { nextActionDue: value } : { nextReview: value });
  };

  const submitOutcome = async (advance: boolean) => {
    // Captured now: once the save lands this row may leave the queue and reorder it.
    const advanceTo = nextId;
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
      toast.success(`${outcomeLabel(draft.outcome)} saved for ${fullName(row)}`);
      onSaved(advance, advanceTo);
    } catch (e) {
      // The draft is deliberately kept exactly as typed.
      setError(describeSaveError(e instanceof Error ? e.message : String(e)).text);
    }
  };

  const submitPlanOnly = async () => {
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
      setPlanOnly(false);
      toast.success("Next step updated — no contact was recorded");
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
      setError(describeSaveError(e instanceof Error ? e.message : String(e)).text);
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
      setError(describeSaveError(e instanceof Error ? e.message : String(e)).text);
    }
  };

  const callHref = availability.call.allowed ? phoneHref(row.phone) : null;
  const textHref = availability.sms.allowed ? smsHref(row.phone) : null;
  const emailHref = availability.email.allowed && row.email ? `mailto:${row.email}` : null;
  // Older users don't hover, so a blocked channel says why in words, not only in a tooltip.
  const blockedReasons = [
    !callHref && availability.call.reason ? `Call: ${availability.call.reason}` : null,
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
  ].filter(Boolean).join(" · ");

  return (
    <div className="flex h-full flex-col gap-6">
      {/* Who */}
      <header className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-2xl font-semibold leading-tight tracking-[-0.01em] text-foreground">{fullName(row)}</h2>
          <StatusPill status={status} className="mt-1" />
        </div>
        <p className="text-base leading-6 text-muted-foreground">{who}</p>
        {blockers.length > 0 && (
          <p className="flex flex-wrap gap-x-3 text-sm font-medium text-destructive">
            {blockers.map((b) => <span key={b.key}>{b.label}</span>)}
          </p>
        )}
      </header>

      {/* Last time: the one fact a caller needs before dialling. */}
      {(lastEntry || row.last_contact_outcome) && (
        <p className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm leading-6 text-foreground">
          <span className="font-semibold">Last time</span>
          <span className="text-muted-foreground">
            {" · "}
            {formatSince(lastEntry?.logged_at ?? row.last_contact_outcome_at)}
            {lastEntry ? ` · ${actorName(lastEntry.logged_by, staff)}` : ""}
          </span>
          {": "}
          {outcomeLabel(lastEntry?.contact_outcome ?? row.last_contact_outcome) !== "—"
            ? outcomeLabel(lastEntry?.contact_outcome ?? row.last_contact_outcome)
            : "Note"}
          {lastEntry?.notes ? <span className="text-muted-foreground"> — “{lastEntry.notes}”</span> : null}
        </p>
      )}

      {/* Reach them — opening a link records nothing; the outcome below is the record. */}
      <section aria-label="Contact" className="space-y-2">
        <div className="grid grid-cols-3 gap-2">
          {callHref ? (
            <Button asChild variant={callVariant} className="h-12 text-base" onClick={() => noteChannel("call")}>
              <a href={callHref} {...contactLinkProps(callHref)} aria-label={`Call ${fullName(row)}`}>
                <Phone className="h-5 w-5" /> Call
              </a>
            </Button>
          ) : (
            <Button variant="outline" className="h-12 text-base" disabled title={availability.call.reason ?? undefined} aria-label="Call unavailable">
              <Phone className="h-5 w-5" /> Call
            </Button>
          )}
          {textHref ? (
            <Button asChild variant="outline" className="h-12 text-base" onClick={() => noteChannel("sms")}>
              <a href={textHref} {...contactLinkProps(textHref)} aria-label={`Text ${fullName(row)}`}>
                <MessageSquare className="h-5 w-5" /> Text
              </a>
            </Button>
          ) : (
            <Button variant="outline" className="h-12 text-base" disabled title={availability.sms.reason ?? undefined} aria-label="Text unavailable">
              <MessageSquare className="h-5 w-5" /> Text
            </Button>
          )}
          {emailHref ? (
            <Button asChild variant="outline" className="h-12 text-base" onClick={() => noteChannel("email")}>
              <a href={emailHref} aria-label={`Email ${fullName(row)}`}>
                <Mail className="h-5 w-5" /> Email
              </a>
            </Button>
          ) : (
            <Button variant="outline" className="h-12 text-base" disabled title={availability.email.reason ?? undefined} aria-label="Email unavailable">
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
            {OUTCOME_DEFINITIONS.filter((def) => def.value !== "do_not_contact").map((def) => (
              <Button
                key={def.value}
                type="button"
                variant={draft.outcome === def.value ? "secondary" : "outline"}
                aria-pressed={draft.outcome === def.value}
                title={def.hint}
                className={cn(
                  "h-12 justify-start text-base",
                  draft.outcome === def.value && "border-primary/60 bg-primary/15 text-foreground hover:bg-primary/20",
                )}
                onClick={() => pickOutcome(def.value)}
              >
                {def.label}
              </Button>
            ))}
          </div>

          {draft.outcome === "do_not_contact" ? (
            <p className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
              <span>Do not contact is selected. Saving stops all outreach.</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => update({ outcome: null })}>Undo</Button>
            </p>
          ) : confirmingDnc ? (
            <div role="group" aria-label="Confirm do not contact" className="mt-3 space-y-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
              <p className="text-sm text-foreground">
                Stop all calls, texts and emails to {fullName(row)}? This includes automated email, and only an admin can undo it.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="destructive" onClick={() => pickOutcome("do_not_contact")}>Yes, do not contact</Button>
                <Button type="button" variant="ghost" onClick={() => setConfirmingDnc(false)}>Cancel</Button>
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
            {draft.outcome && (
              <div>
                <p className="text-sm font-medium text-foreground">How did you reach them?</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {CONTACT_CHANNELS.map((ch) => {
                    const allowed = draft.outcome === "do_not_contact" || availability[ch].allowed;
                    return (
                      <Button
                        key={ch}
                        type="button"
                        variant={draft.channel === ch ? "secondary" : "ghost"}
                        aria-pressed={draft.channel === ch}
                        disabled={!allowed}
                        title={allowed ? undefined : availability[ch].reason ?? undefined}
                        className="h-11 px-4 text-sm"
                        onClick={() => update({ channel: ch })}
                      >
                        {CHANNEL_LABELS[ch]}
                      </Button>
                    );
                  })}
                </div>
              </div>
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
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Pick a time">
                  {QUICK_PICKS.map((p) => (
                    <Button key={p.label} type="button" variant="outline" className="h-11 px-3.5 text-sm" onClick={() => pickTime(p.at(new Date()))}>
                      {p.label}
                    </Button>
                  ))}
                </div>
                {planMode === "action" ? (
                  <div className="space-y-1.5">
                    <Label htmlFor={`nad-${row.id}`} className="text-sm text-muted-foreground">Due (your time)</Label>
                    <Input id={`nad-${row.id}`} className="h-12 text-base" type="datetime-local" value={draft.nextActionDue} onChange={(e) => update({ nextActionDue: e.target.value })} />
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label htmlFor={`nr-${row.id}`} className="text-sm text-muted-foreground">Review by (your time)</Label>
                    <Input id={`nr-${row.id}`} className="h-12 text-base" type="datetime-local" value={draft.nextReview} onChange={(e) => update({ nextReview: e.target.value })} />
                  </div>
                )}
                <Button
                  type="button"
                  variant="link"
                  className="h-11 px-0 text-sm"
                  disabled={planMode === "action" && (selectedDef?.requiresDatedAction ?? false)}
                  onClick={() => setPlanMode(planMode === "action" ? "waiting" : "action")}
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

            {draft.outcome ? (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button type="button" className="h-12 flex-1 text-base" disabled={saving || !backendReady} onClick={() => submitOutcome(true)}>
                  {recordOutcome.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Save &amp; next person
                </Button>
                <Button type="button" variant="outline" className="h-12 text-base sm:w-28" disabled={saving || !backendReady} onClick={() => submitOutcome(false)}>
                  Save
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button type="button" className="h-12 flex-1 text-base" disabled={saving || !backendReady} onClick={submitPlanOnly}>
                  {setPlan.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Save next step (no contact)
                </Button>
                <Button type="button" variant="ghost" className="h-12 text-base" onClick={() => { setPlanOnly(false); setError(null); }}>
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
                <Button variant="outline" className="h-11" disabled={saving} onClick={() => changeOwner(userId)}>
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
              <Button variant="outline" className="h-11" disabled={!zoneChoice || saving} onClick={confirmZone}>Confirm</Button>
            </div>
          )}
        </Fold>

        <Fold title="History" value={history.isLoading ? "Loading…" : `${(history.data ?? []).length} ${(history.data ?? []).length === 1 ? "entry" : "entries"}`}>
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
