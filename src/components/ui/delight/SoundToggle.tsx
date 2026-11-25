import { Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSoundEnabled } from "@/hooks/useSoundEnabled";
import { playSoundEffect } from "@/hooks/useSoundEffects";
import { useSoundSession } from "@/hooks/useSoundSession";
import { unlockSoundFromGesture } from "@/lib/soundEngine";
import { cn } from "@/lib/utils";

/**
 * Sounds on or off, one tap, from the shell (2026-10-28). Turning them on plays the pop so
 * the person hears what they just chose. The same preference is on Profile settings.
 */
export function SoundToggle({ className }: { className?: string }) {
  const [on, setOn] = useSoundEnabled();
  const readiness = useSoundSession();
  const status = !on ? "Sounds muted" : readiness === "ready" ? "Sounds on" : readiness === "unavailable" ? "Sound is unavailable in this browser" : "Sounds on — tap or press a key to enable audio";
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn("h-11 w-11 hover:bg-accent hover:text-foreground", on ? "text-primary hover:text-primary" : "text-muted-foreground", className)}
      aria-pressed={on}
      aria-label={on ? "Turn sounds off" : "Turn sounds on"}
      aria-description={status}
      title={status}
      onClick={(event) => {
        const next = !on;
        setOn(next);
        if (next) void unlockSoundFromGesture(event.nativeEvent).then((ready) => { if (ready) playSoundEffect("pop"); });
      }}
    >
      {on ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
    </Button>
  );
}
