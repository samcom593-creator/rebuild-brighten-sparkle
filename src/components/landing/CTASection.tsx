import { forwardRef } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, CheckCircle2 } from "lucide-react";

const benefits = [
  "No experience required",
  "Free training & mentorship",
  "Exclusive warm leads provided",
  "Work from anywhere",
  "Daily pay",
  "7-figure income potential",
];

export const CTASection = forwardRef<HTMLElement>((_, ref) => {
  return (
    <section ref={ref} className="py-24 relative overflow-hidden bg-[#030712]">
      {/* Accent bars */}
      <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[#22d3a5] to-transparent opacity-40" />

      <div className="container mx-auto px-4 relative z-10">
        <motion.div
          className="max-w-4xl mx-auto text-center"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          <motion.span
            className="inline-block px-4 py-1.5 rounded-full text-sm font-bold font-display bg-[#22d3a5]/10 text-[#22d3a5] border border-[#22d3a5]/20 mb-6"
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
          >
            Limited Spots Available
          </motion.span>

          <h2 className="text-4xl md:text-5xl lg:text-6xl font-extrabold mb-6 text-[#f1f5f9] font-display">
            Ready to{" "}
            <span className="text-[#22d3a5] text-glow">Transform Your Life?</span>
          </h2>

          <p className="text-lg md:text-xl text-[#94a3b8] max-w-2xl mx-auto mb-8">
            Join thousands of agents who've built thriving careers with APEX. 
            Your first $100K year is just an application away.
          </p>

          {/* Benefits Grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 max-w-2xl mx-auto mb-10">
            {benefits.map((benefit, index) => (
              <motion.div
                key={index}
                className="flex items-center gap-2 text-sm text-[#94a3b8]"
                initial={{ opacity: 0, x: -10 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
              >
                <CheckCircle2 className="h-4 w-4 text-[#22d3a5] flex-shrink-0" />
                <span>{benefit}</span>
              </motion.div>
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

          <p className="text-sm text-[#64748b] mt-4">
            Takes less than 5 minutes • No commitment required
          </p>
        </motion.div>
      </div>

      {/* Bottom accent bar */}
      <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[#22d3a5] to-transparent opacity-40" />
    </section>
  );
});

CTASection.displayName = "CTASection";
