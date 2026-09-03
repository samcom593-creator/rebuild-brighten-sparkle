import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Award,
  BookOpenCheck,
  Captions,
  CheckCircle2,
  Clock3,
  GraduationCap,
  Headphones,
  HelpCircle,
  Loader2,
  LockKeyhole,
  PlayCircle,
  Rocket,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { CourseQuiz } from "@/components/course/CourseQuiz";
import { CourseTranscript } from "@/components/course/CourseTranscript";
import { CourseVideoPlayer } from "@/components/course/CourseVideoPlayer";
import { TrainingWorkspaceNav } from "@/components/training/TrainingWorkspaceNav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { SkeletonLoader } from "@/components/ui/skeleton-loader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/useAuth";
import { useOnboardingCourse } from "@/hooks/useOnboardingCourse";
import { useSoundEffects } from "@/hooks/useSoundEffects";
import { supabase } from "@/integrations/supabase/client";
import { resolveBrand } from "@/config/brand";
import { TRAINING_ROUTES } from "@/lib/trainingRoutes";
import { cn } from "@/lib/utils";

type LessonTab = "video" | "transcript" | "quiz";

function formatDuration(seconds: number | null): string {
  if (!seconds) return "Self-paced";
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `${minutes} min`;
}

export default function CourseCatalog() {
  const brand = resolveBrand();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, isAdmin, isManager, isVaManager, isVa } = useAuth();
  const isStaff = isAdmin || isManager || isVaManager || isVa;
  const { playSound } = useSoundEffects();
  const [agentId, setAgentId] = useState<string | null>(null);
  const [agentNotFound, setAgentNotFound] = useState(false);
  const [autoProvisionAttempted, setAutoProvisionAttempted] = useState(false);
  const [provisioningInProgress, setProvisioningInProgress] = useState(false);
  const [activeTab, setActiveTab] = useState<LessonTab>("video");
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isLicensed, setIsLicensed] = useState(false);
  const [licenseCheckLoading, setLicenseCheckLoading] = useState(true);
  const resumeSelectedRef = useRef(false);
  const lessonRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const loadAgent = async () => {
      if (!user?.id) return;
      const { data } = await supabase
        .from("agents")
        .select("id, has_training_course")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1);
      if (cancelled) return;

      const agent = data?.[0];
      if (agent) {
        setAgentId(agent.id);
        if (!agent.has_training_course) {
          void supabase.from("agents").update({ has_training_course: true }).eq("id", agent.id);
        }
        return;
      }

      retryTimer = setTimeout(async () => {
        const { data: retryData } = await supabase
          .from("agents")
          .select("id")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(1);
        if (cancelled) return;
        if (retryData?.[0]) setAgentId(retryData[0].id);
        else setAgentNotFound(true);
      }, 2_000);
    };

    void loadAgent();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [user?.id]);

  useEffect(() => {
    let cancelled = false;
    const checkLicense = async () => {
      if (!user?.id) return;
      if (isStaff) {
        setIsLicensed(true);
        setLicenseCheckLoading(false);
        return;
      }

      setLicenseCheckLoading(true);
      try {
        const [agentRes, appRes] = await Promise.all([
          supabase
            .from("agents")
            .select("license_status")
            .eq("user_id", user.id)
            .order("created_at", { ascending: false })
            .limit(1),
          supabase
            .from("applications")
            .select("license_status, license_progress")
            .ilike("email", user.email || "__nope__")
            .order("created_at", { ascending: false })
            .limit(1),
        ]);
        const agentLicensed = agentRes.data?.[0]?.license_status === "licensed";
        const app = appRes.data?.[0] as { license_status?: string; license_progress?: string } | undefined;
        const appLicensed = app?.license_status === "licensed"
          || ["licensed", "fingerprints_done", "waiting_on_license"].includes(app?.license_progress || "");
        if (!cancelled) setIsLicensed(agentLicensed || appLicensed);
      } finally {
        if (!cancelled) setLicenseCheckLoading(false);
      }
    };

    void checkLicense();
    return () => { cancelled = true; };
  }, [isStaff, user?.email, user?.id]);

  useEffect(() => {
    if (!licenseCheckLoading && !isLicensed) navigate("/get-licensed", { replace: true });
  }, [isLicensed, licenseCheckLoading, navigate]);

  useEffect(() => {
    const autoProvision = async () => {
      if (!agentNotFound || autoProvisionAttempted || !user?.id) return;
      setAutoProvisionAttempted(true);
      setProvisioningInProgress(true);
      try {
        const { data, error } = await supabase.functions.invoke("self-enroll-course", { body: {} });
        if (!error && data?.agentId) {
          setAgentId(data.agentId);
          setAgentNotFound(false);
        }
      } catch (error) {
        console.error("Self-enroll error:", error);
      } finally {
        setProvisioningInProgress(false);
      }
    };
    void autoProvision();
  }, [agentNotFound, autoProvisionAttempted, user?.id]);

  const {
    modules,
    questions,
    progress,
    currentModuleIndex,
    setCurrentModuleIndex,
    loading,
    updateVideoProgress,
    submitQuiz,
    isModuleUnlocked,
    canTakeQuiz,
    getOverallProgress,
    isCourseComplete,
    currentModule,
    canReviewCourse,
    reviewMode,
    setReviewMode,
  } = useOnboardingCourse(agentId);

  useEffect(() => {
    if (resumeSelectedRef.current || modules.length === 0) return;
    const requestedModuleId = searchParams.get("module");
    const requestedIndex = requestedModuleId
      ? modules.findIndex((module) => module.id === requestedModuleId)
      : -1;
    // Ask the hook rather than restating its rule. This line used to carry its
    // own copy of "unlocked means the previous quiz is passed", so a deep link
    // to lesson 5 would still bounce back to the resume point for someone the
    // hook considers unlocked — the same rule in two places, disagreeing.
    const requestedUnlocked = requestedIndex >= 0 && isModuleUnlocked(requestedIndex);
    const firstIncomplete = modules.findIndex((module) => progress[module.id]?.passed !== true);
    const resumeIndex = firstIncomplete >= 0 ? firstIncomplete : modules.length - 1;
    setCurrentModuleIndex(requestedUnlocked ? requestedIndex : resumeIndex);
    resumeSelectedRef.current = true;
  }, [modules, progress, searchParams, setCurrentModuleIndex, isModuleUnlocked]);

  const completedCount = modules.filter((module) => progress[module.id]?.passed).length;
  const totalMinutes = useMemo(
    () => Math.round(modules.reduce((total, module) => total + (module.duration_seconds ?? 0), 0) / 60),
    [modules],
  );
  const currentQuestions = currentModule ? questions[currentModule.id] || [] : [];
  const currentProgress = currentModule ? progress[currentModule.id] : null;

  const selectModule = (index: number) => {
    if (!modules[index] || !isModuleUnlocked(index)) return;
    setCurrentModuleIndex(index);
    setSearchParams({ module: modules[index].id }, { replace: true });
    setActiveTab("video");
    playSound("click");
    window.requestAnimationFrame(() => {
      lessonRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const handleQuizSubmit = async (answers: number[], score: number, passed: boolean) => {
    if (!currentModule) return false;
    try {
      const success = await submitQuiz(currentModule.id, answers, score, passed);
      if (success && passed) playSound("celebrate");
      else if (success) playSound("error");
      return success;
    } catch (error) {
      console.error("Quiz submit failed:", error);
      return false;
    }
  };

  if (licenseCheckLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="space-y-2 text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Checking license status…</p>
        </div>
      </div>
    );
  }
  if (!isLicensed) return null;
  if (loading || provisioningInProgress) return <SkeletonLoader variant="page" />;

  if (modules.length === 0) {
    return (
      <div className="page-enter mx-auto w-full max-w-4xl space-y-6 px-4 pb-24 sm:px-6">
        <TrainingWorkspaceNav />
        <Card>
          <CardContent className="p-10 text-center">
            <BookOpenCheck className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
            <h1 className="text-2xl font-bold">Course lessons are unavailable</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Your progress has not been reset. Refresh in a few minutes or contact onboarding support.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const overallProgress = getOverallProgress();
  const courseComplete = isCourseComplete();

  return (
    <div className="page-enter mx-auto w-full max-w-7xl space-y-6 px-4 pb-28 sm:px-6">
      <TrainingWorkspaceNav />

      <Button asChild variant="ghost" size="sm" className="w-fit gap-1.5 px-0 text-muted-foreground hover:bg-transparent hover:text-foreground">
        <Link to={TRAINING_ROUTES.home}>
          <ArrowLeft className="h-4 w-4" />
          Back to training home
        </Link>
      </Button>

      <motion.section
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="overflow-hidden rounded-2xl border border-primary/25 bg-card"
      >
        <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <Badge className="mb-3 border-primary/30 bg-primary/10 text-primary hover:bg-primary/10">
              {reviewMode ? "Review mode" : "Required course"}
            </Badge>
            <h1 className="max-w-3xl text-3xl font-extrabold tracking-tight sm:text-4xl">
              Field-release training
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
              {reviewMode
                ? `Every lesson is open so you can read the whole course before you coach it. Nothing you do here is recorded — no progress, no watch time, no test attempts.`
                : `Follow one ordered path through ${brand.shortName} fundamentals, scripts, ReadyMode, pipeline, quoting, and field underwriting. Your next unfinished lesson opens automatically.`}
            </p>
            {/* MP-365: leaders land in review mode, and can leave it. A manager
                who is genuinely taking the course still can — the switch is the
                only thing standing between reading and being recorded, so it is
                stated rather than inferred. */}
            {canReviewCourse && (
              <Button
                variant="outline"
                size="sm"
                className="mt-4 gap-1.5"
                onClick={() => setReviewMode(!reviewMode)}
              >
                {reviewMode ? <GraduationCap className="h-3.5 w-3.5" /> : <BookOpenCheck className="h-3.5 w-3.5" />}
                {reviewMode ? "Take the course for credit" : "Back to review mode"}
              </Button>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2 lg:min-w-80">
            <CourseStat value={`${overallProgress}%`} label="complete" />
            <CourseStat value={`${completedCount}/${modules.length}`} label="lessons" />
            <CourseStat value={totalMinutes > 0 ? `${totalMinutes}m` : "—"} label="total" />
          </div>
        </div>
        <div className="border-t border-border bg-muted/20 px-5 py-4 sm:px-7">
          <div className="mb-2 flex items-center justify-between gap-3 text-xs">
            <span className="font-semibold">Your course progress</span>
            <span className="tabular-nums text-muted-foreground">{completedCount} of {modules.length} passed</span>
          </div>
          <Progress value={overallProgress} className="h-2" />
        </div>
      </motion.section>

      {courseComplete && (
        <div className="flex items-center gap-3 rounded-xl border border-success/30 bg-success/10 p-4 text-success">
          <Award className="h-6 w-6 shrink-0" />
          <div>
            <p className="font-bold">Course complete — you cleared every knowledge check.</p>
            <p className="text-sm opacity-80">Your launch roadmap will show the next receipt-backed milestone.</p>
          </div>
        </div>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[19rem_minmax(0,1fr)]">
        <aside className="order-2 space-y-3 lg:order-1 lg:sticky lg:top-4">
          <div className="flex items-center justify-between px-1">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Course map</p>
              <h2 className="font-bold">Your 2-phase path</h2>
            </div>
            <Rocket className="h-5 w-5 text-primary" />
          </div>
          <ol className="space-y-2">
            {modules.map((module, index) => {
              const moduleProgress = progress[module.id];
              const complete = moduleProgress?.passed === true;
              const unlocked = isModuleUnlocked(index);
              const current = index === currentModuleIndex;
              const phaseChanged = index === 0 || modules[index - 1]?.phase_key !== module.phase_key;
              return (
                <li key={module.id}>
                  {phaseChanged && (
                    <p className="mb-2 mt-4 px-1 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground first:mt-0">
                      {module.phase_key === "systems" ? "Phase 2 · Systems" : "Phase 1 · Foundation"}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => selectModule(index)}
                    disabled={!unlocked}
                    aria-current={current ? "step" : undefined}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors",
                      current && "border-primary bg-primary/5",
                      complete && !current && "border-success/30 bg-success/5",
                      unlocked && !current && !complete && "border-border bg-card hover:border-primary/40",
                      !unlocked && "cursor-not-allowed border-border/60 bg-muted/30 opacity-65",
                    )}
                  >
                    <span className={cn(
                      "grid h-8 w-8 shrink-0 place-items-center rounded-full border text-xs font-bold",
                      complete && "border-success bg-success text-success-foreground",
                      current && !complete && "border-primary bg-primary text-primary-foreground",
                      !current && !complete && "border-border bg-muted text-muted-foreground",
                    )}>
                      {complete ? <CheckCircle2 className="h-4 w-4" /> : unlocked ? index + 1 : <LockKeyhole className="h-3.5 w-3.5" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-sm font-bold leading-5">{module.title}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        <span>{formatDuration(module.duration_seconds)}</span>
                        {complete && <span className="font-semibold text-success">Passed {moduleProgress.score ?? 100}%</span>}
                        {!complete && (moduleProgress?.video_watched_percent ?? 0) > 0 && (
                          <span>{moduleProgress.video_watched_percent}% watched</span>
                        )}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </aside>

        <main ref={lessonRef} className="order-1 min-w-0 scroll-mt-4 lg:order-2">
          {currentModule && (
            <motion.div
              key={currentModule.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="overflow-hidden rounded-2xl border border-border bg-card"
            >
              <div className="border-b border-border p-4 sm:p-6">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline" className="border-primary/30 text-primary">
                    {currentModule.phase_key === "systems" ? "Systems" : "Foundation"}
                  </Badge>
                  <span>Lesson {currentModuleIndex + 1} of {modules.length}</span>
                  <span>·</span>
                  <span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" /> {formatDuration(currentModule.duration_seconds)}</span>
                  <span>·</span>
                  <span className="inline-flex items-center gap-1">
                    {currentModule.media_has_audio ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
                    {currentModule.media_has_audio ? "Source audio" : "Silent visual guide"}
                  </span>
                </div>
                <h2 className="mt-3 text-2xl font-extrabold sm:text-3xl">{currentModule.title}</h2>
                {currentModule.description && (
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{currentModule.description}</p>
                )}

                {currentModule.learning_objectives.length > 0 && (
                  <div className="mt-5 grid gap-2 sm:grid-cols-3">
                    {currentModule.learning_objectives.map((objective, index) => (
                      <div key={objective} className="flex gap-2 rounded-lg border border-border bg-muted/25 p-3 text-xs leading-5">
                        <span className="font-bold text-primary">{index + 1}</span>
                        <span>{objective}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <Tabs
                value={activeTab}
                onValueChange={(value) => {
                  setActiveTab(value as LessonTab);
                  playSound("click");
                }}
              >
                <div className="border-b border-border px-3 pt-3 sm:px-6">
                  <TabsList className="grid h-auto w-full grid-cols-3 bg-muted/60 p-1">
                    <TabsTrigger value="video" className="min-h-10 gap-1.5 px-2 text-xs sm:text-sm">
                      <PlayCircle className="h-4 w-4" /> Watch
                    </TabsTrigger>
                    <TabsTrigger value="transcript" className="min-h-10 gap-1.5 px-2 text-xs sm:text-sm">
                      <Captions className="h-4 w-4" /> <span className="hidden sm:inline">Read / </span>Listen
                    </TabsTrigger>
                    <TabsTrigger
                      value="quiz"
                      className="min-h-10 gap-1.5 px-2 text-xs sm:text-sm"
                      disabled={!canTakeQuiz(currentModule.id) && !currentProgress?.passed}
                    >
                      <HelpCircle className="h-4 w-4" /> Check
                    </TabsTrigger>
                  </TabsList>
                </div>

                <TabsContent value="video" className="m-0 p-3 sm:p-6">
                  <CourseVideoPlayer
                    videoUrl={currentModule.video_url}
                    videoParts={currentModule.video_parts}
                    posterUrl={currentModule.poster_url}
                    title={currentModule.title}
                    onProgressUpdate={(percent) => updateVideoProgress(currentModule.id, percent)}
                    watchedPercent={currentProgress?.video_watched_percent || 0}
                    onVideoComplete={() => undefined}
                    playbackRate={playbackRate}
                    onPlaybackRateChange={setPlaybackRate}
                  />
                  <div className="mt-4 flex flex-col gap-3 rounded-xl border border-border bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-2">
                      {canTakeQuiz(currentModule.id) || currentProgress?.passed ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                      ) : (
                        <Headphones className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      )}
                      <div>
                        <p className="text-sm font-semibold">
                          {currentProgress?.passed
                            ? `Passed with ${currentProgress.score ?? 100}%`
                            : canTakeQuiz(currentModule.id)
                              ? "Knowledge check unlocked"
                              : "Watch the lesson before taking the check"}
                        </p>
                        <p className="text-xs text-muted-foreground">Read or listen to the transcript whenever you need a second pass.</p>
                      </div>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setActiveTab("transcript")} className="gap-1.5">
                      <Captions className="h-4 w-4" /> Open transcript
                    </Button>
                  </div>
                </TabsContent>

                <TabsContent value="transcript" className="m-0 p-3 sm:p-6">
                  <CourseTranscript module={currentModule} />
                </TabsContent>

                <TabsContent value="quiz" className="m-0 p-3 sm:p-6">
                  {currentProgress?.passed ? (
                    <Card className="border-success/30 bg-success/5">
                      <CardContent className="p-8 text-center">
                        <Award className="mx-auto mb-4 h-14 w-14 text-success" />
                        <h3 className="text-xl font-bold">Lesson passed</h3>
                        <p className="mt-1 text-sm text-muted-foreground">Score: {currentProgress.score ?? 100}%</p>
                        {currentModuleIndex < modules.length - 1 && isModuleUnlocked(currentModuleIndex + 1) && (
                          <Button className="mt-5 gap-2" onClick={() => selectModule(currentModuleIndex + 1)}>
                            Continue to next lesson <ArrowRight className="h-4 w-4" />
                          </Button>
                        )}
                      </CardContent>
                    </Card>
                  ) : currentQuestions.length > 0 ? (
                    <CourseQuiz
                      questions={currentQuestions}
                      passThreshold={currentModule.pass_threshold}
                      attempts={currentProgress?.attempts || 0}
                      onSubmit={handleQuizSubmit}
                      onRetry={() => undefined}
                    />
                  ) : (
                    <Card>
                      <CardContent className="p-8 text-center">
                        <BookOpenCheck className="mx-auto mb-3 h-10 w-10 text-primary" />
                        <h3 className="font-bold">Confirm lesson completion</h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {reviewMode
                            ? "This lesson has no questions. Move on whenever you like — review mode records nothing."
                            : "This lesson has no questions. Finish the video to continue."}
                        </p>
                        {/* Hidden rather than disabled in review mode: the click
                            would succeed and store nothing, which reads as a
                            completion that never happened. */}
                        {!reviewMode && (
                          <Button
                            className="mt-5"
                            onClick={() => handleQuizSubmit([], 100, true)}
                            disabled={!canTakeQuiz(currentModule.id)}
                          >
                            {canTakeQuiz(currentModule.id) ? "Complete lesson" : "Watch 80% to unlock"}
                          </Button>
                        )}
                      </CardContent>
                    </Card>
                  )}
                </TabsContent>
              </Tabs>

              <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/20 p-3 sm:p-4">
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => selectModule(currentModuleIndex - 1)}
                  disabled={currentModuleIndex === 0}
                >
                  <ArrowLeft className="h-4 w-4" /> Previous
                </Button>
                <span className="hidden text-xs text-muted-foreground sm:block">
                  {reviewMode
                    ? "Every lesson is open. Nothing here is recorded."
                    : "Pass each check to unlock the next lesson."}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => selectModule(currentModuleIndex + 1)}
                  disabled={currentModuleIndex >= modules.length - 1 || !isModuleUnlocked(currentModuleIndex + 1)}
                >
                  Next <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </motion.div>
          )}
        </main>
      </div>
    </div>
  );
}

function CourseStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl border border-border bg-muted/30 px-3 py-3 text-center">
      <p className="text-xl font-extrabold tabular-nums text-primary sm:text-2xl">{value}</p>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
    </div>
  );
}
