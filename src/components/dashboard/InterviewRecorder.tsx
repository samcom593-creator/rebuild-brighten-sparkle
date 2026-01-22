import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Mic, MicOff, Square, Loader2, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface InterviewRecorderProps {
  applicationId: string;
  agentId: string;
  applicantName: string;
  onClose: () => void;
  onTranscriptionSaved: () => void;
}

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognition;
    webkitSpeechRecognition: new () => SpeechRecognition;
  }
}

export function InterviewRecorder({
  applicationId,
  agentId,
  applicantName,
  onClose,
  onTranscriptionSaved,
}: InterviewRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [transcription, setTranscription] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [duration, setDuration] = useState(0);
  const [isSupported, setIsSupported] = useState(true);
  
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Check browser support
    const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) {
      setIsSupported(false);
      return;
    }

    recognitionRef.current = new SpeechRecognitionAPI();
    recognitionRef.current.continuous = true;
    recognitionRef.current.interimResults = true;
    recognitionRef.current.lang = "en-US";

    recognitionRef.current.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      let final = "";
      
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += transcript + " ";
        } else {
          interim += transcript;
        }
      }
      
      if (final) {
        setTranscription((prev) => prev + final);
      }
      setInterimTranscript(interim);
    };

    recognitionRef.current.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.error("Speech recognition error:", event.error);
      if (event.error !== "no-speech") {
        toast.error(`Recognition error: ${event.error}`);
      }
    };

    recognitionRef.current.onend = () => {
      if (isRecording && recognitionRef.current) {
        recognitionRef.current.start();
      }
    };

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, [isRecording]);

  const startRecording = () => {
    if (!recognitionRef.current) return;
    
    setIsRecording(true);
    setDuration(0);
    recognitionRef.current.start();
    
    timerRef.current = setInterval(() => {
      setDuration((d) => d + 1);
    }, 1000);
    
    toast.success("Recording started - speak clearly");
  };

  const stopRecording = () => {
    setIsRecording(false);
    
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    
    setInterimTranscript("");
    toast.success("Recording stopped");
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const handleSave = async () => {
    if (!transcription.trim()) {
      toast.error("No transcription to save");
      return;
    }

    setIsSaving(true);

    const { error } = await supabase.from("interview_recordings").insert({
      application_id: applicationId,
      agent_id: agentId,
      transcription: transcription.trim(),
      duration_seconds: duration,
    });

    if (error) {
      console.error("Save error:", error);
      toast.error("Failed to save transcription");
    } else {
      toast.success("Interview transcription saved!");
      onTranscriptionSaved();
      onClose();
    }

    setIsSaving(false);
  };

  if (!isSupported) {
    return (
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md"
          >
            <GlassCard className="p-6 text-center">
              <MicOff className="h-12 w-12 text-destructive mx-auto mb-4" />
              <h2 className="text-lg font-semibold mb-2">Speech Recognition Not Supported</h2>
              <p className="text-muted-foreground mb-4">
                Your browser doesn't support speech recognition. Please use Chrome, Edge, or Safari.
              </p>
              <Button onClick={onClose}>Close</Button>
            </GlassCard>
          </motion.div>
        </motion.div>
      </AnimatePresence>
    );
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-2xl"
        >
          <GlassCard className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Mic className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-semibold">Interview with {applicantName}</h2>
              </div>
              <Button variant="ghost" size="icon" onClick={onClose}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Recording Controls */}
            <div className="flex items-center justify-center gap-4 mb-6 p-4 rounded-lg bg-muted/50">
              {isRecording ? (
                <>
                  <motion.div
                    animate={{ scale: [1, 1.2, 1] }}
                    transition={{ repeat: Infinity, duration: 1 }}
                    className="w-4 h-4 rounded-full bg-destructive"
                  />
                  <span className="text-lg font-mono">{formatDuration(duration)}</span>
                  <Button
                    variant="destructive"
                    onClick={stopRecording}
                    className="gap-2"
                  >
                    <Square className="h-4 w-4" />
                    Stop Recording
                  </Button>
                </>
              ) : (
                <Button
                  onClick={startRecording}
                  className="gap-2"
                  size="lg"
                >
                  <Mic className="h-5 w-5" />
                  Start Recording
                </Button>
              )}
            </div>

            {/* Transcription Display */}
            <div className="mb-4">
              <label className="text-sm font-medium mb-2 block flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Live Transcription
              </label>
              <Textarea
                value={transcription + interimTranscript}
                onChange={(e) => setTranscription(e.target.value)}
                placeholder="Transcription will appear here as you speak..."
                className="min-h-[250px] bg-input resize-none font-mono text-sm"
              />
              {interimTranscript && (
                <p className="text-xs text-muted-foreground mt-1">
                  <span className="text-primary">●</span> Listening...
                </p>
              )}
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={isSaving || !transcription.trim()}
              >
                {isSaving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Save Transcription"
                )}
              </Button>
            </div>
          </GlassCard>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
