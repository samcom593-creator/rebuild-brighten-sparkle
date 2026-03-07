import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
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
  AlertTriangle,
  Crown,
  PhoneCall,
  HelpCircle,
  ShoppingCart,
  GraduationCap,
  ClipboardCheck,
  Fingerprint,
  Clock,
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

export default function ApplicantCheckin() {
  const [searchParams] = useSearchParams();
  const appId = searchParams.get("id");
  const [applicant, setApplicant] = useState<{ first_name: string; last_name: string; email: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const [progress, setProgress] = useState("");
  const [testDate, setTestDate] = useState("");
  const [notes, setNotes] = useState("");
  const [blocker, setBlocker] = useState("");
  const [needsHelp, setNeedsHelp] = useState(false);
  const [courseQuestion, setCourseQuestion] = useState<"yes" | "no" | "">("");

  const todayPST = getTodayPST();

  useEffect(() => {
    if (!appId) return;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("applications")
        .select("first_name, last_name, email")
        .eq("id", appId)
        .maybeSingle();
      if (data) setApplicant(data);

      // Check if already checked in today
      const { data: existing } = await supabase
        .from("applicant_checkins")
        .select("id, license_progress, test_date, notes, blocker")
        .eq("application_id", appId)
        .eq("checkin_date", todayPST)
        .maybeSingle();

      if (existing) {
        setProgress(existing.license_progress || "");
        setTestDate(existing.test_date || "");
        setNotes(existing.notes || "");
        setBlocker(existing.blocker || "");
      }
      setLoading(false);
    })();
  }, [appId]);

  const handleSubmit = async () => {
    if (!appId || !progress) {
      toast.error("Please select your current progress");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        application_id: appId,
        checkin_date: todayPST,
        license_progress: progress,
        study_hours: 0,
        test_scheduled: progress === "exam_scheduled",
        test_date: testDate || null,
        notes: notes || null,
        blocker: blocker || (courseQuestion === "yes" ? "Has questions about the course" : null),
        needs_help: needsHelp,
      };

      const { error } = await supabase
        .from("applicant_checkins")
        .upsert(payload, { onConflict: "application_id,checkin_date" });

      if (error) throw error;

      // Update the application's license_progress
      await supabase
        .from("applications")
        .update({
          license_progress: progress as any,
          ...(progress === "exam_scheduled" && testDate ? { test_scheduled_date: testDate } : {}),
        })
        .eq("id", appId);

      // If they need help, notify admin + manager
      if (needsHelp) {
        try {
          const applicantName = applicant ? `${applicant.first_name} ${applicant.last_name}` : "Applicant";
          await supabase.functions.invoke("send-notification", {
            body: {
              email: "sam@apex-financial.org",
              title: "🆘 Applicant Needs Help",
              message: `${applicantName} submitted a check-in and flagged that they need help. Progress: ${progress}. ${blocker ? `Blocker: ${blocker}` : ""}`,
              url: `${window.location.origin}/applicants?search=${encodeURIComponent(applicant?.email || "")}`,
            },
          });
        } catch (e) {
          console.error("Failed to send help notification:", e);
        }
      }

      setSubmitted(true);
      toast.success("Check-in submitted! 🎉");
    } catch (err) {
      console.error(err);
      toast.error("Failed to submit. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (!appId) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <GlassCard className="p-8 text-center max-w-md">
          <AlertTriangle className="h-10 w-10 text-destructive mx-auto mb-3" />
          <h2 className="text-lg font-bold">Invalid Check-In Link</h2>
          <p className="text-sm text-muted-foreground mt-2">This link is missing required information. Please use the link from your email.</p>
        </GlassCard>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

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
          {needsHelp && (
            <p className="text-sm text-primary font-medium">
              📞 Your manager and admin have been notified — someone will reach out to you soon!
            </p>
          )}
          <Badge variant="outline" className="text-xs">{todayPST}</Badge>
        </GlassCard>
      </div>
    );
  }

  const selectedOption = PROGRESS_OPTIONS.find(o => o.value === progress);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-lg space-y-4">
        {/* Header */}
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
          {/* Progress Selection */}
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

          {/* Contextual follow-ups */}
          {progress === "course_purchased" && (
            <div className="space-y-2 p-3 rounded-lg border border-border bg-card/50">
              <Label className="text-sm font-medium flex items-center gap-2">
                <HelpCircle className="h-4 w-4 text-primary" />
                Having questions with the course?
              </Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={courseQuestion === "yes" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setCourseQuestion("yes")}
                >
                  Yes
                </Button>
                <Button
                  type="button"
                  variant={courseQuestion === "no" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setCourseQuestion("no")}
                >
                  No
                </Button>
              </div>
              {courseQuestion === "yes" && (
                <Textarea
                  value={blocker}
                  onChange={e => setBlocker(e.target.value)}
                  placeholder="What questions do you have? We'll help!"
                  className="bg-input resize-none mt-2"
                  rows={2}
                />
              )}
            </div>
          )}

          {progress === "exam_scheduled" && (
            <div className="space-y-1.5">
              <Label className="text-sm font-medium flex items-center gap-2">
                <Calendar className="h-4 w-4 text-primary" />
                Exam Date
              </Label>
              <Input
                type="date"
                value={testDate}
                onChange={e => setTestDate(e.target.value)}
                className="bg-input"
              />
            </div>
          )}

          {/* Notes */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Additional notes (optional)</Label>
            <Textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Anything else you'd like to share..."
              className="bg-input resize-none"
              rows={2}
            />
          </div>

          {/* Need Help Button */}
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
