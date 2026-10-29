// MyCallsPanel: an agent's own graded calls and coaching (MP-310, 2026-10-29).
//
// Each agent hears their own calls (the muted copy) with the grade, the reasons and the script checklist, and reads the
// coaching written about them. RLS does the scoping: rmca_self_read and readymode_agent_coaching_self_read return only
// the signed-in agent's rows, and call_audio_for() serves only the muted copy of their own calls.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Mic } from "lucide-react";
import { looseSupabase } from "@/lib/looseSupabase";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { CallAudioPlayer } from "@/components/calls/CallAudioPlayer";
import { GradeBreakdown } from "@/components/calltraining/GradeBreakdown";
import { AgentCoachingCard } from "@/components/calltraining/AgentCoachingCard";
import { momentsFrom } from "@/lib/callAudio";
import { dispositionLabel } from "@/lib/readymodeDispositions";
import { cn } from "@/lib/utils";

interface MyCall {
  call_id: string;
  call_started_at: string | null;
  disposition: string | null;
  stage_reached: string | null;
  overall_score: number | null;
  great_call: boolean;
  summary: string | null;
  coaching_notes: string | null;
  improvements: string[] | null;
  scores: Record<string, number> | null;
  score_reasons: Record<string, { reason?: string; t?: string; quote?: string }> | null;
  script_score: number | null;
  script_followed: string | null;
  script_steps: Array<{ step?: string; status?: string; t?: string; note?: string }> | null;
  key_quotes: unknown;
  objection_moments: Array<{ t: string; objection: string }> | null;
}

async function fetchMine(): Promise<MyCall[]> {
  const { data, error } = await looseSupabase
    .from<MyCall>("v_call_training")
    .select("call_id, call_started_at, disposition, stage_reached, overall_score, great_call, summary, coaching_notes, improvements, scores, score_reasons, script_score, script_followed, script_steps, key_quotes, objection_moments")
    .order("call_started_at", { ascending: false })
    .limit(40);
  if (error) throw error;
  return (data ?? []).filter((c) => c.stage_reached !== "voicemail" && c.stage_reached !== "no_contact");
}
async function fetchMyCoachingName(): Promise<string | null> {
  const { data, error } = await looseSupabase.from<{ agent_name: string }>("readymode_agent_coaching").select("agent_name").limit(1);
  if (error) throw error;
  return data?.[0]?.agent_name ?? null;
}
const shortDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");
const tone = (n: number | null) =>
  n == null ? "text-muted-foreground" : n >= 80 ? "text-emerald-700 dark:text-emerald-300" : n >= 60 ? "text-amber-700 dark:text-amber-300" : "text-rose-700 dark:text-rose-300";

export function MyCallsPanel() {
  const calls = useQuery({ queryKey: ["my-graded-calls"], queryFn: fetchMine, staleTime: 5 * 60_000 });
  const coach = useQuery({ queryKey: ["my-coaching-name"], queryFn: fetchMyCoachingName, staleTime: 10 * 60_000 });
  const [openId, setOpenId] = useState<string | null>(null);
  const list = calls.data ?? [];
  // Nothing graded about this agent yet: the team library below still teaches.
  if (list.length === 0 && !coach.data) return null;
  const avg = list.length ? Math.round(list.reduce((a, c) => a + (c.overall_score ?? 0), 0) / list.length) : null;
  return (
    <div className="space-y-3">
      {coach.data && <AgentCoachingCard agentName={coach.data} title="Your coaching" />}
      {list.length > 0 && (
        <GlassCard className="p-0">
          <div className="px-4 py-3">
            <p className="inline-flex items-center gap-2 text-sm font-semibold"><Mic className="h-4 w-4 text-primary" /> Your graded calls</p>
            <p className="text-xs text-muted-foreground">
              {list.length} recent call{list.length === 1 ? "" : "s"}{avg != null ? ` · average ${avg}/100` : ""}. Tap one to hear it and see why it got its grade.
            </p>
          </div>
          <ul className="divide-y divide-border/60 border-t border-border/60 text-sm">
            {list.map((c) => {
              const open = openId === c.call_id;
              return (
                <li key={c.call_id}>
                  <button type="button" onClick={() => setOpenId(open ? null : c.call_id)} aria-expanded={open} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left">
                    <span className={cn("w-10 text-lg font-bold tabular-nums", tone(c.overall_score))}>{c.overall_score ?? "—"}</span>
                    {c.great_call && <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-300">Great call</Badge>}
                    {c.script_score != null && <Badge variant="outline" className="font-normal">On script {c.script_score}/10</Badge>}
                    <span className="text-muted-foreground">{shortDate(c.call_started_at)} · {dispositionLabel(c.disposition)}</span>
                    <ChevronDown className={cn("ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
                    {c.summary && <span className="w-full text-muted-foreground">{c.summary}</span>}
                  </button>
                  {open && (
                    <div className="space-y-3 px-4 pb-3">
                      <CallAudioPlayer callId={c.call_id} moments={[...(c.objection_moments ?? []).map((m) => ({ t: m.t, label: m.objection })), ...momentsFrom(c.key_quotes)]} />
                      <GradeBreakdown callId={c.call_id} scores={c.scores} reasons={c.score_reasons} scriptScore={c.script_score} scriptFollowed={c.script_followed} steps={c.script_steps} />
                      {(c.improvements ?? []).length > 0 && (
                        <div>
                          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Would have made it better</p>
                          <ul className="list-disc space-y-0.5 pl-5">{(c.improvements ?? []).map((s) => <li key={s}>{s}</li>)}</ul>
                        </div>
                      )}
                      {c.coaching_notes && <p><span className="font-semibold">Coaching note:</span> {c.coaching_notes}</p>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </GlassCard>
      )}
    </div>
  );
}
