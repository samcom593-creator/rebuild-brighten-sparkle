import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, ArrowRight, CheckCircle2, Lock, RefreshCw, Trophy } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * TrainingPathPanel — the ordered APEX module path with the agent's own
 * persisted completion, mirroring the AgentCloud "Your Setup Progress"
 * stepper: one numbered row per step, a check on the done ones, and exactly
 * one highlighted "do this next".
 *
 * TRUTH: onboarding_modules (is_active, ordered by order_index) x
 * onboarding_progress scoped to THIS agent. Completion is not derived from a
 * local flag — it is the `passed` column the sales-course writes on quiz
 * submit, so it survives reload, logout and device change.
 *
 * SCOPING IS LOAD-BEARING. onboarding_progress RLS OR's an admin policy onto
 * the select-own policy, so an unfiltered select hands an admin every agent's
 * rows and would compute Sam's own path out of other people's completions
 * (verified as Sam: an unscoped select returned two rows for one module id).
 * Always .eq("agent_id", …).
 *
 * SEQUENCING mirrors useOnboardingCourse.isModuleUnlocked exactly — step N is
 * open only once step N-1 is passed. The hub and the player must not disagree
 * about which module an agent may open.
 */

const COURSE_HREF = "/dashboard/recruiting/training/sales-course";

interface ModuleRow {
  id: string;
  order_index: number;
  title: string;
  description: string | null;
  pass_threshold: number | null;
}

interface ProgressRow {
  module_id: string;
  passed: boolean | null;
  video_watched_percent: number | null;
  score: number | null;
  completed_at: string | null;
  started_at: string | null;
}

type StepState = "done" | "current" | "locked";

function EmptyCard({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-8 pt-8 text-center">
        <p className="text-lg font-bold">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{body}</p>
        {action && <div className="mt-4 flex justify-center">{action}</div>}
      </CardContent>
    </Card>
  );
}

export function TrainingPathPanel() {
  const { user } = useAuth();

  // The caller's agent row. .limit(1) rather than .maybeSingle(): agents is
  // not unique on user_id, and PostgREST returns data=null on a multi-row
  // match — which would read as "this person has no agent record" for the one
  // population most likely to have a duplicate.
  const agentQ = useQuery({
    queryKey: ["training-path-agent", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agents")
        .select("id, display_name")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      return (data?.[0] as { id: string; display_name: string | null } | undefined) ?? null;
    },
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
  });

  const agentId = agentQ.data?.id ?? null;

  const modulesQ = useQuery({
    queryKey: ["training-path-modules"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("onboarding_modules")
        .select("id, order_index, title, description, pass_threshold")
        .eq("is_active", true)
        .order("order_index");
      if (error) throw error;
      return (data ?? []) as ModuleRow[];
    },
    staleTime: 5 * 60 * 1000,
  });

  const progressQ = useQuery({
    queryKey: ["training-path-progress", agentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("onboarding_progress")
        .select("module_id, passed, video_watched_percent, score, completed_at, started_at")
        .eq("agent_id", agentId!);
      if (error) throw error;
      return (data ?? []) as ProgressRow[];
    },
    enabled: !!agentId,
    staleTime: 60 * 1000,
  });

  const byModule = useMemo(() => {
    const m: Record<string, ProgressRow> = {};
    for (const row of progressQ.data ?? []) m[row.module_id] = row;
    return m;
  }, [progressQ.data]);

  const modules = modulesQ.data ?? [];
  const passedCount = modules.filter((mod) => byModule[mod.id]?.passed === true).length;
  const total = modules.length;
  const pct = total > 0 ? Math.round((passedCount / total) * 100) : 0;
  // "You are here" = the first module not yet passed. Everything after it is
  // locked, which is the same rule the player enforces.
  const currentIndex = modules.findIndex((mod) => byModule[mod.id]?.passed !== true);
  const complete = total > 0 && currentIndex === -1;

  const loading = agentQ.isLoading || modulesQ.isLoading || (!!agentId && progressQ.isLoading);
  const failed = agentQ.isError || modulesQ.isError || progressQ.isError;

  if (loading) {
    return (
      <section className="space-y-3">
        <Skeleton className="h-16 rounded-md" />
        <Skeleton className="h-20 rounded-md" />
        <Skeleton className="h-20 rounded-md" />
      </section>
    );
  }

  // A failed read is NOT "0 modules complete". Say so, and offer the retry.
  if (failed) {
    return (
      <EmptyCard
        title="Couldn't load your training path"
        body="Your progress is safe — this is a connection problem, not a reset. Retry to load it."
        action={
          <Button
            className="gap-2"
            onClick={() => {
              void agentQ.refetch();
              void modulesQ.refetch();
              void progressQ.refetch();
            }}
          >
            <RefreshCw className="h-4 w-4" />
            Retry
          </Button>
        }
      />
    );
  }

  if (!agentQ.data) {
    return (
      <EmptyCard
        title="No agent record on file yet"
        body="Training progress is tracked against an agent record. Yours hasn't been created — finish onboarding and it will appear here."
        action={
          <Button asChild variant="outline" className="gap-2">
            <Link to="/dashboard/profile">
              Open your profile
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        }
      />
    );
  }

  if (total === 0) {
    return (
      <EmptyCard
        title="No training modules are active yet"
        body="Modules published to the course will appear here in order, with your completion against each one."
      />
    );
  }

  return (
    <section aria-labelledby="training-path-heading" className="space-y-3">
      {/* Header strip — title left, "N of M complete (P%)" right, bar under. */}
      <div className="rounded-md border border-border bg-card p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="training-path-heading" className="text-lg font-bold">
            Your training path
          </h2>
          <span className="text-sm text-muted-foreground tabular-nums">
            {passedCount} of {total} module{total === 1 ? "" : "s"} complete ({pct}%)
          </span>
        </div>
        <div
          className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Training path completion"
        >
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {complete && (
        <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/10 px-4 py-3 text-sm font-semibold text-success">
          <Trophy className="h-4 w-4 shrink-0" />
          Every active module is passed. You're cleared for field training.
        </div>
      )}

      <ol className="space-y-3">
        {modules.map((mod, idx) => {
          const prog = byModule[mod.id];
          const done = prog?.passed === true;
          const state: StepState = done ? "done" : idx === currentIndex ? "current" : "locked";
          const watched = prog?.video_watched_percent ?? 0;
          const started = !!prog?.started_at || watched > 0;

          return (
            <li key={mod.id}>
              <div
                className={cn(
                  "flex flex-col gap-3 rounded-md border p-4 transition-colors sm:flex-row sm:items-center",
                  state === "done" && "border-success/40 bg-success/5",
                  state === "current" && "border-primary bg-primary/5",
                  state === "locked" && "border-border bg-card",
                )}
              >
                <span
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-bold",
                    state === "done" && "border-success bg-success text-success-foreground",
                    state === "current" && "border-primary bg-primary text-primary-foreground",
                    state === "locked" && "border-border bg-muted text-muted-foreground",
                  )}
                  aria-hidden="true"
                >
                  {done ? <CheckCircle2 className="h-5 w-5" /> : idx + 1}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-bold sm:text-base">
                      Step {idx + 1}: {mod.title}
                    </p>
                    {state === "current" && (
                      <Badge className="border-primary bg-primary text-primary-foreground hover:bg-primary">
                        You are here
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {mod.description?.trim()
                      ? mod.description
                      : state === "locked"
                        ? `Opens once step ${idx} is passed.`
                        : "Watch the lesson, then pass the quiz to clear this step."}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                    {done
                      ? prog?.score != null
                        ? `Passed · scored ${prog.score}%`
                        : "Passed"
                      : state === "current"
                        ? started
                          ? `In progress · ${watched}% of the lesson watched`
                          : "Not started"
                        : "Locked"}
                    {mod.pass_threshold != null && !done ? ` · pass mark ${mod.pass_threshold}%` : ""}
                  </p>
                </div>

                <div className="shrink-0 sm:pl-2">
                  {state === "locked" ? (
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-semibold text-muted-foreground">
                      <Lock className="h-3.5 w-3.5" />
                      Locked
                    </span>
                  ) : (
                    <Button
                      asChild
                      variant={state === "done" ? "outline" : "default"}
                      size="sm"
                      className="w-full gap-1.5 sm:w-auto"
                    >
                      <Link to={COURSE_HREF}>
                        {state === "done" ? "Review it" : started ? "Continue" : "Start it"}
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </Button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {!complete && currentIndex >= 0 && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          Do this next: step {currentIndex + 1} — {modules[currentIndex].title}.
        </p>
      )}
    </section>
  );
}

export default TrainingPathPanel;
