import { useState } from "react";
import { TrendingUp, Award, Clock, Users } from "lucide-react";
import { SectionHeading } from "@/components/ui/section-heading";

const earningsData = {
  fullTime: {
    label: "Licensed Path",
    description: "You already have your state license",
    headline: "Hit the phones day one",
    supporting: "Warm leads on your phone, a dialer that auto-routes, and a manager on the daily huddle. Most new agents close their first deal inside 7 days.",
    bullets: ["Warm leads, no fee", "Dialer + scripts", "Daily team huddle"],
  },
  topProducer: {
    label: "Pre-Licensing Path",
    description: "Not licensed yet",
    headline: "Licensed in 4 weeks",
    supporting: "Course is on us. Pass the state exam, then we plug you straight into warm leads. No quotas, no waiting, no fee to start.",
    bullets: ["Course paid for", "Pass the exam", "Straight into leads"],
  },
};

const milestones = [
  { icon: Clock, label: "First Sale", value: "Inside 7 days", description: "What most new agents see" },
  { icon: TrendingUp, label: "Out of pocket", value: "$0", description: "No leads fee, course on us" },
  { icon: Award, label: "Six Figures", value: "4-6 months", description: "To reach $100K+ pace" },
  { icon: Users, label: "Build Team", value: "Year One", description: "Earn manager overrides" },
];

export function EarningsSection() {
  const [selected, setSelected] = useState<keyof typeof earningsData>("fullTime");
  const data = earningsData[selected];

  return (
    <section id="earnings" className="py-24 relative bg-white dark:bg-[#030712]">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,hsl(168_84%_42%/0.06)_0%,transparent_60%)]" />
      
      <div className="container mx-auto px-4 relative z-10">
        <SectionHeading
          badge="Earnings Potential"
          title="How agents actually make money here"
          subtitle="No hype, no posted screenshots, no fake checks. Pick your starting line — licensed or not — and see what your first 6 months look like."
        />

        {/* Earnings Toggle */}
        <div className="flex justify-center mt-12 mb-8">
          <div className="inline-flex rounded-lg bg-white dark:bg-[#0f172a] border border-[#1e293b] p-1">
            {Object.entries(earningsData).map(([key, value]) => (
              <button
                key={key}
                onClick={() => setSelected(key as keyof typeof earningsData)}
                className={`px-6 py-3 rounded-lg text-sm font-bold font-display transition-all duration-300 ${
                  selected === key
                    ? "bg-[#e8bb2b] text-[#030712] shadow-lg"
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
          <div className="p-8 md:p-12 rounded-md bg-white dark:bg-card border border-[#1e293b] ">
            <div className="text-center mb-8">
              <p className="text-[#94a3b8] mb-2">{data.description}</p>
              <div className="text-4xl md:text-6xl font-extrabold text-[#e8bb2b] text-glow mb-2 font-display">
                {data.headline}
              </div>
              <p className="text-xl text-[#94a3b8]">{data.supporting}</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 border-t border-[#1e293b] pt-8">
              {data.bullets.map((bullet) => (
                <div key={bullet} className="text-center">
                  <div className="text-2xl font-bold text-[#e8bb2b] font-display">{bullet}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Milestones */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-12 max-w-4xl mx-auto">
          {milestones.map((milestone, index) => (
            <div
              key={milestone.label}
              className="reveal p-4 text-center rounded-md bg-white dark:bg-[#0f172a]/80 border border-[#1e293b] hover:border-[#334155] transition-all duration-300"
              style={{ transitionDelay: `${index * 80}ms` }}
            >
              <milestone.icon className="h-6 w-6 text-[#e8bb2b] mx-auto mb-2" />
              <div className="text-lg font-bold text-[#e8bb2b] font-display">{milestone.value}</div>
              <div className="text-sm font-bold text-[#f1f5f9] font-display">{milestone.label}</div>
              <div className="text-xs text-[#8395ab] mt-1">{milestone.description}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
