import { useState } from "react";
import { TrendingUp, Award, Clock, Users } from "lucide-react";
import { SectionHeading } from "@/components/ui/section-heading";

const earningsData = {
  fullTime: {
    label: "Licensed Path",
    description: "For agents ready to write soon",
    headline: "Lead, train, and close",
    supporting: "Warm lead flow, coaching, and accountability once you're licensed.",
    bullets: ["Warm lead access", "Sales training", "Carrier-ready process"],
  },
  topProducer: {
    label: "Pre-Licensing Path",
    description: "For agents still getting licensed",
    headline: "Clear next steps",
    supporting: "Video, guide, course link, and a simple path into onboarding once you finish.",
    bullets: ["Video overview", "Licensing guide", "Course + onboarding call"],
  },
};

const milestones = [
  { icon: Clock, label: "First Sale", value: "First Day", description: "Average time to first close" },
  { icon: TrendingUp, label: "Break Even", value: "Immediate", description: "Time to profitability" },
  { icon: Award, label: "Six Figures", value: "4-6 months", description: "To reach $100K+ pace" },
  { icon: Users, label: "Build Team", value: "Year One", description: "Earn manager overrides" },
];

export function EarningsSection() {
  const [selected, setSelected] = useState<keyof typeof earningsData>("fullTime");
  const data = earningsData[selected];

  return (
    <section id="earnings" className="py-24 relative bg-[#030712]">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,hsl(168_84%_42%/0.06)_0%,transparent_60%)]" />
      
      <div className="container mx-auto px-4 relative z-10">
        <SectionHeading
          badge="Earnings Potential"
          title="How The Opportunity Works"
          subtitle="We only show what we can stand behind. APEX gives you the path, the support, and the lead flow once you're ready to sell."
        />

        {/* Earnings Toggle */}
        <div className="flex justify-center mt-12 mb-8">
          <div className="inline-flex rounded-lg bg-[#0f172a] border border-[#1e293b] p-1">
            {Object.entries(earningsData).map(([key, value]) => (
              <button
                key={key}
                onClick={() => setSelected(key as keyof typeof earningsData)}
                className={`px-6 py-3 rounded-lg text-sm font-bold font-display transition-all duration-300 ${
                  selected === key
                    ? "bg-[#22d3a5] text-[#030712] shadow-lg"
                    : "text-[#94a3b8] hover:text-[#f1f5f9]"
                }`}
              >
                {value.label}
              </button>
            ))}
          </div>
        </div>

        {/* Main Earnings Card */}
        <div
          key={selected}
          className="landing-scale-in max-w-4xl mx-auto"
        >
          <div className="p-8 md:p-12 rounded-xl bg-gradient-to-br from-[#0f172a] to-[#070d1b] border border-[#1e293b] shadow-[0_0_40px_hsl(168_84%_42%/0.1)]">
            <div className="text-center mb-8">
              <p className="text-[#94a3b8] mb-2">{data.description}</p>
              <div className="text-4xl md:text-6xl font-extrabold text-[#22d3a5] text-glow mb-2 font-display">
                {data.headline}
              </div>
              <p className="text-xl text-[#94a3b8]">{data.supporting}</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 border-t border-[#1e293b] pt-8">
              {data.bullets.map((bullet) => (
                <div key={bullet} className="text-center">
                  <div className="text-2xl font-bold text-[#22d3a5] font-display">{bullet}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Milestones */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-12 max-w-4xl mx-auto">
          {milestones.map((milestone, index) => (
            <div
              key={index}
              className="reveal p-4 text-center rounded-xl bg-[#0f172a]/80 border border-[#1e293b] hover:border-[#334155] transition-all duration-300"
              style={{ transitionDelay: `${index * 80}ms` }}
            >
              <milestone.icon className="h-6 w-6 text-[#22d3a5] mx-auto mb-2" />
              <div className="text-lg font-bold text-[#22d3a5] font-display">{milestone.value}</div>
              <div className="text-sm font-bold text-[#f1f5f9] font-display">{milestone.label}</div>
              <div className="text-xs text-[#64748b] mt-1">{milestone.description}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
