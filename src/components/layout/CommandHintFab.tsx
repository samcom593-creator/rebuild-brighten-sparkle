import { useEffect, useState } from "react";
import { Command } from "lucide-react";
import { useUIStore } from "@/shared/store/uiStore";

/**
 * CommandHintFab — floating bottom-right pill that hints "⌘K". Pulses gently
 * to remind users the command palette exists. Click opens it. Hidden when
 * the palette is already open. Sits above content (z-30) and respects
 * mobile safe-area bottom.
 */
export function CommandHintFab() {
  const open = useUIStore((s) => s.commandPaletteOpen);
  const setOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const [isMac, setIsMac] = useState(true);

  useEffect(() => {
    try {
      setIsMac(/Mac|iPhone|iPod|iPad/i.test(navigator.platform));
    } catch {}
  }, []);

  if (open) return null;

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label="Open command palette"
      className="
        fixed z-30 bottom-4 right-4 lg:bottom-6 lg:right-6
        flex items-center gap-2 px-3 py-2 rounded-full
        bg-white dark:bg-slate-900
        border border-primary/40
        backdrop-blur-md
        text-foreground text-xs font-semibold
        shadow-[0_8px_24px_hsl(168_80%_50%/0.25),inset_0_1px_0_hsl(0_0%_100%/0.08)]
        hover:scale-105 hover:border-primary/60
        transition-all
        safe-area-bottom
      "
      style={{ bottom: "calc(1rem + env(safe-area-inset-bottom, 0px))" }}
    >
      <span className="flex items-center justify-center h-5 w-5 rounded bg-primary/20 border border-primary/40">
        <Command className="h-3 w-3 text-primary" />
      </span>
      <span className="hidden sm:inline tracking-wider">
        {isMac ? "⌘ K" : "Ctrl K"}
      </span>
      <span className="hidden sm:inline text-muted-foreground">Search</span>
      <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-primary animate-pulse" />
    </button>
  );
}
