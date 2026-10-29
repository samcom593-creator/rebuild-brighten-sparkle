// ReviewQueueCard: the calls to hear today, picked for the reviewer (MP-310, 2026-10-29).
//
// Sam: "make it easier to review calls and data without having to sit there going through hours of call log myself."
// call_review_queue() gives Sam and Aisha the agency and an upline their own team: compliance flags first, then urgent
// and high coaching, then off script, then the lowest scores, from the last 30 days. Marking a grade right, too high
// or too low takes the call off that reviewer's list and the next one moves up.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Headphones } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { looseSupabase } from "@/lib/looseSupabase";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { CallAudioPlayer } from "@/components/calls/CallAudioPlayer";
import { GradeBreakdown } from "@/components/calltraining/GradeBreakdown";
import { momentsFrom } from "@/lib/callAudio";
import { dispositionLabel } from "@/lib/readymodeDispositions";
import { cn } from "@/lib/utils";

interface QueueRow {
  call_id: string;
  agent_name: string | null;
  call_started_at: string | null;
  disposition: string | null;
  overall_score: number | null;
  script_score: number | null;
  coaching_priority: string | null;
  reason: string;
}
interface Detail {
  call_id: string;
  summary: string | null;
  coaching_notes: string | null;
  scores: Record<string, number> | null;
  score_reasons: Record<string, { reason?: string; t?: string; quote?: string }> | null;
  script_score: number | null;
  script_followed: string | null;
  script_steps: Array<{ step?: string; status?: string; t?: string; note?: string }> | null;
  key_quotes: unknown;
  objection_moments: Array<{ t: string; objection: string }> | null;
  compliance_flags: string[] | null;
}

async function fetchQueue(): Promise<QueueRow[]> {
  const { data, error } = await supabase.rpc("call_review_queue" as never, { p_limit: 5 } as never);
  if (error) throw new Error(error.message);
  return (Array.isArray(data) ? data : []) as QueueRow[];
}
async function fetchDetail(callId: string): Promise<Detail | null> {
  const { data, error } = await looseSupabase
    .from<Detail>("v_call_training")
    .select("call_id, summary, coaching_notes, scores, score_reasons, script_score, script_followed, script_steps, key_quotes, objection_moments, compliance_flags")
    .eq("call_id", callId)
    .limit(1);
  if (error) throw error;
  return data?.[0] ?? null;
}
const shortDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");
const tone = (n: number | null) =>
  n == null ? "text-muted-foreground" : n >= 80 ? "text-emerald-700 dark:text-emerald-300" : n >= 60 ? "text-amber-700 dark:text-amber-300" : "text-rose-700 dark:text-rose-300";

function QueueDetail({ callId }: { callId: string }) {
  const q = useQuery({ queryKey: ["call-review-detail", callId], queryFn: () => fetchDetail(callId), staleTime: 5 * 60_000 });
  if (q.isLoading) return <p className="text-muted-foreground">Loading the call…</p>;
  if (q.isError) return <p className="text-rose-700 dark:text-rose-300">This call did not load: {(q.error as Error).message}</p>;
  const d = q.data;
  if (!d) return <p className="text-muted-foreground">This call is no longer graded.</p>;
  return (
    <div className="space-y-3">
      <CallAudioPlayer callId={callId} moments={[...(d.objection_moments ?? []).map((m) => ({ t: m.t, label: m.objection })), ...momentsFrom(d.key_quotes)]} />
      {d.summary && <p>{d.summary}</p>}
      {(d.compliance_flags ?? []).length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-rose-700 dark:text-rose-300">{(d.compliance_flags ?? []).map((s) => <li key={s}>{s}</li>)}</ul>
      )}
      <GradeBreakdown callId={callId} scores={d.scores} reasons={d.score_reasons} scriptScore={d.script_score} scriptFollowed={d.script_followed} steps={d.script_steps} canReview />
      {d.coaching_notes && <p className="text-muted-foreground"><span className="font-semibold text-foreground">Coaching note:</span> {d.coaching_notes}</p>}
    </div>
  );
}

export function ReviewQueueCard() {
  const q = useQuery({ queryKey: ["call-review-queue"], queryFn: fetchQueue, staleTime: 60_000 });
  const [openId, setOpenId] = useState<string | null>(null);
  const list = q.data ?? [];
  return (
    <GlassCard className="p-0">
      <div className="px-4 py-3">
        <p className="inline-flex items-center gap-2 text-sm font-semibold"><Headphones className="h-4 w-4 text-primary" /> Today's calls to review</p>
        <p className="text-xs text-muted-foreground">Picked for you from the last 30 days: compliance flags first, then urgent coaching, off script, and the lowest scores. Tell the grader if it got the grade right and the next call moves up.</p>
      </div>
      <div className="border-t border-border/60 text-sm">
        {q.isLoading ? (
          <p className="px-4 py-3 text-muted-foreground">Loading…</p>
        ) : q.isError ? (
          <p className="px-4 py-3 text-rose-700 dark:text-rose-300">The review list did not load: {(q.error as Error).message}</p>
        ) : list.length === 0 ? (
          <p className="px-4 py-3 text-muted-foreground">Nothing to review. Every graded call you can see from the last 30 days has your review.</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {list.map((r) => {
              const open = openId === r.call_id;
              return (
                <li key={r.call_id}>
                  <button type="button" onClick={() => setOpenId(open ? null : r.call_id)} aria-expanded={open} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left">
                    <span className={cn("w-10 text-lg font-bold tabular-nums", tone(r.overall_score))}>{r.overall_score ?? "—"}</span>
                    <Badge variant="outline" className={cn("font-normal", r.reason === "Compliance flag" && "border-rose-500/40 text-rose-700 dark:text-rose-300")}>{r.reason}</Badge>
                    <span className="font-medium">{r.agent_name ?? "Unknown agent"}</span>
                    <span className="text-muted-foreground">{shortDate(r.call_started_at)} · {dispositionLabel(r.disposition)}{r.script_score != null ? ` · on script ${r.script_score}/10` : ""}</span>
                    <ChevronDown className={cn("ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
                  </button>
                  {open && <div className="px-4 pb-3"><QueueDetail callId={r.call_id} /></div>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </GlassCard>
  );
}
