import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, Shield, TrendingUp, Users } from "lucide-react";
import { GradientButton } from "@/components/ui/gradient-button";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { useLeadCounter } from "@/hooks/useLeadCounter";

export function HeroSection() {
  const { count, isLoading } = useLeadCounter();

  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-20">
      {/* Background Effects */}
      <div className="absolute inset-0 bg-gradient-to-b from-background via-background to-background/95" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,hsl(168_84%_42%/0.1)_0%,transparent_50%)]" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-primary/5 rounded-full blur-3xl" />
      
      {/* Floating orbs */}
      <motion.div
        className="absolute top-20 left-10 w-32 h-32 bg-primary/10 rounded-full blur-2xl"
        animate={{ y: [0, -20, 0], opacity: [0.3, 0.5, 0.3] }}
        transition={{ duration: 5, repeat: Infinity }}
      />
      <motion.div
        className="absolute bottom-40 right-20 w-48 h-48 bg-primary/10 rounded-full blur-2xl"
        animate={{ y: [0, 20, 0], opacity: [0.2, 0.4, 0.2] }}
        transition={{ duration: 7, repeat: Infinity }}
      />

      <div className="container mx-auto px-4 relative z-10">
        <div className="max-w-5xl mx-auto text-center">
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
              {isLoading ? (
                "Loading..."
              ) : (
                <>
                  <AnimatedCounter value={count} className="text-primary font-bold" />
                  {" "}agents joined this year
                </>
              )}
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
            className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-3xl mx-auto"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
          >
            {[
              { icon: TrendingUp, label: "Top 1% Commission Rates", value: "140-160%" },
              { icon: Users, label: "Exclusive Warm Leads", value: "50-100/week" },
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
        </div>
      </div>

      {/* Scroll indicator */}
      <motion.div
        className="absolute bottom-8 left-1/2 -translate-x-1/2"
        animate={{ y: [0, 10, 0] }}
        transition={{ duration: 2, repeat: Infinity }}
      >
        <div className="w-6 h-10 rounded-full border-2 border-muted-foreground/30 flex items-start justify-center p-2">
          <motion.div
            className="w-1.5 h-1.5 rounded-full bg-primary"
            animate={{ y: [0, 12, 0] }}
            transition={{ duration: 2, repeat: Infinity }}
          />
        </div>
      </motion.div>
    </section>
  );
}
