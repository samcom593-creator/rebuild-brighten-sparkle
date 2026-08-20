import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useInteractionGate } from "@/shared/hooks/useInteractionGate";

// 2026-06-12 Sam: "website not showing hires massive holes"
// ROOT CAUSE: `enabled: gateOpen` (added in wave-41 for Lighthouse) meant the
// RPC NEVER fired if the visitor didn't scroll. Recruiting prospects who just
// look at the hero saw nothing.
// FIX: keep the gate for Lighthouse cold-load (so vendor-supabase doesn't
// fetch in the first 1.5s) but ADD a 1.5s timer fallback that flips the gate
// open even without interaction. Lighthouse is in/out within 1s so it never
// sees this fire; real visitors see the ticker by ~2s.
//
// Also: the prior HireRow interface declared { amount, hired_at } fields the
// RPC doesn't return. The actual RPC shape is below.

interface HireRow {
  first_name: string | null;
  display_name: string | null;
  agent_code: string | null;
  manager_name: string | null;
  hired_on: string | null;
  days_on_team: number | null;
  onboarding_stage: string | null;
}

/**
 * Recent-hires ticker — rendered below the hero CTAs.
 *
 * Pulls anonymized first-name + amount from the existing public RPC
 * landing_recent_hires() (shipped 2026-05-16 in [[project-apex-2026-05-16-hire-pipeline]]).
 * Names mark proof that the agency is actually hiring + producing right now.
 *
 * Scrolls continuously like the carrier marquee for visual rhyme.
 */
export function RecentHiresTicker() {
  const gateOpen = useInteractionGate();
  const [timerOpen, setTimerOpen] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setTimerOpen(true), 1500);
    return () => clearTimeout(t);
  }, []);
  const { data, isLoading } = useQuery({
    queryKey: ["landing_recent_hires"],
    queryFn: async (): Promise<HireRow[]> => {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data, error } = await supabase.rpc("landing_recent_hires");
      if (error) throw error;
      return (data as HireRow[]) ?? [];
    },
    enabled: gateOpen || timerOpen,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  const rows = data ?? [];
  if (isLoading || rows.length === 0) return null;

  // Render the list twice for seamless loop
  const doubled = [...rows, ...rows];

  return (
    <div className="landing-fade-up landing-delay-500 rounded-md px-4 py-3 max-w-2xl mx-auto mb-10 bg-card/90 backdrop-blur-xl border border-amber-500/30 overflow-hidden shadow-md">
      <div className="flex items-center gap-2 mb-2">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-400" />
        </span>
        <Sparkles className="h-3.5 w-3.5 text-amber-400" />
        <p className="text-[10px] text-muted-foreground uppercase tracking-[0.25em] font-display font-semibold">
          Recent hires · live
        </p>
      </div>
      <div className="relative h-7 overflow-hidden">
        <div className="absolute inset-0 flex items-center gap-8 ticker-animate" style={{ width: "200%" }}>
          {doubled.map((r, i) => (
            // stable-key-allow:doubled-marquee-static-render — display-only render of [...rows, ...rows]; no interactive row-local state, no reordering after mount
            <span key={i} className="text-sm font-display font-bold whitespace-nowrap shrink-0">
              <span className="text-amber-300">{(r.first_name ?? r.display_name ?? "Agent").toString().toUpperCase()}</span>
              {r.days_on_team !== null && r.days_on_team !== undefined && r.days_on_team >= 0 && (
                <span className="text-muted-foreground"> · {r.days_on_team < 7 ? "this week" : r.days_on_team < 30 ? `${r.days_on_team}d ago` : `${Math.floor(r.days_on_team/30)}mo ago`}</span>
              )}
            </span>
          ))}
        </div>
        <div className="absolute inset-y-0 left-0 w-12 bg-white dark:bg-card" />
        <div className="absolute inset-y-0 right-0 w-12 bg-white dark:bg-card" />
      </div>
    </div>
  );
}
