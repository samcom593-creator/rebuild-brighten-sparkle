import { Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSoundEnabled } from "@/hooks/useSoundEnabled";
import { playSoundEffect } from "@/hooks/useSoundEffects";
import { cn } from "@/lib/utils";

/**
 * Sounds on or off, one tap, from the shell (2026-10-28). Turning them on plays the pop so
 * the person hears what they just chose. The same preference is on Profile settings.
 */
export function SoundToggle({ className }: { className?: string }) {
  const [on, setOn] = useSoundEnabled();
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn("h-11 w-11 hover:bg-accent hover:text-foreground", on ? "text-primary hover:text-primary" : "text-muted-foreground", className)}
      aria-pressed={on}
      aria-label={on ? "Turn sounds off" : "Turn sounds on"}
      title={on ? "Sounds are on" : "Sounds are off"}
      onClick={() => {
        const next = !on;
        setOn(next);
        if (next) playSoundEffect("pop");
      }}
    >
      {on ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
    </Button>
  );
}
