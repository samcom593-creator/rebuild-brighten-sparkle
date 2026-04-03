import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect, useRef } from "react";
import { ArrowRight, Shield, TrendingUp, Users } from "lucide-react";
import { GradientButton } from "@/components/ui/gradient-button";
import { useLeadCounter } from "@/hooks/useLeadCounter";

const carriers = [
  "National Life Group", "American Amicable", "Aflac", "Ethos Life",
  "Mutual of Omaha", "American Home Life", "Transamerica", "Athene",
  "Foresters", "Americo", "F&G", "Prosperity", "American Equity",
  "North American", "Nationwide", "American National", "AIG",
  "Principal", "Lincoln Financial", "Prudential", "John Hancock", "Protective",
];

export function HeroSection() {
  const { count: dealCount, isLoading: isCountLoading } = useLeadCounter();
  const [currentCarrierIndex, setCurrentCarrierIndex] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const startInterval = () => {
      intervalRef.current = setInterval(() => {
        setCurrentCarrierIndex((prev) => (prev + 1) % carriers.length);
      }, 3000);
    };
    const handleVis = () => {
      if (document.hidden) {
        if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      } else if (!intervalRef.current) { startInterval(); }
    };
    startInterval();
    document.addEventListener("visibilitychange", handleVis);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener("visibilitychange", handleVis);
    };
  }, []);

  return (
    <section className="relative min-h-[100dvh] flex items-center justify-center overflow-hidden pt-24 sm:pt-28 md:pt-32 pb-16">
      {/* Dark background with geometric shapes */}
      <div className="absolute inset-0 bg-[#030712]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,hsl(168_84%_42%/0.08)_0%,transparent_50%)]" />

      {/* Floating geometric shapes (CSS only) */}
      <div className="absolute top-[15%] left-[10%] w-32 h-32 border border-primary/10 rotate-45 rounded-lg opacity-30" />
      <div className="absolute top-[60%] right-[8%] w-24 h-24 border border-primary/15 rotate-12 rounded-full opacity-20" />
      <div className="absolute top-[30%] right-[20%] w-16 h-16 bg-primary/5 rotate-[30deg] rounded-lg opacity-40" />
      <div className="absolute bottom-[20%] left-[15%] w-20 h-20 border border-primary/10 -rotate-12 opacity-25" />
      <div className="absolute top-[70%] left-[50%] w-40 h-40 bg-primary/3 rounded-full blur-3xl opacity-30" />

      <div className="container mx-auto px-4 sm:px-6 relative z-10 w-full">
        <div className="max-w-5xl mx-auto text-center w-full">
          {/* Live Counter Badge */}
          <motion.div
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#0f172a]/80 border border-[#1e293b] mb-8"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#22d3a5] opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-[#22d3a5]" />
            </span>
            <span className="text-sm text-[#94a3b8]">
              <span className="text-[#22d3a5] font-bold font-display">
                {isCountLoading ? "..." : (dealCount || 840).toLocaleString()}
              </span>
              {" "}first-day deals closed
            </span>
          </motion.div>

          {/* Main Headline - Syne 800 */}
          <motion.h1
            className="text-4xl md:text-6xl lg:text-7xl font-extrabold leading-tight mb-6 text-[#f1f5f9] font-display"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            Build Your{" "}
            <span className="text-[#22d3a5] text-glow">Financial Empire</span>
            <br />
            With APEX
          </motion.h1>

          {/* Video Section */}
          <motion.div
            className="w-full max-w-2xl mx-auto px-4 mb-8"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.15 }}
          >
            <div className="aspect-video rounded-xl overflow-hidden border border-[#1e293b] shadow-2xl shadow-primary/5">
              <iframe
                src="https://www.youtube.com/embed/v4Fp3FL9ITo"
                title="APEX Video"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="w-full h-full"
              />
            </div>
          </motion.div>

          {/* Subheadline */}
          <motion.p
            className="text-lg md:text-xl text-[#94a3b8] max-w-3xl mx-auto mb-8"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            Join the fastest-growing life insurance agency in America. Whether you're 
            licensed or just starting out, we provide the leads, training, and support 
            you need to earn <span className="text-[#22d3a5] font-semibold">$150K+ your first year</span>.
          </motion.p>

          {/* CTA Buttons - Green Apply + Outline Schedule */}
          <motion.div
            className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
          >
            <Link to="/apply">
              <button className="inline-flex items-center justify-center gap-2 px-10 py-5 text-xl rounded-lg font-bold font-display bg-[#22d3a5] text-[#030712] hover:shadow-[0_0_30px_hsl(168_84%_42%/0.4)] transition-all duration-200 group">
                Apply Now
                <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
              </button>
            </Link>
            <Link to="/schedule-call">
              <button className="inline-flex items-center justify-center gap-2 px-10 py-5 text-xl rounded-lg font-bold font-display border-2 border-[#22d3a5] text-[#22d3a5] bg-transparent hover:bg-[#22d3a5]/10 transition-all duration-200">
                Schedule Call
              </button>
            </Link>
          </motion.div>

          {/* 3 Stat Pills */}
          <motion.div
            className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-6 max-w-3xl mx-auto mb-8 sm:mb-12"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
          >
            {[
              { icon: TrendingUp, label: "Top 1% Commission Rates", value: "70%-145%" },
              { icon: Users, label: "Warm Leads Ready to Call", value: "166,000 Ready" },
              { icon: Shield, label: "No Experience Required", value: "We Train You" },
            ].map((item, index) => (
              <div
                key={index}
                className="bg-[#0f172a]/80 border border-[#1e293b] rounded-lg p-4 text-center hover:border-[#22d3a5]/30 transition-all duration-300"
              >
                <item.icon className="h-6 w-6 text-[#22d3a5] mx-auto mb-2" />
                <div className="text-lg font-bold text-[#22d3a5] font-display">{item.value}</div>
                <div className="text-sm text-[#94a3b8]">{item.label}</div>
              </div>
            ))}
          </motion.div>

          {/* Rotating Carrier Banner */}
          <motion.div
            className="bg-[#0f172a]/60 border border-[#1e293b] rounded-xl p-4 max-w-xs sm:max-w-lg mx-auto"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.5 }}
          >
            <p className="text-xs text-[#64748b] mb-3 uppercase tracking-wider font-display font-semibold">Partnered with Top Carriers</p>
            <div className="h-10 relative overflow-hidden">
              <AnimatePresence mode="sync">
                <motion.div
                  key={currentCarrierIndex}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ duration: 0.4 }}
                  className="absolute inset-0 flex items-center justify-center"
                >
                  <span className="text-xl font-bold text-[#22d3a5] font-display">
                    {carriers[currentCarrierIndex]}
                  </span>
                </motion.div>
              </AnimatePresence>
            </div>
            <div className="flex justify-center items-center gap-2 mt-3">
              {carriers.slice(0, 6).map((_, index) => (
                <button
                  key={index}
                  onClick={() => setCurrentCarrierIndex(index)}
                  className={`w-2 h-2 rounded-full transition-all ${
                    index === currentCarrierIndex 
                      ? "bg-[#22d3a5] w-6" 
                      : "bg-[#334155] hover:bg-[#475569]"
                  }`}
                  aria-label={`Show carrier ${index + 1}`}
                />
              ))}
              <span className="text-xs text-[#64748b] ml-1">+{carriers.length - 6}</span>
            </div>
            <p className="text-xs text-[#64748b] mt-3 font-medium font-display">
              & 30+ More Top-Rated Carriers
            </p>
          </motion.div>
        </div>
      </div>

      {/* Powered by Apex Financial */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2">
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.6 }}
          transition={{ delay: 1 }}
          className="text-xs text-[#64748b] font-display"
        >
          Powered by Apex Financial
        </motion.p>
      </div>
    </section>
  );
}
