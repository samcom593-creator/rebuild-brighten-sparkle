// intentionally-orphan: Retained Galaxy content after the owner chose a two-choice-only homepage; not rendered on the current home.
import { forwardRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { buildPublicRecruitingHref } from "@/lib/publicRecruitingFlow";
const benefits = [
  "Licensed and unlicensed tracks",
  "One-link recruiting and onboarding",
  "Guided contracting operations",
  "Structured training roadmap",
  "Live production visibility",
  "Hierarchy-aware agency reporting",
];

export const CTASection = forwardRef<HTMLElement>((_, ref) => {
  const [searchParams] = useSearchParams();
  const applyHref = buildPublicRecruitingHref("/apply", searchParams);

  return (
    <section ref={ref} className="py-24 relative overflow-hidden bg-white dark:bg-[#030712]">
      {/* Accent bars */}
      <div className="absolute top-0 left-0 right-0 h-[2px] bg-white dark:bg-card opacity-40" />

      <div className="container mx-auto px-4 relative z-10">
        <div className="reveal max-w-4xl mx-auto text-center">
          <span className="landing-scale-in inline-block px-4 py-1.5 rounded-full text-sm font-bold font-display bg-[#e8bb2b]/10 text-[#e8bb2b] border border-[#e8bb2b]/20 mb-6">
            Hold the Standard.
          </span>

          <h2 className="text-4xl md:text-5xl lg:text-6xl font-extrabold mb-6 text-[#f1f5f9] font-display">
            Ready to run your agency{" "}
            <span className="text-[#e8bb2b] text-glow">on one system?</span>
          </h2>

          <p className="text-lg md:text-xl text-[#94a3b8] max-w-2xl mx-auto mb-8">
            Choose the path that fits your current level and see exactly what comes next.
          </p>

          {/* Benefits Grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 max-w-2xl mx-auto mb-10">
            {benefits.map((benefit, index) => (
              <div
                key={benefit}
                className="reveal flex items-center gap-2 text-sm text-[#94a3b8]"
                style={{ transitionDelay: `${index * 80}ms` }}
              >
                <CheckCircle2 className="h-4 w-4 text-[#e8bb2b] flex-shrink-0" />
                <span>{benefit}</span>
              </div>
            ))}
          </div>

          {/* Two CTA Buttons Side by Side */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link to={applyHref} className="inline-flex items-center justify-center gap-2 px-10 py-5 text-xl rounded-lg font-bold font-display bg-[#e8bb2b] text-[#030712] hover: transition-all duration-200 animate-pulse-glow group">
              Start Your Application
              <ArrowRight className="h-5 w-5 transition-base group-hover:translate-x-1" />
            </Link>
            <Link to="/schedule-call" className="inline-flex items-center justify-center gap-2 px-10 py-5 text-xl rounded-lg font-bold font-display border-2 border-[#e8bb2b] text-[#e8bb2b] bg-transparent hover:bg-[#e8bb2b]/10 transition-all duration-200">
              Schedule a Call
            </Link>
          </div>

          <p className="text-sm text-[#8395ab] mt-4">
            One application • Correct path automatically • Clear next action
          </p>
        </div>
      </div>

      {/* Bottom accent bar */}
      <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-white dark:bg-card opacity-40" />
    </section>
  );
});

CTASection.displayName = "CTASection";
