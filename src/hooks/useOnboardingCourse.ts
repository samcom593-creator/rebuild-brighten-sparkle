import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export interface OnboardingModule {
  id: string;
  order_index: number;
  title: string;
  description: string | null;
  video_url: string;
  pass_threshold: number;
  is_active: boolean;
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

    setModules(data || []);
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
    if (!agentId) return;

    const existing = progress[moduleId];
    
    if (existing) {
      if (percent > existing.video_watched_percent) {
        await supabase
          .from("onboarding_progress")
          .update({ video_watched_percent: percent })
          .eq("id", existing.id);
        
        setProgress(prev => ({
          ...prev,
          [moduleId]: { ...prev[moduleId], video_watched_percent: percent }
        }));
      }
    } else {
      // This is the first progress entry - agent is starting the course!
      const { data, error } = await supabase
        .from("onboarding_progress")
        .insert({
          agent_id: agentId,
          module_id: moduleId,
          video_watched_percent: percent
        })
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
            console.log("Course started notification sent for agent:", agentId);
          } catch (notifyError) {
            console.error("Failed to send course started notification:", notifyError);
          }
        }
      }
    }
  }, [agentId, progress]);

  const submitQuiz = useCallback(async (
    moduleId: string, 
    answers: number[], 
    score: number, 
    passed: boolean
  ) => {
    if (!agentId) return false;

    const existing = progress[moduleId];
    const attempts = (existing?.attempts || 0) + 1;

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
      const { error } = await supabase
        .from("onboarding_progress")
        .insert({
          agent_id: agentId,
          module_id: moduleId,
          video_watched_percent: 100,
          ...updateData
        });

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
  }, [agentId, progress, modules, toast, fetchProgress]);

  const isModuleUnlocked = useCallback((moduleIndex: number) => {
    if (moduleIndex === 0) return true;
    const prevModule = modules[moduleIndex - 1];
    if (!prevModule) return false;
    return progress[prevModule.id]?.passed === true;
  }, [modules, progress]);

  const canTakeQuiz = useCallback((moduleId: string) => {
    const prog = progress[moduleId];
    if (!prog) return false;
    // Primary: 90% watched
    if (prog.video_watched_percent >= 90) return true;
    // Safety net: if progress record exists for 5+ minutes, allow quiz
    if (prog.started_at) {
      const elapsed = Date.now() - new Date(prog.started_at).getTime();
      if (elapsed > 5 * 60 * 1000) return true;
    }
    return false;
  }, [progress]);

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

  useEffect(() => {
    const current = modules[currentModuleIndex];
    if (current) {
      fetchQuestions(current.id);
    }
  }, [currentModuleIndex, modules, fetchQuestions]);

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
    getOverallProgress,
    isCourseComplete,
    currentModule: modules[currentModuleIndex] || null
  };
}
