import { useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

/**
 * Applicant self-report buttons for the public status page.
 *
 * Sam-feedback 2026-06-03: XCEL Gmail pull last matched 2026-05-20. If the
 * automated puller silently fails, applicants are invisible. This panel
 * lets the applicant stamp their own progress as a fallback so they don't
 * disappear from the funnel.
 *
 * Each button calls applicant-self-report edge fn (RLS-bypassing, validates
 * by application_id only — no auth required, same pattern as /status).
 */

interface Props {
  applicationId: string;
  currentStage: string | null;
  licenseStatus: "licensed" | "unlicensed" | "pending" | null;
}

type Milestone = "started_course" | "finished_course" | "scheduled_exam" | "passed_exam" | "licensed" | "stuck";

const MILESTONES: { key: Milestone; label: string; help: string; disabledIfStageIn?: string[] }[] = [
  { key: "started_course", label: "I started the course", help: "Logged into XCEL and began studying.", disabledIfStageIn: ["started_prelicense", "finished_prelicense", "passed_exam"] },
  { key: "finished_course", label: "I finished the course", help: "Completed all required modules.", disabledIfStageIn: ["finished_prelicense", "passed_exam"] },
  { key: "scheduled_exam", label: "I scheduled my exam", help: "State exam booked at PSI/Pearson.", disabledIfStageIn: ["passed_exam"] },
  { key: "passed_exam", label: "I passed my exam", help: "Exam complete with passing score.", disabledIfStageIn: ["passed_exam"] },
  { key: "licensed", label: "I am licensed", help: "License number in hand from the state." },
  { key: "stuck", label: "I am stuck — get me help", help: "Senior agent will DM you within 1 hour." },
];

export function ApplicantSelfReport({ applicationId, currentStage, licenseStatus }: Props) {
  const [busy, setBusy] = useState<Milestone | null>(null);

  // Don't show for licensed applicants who don't need to report course progress
  if (licenseStatus === "licensed") return null;

  async function fire(m: Milestone) {
    setBusy(m);
    try {
      const { error } = await supabase.functions.invoke("applicant-self-report", {
        body: { application_id: applicationId, milestone: m },
      });
      if (error) throw error;
      const labels: Record<Milestone, string> = {
        started_course: "Marked: course started",
        finished_course: "Marked: course finished",
        scheduled_exam: "Marked: exam scheduled",
        passed_exam: "Marked: exam passed",
        licensed: "Marked: licensed",
        stuck: "Manager will reach out within 1 hour",
      };
      toast.success(labels[m]);
      // Refresh after a short beat so the page picks up new stage
      setTimeout(() => window.location.reload(), 1200);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message ?? "Could not record. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="border-amber-600/30 bg-amber-600/5">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm uppercase tracking-wider text-amber-300">
          Update your progress
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          If you have moved forward but the system has not caught up, mark it here. Manager gets notified instantly.
        </p>
      </CardHeader>
      <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {MILESTONES.map((m) => {
          const isCompleted = currentStage && m.disabledIfStageIn?.includes(currentStage);
          return (
            <Button
              key={m.key}
              variant={m.key === "stuck" ? "default" : "outline"}
              size="sm"
              disabled={busy !== null || isCompleted}
              onClick={() => fire(m.key)}
              className="justify-start h-auto py-2.5 text-left"
            >
              {busy === m.key ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin shrink-0" />
              ) : isCompleted ? (
                <CheckCircle2 className="h-4 w-4 mr-2 text-emerald-400 shrink-0" />
              ) : null}
              <div className="min-w-0">
                <div className="text-sm font-medium">{m.label}</div>
                <div className="text-[10px] text-muted-foreground">{m.help}</div>
              </div>
            </Button>
          );
        })}
      </CardContent>
    </Card>
  );
}
