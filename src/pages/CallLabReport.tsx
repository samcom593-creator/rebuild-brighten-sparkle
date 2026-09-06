import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, RefreshCw, Target } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { initialCallState, reduceCallEvent, type StampedEvent, type Turn } from "@/lib/callLab/events";
import { formatClock, formatDuration, type Snapshot } from "@/lib/callLab/format";
import { Transcript } from "@/components/callLab/Transcript";

type Evidence = { turnId: string; excerpt: string };
type Scorecard = {
  overallScore: number | null; passState: "pass" | "fail" | "insufficient_evidence"; confidence: string; verdict: string; evidenceCoverage: number;
  dimensions: { criterionId: string; label: string; pointsEarned: number | null; pointsPossible: number; confidence: string; rationale: string; evidence: Evidence[]; nextBehavior: string }[];
  objectionScores: Record<string, { surfaced: boolean; resolved: boolean | null; score: number | null; stages: Record<string, number | null>; evidence: Evidence[]; coaching: string; meetsGate: boolean | null }>;
  gates: { id: string; label: string; passed: boolean | null; detail: string }[];
  criticalFailures: { ruleId: string; label: string; rationale: string; applied: boolean; evidence: Evidence[] }[];
  coaching: { strongestBehavior: string; highestLeverageCorrection: string; recommendedDrill: { title: string; objective: string; sourceObjectionVersionId: string | null } };
  coachingItems: { rank: number; moment: string; whyItMattered: string; tryInstead: string; example: string; evidence: Evidence[] }[];
  metrics: { agent: { wordsPerMinute: number | null; longestTurnMs: number | null; longestTurnId: string | null }; talkRatioAgent: number | null; fillersPerMinute: number | null; responseLatencyMs: { median: number | null }; interruptionsByAgent: number; pauses: { over4000ms: number }; confidence: string };
  evaluator: string; scoredAt: string;
};
type SessionRow = { id: string; status: string; scenario_id: string; scenario_snapshot: Snapshot; scorecard: Scorecard | null; duration_ms: number | null; end_reason: string | null; eval_error: string | null; created_at: string; provider: string };

export default function CallLabReport() {
  const { id = "" } = useParams();
  usePageTitle("Call report");
  const [retrying, setRetrying] = useState(false);
  const q = useQuery({ queryKey: ["call-lab", "report", id], queryFn: async () => {
    const { data, error } = await supabase.from("call_lab_sessions").select("id,status,scenario_id,scenario_snapshot,scorecard,duration_ms,end_reason,eval_error,created_at,provider").eq("id", id).maybeSingle();
    if (error) throw error; if (!data) throw new Error("This call does not exist or is not yours.");
    const { data: ev } = await supabase.from("call_lab_events").select("event_id,type,payload").eq("session_id", id).order("at_ms").limit(2000);
    const events = (ev ?? []).map((e, i) => ({ eventId: e.event_id, seq: i, ...(e.payload as object), type: e.type } as StampedEvent));
    return { row: data as unknown as SessionRow, events };
  } });
  const retry = async () => { setRetrying(true); await supabase.functions.invoke("call-lab-evaluate", { body: { sessionId: id, reason: q.data?.row.end_reason ?? "agent_ended" } }); await q.refetch(); setRetrying(false); };
  if (q.isLoading) return <Skeleton className="h-[60vh] rounded-xl" />;
  if (q.isError || !q.data) return <p className="text-sm text-destructive">{q.error instanceof Error ? q.error.message : "Could not load the report."}</p>;
  const { row, events } = q.data; const sc = row.scorecard;
  if (!sc) return (
    <div className="mx-auto max-w-lg space-y-4 py-12 text-center">
      <h1 className="text-xl font-semibold">Not scored yet</h1>
      <p className="text-sm text-muted-foreground">{row.status === "live" || row.status === "created" ? "This call is still open." : row.eval_error ? `Scoring failed: ${row.eval_error}` : "The transcript is saved. Scoring did not finish."}</p>
      <div className="flex justify-center gap-2">
        {(row.status === "live" || row.status === "created") ? <Button asChild><Link to={`/dashboard/call-lab/live/${row.id}`}>Open the call</Link></Button> : <Button onClick={retry} disabled={retrying}><RefreshCw className={cn("mr-2 h-4 w-4", retrying && "animate-spin")} aria-hidden />Score this call</Button>}
        <Button variant="outline" asChild><Link to="/dashboard/call-lab">Back to Call Lab</Link></Button>
      </div>
    </div>);
  return <Report row={row} sc={sc} events={events} />;
}

function Report({ row, sc, events }: { row: SessionRow; sc: Scorecard; events: StampedEvent[] }) {
  const snap = row.scenario_snapshot;
  const state = useMemo(() => events.reduce(reduceCallEvent, initialCallState("complete")), [events]);
  const cited = useMemo(() => { const s = new Set<string>(); for (const d of sc.dimensions) for (const e of d.evidence) s.add(e.turnId); for (const o of Object.values(sc.objectionScores)) for (const e of o.evidence) s.add(e.turnId); for (const c of sc.coachingItems) for (const e of c.evidence) s.add(e.turnId); return s; }, [sc]);
  const [selected, setSelected] = useState<string | null>(null);
  const jump = (turnId: string) => { setSelected(turnId); document.getElementById(`turn-${turnId}`)?.scrollIntoView({ block: "center", behavior: "smooth" }); };
  const drillObjection = snap.objections.find((o) => o.id === sc.coaching.recommendedDrill.sourceObjectionVersionId);
  const drillHref = `/dashboard/call-lab?scenario=${encodeURIComponent(row.scenario_id)}${drillObjection ? `&focus=${encodeURIComponent(drillObjection.id)}` : ""}`;
  const pass = sc.passState === "pass"; const insufficient = sc.passState === "insufficient_evidence";
  const m = sc.metrics; const b = snap.rubric;
  const turns: Turn[] = state.order.map((id) => state.turns[id]);
  const stageKeys = ["acknowledge", "clarify", "isolate", "respond", "proof", "confirm"] as const;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3 text-sm"><Button variant="ghost" size="sm" asChild><Link to="/dashboard/call-lab"><ArrowLeft className="mr-1 h-4 w-4" aria-hidden />Call Lab</Link></Button><span className="text-muted-foreground">{snap.title} · {new Date(row.created_at).toLocaleString()} · {formatDuration(row.duration_ms ?? 0)} · {row.provider === "demo" ? "demo" : "live"}</span></div>

      {/* Verdict */}
      <section className="grid gap-6 rounded-xl border p-6 md:grid-cols-[auto_1fr]">
        <div className="flex flex-col items-center gap-2">
          <div className={cn("grid h-36 w-36 place-items-center rounded-full border-4", pass ? "border-success" : insufficient ? "border-border" : "border-destructive")}>
            <span className="text-5xl font-semibold tabular-nums">{sc.overallScore ?? "—"}</span>
          </div>
          <Badge variant={pass ? "default" : insufficient ? "outline" : "destructive"} className="uppercase tracking-wide">{sc.passState.replace("_", " ")}</Badge>
          <p className="text-xs text-muted-foreground">out of 100 · {sc.confidence.replace("_", " ")} confidence</p>
        </div>
        <div className="space-y-3">
          <p className="text-lg leading-relaxed">{sc.verdict}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Card title="Strongest">{sc.coaching.strongestBehavior}</Card>
            <Card title="Fix first">{sc.coaching.highestLeverageCorrection}</Card>
            <Card title={`Drill: ${sc.coaching.recommendedDrill.title}`}>{sc.coaching.recommendedDrill.objective}<Button size="sm" className="mt-2" asChild><Link to={drillHref}><Target className="mr-2 h-4 w-4" aria-hidden />Practice this moment</Link></Button></Card>
          </div>
          <p className="text-xs text-muted-foreground">Evidence coverage {Math.round(sc.evidenceCoverage * 100)}% of rubric points. Scored by {sc.evaluator === "demo" ? "the built-in rules evaluator" : sc.evaluator}. Every point below cites a moment in the transcript.</p>
        </div>
      </section>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="space-y-8">
          {/* Rubric */}
          <section>
            <H2>Rubric</H2>
            <ul className="divide-y rounded-xl border">
              {sc.dimensions.map((d) => { const pct = d.pointsEarned === null ? 0 : (d.pointsEarned / Math.max(1, d.pointsPossible)) * 100; return (
                <li key={d.criterionId} className="space-y-2 p-4">
                  <div className="flex items-center justify-between gap-3"><p className="font-medium">{d.label}</p><p className="tabular-nums text-sm">{d.pointsEarned ?? "—"} / {d.pointsPossible}</p></div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden><div className={cn("h-full", pct >= 70 ? "bg-success" : pct >= 40 ? "bg-primary" : "bg-destructive")} style={{ width: `${pct}%` }} /></div>
                  <p className="text-sm text-muted-foreground">{d.rationale}</p>
                  {d.nextBehavior && <p className="text-sm"><span className="font-medium">Next time:</span> {d.nextBehavior}</p>}
                  <EvidenceChips evidence={d.evidence} onJump={jump} />
                </li>); })}
            </ul>
          </section>

          {/* Objections */}
          <section>
            <H2>Objections</H2>
            <ul className="grid gap-3 md:grid-cols-2">
              {snap.objections.map((o) => { const s = sc.objectionScores[o.id]; if (!s) return null; return (
                <li key={o.id} className="space-y-2 rounded-xl border p-4">
                  <div className="flex items-center justify-between gap-2"><p className="font-medium">{o.title}</p><Badge variant={s.meetsGate === true ? "default" : s.meetsGate === false ? "destructive" : "outline"}>{!s.surfaced ? "not raised" : s.score === null ? "no evidence" : `${s.score}/100`}</Badge></div>
                  {s.surfaced && <ul className="grid grid-cols-6 gap-1" aria-label="Objection stages">{stageKeys.map((k) => { const v = s.stages[k]; const w = b.objectionStages[k] ?? 0; return <li key={k} className="text-center"><div className="h-1 rounded-full bg-muted" aria-hidden><div className={cn("h-full rounded-full", v === null ? "" : v >= w * 0.7 ? "bg-success" : v > 0 ? "bg-primary" : "bg-destructive")} style={{ width: `${v === null || !w ? 0 : Math.min(100, (v / w) * 100)}%` }} /></div><span className="text-[10px] capitalize text-muted-foreground">{k}</span></li>; })}</ul>}
                  <p className="text-sm text-muted-foreground">{s.coaching}</p>
                  <EvidenceChips evidence={s.evidence} onJump={jump} />
                </li>); })}
            </ul>
          </section>

          {/* Trainer's notes */}
          {sc.coachingItems.length > 0 && <section>
            <H2>Trainer's notes</H2>
            <ol className="space-y-3">
              {sc.coachingItems.map((c) => (
                <li key={`coach-${c.rank}`} className="rounded-xl border p-4">
                  <p className="font-medium">{c.rank}. {c.moment}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{c.whyItMattered}</p>
                  <p className="mt-2 text-sm"><span className="font-medium">Try instead:</span> {c.tryInstead}</p>
                  {c.example && <p className="mt-1 rounded-md bg-muted p-2 text-sm italic">"{c.example}"</p>}
                  <EvidenceChips evidence={c.evidence} onJump={jump} />
                </li>))}
            </ol>
          </section>}
        </div>

        <div className="space-y-6">
          {/* Gates */}
          <section>
            <H2>Gates</H2>
            <ul className="space-y-1.5 text-sm">
              {sc.gates.map((g) => <li key={g.id} className="flex gap-2 rounded-md border px-3 py-2"><span className={cn("mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full", g.passed === true ? "bg-success" : g.passed === false ? "bg-destructive" : "bg-muted-foreground")} aria-hidden /><span><span className="font-medium">{g.label}</span><span className="block text-muted-foreground">{g.detail}</span></span></li>)}
              {sc.criticalFailures.filter((c) => c.applied).map((c) => <li key={c.ruleId} className="rounded-md border border-destructive px-3 py-2"><span className="font-medium text-destructive">Critical: {c.label}</span><span className="block text-muted-foreground">{c.rationale}</span><EvidenceChips evidence={c.evidence} onJump={jump} /></li>)}
            </ul>
          </section>

          {/* Delivery */}
          <section>
            <H2>Delivery</H2>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <Stat label="Pace" value={m.agent.wordsPerMinute === null ? "—" : `${Math.round(m.agent.wordsPerMinute)} wpm`} hint={`${b.deliveryBenchmarks?.wordsPerMinute?.[0] ?? 130}–${b.deliveryBenchmarks?.wordsPerMinute?.[1] ?? 170}`} />
              <Stat label="Talk ratio" value={m.talkRatioAgent === null ? "—" : `${Math.round(m.talkRatioAgent * 100)}%`} hint="you" />
              <Stat label="Fillers" value={m.fillersPerMinute === null ? "—" : `${m.fillersPerMinute.toFixed(1)}/min`} hint={`≤ ${b.deliveryBenchmarks?.fillersPerMinute ?? 3}`} />
              <Stat label="Response" value={m.responseLatencyMs.median === null ? "—" : `${(m.responseLatencyMs.median / 1000).toFixed(1)}s`} hint="median" />
              <Stat label="Interruptions" value={String(m.interruptionsByAgent)} hint="by you" />
              <Stat label="Longest turn" value={m.agent.longestTurnMs === null ? "—" : formatClock(m.agent.longestTurnMs)} hint={m.agent.longestTurnId ? <button type="button" className="underline" onClick={() => jump(m.agent.longestTurnId!)}>jump</button> : "—"} />
            </dl>
            <p className="mt-2 text-xs text-muted-foreground">Delivery confidence {m.confidence.replace("_", " ")}.</p>
          </section>

          {/* Transcript */}
          <section className="flex max-h-[60vh] flex-col">
            <H2>Transcript</H2>
            <Transcript state={{ turns: Object.fromEntries(turns.map((t) => [t.turnId, cited.has(t.turnId) ? { ...t, text: `★ ${t.text}` } : t])), order: state.order }} agentName="You" prospectName={snap.persona.name} className="min-h-0 flex-1 rounded-xl border p-3" onSelect={(t) => setSelected(t.turnId)} selectedTurnId={selected} />
            <p className="mt-1 text-xs text-muted-foreground">★ marks a turn the score cites.</p>
          </section>
        </div>
      </div>
    </div>
  );
}

function H2({ children }: { children: React.ReactNode }) { return <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">{children}</h2>; }
function Card({ title, children }: { title: string; children: React.ReactNode }) { return <div className="rounded-lg border p-3 text-sm"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p><p className="mt-1">{children}</p></div>; }
function Stat({ label, value, hint }: { label: string; value: string; hint: React.ReactNode }) { return <div className="rounded-md border px-3 py-2"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="font-medium tabular-nums">{value} <span className="text-xs font-normal text-muted-foreground">{hint}</span></dd></div>; }
function EvidenceChips({ evidence, onJump }: { evidence: Evidence[]; onJump: (turnId: string) => void }) {
  if (!evidence?.length) return null;
  return <ul className="flex flex-wrap gap-1.5">{evidence.slice(0, 4).map((e) => <li key={`${e.turnId}-${e.excerpt.slice(0, 12)}`}><button type="button" onClick={() => onJump(e.turnId)} className="max-w-[16rem] truncate rounded-full border px-2 py-0.5 text-left text-xs text-muted-foreground hover:border-primary hover:text-foreground" title={e.excerpt}>"{e.excerpt}"</button></li>)}</ul>;
}
