import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect } from "react";
import { ArrowRight, Shield, TrendingUp, Users } from "lucide-react";
import { GradientButton } from "@/components/ui/gradient-button";
import { useLeadCounter } from "@/hooks/useLeadCounter";

// Carrier logos for rotating banner
const carriers = [
  { name: "National Life Group", shortName: "NLG" },
  { name: "American Amicable", shortName: "AA" },
  { name: "Aflac", shortName: "AFLAC" },
  { name: "Ethos Life", shortName: "ETHOS" },
  { name: "Mutual of Omaha", shortName: "MoO" },
  { name: "American Home Life", shortName: "AHL" },
];

export function HeroSection() {
  const { count: dealCount, isLoading: isCountLoading } = useLeadCounter();
  const [currentCarrierIndex, setCurrentCarrierIndex] = useState(0);

  // Rotate carriers every 3 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentCarrierIndex((prev) => (prev + 1) % carriers.length);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <section className="relative min-h-[100dvh] flex items-center justify-center overflow-hidden pt-32 pb-16 sm:pt-28">
      {/* Background Effects */}
      <div className="absolute inset-0 bg-gradient-to-b from-background via-background to-background/95" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,hsl(168_84%_42%/0.1)_0%,transparent_50%)]" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[100vw] max-w-[800px] h-[100vw] max-h-[800px] bg-primary/5 rounded-full blur-3xl pointer-events-none" />
      
      {/* Floating orbs - hidden on very small screens to prevent overflow */}
      <motion.div
        className="absolute top-20 left-4 sm:left-10 w-20 sm:w-32 h-20 sm:h-32 bg-primary/10 rounded-full blur-2xl pointer-events-none"
        animate={{ y: [0, -20, 0], opacity: [0.3, 0.5, 0.3] }}
        transition={{ duration: 5, repeat: Infinity }}
      />
      <motion.div
        className="absolute bottom-40 right-4 sm:right-20 w-24 sm:w-48 h-24 sm:h-48 bg-primary/10 rounded-full blur-2xl pointer-events-none"
        animate={{ y: [0, 20, 0], opacity: [0.2, 0.4, 0.2] }}
        transition={{ duration: 7, repeat: Infinity }}
      />

      <div className="container mx-auto px-4 sm:px-6 relative z-10 w-full">
        <div className="max-w-5xl mx-auto text-center w-full">
          {/* Live Counter Badge */}
          <motion.div
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass border border-primary/30 mb-8"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-primary" />
            </span>
            <span className="text-sm text-muted-foreground">
              <span className="text-primary font-bold">
                {isCountLoading ? "..." : (dealCount || 840).toLocaleString()}
              </span>
              {" "}first-day deals closed
            </span>
          </motion.div>

          {/* Main Headline */}
          <motion.h1
            className="text-4xl md:text-6xl lg:text-7xl font-bold leading-tight mb-6"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            Build Your{" "}
            <span className="gradient-text text-glow">Financial Empire</span>
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
            <div className="aspect-video rounded-xl overflow-hidden glass border border-primary/20 shadow-2xl">
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
            className="text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto mb-8"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            Join the fastest-growing life insurance agency in America. Whether you're 
            licensed or just starting out, we provide the leads, training, and support 
            you need to earn <span className="text-primary font-semibold">$150K+ your first year</span>.
          </motion.p>

          {/* CTA Buttons */}
          <motion.div
            className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
          >
            <Link to="/apply">
              <GradientButton size="xl" className="group">
                Start Your Journey
                <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
              </GradientButton>
            </Link>
            <a href="#earnings">
              <GradientButton variant="outline" size="xl">
                See Earnings Potential
              </GradientButton>
            </a>
          </motion.div>

          {/* Trust Indicators */}
          <motion.div
            className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-3xl mx-auto mb-12"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
          >
            {[
              { icon: TrendingUp, label: "Top 1% Commission Rates", value: "50%-145%" },
              { icon: Users, label: "Warm Leads Ready to Call", value: "166,000 Ready" },
              { icon: Shield, label: "No Experience Required", value: "We Train You" },
            ].map((item, index) => (
              <div
                key={index}
                className="glass rounded-lg p-4 text-center hover:glow-teal transition-all duration-300"
              >
                <item.icon className="h-6 w-6 text-primary mx-auto mb-2" />
                <div className="text-lg font-bold text-primary">{item.value}</div>
                <div className="text-sm text-muted-foreground">{item.label}</div>
              </div>
            ))}
          </motion.div>

          {/* Rotating Carrier Banner */}
          <motion.div
            className="glass rounded-xl p-4 max-w-lg mx-auto border border-border/50"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.5 }}
          >
            <p className="text-xs text-muted-foreground mb-3 uppercase tracking-wider">Partnered with Top Carriers</p>
            <div className="h-10 relative overflow-hidden">
              <AnimatePresence mode="wait">
                <motion.div
                  key={currentCarrierIndex}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ duration: 0.4 }}
                  className="absolute inset-0 flex items-center justify-center"
                >
                  <span className="text-xl font-bold gradient-text">
                    {carriers[currentCarrierIndex].name}
                  </span>
                </motion.div>
              </AnimatePresence>
            </div>
            <div className="flex justify-center gap-2 mt-3">
              {carriers.map((_, index) => (
                <button
                  key={index}
                  onClick={() => setCurrentCarrierIndex(index)}
                  className={`w-2 h-2 rounded-full transition-all ${
                    index === currentCarrierIndex 
                      ? "bg-primary w-6" 
                      : "bg-muted-foreground/30 hover:bg-muted-foreground/50"
                  }`}
                  aria-label={`Show carrier ${index + 1}`}
                />
              ))}
            </div>
          </motion.div>
        </div>
      </div>

      {/* Powered by Apex Financial Footer */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2">
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.6 }}
          transition={{ delay: 1 }}
          className="text-xs text-muted-foreground"
        >
          Powered by Apex Financial
        </motion.p>
      </div>
    </section>
  );
}
