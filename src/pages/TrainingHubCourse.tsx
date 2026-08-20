import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Award,
  CheckCircle2,
  ChevronLeft,
  ListChecks,
  Play,
  Printer,
  RefreshCw,
} from "lucide-react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { CourseQuiz } from "@/components/course/CourseQuiz";
import { OnboardingQuestion } from "@/hooks/useOnboardingCourse";
import { cn } from "@/lib/utils";
import {
  HUB_EMBED_SANDBOX,
  HubCourseItem,
  hubCourseItems,
  toHubEmbedUrl,
  useHubData,
} from "@/lib/apexResourcesHub";
import { toast } from "sonner";

/**
 * TrainingHubCourse — course player for the live apex-resources courses
 * (Onboarding / Release / Vet Training). Lessons embed Drive/YouTube video;
 * quizzes reuse the existing CourseQuiz component; per-user progress persists
 * to hub_course_progress (upgrade over the legacy site's localStorage keyed
 * by whatever email the agent typed at enroll).
 */

interface ProgressRow {
  item_id: string;
  kind: string;
  score: number | null;
  passed: boolean | null;
  completed_at: string;
}

export default function TrainingHubCourse() {
  const { courseId } = useParams<{ courseId: string }>();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useHubData();

  const resource = useMemo(
    () => (data?.resources ?? []).find((r) => r.id === courseId && r.course),
    [data, courseId],
  );
  usePageTitle(
    resource ? `${resource.title} · APEX Financial` : "Course · APEX Financial",
  );

  const items = useMemo(
    () => (resource?.course ? hubCourseItems(resource.course) : []),
    [resource],
  );

  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const activeItem = items.find((it) => it.id === activeItemId) ?? null;
  const activeIndex = activeItem ? items.findIndex((it) => it.id === activeItem.id) : -1;

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [activeItemId]);

  const { data: progressRows } = useQuery({
    queryKey: ["hub-course-progress-detail", courseId, user?.id],
    queryFn: async () => {
      // Scope to this user explicitly — the admin SELECT policy is OR'ed with
      // select_own, so an unfiltered read would compute an admin's progress
      // from every other agent's completions.
      const { data: rows, error } = await supabase
        .from("hub_course_progress")
        .select("item_id, kind, score, passed, completed_at")
        .eq("course_id", courseId!)
        .eq("user_id", user!.id);
      if (error) throw error;
      return (rows ?? []) as ProgressRow[];
    },
    enabled: !!user?.id && !!courseId,
  });

  const doneIds = useMemo(
    () =>
      new Set(
        (progressRows ?? [])
          .filter((p) => p.kind === "lesson" || p.passed)
          .map((p) => p.item_id),
      ),
    [progressRows],
  );
  // Intersect with the live item list. Content is edited in the apex-resources
  // admin portal, so a replaced/removed lesson leaves an orphan progress row —
  // counting raw row count would award a certificate (and print >100%) for
  // content the agent never opened.
  const doneCount = items.filter((it) => doneIds.has(it.id)).length;
  const pct = items.length ? Math.round((doneCount / items.length) * 100) : 0;
  const allDone = items.length > 0 && doneCount === items.length;

  const markItem = useMutation({
    mutationFn: async (payload: {
      item: HubCourseItem;
      score?: number;
      passed?: boolean;
    }) => {
      if (!user?.id || !courseId) throw new Error("Not signed in");
      // Keep-best, never downgrade. A passed quiz is a completion receipt: an
      // agent re-opening it to review the questions and scoring low on a
      // practice run must not revoke their own certificate.
      const { data: prev } = await supabase
        .from("hub_course_progress")
        .select("score, passed, completed_at")
        .eq("user_id", user.id)
        .eq("course_id", courseId)
        .eq("item_id", payload.item.id)
        .maybeSingle();

      const isQuiz = payload.item.kind === "quiz";
      const { error } = await supabase.from("hub_course_progress").upsert(
        {
          user_id: user.id,
          course_id: courseId,
          item_id: payload.item.id,
          kind: payload.item.kind,
          score: isQuiz ? Math.max(prev?.score ?? 0, payload.score ?? 0) : null,
          passed: isQuiz ? Boolean(prev?.passed || payload.passed) : null,
          // Preserve the original completion date once earned.
          completed_at: prev?.completed_at ?? new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,course_id,item_id" },
      );
      if (error) throw error;
    },
    onError: () => {
      toast.error("Progress didn't save", {
        description: "Check your connection and try again — this wasn't recorded.",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hub-course-progress-detail", courseId] });
      queryClient.invalidateQueries({ queryKey: ["hub-course-progress"] });
    },
  });

  if (isLoading) {
    return (
      <div className="page-enter mx-auto w-full max-w-4xl space-y-4 px-4 pb-24 sm:px-6">
        <Skeleton className="h-10 w-48 rounded-md" />
        <Skeleton className="h-56 rounded-md" />
        <Skeleton className="h-40 rounded-md" />
      </div>
    );
  }

  if (isError || !resource?.course) {
    return (
      <div className="page-enter mx-auto w-full max-w-4xl px-4 pb-24 sm:px-6">
        <GlassCard className="mt-8 p-8 text-center">
          <p className="mb-1 text-lg font-bold">
            {isError ? "Couldn't reach the content library" : "Course not found"}
          </p>
          <p className="mb-4 text-sm text-muted-foreground">
            {isError
              ? "The live library didn't respond. Retry, or come back in a minute."
              : "This course may have been unpublished from the content library."}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {isError && (
              <Button onClick={() => refetch()} className="gap-2">
                <RefreshCw className="h-4 w-4" />
                Retry
              </Button>
            )}
            <Button asChild variant="outline" className="gap-2">
              <Link to="/dashboard/recruiting/training/library?tab=courses">
                <ArrowLeft className="h-4 w-4" />
                Back to Training Hub
              </Link>
            </Button>
          </div>
        </GlassCard>
      </div>
    );
  }

  const course = resource.course;

  /* ── Item player view ── */
  if (activeItem) {
    const prev = activeIndex > 0 ? items[activeIndex - 1] : null;
    const next = activeIndex < items.length - 1 ? items[activeIndex + 1] : null;
    const isDone = doneIds.has(activeItem.id);
    // Fails closed on any non-Drive/non-YouTube URL.
    const lessonEmbed = activeItem.link ? toHubEmbedUrl(activeItem.link) : null;

    return (
      <div className="page-enter mx-auto w-full max-w-4xl space-y-4 px-4 pb-24 sm:px-6">
        <div className="flex items-center justify-between pt-2">
          <button
            type="button"
            onClick={() => setActiveItemId(null)}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
            {resource.title}
          </button>
          <span className="text-xs tabular-nums text-muted-foreground">
            {activeIndex + 1} / {items.length}
          </span>
        </div>

        <h1 className="text-2xl font-extrabold leading-tight sm:text-3xl">
          {activeItem.title}
        </h1>

        {activeItem.kind === "lesson" ? (
          <>
            {lessonEmbed ? (
              <div className="aspect-video w-full overflow-hidden rounded-md border border-border bg-black">
                <iframe
                  src={lessonEmbed}
                  title={activeItem.title}
                  className="h-full w-full"
                  sandbox={HUB_EMBED_SANDBOX}
                  allow="autoplay; encrypted-media; picture-in-picture"
                  allowFullScreen
                />
              </div>
            ) : (
              <GlassCard className="p-6 text-center text-sm text-muted-foreground">
                {activeItem.link
                  ? "This lesson's video link isn't a Google Drive or YouTube URL, so it can't be played here."
                  : "Video coming soon for this lesson."}
              </GlassCard>
            )}
            {activeItem.blurb && (
              <p className="text-sm leading-relaxed text-muted-foreground">
                {activeItem.blurb}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              {isDone ? (
                <span className="inline-flex items-center gap-2 text-sm font-bold text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" />
                  Lesson complete
                </span>
              ) : (
                <Button
                  onClick={() => markItem.mutate({ item: activeItem })}
                  disabled={markItem.isPending}
                  className="gap-2"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Mark lesson complete
                </Button>
              )}
            </div>
          </>
        ) : (
          <HubQuiz
            key={activeItem.id}
            item={activeItem}
            onResult={(score, passed) =>
              markItem.mutateAsync({ item: activeItem, score, passed })
            }
          />
        )}

        <div className="flex items-center justify-between border-t border-border/60 pt-4">
          {prev ? (
            <button
              type="button"
              onClick={() => setActiveItemId(prev.id)}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="max-w-44 truncate">{prev.title}</span>
            </button>
          ) : (
            <span />
          )}
          {next && (
            <button
              type="button"
              onClick={() => setActiveItemId(next.id)}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-amber-400 transition-colors hover:text-amber-300"
            >
              <span className="max-w-44 truncate">{next.title}</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    );
  }

  /* ── Course landing view ── */
  const firstIncomplete = items.find((it) => !doneIds.has(it.id));

  return (
    <div className="page-enter mx-auto w-full max-w-4xl space-y-5 px-4 pb-24 sm:px-6">
      <div className="pt-2">
        <Link
          to="/dashboard/recruiting/training/library?tab=courses"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Training Hub
        </Link>
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className="border-purple-500/30 bg-purple-500/15 text-purple-400"
          >
            {course.level}
          </Badge>
          {resource.isNew && (
            <Badge className="bg-amber-500 text-black hover:bg-amber-500">New</Badge>
          )}
        </div>
        <h1 className="text-3xl font-extrabold leading-tight sm:text-4xl">
          {resource.title}
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {course.instructor} · {course.instructorRole}
          {resource.duration ? ` · ${resource.duration}` : ""}
        </p>
        {resource.long && (
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {resource.long}
          </p>
        )}
      </div>

      <div className="flex items-center gap-4">
        <Progress value={pct} className="h-2 flex-1" />
        <span className="text-sm font-semibold tabular-nums text-muted-foreground">
          {pct}% complete
        </span>
      </div>

      {allDone ? (
        <Certificate courseTitle={resource.title} instructor={course.instructor} />
      ) : (
        firstIncomplete && (
          <Button onClick={() => setActiveItemId(firstIncomplete.id)} className="gap-2">
            <Play className="h-4 w-4" />
            {doneIds.size === 0 ? "Start course" : "Continue"}
          </Button>
        )
      )}

      {course.learn.length > 0 && (
        <GlassCard className="p-5">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted-foreground">
            What you'll learn
          </h2>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {course.learn.map((l) => (
              <li key={l} className="flex items-start gap-2 text-sm">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <span>{l}</span>
              </li>
            ))}
          </ul>
        </GlassCard>
      )}

      <div className="space-y-4">
        {course.modules.map((mod) => (
          <div key={mod.title}>
            {course.modules.length > 1 && (
              <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">
                {mod.title}
              </h3>
            )}
            <div className="space-y-2">
              {mod.items.map((it) => {
                const globalIdx = items.findIndex((x) => x.id === it.id);
                const done = doneIds.has(it.id);
                return (
                  <button
                    key={it.id}
                    type="button"
                    onClick={() => setActiveItemId(it.id)}
                    className={cn(
                      "flex w-full items-center gap-4 rounded-md border bg-card p-4 text-left transition-colors hover:border-amber-500/50 hover:bg-muted/30",
                      done ? "border-emerald-500/40" : "border-border",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-bold",
                        done
                          ? "border-emerald-500 bg-emerald-500 text-white"
                          : "border-border bg-muted/40 text-muted-foreground",
                      )}
                    >
                      {done ? <CheckCircle2 className="h-4 w-4" /> : globalIdx + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{it.title}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {it.kind === "quiz"
                          ? `Quiz · ${it.questions?.length ?? 0} questions · pass ${Math.round((it.pass ?? 0.8) * 100)}%`
                          : `Lesson${it.duration ? ` · ${it.duration}` : ""}`}
                      </span>
                    </span>
                    {it.kind === "quiz" ? (
                      <ListChecks className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <Play className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Quiz adapter — maps hub quiz shape onto the existing CourseQuiz ── */

function HubQuiz({
  item,
  onResult,
}: {
  item: HubCourseItem;
  onResult: (score: number, passed: boolean) => Promise<unknown>;
}) {
  const [attempts, setAttempts] = useState(0);
  const questions: OnboardingQuestion[] = useMemo(
    () =>
      (item.questions ?? []).map((q, idx) => ({
        id: `${item.id}-${idx}`,
        module_id: item.id,
        question: q.q,
        options: q.options,
        correct_answer: q.answer,
        explanation: null,
        order_index: idx,
      })),
    [item],
  );

  if (questions.length === 0) {
    return (
      <GlassCard className="p-6 text-center text-sm text-muted-foreground">
        This quiz has no questions yet.
      </GlassCard>
    );
  }

  return (
    <CourseQuiz
      questions={questions}
      passThreshold={Math.round((item.pass ?? 0.8) * 100)}
      attempts={attempts}
      onSubmit={async (_answers, score, passed) => {
        // CourseQuiz paints the pass screen before awaiting this, so a
        // rejected write would otherwise read as a saved completion — the
        // same fake-success class as the 465 InsuraCloud sync rows. Swallow
        // the rejection here (markItem's onError raises the toast) so it
        // can't surface as an unhandled rejection.
        try {
          await onResult(score, passed);
          return true;
        } catch {
          return false;
        }
      }}
      onRetry={() => setAttempts((a) => a + 1)}
    />
  );
}

/* ── Certificate ── */

function Certificate({
  courseTitle,
  instructor,
}: {
  courseTitle: string;
  instructor: string;
}) {
  const { user } = useAuth();

  const { data: agentName } = useQuery({
    queryKey: ["hub-cert-name", user?.id],
    queryFn: async () => {
      const { data: rows } = await supabase
        .from("agents")
        .select("display_name")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(1);
      return rows?.[0]?.display_name ?? null;
    },
    enabled: !!user?.id,
  });

  const displayName = agentName ?? user?.email ?? "APEX Agent";

  return (
    <GlassCard
      id="hub-certificate"
      className="border-2 border-amber-500/60 p-8 text-center print:border-amber-500"
    >
      <Award className="mx-auto mb-3 h-10 w-10 text-amber-400" />
      <p className="text-xs font-bold uppercase tracking-widest text-amber-400">
        Certificate of Completion
      </p>
      <p className="mt-3 text-2xl font-extrabold">{displayName}</p>
      <p className="mt-1 text-sm text-muted-foreground">has completed</p>
      <p className="mt-1 text-xl font-bold">{courseTitle}</p>
      <p className="mt-2 text-xs text-muted-foreground">
        Instructor: {instructor} · APEX Financial Empire
      </p>
      <Button
        variant="outline"
        size="sm"
        onClick={() => window.print()}
        className="mt-4 gap-2 print:hidden"
      >
        <Printer className="h-4 w-4" />
        Print certificate
      </Button>
    </GlassCard>
  );
}
