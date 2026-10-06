import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { TimeZoneSelect } from "@/components/calendar/TimeZoneSelect";
import { ConflictNotice, useOwnerConflicts } from "@/components/calendar/ConflictNotice";
import {
  INTERVIEW_OUTCOMES, cancelInterviewEvent, rescheduleInterviewEvent,
} from "@/components/calendar/calendarApi";
import type { CalendarItem } from "@/lib/calendarAgenda";
import {
  BUSINESS_TZ, dateKeyInZone, describeEventTime, isValidTimeZone, timeValueInZone, viewerTimeZone,
  zonedWallTimeToUtc,
} from "@/lib/calendarTime";

const DURATIONS = ["15", "30", "45", "60", "90"];

function durationOf(item: CalendarItem): string {
  if (!item.endsAt) return "30";
  const mins = Math.round((Date.parse(item.endsAt) - Date.parse(item.startsAt)) / 60000);
  return mins > 0 ? String(mins) : "30";
}

/**
 * Reschedule a staff-booked interview. Updates the existing interview_events
 * row through reschedule_interview_event; the server supersedes reminders about
 * the old time and writes the history row.
 */
export function RescheduleInterviewDialog({
  item,
  viewerUserId,
  open,
  onOpenChange,
  onDone,
}: {
  item: CalendarItem | null;
  viewerUserId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const initialZone = item && isValidTimeZone(item.eventTz) ? (item.eventTz as string) : BUSINESS_TZ;
  const [zone, setZone] = useState(initialZone);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("09:00");
  const [duration, setDuration] = useState("30");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!item || !open) return;
    const z = isValidTimeZone(item.eventTz) ? (item.eventTz as string) : BUSINESS_TZ;
    setZone(z);
    setDate(dateKeyInZone(item.startsAt, z));
    setTime(timeValueInZone(item.startsAt, z));
    setDuration(durationOf(item));
    setReason("");
  }, [item, open]);

  const proposed = useMemo(() => {
    if (!date || !time) return null;
    try {
      const start = zonedWallTimeToUtc(date, time, zone);
      const end = new Date(Date.parse(start) + Number(duration) * 60000).toISOString();
      return { start, end };
    } catch {
      return null;
    }
  }, [date, time, zone, duration]);

  const owner = item?.agenda?.owner_user_id ?? viewerUserId;
  const conflicts = useOwnerConflicts({
    ownerUserId: owner,
    startsAt: proposed?.start ?? null,
    endsAt: proposed?.end ?? null,
    excludeKey: item?.key ?? null,
  });

  if (!item) return null;
  const viewerTz = viewerTimeZone();
  const current = describeEventTime(item.startsAt, item.eventTz, viewerTz);
  const next = proposed ? describeEventTime(proposed.start, zone, viewerTz) : null;

  const submit = async () => {
    if (!proposed || !item.refId) return;
    setSaving(true);
    try {
      await rescheduleInterviewEvent({
        id: item.refId,
        newAt: proposed.start,
        eventTz: zone,
        reason: reason.trim() || null,
        durationMinutes: Number(duration),
      });
      toast.success("Interview moved — the same booking was updated");
      onDone();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not reschedule");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Reschedule {item.title}</DialogTitle>
          <DialogDescription>
            Now: {current.eventLabel}
            {current.zoneUnknown ? " (zone not recorded — shown in Arizona time)" : ""}
            {current.viewerLabel ? ` · ${current.viewerLabel} your time` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="resched-date" className="text-xs font-medium text-muted-foreground">Date</label>
              <Input id="resched-date" type="date" className="mt-1" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <label htmlFor="resched-time" className="text-xs font-medium text-muted-foreground">Start</label>
              <Input id="resched-time" type="time" className="mt-1" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <label htmlFor="resched-zone" className="text-xs font-medium text-muted-foreground">Time zone</label>
              <TimeZoneSelect id="resched-zone" className="mt-1" value={zone} onChange={setZone} ariaLabel="Interview time zone" />
            </div>
            <div>
              <label htmlFor="resched-duration" className="text-xs font-medium text-muted-foreground">Length</label>
              <Select value={duration} onValueChange={setDuration}>
                <SelectTrigger id="resched-duration" aria-label="Interview length" className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DURATIONS.map((m) => <SelectItem key={m} value={m}>{m} min</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          {next && (
            <p className="text-xs text-foreground">
              New time: <span className="font-medium">{next.eventLabel}</span>
              {next.viewerLabel ? <span className="text-muted-foreground"> · {next.viewerLabel} your time{next.viewerDay ? ` (${next.viewerDay})` : ""}</span> : null}
            </p>
          )}
          <ConflictNotice conflicts={conflicts.data} isLoading={conflicts.isFetching} isError={conflicts.isError} />
          <div>
            <label htmlFor="resched-reason" className="text-xs font-medium text-muted-foreground">Reason (kept in history)</label>
            <Textarea id="resched-reason" rows={2} className="mt-1" value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Candidate asked for a later slot" />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Pending reminders for the old time are retired; the next reminder follows the new time.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={submit} disabled={saving || !proposed}>{saving ? "Saving…" : "Move interview"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Cancel (never delete): reason required, outcome optional. */
export function CancelInterviewDialog({
  item,
  open,
  onOpenChange,
  onDone,
}: {
  item: CalendarItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [outcome, setOutcome] = useState("none");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setReason(""); setOutcome("none"); }
  }, [open]);

  if (!item) return null;

  const submit = async () => {
    if (!item.refId || !reason.trim()) return;
    setSaving(true);
    try {
      await cancelInterviewEvent({ id: item.refId, reason: reason.trim(), outcome: outcome === "none" ? null : outcome });
      toast.success("Interview canceled — reminders stopped, history kept");
      onDone();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not cancel");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Cancel {item.title}</DialogTitle>
          <DialogDescription>
            The booking stays on record as canceled. Reminders for it stop.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label htmlFor="cancel-reason" className="text-xs font-medium text-muted-foreground">Reason *</label>
            <Textarea id="cancel-reason" rows={2} className="mt-1" value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this interview not happening?" />
          </div>
          <div>
            <label htmlFor="cancel-outcome" className="text-xs font-medium text-muted-foreground">Outcome (optional)</label>
            <Select value={outcome} onValueChange={setOutcome}>
              <SelectTrigger id="cancel-outcome" aria-label="Cancellation outcome" className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No outcome</SelectItem>
                {INTERVIEW_OUTCOMES.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Keep it</Button>
          <Button variant="destructive" onClick={submit} disabled={saving || !reason.trim()}>
            {saving ? "Canceling…" : "Cancel interview"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
