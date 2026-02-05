import { forwardRef } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { GradientButton } from "@/components/ui/gradient-button";

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
    <section ref={ref} className="py-24 relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-b from-background via-primary/5 to-background" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,hsl(168_84%_42%/0.15)_0%,transparent_50%)]" />
      
      {/* Animated orbs */}
      <motion.div
        className="absolute top-10 left-1/4 w-64 h-64 bg-primary/10 rounded-full blur-3xl"
        animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.5, 0.3] }}
        transition={{ duration: 8, repeat: Infinity }}
      />
      <motion.div
        className="absolute bottom-10 right-1/4 w-64 h-64 bg-primary/10 rounded-full blur-3xl"
        animate={{ scale: [1.2, 1, 1.2], opacity: [0.5, 0.3, 0.5] }}
        transition={{ duration: 8, repeat: Infinity }}
      />

      <div className="container mx-auto px-4 relative z-10">
        <motion.div
          className="max-w-4xl mx-auto text-center"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          <motion.span
            className="inline-block px-4 py-1.5 rounded-full text-sm font-medium bg-primary/10 text-primary border border-primary/20 mb-6"
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
          >
            Limited Spots Available
          </motion.span>

          <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-6">
            Ready to{" "}
            <span className="gradient-text text-glow">Transform Your Life?</span>
          </h2>

          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-8">
            Join thousands of agents who've built thriving careers with APEX. 
            Your first $100K year is just an application away.
          </p>

          {/* Benefits Grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 max-w-2xl mx-auto mb-10">
            {benefits.map((benefit, index) => (
              <motion.div
                key={index}
                className="flex items-center gap-2 text-sm text-muted-foreground"
                initial={{ opacity: 0, x: -10 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
              >
                <CheckCircle2 className="h-4 w-4 text-primary flex-shrink-0" />
                <span>{benefit}</span>
              </motion.div>
            ))}
          </div>

          {/* CTA Button */}
          <Link to="/apply">
            <GradientButton size="xl" className="group animate-pulse-glow">
              Start Your Application
              <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
            </GradientButton>
          </Link>

          <p className="text-sm text-muted-foreground mt-4">
            Takes less than 5 minutes • No commitment required
          </p>
        </motion.div>
      </div>
    </section>
  );
});

CTASection.displayName = "CTASection";
