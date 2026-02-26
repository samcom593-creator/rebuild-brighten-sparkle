import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Rocket, TrendingUp } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { AnimatedNumber } from "@/components/dashboard/AnimatedNumber";
import { useSoundEffects } from "@/hooks/useSoundEffects";

async function fetchApplicationCounts() {
  const now = new Date();
  const todayISO = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const dayOfWeek = now.getDay();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
  weekStart.setHours(0, 0, 0, 0);
  const weekStartISO = weekStart.toISOString();

  const [appsRes, agedRes, todayRes, weekRes] = await Promise.all([
    supabase.from("applications").select("*", { count: "exact", head: true }).is("terminated_at", null),
    supabase.from("aged_leads").select("*", { count: "exact", head: true }),
    supabase.from("applications").select("*", { count: "exact", head: true }).is("terminated_at", null).gte("created_at", todayISO),
    supabase.from("applications").select("*", { count: "exact", head: true }).is("terminated_at", null).gte("created_at", weekStartISO),
  ]);

  return {
    newApps: appsRes.count ?? 0,
    agedLeads: agedRes.count ?? 0,
    today: todayRes.count ?? 0,
    thisWeek: weekRes.count ?? 0,
  };
}

export function TotalApplicationsBanner() {
  const { playSound } = useSoundEffects();
  const hasPlayed = useRef(false);

  const { data } = useQuery({
    queryKey: ["total-applications-fomo"],
    queryFn: fetchApplicationCounts,
    refetchInterval: 60_000,
  });

  const newApps = data?.newApps ?? 0;
  const agedLeads = data?.agedLeads ?? 0;
  const total = newApps + agedLeads;
  const today = data?.today ?? 0;
  const thisWeek = data?.thisWeek ?? 0;

  useEffect(() => {
    if (total > 0 && !hasPlayed.current) {
      hasPlayed.current = true;
      playSound("whoosh");
    }
  }, [total, playSound]);

  if (!data) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="mb-6"
    >
      <GlassCard className="relative overflow-hidden border-primary/30 hover:border-primary/50 transition-colors p-0">
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-emerald-500/10 pointer-events-none" />
        <div className="absolute -top-16 -right-16 w-40 h-40 rounded-full bg-primary/5 blur-2xl pointer-events-none" />
        <div className="absolute -bottom-12 -left-12 w-32 h-32 rounded-full bg-emerald-500/5 blur-2xl pointer-events-none" />

        <div className="relative z-10 p-5 sm:p-6">
          {/* Header */}
          <div className="flex items-center gap-2 mb-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/15">
              <Rocket className="h-4 w-4 text-primary" />
            </div>
            <h3 className="text-sm font-bold tracking-wide uppercase text-muted-foreground">
              Total Applications
            </h3>
            <TrendingUp className="h-3.5 w-3.5 text-emerald-500 ml-auto" />
          </div>

          {/* Big number */}
          <div className="flex items-baseline gap-3 mb-3">
            <AnimatedNumber
              value={total}
              duration={1.8}
              className="text-4xl sm:text-5xl font-black bg-gradient-to-r from-primary via-primary to-emerald-500 bg-clip-text text-transparent tracking-tight"
            />
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.4, type: "spring", stiffness: 300 }}
              className="text-lg"
            >
              🔥
            </motion.span>
          </div>

          {/* Spacer */}
          <div className="mb-3" />

          {/* Today / This Week badges */}
          <div className="flex items-center gap-2 flex-wrap">
            {today > 0 && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.6, type: "spring", stiffness: 300 }}
              >
                <Badge
                  variant="outline"
                  className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-[11px] font-semibold"
                >
                  +{today} today
                </Badge>
              </motion.div>
            )}
            {thisWeek > 0 && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.75, type: "spring", stiffness: 300 }}
              >
                <Badge
                  variant="outline"
                  className="bg-primary/10 text-primary border-primary/30 text-[11px] font-semibold"
                >
                  +{thisWeek} this week
                </Badge>
              </motion.div>
            )}
          </div>
        </div>
      </GlassCard>
    </motion.div>
  );
}
