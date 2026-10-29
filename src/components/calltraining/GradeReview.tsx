// GradeReview: Sam, Aisha or the agent's upline says whether a grade is right (MP-310, 2026-10-29).
//
// Sam: "the grading process is pretty vague." A reviewer marks the grade right, too high or too low, with the score it
// should have been and why. grade_feedback_set() stores it in readymode_grade_feedback and refuses anyone who is not
// Sam, Aisha or the agent's upline. grade-calls.py reads the newest corrections into its prompt as calibration
// examples, and a reviewed call leaves that reviewer's daily review list.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { looseSupabase } from "@/lib/looseSupabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Verdict = "agree" | "too_high" | "too_low";
interface Feedback { id: string; verdict: string; corrected_score: number | null; note: string | null; graded_score: number | null; created_at: string }
const VERDICTS: ReadonlyArray<{ key: Verdict; label: string }> = [
  { key: "agree", label: "Grade is right" },
  { key: "too_high", label: "Too high" },
  { key: "too_low", label: "Too low" },
];
const words = (v: string) => VERDICTS.find((x) => x.key === v)?.label.toLowerCase() ?? v;

async function fetchFeedback(callId: string): Promise<Feedback[]> {
  const { data, error } = await looseSupabase
    .from<Feedback>("readymode_grade_feedback")
    .select("id, verdict, corrected_score, note, graded_score, created_at")
    .eq("call_id", callId)
    .order("created_at", { ascending: false })
    .limit(5);
  if (error) throw error;
  return data ?? [];
}

export function GradeReview({ callId }: { callId: string }) {
  const qc = useQueryClient();
  const fb = useQuery({ queryKey: ["grade-feedback", callId], queryFn: () => fetchFeedback(callId), staleTime: 60_000 });
  const [pick, setPick] = useState<Exclude<Verdict, "agree"> | null>(null);
  const [score, setScore] = useState("");
  const [note, setNote] = useState("");
  const save = useMutation({
    mutationFn: async (verdict: Verdict) => {
      const n = verdict === "agree" || score.trim() === "" ? null : Number(score);
      if (n != null && (!Number.isInteger(n) || n < 0 || n > 100)) throw new Error("A corrected score is a whole number from 0 to 100.");
      const { error } = await supabase.rpc("grade_feedback_set" as never, {
        p_call_id: callId, p_verdict: verdict, p_corrected_score: n, p_note: verdict === "agree" ? null : note.trim() || null,
      } as never);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Saved. The grader calibrates to it on its next run.");
      setPick(null);
      setScore("");
      setNote("");
      void qc.invalidateQueries({ queryKey: ["grade-feedback", callId] });
      void qc.invalidateQueries({ queryKey: ["call-review-queue"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const latest = fb.data?.[0];
  return (
    <div className="space-y-2 rounded-md border border-border/60 bg-background/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Is this grade right?</span>
        {VERDICTS.map((v) => (
          <Button
            key={v.key}
            type="button"
            size="sm"
            variant={pick === v.key ? "default" : "outline"}
            disabled={save.isPending}
            onClick={() => (v.key === "agree" ? save.mutate("agree") : setPick(pick === v.key ? null : v.key))}
          >
            {v.label}
          </Button>
        ))}
      </div>
      {pick && (
        <div className="flex flex-wrap items-center gap-2">
          <Input value={score} onChange={(e) => setScore(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))} inputMode="numeric" placeholder="Should be (0-100)" className="h-9 w-40" aria-label="Score it should have been" />
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why, in a line" className="h-9 min-w-[12rem] flex-1" aria-label="Why" maxLength={500} />
          <Button type="button" size="sm" disabled={save.isPending} onClick={() => save.mutate(pick)}>Save</Button>
        </div>
      )}
      {latest && (
        <p className="text-xs text-muted-foreground">
          Last review {new Date(latest.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}: {words(latest.verdict)}
          {latest.corrected_score != null ? `, should be ${latest.corrected_score}` : ""}
          {latest.graded_score != null ? ` (graded ${latest.graded_score})` : ""}
          {latest.note ? `. ${latest.note}` : ""}
        </p>
      )}
    </div>
  );
}
