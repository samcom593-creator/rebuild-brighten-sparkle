import { supabase } from "@/integrations/supabase/client";
import type { CallEvent, EndReason } from "./events";
import { DEMO_SCRIPT, type DemoStep } from "./demoScript";
import { StreamPlayer, createMicGraph, speakWithBrowser, type MicGraph } from "./audio";
import { SpeechToText, speechRecognitionSupported } from "./stt";

export type ConnectOptions = {
  sessionId: string; mode: "practice" | "coach"; mediaStream: MediaStream | null; audioContext: AudioContext | null;
  onEvent: (ev: CallEvent) => void; startedAt: number; resumeFromTurnCount?: number;
  voice: { voiceId?: string; pitchHint?: "low" | "mid" | "high" }; openingLine: string; objectionIdsByKey: Record<string, string>;
};
export interface CallProvider {
  readonly kind: "demo" | "composed";
  connect(o: ConnectOptions): Promise<void>; disconnect(reason: EndReason): Promise<void>;
  setMuted(m: boolean): void; interrupt(): void;
  inputAnalyser: AnalyserNode | null; outputAnalyser: AnalyserNode | null; syntheticLevel: number; browserVoiceActive: boolean;
  simulateDisconnect?(): void; simulateReconnect?(): void;
}

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  return { Authorization: `Bearer ${data.session?.access_token ?? ""}`, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json" };
}

/** Scripted replay: same events, same reducer, no microphone. The prospect still speaks (browser voice). */
export class DemoProvider implements CallProvider {
  readonly kind = "demo" as const;
  inputAnalyser: AnalyserNode | null = null; outputAnalyser: AnalyserNode | null = null; syntheticLevel = 0; browserVoiceActive = false;
  private o: ConnectOptions | null = null; private steps: DemoStep[]; private i = 0; private timer: number | null = null; private paused = false; private ended = false; private muted = false; private seq = 0; private cancelSpeech: (() => void) | null = null;
  constructor(private speed = 1, steps: DemoStep[] = DEMO_SCRIPT) { this.steps = steps; }
  private emit(ev: CallEvent) { this.o?.onEvent(ev); }
  private now() { return Date.now() - (this.o?.startedAt ?? Date.now()); }
  private wait(ms: number) { return new Promise<void>((resolve) => { const tick = () => { if (this.ended) return; if (this.paused) { this.timer = window.setTimeout(tick, 120); return; } resolve(); }; this.timer = window.setTimeout(tick, Math.max(10, ms / this.speed)); }); }
  async connect(o: ConnectOptions) {
    this.o = o; this.emit({ type: "connection.changed", state: "connecting", atMs: this.now() }); await this.wait(600); if (this.ended) return;
    this.emit({ type: "connection.changed", state: "connected", atMs: this.now(), detail: "Demo simulation" }); void this.run();
  }
  private async run() {
    for (; this.i < this.steps.length && !this.ended; this.i++) {
      const st = this.steps[this.i]; const ids = this.o!.objectionIdsByKey;
      if (st.kind === "turn") await this.turn(st);
      else if (st.kind === "objection.surfaced") this.emit({ type: "objection.surfaced", objectionId: ids[st.key] ?? st.key, turnId: `dt_${this.seq}`, atMs: this.now() });
      else if (st.kind === "objection.resolved") this.emit({ type: "objection.resolved", objectionId: ids[st.key] ?? st.key, turnId: `dt_${this.seq}`, atMs: this.now() });
      else if (st.kind === "commitment") this.emit({ type: "commitment.recorded", turnId: `dt_${this.seq}`, atMs: this.now(), summary: st.summary });
      else if (st.kind === "overlap") this.emit({ type: "overlap.detected", initiator: st.initiator, startMs: this.now(), durationMs: st.durationMs });
      else if (st.kind === "end") { this.finish(st.reason); return; }
    }
    if (!this.ended) this.finish("earned_next_step");
  }
  private async turn(st: Extract<DemoStep, { kind: "turn" }>) {
    await this.wait(st.gapMs ?? 400); if (this.ended) return;
    this.seq += 1; const turnId = `dt_${this.seq}`; const startMs = this.now();
    this.emit({ type: "speaker.changed", speaker: st.speaker, atMs: startMs });
    const words = st.text.split(" ");
    let speech: ReturnType<typeof speakWithBrowser> | null = null;
    if (st.speaker === "prospect" && !this.muted) { this.browserVoiceActive = true; speech = speakWithBrowser(st.text, { pitchHint: this.o?.voice.pitchHint, onProgress: (p) => { this.syntheticLevel = 0.35 + 0.45 * Math.abs(Math.sin(p * Math.PI * 6)); } }); this.cancelSpeech = speech.cancel; }
    const per = st.durationMs / Math.max(1, words.length);
    for (let w = 1; w <= words.length && !this.ended; w++) {
      this.emit({ type: "transcript.partial", speaker: st.speaker, turnId, text: words.slice(0, w).join(" "), atMs: this.now() });
      if (st.speaker === "agent") this.syntheticLevel = 0.3 + 0.4 * Math.abs(Math.sin(w * 1.7));
      await this.wait(per);
    }
    if (speech) { await speech.done; this.cancelSpeech = null; }
    this.browserVoiceActive = false; this.syntheticLevel = 0;
    const endMs = this.now();
    this.emit({ type: "transcript.final", speaker: st.speaker, turnId, text: st.text, startMs, endMs });
    this.emit({ type: "speaker.changed", speaker: "none", atMs: endMs });
  }
  private finish(reason: EndReason) { if (this.ended) return; this.ended = true; this.cancelSpeech?.(); this.emit({ type: "session.ended", reason, atMs: this.now() }); }
  async disconnect(reason: EndReason) { if (this.timer) clearTimeout(this.timer); this.finish(reason); }
  setMuted(m: boolean) { this.muted = m; if (m) this.cancelSpeech?.(); }
  interrupt() { if (this.cancelSpeech) { this.cancelSpeech(); this.emit({ type: "overlap.detected", initiator: "agent", startMs: this.now(), durationMs: 400 }); } }
  simulateDisconnect() { this.paused = true; this.cancelSpeech?.(); this.emit({ type: "connection.changed", state: "reconnecting", atMs: this.now(), detail: "Simulated network loss" }); }
  simulateReconnect() { this.emit({ type: "connection.changed", state: "connected", atMs: this.now(), detail: "Reconnected" }); this.paused = false; }
}

type TurnResponse = { turnId: string; text: string; events: ({ tool: "surface_objection"; objectionId: string } | { tool: "resolve_objection"; objectionId: string } | { tool: "record_commitment"; summary: string } | { tool: "end_scenario"; reason: EndReason })[]; interrupt: boolean };

/**
 * Live voice: the browser transcribes the agent, call-lab-turn answers in
 * character, call-lab-tts streams the prospect's voice (browser voice when the
 * quota is spent). Real microphone, real analysers, real barge-in, no lag
 * budget beyond the model and the network.
 */
export class ComposedProvider implements CallProvider {
  readonly kind = "composed" as const;
  inputAnalyser: AnalyserNode | null = null; outputAnalyser: AnalyserNode | null = null; syntheticLevel = 0; browserVoiceActive = false;
  private o: ConnectOptions | null = null; private graph: MicGraph | null = null; private player: StreamPlayer | null = null; private stt: SpeechToText | null = null;
  private ended = false; private muted = false; private seq = 0; private cur: string | null = null; private curStart = 0; private finals: string[] = []; private quiet: number | null = null;
  private prospect: { turnId: string; startMs: number; text: string } | null = null; private cancelSpeech: (() => void) | null = null; private inflight = false; private failures = 0;
  private prewarm: Promise<Response | null> | null = null;
  private emit(ev: CallEvent) { if (!this.ended) this.o?.onEvent(ev); }
  private now() { return Date.now() - (this.o?.startedAt ?? Date.now()); }
  async connect(o: ConnectOptions) {
    this.o = o; this.seq = o.resumeFromTurnCount ?? 0;
    this.emit({ type: "connection.changed", state: "connecting", atMs: this.now() });
    if (!speechRecognitionSupported()) { this.emit({ type: "session.warning", code: "stt_unsupported", recoverable: false, message: "This browser cannot transcribe speech. Use Chrome or Edge, or run the demo.", atMs: this.now() }); this.emit({ type: "connection.changed", state: "failed", atMs: this.now(), detail: "speech recognition unsupported" }); return; }
    if (!o.mediaStream || !o.audioContext) { this.emit({ type: "session.warning", code: "mic_missing", recoverable: true, message: "No microphone. Allow access and retry.", atMs: this.now() }); this.emit({ type: "connection.changed", state: "failed", atMs: this.now(), detail: "microphone missing" }); return; }
    this.graph = createMicGraph(o.mediaStream, o.audioContext); this.inputAnalyser = this.graph.analyser;
    this.player = new StreamPlayer(o.audioContext); this.outputAnalyser = this.player.analyser;
    this.prewarm = this.fetchVoice(o.openingLine); // first audio is ready by the time the line is "answered"
    this.stt = new SpeechToText({
      onPartial: (t) => this.onPartial(t), onFinal: (t) => this.onFinal(t), onSpeechStart: () => this.onSpeechStart(), onSpeechEnd: () => undefined, onListening: () => undefined,
      onError: (code, fatal) => { this.emit({ type: "session.warning", code: `stt_${code}`, recoverable: !fatal, message: fatal ? "Microphone access was lost. Check browser permissions and retry." : `Speech recognition hiccup (${code}); listening again.`, atMs: this.now() }); if (fatal) this.emit({ type: "connection.changed", state: "failed", atMs: this.now(), detail: code }); },
    });
    this.stt.start();
    this.emit({ type: "connection.changed", state: "connected", atMs: this.now(), detail: "Live voice" });
    if (!o.resumeFromTurnCount) await this.speak(o.openingLine, "pt_open", this.prewarm);
  }
  private startAgentTurn() { if (!this.cur) { this.seq += 1; this.cur = `at_${this.seq}`; this.curStart = this.now(); this.emit({ type: "speaker.changed", speaker: "agent", atMs: this.now() }); } }
  private onSpeechStart() { if (this.muted || this.ended) return; if (this.player?.playing || this.cancelSpeech) this.bargeIn(); this.startAgentTurn(); }
  private onPartial(text: string) { if (this.muted || this.ended) return; if (this.player?.playing || this.cancelSpeech) this.bargeIn(); this.startAgentTurn(); this.emit({ type: "transcript.partial", speaker: "agent", turnId: this.cur!, text: [...this.finals, text].join(" ").trim(), atMs: this.now() }); this.arm(); }
  private onFinal(text: string) { if (this.muted || this.ended || !text) return; this.startAgentTurn(); this.finals.push(text); this.emit({ type: "transcript.partial", speaker: "agent", turnId: this.cur!, text: this.finals.join(" "), atMs: this.now() }); this.arm(); }
  /** A turn ends after 650ms without new speech results: fast enough to feel like a conversation, long enough not to cut a breath. */
  private arm() { if (this.quiet) clearTimeout(this.quiet); this.quiet = window.setTimeout(() => this.commit(), 650); }
  private async commit() {
    const turnId = this.cur; const text = this.finals.join(" ").trim(); this.cur = null; this.finals = [];
    if (!turnId || !text || this.ended) return;
    const endMs = this.now();
    this.emit({ type: "transcript.final", speaker: "agent", turnId, text, startMs: this.curStart, endMs });
    this.emit({ type: "speaker.changed", speaker: "none", atMs: endMs });
    await this.ask(turnId, text);
  }
  private async ask(turnId: string, text: string) {
    if (this.inflight || !this.o) return; this.inflight = true;
    let res: TurnResponse | null = null;
    for (let attempt = 0; attempt < 3 && !this.ended; attempt++) {
      try {
        const r = await fetch(`${FUNCTIONS_URL}/call-lab-turn`, { method: "POST", headers: await authHeaders(), body: JSON.stringify({ sessionId: this.o.sessionId, turnId, text, elapsedMs: this.now() }) });
        if (r.status === 409) { this.inflight = false; return; }
        if (!r.ok) throw new Error(`turn ${r.status}`);
        res = (await r.json()) as TurnResponse; break;
      } catch (e) { void e; this.failures += 1; if (attempt === 0) this.emit({ type: "connection.changed", state: "reconnecting", atMs: this.now(), detail: "Prospect unreachable; retrying" }); await new Promise((r) => setTimeout(r, 500 * (attempt + 1))); }
    }
    this.inflight = false;
    if (!res) { this.emit({ type: "connection.changed", state: "failed", atMs: this.now(), detail: "The prospect could not answer after three tries" }); return; }
    if (this.failures) { this.failures = 0; this.emit({ type: "connection.changed", state: "connected", atMs: this.now(), detail: "Reconnected" }); }
    const atMs = this.now();
    for (const ev of res.events) {
      if (ev.tool === "surface_objection") this.emit({ type: "objection.surfaced", objectionId: ev.objectionId, turnId: res.turnId, atMs });
      else if (ev.tool === "resolve_objection") this.emit({ type: "objection.resolved", objectionId: ev.objectionId, turnId, atMs });
      else if (ev.tool === "record_commitment") this.emit({ type: "commitment.recorded", turnId: res.turnId, atMs, summary: ev.summary });
    }
    await this.speak(res.text, res.turnId, this.fetchVoice(res.text));
    const end = res.events.find((e) => e.tool === "end_scenario");
    if (end && end.tool === "end_scenario") { await new Promise((r) => setTimeout(r, 300)); this.finish(end.reason); }
  }
  private async fetchVoice(text: string): Promise<Response | null> {
    if (!this.o) return null;
    try { const r = await fetch(`${FUNCTIONS_URL}/call-lab-tts`, { method: "POST", headers: await authHeaders(), body: JSON.stringify({ sessionId: this.o.sessionId, text, voiceId: this.o.voice.voiceId }) }); return r.status === 200 ? r : null; } catch (e) { void e; return null; }
  }
  private async speak(text: string, turnId: string, voice: Promise<Response | null> | null) {
    if (this.ended || !text) return;
    const startMs = this.now(); this.prospect = { turnId, startMs, text };
    this.emit({ type: "speaker.changed", speaker: "prospect", atMs: startMs });
    this.emit({ type: "transcript.partial", speaker: "prospect", turnId, text, atMs: startMs });
    let spoke = false;
    const r = voice ? await voice : null;
    if (r && this.player && !this.muted && !this.ended) { const out = await this.player.play(r); spoke = out !== "failed"; }
    if (!spoke && !this.ended && !this.muted) { this.browserVoiceActive = true; const s = speakWithBrowser(text, { pitchHint: this.o?.voice.pitchHint, onProgress: (p) => { this.syntheticLevel = 0.3 + 0.5 * Math.abs(Math.sin(p * Math.PI * 7)); } }); this.cancelSpeech = s.cancel; await s.done; this.cancelSpeech = null; this.browserVoiceActive = false; this.syntheticLevel = 0; }
    if (this.prospect?.turnId === turnId) this.finalizeProspect();
  }
  private finalizeProspect() { const t = this.prospect; if (!t) return; this.prospect = null; const endMs = this.now(); this.emit({ type: "transcript.final", speaker: "prospect", turnId: t.turnId, text: t.text, startMs: t.startMs, endMs }); this.emit({ type: "speaker.changed", speaker: "none", atMs: endMs }); }
  private bargeIn() { const start = this.now(); this.player?.stop(); this.cancelSpeech?.(); this.cancelSpeech = null; this.browserVoiceActive = false; this.syntheticLevel = 0; this.emit({ type: "overlap.detected", initiator: "agent", startMs: start, durationMs: 300 }); this.finalizeProspect(); }
  private finish(reason: EndReason) { if (this.ended) return; this.emit({ type: "session.ended", reason, atMs: this.now() }); this.ended = true; this.teardown(); }
  private teardown() { if (this.quiet) clearTimeout(this.quiet); this.stt?.stop(); this.stt = null; this.player?.stop(); this.cancelSpeech?.(); this.graph?.dispose(); this.graph = null; this.inputAnalyser = null; this.outputAnalyser = null; }
  async disconnect(reason: EndReason) { this.finish(reason); }
  setMuted(m: boolean) { this.muted = m; for (const t of this.o?.mediaStream?.getAudioTracks() ?? []) t.enabled = !m; if (m) { if (this.quiet) clearTimeout(this.quiet); this.cur = null; this.finals = []; } }
  interrupt() { this.bargeIn(); }
  simulateDisconnect() { this.emit({ type: "connection.changed", state: "reconnecting", atMs: this.now(), detail: "Simulated network loss" }); }
  simulateReconnect() { this.emit({ type: "connection.changed", state: "connected", atMs: this.now(), detail: "Reconnected" }); }
}
