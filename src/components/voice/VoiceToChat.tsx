// APEX voice-to-chat.
// Floating mic button (bottom-right). Tap once → start browser-native
// speech recognition with live transcript modal. Tap stop or 2s silence
// → emits `apex:voice-prompt` CustomEvent on window with { transcript }.
// CommandPalette listens and opens with the transcript pre-filled so
// Sam can edit + submit, or jump directly to whatever route matches.

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, MicOff, X, Send, Copy } from "lucide-react";
import { toast } from "sonner";

type SR = {
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
  continuous: boolean;
  interimResults: boolean;
  lang: string;
};

function getSR(): SR | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    (window as any).SpeechRecognition ??
    (window as any).webkitSpeechRecognition;
  if (!Ctor) return null;
  return new Ctor();
}

export function VoiceToChat() {
  const [open, setOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [supported, setSupported] = useState(true);
  const srRef = useRef<SR | null>(null);
  const silenceTimer = useRef<number | null>(null);

  useEffect(() => {
    setSupported(!!getSR());
  }, []);

  const stop = useCallback(() => {
    if (silenceTimer.current) {
      window.clearTimeout(silenceTimer.current);
      silenceTimer.current = null;
    }
    srRef.current?.stop();
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const sr = getSR();
    if (!sr) {
      toast.error("Voice input isn't supported in this browser. Try Chrome, Edge, or Safari.");
      return;
    }
    sr.continuous = true;
    sr.interimResults = true;
    sr.lang = "en-US";
    setTranscript("");
    setInterim("");

    sr.onresult = (ev: any) => {
      let interimText = "";
      let finalText = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const text = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) finalText += text;
        else interimText += text;
      }
      if (finalText) {
        setTranscript((prev) => (prev ? prev + " " : "") + finalText.trim());
        setInterim("");
      } else {
        setInterim(interimText);
      }
      // Reset silence timer — 2s of no sound auto-stops.
      if (silenceTimer.current) window.clearTimeout(silenceTimer.current);
      silenceTimer.current = window.setTimeout(() => stop(), 2000);
    };
    sr.onerror = (ev: any) => {
      console.warn("[voice] recognition error:", ev.error);
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
        toast.error("Mic permission denied. Enable it in browser settings.");
      }
      setListening(false);
    };
    sr.onend = () => {
      setListening(false);
      if (silenceTimer.current) {
        window.clearTimeout(silenceTimer.current);
        silenceTimer.current = null;
      }
    };

    srRef.current = sr;
    setListening(true);
    sr.start();
  }, [stop]);

  const send = useCallback(() => {
    const text = transcript.trim();
    if (!text) return;
    window.dispatchEvent(new CustomEvent("apex:voice-prompt", { detail: { transcript: text } }));
    setOpen(false);
    setTranscript("");
    setInterim("");
    toast.success("Sent to command palette");
  }, [transcript]);

  const copy = useCallback(async () => {
    if (!transcript) return;
    try {
      await navigator.clipboard.writeText(transcript);
      toast.success("Copied — paste anywhere");
    } catch {
      toast.error("Copy failed");
    }
  }, [transcript]);

  useEffect(() => {
    return () => { srRef.current?.abort(); };
  }, []);

  const full = (transcript + " " + interim).trim();

  return (
    <>
      {/* Floating mic button */}
      <motion.button
        onClick={() => { setOpen(true); if (!listening) start(); }}
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 220, damping: 18, delay: 0.3 }}
        whileHover={{ scale: 1.06 }}
        whileTap={{ scale: 0.94 }}
        className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 flex items-center justify-center"
        aria-label="Voice to chat"
      >
        <Mic className="w-6 h-6" />
        <motion.span
          className="absolute inset-0 rounded-full border-2 border-primary pointer-events-none"
          animate={{ scale: [1, 1.4], opacity: [0.6, 0] }}
          transition={{ duration: 1.8, repeat: Infinity }}
        />
      </motion.button>

      {/* Modal */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end md:items-center justify-center px-4 pb-6 md:pb-0"
            onClick={() => { stop(); setOpen(false); }}
          >
            <motion.div
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 40, opacity: 0 }}
              transition={{ type: "spring", stiffness: 220, damping: 22 }}
              className="w-full max-w-md bg-background rounded-2xl shadow-2xl border border-border overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-border">
                <div className="flex items-center gap-2">
                  <div className="relative w-8 h-8 rounded-full bg-primary/15 text-primary flex items-center justify-center">
                    {listening ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
                    {listening && (
                      <motion.span
                        className="absolute inset-0 rounded-full border-2 border-primary"
                        animate={{ scale: [1, 1.5], opacity: [0.8, 0] }}
                        transition={{ duration: 1.2, repeat: Infinity }}
                      />
                    )}
                  </div>
                  <div>
                    <div className="text-sm font-semibold">
                      {listening ? "Listening…" : transcript ? "Got it" : "Tap the mic"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {supported ? "2s of silence stops automatically" : "Speech API unsupported in this browser"}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => { stop(); setOpen(false); }}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="px-5 py-4 min-h-[80px] text-[15px] leading-relaxed">
                {full ? (
                  <span>
                    <span className="text-foreground">{transcript}</span>
                    <span className="text-muted-foreground italic"> {interim}</span>
                  </span>
                ) : (
                  <span className="text-muted-foreground text-sm">
                    Say something like <em>"find John Smith"</em>, <em>"show me licensed applicants"</em>, or dictate a note.
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 px-5 pb-4">
                {listening ? (
                  <button
                    onClick={stop}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 bg-foreground text-background rounded-lg py-2 text-sm font-semibold hover:opacity-90 transition"
                  >
                    <MicOff className="w-4 h-4" /> Stop
                  </button>
                ) : (
                  <button
                    onClick={start}
                    disabled={!supported}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 bg-foreground text-background rounded-lg py-2 text-sm font-semibold hover:opacity-90 transition disabled:opacity-40"
                  >
                    <Mic className="w-4 h-4" /> {transcript ? "Continue" : "Record"}
                  </button>
                )}
                <button
                  onClick={copy}
                  disabled={!transcript}
                  className="inline-flex items-center justify-center gap-1.5 border border-border rounded-lg py-2 px-3 text-sm font-medium hover:bg-accent transition disabled:opacity-40"
                  aria-label="Copy transcript"
                >
                  <Copy className="w-4 h-4" />
                </button>
                <button
                  onClick={send}
                  disabled={!transcript}
                  className="inline-flex items-center justify-center gap-1.5 bg-primary text-primary-foreground rounded-lg py-2 px-3 text-sm font-semibold hover:opacity-90 transition disabled:opacity-40"
                  aria-label="Send to command palette"
                >
                  <Send className="w-4 h-4" /> Send
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
