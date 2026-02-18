import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, MicOff, Loader2, ChevronDown, ChevronUp, Sparkles, AlertCircle, Mail, Check, CalendarDays } from "lucide-react";
// Input import removed - no longer needed for calendar link
import { Button } from "@/components/ui/button";

import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

interface CallSummary {
  keyPoints: string[];
  sentiment: "positive" | "neutral" | "negative";
  actionItems: string[];
  recommendation: string;
  briefSummary: string;
}

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
  const [isSupported, setIsSupported] = useState(true);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [callSummary, setCallSummary] = useState<CallSummary | null>(null);
  const [showFullTranscript, setShowFullTranscript] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [sendingFollowUp, setSendingFollowUp] = useState(false);
  const [followUpSent, setFollowUpSent] = useState<"licensed" | "unlicensed" | false>(false);
  
  const recognitionRef = useRef<any>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

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
        setTranscript((prev) => {
          const newTranscript = prev + finalText;
          onTranscriptionUpdate(newTranscript);
          return newTranscript;
        });
      }
      setInterimTranscript(interimText);
    };

    recognition.onerror = (event: any) => {
      console.error("Speech recognition error:", event.error);
      if (event.error === "not-allowed") {
        setIsSupported(false);
      }
    };

    recognition.onend = () => {
      if (isRecording) {
        try {
          recognition.start();
        } catch (e) {
          console.log("Recognition restart failed");
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

  const startRecording = async () => {
    try {
      // Reset previous summary and transcript
      setCallSummary(null);
      setTranscript("");
      setInterimTranscript("");
      setAnalyzeError(null);
      setShowFullTranscript(false);

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
      onRecordingStateChange?.(true);
      drawWaveform();
    } catch (error) {
      console.error("Error starting recording:", error);
      setIsSupported(false);
    }
  };

  const stopRecording = () => {
    const fullTranscript = transcript + interimTranscript;

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

  if (!isSupported) {
    return (
      <div className={cn("text-sm text-muted-foreground text-center p-4", className)}>
        Voice recording not supported in this browser.
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
            className="text-sm text-muted-foreground flex items-center gap-2"
          >
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            Recording...
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
            className="rounded-lg overflow-hidden bg-black/30 border border-primary/20"
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
            className="rounded-xl bg-gradient-to-br from-primary/5 via-card to-primary/5 border border-primary/20 overflow-hidden"
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
                    <li key={i} className="text-sm text-foreground flex items-start gap-2">
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
                      <li key={i} className="text-sm text-foreground flex items-start gap-2">
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
                          await onSendFollowUp("https://calendly.com/apexlifeadvisors/15-minute-discovery");
                          setFollowUpSent("licensed");
                        } catch {
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
                          await onSendFollowUp("https://calendly.com/apexlifeadvisors/15min");
                          setFollowUpSent("unlicensed");
                        } catch {
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
