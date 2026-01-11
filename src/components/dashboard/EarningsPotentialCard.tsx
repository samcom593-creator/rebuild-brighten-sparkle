import { motion } from "framer-motion";
import { DollarSign, TrendingUp, Sparkles } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { cn } from "@/lib/utils";

interface EarningsPotentialCardProps {
  leadCount: number;
  valuePerLead?: number; // defaults to $6,000
  className?: string;
}

export function EarningsPotentialCard({ 
  leadCount, 
  valuePerLead = 6000,
  className 
}: EarningsPotentialCardProps) {
  const potentialEarnings = leadCount * valuePerLead;
  
  // Milestone levels
  const milestones = [
    { leads: 10, label: "Starter", emoji: "🌱" },
    { leads: 25, label: "Rising", emoji: "⭐" },
    { leads: 50, label: "Pro", emoji: "🔥" },
    { leads: 100, label: "Elite", emoji: "👑" },
    { leads: 200, label: "Legend", emoji: "💎" },
  ];

  const currentMilestone = milestones.reduce((acc, m) => 
    leadCount >= m.leads ? m : acc
  , milestones[0]);

  const nextMilestone = milestones.find(m => m.leads > leadCount);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className={className}
    >
      <GlassCard className="p-6 relative overflow-hidden">
        {/* Animated background glow */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-emerald-500/10 animate-pulse" />
        
        <div className="relative">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Earning Potential
            </h3>
            <span className="text-2xl">{currentMilestone.emoji}</span>
          </div>

          <div className="text-center py-4">
            <motion.div
              initial={{ scale: 0.5 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 200 }}
              className="inline-flex items-center gap-2"
            >
              <DollarSign className="h-8 w-8 text-primary" />
              <span className="text-4xl font-bold gradient-text">
                {potentialEarnings.toLocaleString()}
              </span>
            </motion.div>
            <p className="text-sm text-muted-foreground mt-2">
              Based on {leadCount} leads × ${valuePerLead.toLocaleString()}/lead
            </p>
          </div>

          <div className="mt-4 p-4 rounded-lg bg-muted/50">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">{currentMilestone.label} Status</span>
              {nextMilestone && (
                <span className="text-xs text-muted-foreground">
                  {nextMilestone.leads - leadCount} leads to {nextMilestone.label}
                </span>
              )}
            </div>
            
            {nextMilestone && (
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-gradient-to-r from-primary to-emerald-400 rounded-full"
                  initial={{ width: 0 }}
                  animate={{ 
                    width: `${(leadCount / nextMilestone.leads) * 100}%` 
                  }}
                  transition={{ duration: 1, ease: "easeOut" }}
                />
              </div>
            )}
          </div>

          <div className="mt-4 flex items-center justify-center gap-2 text-sm text-primary">
            <TrendingUp className="h-4 w-4" />
            <span>Keep growing to unlock higher milestones!</span>
          </div>
        </div>
      </GlassCard>
    </motion.div>
  );
}
