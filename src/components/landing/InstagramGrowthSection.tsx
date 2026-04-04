import { Instagram, Zap, MessageCircle, Cloud, Repeat2, MousePointerClick, Bot, Heart } from "lucide-react";

const features = [
  {
    icon: MousePointerClick,
    title: "Reactions Pro",
    description:
      "Run mass actions to users who interact with a targeted IG account to gain their attention and click on your profile. (Story likes, Follow/Unf, Post likes, DM)",
  },
  {
    icon: Repeat2,
    title: "Repost Pro",
    description:
      "Run an army of Reels/Slave accounts by Reposting content across hundreds of accounts from a click of a button. Maximise visibility through explore page.",
  },
  {
    icon: Bot,
    title: "AI DMing",
    description:
      "Nurture fans and funnel them to your desired page using our auto AI DM software — across hundreds of accounts at a fixed price. No AI DM cost (free).",
  },
  {
    icon: Cloud,
    title: "Cloud Based",
    description:
      "Our software emulates real Android/iOS devices allowing you to edit profile, change username, post photos, albums and stories on each account through our software and server.",
  },
];

const highlights = [
  { icon: Zap, label: "Mass Interactions" },
  { icon: Repeat2, label: "Bulk Repost" },
  { icon: MessageCircle, label: "AI Conversations" },
  { icon: Heart, label: "Reactions Pro" },
];

export function InstagramGrowthSection() {
  return (
    <section
      id="ig-growth"
      className="relative py-24 px-6 overflow-hidden"
      style={{ background: "linear-gradient(180deg, #030712 0%, #0a1628 50%, #030712 100%)" }}
    >
      {/* Glow accents */}
      <div
        className="absolute top-32 right-1/4 w-[500px] h-[500px] rounded-full opacity-[0.06] pointer-events-none"
        style={{ background: "#E1306C", filter: "blur(120px)" }}
      />
      <div
        className="absolute bottom-20 left-1/3 w-96 h-96 rounded-full opacity-[0.05] pointer-events-none"
        style={{ background: "#22d3a5", filter: "blur(100px)" }}
      />

      <div className="max-w-6xl mx-auto relative z-10">
        {/* Header */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-[#E1306C]/30 bg-[#E1306C]/10 mb-6">
            <Instagram className="h-4 w-4 text-[#E1306C]" />
            <span className="text-xs tracking-[0.25em] uppercase text-[#E1306C] font-bold" style={{ fontFamily: "Syne" }}>
              Instagram Growth — Powered by APEX
            </span>
          </div>

          <h2
            className="text-3xl md:text-5xl font-extrabold text-white mb-4"
            style={{ fontFamily: "Syne", lineHeight: 1.1 }}
          >
            Built by Agency Owners
            <br />
            <span className="text-[#E1306C]">for Agency Owners</span>
          </h2>

          <p className="text-white/50 max-w-2xl mx-auto text-lg leading-relaxed">
            We make it easy for Agencies to run hundreds of slave accounts to attract, nurture and convert fans to paid subs from IG.
          </p>
        </div>

        {/* Feature cards */}
        <div className="grid sm:grid-cols-2 gap-5 mb-16">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="group relative bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 hover:border-[#E1306C]/30 transition-all duration-300"
            >
              <div className="flex items-start gap-4">
                <div className="h-11 w-11 rounded-xl bg-[#E1306C]/10 flex items-center justify-center flex-shrink-0 group-hover:bg-[#E1306C]/20 transition-colors">
                  <feature.icon className="h-5 w-5 text-[#E1306C]" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white mb-2" style={{ fontFamily: "Syne" }}>
                    {feature.title}
                  </h3>
                  <p className="text-white/50 text-sm leading-relaxed">{feature.description}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Highlight chips */}
        <div className="flex flex-wrap justify-center gap-3 mb-12">
          {highlights.map((h) => (
            <div
              key={h.label}
              className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/[0.04] border border-white/[0.08] text-sm text-white/60"
            >
              <h.icon className="h-4 w-4 text-[#E1306C]" />
              {h.label}
            </div>
          ))}
        </div>

        {/* Bottom callout */}
        <div className="relative text-center bg-gradient-to-r from-[#E1306C]/10 via-[#E1306C]/5 to-transparent border border-[#E1306C]/20 rounded-2xl p-8">
          <h3 className="text-xl font-bold text-white mb-3" style={{ fontFamily: "Syne" }}>
            Reactions Pro
          </h3>
          <p className="text-white/50 max-w-xl mx-auto text-sm leading-relaxed">
            Our software uses human-like interaction techniques on IG to captivate the attention of users, diverting it seamlessly from one profile to yours. As a result, more eyes will be drawn to your profile, increasing visibility and engagement.
          </p>
        </div>
      </div>
    </section>
  );
}
