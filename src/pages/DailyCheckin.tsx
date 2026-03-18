import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { invokeEdge } from "@/lib/edgeInvoke";
import { toast } from "sonner";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  CheckCircle2,
  Loader2,
  BookOpen,
  Calendar,
  Crown,
  PhoneCall,
  HelpCircle,
  ShoppingCart,
  GraduationCap,
  ClipboardCheck,
  Fingerprint,
  Clock,
  User,
  Phone,
  MessageSquare,
} from "lucide-react";
import { getTodayPST } from "@/lib/dateUtils";

const PROGRESS_OPTIONS = [
  { value: "pre_course", label: "Waiting to Purchase Course", icon: ShoppingCart, description: "Haven't purchased the pre-licensing course yet" },
  { value: "course_purchased", label: "Already in Course", icon: GraduationCap, description: "Currently studying the pre-licensing course" },
  { value: "studying", label: "Waiting to Schedule Test", icon: BookOpen, description: "Finished course, need to schedule the exam" },
  { value: "exam_scheduled", label: "Test Already Scheduled", icon: Calendar, description: "Exam date is set" },
  { value: "exam_passed", label: "Passed Test ✅", icon: ClipboardCheck, description: "Passed the licensing exam" },
  { value: "waiting_fingerprints", label: "Waiting for Fingerprints", icon: Fingerprint, description: "Need to complete fingerprinting" },
  { value: "fingerprints_done", label: "Fingerprints Done", icon: CheckCircle2, description: "Fingerprinting completed" },
  { value: "pending_state", label: "Waiting on License", icon: Clock, description: "Waiting for state approval" },
];

function normPhone(raw: string): string {
  return raw.replace(/\D/g, "").slice(-10);
}

export default function DailyCheckin() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [lookingUp, setLookingUp] = useState(false);
  const [appId, setAppId] = useState<string | null>(null);
  const [applicant, setApplicant] = useState<{ first_name: string; last_name: string } | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [helpNotified, setHelpNotified] = useState(false);

  const [progress, setProgress] = useState("");
  const [testDate, setTestDate] = useState("");
  const [notes, setNotes] = useState("");
  const [blocker, setBlocker] = useState("");
  const [needsHelp, setNeedsHelp] = useState(false);
  const [courseQuestion, setCourseQuestion] = useState<"yes" | "no" | "">("");
  const [managerMessage, setManagerMessage] = useState("");

  const todayPST = getTodayPST();

  const handleLookup = async () => {
    if (!firstName.trim() || !lastName.trim() || !phone.trim()) {
      toast.error("Please fill in all fields");
      return;
    }
    const normalizedInput = normPhone(phone);
    if (normalizedInput.length < 10) {
      toast.error("Please enter a valid phone number");
      return;
    }
    setLookingUp(true);
    setNotFound(false);

    // Query by name (case-insensitive), then filter phone client-side
    const { data } = await supabase
      .from("applications")
      .select("id, first_name, last_name, phone")
      .ilike("first_name", firstName.trim())
      .ilike("last_name", lastName.trim())
      .is("terminated_at", null)
      .order("created_at", { ascending: false })
      .limit(20);

    const match = (data || []).find(
      (app) => app.phone && normPhone(app.phone) === normalizedInput
    );

    if (!match) {
      setNotFound(true);
      setLookingUp(false);
      return;
    }

    setAppId(match.id);
    setApplicant({ first_name: match.first_name, last_name: match.last_name });

    // Check existing checkin for today
    const { data: existing } = await supabase
      .from("applicant_checkins")
      .select("id, license_progress, test_date, notes, blocker")
      .eq("application_id", match.id)
      .eq("checkin_date", todayPST)
      .maybeSingle();

    if (existing) {
      setProgress(existing.license_progress || "");
      setTestDate(existing.test_date || "");
      setNotes(existing.notes || "");
      setBlocker(existing.blocker || "");
    }

    setLookingUp(false);
  };

  const handleSubmit = async () => {
    if (!appId || !progress) {
      toast.error("Please select your current progress");
      return;
    }
    setSaving(true);
    try {
      const combinedNotes = [notes, managerMessage ? `Manager message: ${managerMessage}` : ""]
        .filter(Boolean)
        .join(" | ") || null;

      const payload = {
        application_id: appId,
        checkin_date: todayPST,
        license_progress: progress,
        study_hours: 0,
        test_scheduled: progress === "exam_scheduled",
        test_date: testDate || null,
        notes: combinedNotes,
        blocker: blocker || (courseQuestion === "yes" ? "Has questions about the course" : null),
        needs_help: needsHelp,
      };

      const { error } = await supabase
        .from("applicant_checkins")
        .upsert(payload, { onConflict: "application_id,checkin_date" });

      if (error) throw error;

      await supabase
        .from("applications")
        .update({
          license_progress: progress as any,
          ...(progress === "exam_scheduled" && testDate ? { test_scheduled_date: testDate } : {}),
        })
        .eq("id", appId);

      let helpSent = false;
      if (needsHelp || managerMessage.trim()) {
        try {
          const applicantName = applicant ? `${applicant.first_name} ${applicant.last_name}` : "Applicant";
          const result = await invokeEdge("send-notification", {
            email: "sam@apex-financial.org",
            title: needsHelp ? "🆘 Applicant Needs Help" : "📩 Applicant Message",
            message: `${applicantName} submitted a check-in. Progress: ${progress}. ${managerMessage ? `Message: ${managerMessage}` : ""} ${blocker ? `Blocker: ${blocker}` : ""}`.trim(),
            url: `${window.location.origin}/dashboard/applicants?search=${encodeURIComponent(applicant?.first_name + " " + applicant?.last_name)}`,
          });
          helpSent = result.success;
        } catch (e) {
          console.error("Failed to send notification:", e);
        }
      }

      if (needsHelp) setHelpNotified(helpSent);
      setSubmitted(true);
      toast.success("Check-in submitted! 🎉");
    } catch (err) {
      console.error(err);
      toast.error("Failed to submit. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  // Success screen
  if (submitted) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <GlassCard className="p-8 text-center max-w-md space-y-4">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
            <CheckCircle2 className="h-8 w-8 text-primary" />
          </div>
          <h2 className="text-xl font-bold">Check-In Complete!</h2>
          <p className="text-sm text-muted-foreground">
            Thanks {applicant?.first_name}! Your progress has been recorded. Keep pushing forward! 💪
          </p>
          {needsHelp && helpNotified && (
            <p className="text-sm text-primary font-medium">
              📞 Your manager and admin have been notified — someone will reach out to you soon!
            </p>
          )}
          {needsHelp && !helpNotified && (
            <p className="text-sm text-amber-500 font-medium">
              ⚠️ We couldn't send the notification right now, but your request has been saved. Please call your manager directly.
            </p>
          )}
          <Badge variant="outline" className="text-xs">{todayPST}</Badge>
        </GlassCard>
      </div>
    );
  }

  // Lookup screen — first name, last name, phone
  if (!appId) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-md space-y-4">
          <div className="text-center space-y-2">
            <div className="flex items-center justify-center gap-2">
              <Crown className="h-6 w-6 text-primary" />
              <span className="text-lg font-bold gradient-text">APEX</span>
            </div>
            <h1 className="text-xl font-bold">Daily Check-In</h1>
            <p className="text-sm text-muted-foreground">Enter your info to get started</p>
            <Badge variant="outline" className="text-xs">{todayPST}</Badge>
          </div>

          <GlassCard className="p-5 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium flex items-center gap-2">
                  <User className="h-4 w-4 text-primary" />
                  First Name
                </Label>
                <Input
                  value={firstName}
                  onChange={e => setFirstName(e.target.value)}
                  placeholder="John"
                  className="bg-input"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Last Name</Label>
                <Input
                  value={lastName}
                  onChange={e => setLastName(e.target.value)}
                  placeholder="Doe"
                  className="bg-input"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm font-medium flex items-center gap-2">
                <Phone className="h-4 w-4 text-primary" />
                Phone Number
              </Label>
              <Input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleLookup()}
                placeholder="(555) 123-4567"
                className="bg-input"
              />
            </div>

            {notFound && (
              <p className="text-sm text-destructive text-center">
                No application found. Please use the name and phone number you applied with.
              </p>
            )}

            <Button onClick={handleLookup} disabled={lookingUp} className="w-full" size="lg">
              {lookingUp ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Looking up...</> : "Continue →"}
            </Button>
          </GlassCard>

          <p className="text-center text-[10px] text-muted-foreground">
            Powered by Apex Financial
          </p>
        </div>
      </div>
    );
  }

  // Check-in form
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-lg space-y-4">
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-2">
            <Crown className="h-6 w-6 text-primary" />
            <span className="text-lg font-bold gradient-text">APEX</span>
          </div>
          <h1 className="text-xl font-bold">Daily Check-In</h1>
          {applicant && (
            <p className="text-sm text-muted-foreground">
              Welcome back, <span className="font-medium text-foreground">{applicant.first_name}</span>!
            </p>
          )}
          <Badge variant="outline" className="text-xs">{todayPST}</Badge>
        </div>

        <GlassCard className="p-5 space-y-5">
          <div className="space-y-2">
            <Label className="text-sm font-medium flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-primary" />
              Where are you in the licensing process?
            </Label>
            <div className="grid gap-2">
              {PROGRESS_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const isSelected = progress === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => { setProgress(opt.value); setCourseQuestion(""); }}
                    className={`flex items-center gap-3 p-3 rounded-lg border text-left transition-all ${
                      isSelected
                        ? "bg-primary/10 border-primary/40 ring-1 ring-primary/30"
                        : "bg-card/50 border-border hover:bg-muted/50"
                    }`}
                  >
                    <Icon className={`h-5 w-5 flex-shrink-0 ${isSelected ? "text-primary" : "text-muted-foreground"}`} />
                    <div className="min-w-0">
                      <p className={`text-sm font-medium ${isSelected ? "text-foreground" : "text-foreground/80"}`}>
                        {opt.label}
                      </p>
                      <p className="text-xs text-muted-foreground">{opt.description}</p>
                    </div>
                    {isSelected && <CheckCircle2 className="h-4 w-4 text-primary ml-auto flex-shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>

          {progress === "course_purchased" && (
            <div className="space-y-2 p-3 rounded-lg border border-border bg-card/50">
              <Label className="text-sm font-medium flex items-center gap-2">
                <HelpCircle className="h-4 w-4 text-primary" />
                Having questions with the course?
              </Label>
              <div className="flex gap-2">
                <Button type="button" variant={courseQuestion === "yes" ? "default" : "outline"} size="sm" onClick={() => setCourseQuestion("yes")}>Yes</Button>
                <Button type="button" variant={courseQuestion === "no" ? "default" : "outline"} size="sm" onClick={() => setCourseQuestion("no")}>No</Button>
              </div>
              {courseQuestion === "yes" && (
                <Textarea value={blocker} onChange={e => setBlocker(e.target.value)} placeholder="What questions do you have? We'll help!" className="bg-input resize-none mt-2" rows={2} />
              )}
            </div>
          )}

          {progress === "exam_scheduled" && (
            <div className="space-y-1.5">
              <Label className="text-sm font-medium flex items-center gap-2">
                <Calendar className="h-4 w-4 text-primary" />
                Exam Date
              </Label>
              <Input type="date" value={testDate} onChange={e => setTestDate(e.target.value)} className="bg-input" />
            </div>
          )}

          {/* Manager Message */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-primary" />
              Message for your manager (optional)
            </Label>
            <Textarea
              value={managerMessage}
              onChange={e => setManagerMessage(e.target.value)}
              placeholder="Type a message for your manager here..."
              className="bg-input resize-none"
              rows={2}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Additional notes (optional)</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Anything else you'd like to share..." className="bg-input resize-none" rows={2} />
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg border border-amber-500/30 bg-amber-500/5">
            <Label className="text-sm font-medium flex items-center gap-2 cursor-pointer">
              <PhoneCall className="h-4 w-4 text-amber-500" />
              I need a phone call for help/support
            </Label>
            <Switch checked={needsHelp} onCheckedChange={setNeedsHelp} />
          </div>

          <Button onClick={handleSubmit} disabled={saving || !progress} className="w-full" size="lg">
            {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Submitting...</> : "Submit Check-In ✅"}
          </Button>
        </GlassCard>

        <p className="text-center text-[10px] text-muted-foreground">
          Powered by Apex Financial
        </p>
      </div>
    </div>
  );
}
