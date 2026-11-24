// TopCallsTab: the team's best dialer calls inside the Training Center (MP-TRAINING-CENTER, 2026-11-23).
//
// Sam: one training spot, built on the top calls, with nothing in it that could be used to flip the book. Every
// row here comes from call_training_library(), which serves the team copy only: names, places, emails, banks,
// birth dates and numbers are removed from the text and muted in the audio, and a call without a clean team copy
// is not returned at all. Ordered by teaching value (grade, objections turned, on script, short enough to finish).
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, GraduationCap, ShieldCheck, Star } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { CallAudioPlayer } from "@/components/calls/CallAudioPlayer";
import { GradeBreakdown } from "@/components/calltraining/GradeBreakdown";
import { MyCallsPanel } from "@/components/calltraining/MyCallsPanel";
import { momentsFrom } from "@/lib/callAudio";
import { dispositionLabel } from "@/lib/readymodeDispositions";
import { cn } from "@/lib/utils";
import { START_CALL_COUNT, TOP_CALLS_COURSE, useTrainingProgress } from "@/components/training/useTrainingProgress";

interface Turn { t: string; objection: string; response: string; technique: string; worked: boolean }
interface LibraryRow {
  call_id: string;
  call_started_at: string | null;
  agent_name: string | null;
  disposition: string | null;
  duration_seconds: number | null;
  overall_score: number | null;
  great_call: boolean | null;
  training_tags: string[] | null;
  tactics: string[] | null;
  strengths: string[] | null;
  objection_moments: unknown;
  key_quotes: unknown;
  summary: string | null;
  scores: Record<string, number> | null;
  score_reasons: Record<string, { reason?: string; t?: string; quote?: string }> | null;
  script_score: number | null;
  script_followed: string | null;
  script_steps: Array<{ step?: string; status?: string; t?: string; note?: string }> | null;
}
type ViewKey = "start" | "short" | "all";
// Three views, not five: every extra filter was a decision a new agent had to make before hearing anything.
const VIEWS: Array<{ key: ViewKey; label: string }> = [
  { key: "start", label: "Start with these" },
  { key: "short", label: "Under 15 minutes" },
  { key: "all", label: "Every call" },
];
/** "Start with these" is deliberately short: the first calls a new agent should hear. */
const START_COUNT = START_CALL_COUNT;

const turns = (v: unknown): Turn[] =>
  Array.isArray(v) ? v.filter((m): m is Turn => !!m && typeof m === "object" && typeof (m as Turn).objection === "string" && typeof (m as Turn).t === "string") : [];
const minutes = (s: number | null) => (s == null ? "" : `${Math.max(1, Math.round(s / 60))} min`);
const tagLabel = (t: string) => t.replace(/-/g, " ");

async function fetchLibrary(): Promise<LibraryRow[]> {
  const { data, error } = await supabase.rpc("call_training_library" as never);
  if (error) throw new Error((error as { message?: string }).message ?? "The training calls did not load.");
  return (Array.isArray(data) ? data : []) as LibraryRow[];
}

export function TopCallsTab() {
  const q = useQuery({ queryKey: ["call-training-library"], queryFn: fetchLibrary, staleTime: 5 * 60_000 });
  const [view, setView] = useState<ViewKey>("start");
  const [openId, setOpenId] = useState<string | null>(null);
  const { heardCalls, mark } = useTrainingProgress();
  const all = useMemo(() => q.data ?? [], [q.data]);
  const rows = useMemo(() => {
    if (view === "start") return all.slice(0, START_COUNT);
    if (view === "short") return all.filter((r) => (r.duration_seconds ?? Infinity) <= 15 * 60);
    return all;
  }, [all, view]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {VIEWS.map((v) => (
          <Button key={v.key} size="sm" variant={view === v.key ? "default" : "outline"} aria-pressed={view === v.key} onClick={() => setView(v.key)}>
            {v.label}
          </Button>
        ))}
      </div>
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
        Real calls from the team. Client names, addresses, numbers and bank details are removed from the audio and the notes.
      </p>

      {q.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 4 }, (_, n) => <Skeleton key={`top-sk-${n}`} className="h-24 w-full" />)}</div>
      ) : q.isError ? (
        <EmptyState icon={<GraduationCap className="h-6 w-6" />} title="The training calls did not load" description={(q.error as Error).message} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<GraduationCap className="h-6 w-6" />}
          title={all.length === 0 ? "No training calls yet" : "No call matches this view"}
          description={all.length === 0 ? "Calls appear here once they are graded and cleared for the team." : "Try another view."}
        />
      ) : (
        <div className="space-y-2">
          {rows.map((r, idx) => {
            const open = openId === r.call_id;
            const ts = turns(r.objection_moments);
            const turned = ts.filter((m) => m.worked).length;
            return (
              <GlassCard key={r.call_id} className={cn("p-0", r.great_call && "border-amber-500/40")}>
                <button type="button" onClick={() => setOpenId(open ? null : r.call_id)} aria-expanded={open} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left">
                  {heardCalls.has(r.call_id) ? (
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-success/15 text-success" title="You have heard this call"><Check className="h-4 w-4" /><span className="sr-only">Heard</span></span>
                  ) : view === "start" ? (
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-bold text-primary">{idx + 1}</span>
                  ) : null}
                  <span className="w-10 text-2xl font-bold tabular-nums">{r.overall_score ?? ""}</span>
                  {r.great_call && <Badge className="border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-200"><Star className="mr-1 h-3 w-3" /> Great call</Badge>}
                  {turned > 0 && <Badge variant="outline">{turned} objection{turned === 1 ? "" : "s"} turned</Badge>}
                  <span className="font-medium">{r.agent_name || "Agent"}</span>
                  <span className="text-sm text-muted-foreground">{dispositionLabel(r.disposition)}{r.duration_seconds ? ` · ${minutes(r.duration_seconds)}` : ""}</span>
                  <ChevronDown className={cn("ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
                  {r.summary && <p className="w-full text-sm text-muted-foreground">{r.summary}</p>}
                </button>
                {open && (
                  <div className="space-y-4 border-t border-border/60 px-4 py-3 text-sm">
                    <CallAudioPlayer callId={r.call_id} moments={[...ts.map((m) => ({ t: m.t, label: m.objection })), ...momentsFrom(r.key_quotes)]} onPlay={() => void mark(TOP_CALLS_COURSE, r.call_id)} />
                    {(r.tactics ?? []).length > 0 && (
                      <div>
                        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Copy this</p>
                        <ul className="list-disc space-y-0.5 pl-5">{(r.tactics ?? []).map((s) => <li key={s}>{s}</li>)}</ul>
                      </div>
                    )}
                    {ts.length > 0 && (
                      <div>
                        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Objections in this call</p>
                        <ul className="space-y-2">
                          {ts.map((m) => (
                            <li key={`${m.t}-${m.objection}`} className="rounded-md border border-border/60 bg-background/40 p-2">
                              <p><span className="font-mono text-xs text-muted-foreground">[{m.t}]</span> <span className="font-medium">Client:</span> {m.objection}</p>
                              <p className="mt-1"><span className="font-medium">Agent:</span> {m.response}</p>
                              <p className="mt-1 text-xs text-muted-foreground">{m.technique} · {m.worked ? "moved forward" : "did not land"}</p>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {(r.strengths ?? []).length > 0 && (
                      <div>
                        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Why it worked</p>
                        <ul className="list-disc space-y-0.5 pl-5">{(r.strengths ?? []).map((s) => <li key={s}>{s}</li>)}</ul>
                      </div>
                    )}
                    <GradeBreakdown callId={r.call_id} scores={r.scores} reasons={r.score_reasons} scriptScore={r.script_score} scriptFollowed={r.script_followed} steps={r.script_steps} />
                    {(r.training_tags ?? []).length > 0 && (
                      <div className="flex flex-wrap gap-1.5">{(r.training_tags ?? []).map((t) => <Badge key={t} variant="outline" className="font-normal capitalize">{tagLabel(t)}</Badge>)}</div>
                    )}
                  </div>
                )}
              </GlassCard>
            );
          })}
        </div>
      )}

      <MyCallsPanel />
    </div>
  );
}

export default TopCallsTab;
