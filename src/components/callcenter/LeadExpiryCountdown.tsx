import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import { Clock, AlertTriangle, CheckCircle2 } from "lucide-react";

interface LeadExpiryCountdownProps {
  createdAt: string;
  contactedAt?: string;
}

export function LeadExpiryCountdown({ createdAt, contactedAt }: LeadExpiryCountdownProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const created = new Date(createdAt);
  const now = new Date();
  const twoWeeksMs = 14 * 24 * 60 * 60 * 1000;

  const elapsed = now.getTime() - created.getTime();
  const remaining = Math.max(0, twoWeeksMs - elapsed);
  const daysRemaining = Math.ceil(remaining / (24 * 60 * 60 * 1000));
  const progress = Math.min(100, (elapsed / twoWeeksMs) * 100);

  const isUrgent = daysRemaining <= 3;
  const isExpired = daysRemaining === 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 25 }}
      className={cn(
        "space-y-2 p-3 rounded-xl border transition-all duration-300",
        isExpired
          ? "bg-red-500/10 border-red-500/30"
          : isUrgent
          ? "bg-amber-500/10 border-amber-500/30"
          : "bg-muted/20 border-border/30"
      )}
    >
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <motion.div
            animate={
              isUrgent && !isExpired
                ? { scale: [1, 1.15, 1], opacity: [1, 0.7, 1] }
                : {}
            }
            transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
          >
            {isExpired ? (
              <AlertTriangle className="h-4 w-4 text-red-500" />
            ) : isUrgent ? (
              <AlertTriangle className="h-4 w-4 text-amber-400" />
            ) : (
              <Clock className="h-4 w-4 text-muted-foreground" />
            )}
          </motion.div>
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className={cn(
              "font-medium",
              isExpired && "text-red-400",
              isUrgent && !isExpired && "text-amber-400",
              !isUrgent && "text-muted-foreground"
            )}
          >
            {isExpired
              ? "Lead Expired"
              : `${daysRemaining} day${daysRemaining !== 1 ? "s" : ""} remaining`}
          </motion.span>
        </div>
        {contactedAt && (
          <motion.span
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 400, damping: 20 }}
            className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 border border-green-500/30 flex items-center gap-1"
          >
            <CheckCircle2 className="h-3 w-3" />
            Contacted
          </motion.span>
        )}
      </div>

      {/* Animated Progress Bar */}
      <div className="relative h-2 rounded-full overflow-hidden bg-muted/30">
        <motion.div
          className={cn(
            "absolute inset-y-0 left-0 rounded-full",
            isExpired
              ? "bg-gradient-to-r from-red-500 to-red-400"
              : isUrgent
              ? "bg-gradient-to-r from-amber-500 to-amber-400"
              : "bg-gradient-to-r from-primary to-primary/80"
          )}
          initial={{ width: 0 }}
          animate={{ width: mounted ? `${progress}%` : 0 }}
          transition={{ duration: 1, ease: "easeOut", delay: 0.2 }}
        />

        {/* Shimmer effect for urgent */}
        {isUrgent && !isExpired && (
          <motion.div
            className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent"
            animate={{ x: ["-100%", "200%"] }}
            transition={{ duration: 1.5, repeat: Infinity, repeatDelay: 1 }}
          />
        )}
      </div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="text-xs text-muted-foreground flex items-center justify-between"
      >
        <span>2-week lead window</span>
        <motion.span
          key={Math.round(progress)}
          initial={{ scale: 1.1 }}
          animate={{ scale: 1 }}
          className="tabular-nums"
        >
          {Math.round(progress)}% elapsed
        </motion.span>
      </motion.p>
    </motion.div>
  );
}
