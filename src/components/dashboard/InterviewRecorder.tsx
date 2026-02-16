import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Mic, MicOff, Loader2, Sparkles, AlertCircle, ChevronDown, ChevronUp, Mail, Check, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GlassCard } from "@/components/ui/glass-card";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface InterviewRecorderProps {
  applicationId: string;
  agentId: string;
  applicantName: string;
  onClose: () => void;
  onTranscriptionSaved: () => void;
}

interface CallSummary {
  keyPoints: string[];
  sentiment: "positive" | "neutral" | "negative";
  actionItems: string[];
  recommendation: string;
  briefSummary: string;
}

export function InterviewRecorder({
  applicationId,
  agentId,
  applicantName,
  onClose,
  onTranscriptionSaved,
}: InterviewRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isSupported, setIsSupported] = useState(true);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [callSummary, setCallSummary] = useState<CallSummary | null>(null);
  const [showFullTranscript, setShowFullTranscript] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [sendingFollowUp, setSendingFollowUp] = useState(false);
  const [followUpSent, setFollowUpSent] = useState(false);
  const [showCalendarInput, setShowCalendarInput] = useState(false);
  const [calendarLink, setCalendarLink] = useState("");
  const [duration, setDuration] = useState(0);

  const recognitionRef = useRef<any>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setIsSupported(false);
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
        setTranscript((prev) => prev + finalText);
      }
      setInterimTranscript(interimText);
    };

    recognition.onerror = (event: any) => {
      console.error("Speech recognition error:", event.error);
      if (event.error === "not-allowed") setIsSupported(false);
    };

    recognition.onend = () => {
      // Auto-restart if still recording
      if (recognitionRef.current && document.querySelector('[data-recording="true"]')) {
        try { recognition.start(); } catch {}
      }
    };

    recognitionRef.current = recognition;

    return () => {
      recognitionRef.current?.stop();
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioContextRef.current?.close();
      if (timerRef.current) clearInterval(timerRef.current);
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
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.lineWidth = 2;
      const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
      gradient.addColorStop(0, "hsl(160, 84%, 39%)");
      gradient.addColorStop(0.5, "hsl(172, 66%, 50%)");
      gradient.addColorStop(1, "hsl(160, 84%, 39%)");
      ctx.strokeStyle = gradient;
      ctx.beginPath();
      const sliceWidth = canvas.width / bufferLength;
      let x = 0;
      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * canvas.height) / 2;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
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
      if (error) { setAnalyzeError(error.message || "Failed to analyze"); return; }
      if (data?.summary) setCallSummary(data.summary);
      else if (data?.error) setAnalyzeError(data.error);
    } catch {
      setAnalyzeError("Connection error. Please try again.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const startRecording = async () => {
    try {
      setCallSummary(null);
      setTranscript("");
      setInterimTranscript("");
      setAnalyzeError(null);
      setShowFullTranscript(false);
      setDuration(0);
      setFollowUpSent(false);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      audioContextRef.current = new AudioContext();
      const source = audioContextRef.current.createMediaStreamSource(stream);
      const analyser = audioContextRef.current.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      recognitionRef.current?.start();
      setIsRecording(true);
      timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
      drawWaveform();
      toast.success("Recording started");
    } catch {
      setIsSupported(false);
    }
  };

  const stopRecording = () => {
    const fullTranscript = transcript + interimTranscript;
    recognitionRef.current?.stop();
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    audioContextRef.current?.close();
    if (timerRef.current) clearInterval(timerRef.current);

    setIsRecording(false);
    setInterimTranscript("");

    if (interimTranscript) {
      setTranscript((prev) => prev + interimTranscript);
    }

    if (fullTranscript.trim()) {
      analyzeTranscript(fullTranscript);
    }
    toast.success("Recording stopped");
  };

  const handleSave = async () => {
    const finalTranscript = transcript.trim();
    if (!finalTranscript) { toast.error("No transcription to save"); return; }
    setIsSaving(true);

    const { error } = await supabase.from("interview_recordings").insert({
      application_id: applicationId,
      agent_id: agentId,
      transcription: finalTranscript,
      duration_seconds: duration,
      summary: callSummary as any,
    });

    if (error) {
      console.error("Save error:", error);
      toast.error("Failed to save");
    } else {
      toast.success("Interview saved with AI summary!");
      onTranscriptionSaved();
      onClose();
    }
    setIsSaving(false);
  };

  const handleSendFollowUp = async () => {
    setSendingFollowUp(true);
    try {
      const { error } = await supabase.functions.invoke("send-post-call-followup", {
        body: {
          applicationId,
          actionType: "contacted",
          calendarLink: calendarLink || undefined,
        },
      });
      if (error) throw error;
      setFollowUpSent(true);
      toast.success("Follow-up email sent!");
    } catch {
      toast.error("Failed to send follow-up email");
    } finally {
      setSendingFollowUp(false);
    }
  };

  const formatDuration = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const getSentimentEmoji = (s: string) => s === "positive" ? "😊" : s === "negative" ? "😟" : "😐";
  const getSentimentColor = (s: string) => s === "positive" ? "text-green-400" : s === "negative" ? "text-red-400" : "text-yellow-400";

  if (!isSupported) {
    return (
      <AnimatePresence>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm" onClick={onClose}>
          <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} onClick={(e) => e.stopPropagation()} className="w-full max-w-md">
            <GlassCard className="p-6 text-center">
              <MicOff className="h-12 w-12 text-destructive mx-auto mb-4" />
              <h2 className="text-lg font-semibold mb-2">Speech Recognition Not Supported</h2>
              <p className="text-muted-foreground mb-4">Please use Chrome, Edge, or Safari.</p>
              <Button onClick={onClose}>Close</Button>
            </GlassCard>
          </motion.div>
        </motion.div>
      </AnimatePresence>
    );
  }

  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm" onClick={onClose}>
        <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
          onClick={(e) => e.stopPropagation()} className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
          <GlassCard className="p-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Mic className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-semibold">Interview with {applicantName}</h2>
              </div>
              <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
            </div>

            {/* Recording Controls */}
            <div className="flex items-center gap-3 mb-4" data-recording={isRecording}>
              <Button
                variant="outline" size="lg"
                onClick={isRecording ? stopRecording : startRecording}
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
                    <motion.div className="absolute inset-0 bg-red-500/20" animate={{ opacity: [0.2, 0.4, 0.2] }} transition={{ duration: 1.5, repeat: Infinity }} />
                    <motion.div className="absolute left-3 w-2 h-2 rounded-full bg-red-500" animate={{ scale: [1, 1.3, 1] }} transition={{ duration: 0.8, repeat: Infinity }} />
                    <MicOff className="h-5 w-5 ml-3" />
                    <span className="ml-2">Stop Recording</span>
                  </>
                ) : (
                  <><Mic className="h-5 w-5" /><span className="ml-2">Start Recording</span></>
                )}
              </Button>

              {isRecording && (
                <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-sm text-muted-foreground flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  {formatDuration(duration)}
                </motion.span>
              )}

              {isAnalyzing && (
                <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-sm text-primary flex items-center gap-2">
                  <Sparkles className="h-4 w-4 animate-pulse" /> Analyzing...
                </motion.span>
              )}
            </div>

            {/* Waveform */}
            <AnimatePresence>
              {isRecording && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 48 }} exit={{ opacity: 0, height: 0 }}
                  className="rounded-lg overflow-hidden bg-black/30 border border-primary/20 mb-4">
                  <canvas ref={canvasRef} width={600} height={48} className="w-full h-12" />
                </motion.div>
              )}
            </AnimatePresence>

            {/* Live Transcript Preview */}
            <AnimatePresence>
              {isRecording && transcript && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="p-3 rounded-lg bg-muted/20 border border-border/30 mb-4">
                  <div className="text-xs text-muted-foreground mb-1 flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" /> Transcribing live...
                  </div>
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {transcript.slice(-100)}
                    {interimTranscript && <span className="italic opacity-60"> {interimTranscript}</span>}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* AI Call Summary */}
            <AnimatePresence>
              {callSummary && (
                <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
                  className="rounded-xl bg-gradient-to-br from-primary/5 via-card to-primary/5 border border-primary/20 overflow-hidden mb-4">
                  <div className="p-4 border-b border-border/30 bg-primary/5">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-primary" />
                      <span className="font-medium text-foreground">AI Call Summary</span>
                    </div>
                  </div>

                  <div className="p-4 space-y-4">
                    {/* Key Points */}
                    <div>
                      <div className="text-xs font-medium text-muted-foreground mb-2">📋 Key Points</div>
                      <ul className="space-y-1">
                        {callSummary.keyPoints.map((point, i) => (
                          <li key={i} className="text-sm text-foreground flex items-start gap-2">
                            <span className="text-primary mt-1">•</span>{point}
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* Sentiment */}
                    <div className="flex items-center gap-3 py-2 px-3 rounded-lg bg-muted/30">
                      <span className="text-lg">{getSentimentEmoji(callSummary.sentiment)}</span>
                      <span className="text-sm text-muted-foreground">Sentiment:</span>
                      <span className={cn("text-sm font-medium capitalize", getSentimentColor(callSummary.sentiment))}>{callSummary.sentiment}</span>
                    </div>

                    {/* Action Items */}
                    {callSummary.actionItems.length > 0 && (
                      <div>
                        <div className="text-xs font-medium text-muted-foreground mb-2">✅ Action Items</div>
                        <ul className="space-y-1">
                          {callSummary.actionItems.map((item, i) => (
                            <li key={i} className="text-sm text-foreground flex items-start gap-2">
                              <span className="text-green-400 mt-1">•</span>{item}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Recommendation */}
                    <div className="p-3 rounded-lg bg-primary/10 border border-primary/20">
                      <div className="text-xs font-medium text-muted-foreground mb-1">💡 Recommendation</div>
                      <p className="text-sm font-medium text-primary">{callSummary.recommendation}</p>
                    </div>

                    {/* Brief Summary */}
                    <div className="text-sm text-muted-foreground italic">"{callSummary.briefSummary}"</div>

                    {/* Follow-Up Email */}
                    <div className="space-y-2 pt-2 border-t border-border/30">
                      <div className="flex items-center gap-2">
                        <Button size="sm" disabled={sendingFollowUp || followUpSent} onClick={handleSendFollowUp}
                          className={cn("transition-all", followUpSent && "bg-green-600 hover:bg-green-600")}>
                          {sendingFollowUp ? <Loader2 className="h-4 w-4 animate-spin" /> : followUpSent ? <Check className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
                          <span className="ml-1.5">{followUpSent ? "Email Sent!" : "Send Follow-Up Email"}</span>
                        </Button>
                        <button type="button" onClick={() => setShowCalendarInput(!showCalendarInput)}
                          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
                          <CalendarDays className="h-3.5 w-3.5" />
                          {showCalendarInput ? "Hide" : "Add calendar link"}
                        </button>
                      </div>
                      <AnimatePresence>
                        {showCalendarInput && (
                          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                            <Input placeholder="Paste your Calendly or scheduling link..." value={calendarLink} onChange={(e) => setCalendarLink(e.target.value)} className="text-sm h-9" />
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>

                  {/* View Full Transcript Toggle */}
                  {transcript && (
                    <div className="border-t border-border/30">
                      <button onClick={() => setShowFullTranscript(!showFullTranscript)}
                        className="w-full p-3 flex items-center justify-center gap-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors">
                        {showFullTranscript ? <><ChevronUp className="h-4 w-4" /> Hide Full Transcript</> : <><ChevronDown className="h-4 w-4" /> View Full Transcript</>}
                      </button>
                      <AnimatePresence>
                        {showFullTranscript && (
                          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
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
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center gap-2 text-sm text-red-400 mb-4">
                  <AlertCircle className="h-4 w-4 shrink-0" />{analyzeError}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Actions */}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={handleSave} disabled={isSaving || !transcript.trim() || isRecording}>
                {isSaving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving...</> : "Save Interview"}
              </Button>
            </div>
          </GlassCard>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
