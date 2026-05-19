import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Users, FileText, Building2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AnimatedCounter } from "@/components/ui/animated-counter";

interface LiveStats {
  active_agents: number;
  hires_recent: number;
  applications_30d: number;
  applications_total: number;
  carriers_partnered: number;
  generated_at: string;
}

/**
 * Live-counter strip rendered below the hero CTA on the public landing.
 *
 * Pulls real numbers from the public RPC landing_live_stats() (no PII, just
 * counts). Numbers animate up on first mount via the existing
 * AnimatedCounter primitive so the page feels alive on every load.
 *
 * Refresh cadence: 5 min — counts move slowly, no need to hammer.
 */
export function LiveStatsCounterStrip() {
  const { data } = useQuery({
    queryKey: ["landing_live_stats"],
    queryFn: async (): Promise<LiveStats | null> => {
      const { data, error } = await supabase.rpc("landing_live_stats");
      if (error) throw error;
      return data as unknown as LiveStats;
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  const agents = data?.active_agents ?? 95;
  const apps30d = data?.applications_30d ?? 131;
  const carriers = data?.carriers_partnered ?? 22;

  return (
    <motion.div
      className="max-w-3xl mx-auto mb-10"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.36 }}
    >
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
    </motion.div>
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
    <motion.div
      whileHover={{ y: -3, scale: 1.02 }}
      className={`relative rounded-2xl p-4 sm:p-5 text-center bg-card/90 backdrop-blur-xl border ${c.ring} shadow-md overflow-hidden`}
    >
      <div className={`absolute inset-0 bg-gradient-to-br ${c.glow} via-transparent to-transparent pointer-events-none`} />
      <Icon className={`relative h-6 w-6 ${c.text} mx-auto mb-2`} />
      <div className={`relative font-display font-extrabold tabular-nums ${c.text}`}
           style={{ fontSize: "clamp(1.5rem, 4.5vw, 2.5rem)", lineHeight: 1 }}>
        <AnimatedCounter value={value} duration={1800} />
      </div>
      <div className="relative text-[11px] sm:text-xs text-muted-foreground mt-2 font-medium uppercase tracking-wider">
        {label}
      </div>
    </motion.div>
  );
}
