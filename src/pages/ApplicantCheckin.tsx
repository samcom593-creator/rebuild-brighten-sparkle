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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2, Loader2, BookOpen, Calendar, AlertTriangle, Crown } from "lucide-react";
import { getTodayPST } from "@/lib/dateUtils";

const LICENSE_PROGRESS_OPTIONS = [
  { value: "unlicensed", label: "Not Started" },
  { value: "pre_course", label: "Pre-Licensing Course" },
  { value: "studying", label: "Studying for Exam" },
  { value: "exam_scheduled", label: "Exam Scheduled" },
  { value: "exam_passed", label: "Exam Passed" },
  { value: "pending_state", label: "Pending State Approval" },
  { value: "licensed", label: "Licensed ✅" },
];

export default function ApplicantCheckin() {
  const [searchParams] = useSearchParams();
  const appId = searchParams.get("id");
  const [applicant, setApplicant] = useState<{ first_name: string; last_name: string; email: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const [progress, setProgress] = useState("unlicensed");
  const [studyHours, setStudyHours] = useState("");
  const [testScheduled, setTestScheduled] = useState(false);
  const [testDate, setTestDate] = useState("");
  const [notes, setNotes] = useState("");
  const [blocker, setBlocker] = useState("");

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
        .select("id, license_progress, study_hours, test_scheduled, test_date, notes, blocker")
        .eq("application_id", appId)
        .eq("checkin_date", todayPST)
        .maybeSingle();

      if (existing) {
        setProgress(existing.license_progress || "unlicensed");
        setStudyHours(String(existing.study_hours || 0));
        setTestScheduled(existing.test_scheduled || false);
        setTestDate(existing.test_date || "");
        setNotes(existing.notes || "");
        setBlocker(existing.blocker || "");
      }
      setLoading(false);
    })();
  }, [appId]);

  const handleSubmit = async () => {
    if (!appId) return;
    setSaving(true);
    try {
      const payload = {
        application_id: appId,
        checkin_date: todayPST,
        license_progress: progress,
        study_hours: parseFloat(studyHours) || 0,
        test_scheduled: testScheduled,
        test_date: testDate || null,
        notes: notes || null,
        blocker: blocker || null,
      };

      const { error } = await supabase
        .from("applicant_checkins")
        .upsert(payload, { onConflict: "application_id,checkin_date" });

      if (error) throw error;

      // Also update the application's license_progress
      await supabase
        .from("applications")
        .update({
          license_progress: progress as any,
          ...(testScheduled && testDate ? { test_scheduled_date: testDate } : {}),
        })
        .eq("id", appId);

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
          <Badge variant="outline" className="text-xs">{todayPST}</Badge>
        </GlassCard>
      </div>
    );
  }

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
          {/* License Progress */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-primary" />
              Where are you in the licensing process?
            </Label>
            <Select value={progress} onValueChange={setProgress}>
              <SelectTrigger className="bg-input">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LICENSE_PROGRESS_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Study Hours */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Hours studied today</Label>
            <Input
              type="number"
              min="0"
              step="0.5"
              value={studyHours}
              onChange={e => setStudyHours(e.target.value)}
              placeholder="0"
              className="bg-input text-center text-lg font-bold"
            />
          </div>

          {/* Test Scheduled */}
          <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-card/50">
            <Label className="text-sm font-medium flex items-center gap-2">
              <Calendar className="h-4 w-4 text-primary" />
              Exam scheduled?
            </Label>
            <Switch checked={testScheduled} onCheckedChange={setTestScheduled} />
          </div>

          {testScheduled && (
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Exam Date</Label>
              <Input
                type="date"
                value={testDate}
                onChange={e => setTestDate(e.target.value)}
                className="bg-input"
              />
            </div>
          )}

          {/* Blockers */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Any blockers or challenges?
            </Label>
            <Textarea
              value={blocker}
              onChange={e => setBlocker(e.target.value)}
              placeholder="What's holding you back? (optional)"
              className="bg-input resize-none"
              rows={2}
            />
          </div>

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

          <Button onClick={handleSubmit} disabled={saving} className="w-full" size="lg">
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
