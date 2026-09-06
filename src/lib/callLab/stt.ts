/** Thin wrapper over the browser SpeechRecognition API (Chromium). Continuous, interim results, auto-restart. */

type SR = { continuous: boolean; interimResults: boolean; lang: string; start(): void; stop(): void; abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string; confidence: number } }> }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null; onspeechstart: (() => void) | null; onspeechend: (() => void) | null; onstart: (() => void) | null; };

export function speechRecognitionSupported(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
}

export type SttHandlers = {
  onPartial: (text: string) => void;
  onFinal: (text: string, confidence: number) => void;
  onSpeechStart: () => void;
  onSpeechEnd: () => void;
  onError: (code: string, fatal: boolean) => void;
  onListening: (listening: boolean) => void;
};

export class SpeechToText {
  private rec: SR | null = null;
  private active = false;
  private restartTimer: number | null = null;
  constructor(private handlers: SttHandlers) {}

  start() {
    if (!speechRecognitionSupported()) { this.handlers.onError("unsupported", true); return; }
    this.active = true;
    this.spawn();
  }
  private spawn() {
    const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
    const Ctor = (w.SpeechRecognition ?? w.webkitSpeechRecognition)!;
    const r = new Ctor();
    r.continuous = true; r.interimResults = true; r.lang = "en-US";
    r.onstart = () => this.handlers.onListening(true);
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) this.handlers.onFinal(res[0].transcript.trim(), res[0].confidence);
        else interim += res[0].transcript;
      }
      if (interim.trim()) this.handlers.onPartial(interim.trim());
    };
    r.onspeechstart = () => this.handlers.onSpeechStart();
    r.onspeechend = () => this.handlers.onSpeechEnd();
    r.onerror = (e) => {
      const fatal = e.error === "not-allowed" || e.error === "service-not-allowed" || e.error === "audio-capture";
      if (e.error === "no-speech" || e.error === "aborted") return; // routine: restart on end
      this.handlers.onError(e.error, fatal);
      if (fatal) this.active = false;
    };
    r.onend = () => {
      this.handlers.onListening(false);
      if (this.active) this.restartTimer = window.setTimeout(() => { if (this.active) this.spawn(); }, 250);
    };
    this.rec = r;
    try { r.start(); } catch { /* empty-catch-allow:start-throws-if-already-started-the-onend (start() throws if already started; the onend cycle recovers) */ }
  }
  stop() {
    this.active = false;
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null; }
    try { this.rec?.stop(); } catch { /* empty-catch-allow:stop-on-a-recognizer-that-never-started (stop() on a recognizer that never started throws; nothing to recover) */ }
    this.rec = null;
  }
}
