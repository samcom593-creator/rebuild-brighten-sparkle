// Producing-day streak badge.
// Shows a flame + streak count pulled from daily_production for the current
// user's agent record. Animates in when streak >= 3 days.

import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Flame } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

async function fetchStreak(userId: string): Promise<number> {
  const { data: agent } = await supabase
    .from("agents")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!agent?.id) return 0;

  const { data: rows } = await supabase
    .from("daily_production")
    .select("production_date, aop")
    .eq("agent_id", (agent as any).id)
    .gte("production_date", daysAgo(30))
    .order("production_date", { ascending: false });

  // Walk backward from today, stop on first non-producing day
  const producedDates = new Set(
    (rows ?? []).filter((r: any) => Number(r.aop ?? 0) > 0).map((r: any) => r.production_date),
  );
  let streak = 0;
  for (let i = 0; i < 30; i++) {
    if (producedDates.has(daysAgo(i))) streak++;
    else if (i === 0) continue; // skip today if no activity yet
    else break;
  }
  return streak;
}

export function StreakBanner() {
  const { user } = useAuth();
  const { data: streak = 0 } = useQuery({
    queryKey: ["my-streak", user?.id],
    queryFn: () => fetchStreak(user!.id),
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
  });

  if (streak < 3) return null;

  const tier = streak >= 14 ? { label: "INSANE", color: "#dc2626" }
             : streak >= 7  ? { label: "ELITE",  color: "#ea580c" }
             : { label: "HEATING UP", color: "#f97316" };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ scale: 0.8, opacity: 0, y: -8 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.8, opacity: 0 }}
        transition={{ type: "spring", stiffness: 200, damping: 14 }}
        className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm shadow-sm"
        style={{
          background: `linear-gradient(135deg, ${tier.color}15, ${tier.color}05)`,
          borderColor: `${tier.color}40`,
          color: tier.color,
        }}
      >
        <motion.div
          animate={{ rotate: [0, -10, 10, -5, 5, 0], scale: [1, 1.1, 1] }}
          transition={{ duration: 1.4, repeat: Infinity, repeatDelay: 2 }}
        >
          <Flame className="h-4 w-4" style={{ fill: tier.color, color: tier.color }} />
        </motion.div>
        <span className="font-bold">{streak}-day streak</span>
        <span className="text-xs opacity-70 tracking-wide uppercase">{tier.label}</span>
      </motion.div>
    </AnimatePresence>
  );
}
