import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { track } from "@/lib/analytics";

const FAQ = [
  {
    q: "Who should book directly with Samuel James?",
    a: "Samuel's calendar is reserved for licensed leaders with five or more agents, or at least $50,000 in monthly production. Everyone else gets routed to the right onboarding strategist first.",
  },
  {
    q: "What if I'm already licensed?",
    a: "Licensed agents move faster. We verify your license, review your carrier fit, and map out the cleanest path to write business through APEX.",
  },
  {
    q: "Do I really not pay for leads?",
    a: "There is no upfront lead bill in the recruiting flow. Lead access is tied to activity, follow-up, and production so serious agents get prioritized.",
  },
  {
    q: "What's my realistic income in month 1, 6, 12?",
    a: "Income depends on licensing speed, calls, appointments, and consistency. The dashboard tracks production so expectations stay tied to real activity instead of hype.",
  },
  {
    q: "Can I keep my job while I get licensed?",
    a: "Yes. Pre-licensing fast-track is 4–6 weeks part-time. Most agents are still at the day job when they write their first 5 policies.",
  },
];

export function RecruitFAQ() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section className="relative py-24 md:py-32">
      {/* subtle radial aurora to lift the section off the page */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-50"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 0%, rgba(20,184,166,0.10), transparent 70%)",
        }}
      />
      <div className="container mx-auto px-4 sm:px-6 max-w-3xl">
        <div className="text-center mb-12 landing-fade-up">
          <p className="text-[10px] text-muted-foreground mb-3 uppercase tracking-[0.3em] font-display font-semibold">
            No salesy spin · straight talk
          </p>
          <h2 className="font-display font-extrabold text-4xl sm:text-5xl tracking-tight">
            Real <span className="brand-gradient">questions</span>, real answers
          </h2>
          <p className="mt-4 text-sm sm:text-base text-muted-foreground max-w-xl mx-auto">
            The questions recruits ask before they commit time, money, and reputation.
          </p>
        </div>
        <div className="space-y-3">
          {FAQ.map((item, i) => {
            const isOpen = open === i;
            return (
              <div
                key={i}
                className={`landing-fade-up rounded-2xl border bg-apex-card backdrop-blur-xl overflow-hidden transition-all duration-300 ${
                  isOpen
                    ? "border-apex-accent/50 shadow-[0_0_0_1px_rgba(20,184,166,0.15),0_20px_60px_-20px_rgba(20,184,166,0.20)]"
                    : "border-apex-border hover:border-apex-accent/30 hover:shadow-lg"
                }`}
              >
                <button
                  type="button"
                  onClick={() => { setOpen(isOpen ? null : i); if (!isOpen) track("recruit_faq_open", { question_index: i }); }}
                  className="w-full flex items-start justify-between gap-4 p-5 sm:p-6 text-left group"
                  aria-expanded={isOpen}
                >
                  <span className="flex items-start gap-3 min-w-0">
                    <span className={`mt-0.5 flex-shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-display font-bold transition-colors ${
                      isOpen ? "bg-apex-accent text-apex-bg" : "bg-apex-hover text-apex-mute group-hover:bg-apex-accent/20 group-hover:text-apex-accent"
                    }`}>{String(i + 1).padStart(2, "0")}</span>
                    <span className="font-display font-bold text-base sm:text-lg leading-snug text-apex-text">{item.q}</span>
                  </span>
                  <ChevronDown className={`h-5 w-5 flex-shrink-0 mt-1 text-apex-mute transition-transform duration-300 ${isOpen ? "rotate-180 text-apex-accent" : "group-hover:text-apex-accent"}`} />
                </button>
                <div
                  className={`grid transition-all duration-300 ease-out ${
                    isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                  }`}
                >
                  <div className="overflow-hidden">
                    <div className="px-5 sm:px-6 pb-6 pl-[60px] text-base text-apex-mute leading-relaxed">
                      {item.a}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": FAQ.map(f => ({ "@type": "Question", "name": f.q,
          "acceptedAnswer": { "@type": "Answer", "text": f.a }})),
      }) }} />
    </section>
  );
}
