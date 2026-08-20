import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, MicOff, Loader2, ChevronDown, ChevronUp, Sparkles, AlertCircle, Mail, Check, CalendarDays } from "lucide-react";
// Input import removed - no longer needed for calendar link
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { SCHEDULING_LINKS } from "@/lib/apexConfig";

// BUG-1 fix (2026-08-06): pick a MediaRecorder MIME the browser actually
// supports. Chrome/Edge = webm/opus, iOS Safari = mp4. Empty string means
// let the browser pick a default rather than throwing.
const AUDIO_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
];
function pickAudioMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const mime of AUDIO_MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(mime)) return mime;
    } catch { /* empty-catch-allow:isTypeSupported-throws-on-old-safari */ }
  }
  return "";
}

interface CallSummary {
  keyPoints: string[];
  sentiment: "positive" | "neutral" | "negative";
  actionItems: string[];
  recommendation: string;
  briefSummary: string;
}

const LICENSED_FOLLOW_UP_URL = SCHEDULING_LINKS.licensed;
const UNLICENSED_FOLLOW_UP_URL = "https://apex-financial.org/get-licensed";

interface CallCenterVoiceRecorderProps {
  onTranscriptionUpdate: (text: string) => void;
  onRecordingStateChange?: (isRecording: boolean) => void;
  onSummaryComplete?: (summary: CallSummary) => void;
  onSendFollowUp?: (calendarLink?: string) => Promise<void>;
  className?: string;
}

export function CallCenterVoiceRecorder({
  onTranscriptionUpdate,
  onRecordingStateChange,
  onSummaryComplete,
  onSendFollowUp,
  className,
}: CallCenterVoiceRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  // BUG-1: split the two capabilities. MediaRecorder works on iOS Safari,
  // SpeechRecognition doesn't. Old code hid the record button on iOS.
  const [isMediaRecorderAvailable, setIsMediaRecorderAvailable] = useState(true);
  const [isSpeechAvailable, setIsSpeechAvailable] = useState(true);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [callSummary, setCallSummary] = useState<CallSummary | null>(null);
  const [showFullTranscript, setShowFullTranscript] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [sendingFollowUp, setSendingFollowUp] = useState(false);
  const [followUpSent, setFollowUpSent] = useState<"licensed" | "unlicensed" | false>(false);
  const [duration, setDuration] = useState(0);
  const [audioStoragePath, setAudioStoragePath] = useState<string | null>(null);
  const [isUploadingAudio, setIsUploadingAudio] = useState(false);

  const recognitionRef = useRef<any>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    // BUG-1: probe both APIs independently.
    if (typeof MediaRecorder === "undefined") {
      console.warn("[CallCenterVoiceRecorder] MediaRecorder unavailable in this browser");
      setIsMediaRecorderAvailable(false);
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn("[CallCenterVoiceRecorder] SpeechRecognition unavailable — audio still records, transcript disabled");
      setIsSpeechAvailable(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: any) => {
      let finalText = "";
      let interimText = "";

      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalText += result[0].transcript + " ";
        } else {
          interimText += result[0].transcript;
        }
      }

      if (finalText) {
        setTranscript((prev) => {
          const newTranscript = prev + finalText;
          onTranscriptionUpdate(newTranscript);
          return newTranscript;
        });
      }
      setInterimTranscript(interimText);
    };

    recognition.onerror = (event: any) => {
      console.error("[CallCenterVoiceRecorder] SpeechRecognition error:", event.error);
      if (event.error === "not-allowed") {
        setIsSpeechAvailable(false);
        toast.error("Microphone permission denied. Enable it in browser settings and reload.");
      } else if (event.error === "no-speech") {
        // benign; keep going
      } else {
        toast.error(`Speech recognition error: ${event.error}`);
      }
    };

    recognition.onend = () => {
      if (isRecording) {
        try {
          recognition.start();
        } catch (e) { // empty-catch-allow:media-api-optional
          /* recognition start failed · swallow */
        }
      }
    };

    recognitionRef.current = recognition;

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
      if (timerRef.current) clearInterval(timerRef.current);
      try { mediaRecorderRef.current?.stop(); } catch { /* MediaRecorder unavailable */ } // empty-catch-allow:media-api-optional
    };
  }, []);

  const drawWaveform = useCallback(() => {
    if (!canvasRef.current || !analyserRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const analyser = analyserRef.current;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      if (!isRecording) return;

      animationRef.current = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(dataArray);

      ctx.fillStyle = "rgba(0, 0, 0, 0)";
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      ctx.lineWidth = 2;
      const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
      // 2026-08-06: twin of InterviewRecorder — emerald→teal→emerald replaced
      // with the literal --primary gold ramp (canvas can't read CSS vars).
      gradient.addColorStop(0, "hsl(45, 85%, 45%)");
      gradient.addColorStop(0.5, "hsl(45, 90%, 62%)");
      gradient.addColorStop(1, "hsl(45, 85%, 45%)");
      ctx.strokeStyle = gradient;

      ctx.beginPath();

      const sliceWidth = canvas.width / bufferLength;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * canvas.height) / 2;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }

        x += sliceWidth;
      }

      ctx.lineTo(canvas.width, canvas.height / 2);
      ctx.stroke();
    };

    draw();
  }, [isRecording]);

  const analyzeTranscript = async (fullTranscript: string) => {
    if (!fullTranscript.trim() || fullTranscript.length < 20) {
      setAnalyzeError("Transcript too short to analyze");
      return;
    }

    setIsAnalyzing(true);
    setAnalyzeError(null);

    try {
      const { data, error } = await supabase.functions.invoke("analyze-call-transcript", {
        body: { transcript: fullTranscript },
      });

      if (error) {
        console.error("Error analyzing transcript:", error);
        setAnalyzeError(error.message || "Failed to analyze call");
        return;
      }

      if (data?.summary) {
        setCallSummary(data.summary);
        onSummaryComplete?.(data.summary);
      } else if (data?.error) {
        setAnalyzeError(data.error);
      }
    } catch (err) {
      console.error("Failed to analyze transcript:", err);
      setAnalyzeError("Connection error. Please try again.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const uploadAudioBlob = useCallback(async (blob: Blob, mime: string) => {
    if (!blob || blob.size === 0) {
      console.warn("[CallCenterVoiceRecorder] blob empty — nothing to upload");
      return;
    }
    const ext = mime.includes("mp4") ? "m4a" : mime.includes("mpeg") ? "mp3" : "webm";
    const uid = (typeof crypto !== "undefined" && "randomUUID" in crypto)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    // callcenter/YYYY-MM-DD/timestamp-uuid.ext — bucket-listable per day.
    const day = stamp.slice(0, 10);
    const path = `callcenter/${day}/${stamp}-${uid}.${ext}`;
    if (import.meta.env.DEV) console.log(`[CallCenterVoiceRecorder] uploading ${blob.size}b (${mime}) → call-recordings/${path}`);
    setIsUploadingAudio(true);
    try {
      const { error } = await supabase.storage.from("call-recordings").upload(path, blob, {
        contentType: mime || "application/octet-stream",
        upsert: false,
      });
      if (error) {
        console.error("[CallCenterVoiceRecorder] upload failed:", error);
        toast.error(`Audio upload failed: ${error.message}`);
        return;
      }
      setAudioStoragePath(path);
      if (import.meta.env.DEV) console.log(`[CallCenterVoiceRecorder] upload OK → ${path}`);
      toast.success(`Audio saved (${(blob.size / 1024).toFixed(0)} KB) → ${path}`);
    } catch (e: any) {
      console.error("[CallCenterVoiceRecorder] upload threw:", e);
      toast.error(`Audio upload error: ${e?.message ?? "unknown"}`);
    } finally {
      setIsUploadingAudio(false);
    }
  }, []);

  const startRecording = async () => {
    if (import.meta.env.DEV) console.log("[CallCenterVoiceRecorder] startRecording() invoked");
    try {
      // Reset previous summary and transcript
      setCallSummary(null);
      setTranscript("");
      setInterimTranscript("");
      setAnalyzeError(null);
      setShowFullTranscript(false);
      setDuration(0);
      setAudioStoragePath(null);
      audioChunksRef.current = [];

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (mediaErr: any) {
        console.error("[CallCenterVoiceRecorder] getUserMedia failed:", mediaErr);
        const name = mediaErr?.name || "";
        if (name === "NotAllowedError" || name === "SecurityError") {
          toast.error("Microphone blocked. Allow mic access in your browser and try again.");
        } else if (name === "NotFoundError" || name === "OverconstrainedError") {
          toast.error("No microphone found. Plug one in and reload.");
        } else if (name === "NotReadableError") {
          toast.error("Microphone is in use by another app. Close it and try again.");
        } else {
          toast.error(`Cannot start recording: ${mediaErr?.message ?? name ?? "unknown error"}`);
        }
        return;
      }
      if (import.meta.env.DEV) console.log("[CallCenterVoiceRecorder] getUserMedia resolved");
      streamRef.current = stream;

      try {
        audioContextRef.current = new AudioContext();
        const source = audioContextRef.current.createMediaStreamSource(stream);
        const analyser = audioContextRef.current.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        analyserRef.current = analyser;
      } catch (audioCtxErr) {
        console.warn("[CallCenterVoiceRecorder] AudioContext setup failed:", audioCtxErr);
      }

      // BUG-1: wire MediaRecorder alongside the transcript so audio is captured.
      if (typeof MediaRecorder !== "undefined") {
        const mime = pickAudioMime();
        try {
          const mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
          const effectiveMime = mime || mr.mimeType || "audio/webm";
          if (import.meta.env.DEV) console.log(`[CallCenterVoiceRecorder] MediaRecorder mime=${effectiveMime}`);
          mr.ondataavailable = (evt) => {
            if (evt.data && evt.data.size > 0) {
              audioChunksRef.current.push(evt.data);
              if (import.meta.env.DEV) console.log(`[CallCenterVoiceRecorder] chunk +${evt.data.size}b (total ${audioChunksRef.current.length})`);
            }
          };
          mr.onerror = (evt: any) => {
            console.error("[CallCenterVoiceRecorder] MediaRecorder error:", evt);
            toast.error(`Recorder error: ${evt?.error?.message ?? "unknown"}`);
          };
          mr.onstop = async () => {
            const blob = new Blob(audioChunksRef.current, { type: effectiveMime });
            if (import.meta.env.DEV) console.log(`[CallCenterVoiceRecorder] recorder stopped, blob=${blob.size}b`);
            await uploadAudioBlob(blob, effectiveMime);
          };
          mr.start(1000);
          mediaRecorderRef.current = mr;
        } catch (mrErr: any) {
          console.error("[CallCenterVoiceRecorder] MediaRecorder construction failed:", mrErr);
          toast.error(`Audio capture disabled: ${mrErr?.message ?? "MediaRecorder error"}`);
        }
      } else {
        toast.warning("This browser cannot capture audio blobs.");
      }

      if (isSpeechAvailable) {
        try { recognitionRef.current?.start(); } catch (recErr) { console.warn("[CallCenterVoiceRecorder] recognition start failed:", recErr); }
      }
      setIsRecording(true);
      onRecordingStateChange?.(true);
      timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
      drawWaveform();
      toast.success(isSpeechAvailable ? "Recording started" : "Recording (audio only — transcript not supported)");
    } catch (outer: any) {
      console.error("[CallCenterVoiceRecorder] startRecording outer failure:", outer);
      toast.error(`Failed to start recording: ${outer?.message ?? "unknown"}`);
    }
  };

  const stopRecording = () => {
    if (import.meta.env.DEV) console.log("[CallCenterVoiceRecorder] stopRecording() invoked");
    const fullTranscript = transcript + interimTranscript;

    try { recognitionRef.current?.stop(); } catch (e) { console.warn("[CallCenterVoiceRecorder] recognition stop failed:", e); }
    try { mediaRecorderRef.current?.stop(); } catch (e) { console.warn("[CallCenterVoiceRecorder] recorder stop failed:", e); }
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
    }
    if (audioContextRef.current) {
      try { audioContextRef.current.close(); } catch { /* AudioContext close failed */ } // empty-catch-allow:media-api-optional
    }
    if (timerRef.current) clearInterval(timerRef.current);

    setIsRecording(false);
    onRecordingStateChange?.(false);
    setInterimTranscript("");

    // Update final transcript
    if (interimTranscript) {
      const finalTranscript = transcript + interimTranscript;
      setTranscript(finalTranscript);
      onTranscriptionUpdate(finalTranscript);
    }

    // Analyze the transcript
    if (fullTranscript.trim()) {
      analyzeTranscript(fullTranscript);
    }
    toast.success("Recording stopped");
  };

  const formatDuration = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const getSentimentEmoji = (sentiment: string) => {
    switch (sentiment) {
      case "positive": return "😊";
      case "negative": return "😟";
      default: return "😐";
    }
  };

  const getSentimentColor = (sentiment: string) => {
    switch (sentiment) {
      case "positive": return "text-green-400";
      case "negative": return "text-red-400";
      default: return "text-yellow-400";
    }
  };

  // BUG-1: only hide the recorder if the browser can neither transcribe NOR
  // capture audio. iOS Safari falls back to audio-only with a banner.
  if (!isSpeechAvailable && !isMediaRecorderAvailable) {
    return (
      <div className={cn("text-sm text-muted-foreground text-center p-4", className)}>
        Voice recording not supported in this browser. Try Chrome, Edge, or Safari.
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      {/* Recording Button */}
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="lg"
          onClick={toggleRecording}
          disabled={isAnalyzing}
          className={cn(
            "relative overflow-hidden transition-all duration-300",
            isRecording
              ? "border-red-500/50 bg-red-500/10 text-red-400 hover:bg-red-500/20"
              : "border-primary/30 hover:border-primary/50 hover:bg-primary/10"
          )}
        >
          {isRecording ? (
            <>
              <motion.div
                className="absolute inset-0 bg-red-500/20"
                animate={{ opacity: [0.2, 0.4, 0.2] }}
                transition={{ duration: 1.5, repeat: Infinity }}
              />
              <motion.div
                className="absolute left-3 w-2 h-2 rounded-full bg-red-500"
                animate={{ scale: [1, 1.3, 1], opacity: [1, 0.7, 1] }}
                transition={{ duration: 0.8, repeat: Infinity }}
              />
              <MicOff className="h-5 w-5 ml-3" />
              <span className="ml-2">Stop Recording</span>
            </>
          ) : (
            <>
              <Mic className="h-5 w-5" />
              <span className="ml-2">Record Call</span>
            </>
          )}
        </Button>

        {isRecording && (
          <motion.span
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            className="text-sm text-muted-foreground flex items-center gap-2 font-mono tabular-nums"
          >
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            {formatDuration(duration)}
          </motion.span>
        )}

        {isUploadingAudio && !isRecording && (
          <motion.span
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            className="text-sm text-muted-foreground flex items-center gap-2"
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Uploading audio…
          </motion.span>
        )}

        {audioStoragePath && !isUploadingAudio && !isRecording && (
          <motion.span
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            className="text-xs text-green-500 flex items-center gap-1"
            title={audioStoragePath}
          >
            <Check className="h-3 w-3" /> Audio saved
          </motion.span>
        )}

        {isAnalyzing && (
          <motion.span
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            className="text-sm text-primary flex items-center gap-2"
          >
            <Sparkles className="h-4 w-4 animate-pulse" />
            Analyzing call...
          </motion.span>
        )}
      </div>

      {/* Waveform Visualizer */}
      <AnimatePresence>
        {isRecording && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 48 }}
            exit={{ opacity: 0, height: 0 }}
            className="rounded-lg overflow-hidden bg-white dark:bg-black/30 border border-primary/20"
          >
            <canvas ref={canvasRef} width={400} height={48} className="w-full h-12" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* AI Call Summary */}
      <AnimatePresence>
        {callSummary && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="rounded-md bg-white dark:bg-card border border-primary/20 overflow-hidden"
          >
            {/* Summary Header */}
            <div className="p-4 border-b border-border/30 bg-primary/5">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <span className="font-medium text-foreground">Call Summary</span>
              </div>
            </div>

            {/* Key Points */}
            <div className="p-4 space-y-4">
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-2">
                  📋 Key Points
                </div>
                <ul className="space-y-1">
                  {callSummary.keyPoints.map((point, i) => (
                    <li key={i} /* stable-key-allow:ai-summary-bullet-static-per-call */ className="text-sm text-foreground flex items-start gap-2">
                      <span className="text-primary mt-1">•</span>
                      {point}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Sentiment */}
              <div className="flex items-center gap-3 py-2 px-3 rounded-lg bg-muted/30">
                <span className="text-lg">{getSentimentEmoji(callSummary.sentiment)}</span>
                <span className="text-sm text-muted-foreground">Sentiment:</span>
                <span className={cn("text-sm font-medium capitalize", getSentimentColor(callSummary.sentiment))}>
                  {callSummary.sentiment}
                </span>
              </div>

              {/* Action Items */}
              {callSummary.actionItems.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-2">
                    ✅ Action Items
                  </div>
                  <ul className="space-y-1">
                    {callSummary.actionItems.map((item, i) => (
                      <li key={i} /* stable-key-allow:ai-summary-bullet-static-per-call */ className="text-sm text-foreground flex items-start gap-2">
                        <span className="text-green-400 mt-1">•</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Recommendation */}
              <div className="p-3 rounded-lg bg-primary/10 border border-primary/20">
                <div className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-2">
                  💡 Recommendation
                </div>
                <p className="text-sm font-medium text-primary">{callSummary.recommendation}</p>
              </div>

              {/* Brief Summary */}
              <div className="text-sm text-muted-foreground italic">
                "{callSummary.briefSummary}"
              </div>

              {/* Send Follow-Up Email */}
              {onSendFollowUp && (
                <div className="space-y-2 pt-2 border-t border-border/30">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      disabled={sendingFollowUp || followUpSent === "licensed"}
                      onClick={async () => {
                        setSendingFollowUp(true);
                        try {
                          await onSendFollowUp(LICENSED_FOLLOW_UP_URL);
                          setFollowUpSent("licensed");
                        } catch { // empty-catch-allow:media-api-optional
                          // error handled by parent
                        } finally {
                          setSendingFollowUp(false);
                        }
                      }}
                      className={cn(
                        "transition-all",
                        followUpSent === "licensed" && "bg-green-600 hover:bg-green-600"
                      )}
                    >
                      {sendingFollowUp && followUpSent !== "unlicensed" && followUpSent !== "licensed" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : followUpSent === "licensed" ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <Mail className="h-4 w-4" />
                      )}
                      <span className="ml-1.5">
                        {followUpSent === "licensed" ? "Sent!" : "Send Licensed Follow-Up"}
                      </span>
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={sendingFollowUp || followUpSent === "unlicensed"}
                      onClick={async () => {
                        setSendingFollowUp(true);
                        try {
                          await onSendFollowUp(UNLICENSED_FOLLOW_UP_URL);
                          setFollowUpSent("unlicensed");
                        } catch { // empty-catch-allow:media-api-optional
                          // error handled by parent
                        } finally {
                          setSendingFollowUp(false);
                        }
                      }}
                      className={cn(
                        "transition-all",
                        followUpSent === "unlicensed" && "bg-green-600 hover:bg-green-600"
                      )}
                    >
                      {sendingFollowUp && followUpSent !== "licensed" && followUpSent !== "unlicensed" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : followUpSent === "unlicensed" ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <CalendarDays className="h-4 w-4" />
                      )}
                      <span className="ml-1.5">
                        {followUpSent === "unlicensed" ? "Sent!" : "Send Unlicensed Follow-Up"}
                      </span>
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* View Full Transcript Toggle */}
            {transcript && (
              <div className="border-t border-border/30">
                <button
                  onClick={() => setShowFullTranscript(!showFullTranscript)}
                  className="w-full p-3 flex items-center justify-center gap-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
                >
                  {showFullTranscript ? (
                    <>
                      <ChevronUp className="h-4 w-4" />
                      Hide Full Transcript
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-4 w-4" />
                      View Full Transcript
                    </>
                  )}
                </button>

                <AnimatePresence>
                  {showFullTranscript && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="p-4 bg-muted/20 border-t border-border/30">
                        <p className="text-sm text-muted-foreground whitespace-pre-wrap">{transcript}</p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error Display */}
      <AnimatePresence>
        {analyzeError && !callSummary && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center gap-2 text-sm text-red-400"
          >
            <AlertCircle className="h-4 w-4 shrink-0" />
            {analyzeError}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Recording in Progress - Show Live Indicator */}
      <AnimatePresence>
        {isRecording && transcript && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="p-3 rounded-lg bg-muted/20 border border-border/30"
          >
            <div className="text-xs text-muted-foreground mb-1 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              Transcribing live...
            </div>
            <p className="text-sm text-muted-foreground line-clamp-2">
              {transcript.slice(-100)}
              {interimTranscript && (
                <span className="italic opacity-60"> {interimTranscript}</span>
              )}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
