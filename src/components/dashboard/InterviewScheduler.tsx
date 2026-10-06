import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Calendar, Video, Phone, MapPin, Link2, Clock, CalendarPlus, Send, Loader2 } from "lucide-react";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { resolveBrand } from "@/config/brand";
import { bookInterviewEvent } from "@/components/calendar/calendarApi";
import { TimeZoneSelect } from "@/components/calendar/TimeZoneSelect";
import { ConflictNotice, useOwnerConflicts } from "@/components/calendar/ConflictNotice";
import { BUSINESS_TZ, describeEventTime, viewerTimeZone, zonedWallTimeToUtc } from "@/lib/calendarTime";

/*
 * One event model (redesign section 7). This modal used to INSERT
 * scheduled_interviews, a table the Calendar never read (2 rows ever, last
 * 2026-05-15), so every interview booked here vanished from the Calendar,
 * Calls Today and Follow-Ups. It now books through book_interview_event(),
 * which writes the same interview_events row Pipeline and Calendar read and
 * edit, with an explicit IANA time zone and the booking owner. The wall time is
 * converted to an instant in the CHOSEN zone, never the browser's, so a VA in
 * Manila booking a 10 AM Arizona interview books 10 AM Arizona.
 */
const BRAND = resolveBrand();

interface InterviewSchedulerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  applicationId: string;
  applicantName: string;
  applicantEmail: string;
  onScheduled?: () => void;
}

type InterviewType = "video" | "phone" | "in_person";

const interviewTypeConfig = {
  video: { label: "Video Call", icon: Video, color: "text-info" },
  phone: { label: "Phone Call", icon: Phone, color: "text-emerald-400" },
  in_person: { label: "In Person", icon: MapPin, color: "text-primary" },
};

// Build a Google Calendar "add to calendar" URL (no OAuth required)
function buildCalendarUrl(params: {
  title: string;
  startDate: Date;
  durationMinutes: number;
  description: string;
  location?: string;
}): string {
  // UTC with a Z suffix: a floating local time would be read in whatever zone
  // the viewer's Google account uses.
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const start = stamp(params.startDate);
  const end = stamp(new Date(params.startDate.getTime() + params.durationMinutes * 60000));
  const url = new URL("https://calendar.google.com/calendar/render");
  url.searchParams.set("action", "TEMPLATE");
  url.searchParams.set("text", params.title);
  url.searchParams.set("dates", `${start}/${end}`);
  url.searchParams.set("details", params.description);
  if (params.location) url.searchParams.set("location", params.location);
  return url.toString();
}

export function InterviewScheduler({
  open,
  onOpenChange,
  applicationId,
  applicantName,
  applicantEmail,
  onScheduled,
}: InterviewSchedulerProps) {
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [timeHour, setTimeHour] = useState("10");
  const [timeMinute, setTimeMinute] = useState("00");
  const [timePeriod, setTimePeriod] = useState<"AM" | "PM">("AM");
  const [interviewType, setInterviewType] = useState<InterviewType>("video");
  const [meetingLink, setMeetingLink] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [calendarUrl, setCalendarUrl] = useState<string | null>(null);
  const [timeZone, setTimeZone] = useState<string>(BUSINESS_TZ);
  const [duration, setDuration] = useState("30");
  const [emailState, setEmailState] = useState<{ ok: boolean; text: string } | null>(null);
  const { user } = useAuth();

  /** The instant for the chosen wall time IN THE CHOSEN ZONE (not the browser's). */
  const interviewIso = useMemo((): string | null => {
    if (!selectedDate) return null;
    let hour = parseInt(timeHour, 10);
    if (timePeriod === "PM" && hour !== 12) hour += 12;
    if (timePeriod === "AM" && hour === 12) hour = 0;
    try {
      return zonedWallTimeToUtc(format(selectedDate, "yyyy-MM-dd"), `${String(hour).padStart(2, "0")}:${timeMinute}`, timeZone);
    } catch {
      return null;
    }
  }, [selectedDate, timeHour, timeMinute, timePeriod, timeZone]);

  const interviewEndIso = interviewIso
    ? new Date(Date.parse(interviewIso) + Number(duration) * 60000).toISOString()
    : null;
  const conflicts = useOwnerConflicts({ ownerUserId: user?.id, startsAt: interviewIso, endsAt: interviewEndIso });
  const timeLabel = interviewIso ? describeEventTime(interviewIso, timeZone, viewerTimeZone()) : null;

  const getInterviewDateTime = (): Date | null => (interviewIso ? new Date(interviewIso) : null);

  const handleSchedule = async () => {
    const interviewDate = getInterviewDateTime();
    if (!interviewDate) {
      toast.error("Please select a date and time");
      return;
    }
    if (interviewDate < new Date()) {
      toast.error("Interview date must be in the future");
      return;
    }

    setSubmitting(true);
    try {
      if (!user) throw new Error("Not authenticated");

      // One write: the interview_events row Calendar + Pipeline share. The RPC
      // also advances applications.status to 'interview' for early stages only
      // and logs the booking to the person's activity history.
      await bookInterviewEvent({
        scheduledAt: interviewDate.toISOString(),
        eventTz: timeZone,
        applicationId,
        inviteeName: applicantName,
        inviteeEmail: applicantEmail,
        durationMinutes: Number(duration),
        meetingLink: meetingLink.trim() || null,
        notes: notes.trim() || null,
      });

      // Applicant confirmation email (existing path). A 2xx from the function is
      // only a request; report what the mail service actually acknowledged.
      const { data: notifyData, error: notifyError } = await supabase.functions.invoke("schedule-interview", {
        body: {
          applicationId,
          interviewDate: interviewDate.toISOString(),
          interviewType,
          meetingLink: meetingLink || null,
          notes: notes || null,
          timeZone,
        },
      });
      const notify = (notifyData ?? null) as { success?: boolean; email_id?: string | null; error?: string } | null;
      if (notifyError || notify?.success === false) {
        setEmailState({ ok: false, text: `Confirmation email not confirmed: ${notifyError?.message ?? notify?.error ?? "unknown error"}` });
      } else if (notify?.email_id) {
        setEmailState({ ok: true, text: `Confirmation email accepted by the mail service for ${applicantEmail}` });
      } else {
        setEmailState({ ok: true, text: `Confirmation email requested for ${applicantEmail} (no delivery receipt returned)` });
      }

      // Build Google Calendar URL
      const typeLabel = interviewTypeConfig[interviewType].label;
      const gcalUrl = buildCalendarUrl({
        title: `Interview: ${applicantName} - ${BRAND.legalName}`,
        startDate: interviewDate,
        durationMinutes: Number(duration),
        description: `Interview with ${applicantName} (${applicantEmail})\nType: ${typeLabel}\n${meetingLink ? `Link: ${meetingLink}` : ""}\n${notes || ""}`,
        location: meetingLink || undefined,
      });
      setCalendarUrl(gcalUrl);

      toast.success(`Interview booked with ${applicantName}`);
      onScheduled?.();
    } catch (err: any) {
      // Surface the actual cause (permission, bad zone, past time, missing
      // person) rather than a generic "failed to schedule".
      console.error("Error scheduling interview:", err);
      const code   = err?.code ?? err?.status ?? "";
      const detail = err?.details ?? err?.hint ?? err?.message ?? String(err);
      const short  = code ? `${code}: ${detail}` : detail;
      toast.error(`Schedule failed — ${short}`.slice(0, 220));
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    setSelectedDate(undefined);
    setTimeHour("10");
    setTimeMinute("00");
    setTimePeriod("AM");
    setInterviewType("video");
    setMeetingLink("");
    setNotes("");
    setCalendarUrl(null);
    setTimeZone(BUSINESS_TZ);
    setDuration("30");
    setEmailState(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-primary/10">
              <Calendar className="h-4 w-4 text-primary" />
            </div>
            Schedule Interview
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Scheduling with <span className="font-medium text-foreground">{applicantName}</span>
          </p>
        </DialogHeader>

        {calendarUrl ? (
          // Success state: show calendar link
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="space-y-4 py-2"
          >
            <div className="text-center">
              <div className="w-14 h-14 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto mb-3">
                <CalendarPlus className="h-7 w-7 text-emerald-400" />
              </div>
              <h3 className="font-semibold text-lg">Interview booked</h3>
              <p className="text-sm text-muted-foreground mt-1">
                On the calendar{timeLabel ? ` for ${timeLabel.eventLabel}` : ""}.
              </p>
              {emailState && (
                <p className={cn("text-xs mt-1", emailState.ok ? "text-muted-foreground" : "text-destructive")}>
                  {emailState.text}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                className="flex-1"
                onClick={() => window.open(calendarUrl, "_blank", "noopener,noreferrer")}
              >
                <CalendarPlus className="h-4 w-4 mr-2" />
                Add to Google Calendar
              </Button>
              <Button variant="outline" onClick={handleClose}>Done</Button>
            </div>
          </motion.div>
        ) : (
          <div className="space-y-4 py-2">
            {/* Interview Type */}
            <div className="space-y-2">
              <Label>Interview Type</Label>
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(interviewTypeConfig) as InterviewType[]).map((type) => {
                  const config = interviewTypeConfig[type];
                  const Icon = config.icon;
                  return (
                    <button
                      key={type}
                      onClick={() => setInterviewType(type)}
                      className={cn(
                        "flex flex-col items-center gap-1 p-3 rounded-lg border transition-all text-xs font-medium",
                        interviewType === type
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:border-primary/40 hover:bg-muted"
                      )}
                    >
                      <Icon className={cn("h-4 w-4", interviewType === type ? "text-primary" : config.color)} />
                      {config.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Date Picker */}
            <div className="space-y-2">
              <Label>Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !selectedDate && "text-muted-foreground"
                    )}
                  >
                    <Calendar className="mr-2 h-4 w-4" />
                    {selectedDate ? format(selectedDate, "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarPicker
                    mode="single"
                    selected={selectedDate}
                    onSelect={setSelectedDate}
                    disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0)) || date.getDay() === 0 || date.getDay() === 6}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* Time Picker */}
            <div className="space-y-2">
              <Label>Time</Label>
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <Select value={timeHour} onValueChange={setTimeHour}>
                  <SelectTrigger className="w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0")).map((h) => (
                      <SelectItem key={h} value={h}>{h}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-muted-foreground">:</span>
                <Select value={timeMinute} onValueChange={setTimeMinute}>
                  <SelectTrigger className="w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["00", "15", "30", "45"].map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={timePeriod} onValueChange={(v) => setTimePeriod(v as "AM" | "PM")}>
                  <SelectTrigger className="w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="AM">AM</SelectItem>
                    <SelectItem value="PM">PM</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Time zone + length */}
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2 space-y-2">
                <Label htmlFor="interview-zone">Time zone</Label>
                <TimeZoneSelect id="interview-zone" value={timeZone} onChange={setTimeZone} ariaLabel="Interview time zone" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="interview-length">Length</Label>
                <Select value={duration} onValueChange={setDuration}>
                  <SelectTrigger id="interview-length" aria-label="Interview length"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["15", "30", "45", "60"].map((m) => <SelectItem key={m} value={m}>{m} min</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Meeting Link */}
            {interviewType === "video" && (
              <div className="space-y-2">
                <Label>Meeting Link <span className="text-muted-foreground text-xs">(optional)</span></Label>
                <div className="relative">
                  <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="https://meet.google.com/..."
                    value={meetingLink}
                    onChange={(e) => setMeetingLink(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>
            )}

            {/* Notes */}
            <div className="space-y-2">
              <Label>Notes <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Textarea
                placeholder="Any instructions or notes for the applicant..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="resize-none"
              />
            </div>

            {/* Preview */}
            {selectedDate && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 border border-border">
                <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30 text-xs">
                  Preview
                </Badge>
                <span className="text-sm text-muted-foreground">
                  {format(selectedDate, "EEEE, MMM d")} at {timeLabel?.eventLabel ?? `${timeHour}:${timeMinute} ${timePeriod}`}
                  {timeLabel?.viewerLabel ? ` · ${timeLabel.viewerLabel} your time` : ""}
                </span>
              </div>
            )}
            {selectedDate && (
              <ConflictNotice conflicts={conflicts.data} isLoading={conflicts.isFetching} isError={conflicts.isError} />
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-1">
              <Button
                onClick={handleSchedule}
                disabled={submitting || !selectedDate}
                className="flex-1"
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Send className="h-4 w-4 mr-2" />
                )}
                Book & email applicant
              </Button>
              <Button variant="outline" onClick={handleClose} disabled={submitting}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
