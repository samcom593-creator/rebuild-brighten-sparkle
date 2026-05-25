import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { track } from "@/lib/analytics";

const FAQ = [
  {
    q: "How is APEX different from Family First Life or Symmetry?",
    a: "FFL and Symmetry charge you for leads. APEX gives warm leads at no cost — production thresholds keep the flow open. Plus we pay weekly. Most agencies pay monthly.",
  },
  {
    q: "What if I'm already licensed at another agency?",
    a: "Bring your book. We contract you with our carriers and you can write through both during transition. No exclusivity trap.",
  },
  {
    q: "Do I really not pay for leads?",
    a: "Zero upfront. Lead allocation scales with your production. Top producers get the warmest leads first — that's how the system stays fair.",
  },
  {
    q: "What's my realistic income in month 1, 6, 12?",
    a: "Median full-time: ~$3K month 1, ~$8K month 6, ~$12K month 12. Top quartile: 2–3× those numbers. Real receipts in agent dashboard.",
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
      <div className="container mx-auto px-4 sm:px-6 max-w-3xl">
        <div className="text-center mb-12 landing-fade-up">
          <p className="text-[10px] text-muted-foreground mb-3 uppercase tracking-[0.3em] font-display font-semibold">
            Real questions · straight answers
          </p>
          <h2 className="font-display font-extrabold text-4xl sm:text-5xl tracking-tight">
            Common <span className="brand-gradient">objections</span>
          </h2>
        </div>
        <div className="space-y-3">
          {FAQ.map((item, i) => (
            <div key={i} className="landing-fade-up rounded-2xl border border-border/60 bg-card/60 backdrop-blur-xl overflow-hidden hover:border-primary/30 transition-colors">
              <button
                type="button"
                onClick={() => { setOpen(open === i ? null : i); if (open !== i) track("recruit_faq_open", { question_index: i }); }}
                className="w-full flex items-center justify-between gap-4 p-5 sm:p-6 text-left"
              >
                <span className="font-display font-bold text-base sm:text-lg">{item.q}</span>
                <ChevronDown className={`h-5 w-5 flex-shrink-0 text-muted-foreground transition-transform duration-300 ${open === i ? "rotate-180" : ""}`} />
              </button>
              {open === i && (
                <div className="px-5 sm:px-6 pb-6 text-base text-foreground/85 leading-relaxed">
                  {item.a}
                </div>
              )}
            </div>
          ))}
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
