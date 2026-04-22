import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Copy, Trash2, Check } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type SpeechRecognitionCtor = new () => any;
declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  }
}

export default function VoiceNote() {
  const [supported, setSupported] = useState(true);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [finalText, setFinalText] = useState("");
  const [copied, setCopied] = useState(false);
  const recogRef = useRef<any>(null);

  useEffect(() => {
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) { setSupported(false); return; }
    const r = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = "en-US";
    r.onresult = (ev: any) => {
      let interimPart = "";
      let finalPart = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const t = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) finalPart += t + " ";
        else interimPart += t;
      }
      if (finalPart) setFinalText(prev => (prev + finalPart).replace(/\s+/g, " ").trim() + " ");
      setInterim(interimPart);
    };
    r.onend = () => setListening(false);
    r.onerror = (ev: any) => {
      if (ev.error && ev.error !== "no-speech" && ev.error !== "aborted") {
        toast.error(`Mic error: ${ev.error}`);
      }
      setListening(false);
    };
    recogRef.current = r;
    return () => { try { r.stop(); } catch {} };
  }, []);

  const start = () => {
    if (!recogRef.current) return;
    try {
      recogRef.current.start();
      setListening(true);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not start mic");
    }
  };
  const stop = () => {
    try { recogRef.current?.stop(); } catch {}
    setListening(false);
  };
  const toggle = () => (listening ? stop() : start());
  const clear = () => { setFinalText(""); setInterim(""); };
  const copy = async () => {
    const text = (finalText + interim).trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Clipboard blocked — select + copy manually");
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <div className={cn(
          "h-12 w-12 rounded-2xl flex items-center justify-center transition-all",
          listening
            ? "bg-gradient-to-br from-rose-500/40 to-pink-500/30 animate-pulse"
            : "bg-gradient-to-br from-primary/30 to-violet-500/20"
        )}>
          {listening ? <Mic className="h-6 w-6 text-rose-300" /> : <MicOff className="h-6 w-6 text-primary" />}
        </div>
        <div>
          <h1 className="apex-headline text-3xl font-bold">Voice Note</h1>
          <p className="text-sm text-muted-foreground">
            Free browser dictation — no API keys, runs locally. Copy → paste into Claude or anywhere.
          </p>
        </div>
      </div>

      {!supported && (
        <GlassCard className="p-4 border border-rose-500/40 bg-rose-500/10">
          <div className="text-sm text-rose-200">
            Your browser doesn't support SpeechRecognition. Use Chrome, Edge, or Safari.
          </div>
        </GlassCard>
      )}

      <GlassCard className="p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={toggle}
            disabled={!supported}
            size="lg"
            className={cn(
              "min-w-[140px]",
              listening && "bg-rose-500 hover:bg-rose-600"
            )}
          >
            {listening
              ? <><MicOff className="h-4 w-4 mr-2" /> Stop</>
              : <><Mic   className="h-4 w-4 mr-2" /> Start</>}
          </Button>
          <Button variant="outline" size="sm" onClick={copy} disabled={!finalText && !interim}>
            {copied ? <Check className="h-3.5 w-3.5 mr-1.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5 mr-1.5" />}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button variant="outline" size="sm" onClick={clear} disabled={!finalText && !interim}>
            <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Clear
          </Button>
          {listening && (
            <Badge variant="outline" className="ml-2 border-rose-400 text-rose-300">
              <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-rose-400 animate-pulse" />
              Listening
            </Badge>
          )}
        </div>

        <Textarea
          value={finalText + interim}
          onChange={e => setFinalText(e.target.value)}
          rows={14}
          className="font-mono text-sm"
          placeholder="Press Start and talk. Transcription appears here in real time. You can also type or edit directly."
        />

        <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
          <span>💡 Allow microphone when prompted</span>
          <span>🔊 Pauses end a sentence</span>
          <span>📋 Copy lands in your clipboard — paste anywhere</span>
        </div>
      </GlassCard>

      <GlassCard className="p-4 space-y-2 text-sm">
        <div className="font-semibold">Fast workflow for giving Claude tasks</div>
        <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
          <li>Press <span className="font-mono text-primary">Start</span> and dictate your task</li>
          <li>Press <span className="font-mono text-primary">Stop</span> when done</li>
          <li>Edit/clean up in the box if you want</li>
          <li>Press <span className="font-mono text-primary">Copy</span> and paste into Claude Code</li>
        </ol>
      </GlassCard>
    </div>
  );
}
