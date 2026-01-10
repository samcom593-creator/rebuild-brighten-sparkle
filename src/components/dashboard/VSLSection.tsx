import { motion } from "framer-motion";
import { Play, Crown } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";

export function VSLSection() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      className="mb-8"
    >
      {/* Title */}
      <div className="text-center mb-6">
        <div className="flex items-center justify-center gap-2 mb-2">
          <Crown className="h-6 w-6 text-primary" />
          <span className="text-sm font-semibold text-primary uppercase tracking-wider">
            Your Journey
          </span>
        </div>
        <h1 className="text-3xl md:text-4xl font-bold">
          Build Your <span className="gradient-text">Financial Empire</span>
        </h1>
        <h2 className="text-2xl md:text-3xl font-bold text-muted-foreground">
          With APEX
        </h2>
      </div>

      {/* VSL Video Placeholder */}
      <GlassCard className="overflow-hidden">
        <div className="relative aspect-video bg-gradient-to-br from-primary/20 via-emerald-800/30 to-slate-900/50">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.1)_0%,transparent_50%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_80%,rgba(0,0,0,0.2)_0%,transparent_50%)]" />
          
          {/* Play Button */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <motion.div
              className="w-24 h-24 rounded-full bg-primary/90 backdrop-blur-sm flex items-center justify-center shadow-lg shadow-primary/30 cursor-pointer hover:bg-primary transition-colors mb-4"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <Play className="h-10 w-10 text-primary-foreground fill-primary-foreground ml-1" />
            </motion.div>
            <p className="text-white/80 text-sm font-medium bg-black/30 px-4 py-2 rounded-full backdrop-blur-sm">
              Watch: The APEX Success Blueprint
            </p>
          </div>

          {/* Duration Badge */}
          <div className="absolute bottom-4 right-4 px-3 py-1.5 rounded bg-background/80 backdrop-blur-sm text-sm font-medium">
            15:32
          </div>
        </div>
      </GlassCard>
    </motion.div>
  );
}
