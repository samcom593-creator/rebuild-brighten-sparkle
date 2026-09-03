import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

/**
 * Total tries per module test: the first attempt plus 3 retakes.
 *
 * Mirrors public.course_max_attempts(), which is what actually enforces this —
 * the quiz submits straight through PostgREST and the correct answers are
 * already in the browser, so a client-side limit alone would be advisory. Keep
 * the two in step; migration 20260824140000_quiz_retake_cap.sql explains why the
 * number lives in one place.
 */
export const MAX_QUIZ_ATTEMPTS = 4;

export interface TranscriptSegment {
  time: string;
  text: string;
}

export interface OnboardingVideoPart {
  title: string;
  url: string;
  duration_seconds: number;
}

export interface OnboardingModule {
  id: string;
  order_index: number;
  title: string;
  description: string | null;
  video_url: string;
  poster_url: string | null;
  video_parts: OnboardingVideoPart[];
  pass_threshold: number;
  is_active: boolean;
  phase_key: "foundation" | "systems" | null;
  duration_seconds: number | null;
  learning_objectives: string[];
  transcript_segments: TranscriptSegment[];
  transcript_kind: "verbatim" | "edited-transcript" | "visual-notes" | "lesson-notes";
  media_has_audio: boolean;
}

export interface OnboardingQuestion {
  id: string;
  module_id: string;
  question: string;
  options: string[];
  correct_answer: number;
  explanation: string | null;
  order_index: number;
}

export interface OnboardingProgress {
  id: string;
  agent_id: string;
  module_id: string;
  video_watched_percent: number;
  started_at: string;
  completed_at: string | null;
  score: number | null;
  attempts: number;
  answers: number[] | null;
  passed: boolean;
}

export function useOnboardingCourse(agentId: string | null) {
  const [modules, setModules] = useState<OnboardingModule[]>([]);
  const [questions, setQuestions] = useState<Record<string, OnboardingQuestion[]>>({});
  const [progress, setProgress] = useState<Record<string, OnboardingProgress>>({});
  const [currentModuleIndex, setCurrentModuleIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  /**
   * MP-365 — review mode.
   *
   * Sam: "For managers, for MILVER and VA — isn't for me, of course — unlock all
   * training courses... to properly see what the courses entail."
   *
   * Every lesson but the first was gated on passing the previous quiz, and that
   * gate applied to leaders too. Measured on prod: of the 8 managers, John Riley
   * had passed 0 quizzes so could open lesson 1 of 6, Chudi / Jacob / Obiajulu
   * had passed 1 so could open 2, and KJ — furthest along — could open 5. Not
   * one of them could look at the whole course they are supposed to coach
   * against. Milver and April have no agent record at all, so the viewer loaded
   * with no progress and locked them at lesson 1.
   *
   * Review mode unlocks every lesson AND stops the viewer writing: browsing does
   * not create a progress row, does not advance a watch percentage, and does not
   * record a quiz. Without that, a leader clicking through six lessons to read
   * them would appear on the very team-progress report they just opened, as a
   * half-finished learner going stale. It is a toggle, not a permanent state,
   * because managers do genuinely take this course — KJ has 4 of 6 passed — and
   * silently taking that away would be a regression nobody asked for.
   *
   * The rule lives here rather than in the page so a second course viewer cannot
   * re-implement it slightly differently.
   */
  const { isAdmin, isManager, isVaManager, isVa } = useAuth();
  const canReviewCourse = isAdmin || isManager || isVaManager || isVa;
  const [reviewOverride, setReviewOverride] = useState<boolean | null>(null);
  // Roles arrive after the first render, so the default has to be derived, not
  // captured in state — otherwise review mode is decided before anyone knows
  // who is asking. An explicit choice always wins over the default.
  const reviewMode = canReviewCourse && (reviewOverride ?? true);

  const fetchModules = useCallback(async () => {
    const { data, error } = await supabase
      .from("onboarding_modules")
      .select("*")
      .eq("is_active", true)
      .order("order_index");

    if (error) {
      console.error("Error fetching modules:", error);
      return;
    }

    setModules((data || []).map((module) => ({
      ...module,
      pass_threshold: module.pass_threshold ?? 80,
      is_active: module.is_active ?? true,
      phase_key: module.phase_key === "foundation" || module.phase_key === "systems"
        ? module.phase_key
        : null,
      learning_objectives: Array.isArray(module.learning_objectives)
        ? module.learning_objectives.filter((item): item is string => typeof item === "string")
        : [],
      video_parts: Array.isArray(module.video_parts)
        ? module.video_parts.flatMap((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return [];
          const part = item as { title?: unknown; url?: unknown; duration_seconds?: unknown };
          return typeof part.title === "string"
            && typeof part.url === "string"
            && typeof part.duration_seconds === "number"
            && part.duration_seconds > 0
            ? [{ title: part.title, url: part.url, duration_seconds: part.duration_seconds }]
            : [];
        })
        : [],
      transcript_segments: Array.isArray(module.transcript_segments)
        ? module.transcript_segments.flatMap((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return [];
          const segment = item as { time?: unknown; text?: unknown };
          return typeof segment.text === "string"
            ? [{ time: typeof segment.time === "string" ? segment.time : "", text: segment.text }]
            : [];
        })
        : [],
      transcript_kind: ["verbatim", "edited-transcript", "visual-notes", "lesson-notes"].includes(module.transcript_kind)
        ? module.transcript_kind as OnboardingModule["transcript_kind"]
        : "lesson-notes",
      media_has_audio: module.media_has_audio ?? true,
    })));
  }, []);

  const fetchQuestions = useCallback(async (moduleId: string) => {
    if (questions[moduleId]) return;

    const { data, error } = await supabase
      .from("onboarding_questions")
      .select("*")
      .eq("module_id", moduleId)
      .order("order_index");

    if (error) {
      console.error("Error fetching questions:", error);
      return;
    }

    setQuestions(prev => ({
      ...prev,
      [moduleId]: (data || []).map(q => ({
        ...q,
        options: Array.isArray(q.options) ? q.options : JSON.parse(q.options as string)
      }))
    }));
  }, [questions]);

  const fetchProgress = useCallback(async () => {
    if (!agentId) return;

    const { data, error } = await supabase
      .from("onboarding_progress")
      .select("*")
      .eq("agent_id", agentId);

    if (error) {
      console.error("Error fetching progress:", error);
      return;
    }

    const progressMap: Record<string, OnboardingProgress> = {};
    (data || []).forEach(p => {
      progressMap[p.module_id] = {
        ...p,
        answers: p.answers as number[] | null
      };
    });
    setProgress(progressMap);
  }, [agentId]);

  const updateVideoProgress = useCallback(async (moduleId: string, percent: number) => {
    if (!agentId || reviewMode) return;

    const existing = progress[moduleId];
    
    if (existing) {
      if (percent > existing.video_watched_percent) {
        const { error } = await supabase
          .from("onboarding_progress")
          .update({ video_watched_percent: percent })
          .eq("id", existing.id);

        if (error) {
          console.error("Error saving video progress:", error);
          return;
        }

        setProgress(prev => ({
          ...prev,
          [moduleId]: { ...prev[moduleId], video_watched_percent: percent }
        }));
      }
    } else {
      // This is the first progress entry - agent is starting the course!
      // upsert (not insert) so a race with initializeProgress/another tab can't
      // 409 on the (agent_id, module_id) unique key and silently drop progress.
      const { data, error } = await supabase
        .from("onboarding_progress")
        .upsert({
          agent_id: agentId,
          module_id: moduleId,
          video_watched_percent: percent
        }, { onConflict: "agent_id,module_id" })
        .select()
        .single();

      if (!error && data) {
        setProgress(prev => ({
          ...prev,
          [moduleId]: {
            ...data,
            answers: data.answers as number[] | null
          }
        }));

        // Check if this is the first progress entry ever for this agent
        // (meaning they just started the course)
        const existingProgressCount = Object.keys(progress).length;
        if (existingProgressCount === 0) {
          // Notify admin that agent started the course
          try {
            await supabase.functions.invoke("notify-course-started", {
              body: { agentId }
            });
            if (import.meta.env.DEV) console.log("Course started notification sent for agent:", agentId);
          } catch (notifyError) {
            console.error("Failed to send course started notification:", notifyError);
          }
        }
      }
    }
  }, [agentId, progress, reviewMode]);

  const submitQuiz = useCallback(async (
    moduleId: string,
    answers: number[],
    score: number,
    passed: boolean
  ) => {
    // In review mode the answers are graded in the browser and nothing is
    // written: no attempt is spent, no score is recorded, and the
    // notify-course-complete side effect below cannot fire from a leader
    // reading through the last lesson.
    if (reviewMode) return true;
    if (!agentId) return false;

    const existing = progress[moduleId];
    const attempts = (existing?.attempts || 0) + 1;

    // The database trigger is the real cap (trg_onboarding_attempt_cap); this
    // is here so an exhausted agent gets a sentence instead of a raw Postgres
    // error, not because the client is trusted to enforce it.
    if (!existing?.passed && attempts > MAX_QUIZ_ATTEMPTS) {
      toast({
        title: "No attempts left",
        description: `This test allows ${MAX_QUIZ_ATTEMPTS} tries. Ask your manager to reset it.`,
        variant: "destructive",
      });
      return false;
    }

    const updateData = {
      score,
      answers,
      passed,
      attempts,
      completed_at: passed ? new Date().toISOString() : null
    };

    if (existing) {
      const { error } = await supabase
        .from("onboarding_progress")
        .update(updateData)
        .eq("id", existing.id);

      if (error) {
        toast({ title: "Error saving quiz results", variant: "destructive" });
        return false;
      }
    } else {
      // upsert (not insert) — a race on the (agent_id, module_id) unique key
      // otherwise 409s and shows the agent a false "Error saving quiz results".
      const { error } = await supabase
        .from("onboarding_progress")
        .upsert({
          agent_id: agentId,
          module_id: moduleId,
          video_watched_percent: 100,
          ...updateData
        }, { onConflict: "agent_id,module_id" });

      if (error) {
        toast({ title: "Error saving quiz results", variant: "destructive" });
        return false;
      }
    }

    await fetchProgress();

    // Check if this completes the entire course (all modules passed)
    if (passed) {
      const allModulesPassed = modules.every(m => 
        m.id === moduleId ? true : progress[m.id]?.passed === true
      );
      
      if (allModulesPassed) {
        // Trigger course completion notification and CRM stage update
        try {
          await supabase.functions.invoke("notify-course-complete", {
            body: { agentId }
          });
          toast({ title: "🎓 Course Complete!", description: "Congratulations! Moving to field training." });
        } catch (error) {
          console.error("Failed to trigger course completion:", error);
        }
      }
    }

    return true;
  }, [agentId, progress, modules, toast, fetchProgress, reviewMode]);

  const isModuleUnlocked = useCallback((moduleIndex: number) => {
    if (reviewMode) return true;
    if (moduleIndex === 0) return true;
    const prevModule = modules[moduleIndex - 1];
    if (!prevModule) return false;
    return progress[prevModule.id]?.passed === true;
  }, [modules, progress, reviewMode]);

  /** Tries left on this module. 0 means the agent needs a manager reset. */
  const attemptsRemaining = useCallback((moduleId: string) => {
    const prog = progress[moduleId];
    if (prog?.passed) return 0;
    return Math.max(0, MAX_QUIZ_ATTEMPTS - (prog?.attempts ?? 0));
  }, [progress]);

  const canTakeQuiz = useCallback((moduleId: string) => {
    // The knowledge check is part of "what the course entails", and review mode
    // writes no progress row for the 80%-watched test to read, so gating on one
    // would hide every test from the people who came to look at them.
    if (reviewMode) return true;
    const prog = progress[moduleId];
    if (!prog) return false;
    // Primary: 80% watched
    if (prog.video_watched_percent >= 80) return true;
    // Safety net: if progress record exists for 5+ minutes, allow quiz
    if (prog.started_at) {
      const elapsed = Date.now() - new Date(prog.started_at).getTime();
      if (elapsed > 5 * 60 * 1000) return true;
    }
    return false;
  }, [progress, reviewMode]);

  const getOverallProgress = useCallback(() => {
    if (modules.length === 0) return 0;
    const completed = modules.filter(m => progress[m.id]?.passed).length;
    return Math.round((completed / modules.length) * 100);
  }, [modules, progress]);

  const isCourseComplete = useCallback(() => {
    return modules.length > 0 && modules.every(m => progress[m.id]?.passed);
  }, [modules, progress]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await fetchModules();
      await fetchProgress();
      setLoading(false);
    };
    init();
  }, [fetchModules, fetchProgress]);

  // Auto-initialize progress record when viewing a module (ensures started_at is set)
  const initializeProgress = useCallback(async (moduleId: string) => {
    if (!agentId || reviewMode || progress[moduleId]) return;
    
    // upsert with ignoreDuplicates so re-viewing a module never 409s on the
    // (agent_id, module_id) unique key — if a row already exists, leave it be
    // (don't reset video_watched_percent to 0).
    // Plain array select (not .single/.maybeSingle) so a skipped duplicate
    // returns an empty 200 array — .single would send an object-accept header
    // that 406s on the 0 rows a DO-NOTHING upsert returns.
    const { data, error } = await supabase
      .from("onboarding_progress")
      .upsert({
        agent_id: agentId,
        module_id: moduleId,
        video_watched_percent: 0
      }, { onConflict: "agent_id,module_id", ignoreDuplicates: true })
      .select();

    const row = data?.[0];
    if (!error && row) {
      setProgress(prev => ({
        ...prev,
        [moduleId]: {
          ...row,
          answers: row.answers as number[] | null
        }
      }));

      // Notify if this is the first module they're viewing
      if (Object.keys(progress).length === 0) {
        try {
          await supabase.functions.invoke("notify-course-started", {
            body: { agentId }
          });
        } catch (e) {
          console.error("Failed to send course started notification:", e);
        }
      }
    }
  }, [agentId, progress, reviewMode]);

  useEffect(() => {
    const current = modules[currentModuleIndex];
    if (current) {
      fetchQuestions(current.id);
      initializeProgress(current.id);
    }
  }, [currentModuleIndex, modules, fetchQuestions, initializeProgress]);

  return {
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
    attemptsRemaining,
    /** True for admin / manager / va_manager / va — the roles offered review mode. */
    canReviewCourse,
    reviewMode,
    setReviewMode: setReviewOverride,
    getOverallProgress,
    isCourseComplete,
    currentModule: modules[currentModuleIndex] || null
  };
}
