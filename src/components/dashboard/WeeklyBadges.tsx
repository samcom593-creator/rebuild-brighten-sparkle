import { motion } from "framer-motion";
import { Trophy, Target, Zap, Flame, Crown, Star } from "lucide-react";
import { useWeeklyBadges, WeeklyBadge } from "@/hooks/useWeeklyBadges";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface WeeklyBadgesProps {
  agentId: string | null;
  compact?: boolean;
}

const iconMap = {
  trophy: Trophy,
  target: Target,
  zap: Zap,
  flame: Flame,
  crown: Crown,
  star: Star,
};

const colorMap = {
  amber: {
    bg: "from-amber-500/20 to-amber-600/10",
    border: "border-amber-500/30",
    text: "text-amber-400",
    glow: "shadow-amber-500/20",
    ring: "ring-amber-500/30",
  },
  emerald: {
    bg: "from-emerald-500/20 to-emerald-600/10",
    border: "border-emerald-500/30",
    text: "text-emerald-400",
    glow: "shadow-emerald-500/20",
    ring: "ring-emerald-500/30",
  },
  violet: {
    bg: "from-violet-500/20 to-violet-600/10",
    border: "border-violet-500/30",
    text: "text-violet-400",
    glow: "shadow-violet-500/20",
    ring: "ring-violet-500/30",
  },
  rose: {
    bg: "from-rose-500/20 to-rose-600/10",
    border: "border-rose-500/30",
    text: "text-rose-400",
    glow: "shadow-rose-500/20",
    ring: "ring-rose-500/30",
  },
  primary: {
    bg: "from-primary/20 to-primary/10",
    border: "border-primary/30",
    text: "text-primary",
    glow: "shadow-primary/20",
    ring: "ring-primary/30",
  },
  cyan: {
    bg: "from-cyan-500/20 to-cyan-600/10",
    border: "border-cyan-500/30",
    text: "text-cyan-400",
    glow: "shadow-cyan-500/20",
    ring: "ring-cyan-500/30",
  },
};

function BadgeIcon({ badge, compact }: { badge: WeeklyBadge; compact?: boolean }) {
  const Icon = iconMap[badge.icon];
  const colors = colorMap[badge.color];
  
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <motion.div
            initial={{ scale: 0, rotate: -180 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ 
              type: "spring", 
              stiffness: 260, 
              damping: 20,
              delay: Math.random() * 0.2
            }}
            whileHover={{ scale: 1.1, rotate: 5 }}
            className={cn(
              "relative flex items-center justify-center rounded-full",
              "bg-gradient-to-br border backdrop-blur-sm",
              "transition-all cursor-pointer",
              colors.bg,
              colors.border,
              compact ? "h-8 w-8" : "h-12 w-12",
              "shadow-lg",
              colors.glow,
              "ring-2",
              colors.ring
            )}
          >
            <Icon className={cn(
              colors.text,
              compact ? "h-4 w-4" : "h-6 w-6"
            )} />
            {/* Shimmer effect */}
            <div className="absolute inset-0 rounded-full overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full animate-[shimmer_2s_infinite]" />
            </div>
          </motion.div>
        </TooltipTrigger>
        <TooltipContent 
          side="bottom" 
          className="bg-card/95 backdrop-blur-sm border-border"
        >
          <div className="text-center">
            <p className={cn("font-bold", colors.text)}>{badge.name}</p>
            <p className="text-xs text-muted-foreground">{badge.description}</p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function WeeklyBadges({ agentId, compact = false }: WeeklyBadgesProps) {
  const { badges, loading } = useWeeklyBadges(agentId);

  if (loading) {
    return (
      <div className={cn("flex items-center gap-2", compact ? "" : "justify-center")}>
        {[1, 2, 3].map((i) => (
          <Skeleton 
            key={i} 
            className={cn(
              "rounded-full",
              compact ? "h-8 w-8" : "h-12 w-12"
            )} 
          />
        ))}
      </div>
    );
  }

  if (badges.length === 0) {
    return compact ? null : (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="text-center py-4"
      >
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-muted/50 text-muted-foreground text-sm">
          <Trophy className="h-4 w-4" />
          <span>No badges earned yet this week. Keep pushing!</span>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "flex flex-wrap items-center gap-2",
        compact ? "" : "justify-center"
      )}
    >
      {badges.map((badge, index) => (
        <BadgeIcon key={badge.id} badge={badge} compact={compact} />
      ))}
    </motion.div>
  );
}

// Standalone card version for profile display
export function WeeklyBadgesCard({ agentId }: { agentId: string | null }) {
  const { badges, loading } = useWeeklyBadges(agentId);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative overflow-hidden rounded-2xl border border-border/50 bg-gradient-to-br from-card via-card to-primary/5 p-6"
    >
      {/* Background decoration */}
      <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-primary/10 blur-3xl" />
      <div className="absolute -left-8 -bottom-8 h-24 w-24 rounded-full bg-violet-500/10 blur-2xl" />
      
      <div className="relative">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-violet-500 shadow-lg shadow-primary/20">
            <Trophy className="h-5 w-5 text-white" />
          </div>
          <div>
            <h3 className="font-bold text-lg">Weekly Badges</h3>
            <p className="text-xs text-muted-foreground">Earned this week</p>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center gap-3 py-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-12 rounded-full" />
            ))}
          </div>
        ) : badges.length === 0 ? (
          <div className="text-center py-6">
            <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-muted/50 mb-3">
              <Trophy className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">
              No badges earned yet this week
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Keep logging your numbers to compete!
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap justify-center gap-3 py-2">
            {badges.map((badge) => (
              <motion.div
                key={badge.id}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", delay: Math.random() * 0.3 }}
                className="flex flex-col items-center gap-2"
              >
                <BadgeIcon badge={badge} />
                <span className={cn(
                  "text-xs font-medium",
                  colorMap[badge.color].text
                )}>
                  {badge.name}
                </span>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}
