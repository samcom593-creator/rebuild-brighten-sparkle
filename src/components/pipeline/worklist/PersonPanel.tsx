import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Clock, Loader2, Mail, MessageSquare, Phone, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
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
  formatWhen,
  humanizeKey,
  ownerName,
  personLocalTime,
} from "./worklistFormat";

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

export function PersonPanel({ row, userId, backendReady, canAssign, staff, staffAvailable, stagesByKey, nextId, onSaved }: PersonPanelProps) {
  const [draft, setDraft] = useState<OutcomeDraft>(() => loadDraft(userId, row.id) ?? EMPTY_DRAFT);
  const [planMode, setPlanMode] = useState<"action" | "waiting">(() =>
    draft.waitingReason && !draft.nextAction ? "waiting" : "action");
  const [error, setError] = useState<string | null>(null);
  const [zoneChoice, setZoneChoice] = useState<string>("");
  const { recordOutcome, setPlan } = useWorklistMutations();
  const history = useContactHistory(row.id, backendReady);

  useEffect(() => {
    saveDraft(userId, row.id, draft);
  }, [draft, row.id, userId]);

  const availability = useMemo(() => channelAvailability(row), [row]);
  const blockers = useMemo(() => blockersOf(row), [row]);
  const plan = useMemo(() => planCheck(row), [row]);
  const selectedDef = outcomeDefinition(draft.outcome);
  const stage = row.next_step_stage_key ? stagesByKey.get(row.next_step_stage_key) : null;
  const localTime = personLocalTime(row.time_zone);
  const saving = recordOutcome.isPending || setPlan.isPending;

  const update = (patch: Partial<OutcomeDraft>) => {
    setError(null);
    setDraft((prev) => ({ ...prev, ...patch }));
  };

  const pickOutcome = (value: OutcomeDraft["outcome"]) => {
    const def = outcomeDefinition(value);
    const patch: Partial<OutcomeDraft> = { outcome: value };
    if (def?.suggestedAction && !draft.nextAction.trim()) patch.nextAction = def.suggestedAction;
    if (def?.requiresDatedAction) setPlanMode("action");
    update(patch);
  };

  const noteChannel = (channel: ContactChannel) => update({ channel });

  const submitOutcome = async (advance: boolean) => {
    // Captured now: once the save lands this row may leave the queue and reorder it.
    const advanceTo = nextId;
    const problem = validateOutcomeDraft(draft, row);
    if (problem) {
      setError(problem);
      return;
    }
    const def = outcomeDefinition(draft.outcome);
    const closes = def?.closes ?? false;
    const useAction = !closes && planMode === "action";
    const useWaiting = !closes && planMode === "waiting";
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
        ? "A next action needs both the action and its due time."
        : "Waiting needs both the reason and a review date.");
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
      toast.success("Plan updated — no contact was recorded");
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

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Identity */}
      <div className="space-y-1">
        <h2 className="text-lg font-semibold leading-tight text-foreground">{fullName(row)}</h2>
        <p className="text-xs text-muted-foreground">
          Applied {formatDay(row.created_at)} · {row.next_step_stage_key ? stage?.display_name ?? humanizeKey(row.next_step_stage_key) : "Not staged"}
        </p>
        {blockers.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {blockers.map((b) => (
              <Badge key={b.key} variant={b.hard ? "destructive" : "outline"}>{b.label}</Badge>
            ))}
          </div>
        )}
      </div>

      {/* Contact — opening a link records nothing; the outcome below is the record. */}
      <div className="grid grid-cols-3 gap-2">
        {callHref ? (
          <Button asChild variant="outline" size="sm" onClick={() => noteChannel("call")}>
            <a href={callHref} {...contactLinkProps(callHref)} aria-label={`Call ${fullName(row)}`}>
              <Phone className="h-4 w-4" /> Call
            </a>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled title={availability.call.reason ?? undefined} aria-label="Call unavailable">
            <Phone className="h-4 w-4" /> Call
          </Button>
        )}
        {textHref ? (
          <Button asChild variant="outline" size="sm" onClick={() => noteChannel("sms")}>
            <a href={textHref} {...contactLinkProps(textHref)} aria-label={`Text ${fullName(row)}`}>
              <MessageSquare className="h-4 w-4" /> Text
            </a>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled title={availability.sms.reason ?? undefined} aria-label="Text unavailable">
            <MessageSquare className="h-4 w-4" /> Text
          </Button>
        )}
        {emailHref ? (
          <Button asChild variant="outline" size="sm" onClick={() => noteChannel("email")}>
            <a href={emailHref} aria-label={`Email ${fullName(row)}`}>
              <Mail className="h-4 w-4" /> Email
            </a>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled title={availability.email.reason ?? undefined} aria-label="Email unavailable">
            <Mail className="h-4 w-4" /> Email
          </Button>
        )}
      </div>
      <p className="-mt-2 text-[12px] text-muted-foreground">
        Opening a call, text or email records nothing. Record what actually happened below.
      </p>

      {/* Essentials */}
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-lg border border-border bg-muted/30 p-3 text-xs">
        <dt className="text-muted-foreground">Phone</dt>
        <dd className="text-right tabular-nums text-foreground">{row.phone ? formatPhoneDisplay(row.phone) : "—"}</dd>
        <dt className="text-muted-foreground">Email</dt>
        <dd className="truncate text-right text-foreground" title={row.email ?? undefined}>{row.email ?? "—"}</dd>
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

      {/* Owner */}
      <div className="flex items-center gap-2">
        <Label className="w-16 shrink-0 text-xs text-muted-foreground">Owner</Label>
        {canAssign && backendReady ? (
          <Select
            value={row.recruiting_owner_user_id ?? UNASSIGNED}
            onValueChange={changeOwner}
            disabled={saving}
          >
            <SelectTrigger className="h-9" aria-label="Accountable owner">
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
          <div className="flex flex-1 items-center justify-between gap-2 text-sm">
            <span className="text-foreground">{ownerName(row.recruiting_owner_user_id, staff, staffAvailable)}</span>
            {backendReady && !row.recruiting_owner_user_id && userId && (
              <Button size="sm" variant="outline" disabled={saving} onClick={() => changeOwner(userId)}>
                <UserPlus className="h-4 w-4" /> Take it
              </Button>
            )}
          </div>
        )}
      </div>
      {!plan.ok && (
        <p className="flex items-start gap-1.5 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Needs {plan.missing.map((m) => (m === "owner" ? "an owner" : m === "plan" ? "a next action or waiting reason" : "a readable date")).join(" and ")}.
        </p>
      )}

      {/* Time zone: only ever from a verified source. */}
      {backendReady && !row.time_zone && (
        <div className="flex items-center gap-2">
          <Select value={zoneChoice} onValueChange={setZoneChoice}>
            <SelectTrigger className="h-9" aria-label="Confirm the person's time zone">
              <SelectValue placeholder="Confirm time zone with the person" />
            </SelectTrigger>
            <SelectContent>
              {VERIFIED_ZONE_OPTIONS.map((z) => (
                <SelectItem key={z.value} value={z.value}>{z.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" disabled={!zoneChoice || saving} onClick={confirmZone}>Confirm</Button>
        </div>
      )}

      {/* Outcome */}
      <section aria-label="Record outcome" className="space-y-3 rounded-lg border border-border p-3">
        {!backendReady && (
          <p className="text-xs text-destructive">
            Outcome recording is unavailable until the workspace database update is applied. Nothing typed here is lost.
          </p>
        )}
        <div>
          <Label className="text-xs font-semibold text-foreground">What happened?</Label>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {OUTCOME_DEFINITIONS.map((def) => (
              <Button
                key={def.value}
                type="button"
                size="sm"
                variant={draft.outcome === def.value ? "default" : "outline"}
                aria-pressed={draft.outcome === def.value}
                title={def.hint}
                className={cn("justify-start", def.value === "do_not_contact" && draft.outcome !== def.value && "text-destructive")}
                onClick={() => pickOutcome(def.value)}
              >
                {def.label}
              </Button>
            ))}
          </div>
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">Channel</Label>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {CONTACT_CHANNELS.map((ch) => {
              const allowed = draft.outcome === "do_not_contact" || availability[ch].allowed;
              return (
                <Button
                  key={ch}
                  type="button"
                  size="sm"
                  variant={draft.channel === ch ? "secondary" : "ghost"}
                  aria-pressed={draft.channel === ch}
                  disabled={!allowed}
                  title={allowed ? undefined : availability[ch].reason ?? undefined}
                  onClick={() => update({ channel: ch })}
                >
                  {CHANNEL_LABELS[ch]}
                </Button>
              );
            })}
          </div>
          <p className="mt-1 text-[12px] text-muted-foreground">Recorded as a manual outcome.</p>
        </div>

        <div>
          <Label htmlFor={`notes-${row.id}`} className="text-xs text-muted-foreground">Notes</Label>
          <Textarea
            id={`notes-${row.id}`}
            value={draft.notes}
            onChange={(e) => update({ notes: e.target.value })}
            rows={3}
            placeholder="What was said, objections, details for the next person"
          />
        </div>

        {!(selectedDef?.closes ?? false) && (
          <div className="space-y-2">
            <div className="flex gap-1.5">
              <Button
                type="button"
                size="sm"
                variant={planMode === "action" ? "secondary" : "ghost"}
                aria-pressed={planMode === "action"}
                onClick={() => setPlanMode("action")}
              >
                Next action
              </Button>
              <Button
                type="button"
                size="sm"
                variant={planMode === "waiting" ? "secondary" : "ghost"}
                aria-pressed={planMode === "waiting"}
                disabled={selectedDef?.requiresDatedAction ?? false}
                onClick={() => setPlanMode("waiting")}
              >
                Waiting on them
              </Button>
            </div>
            {planMode === "action" ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <Label htmlFor={`na-${row.id}`} className="text-xs text-muted-foreground">Action</Label>
                  <Input id={`na-${row.id}`} value={draft.nextAction} onChange={(e) => update({ nextAction: e.target.value })} placeholder="Call back" />
                </div>
                <div>
                  <Label htmlFor={`nad-${row.id}`} className="text-xs text-muted-foreground">Due (your time)</Label>
                  <Input id={`nad-${row.id}`} type="datetime-local" value={draft.nextActionDue} onChange={(e) => update({ nextActionDue: e.target.value })} />
                </div>
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <Label htmlFor={`wr-${row.id}`} className="text-xs text-muted-foreground">Waiting for</Label>
                  <Input id={`wr-${row.id}`} value={draft.waitingReason} onChange={(e) => update({ waitingReason: e.target.value })} placeholder="Reply to text" />
                </div>
                <div>
                  <Label htmlFor={`nr-${row.id}`} className="text-xs text-muted-foreground">Review by (your time)</Label>
                  <Input id={`nr-${row.id}`} type="datetime-local" value={draft.nextReview} onChange={(e) => update({ nextReview: e.target.value })} />
                </div>
              </div>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="flex items-start gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" disabled={saving || !backendReady || !draft.outcome} onClick={() => submitOutcome(true)}>
            {recordOutcome.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Save &amp; next
          </Button>
          <Button type="button" variant="outline" disabled={saving || !backendReady || !draft.outcome} onClick={() => submitOutcome(false)}>
            Save
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={saving || !backendReady} onClick={submitPlanOnly} title="Change the plan without recording a contact">
            <Clock className="h-4 w-4" /> Plan only
          </Button>
        </div>
      </section>

      {/* History */}
      <section aria-label="Contact history" className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">History</h3>
        {history.isLoading ? (
          <p className="text-xs text-muted-foreground">Loading history…</p>
        ) : history.isError ? (
          <p className="text-xs text-destructive">History could not be loaded: {(history.error as Error).message}</p>
        ) : (history.data ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">No recorded contact.</p>
        ) : (
          <ul className="space-y-2">
            {(history.data ?? []).map((h) => (
              <li key={h.id} className="rounded-md border border-border/70 p-2 text-xs">
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
      </section>
    </div>
  );
}

