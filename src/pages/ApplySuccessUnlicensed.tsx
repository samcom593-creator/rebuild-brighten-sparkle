import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Crown, Play, ExternalLink, CheckCircle2 } from "lucide-react";
import { GradientButton } from "@/components/ui/gradient-button";
import { GlassCard } from "@/components/ui/glass-card";

export default function ApplySuccessUnlicensed() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      {/* Background Effects */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,hsl(var(--primary)/0.1)_0%,transparent_50%)]" />
      
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-4xl relative z-10"
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
              Your Journey <span className="gradient-text">Starts Here!</span>
            </h1>
            <p className="text-muted-foreground max-w-lg mx-auto">
              Your application has been received. Watch this video to learn how we'll help you get licensed and start earning.
            </p>
          </div>

          {/* Video Player Placeholder */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="relative aspect-video rounded-xl overflow-hidden mb-8 bg-gradient-to-br from-teal-600/20 via-cyan-700/30 to-slate-900/50"
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
                Getting Licensed with APEX
              </p>
            </div>

            {/* Duration Badge */}
            <div className="absolute bottom-4 right-4 px-3 py-1.5 rounded bg-background/80 backdrop-blur-sm text-sm font-medium">
              12:30
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
              { title: "We Cover Licensing Costs", description: "No upfront costs to get started" },
              { title: "Fast-Track Program", description: "Get licensed in as little as 2 weeks" },
              { title: "Full Training Provided", description: "Learn everything you need to succeed" },
            ].map((item, index) => (
              <div key={index} className="p-4 rounded-lg bg-muted/50 text-center">
                <h3 className="font-semibold text-sm mb-1">{item.title}</h3>
                <p className="text-xs text-muted-foreground">{item.description}</p>
              </div>
            ))}
          </motion.div>

          {/* CTA */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="text-center"
          >
            <p className="text-sm text-muted-foreground mb-4">
              After watching the video, click below to start your licensing process:
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link to="/">
                <GradientButton variant="outline">
                  Back to Home
                </GradientButton>
              </Link>
              <a href="https://calendly.com" target="_blank" rel="noopener noreferrer">
                <GradientButton>
                  Start Licensing Process
                  <ExternalLink className="h-4 w-4 ml-2" />
                </GradientButton>
              </a>
            </div>
          </motion.div>
        </GlassCard>
      </motion.div>
    </div>
  );
}
