import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Crown, Play, CheckCircle2, Calendar } from "lucide-react";
import { GradientButton } from "@/components/ui/gradient-button";
import { GlassCard } from "@/components/ui/glass-card";
import { CalendlyEmbed } from "@/components/landing/CalendlyEmbed";

export default function ApplySuccessLicensed() {
  // Replace with your actual Calendly URL
  const calendlyUrl = "https://calendly.com/your-apex-licensed-onboarding";

  return (
    <div className="min-h-screen bg-background py-8 px-4">
      {/* Background Effects */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,hsl(var(--primary)/0.1)_0%,transparent_50%)]" />
      
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-5xl mx-auto relative z-10"
      >
        <GlassCard className="p-6 md:p-10">
          {/* Header */}
          <div className="text-center mb-8">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
              className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-4"
            >
              <CheckCircle2 className="h-8 w-8 text-primary" />
            </motion.div>

            <div className="flex items-center justify-center gap-2 mb-4">
              <Crown className="h-6 w-6 text-primary" />
              <span className="text-lg font-bold gradient-text">APEX Financial</span>
            </div>

            <h1 className="text-2xl md:text-3xl font-bold mb-2">
              Welcome, <span className="gradient-text">Licensed Agent!</span>
            </h1>
            <p className="text-muted-foreground max-w-lg mx-auto">
              Your application has been received. Watch this important video to learn about your next steps with APEX.
            </p>
          </div>

          {/* Video Player Placeholder */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="relative aspect-video rounded-xl overflow-hidden mb-8 bg-gradient-to-br from-emerald-600/20 via-emerald-800/30 to-slate-900/50"
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.1)_0%,transparent_50%)]" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_80%,rgba(0,0,0,0.2)_0%,transparent_50%)]" />
            
            {/* Play Button */}
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <motion.div
                className="w-20 h-20 rounded-full bg-primary/90 backdrop-blur-sm flex items-center justify-center shadow-lg shadow-primary/30 cursor-pointer hover:bg-primary transition-colors mb-4"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <Play className="h-9 w-9 text-primary-foreground fill-primary-foreground ml-1" />
              </motion.div>
              <p className="text-white/80 text-sm font-medium bg-black/30 px-4 py-2 rounded-full backdrop-blur-sm">
                Licensed Agent Onboarding Video
              </p>
            </div>

            {/* Duration Badge */}
            <div className="absolute bottom-4 right-4 px-3 py-1.5 rounded bg-background/80 backdrop-blur-sm text-sm font-medium">
              8:45
            </div>
          </motion.div>

          {/* Key Points */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8"
          >
            {[
              { title: "Fast-Track Contracting", description: "Get contracted within 24-48 hours" },
              { title: "Immediate Lead Access", description: "Start receiving leads right away" },
              { title: "Higher Commission Tier", description: "Licensed agents start at higher rates" },
            ].map((item, index) => (
              <div key={index} className="p-4 rounded-lg bg-muted/50 text-center">
                <h3 className="font-semibold text-sm mb-1">{item.title}</h3>
                <p className="text-xs text-muted-foreground">{item.description}</p>
              </div>
            ))}
          </motion.div>

          {/* Calendly Section */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="mb-8"
          >
            <div className="text-center mb-6">
              <div className="flex items-center justify-center gap-2 mb-2">
                <Calendar className="h-5 w-5 text-primary" />
                <h2 className="text-xl font-bold">Schedule Your Onboarding Call</h2>
              </div>
              <p className="text-sm text-muted-foreground">
                Pick a time that works for you to meet with your dedicated onboarding specialist.
              </p>
            </div>
            
            <div className="rounded-xl overflow-hidden border border-border/50 bg-background/50">
              <CalendlyEmbed url={calendlyUrl} />
            </div>
          </motion.div>

          {/* Back Button */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
            className="text-center"
          >
            <Link to="/">
              <GradientButton variant="outline">
                Back to Home
              </GradientButton>
            </Link>
          </motion.div>
        </GlassCard>
      </motion.div>
    </div>
  );
}