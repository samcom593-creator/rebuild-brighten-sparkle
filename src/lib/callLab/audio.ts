/** Browser audio for Call Lab: microphone graph, level sampling, low-latency streamed playback, browser voice. */

export type MicGraph = { context: AudioContext; source: MediaStreamAudioSourceNode; analyser: AnalyserNode; dispose: () => void };

export function createMicGraph(stream: MediaStream, context?: AudioContext): MicGraph {
  const ctx = context ?? new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser(); analyser.fftSize = 1024; analyser.smoothingTimeConstant = 0.6;
  source.connect(analyser);
  return { context: ctx, source, analyser, dispose: () => { try { source.disconnect(); } catch (e) { void e; } } };
}

const buf = new Float32Array(1024);
export function sampleLevel(analyser: AnalyserNode | null): { level: number; clipped: boolean } {
  if (!analyser) return { level: 0, clipped: false };
  analyser.getFloatTimeDomainData(buf);
  let sum = 0, peak = 0;
  for (let i = 0; i < buf.length; i++) { const v = buf[i]; sum += v * v; if (Math.abs(v) > peak) peak = Math.abs(v); }
  return { level: Math.min(1, Math.sqrt(sum / buf.length) * 4.5), clipped: peak >= 0.98 };
}

export class LevelAggregator {
  private n = 0; private sum = 0; private sumSq = 0; private peak = 0; private clipped = 0; private silent = 0;
  add(level: number, clipped: boolean) { this.n++; this.sum += level; this.sumSq += level * level; if (level > this.peak) this.peak = level; if (clipped) this.clipped++; if (level < 0.02) this.silent++; }
  get samples() { return this.n; }
  snapshot() {
    const mean = this.n ? this.sum / this.n : 0; const variance = this.n ? Math.max(0, this.sumSq / this.n - mean * mean) : 0;
    const qualityConfidence = this.n < 200 ? "insufficient_evidence" : this.clipped / this.n > 0.05 || this.silent / this.n > 0.9 ? "low" : this.clipped / this.n > 0.01 ? "medium" : "high";
    const r = (x: number) => Math.round(x * 1000) / 1000;
    return { meanLevel: r(mean), peakLevel: r(this.peak), clippedFrames: this.clipped, silentFrames: this.silent, levelStdDev: r(Math.sqrt(variance)), qualityConfidence };
  }
}

/**
 * Streams MP3 into an <audio> element through MediaSource so the prospect
 * starts talking on the first chunk, not after the whole line downloads. The
 * element is routed through an analyser so the signal core sees real output.
 * Falls back to decode-and-play when MediaSource cannot take audio/mpeg.
 */
export class StreamPlayer {
  readonly analyser: AnalyserNode;
  private el: HTMLAudioElement;
  private abort: AbortController | null = null;
  private busy = false;
  constructor(readonly context: AudioContext) {
    this.el = new Audio(); this.el.crossOrigin = "anonymous"; this.el.preload = "auto";
    const src = context.createMediaElementSource(this.el);
    this.analyser = context.createAnalyser(); this.analyser.fftSize = 1024; this.analyser.smoothingTimeConstant = 0.6;
    src.connect(this.analyser); this.analyser.connect(context.destination);
  }
  get playing() { return this.busy; }
  /** Plays a streamed response. Resolves when playback ends or is interrupted. */
  async play(response: Response): Promise<"ended" | "interrupted" | "failed"> {
    this.stop();
    const ac = new AbortController(); this.abort = ac; this.busy = true;
    if (this.context.state === "suspended") await this.context.resume().catch(() => undefined); // empty-catch-allow:a-refused-resume-falls-through-to-the (a refused resume falls through to the browser voice below)
    const canStream = typeof MediaSource !== "undefined" && MediaSource.isTypeSupported("audio/mpeg") && Boolean(response.body);
    try {
      if (!canStream) {
        const blob = await response.blob(); if (ac.signal.aborted) return "interrupted";
        this.el.src = URL.createObjectURL(blob);
      } else {
        const ms = new MediaSource(); this.el.src = URL.createObjectURL(ms);
        await new Promise<void>((resolve) => ms.addEventListener("sourceopen", () => resolve(), { once: true }));
        const sb = ms.addSourceBuffer("audio/mpeg");
        const reader = response.body!.getReader();
        const pump = async () => {
          while (!ac.signal.aborted) {
            const { value, done } = await reader.read();
            if (done) break;
            await new Promise<void>((resolve) => { if (!sb.updating) { sb.appendBuffer(value); } else { sb.addEventListener("updateend", () => { sb.appendBuffer(value); }, { once: true }); } sb.addEventListener("updateend", () => resolve(), { once: true }); });
          }
          if (!ac.signal.aborted && ms.readyState === "open") { if (sb.updating) await new Promise<void>((r) => sb.addEventListener("updateend", () => r(), { once: true })); try { ms.endOfStream(); } catch (e) { void e; } }
        };
        void pump().catch(() => undefined); // empty-catch-allow:a-midstream-read-error-ends-playback-the (a mid-stream read error ends playback; the play() promise reports it as failed)
      }
      await this.el.play();
      return await new Promise((resolve) => {
        const done = () => { cleanup(); resolve(ac.signal.aborted ? "interrupted" : "ended"); };
        const fail = () => { cleanup(); resolve(ac.signal.aborted ? "interrupted" : "failed"); };
        const cleanup = () => { this.el.removeEventListener("ended", done); this.el.removeEventListener("error", fail); ac.signal.removeEventListener("abort", done); this.busy = false; };
        this.el.addEventListener("ended", done); this.el.addEventListener("error", fail); ac.signal.addEventListener("abort", done);
      });
    } catch (e) { void e; this.busy = false; return ac.signal.aborted ? "interrupted" : "failed"; }
  }
  stop() { if (this.abort) { this.abort.abort(); this.abort = null; } try { this.el.pause(); this.el.removeAttribute("src"); this.el.load(); } catch (e) { void e; } this.busy = false; }
}

export function speakWithBrowser(text: string, opts: { pitchHint?: "low" | "mid" | "high"; onProgress?: (p: number) => void }): { done: Promise<"ended" | "cancelled">; cancel: () => void } {
  if (typeof speechSynthesis === "undefined") return { done: Promise.resolve("ended"), cancel: () => undefined };
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 0.98; u.pitch = opts.pitchHint === "low" ? 0.8 : opts.pitchHint === "high" ? 1.15 : 1;
  const voices = speechSynthesis.getVoices();
  const pref = voices.find((v) => /en[-_]US/i.test(v.lang) && /(Alex|Daniel|Samantha|Aaron|Google US English)/i.test(v.name)) ?? voices.find((v) => /en/i.test(v.lang));
  if (pref) u.voice = pref;
  let cancelled = false;
  const done = new Promise<"ended" | "cancelled">((resolve) => {
    u.onboundary = (e) => { if (text.length) opts.onProgress?.(Math.min(1, e.charIndex / text.length)); };
    u.onend = () => resolve(cancelled ? "cancelled" : "ended"); u.onerror = () => resolve(cancelled ? "cancelled" : "ended");
  });
  speechSynthesis.cancel(); speechSynthesis.speak(u);
  return { done, cancel: () => { cancelled = true; speechSynthesis.cancel(); } };
}
