import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { initialCallState, reduceCallEvent, stampEvent, type CallEvent, type CallState, type EndReason, type StampedEvent } from "./events";
import { ComposedProvider, DemoProvider, type CallProvider } from "./providers";
import { LevelAggregator, sampleLevel } from "./audio";

export type Levels = { input: number; output: number; outputSynthetic: boolean };
export type SessionMeta = { id: string; provider: "demo" | "composed"; mode: "practice" | "coach"; status: string; voice: { voiceId?: string; pitchHint?: "low" | "mid" | "high" }; openingLine: string; objectionIdsByKey: Record<string, string> };

/**
 * Owns the live call on the client: provider lifecycle, the event reducer,
 * durable persistence (batched upserts, idempotent on event_id), level
 * sampling, and the end → evaluate hand-off. A reload rebuilds the transcript
 * from the durable events and offers reconnect or a safe close.
 */
export function useCallLabSession(meta: SessionMeta, recovered: StampedEvent[] | null, demoSpeed = 1) {
  const [state, dispatch] = useReducer(reduceCallEvent, undefined, () => {
    const base = initialCallState("preparing");
    if (recovered?.length) { const s = recovered.reduce(reduceCallEvent, base); return { ...s, session: s.endReason ? "ending" : "failed_recoverable", connection: "closed", speaker: "none" } as CallState; }
    return base;
  });
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsed] = useState(0);
  const providerRef = useRef<CallProvider | null>(null);
  const startedAtRef = useRef(0);
  const queueRef = useRef<StampedEvent[]>([]);
  const flushingRef = useRef(false);
  const closedRef = useRef(false);
  const levelsRef = useRef<Levels>({ input: 0, output: 0, outputSynthetic: false });
  const aggRef = useRef({ agent: new LevelAggregator(), prospect: new LevelAggregator() });
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);

  const persist = useCallback(async () => {
    if (flushingRef.current || closedRef.current || queueRef.current.length === 0) return;
    flushingRef.current = true;
    const batch = queueRef.current.splice(0, 100);
    try {
      const rows = batch.map((ev) => { const { eventId, seq, ...rest } = ev; void seq; const atMs = "atMs" in ev ? ev.atMs : "startMs" in ev ? ev.startMs : 0; return { session_id: meta.id, event_id: eventId, type: ev.type, at_ms: atMs, payload: rest as unknown as Json }; });
      const { error } = await supabase.from("call_lab_events").upsert(rows, { onConflict: "session_id,event_id", ignoreDuplicates: true });
      if (error) throw error;
    } catch (e) { void e; queueRef.current.unshift(...batch); } finally { flushingRef.current = false; }
  }, [meta.id]);

  const onEvent = useCallback((ev: CallEvent) => {
    const stamped = stampEvent(ev, "c");
    dispatch(stamped);
    if (ev.type !== "audio.metric" && ev.type !== "coach.cue") queueRef.current.push(stamped);
    if (ev.type === "session.ended" || ev.type === "connection.changed") void persist();
  }, [persist]);

  useEffect(() => { const id = setInterval(() => void persist(), 800); return () => clearInterval(id); }, [persist]);
  useEffect(() => { const id = setInterval(() => setElapsed(startedAtRef.current ? Date.now() - startedAtRef.current : 0), 500); return () => clearInterval(id); }, []);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const p = providerRef.current;
      if (p) {
        const i = sampleLevel(p.inputAnalyser); const o = p.outputAnalyser ? sampleLevel(p.outputAnalyser) : { level: p.syntheticLevel, clipped: false };
        const synthetic = !p.outputAnalyser || p.browserVoiceActive;
        levelsRef.current = { input: muted ? 0 : i.level, output: synthetic ? p.syntheticLevel : o.level, outputSynthetic: synthetic };
        if (p.inputAnalyser && !muted) aggRef.current.agent.add(i.level, i.clipped);
        if (p.outputAnalyser && !synthetic) aggRef.current.prospect.add(o.level, o.clipped);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop); return () => cancelAnimationFrame(raf);
  }, [muted]);

  const start = useCallback(async () => {
    setError(null);
    try {
      let stream: MediaStream | null = null; let ctx: AudioContext | null = null;
      if (meta.provider === "composed") {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        ctx = new AudioContext(); if (ctx.state === "suspended") await ctx.resume();
      }
      streamRef.current = stream; ctxRef.current = ctx;
      const provider: CallProvider = meta.provider === "demo" ? new DemoProvider(demoSpeed) : new ComposedProvider();
      providerRef.current = provider; startedAtRef.current = Date.now();
      await supabase.from("call_lab_sessions").update({ status: "live", started_at: new Date().toISOString() }).eq("id", meta.id).eq("status", "created");
      await provider.connect({ sessionId: meta.id, mode: meta.mode, mediaStream: stream, audioContext: ctx, onEvent, startedAt: startedAtRef.current, resumeFromTurnCount: recovered ? Object.keys(state.turns).length : 0, voice: meta.voice, openingLine: meta.openingLine, objectionIdsByKey: meta.objectionIdsByKey });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(/Permission|NotAllowed|denied/i.test(msg) ? "Microphone access was denied. Allow it in the browser site settings, then retry." : msg);
      onEvent({ type: "connection.changed", state: "failed", atMs: startedAtRef.current ? Date.now() - startedAtRef.current : 0, detail: msg });
    }
  }, [meta, onEvent, demoSpeed, recovered, state.turns]);

  const end = useCallback(async (reason: EndReason = "agent_ended"): Promise<boolean> => {
    const p = providerRef.current; if (p) await p.disconnect(reason);
    for (const t of streamRef.current?.getTracks() ?? []) t.stop();
    await ctxRef.current?.close().catch(() => undefined); // empty-catch-allow:closing-an-alreadyclosed-audiocontext-rejects-the-call (closing an already-closed AudioContext rejects; the call is over either way)
    await persist(); await persist();
    const audio = { agent: aggRef.current.agent.samples ? aggRef.current.agent.snapshot() : null, prospect: aggRef.current.prospect.samples ? aggRef.current.prospect.snapshot() : null };
    await supabase.from("call_lab_sessions").update({ status: "ending", audio, end_reason: reason, ended_at: new Date().toISOString(), duration_ms: startedAtRef.current ? Date.now() - startedAtRef.current : null }).eq("id", meta.id);
    const { error } = await supabase.functions.invoke("call-lab-evaluate", { body: { sessionId: meta.id, reason } });
    if (error) { setError("The call ended but scoring did not complete. Your transcript is saved; open the report to retry."); return false; }
    return true;
  }, [meta.id, persist]);

  const toggleMute = useCallback(() => setMuted((m) => { providerRef.current?.setMuted(!m); return !m; }), []);
  const interrupt = useCallback(() => providerRef.current?.interrupt(), []);
  const simulate = { disconnect: () => providerRef.current?.simulateDisconnect?.(), reconnect: () => providerRef.current?.simulateReconnect?.() };
  useEffect(() => () => { for (const t of streamRef.current?.getTracks() ?? []) t.stop(); }, []);
  return { state, levelsRef, muted, error, elapsedMs, start, toggleMute, interrupt, end, simulate };
}
