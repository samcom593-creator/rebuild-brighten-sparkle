// useTrainingProgress: what this agent has already heard in the Training Center (MP-TRAINING-CENTER.2, 2026-11-23).
//
// Reuses hub_course_progress (unique on user, course, item; insert-own RLS) so no new table is needed and a leader can
// read it later: course "top-calls" holds the calls played, course "objections" the objection types heard.
import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export const TOP_CALLS_COURSE = "top-calls";
export const OBJECTIONS_COURSE = "objections";
/** The first calls a new agent hears; the path's step two is done when these are played. */
export const START_CALL_COUNT = 6;
/** Step three is done when this many objection types have been heard. */
export const OBJECTION_TYPES_GOAL = 3;

interface Row { course_id: string; item_id: string }

export function useTrainingProgress() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = useMemo(() => ["training-center-progress", user?.id], [user?.id]);
  const q = useQuery({
    queryKey: key,
    enabled: !!user?.id,
    staleTime: 60_000,
    queryFn: async (): Promise<Row[]> => {
      // Scoped to this user explicitly: the admin select policy is OR'ed with select-own on this table.
      const { data, error } = await supabase
        .from("hub_course_progress")
        .select("course_id, item_id")
        .eq("user_id", user!.id)
        .in("course_id", [TOP_CALLS_COURSE, OBJECTIONS_COURSE])
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });
  const heardCalls = useMemo(() => new Set((q.data ?? []).filter((r) => r.course_id === TOP_CALLS_COURSE).map((r) => r.item_id)), [q.data]);
  const heardObjections = useMemo(() => new Set((q.data ?? []).filter((r) => r.course_id === OBJECTIONS_COURSE).map((r) => r.item_id)), [q.data]);

  const mark = useCallback(
    async (course: string, item: string) => {
      if (!user?.id || !item) return;
      const have = (qc.getQueryData<Row[]>(key) ?? []).some((r) => r.course_id === course && r.item_id === item);
      if (have) return;
      qc.setQueryData<Row[]>(key, (prev) => [...(prev ?? []), { course_id: course, item_id: item }]);
      const { error } = await supabase
        .from("hub_course_progress")
        .upsert({ user_id: user.id, course_id: course, item_id: item, kind: "lesson", passed: true }, { onConflict: "user_id,course_id,item_id", ignoreDuplicates: true });
      // Progress is a convenience, never a gate: a failed write drops the optimistic tick and nothing else.
      if (error) void qc.invalidateQueries({ queryKey: key });
    },
    [qc, key, user?.id],
  );
  return { heardCalls, heardObjections, mark, isLoading: q.isLoading };
}
