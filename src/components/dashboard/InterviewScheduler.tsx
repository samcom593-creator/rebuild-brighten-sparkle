import { useState } from "react";
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
  video: { label: "Video Call", icon: Video, color: "text-blue-400" },
  phone: { label: "Phone Call", icon: Phone, color: "text-emerald-400" },
  in_person: { label: "In Person", icon: MapPin, color: "text-violet-400" },
};

// Build a Google Calendar "add to calendar" URL (no OAuth required)
function buildCalendarUrl(params: {
  title: string;
  startDate: Date;
  durationMinutes: number;
  description: string;
  location?: string;
}): string {
  const start = format(params.startDate, "yyyyMMdd'T'HHmmss");
  const endDate = new Date(params.startDate.getTime() + params.durationMinutes * 60000);
  const end = format(endDate, "yyyyMMdd'T'HHmmss");
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

  const getInterviewDateTime = (): Date | null => {
    if (!selectedDate) return null;
    const dt = new Date(selectedDate);
    let hour = parseInt(timeHour, 10);
    if (timePeriod === "PM" && hour !== 12) hour += 12;
    if (timePeriod === "AM" && hour === 12) hour = 0;
    dt.setHours(hour, parseInt(timeMinute, 10), 0, 0);
    return dt;
  };

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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Insert into scheduled_interviews
      const { error: dbError } = await supabase
        .from("scheduled_interviews" as any)
        .insert({
          application_id: applicationId,
          scheduled_by: user.id,
          interview_date: interviewDate.toISOString(),
          interview_type: interviewType,
          meeting_link: meetingLink || null,
          notes: notes || null,
          status: "scheduled",
        });

      if (dbError) throw dbError;

      // Update application status to 'interview'
      await supabase
        .from("applications")
        .update({ status: "interview" })
        .eq("id", applicationId);

      // Send notification via edge function
      const { error: notifyError } = await supabase.functions.invoke("schedule-interview", {
        body: {
          applicationId,
          interviewDate: interviewDate.toISOString(),
          interviewType,
          meetingLink: meetingLink || null,
          notes: notes || null,
        },
      });

      if (notifyError) {
        console.error("Notification failed (non-critical):", notifyError);
      }

      // Build Google Calendar URL
      const typeLabel = interviewTypeConfig[interviewType].label;
      const gcalUrl = buildCalendarUrl({
        title: `Interview: ${applicantName} - Apex Financial`,
        startDate: interviewDate,
        durationMinutes: 30,
        description: `Interview with ${applicantName} (${applicantEmail})\nType: ${typeLabel}\n${meetingLink ? `Link: ${meetingLink}` : ""}\n${notes || ""}`,
        location: meetingLink || undefined,
      });
      setCalendarUrl(gcalUrl);

      toast.success(`Interview scheduled with ${applicantName}!`);
      onScheduled?.();
    } catch (err: any) {
      console.error("Error scheduling interview:", err);
      toast.error("Failed to schedule interview");
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
              <h3 className="font-semibold text-lg">Interview Scheduled! 🎉</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Confirmation sent to {applicantEmail}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                className="flex-1"
                onClick={() => window.open(calendarUrl, "_blank")}
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
                  {format(selectedDate, "EEEE, MMM d")} at {timeHour}:{timeMinute} {timePeriod}
                </span>
              </div>
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
                Schedule & Notify
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
