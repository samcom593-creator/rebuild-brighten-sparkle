import { useEffect, useState } from "react";
import { Flame, Calendar } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { cn } from "@/lib/utils";

interface Props { agentId: string | null | undefined; }

/**
 * Gameified streak tracker. Counts consecutive days with production > 0
 * ending today. Flame intensifies with streak length.
 */
export function StreakFlameCard({ agentId }: Props) {
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!agentId) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.from("daily_production")
          .select("production_date, aop")
          .eq("agent_id", agentId)
          .order("production_date", { ascending: false })
          .limit(180);

        const days = new Set((data ?? []).filter((r: any) => Number(r.aop) > 0).map((r: any) => r.production_date));
        const ymd = (d: Date) => d.toISOString().slice(0, 10);

        let cur = 0;
        const today = new Date();
        for (let i = 0; i < 180; i++) {
          const d = new Date(today); d.setDate(today.getDate() - i);
          if (days.has(ymd(d))) cur++;
          else if (i > 0) break;  // end of current streak (allow today to not have a log yet)
        }

        // Best streak
        let best = 0, running = 0;
        const sorted = Array.from(days).sort();
        let prev: Date | null = null;
        for (const ds of sorted) {
          const d = new Date(ds);
          if (prev && (d.getTime() - prev.getTime()) === 86_400_000) running++;
          else running = 1;
          best = Math.max(best, running);
          prev = d;
        }

        if (!cancelled) { setStreak(cur); setBestStreak(best); }
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [agentId]);

  if (loading || !agentId) return null;

  const tier =
    streak >= 30 ? { label: "UNSTOPPABLE", color: "#ef4444", bg: "from-rose-500/20 to-amber-500/10" }
    : streak >= 10 ? { label: "ON FIRE",     color: "#f59e0b", bg: "from-amber-500/20 to-orange-500/10" }
    : streak >= 5  ? { label: "HEATING UP",  color: "#fb923c", bg: "from-orange-500/15 to-amber-500/5" }
    : streak >= 1  ? { label: "KEEP IT UP",  color: "#22d3a5", bg: "from-emerald-500/15 to-transparent" }
    :                 { label: "START TODAY", color: "#64748b", bg: "from-muted/20 to-transparent" };

  return (
    <GlassCard className={cn("p-5 card-tilt reveal bg-gradient-to-br", tier.bg, streak >= 5 && "win-glow")}>
      <div className="flex items-center gap-4">
        <div className={cn("h-16 w-16 rounded-2xl flex items-center justify-center shrink-0", streak >= 5 ? "streak-flame" : "")}
             style={{ background: `${tier.color}22`, border: `2px solid ${tier.color}66` }}>
          <Flame className="h-8 w-8" style={{ color: tier.color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <span className="text-[10px] uppercase tracking-widest font-bold" style={{ color: tier.color }}>{tier.label}</span>
          </div>
          <div className="flex items-baseline gap-3">
            <span className="text-4xl font-bold tabular-nums" style={{ color: tier.color }}>{streak}</span>
            <span className="text-sm text-muted-foreground">day{streak === 1 ? "" : "s"}</span>
          </div>
          <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
            <Calendar className="h-3 w-3" />
            Best streak: <span className="font-semibold text-foreground/80">{bestStreak}d</span>
          </div>
        </div>
      </div>
    </GlassCard>
  );
}
