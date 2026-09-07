import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Mic, MicOff, Hand, PhoneOff, BookOpen, ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { speechRecognitionSupported } from "@/lib/callLab/stt";
import { cn } from "@/lib/utils";
import { useCallLabSession, type SessionMeta } from "@/lib/callLab/useCallLabSession";
import { STATE_COPY, isLiveState, type StampedEvent } from "@/lib/callLab/events";
import { formatClock, type Snapshot } from "@/lib/callLab/format";
import { SignalCore } from "@/components/callLab/SignalCore";
import { Transcript } from "@/components/callLab/Transcript";

type SessionRow = { id: string; status: string; mode: "practice" | "coach"; provider: "demo" | "composed"; scenario_snapshot: Snapshot; focus_objection_id: string | null; scorecard: unknown };

export default function CallLabLive() {
  const { id = "" } = useParams();
  usePageTitle("Live call");
  const session = useQuery({ queryKey: ["call-lab", "session", id], queryFn: async () => {
    const { data, error } = await supabase.from("call_lab_sessions").select("id,status,mode,provider,scenario_snapshot,focus_objection_id,scorecard").eq("id", id).maybeSingle();
    if (error) throw error; if (!data) throw new Error("This call does not exist or is not yours.");
    const row = data as unknown as SessionRow;
    let recovered: StampedEvent[] | null = null;
    if (["live", "ending", "evaluating"].includes(row.status)) {
      const { data: ev, error: eventError } = await supabase.from("call_lab_events").select("event_id,type,payload").eq("session_id", id).order("at_ms").limit(2000);
      if (eventError) throw eventError;
      recovered = (ev ?? []).map((e, i) => ({ eventId: e.event_id, seq: i, ...(e.payload as object), type: e.type } as StampedEvent));
    }
    return { row, recovered };
  }, staleTime: Infinity, retry: false });
  if (session.isLoading) return <Skeleton className="h-[70vh] rounded-xl" />;
  if (session.isError || !session.data) return <p className="text-sm text-destructive">{session.error instanceof Error ? session.error.message : "Could not load the call."}</p>;
  return <Cockpit key={id} row={session.data.row} recovered={session.data.recovered} />;
}

function Cockpit({ row, recovered }: { row: SessionRow; recovered: StampedEvent[] | null }) {
  const navigate = useNavigate();
  const snap = row.scenario_snapshot;
  const meta = useMemo<SessionMeta>(() => ({ id: row.id, provider: row.provider, mode: row.mode, status: row.status, voice: { voiceId: snap.persona.voice.voiceId, pitchHint: snap.persona.voice.pitchHint }, openingLine: snap.data.openingLine, objectionIdsByKey: Object.fromEntries(snap.objections.map((o) => [o.key, o.id])) }), [row, snap]);
  const { sendText, state, levelsRef, muted, error, elapsedMs, start, toggleMute, interrupt, end } = useCallLabSession(meta, recovered);
  const [textOnly, setTextOnly] = useState(!speechRecognitionSupported());
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [scoreFailed, setScoreFailed] = useState(false);
  const [ending, setEnding] = useState(false);
  const [scriptOpen, setScriptOpen] = useState(false);
  const endedRef = useRef(false);
  const isComplete = row.status === "complete" || Boolean(row.scorecard);
  useEffect(() => { if (isComplete) navigate(`/dashboard/call-lab/report/${row.id}`, { replace: true }); }, [isComplete, navigate, row.id]);

  const finish = useCallback(async (reason: Parameters<typeof end>[0] = "agent_ended") => {
    if (endedRef.current) return; endedRef.current = true; setEnding(true);
    setScoreFailed(false);
    const ok = await end(reason);
    if (ok) navigate(`/dashboard/call-lab/report/${row.id}`, { replace: true }); else { setEnding(false); setScoreFailed(true); endedRef.current = false; }
  }, [end, navigate, row.id]);
  useEffect(() => { if (!scoreFailed && state.session === "ending" && state.endReason) void finish(state.endReason); }, [state.session, state.endReason, finish, scoreFailed]);
  const maxMs = snap.data.maxDurationSec * 1000;
  useEffect(() => { if (isLiveState(state.session) && elapsedMs > maxMs) void finish("max_duration"); }, [elapsedMs, state.session, maxMs, finish]);

  const live = isLiveState(state.session) || state.session === "connecting" || state.session === "reconnecting";
  const preparing = state.session === "preparing" && !["ending", "evaluating"].includes(row.status);
  const recoverable = state.session === "failed_recoverable" && !scoreFailed;
  const required = snap.objections.filter((o) => o.required);
  const copy = STATE_COPY[state.session];

  return (
    <div className="grid min-h-[calc(100vh-8rem)] gap-4 xl:grid-cols-[16rem_minmax(0,1fr)_20rem]">
      {/* Brief */}
      <aside className="space-y-4 lg:order-1">
        <div>
          <Link className="mb-3 inline-block text-sm text-muted-foreground hover:text-foreground" to="/dashboard/call-lab">← Call Lab</Link>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Scenario</p>
          <h1 className="text-lg font-semibold leading-tight">{snap.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{snap.persona.name}, {snap.persona.role}. {snap.persona.speakingStyle}</p>
        </div>
        <div className="rounded-lg border p-3 text-sm"><p className="font-medium">Your goal</p><p className="mt-1 text-muted-foreground first-letter:uppercase">{snap.data.agentGoal}</p></div>
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Required objections</p>
          <ul className="space-y-1.5">
            {required.map((o) => { const led = state.objections[o.id]; const st = led?.resolvedTurnId ? "handled" : led ? "on the table" : "not yet"; return (
              <li key={o.id} className={cn("flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-sm", st === "handled" && "border-success/60", st === "on the table" && "border-primary", row.focus_objection_id === o.id && "ring-1 ring-primary")}>
                <span className="truncate">{o.title}</span><span className={cn("shrink-0 text-xs", st === "handled" ? "text-success" : st === "on the table" ? "text-primary" : "text-muted-foreground")}>{st}</span>
              </li>); })}
          </ul>
        </div>
        {row.mode === "coach" && <div className="rounded-lg border border-primary/50 bg-primary/5 p-3 text-sm" aria-live="polite"><p className="text-xs font-medium uppercase tracking-wide text-primary">Coach</p><p className="mt-1">{state.coachCue ?? required.find(o => state.objections[o.id] && !state.objections[o.id].resolvedTurnId)?.data.responsePrinciples?.[0] ?? "Introduce yourself clearly, ask one focused question, and give the prospect room to answer."}</p></div>}
        <ScriptPanel open={scriptOpen} onToggle={() => setScriptOpen((v) => !v)} />
      </aside>

      {/* Core */}
      <section className="flex flex-col items-center justify-center gap-5 rounded-xl border p-6 lg:order-2">
        <div className="flex items-center gap-3 text-sm"><Badge variant={state.session === "reconnecting" || recoverable ? "destructive" : "secondary"}>{copy.label}</Badge><span className="font-mono tabular-nums text-muted-foreground">{formatClock(elapsedMs)}</span><span className="text-muted-foreground">/ {formatClock(snap.data.maxDurationSec * 1000)}</span></div>
        <SignalCore levelsRef={levelsRef} speaker={state.speaker} session={state.session} muted={muted} size={220} />
        <p className="max-w-sm text-center text-sm text-muted-foreground">{preparing ? (row.provider === "demo" ? "Watch a scripted call run through the same engine that scores you." : "Headphones on. The prospect answers the moment you begin.") : copy.detail}</p>
        {error && <p className="max-w-md text-center text-sm text-destructive" role="alert">{error}</p>}
        {state.warnings.slice(-1).map((w) => <p key={`${w.code}-${w.atMs}`} className="max-w-md text-center text-xs text-muted-foreground" role="status">{w.message}</p>)}
        <div className="flex flex-wrap items-center justify-center gap-2">
          {(preparing || recoverable) && row.provider !== "demo" && <div className="basis-full text-center">
            <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={textOnly} onChange={e => setTextOnly(e.target.checked)} />Type responses instead of using a microphone</label>
            <p className="mt-1 text-xs text-muted-foreground">Same prospect and feedback. Typed practice does not measure vocal delivery.</p>
          </div>}
          {preparing && <Button size="lg" onClick={() => start(textOnly)}><Mic className="mr-2 h-4 w-4" aria-hidden />{row.provider === "demo" ? "Play demo" : textOnly ? "Begin typed practice" : "Begin call"}</Button>}
          {recoverable && <><Button size="lg" onClick={() => start(textOnly)}>Reconnect</Button><Button size="lg" variant="outline" onClick={() => finish("connection_lost")} disabled={ending}>End and score</Button></>}
          {live && !ending && <>
            {!textOnly && <Button variant={muted ? "destructive" : "outline"} onClick={toggleMute} aria-pressed={muted}>{muted ? <MicOff className="mr-2 h-4 w-4" aria-hidden /> : <Mic className="mr-2 h-4 w-4" aria-hidden />}{muted ? "Unmute" : "Mute"}</Button>}
            <Button variant="outline" onClick={interrupt}><Hand className="mr-2 h-4 w-4" aria-hidden />Interrupt</Button>
            <Button variant="destructive" onClick={() => finish("agent_ended")} disabled={ending}><PhoneOff className="mr-2 h-4 w-4" aria-hidden />{ending ? "Scoring…" : "End call"}</Button>
          </>}
          {(ending || (!scoreFailed && (state.session === "ending" || state.session === "evaluating"))) && <p className="text-sm text-muted-foreground">Scoring the call…</p>}
          {(scoreFailed || (["ending", "evaluating"].includes(row.status) && !ending)) && <><Button onClick={() => finish("agent_ended")} disabled={ending}>Retry saving and scoring</Button><Button variant="outline" asChild><Link to={`/dashboard/call-lab/report/${row.id}`}>Open report</Link></Button></>}
        </div>
        {live && row.provider !== "demo" && !ending && <form className="w-full max-w-lg space-y-2" onSubmit={async e => { e.preventDefault(); if (!draft.trim() || sending) return; const text = draft; setDraft(""); setSending(true); try { await sendText(text); } finally { setSending(false); } }}>
          <label htmlFor="practice-response" className="text-sm font-medium">{textOnly ? "Your response" : "Speech not picking up? Type your response"}</label>
          <textarea id="practice-response" value={draft} onChange={e => setDraft(e.target.value)} maxLength={4000} rows={3} placeholder="Respond to the prospect…" className="w-full rounded-md border bg-background p-3 text-sm" disabled={sending} />
          <Button type="submit" disabled={sending || !draft.trim()}>{sending ? "Prospect is responding…" : "Send response"}</Button>
        </form>}
      </section>

      {/* Transcript */}
      <aside className="flex min-h-[20rem] flex-col rounded-xl border p-4 lg:order-3">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Transcript</p>
        <Transcript state={state} agentName="You" prospectName={snap.persona.name} className="flex-1" />
      </aside>
    </div>
  );
}

/** The team's own scripts, one click away. Reads sales_scripts so the words on screen are the words the agency trains on. */
function ScriptPanel({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const q = useQuery({ queryKey: ["call-lab", "scripts"], enabled: open, queryFn: async () => { const { data, error } = await supabase.from("sales_scripts").select("id,title,body,category").eq("is_active", true).in("category", ["inbound", "objections"]).order("sort_order").limit(20); if (error) throw error; return data ?? []; } });
  return (
    <div className="rounded-lg border">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium"><span className="flex items-center gap-2"><BookOpen className="h-4 w-4" aria-hidden />Scripts</span><ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden /></button>
      {open && <div className="max-h-72 space-y-3 overflow-y-auto border-t px-3 py-2 text-sm">
        {q.isLoading && <Skeleton className="h-16" />}
        {q.isError && <p className="text-destructive">Scripts could not load. Close and reopen this panel to retry.</p>}
        {q.data?.length === 0 && <p className="text-muted-foreground">No scripts published yet.</p>}
        {q.data?.map((s) => <div key={s.id}><p className="font-medium">{s.title}</p><p className="whitespace-pre-wrap text-muted-foreground">{s.body}</p></div>)}
      </div>}
    </div>
  );
}
