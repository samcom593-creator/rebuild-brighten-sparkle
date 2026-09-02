import { useState } from "react";
import { BadgeCheck, BarChart3, FileCheck2, GraduationCap, Network, UserPlus } from "lucide-react";
import { SectionHeading } from "@/components/ui/section-heading";

const earningsData = {
  agencyBuilder: {
    label: "Agency Builder",
    description: "You are building a team and need operational leverage",
    headline: "Run the entire agency",
    supporting: "Recruiting, contracting, training progress, hierarchy visibility, production, and follow-up live in one command center.",
    bullets: ["Downline visibility", "Hiring operations", "Agency analytics"],
  },
  licensedProducer: {
    label: "Licensed Producer",
    description: "You already hold an active insurance license",
    headline: "Fast-track to production",
    supporting: "Complete your profile and contracting intake, enter the training roadmap, and see every action required before field release.",
    bullets: ["Contracting intake", "Sales training", "Production dashboard"],
  },
  licensingFastTrack: {
    label: "Get Licensed",
    description: "You are starting without an insurance license",
    headline: "A guided licensing roadmap",
    supporting: "Coursework, exam scheduling, fingerprints, licensing, contracting, and training are organized into one visible progression.",
    bullets: ["Course roadmap", "Milestone tracking", "Licensed handoff"],
  },
};

const milestones = [
  { icon: UserPlus, label: "Recruit", value: "One link", description: "Start the right workflow" },
  { icon: FileCheck2, label: "Contract", value: "One intake", description: "Collect required information" },
  { icon: GraduationCap, label: "Train", value: "Clear steps", description: "Know what comes next" },
  { icon: BarChart3, label: "Produce", value: "Live view", description: "Track personal and team results" },
];

export function EarningsSection() {
  const [selected, setSelected] = useState<keyof typeof earningsData>("agencyBuilder");
  const data = earningsData[selected];

  return (
    <section id="earnings" className="py-24 relative bg-white dark:bg-[#030712]">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,hsl(168_84%_42%/0.06)_0%,transparent_60%)]" />
      
      <div className="container mx-auto px-4 relative z-10">
        <SectionHeading
          badge="Three ways to enter"
          title="Your path changes. The operating system stays connected."
          subtitle="Choose the track that matches where you are now. Each one leads into the same structured agency platform."
        />

        {/* Earnings Toggle */}
        <div className="flex justify-center mt-12 mb-8">
          <div className="inline-flex max-w-full flex-wrap justify-center rounded-lg bg-white dark:bg-[#0f172a] border border-[#1e293b] p-1">
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
              <div className="mb-3 flex items-center justify-center gap-2 text-[#e8bb2b]">
                {selected === "agencyBuilder" ? <Network className="h-5 w-5" /> : <BadgeCheck className="h-5 w-5" />}
                <p className="text-[#94a3b8]">{data.description}</p>
              </div>
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
