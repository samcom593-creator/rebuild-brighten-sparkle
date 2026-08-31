/**
 * "What should I learn next?" — the first thing an agent sees on the dashboard.
 *
 * Sam: "Training should be one of the easiest things... As soon as they log in,
 * the first time, you should see it... it should not be hidden away in
 * resources."
 *
 * MEASURED why it was hidden: the module course has 248 progress rows across 92
 * agents, the Training Hub has 24 rows across 6 users, and nothing on the home
 * screen pointed at either. The material existed; the path to it did not.
 *
 * One RPC, not four client queries (agent row, modules, progress, licensing
 * stage). It takes no arguments and resolves the caller from auth.uid(), so an
 * agent cannot request someone else's training state.
 *
 * It branches on where the person actually is:
 *   unlicensed → the licensing ladder is their training
 *   licensed   → their next unpassed module
 *
 * The prelicensing branch shows a course percentage ONLY when XCEL genuinely
 * has one. applications.exam_scheduled_at and licensed_at are NULL on every
 * row, so a percentage derived from them would look precise and mean nothing.
 */

import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { GraduationCap, ArrowRight, CheckCircle2, Lightbulb } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { TRAINING_ROUTES, toCanonicalTrainingHref } from "@/lib/trainingRoutes";

interface NextStep {
  state: string;
  stage?: string;
  course_pct?: number | null;
  modules_total?: number;
  modules_passed?: number;
  next_label?: string;
  next_href?: string;
  next_module_title?: string;
  recommended_title?: string | null;
  recommended_reason?: string | null;
}

const STAGE_LADDER = [
  { key: "unlicensed", label: "Enrolled" },
  { key: "course_purchased", label: "Course" },
  { key: "finished_course", label: "Exam booked" },
  { key: "test_scheduled", label: "Exam" },
  { key: "passed_test", label: "Passed" },
  { key: "waiting_on_license", label: "Licensed" },
];

export function TrainingNextStep() {
  const { data, isLoading } = useQuery({
    queryKey: ["my-training-next-step"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("my_training_next_step" as never);
      if (error) throw error;
      return (data ?? {}) as unknown as NextStep;
    },
  });

  if (isLoading) return <div className="h-24 animate-pulse rounded-lg bg-muted/30" />;
  if (!data || data.state === "anonymous" || data.state === "no_agent_record") return null;

  const isPre = data.state === "prelicensing";
  const done = data.state === "course_complete";
  const total = data.modules_total ?? 0;
  const passed = data.modules_passed ?? 0;
  const pct = isPre
    ? (typeof data.course_pct === "number" ? data.course_pct : null)
    : total > 0 ? Math.round((passed / total) * 100) : null;

  const stageIdx = isPre
    ? Math.max(0, STAGE_LADDER.findIndex((s) => s.key === (data.stage ?? "unlicensed")))
    : -1;

  return (
    <Card className="border-primary/30 bg-primary/[0.03]">
      <CardContent className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              <GraduationCap className="h-3 w-3" />
              {isPre ? "Get licensed" : "Your training"}
            </p>

            {done ? (
              <p className="mt-1.5 flex items-center gap-2 text-lg font-bold">
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                Course complete
              </p>
            ) : (
              <p className="mt-1.5 truncate text-lg font-bold">{data.next_label}</p>
            )}

            {!isPre && total > 0 && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                {passed} of {total} modules passed
              </p>
            )}

            {isPre && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {STAGE_LADDER.map((s, i) => (
                  <span
                    key={s.key}
                    className={
                      "rounded px-1.5 py-0.5 text-[10px] " +
                      (i <= stageIdx
                        ? "bg-primary/15 text-primary font-medium"
                        : "bg-muted/40 text-muted-foreground")
                    }
                  >
                    {s.label}
                  </span>
                ))}
              </div>
            )}

            {pct !== null && (
              <div className="mt-2 max-w-xs">
                <Progress value={pct} className="h-1.5" />
                <p className="mt-1 text-[11px] text-muted-foreground">{pct}% complete</p>
              </div>
            )}

            {/* Recommended because of something real. The reason ships WITH the
                recommendation — a module suggested with no explanation is a
                guess, and the server only sets these together. */}
            {data.recommended_title && data.recommended_reason && (
              <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/[0.06] p-2.5">
                <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                <div className="min-w-0">
                  <p className="text-xs font-medium">Recommended: {data.recommended_title}</p>
                  <p className="text-[11px] text-muted-foreground">{data.recommended_reason}</p>
                </div>
              </div>
            )}
          </div>

          <Button asChild size="sm" className="shrink-0 gap-1.5">
            <Link to={done ? TRAINING_ROUTES.home : toCanonicalTrainingHref(data.next_href ?? TRAINING_ROUTES.home)}>
              {done ? "Training library" : "Continue"}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
