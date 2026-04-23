// APEX voice-to-chat.
// Floating mic button (bottom-right). Tap → live transcript modal with
// browser-native SpeechRecognition. When the user hits Send (or 2s of
// silence auto-stops), the transcript becomes a chat turn sent to the
// `ai-assistant` edge function; the reply streams back into the same panel.
//
// Two exit paths from the modal:
//   1. Send → appends to chat, calls ai-assistant (primary)
//   2. "Jump" button → dispatches `apex:voice-prompt` so CommandPalette
//      can pre-fill and navigate (fallback for quick nav)

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, MicOff, X, Send, Copy, Sparkles, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

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

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [thinking, setThinking] = useState(false);
  const srRef = useRef<SR | null>(null);
  const silenceTimer = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSupported(!!getSR());
  }, []);

  // Auto-scroll chat to newest message
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, thinking]);

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

  const send = useCallback(async () => {
    const text = transcript.trim();
    if (!text || thinking) return;

    // Append user turn + clear input immediately
    const userTurn: ChatMessage = { role: "user", content: text };
    const next = [...messages, userTurn];
    setMessages(next);
    setTranscript("");
    setInterim("");
    stop();
    setThinking(true);

    try {
      const { data, error } = await supabase.functions.invoke("ai-assistant", {
        body: { type: "chat", messages: next },
      });
      if (error) throw error;
      const reply: string = data?.content ?? data?.message ?? "(no response)";
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch (e: any) {
      console.error("[voice] ai-assistant error:", e);
      toast.error("AI didn't answer — try again or use the Jump button.");
      setMessages((prev) => [...prev, { role: "assistant", content: "Sorry — I couldn't reach the AI. Try again?" }]);
    } finally {
      setThinking(false);
    }
  }, [transcript, messages, thinking, stop]);

  const jump = useCallback(() => {
    const text = transcript.trim();
    if (!text) return;
    window.dispatchEvent(new CustomEvent("apex:voice-prompt", { detail: { transcript: text } }));
    setOpen(false);
    setTranscript("");
    setInterim("");
    stop();
    toast.success("Opened in command palette");
  }, [transcript, stop]);

  const copy = useCallback(async () => {
    if (!transcript) return;
    try {
      await navigator.clipboard.writeText(transcript);
      toast.success("Copied");
    } catch {
      toast.error("Copy failed");
    }
  }, [transcript]);

  const resetChat = useCallback(() => {
    setMessages([]);
    setTranscript("");
    setInterim("");
    stop();
  }, [stop]);

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
              className="w-full max-w-lg bg-background rounded-2xl shadow-2xl border border-border overflow-hidden flex flex-col"
              style={{ maxHeight: "min(80vh, 640px)" }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-border">
                <div className="flex items-center gap-2">
                  <div className="relative w-8 h-8 rounded-full bg-primary/15 text-primary flex items-center justify-center">
                    {listening ? <Mic className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
                    {listening && (
                      <motion.span
                        className="absolute inset-0 rounded-full border-2 border-primary"
                        animate={{ scale: [1, 1.5], opacity: [0.8, 0] }}
                        transition={{ duration: 1.2, repeat: Infinity }}
                      />
                    )}
                  </div>
                  <div>
                    <div className="text-sm font-semibold">APEX Voice Chat</div>
                    <div className="text-xs text-muted-foreground">
                      {listening ? "Listening…" : thinking ? "Thinking…" : supported ? "Talk. I'll answer." : "Speech API unsupported"}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {messages.length > 0 && (
                    <button
                      onClick={resetChat}
                      className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded-md hover:bg-accent transition-colors"
                      title="Start a new conversation"
                    >
                      Clear
                    </button>
                  )}
                  <button
                    onClick={() => { stop(); setOpen(false); }}
                    className="text-muted-foreground hover:text-foreground transition-colors ml-1"
                    aria-label="Close"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Chat history */}
              <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto px-5 py-3 space-y-3 min-h-[120px]"
              >
                {messages.length === 0 && !full && (
                  <div className="text-sm text-muted-foreground py-4">
                    Tap the mic and ask anything — "who's stuck in onboarding this week?",
                    "summarize today's production", "draft a follow-up for John Smith"…
                  </div>
                )}
                {messages.map((m, i) => (
                  <div
                    key={i}
                    className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-xl px-3 py-2 text-[14px] leading-relaxed whitespace-pre-wrap ${
                        m.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-foreground"
                      }`}
                    >
                      {m.content}
                    </div>
                  </div>
                ))}
                {thinking && (
                  <div className="flex justify-start">
                    <div className="bg-muted text-muted-foreground rounded-xl px-3 py-2 text-[13px] italic">
                      …
                    </div>
                  </div>
                )}
              </div>

              {/* Live transcript preview */}
              {full && (
                <div className="px-5 py-2 border-t border-border bg-muted/40">
                  <div className="text-[13px] leading-relaxed">
                    <span className="text-foreground">{transcript}</span>
                    <span className="text-muted-foreground italic"> {interim}</span>
                  </div>
                </div>
              )}

              {/* Footer controls */}
              <div className="flex items-center gap-2 px-5 py-3 border-t border-border bg-background">
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
                    disabled={!supported || thinking}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 bg-foreground text-background rounded-lg py-2 text-sm font-semibold hover:opacity-90 transition disabled:opacity-40"
                  >
                    <Mic className="w-4 h-4" /> {transcript ? "Continue" : "Record"}
                  </button>
                )}
                <button
                  onClick={jump}
                  disabled={!transcript || thinking}
                  className="inline-flex items-center justify-center gap-1.5 border border-border rounded-lg py-2 px-3 text-sm font-medium hover:bg-accent transition disabled:opacity-40"
                  aria-label="Open in command palette"
                  title="Open in command palette"
                >
                  <ArrowRight className="w-4 h-4" />
                </button>
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
                  disabled={!transcript || thinking}
                  className="inline-flex items-center justify-center gap-1.5 bg-primary text-primary-foreground rounded-lg py-2 px-3 text-sm font-semibold hover:opacity-90 transition disabled:opacity-40"
                  aria-label="Send to AI chat"
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
