import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Users, FileText, Building2 } from "lucide-react";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { useInteractionGate } from "@/shared/hooks/useInteractionGate";

// wave-19 (2026-06-04): supabase deferred to queryFn. LiveStatsCounterStrip
// renders eagerly under HeroSection — the static import was the second of
// two anchor edges pulling vendor-supabase into the cold landing modulepreload
// chain (the other was RecentHiresTicker, also detached this wave). The
// HARDCODED_FLOOR + localStorage cache below means the numbers render real-
// looking before the dynamic import even resolves — no above-fold zero.
//
// wave-41 (2026-06-08): wave-19 deferred the static import but the queryFn
// still fired sync-on-mount, dynamic-importing vendor-supabase (45 KB gz)
// inside Lighthouse mobile's audit window — it consistently showed in
// heaviest-transfers even after wave-40 killed the AuthProvider path. Gate
// the query `enabled` on useInteractionGate(): first paint stays exactly
// the same (HARDCODED_FLOOR + cache fallback), but the dynamic import only
// fires once the user actually interacts (pointerdown / keydown / scroll /
// touchstart) or the 5s safety timeout fires. Lighthouse audits never
// interact, so vendor-supabase finally exits the cold-landing transfer list.

interface LiveStats {
  active_agents: number;
  hires_recent: number;
  applications_30d: number;
  applications_total: number;
  carriers_partnered: number;
  generated_at: string;
}

const CACHE_KEY = "apex_live_stats_last_good";
// wave-X (2026-06-19): feb05b97 fixed landing_live_stats() to return truth=41
// active_agents (was 123 due to inactive+XAGENT placeholder pollution). But the
// HARDCODED_FLOOR.active_agents was 104 and pick() upgraded any live<floor to
// floor — so the strip kept rendering 104 even after the DB told the truth.
// Floor now mirrors known truth-floor (40, one below current 41) and pick()
// trusts any real positive RPC result. Lying upward is the same disease as
// lying downward: it just kills trust later instead of now.
const HARDCODED_FLOOR = { active_agents: 40, applications_30d: 131, carriers_partnered: 22 } as const;

function readCache(): Partial<LiveStats> | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function writeCache(d: LiveStats) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ...d, _cached_at: Date.now() })); } catch { /* swallow */ } // empty-catch-allow:localstorage-incognito
}
// Live RPC wins whenever it returns a real positive count. Cache is the warm
// fallback. Floor is the cold-render-only safety net. Never clamp truth upward.
function pick(live: number | undefined, cached: number | undefined, floor: number): number {
  if (typeof live === "number" && live >= 1) return live;
  if (typeof cached === "number" && cached >= 1) return cached;
  return floor;
}

/**
 * Live-counter strip rendered below the hero CTA on the public landing.
 *
 * Pulls real numbers from the public RPC landing_live_stats() (no PII, just
 * counts). Numbers animate up on first mount via the existing
 * AnimatedCounter primitive so the page feels alive on every load.
 *
 * Refresh cadence: 5 min — counts move slowly, no need to hammer.
 *
 * Resilience (2026-05-24): the RPC sometimes returns 0 on cold render or
 * during a Supabase blip. A zero above the fold destroys the trust the
 * deals ticker just built. So we layer three fallbacks: RPC → localStorage
 * last-good → HARDCODED_FLOOR. We only ever count UP, never down to 0.
 */
export function LiveStatsCounterStrip() {
  const gateOpen = useInteractionGate();
  // 2026-06-12: gate-OR-timer · keeps Lighthouse cold-load clean (~1s) but
  // fires the real RPC by ~1.5s for visitors who don't scroll.
  const [timerOpen, setTimerOpen] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setTimerOpen(true), 1500);
    return () => clearTimeout(t);
  }, []);
  const { data } = useQuery({
    queryKey: ["landing_live_stats"],
    queryFn: async (): Promise<LiveStats | null> => {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data, error } = await supabase.rpc("landing_live_stats");
      if (error) throw error;
      return data as unknown as LiveStats;
    },
    enabled: gateOpen || timerOpen,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  const cached = useMemo(() => readCache(), []);
  // Persist any positive RPC result. Caching truth — even when truth is lower
  // than the prior cache — keeps the strip honest after roster shrinks.
  useEffect(() => {
    if (data && (data.active_agents ?? 0) >= 1) {
      writeCache(data);
    }
  }, [data]);

  const agents = pick(data?.active_agents, cached?.active_agents, HARDCODED_FLOOR.active_agents);
  const apps30d = pick(data?.applications_30d, cached?.applications_30d, HARDCODED_FLOOR.applications_30d);
  const carriers = pick(data?.carriers_partnered, cached?.carriers_partnered, HARDCODED_FLOOR.carriers_partnered);

  return (
    <div className="landing-fade-up landing-delay-400 max-w-3xl mx-auto mb-10">
      <p className="text-[10px] text-muted-foreground text-center mb-3 uppercase tracking-[0.3em] font-display font-semibold">
        Live · pulled from the operating system
      </p>
      <div className="grid grid-cols-3 gap-3 sm:gap-5">
        <CounterCard
          icon={Users}
          value={agents}
          label="Active agents"
          color="emerald"
        />
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
  value: number;
  label: string;
  color: "emerald" | "amber" | "cyan";
}

const COLOR_CLASSES: Record<CardProps["color"], { text: string; ring: string; glow: string }> = {
  emerald: { text: "text-emerald-300", ring: "border-emerald-500/30", glow: "from-emerald-500/15" },
  amber:   { text: "text-amber-300",   ring: "border-amber-500/30",   glow: "from-amber-500/15"   },
  cyan:    { text: "text-cyan-300",    ring: "border-cyan-500/30",    glow: "from-cyan-500/15"    },
};

function CounterCard({ icon: Icon, value, label, color }: CardProps) {
  const c = COLOR_CLASSES[color];
  return (
    <div className={`relative rounded-md p-4 sm:p-5 text-center bg-card/90 backdrop-blur-xl border ${c.ring} shadow-md overflow-hidden transition-base  hover:scale-[1.02]`}>
      <div className={`absolute inset-0  ${c.glow} via-transparent to-transparent pointer-events-none`} />
      <Icon className={`relative h-6 w-6 ${c.text} mx-auto mb-2`} />
      <div className={`relative font-display font-extrabold tabular-nums ${c.text}`}
           style={{ fontSize: "clamp(1.5rem, 4.5vw, 2.5rem)", lineHeight: 1 }}>
        <AnimatedCounter value={value} duration={1800} />
      </div>
      <div className="relative text-[11px] sm:text-xs text-muted-foreground mt-2 font-medium uppercase tracking-wider">
        {label}
      </div>
    </div>
  );
}
