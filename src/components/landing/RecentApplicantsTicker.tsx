// 2026-06-13 · Sam reported "I see no applications". Landing surfaces had
// 0 applicant signals visible to recruiting prospects despite 522 apps in DB.
// This component mirrors RecentHiresTicker pattern · pulls anonymized first
// names + city + state from public RPC landing_recent_applicants() so
// prospects see the LIVE recruiting pipeline.

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import { useInteractionGate } from "@/shared/hooks/useInteractionGate";

interface ApplicantRow {
  first_name: string | null;
  city: string | null;
  state: string | null;
  hours_ago: number | null;
}

export function RecentApplicantsTicker() {
  const gateOpen = useInteractionGate();
  const [timerOpen, setTimerOpen] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setTimerOpen(true), 1500);
    return () => clearTimeout(t);
  }, []);
  const { data, isLoading } = useQuery({
    queryKey: ["landing_recent_applicants"],
    queryFn: async (): Promise<ApplicantRow[]> => {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data, error } = await supabase.rpc("landing_recent_applicants");
      if (error) throw error;
      return (data as ApplicantRow[]) ?? [];
    },
    enabled: gateOpen || timerOpen,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  const rows = data ?? [];
  if (isLoading || rows.length === 0) return null;
  const doubled = [...rows, ...rows];

  return (
    <div className="landing-fade-up landing-delay-450 rounded-md px-4 py-3 max-w-2xl mx-auto mb-6 bg-card/90 backdrop-blur-xl border border-emerald-500/30 overflow-hidden shadow-md">
      <div className="flex items-center gap-2 mb-2">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
        </span>
        <UserPlus className="h-3.5 w-3.5 text-emerald-400" />
        <p className="text-[10px] text-muted-foreground uppercase tracking-[0.25em] font-display font-semibold">
          Applications · live
        </p>
      </div>
      <div className="relative h-7 overflow-hidden">
        <div className="absolute inset-0 flex items-center gap-8 ticker-animate" style={{ width: "200%" }}>
          {doubled.map((r, i) => (
            // stable-key-allow:doubled-marquee-static-render — display-only render of [...rows, ...rows]; no interactive row-local state, no reordering after mount
            <span key={i} className="text-sm font-display font-bold whitespace-nowrap shrink-0">
              <span className="text-emerald-300">{(r.first_name ?? "Applicant").toString().toUpperCase()}</span>
              {r.city && r.state && (
                <span className="text-muted-foreground"> · {r.city}, {r.state}</span>
              )}
              {r.hours_ago !== null && r.hours_ago !== undefined && (
                <span className="text-muted-foreground/70 ml-1">
                  · {r.hours_ago < 1 ? "just now" : r.hours_ago < 24 ? `${r.hours_ago}h ago` : `${Math.floor(r.hours_ago / 24)}d ago`}
                </span>
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
