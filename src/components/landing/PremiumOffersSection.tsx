import { GraduationCap, Dumbbell, Crown } from "lucide-react";
import { OffersPanel } from "@/components/offers/OffersPanel";

/**
 * Public landing block that surfaces Sam's premium one-time offers
 * (King of Sales course, fitness reset, 1:1 work-with-Sam) underneath
 * the existing leads + IG sections. Displayed to logged-out visitors —
 * checkout requires sign-in, the OffersPanel handles that gracefully.
 */
export function PremiumOffersSection() {
  return (
    <section
      id="premium"
      className="relative py-24 px-6 overflow-hidden"
      style={{ background: "linear-gradient(180deg, #030712 0%, #0a1019 50%, #030712 100%)" }}
    >
      <div
        className="absolute top-32 left-1/4 w-[500px] h-[500px] rounded-full opacity-[0.06] pointer-events-none"
        style={{ background: "#FFD700", filter: "blur(120px)" }}
      />
      <div
        className="absolute bottom-20 right-1/3 w-96 h-96 rounded-full opacity-[0.05] pointer-events-none"
        style={{ background: "#22d3a5", filter: "blur(100px)" }}
      />

      <div className="max-w-6xl mx-auto relative z-10">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-yellow-400/30 bg-yellow-400/10 mb-6">
            <Crown className="h-4 w-4 text-yellow-300" />
            <span className="text-xs tracking-[0.25em] uppercase text-yellow-300 font-bold" style={{ fontFamily: "Syne" }}>
              Train · Build · Scale
            </span>
          </div>

          <h2 className="text-3xl md:text-5xl font-extrabold text-white mb-4" style={{ fontFamily: "Syne", lineHeight: 1.1 }}>
            Beyond the Leads.
            <br />
            <span className="text-yellow-300">Build the Operator.</span>
          </h2>

          <p className="text-white/50 max-w-2xl mx-auto text-lg leading-relaxed">
            Three offers Sam personally stakes his name on. Get sharp, get trained, and — when you're ready — get him on a call.
          </p>
        </div>

        {/* The 3 premium offers */}
        <OffersPanel category="course" heading={null} subheading={null} />
        <div className="h-8" />
        <OffersPanel category="fitness" heading={null} subheading={null} />
        <div className="h-8" />
        <OffersPanel category="high_ticket" heading={null} subheading={null} />

        {/* Stats strip */}
        <div className="mt-16 grid grid-cols-3 gap-4 max-w-3xl mx-auto">
          <div className="text-center p-4 rounded-2xl border border-white/[0.06] bg-white/[0.02]">
            <GraduationCap className="h-6 w-6 mx-auto text-blue-400 mb-2" />
            <div className="text-2xl font-bold text-white tabular-nums">627+</div>
            <div className="text-[10px] text-white/40 uppercase tracking-wider">Course lessons</div>
          </div>
          <div className="text-center p-4 rounded-2xl border border-white/[0.06] bg-white/[0.02]">
            <Dumbbell className="h-6 w-6 mx-auto text-rose-400 mb-2" />
            <div className="text-2xl font-bold text-white tabular-nums">30</div>
            <div className="text-[10px] text-white/40 uppercase tracking-wider">Day reset</div>
          </div>
          <div className="text-center p-4 rounded-2xl border border-white/[0.06] bg-white/[0.02]">
            <Crown className="h-6 w-6 mx-auto text-yellow-300 mb-2" />
            <div className="text-2xl font-bold text-white tabular-nums">5</div>
            <div className="text-[10px] text-white/40 uppercase tracking-wider">Slots / month</div>
          </div>
        </div>
      </div>
    </section>
  );
}
