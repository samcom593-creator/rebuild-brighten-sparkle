import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { CheckCircle2, Crown, ArrowRight, Mail, Phone, Calendar, AlertTriangle } from "lucide-react";
import { GradientButton } from "@/components/ui/gradient-button";
import { GlassCard } from "@/components/ui/glass-card";

export default function ApplySuccess() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      {/* Background Effects */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,hsl(168_84%_42%/0.1)_0%,transparent_50%)]" />
      
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-2xl relative z-10"
      >
        <GlassCard className="p-8 md:p-12 text-center">
          {/* Success Icon */}
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
            className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-6"
          >
            <CheckCircle2 className="h-10 w-10 text-primary" />
          </motion.div>

          {/* Logo */}
          <div className="flex items-center justify-center gap-2 mb-6">
            <Crown className="h-8 w-8 text-primary" />
            <span className="text-xl font-bold gradient-text">APEX Financial</span>
          </div>

          <h1 className="text-3xl md:text-4xl font-bold mb-4">
            Application <span className="gradient-text">Received!</span>
          </h1>

          <p className="text-lg text-muted-foreground mb-8 max-w-md mx-auto">
            Thank you for your interest in joining APEX Financial. 
            Our recruiting team will review your application and contact you within 24-48 hours.
          </p>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="flex items-start gap-3 p-4 rounded-lg bg-amber-500/10 border border-amber-500/30 text-left max-w-md mx-auto mb-2"
          >
            <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-sm text-amber-400">Important: Check your spam/junk folder!</p>
              <p className="text-xs text-muted-foreground mt-1">
                Emails from APEX Financial may land in your spam folder. Be sure to check there and mark us as "Not Spam" so you don't miss anything.
              </p>
            </div>
          </motion.div>

          {/* Next Steps */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            {[
              { icon: Mail, title: "Check Email", description: "Confirmation sent to your inbox" },
              { icon: Phone, title: "Expect a Call", description: "We'll reach out within 48 hours" },
              { icon: Calendar, title: "Schedule Interview", description: "Meet with our team" },
            ].map((step, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 + index * 0.1 }}
                className="p-4 rounded-lg bg-muted/50"
              >
                <step.icon className="h-6 w-6 text-primary mx-auto mb-2" />
                <h3 className="font-medium text-sm">{step.title}</h3>
                <p className="text-xs text-muted-foreground">{step.description}</p>
              </motion.div>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link to="/">
              <GradientButton variant="outline">
                Back to Home
              </GradientButton>
            </Link>
            <a href="mailto:careers@apexfinancial.com">
              <GradientButton>
                Contact Us
                <ArrowRight className="h-4 w-4 ml-2" />
              </GradientButton>
            </a>
          </div>
        </GlassCard>
      </motion.div>
    </div>
  );
}
