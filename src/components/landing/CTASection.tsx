import { forwardRef } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
// wave-42 (2026-06-08): supabase dynamic-imported inside queryFn. CTASection is a lazy
// chunk that Index.tsx renders eagerly inside a Suspense boundary, so the chunk fetches
// during cold landing. A top-level `import { supabase }` dragged vendor-supabase (45 KB
// gz) into the cold-landing modulepreload graph as a static dep of this chunk. Pushing
// the import into the async queryFn body means CTASection's chunk has zero static edge
// to vendor-supabase — supabase only loads if React Query actually fires the queryFn.

const benefits = [
  "No experience required",
  "Free training & mentorship",
  "Exclusive warm leads provided",
  "Work from anywhere",
  "Daily pay",
  "7-figure income potential",
];

type LandingLiveStats = { active_agents: number };

export const CTASection = forwardRef<HTMLElement>((_, ref) => {
  // Pull the real agent count from landing_live_stats() so the closing CTA
  // never claims a number that isn't true. Prior copy said "thousands of
  // agents" — actual roster is ~95. Fake-success killer.
  const { data: liveStats } = useQuery({
    queryKey: ["landing_live_stats"],
    queryFn: async (): Promise<LandingLiveStats | null> => {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data, error } = await supabase.rpc("landing_live_stats");
      if (error) throw error;
      return data as unknown as LandingLiveStats;
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
  const activeAgents = liveStats?.active_agents ?? 95;

  return (
    <section ref={ref} className="py-24 relative overflow-hidden bg-[#030712]">
      {/* Accent bars */}
      <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[#22d3a5] to-transparent opacity-40" />

      <div className="container mx-auto px-4 relative z-10">
        <div className="reveal max-w-4xl mx-auto text-center">
          <span className="landing-scale-in inline-block px-4 py-1.5 rounded-full text-sm font-bold font-display bg-[#22d3a5]/10 text-[#22d3a5] border border-[#22d3a5]/20 mb-6">
            Limited Spots Available
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
            <Link to="/apply">
              <button className="inline-flex items-center justify-center gap-2 px-10 py-5 text-xl rounded-lg font-bold font-display bg-[#22d3a5] text-[#030712] hover:shadow-[0_0_30px_hsl(168_84%_42%/0.4)] transition-all duration-200 animate-pulse-glow group">
                Start Your Application
                <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
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
      <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[#22d3a5] to-transparent opacity-40" />
    </section>
  );
});

CTASection.displayName = "CTASection";
