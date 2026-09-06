import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Mic, Play, Volume2, Target, Clock, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { createMicGraph, sampleLevel, speakWithBrowser } from "@/lib/callLab/audio";
import { speechRecognitionSupported } from "@/lib/callLab/stt";
import type { Snapshot } from "@/lib/callLab/format";

type ScenarioRow = { id: string; title: string; version: number; difficulty: number; data: Snapshot["data"]; persona: Snapshot["persona"]; objections: Snapshot["objections"]; rubric: Snapshot["rubric"]; claims: unknown };
type SessionRow = { id: string; scenario_id: string; status: string; mode: string; provider: string; created_at: string; scorecard: { overallScore: number | null; passState: string } | null; scenario_snapshot: { title: string } };

const DIFFICULTY = ["", "Foundation", "Standard", "Hard"];

/** Call Lab home: pick a scenario, check the mic, run the call. Scores land in the report. */
export default function CallLab() {
  usePageTitle("Call Lab");
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const focus = params.get("focus"); const preselect = params.get("scenario");
  const [mode, setMode] = useState<"practice" | "coach">("practice");
  const [starting, setStarting] = useState<string | null>(null);

  const scenarios = useQuery({ queryKey: ["call-lab", "scenarios"], queryFn: async () => { const { data, error } = await supabase.from("call_lab_scenarios").select("id,title,version,difficulty,data,persona,objections,rubric,claims").eq("is_active", true).order("difficulty"); if (error) throw error; return (data ?? []) as unknown as ScenarioRow[]; } });
  const sessions = useQuery({ queryKey: ["call-lab", "sessions"], queryFn: async () => { const { data, error } = await supabase.from("call_lab_sessions").select("id,scenario_id,status,mode,provider,created_at,scorecard,scenario_snapshot").order("created_at", { ascending: false }).limit(25); if (error) throw error; return (data ?? []) as unknown as SessionRow[]; } });

  const bests = useMemo(() => { const m: Record<string, { best: number | null; last: number | null; runs: number }> = {}; for (const s of sessions.data ?? []) { const sc = s.scorecard?.overallScore ?? null; const e = (m[s.scenario_id] ??= { best: null, last: null, runs: 0 }); e.runs += 1; if (sc !== null) { if (e.last === null) e.last = sc; if (e.best === null || sc > e.best) e.best = sc; } } return m; }, [sessions.data]);

  const start = async (s: ScenarioRow, provider: "composed" | "demo") => {
    if (provider === "composed" && !speechRecognitionSupported()) { toast.error("Live calls need Chrome or Edge for speech recognition. The demo works anywhere."); return; }
    setStarting(`${s.id}:${provider}`);
    const id = crypto.randomUUID();
    const snapshot = { title: s.title, data: s.data, persona: s.persona, objections: s.objections, rubric: s.rubric, claims: s.claims };
    const { error } = await supabase.from("call_lab_sessions").insert({ id, scenario_id: s.id, scenario_version: s.version, scenario_snapshot: snapshot as unknown as Json, mode, provider, tts: provider === "composed" ? "elevenlabs" : "browser", focus_objection_id: focus && preselect === s.id ? focus : null });
    setStarting(null);
    if (error) { toast.error(`Could not start the call: ${error.message}`); return; }
    navigate(`/dashboard/call-lab/live/${id}`);
  };

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Training" eyebrowIcon={<Mic className="h-4 w-4" aria-hidden />} title="Call Lab" subtitle="A prospect who talks back. Run the call, get scored out of 100 with the exact moments that earned or cost points." actions={<ModeToggle mode={mode} onChange={setMode} />} />
      <MicCheck />
      {focus && preselect && <p className="rounded-lg border border-primary/40 bg-primary/5 px-4 py-2 text-sm">Drill loaded: this run opens straight into the objection you missed. Start the matching scenario below.</p>}
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {scenarios.isLoading && [0, 1, 2].map((n) => <Skeleton key={`scenario-skeleton-${n}`} className="h-56 rounded-xl" />)}
        {scenarios.data?.map((s) => { const b = bests[s.id]; const required = s.objections.filter((o) => o.required).length; const hot = preselect === s.id; return (
          <Card key={s.id} className={cn("flex flex-col", hot && "ring-1 ring-primary")}>
            <CardContent className="flex flex-1 flex-col gap-3 p-5">
              <div className="flex items-start justify-between gap-3">
                <div><h2 className="text-lg font-semibold leading-tight">{s.title}</h2><p className="mt-1 text-sm text-muted-foreground">{s.persona.name}, {s.persona.role}</p></div>
                <Badge variant="outline">{DIFFICULTY[s.difficulty] ?? "Standard"}</Badge>
              </div>
              <p className="text-sm leading-relaxed">{s.data.goal}</p>
              <ul className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                <li className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" aria-hidden />{s.data.estimatedMinutes} min</li>
                <li className="flex items-center gap-1"><Target className="h-3.5 w-3.5" aria-hidden />{required} required</li>
                <li className="tabular-nums">{b?.best !== null && b?.best !== undefined ? `Best ${b.best}` : b?.runs ? "Unscored" : "No runs yet"}</li>
              </ul>
              <div className="mt-auto flex gap-2 pt-2">
                <Button className="flex-1" onClick={() => start(s, "composed")} disabled={starting !== null}><Mic className="mr-2 h-4 w-4" aria-hidden />{starting === `${s.id}:composed` ? "Starting…" : "Start call"}</Button>
                <Button variant="outline" onClick={() => start(s, "demo")} disabled={starting !== null} aria-label={`Watch a demo of ${s.title}`}><Play className="h-4 w-4" aria-hidden /></Button>
              </div>
            </CardContent>
          </Card>); })}
        {scenarios.isError && <p className="text-sm text-destructive">Scenarios did not load. Refresh to try again.</p>}
      </section>
      <section>
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">Recent calls</h2>
        {sessions.isLoading && <Skeleton className="h-24 rounded-xl" />}
        {sessions.data?.length === 0 && <p className="text-sm text-muted-foreground">Your scored calls will appear here.</p>}
        <ul className="divide-y rounded-xl border">
          {sessions.data?.map((s) => { const score = s.scorecard?.overallScore ?? null; const done = s.status === "complete"; return (
            <li key={s.id}>
              <Link to={done ? `/dashboard/call-lab/report/${s.id}` : `/dashboard/call-lab/live/${s.id}`} className="flex items-center gap-4 px-4 py-3 hover:bg-accent">
                <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-full border text-sm font-semibold tabular-nums", score !== null && (s.scorecard?.passState === "pass" ? "border-success text-success" : "border-destructive text-destructive"))}>{score ?? "—"}</span>
                <span className="min-w-0 flex-1"><span className="block truncate font-medium">{s.scenario_snapshot?.title ?? s.scenario_id}</span><span className="block text-xs text-muted-foreground">{new Date(s.created_at).toLocaleString()} · {s.provider === "demo" ? "demo" : "live"} · {s.mode}</span></span>
                <Badge variant={done ? "secondary" : "outline"}>{done ? (s.scorecard?.passState ?? "scored").replace("_", " ") : s.status}</Badge>
                <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
              </Link>
            </li>); })}
        </ul>
      </section>
    </div>
  );
}

function ModeToggle({ mode, onChange }: { mode: "practice" | "coach"; onChange: (m: "practice" | "coach") => void }) {
  return (
    <div role="radiogroup" aria-label="Call mode" className="inline-flex rounded-lg border p-0.5">
      {(["practice", "coach"] as const).map((m) => <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => onChange(m)} className={cn("rounded-md px-3 py-1.5 text-sm capitalize", mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>{m}</button>)}
    </div>
  );
}

/** One-line mic and speaker check. The meter is live analyser data, not an animation. */
function MicCheck() {
  const [level, setLevel] = useState<number | null>(null);
  const [state, setState] = useState<"idle" | "checking" | "ok" | "denied">("idle");
  const stopRef = useRef<() => void>(() => undefined);
  useEffect(() => () => stopRef.current(), []);
  const check = async () => {
    setState("checking");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const g = createMicGraph(stream); let peak = 0; const t0 = Date.now();
      const id = setInterval(() => { const l = sampleLevel(g.analyser).level; peak = Math.max(peak, l); setLevel(l); if (Math.max(0, Date.now() - t0) > 4000) { stop(); setState(peak > 0.03 ? "ok" : "idle"); if (peak <= 0.03) toast("No sound reached the microphone. Check the input device and try again."); } }, 80);
      const stop = () => { clearInterval(id); g.dispose(); for (const tr of stream.getTracks()) tr.stop(); void g.context.close().catch(() => undefined); }; // empty-catch-allow:closing-the-miccheck-context-after-tracks-stopped (closing the mic-check context after tracks stopped; nothing to report)
      stopRef.current = stop;
    } catch (e) { void e; setState("denied"); }
  };
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-sm">
      <span className="font-medium">Before you dial</span>
      <Button size="sm" variant="outline" onClick={check} disabled={state === "checking"}><Mic className="mr-2 h-4 w-4" aria-hidden />{state === "checking" ? "Say something…" : "Check mic"}</Button>
      <div className="h-2 w-32 overflow-hidden rounded-full bg-muted" aria-hidden><div className="h-full bg-primary" style={{ width: `${Math.round((level ?? 0) * 100)}%` }} /></div>
      <Button size="sm" variant="outline" onClick={() => speakWithBrowser("This is the prospect's fallback voice. The live call uses a natural voice when available.", {})}><Volume2 className="mr-2 h-4 w-4" aria-hidden />Test speaker</Button>
      <span className="text-muted-foreground">{state === "ok" ? "Microphone works." : state === "denied" ? "Microphone blocked. Allow it in the browser site settings." : speechRecognitionSupported() ? "Chrome or Edge, headphones on, quiet room." : "Live calls need Chrome or Edge. The demo runs anywhere."}</span>
    </div>
  );
}
