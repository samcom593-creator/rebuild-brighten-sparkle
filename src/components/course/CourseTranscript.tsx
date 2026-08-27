import { useEffect, useMemo, useState } from "react";
import { Captions, Headphones, Pause, Play, Square, VolumeX } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { OnboardingModule } from "@/hooks/useOnboardingCourse";
import { cn } from "@/lib/utils";

type NarrationState = "idle" | "playing" | "paused";

const KIND_LABEL: Record<OnboardingModule["transcript_kind"], string> = {
  verbatim: "Verbatim transcript",
  "edited-transcript": "Edited transcript",
  "visual-notes": "Visual walkthrough notes",
  "lesson-notes": "Lesson notes",
};

export function CourseTranscript({ module }: { module: OnboardingModule }) {
  const [narration, setNarration] = useState<NarrationState>("idle");
  const narrationText = useMemo(
    () => module.transcript_segments.map((segment) => segment.text).join(" "),
    [module.transcript_segments],
  );
  const narrationAvailable = typeof window !== "undefined"
    && "speechSynthesis" in window
    && narrationText.length > 0;

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, [module.id]);

  const startNarration = () => {
    if (!narrationAvailable) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(narrationText);
    utterance.rate = 1;
    utterance.onend = () => setNarration("idle");
    utterance.onerror = () => setNarration("idle");
    window.speechSynthesis.speak(utterance);
    setNarration("playing");
  };

  const togglePause = () => {
    if (!narrationAvailable) return;
    if (narration === "paused") {
      window.speechSynthesis.resume();
      setNarration("playing");
    } else {
      window.speechSynthesis.pause();
      setNarration("paused");
    }
  };

  const stopNarration = () => {
    if (!narrationAvailable) return;
    window.speechSynthesis.cancel();
    setNarration("idle");
  };

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden border-primary/20">
        <div className="flex flex-col gap-3 border-b border-border bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
              <Captions className="h-5 w-5" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-bold">Transcript &amp; notes</h3>
                <Badge variant="outline" className="text-[10px]">
                  {KIND_LABEL[module.transcript_kind]}
                </Badge>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Read along or use device narration for an audio-first lesson.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            {narration === "idle" ? (
              <Button
                size="sm"
                className="gap-1.5"
                onClick={startNarration}
                disabled={!narrationAvailable}
              >
                <Headphones className="h-4 w-4" /> Listen
              </Button>
            ) : (
              <>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={togglePause}>
                  {narration === "paused" ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                  {narration === "paused" ? "Resume" : "Pause"}
                </Button>
                <Button size="icon" variant="outline" onClick={stopNarration} aria-label="Stop transcript narration">
                  <Square className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        </div>

        {!module.media_has_audio && (
          <div className="flex items-start gap-2 border-b border-warning/25 bg-warning/5 px-4 py-3 text-xs text-muted-foreground">
            <VolumeX className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            The supplied screen recording has no voice track. These visual notes and Listen mode provide the narration.
          </div>
        )}

        {module.transcript_segments.length > 0 ? (
          <ol className="divide-y divide-border">
            {module.transcript_segments.map((segment, index) => (
              <li
                key={`${segment.time}-${index}`}
                className="grid gap-2 p-4 sm:grid-cols-[4.5rem_1fr] sm:gap-4"
              >
                <span className={cn(
                  "w-fit rounded-full bg-muted px-2 py-1 text-[11px] font-semibold tabular-nums text-muted-foreground",
                  !segment.time && "invisible",
                )}>
                  {segment.time || "Notes"}
                </span>
                <p className="text-sm leading-6 text-foreground/90">{segment.text}</p>
              </li>
            ))}
          </ol>
        ) : (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Transcript notes are being prepared for this lesson.
          </div>
        )}
      </Card>
    </div>
  );
}

export default CourseTranscript;
