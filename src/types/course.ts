/**
 * Shared types for the onboarding course system.
 * Centralizes Module and Question interfaces used across:
 * - CourseContent.tsx
 * - OnboardingCourse.tsx
 * - CourseQuiz.tsx
 * - useOnboardingCourse.ts
 */

export interface CourseModule {
  id: string;
  title: string;
  description: string | null;
  video_url: string;
  order_index: number;
  pass_threshold: number | null;
  is_active?: boolean | null;
  created_at?: string | null;
}

export interface CourseQuestion {
  id: string;
  module_id: string;
  question: string;
  options: string[];
  correct_answer: number;
  explanation: string | null;
  order_index: number | null;
}

export interface CourseProgress {
  id: string;
  agent_id: string;
  module_id: string;
  video_watched_percent: number;
  started_at: string | null;
  completed_at: string | null;
  score: number | null;
  attempts: number;
  answers: number[] | null;
  passed: boolean;
}
