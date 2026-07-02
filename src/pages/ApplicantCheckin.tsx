import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Loader2, CheckCircle2, MessageCircle, Crown, CalendarDays } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { GlassCard } from "@/components/ui/glass-card";
import { GradientButton } from "@/components/ui/gradient-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { SCHEDULING_LINKS } from "@/lib/apexConfig";
import { WHATSAPP_GROUP_URL } from "@/lib/constants";

type CheckinFormState = {
  licenseProgress: string;
  studyHours: string;
  needsHelp: boolean;
  blocker: string;
  notes: string;
  testScheduled: boolean;
  testDate: string;
};

type CheckinLoadResponse = {
  application?: {
    id: string;
    firstName: string;
    lastName: string;
    state: string | null;
    email: string;
    licenseStatus: string | null;
    licenseProgress: string;
    testScheduledDate: string | null;
  };
  checkinDate?: string;
  existingCheckin?: {
    license_progress?: string | null;
    study_hours?: number | null;
    needs_help?: boolean | null;
    blocker?: string | null;
    notes?: string | null;
    test_scheduled?: boolean | null;
    test_date?: string | null;
  } | null;
  error?: string;
};

const LICENSE_STEPS = [
  { value: "unlicensed", label: "Not started yet" },
  { value: "course_purchased", label: "Course purchased / in course" },
  { value: "finished_course", label: "Finished the course" },
  { value: "test_scheduled", label: "Test scheduled" },
  { value: "passed_test", label: "Passed the test" },
  { value: "fingerprints_done", label: "Fingerprints done" },
  { value: "waiting_on_license", label: "Waiting on the state" },
  { value: "licensed", label: "Licensed" },
] as const;

const emptyForm: CheckinFormState = {
  licenseProgress: "unlicensed",
  studyHours: "",
  needsHelp: false,
  blocker: "",
  notes: "",
  testScheduled: false,
  testDate: "",
};

export default function ApplicantCheckin() {
  usePageTitle("Daily Licensing Check-In · APEX Financial");
  const [searchParams] = useSearchParams();
  const applicationId = searchParams.get("id") || "";
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [checkinDate, setCheckinDate] = useState<string | null>(null);
  const [application, setApplication] = useState<CheckinLoadResponse["application"] | null>(null);
  const [form, setForm] = useState<CheckinFormState>(emptyForm);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      if (!applicationId) {
        setLoadError("Missing check-in link.");
        setLoading(false);
        return;
      }

      setLoading(true);
      setLoadError(null);

      const { data, error } = await supabase.functions.invoke("applicant-checkin", {
        body: { action: "load", applicationId },
      });

      if (!mounted) return;

      if (error || data?.error) {
        setLoadError(error?.message || data?.error || "Could not load your check-in.");
        setLoading(false);
        return;
      }

      const payload = data as CheckinLoadResponse;
      setApplication(payload.application ?? null);
      setCheckinDate(payload.checkinDate ?? null);
      setForm({
        licenseProgress: payload.existingCheckin?.license_progress || payload.application?.licenseProgress || "unlicensed",
        studyHours: payload.existingCheckin?.study_hours != null ? String(payload.existingCheckin.study_hours) : "",
        needsHelp: Boolean(payload.existingCheckin?.needs_help),
        blocker: payload.existingCheckin?.blocker || "",
        notes: payload.existingCheckin?.notes || "",
        testScheduled: Boolean(payload.existingCheckin?.test_scheduled) || Boolean(payload.application?.testScheduledDate),
        testDate: payload.existingCheckin?.test_date || payload.application?.testScheduledDate || "",
      });
      setLoading(false);
    };

    void load();

    return () => {
      mounted = false;
    };
  }, [applicationId]);

  const greetingName = useMemo(() => application?.firstName || "there", [application?.firstName]);
  const helpLink = form.licenseProgress === "licensed" ? SCHEDULING_LINKS.licensed : SCHEDULING_LINKS.unlicensed;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!applicationId) return;

    setSubmitting(true);
    const { error, data } = await supabase.functions.invoke("applicant-checkin", {
      body: {
        action: "submit",
        applicationId,
        licenseProgress: form.licenseProgress,
        studyHours: form.studyHours,
        needsHelp: form.needsHelp,
        blocker: form.blocker,
        notes: form.notes,
        testScheduled: form.testScheduled,
        testDate: form.testDate,
      },
    });

    setSubmitting(false);

    if (error || data?.error) {
      toast.error(error?.message || data?.error || "Could not submit your check-in.");
      return;
    }

    setSubmitted(true);
    toast.success("Check-in saved.");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (loadError || !application) {
    return (
      <div className="min-h-screen bg-background py-10 px-4">
        <div className="max-w-xl mx-auto">
          <GlassCard className="p-8 text-center">
            <Crown className="h-10 w-10 text-primary mx-auto mb-4" />
            <h1 className="text-2xl font-bold mb-2">Check-In Link Not Available</h1>
            <p className="text-muted-foreground mb-6">
              {loadError || "We could not find your daily check-in link."}
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link to="/get-licensed">
                <GradientButton>Open Licensing Steps</GradientButton>
              </Link>
              <a href={helpLink} target="_blank" rel="noopener noreferrer">
                <GradientButton variant="outline">Book a Help Call</GradientButton>
              </a>
            </div>
          </GlassCard>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background py-8 px-4">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,hsl(var(--primary)/0.10)_0%,transparent_55%)]" />

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-3xl mx-auto relative z-10"
      >
        <GlassCard className="p-6 md:p-8">
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 mb-4">
              <Crown className="h-6 w-6 text-primary" />
              <span className="text-lg font-bold gradient-text">APEX Financial</span>
            </div>
            <h1 className="text-3xl font-bold mb-2">Daily Licensing Check-In</h1>
            <p className="text-muted-foreground max-w-xl mx-auto">
              {submitted
                ? `You are locked in, ${greetingName}. Your update is in.`
                : `Quick update for ${greetingName}. This keeps your manager aligned and helps us remove blockers fast.`}
            </p>
            {checkinDate && (
              <p className="text-xs text-muted-foreground mt-3">
                Check-in date: {checkinDate}
              </p>
            )}
          </div>

          {submitted ? (
            <div className="space-y-6">
              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-6 text-center">
                <CheckCircle2 className="h-10 w-10 text-emerald-400 mx-auto mb-3" />
                <h2 className="text-xl font-bold mb-2">Update Received</h2>
                <p className="text-muted-foreground">
                  Your progress is saved and your manager can see it now.
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <Link to="/get-licensed" className="block">
                  <GlassCard className="p-4 h-full text-center">
                    <h3 className="font-semibold mb-1">Open Licensing Steps</h3>
                    <p className="text-sm text-muted-foreground">Keep moving with the full step-by-step guide.</p>
                  </GlassCard>
                </Link>
                <a href={WHATSAPP_GROUP_URL} target="_blank" rel="noopener noreferrer" className="block">
                  <GlassCard className="p-4 h-full text-center">
                    <h3 className="font-semibold mb-1">Join the Hiring Chat</h3>
                    <p className="text-sm text-muted-foreground">Stay close to the team and ask questions fast.</p>
                  </GlassCard>
                </a>
                <a href={helpLink} target="_blank" rel="noopener noreferrer" className="block">
                  <GlassCard className="p-4 h-full text-center">
                    <h3 className="font-semibold mb-1">Need Help?</h3>
                    <p className="text-sm text-muted-foreground">Book a licensing help call if you feel stuck.</p>
                  </GlassCard>
                </a>
              </div>
            </div>
          ) : (
            <form className="space-y-6" onSubmit={handleSubmit}>
              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="licenseProgress">Where are you right now?</Label>
                  <select
                    id="licenseProgress"
                    value={form.licenseProgress}
                    onChange={(event) => setForm((current) => ({ ...current, licenseProgress: event.target.value }))}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    {LICENSE_STEPS.map((step) => (
                      <option key={step.value} value={step.value}>
                        {step.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="studyHours">How many hours did you study today?</Label>
                  <Input
                    id="studyHours"
                    inputMode="decimal"
                    placeholder="0"
                    value={form.studyHours}
                    onChange={(event) => setForm((current) => ({ ...current, studyHours: event.target.value }))}
                  />
                </div>
              </div>

              <div className="rounded-md border border-border/60 bg-muted/20 p-4 space-y-4">
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="needsHelp"
                    checked={form.needsHelp}
                    onCheckedChange={(checked) => setForm((current) => ({ ...current, needsHelp: Boolean(checked) }))}
                  />
                  <div className="space-y-1">
                    <Label htmlFor="needsHelp" className="cursor-pointer">I need help moving forward</Label>
                    <p className="text-sm text-muted-foreground">
                      Use this if you are stuck and want your manager to follow up.
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="blocker">What is the blocker?</Label>
                  <Textarea
                    id="blocker"
                    rows={3}
                    placeholder="What is blocking you right now?"
                    value={form.blocker}
                    onChange={(event) => setForm((current) => ({ ...current, blocker: event.target.value }))}
                  />
                </div>
              </div>

              <div className="rounded-md border border-border/60 bg-muted/20 p-4 space-y-4">
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="testScheduled"
                    checked={form.testScheduled}
                    onCheckedChange={(checked) => setForm((current) => ({ ...current, testScheduled: Boolean(checked) }))}
                  />
                  <div className="space-y-1">
                    <Label htmlFor="testScheduled" className="cursor-pointer">I already scheduled my exam</Label>
                    <p className="text-sm text-muted-foreground">
                      Add your test date so we can follow up at the right time.
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="testDate">Exam date</Label>
                  <Input
                    id="testDate"
                    type="date"
                    value={form.testDate}
                    onChange={(event) => setForm((current) => ({ ...current, testDate: event.target.value }))}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">Anything else we should know?</Label>
                <Textarea
                  id="notes"
                  rows={4}
                  value={form.notes}
                  onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                />
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <a href={WHATSAPP_GROUP_URL} target="_blank" rel="noopener noreferrer" className="block">
                  <GradientButton type="button" variant="outline" className="w-full">
                    <MessageCircle className="h-4 w-4 mr-2" />
                    Hiring Chat
                  </GradientButton>
                </a>
                <a href={helpLink} target="_blank" rel="noopener noreferrer" className="block">
                  <GradientButton type="button" variant="outline" className="w-full">
                    <CalendarDays className="h-4 w-4 mr-2" />
                    Book Help Call
                  </GradientButton>
                </a>
                <GradientButton type="submit" className="w-full" disabled={submitting}>
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Save My Check-In"
                  )}
                </GradientButton>
              </div>
            </form>
          )}
        </GlassCard>
      </motion.div>
    </div>
  );
}
