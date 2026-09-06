import { useEffect, useRef, useState } from "react";
import type { CallState, Turn } from "@/lib/callLab/events";
import { formatClock } from "@/lib/callLab/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function Transcript({ state, agentName, prospectName, className, onSelect, selectedTurnId }: { state: Pick<CallState, "turns" | "order">; agentName: string; prospectName: string; className?: string; onSelect?: (t: Turn) => void; selectedTurnId?: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  const turns = state.order.map((id) => state.turns[id]);
  const lastText = turns[turns.length - 1]?.text;
  useEffect(() => { if (pinned && ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [turns.length, pinned, lastText]);
  const onScroll = () => { const el = ref.current; if (!el) return; setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 40); };
  return (
    <div className={cn("relative flex min-h-0 flex-col", className)}>
      <div ref={ref} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto pr-1" role="log" aria-label="Live transcript" aria-live="polite" aria-relevant="additions text">
        {turns.length === 0 && <p className="px-1 py-6 text-center text-sm text-muted-foreground">The transcript appears here as the call unfolds.</p>}
        <ol className="space-y-3">
          {turns.map((t) => (
            <li key={t.turnId} id={`turn-${t.turnId}`}>
              <button type="button" onClick={() => onSelect?.(t)} disabled={!onSelect} className={cn("w-full rounded-lg px-3 py-2 text-left transition-colors", onSelect && "hover:bg-accent", selectedTurnId === t.turnId && "bg-accent ring-1 ring-primary/50")}>
                <div className="mb-1 flex items-center gap-2 text-xs">
                  <span className={cn("font-medium", t.speaker === "agent" ? "text-primary" : "text-foreground")}>{t.speaker === "agent" ? agentName : prospectName}</span>
                  <span className="font-mono tabular-nums text-muted-foreground">{formatClock(t.startMs)}</span>
                  {!t.final && <span className="text-muted-foreground">· transcribing</span>}
                </div>
                <p className={cn("text-[15px] leading-relaxed", t.final ? "text-foreground" : "text-muted-foreground")}>{t.text || "…"}</p>
              </button>
            </li>
          ))}
        </ol>
      </div>
      {!pinned && <div className="pointer-events-none absolute bottom-2 left-0 right-0 flex justify-center"><Button size="sm" variant="secondary" className="pointer-events-auto" onClick={() => { setPinned(true); if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }}>Jump to live</Button></div>}
    </div>
  );
}
