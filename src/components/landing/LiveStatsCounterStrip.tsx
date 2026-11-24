import { useEffect, useState } from "react";
import { FileText, Building2 } from "lucide-react";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { useInteractionGate } from "@/shared/hooks/useInteractionGate";
import { useLandingLiveStats } from "@/hooks/useLandingLiveStats";

/** Public counts share one verified response. Unavailable data stays unknown. */
export function LiveStatsCounterStrip() {
  const gateOpen = useInteractionGate();
  // 2026-06-12: gate-OR-timer · keeps Lighthouse cold-load clean (~1s) but
  // fires the real RPC by ~1.5s for visitors who don't scroll.
  const [timerOpen, setTimerOpen] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setTimerOpen(true), 1500);
    return () => clearTimeout(t);
  }, []);
  const { data, isError, isPending, refetch, isFetching } = useLandingLiveStats(gateOpen || timerOpen);
  const apps30d = data?.applications_30d ?? null;
  const carriers = data?.carriers_partnered ?? null;
  const status = isError
    ? data ? "Last available numbers · update unavailable" : "Agency numbers are unavailable right now"
    : isPending ? "Loading agency numbers…" : "Latest available agency numbers";

  return (
    <div className="landing-fade-up landing-delay-400 max-w-3xl mx-auto mb-10">
      <div className="mb-3 text-center">
        <p role="status" className="text-sm text-muted-foreground font-display">{status}</p>
        {isError && <button type="button" className="min-h-11 px-3 text-sm text-primary underline underline-offset-4" disabled={isFetching} onClick={() => void refetch()}>{isFetching ? "Retrying…" : "Retry agency numbers"}</button>}
      </div>
      {/* 2026-08-13 Sam: "just remove that number." The Active agents counter is
          gone from the public strip — 56 (loose def) vs 6 (Skool-gated) was a
          number that could only mislead a recruit, so it is not shown at all
          rather than shown wrong. Applications · 30d and Carrier partners remain. */}
      <div className="grid grid-cols-2 gap-3 sm:gap-5">
        <CounterCard
          icon={FileText}
          value={apps30d}
          label="Applications · 30d"
          color="amber"
        />
        <CounterCard
          icon={Building2}
          value={carriers}
          label="Carrier partners"
          color="cyan"
        />
      </div>
    </div>
  );
}

interface CardProps {
  icon: React.ComponentType<{ className?: string }>;
  /** null = not known yet. The card renders a dash; it never invents a number. */
  value: number | null;
  label: string;
  color: "emerald" | "amber" | "cyan";
}

const COLOR_CLASSES: Record<CardProps["color"], { text: string; ring: string; glow: string }> = {
  emerald: { text: "text-emerald-300", ring: "border-emerald-500/30", glow: "from-emerald-500/15" },
  amber:   { text: "text-amber-300",   ring: "border-amber-500/30",   glow: "from-amber-500/15"   },
  cyan:    { text: "text-info",    ring: "border-info/30",    glow: "from-info/15"    },
};

function CounterCard({ icon: Icon, value, label, color }: CardProps) {
  const c = COLOR_CLASSES[color];
  return (
    <div className={`relative rounded-md p-4 sm:p-5 text-center bg-card/95 border ${c.ring} shadow-md overflow-hidden transition-base hover:scale-[1.02]`}>
      <div className={`absolute inset-0  ${c.glow} via-transparent to-transparent pointer-events-none`} />
      <Icon className={`relative h-6 w-6 ${c.text} mx-auto mb-2`} />
      <div className={`relative font-display font-extrabold tabular-nums ${c.text}`}
           style={{ fontSize: "clamp(1.5rem, 4.5vw, 2.5rem)", lineHeight: 1 }}>
        {value === null
          ? <span aria-label="Not available" className="opacity-50">—</span>
          : <AnimatedCounter value={value} duration={1800} />}
      </div>
      <div className="relative text-sm text-muted-foreground mt-2 font-medium">
        {label}
      </div>
    </div>
  );
}
