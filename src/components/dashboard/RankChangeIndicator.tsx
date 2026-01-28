import { forwardRef } from "react";
import { motion } from "framer-motion";
import { TrendingUp, TrendingDown, Minus, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface RankChangeIndicatorProps {
  change: number | null;
  previousRank: number | null;
  compact?: boolean;
}

// Wrapped motion components with forwardRef for Tooltip compatibility
const MotionSparkle = forwardRef<HTMLDivElement, { compact: boolean }>(
  ({ compact }, ref) => (
    <motion.div
      ref={ref}
      initial={{ scale: 0 }}
      animate={{ scale: 1 }}
      transition={{ type: "spring", stiffness: 500, damping: 25 }}
      className={cn(
        "flex items-center justify-center",
        compact ? "h-4 w-4" : "h-5 w-5"
      )}
    >
      <Sparkles className={cn(
        "text-amber-400",
        compact ? "h-3 w-3" : "h-4 w-4"
      )} />
    </motion.div>
  )
);
MotionSparkle.displayName = "MotionSparkle";

const MotionUp = forwardRef<HTMLDivElement, { change: number; compact: boolean }>(
  ({ change, compact }, ref) => (
    <motion.div
      ref={ref}
      initial={{ y: 5, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: "spring", stiffness: 400 }}
      className={cn(
        "flex items-center gap-0.5 text-emerald-500 font-medium",
        compact ? "text-[10px]" : "text-xs"
      )}
    >
      <TrendingUp className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
      <span>+{change}</span>
    </motion.div>
  )
);
MotionUp.displayName = "MotionUp";

const MotionDown = forwardRef<HTMLDivElement, { change: number; compact: boolean }>(
  ({ change, compact }, ref) => (
    <motion.div
      ref={ref}
      initial={{ y: -5, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: "spring", stiffness: 400 }}
      className={cn(
        "flex items-center gap-0.5 text-rose-500 font-medium",
        compact ? "text-[10px]" : "text-xs"
      )}
    >
      <TrendingDown className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
      <span>{change}</span>
    </motion.div>
  )
);
MotionDown.displayName = "MotionDown";

export function RankChangeIndicator({ 
  change, 
  previousRank, 
  compact = false 
}: RankChangeIndicatorProps) {
  // New to leaderboard
  if (change === null) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <MotionSparkle compact={compact} />
          </TooltipTrigger>
          <TooltipContent side="left" className="text-xs">
            New on leaderboard!
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // No change
  if (change === 0) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className={cn(
              "flex items-center justify-center text-muted-foreground",
              compact ? "h-4 w-4" : "h-5 w-5"
            )}>
              <Minus className={compact ? "h-3 w-3" : "h-4 w-4"} />
            </div>
          </TooltipTrigger>
          <TooltipContent side="left" className="text-xs">
            Same rank as yesterday
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // Moved up
  if (change > 0) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <MotionUp change={change} compact={compact} />
          </TooltipTrigger>
          <TooltipContent side="left" className="text-xs">
            Moved up {change} spot{change > 1 ? "s" : ""} from #{previousRank}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // Moved down
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <MotionDown change={change} compact={compact} />
        </TooltipTrigger>
        <TooltipContent side="left" className="text-xs">
          Moved down {Math.abs(change)} spot{Math.abs(change) > 1 ? "s" : ""} from #{previousRank}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
