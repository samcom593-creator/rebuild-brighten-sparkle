import { forwardRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useInteractionGate } from "@/shared/hooks/useInteractionGate";
// S11 fix (2026-06-15): relay ?ref= through the closing CTA so the slug
// survives the landing -> /apply hop on the bottom-of-page conversion path.
import { applyHrefWithRef } from "@/lib/refSlug";
// wave-42 (2026-06-08): supabase dynamic-imported inside queryFn so the chunk graph
// has no static edge to vendor-supabase. Wave-43 (2026-06-08): wave-42 wasn't enough —
// useQuery still fires queryFn sync-on-mount, which runs the dynamic import inside
// Lighthouse's cold-landing measurement window and re-drags vendor-supabase (45 KB gz)
// onto cold-landing transfers. Wave-43 gates `enabled` on useInteractionGate, matching
// wave-41's LiveStats + RecentHires pattern. The `??95` fallback already renders the
// real number, so anonymous landings see the same pixels until they scroll/click.

const benefits = [
  "No experience required",
  "Free training & mentorship",
  "Exclusive warm leads provided",
  "Work from anywhere",
  "Daily pay",
  "Production bonuses up to $25K/mo",
];

type LandingLiveStats = { active_agents: number };

export const CTASection = forwardRef<HTMLElement>((_, ref) => {
  // Pull the real agent count from landing_live_stats() so the closing CTA
  // never claims a number that isn't true. Prior copy said "thousands of
  // agents" — actual roster is ~95. Fake-success killer.
  const gateOpen = useInteractionGate();
  const [searchParams] = useSearchParams();
  const applyHref = applyHrefWithRef(searchParams.get("ref"));
  const { data: liveStats } = useQuery({
    queryKey: ["landing_live_stats"],
    queryFn: async (): Promise<LandingLiveStats | null> => {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data, error } = await supabase.rpc("landing_live_stats");
      if (error) throw error;
      return data as unknown as LandingLiveStats;
    },
    enabled: gateOpen,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
  // 2026-06-19: feb05b97 truth-floor sync — landing_live_stats now returns
  // 41 active (was 123 due to placeholder pollution). 40 is the cold-render
  // floor; live RPC is the source of truth and always wins when present.
  const activeAgents = liveStats?.active_agents ?? 40;

  return (
    <section ref={ref} className="py-24 relative overflow-hidden bg-white dark:bg-[#030712]">
      {/* Accent bars */}
      <div className="absolute top-0 left-0 right-0 h-[2px] bg-white dark:bg-slate-900 opacity-40" />

      <div className="container mx-auto px-4 relative z-10">
        <div className="reveal max-w-4xl mx-auto text-center">
          <span className="landing-scale-in inline-block px-4 py-1.5 rounded-full text-sm font-bold font-display bg-[#22d3a5]/10 text-[#22d3a5] border border-[#22d3a5]/20 mb-6">
            Hold the Standard.
          </span>

          <h2 className="text-4xl md:text-5xl lg:text-6xl font-extrabold mb-6 text-[#f1f5f9] font-display">
            Ready to{" "}
            <span className="text-[#22d3a5] text-glow">Run with the Standard?</span>
          </h2>

          <p className="text-lg md:text-xl text-[#94a3b8] max-w-2xl mx-auto mb-8">
            {activeAgents}+ agents are running the APEX system right now.
            Your first $100K year is one application away.
          </p>

          {/* Benefits Grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 max-w-2xl mx-auto mb-10">
            {benefits.map((benefit, index) => (
              <div
                key={index}
                className="reveal flex items-center gap-2 text-sm text-[#94a3b8]"
                style={{ transitionDelay: `${index * 80}ms` }}
              >
                <CheckCircle2 className="h-4 w-4 text-[#22d3a5] flex-shrink-0" />
                <span>{benefit}</span>
              </div>
            ))}
          </div>

          {/* Two CTA Buttons Side by Side */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link to={applyHref}>
              <button className="inline-flex items-center justify-center gap-2 px-10 py-5 text-xl rounded-lg font-bold font-display bg-[#22d3a5] text-[#030712] hover: transition-all duration-200 animate-pulse-glow group">
                Start Your Application
                <ArrowRight className="h-5 w-5 transition-base group-hover:translate-x-1" />
              </button>
            </Link>
            <Link to="/schedule-call">
              <button className="inline-flex items-center justify-center gap-2 px-10 py-5 text-xl rounded-lg font-bold font-display border-2 border-[#22d3a5] text-[#22d3a5] bg-transparent hover:bg-[#22d3a5]/10 transition-all duration-200">
                Schedule a Call
              </button>
            </Link>
          </div>

          <p className="text-sm text-[#8395ab] mt-4">
            5 minutes to apply • Real reply within 24 hours
          </p>
        </div>
      </div>

      {/* Bottom accent bar */}
      <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-white dark:bg-slate-900 opacity-40" />
    </section>
  );
});

CTASection.displayName = "CTASection";
