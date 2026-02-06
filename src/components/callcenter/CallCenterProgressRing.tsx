import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { Check, Sparkles } from "lucide-react";
import { useEffect, useState, useRef } from "react";

interface CallCenterProgressRingProps {
  current: number;
  total: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export function CallCenterProgressRing({
  current,
  total,
  size = 80,
  strokeWidth = 6,
  className,
}: CallCenterProgressRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const percent = total > 0 ? (current / total) * 100 : 0;
  const strokeDashoffset = circumference - (percent / 100) * circumference;
  const isComplete = current >= total && total > 0;

  const [showCelebration, setShowCelebration] = useState(false);
  const prevCurrentRef = useRef(current);

  // Trigger celebration when current increases
  useEffect(() => {
    if (current > prevCurrentRef.current && current > 0) {
      setShowCelebration(true);
      setTimeout(() => setShowCelebration(false), 800);
    }
    prevCurrentRef.current = current;
  }, [current]);

  return (
    <div className={cn("relative inline-flex items-center justify-center", className)}>
      {/* Celebration pulse */}
      <AnimatePresence>
        {showCelebration && (
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1.5, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className="absolute inset-0 rounded-full bg-primary/20"
          />
        )}
      </AnimatePresence>

      <svg width={size} height={size} className="transform -rotate-90">
        {/* Background circle with subtle gradient */}
        <defs>
          <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="hsl(160, 84%, 39%)" />
            <stop offset="50%" stopColor="hsl(172, 66%, 50%)" />
            <stop offset="100%" stopColor="hsl(160, 84%, 39%)" />
          </linearGradient>
          <linearGradient id="completeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="hsl(142, 76%, 36%)" />
            <stop offset="100%" stopColor="hsl(172, 66%, 50%)" />
          </linearGradient>
        </defs>

        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-muted/20"
        />

        {/* Progress circle */}
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={isComplete ? "url(#completeGradient)" : "url(#progressGradient)"}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset }}
          transition={{ duration: 0.6, type: "spring", stiffness: 100, damping: 20 }}
        />
      </svg>

      {/* Center content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <AnimatePresence mode="wait">
          {isComplete ? (
            <motion.div
              key="complete"
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              exit={{ scale: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 20 }}
              className="relative"
            >
              <Check className="h-6 w-6 text-green-400" />
              <motion.div
                className="absolute -top-1 -right-1"
                animate={{ rotate: [0, 15, -15, 0] }}
                transition={{ duration: 1, repeat: Infinity, repeatDelay: 2 }}
              >
                <Sparkles className="h-3 w-3 text-yellow-400" />
              </motion.div>
            </motion.div>
          ) : (
            <motion.div key="counting" className="flex flex-col items-center">
              <motion.span
                key={current}
                initial={{ scale: 1.3, opacity: 0, y: -5 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 400, damping: 20 }}
                className="text-lg font-bold text-foreground"
              >
                {current}
              </motion.span>
              <span className="text-[10px] text-muted-foreground">of {total}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Sparkle particles on celebration */}
      <AnimatePresence>
        {showCelebration && (
          <>
            {[0, 60, 120, 180, 240, 300].map((angle, i) => (
              <motion.div
                key={i}
                initial={{ scale: 0, opacity: 1 }}
                animate={{
                  scale: 1,
                  opacity: 0,
                  x: Math.cos((angle * Math.PI) / 180) * 30,
                  y: Math.sin((angle * Math.PI) / 180) * 30,
                }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5, delay: i * 0.03 }}
                className="absolute w-1.5 h-1.5 rounded-full bg-primary"
                style={{
                  left: "50%",
                  top: "50%",
                  marginLeft: -3,
                  marginTop: -3,
                }}
              />
            ))}
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
