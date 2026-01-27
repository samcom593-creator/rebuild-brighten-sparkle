import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Target, Trophy, TrendingUp, Users, Sparkles, CheckCircle2 } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { AnimatedNumber } from "./AnimatedNumber";
import confetti from "canvas-confetti";

interface GoalData {
  label: string;
  current: number;
  target: number;
  icon: React.ReactNode;
  color: string;
  prefix?: string;
}

interface TeamGoalsTrackerProps {
  className?: string;
}

export function TeamGoalsTracker({ className }: TeamGoalsTrackerProps) {
  const [goals, setGoals] = useState<GoalData[]>([]);
  const [loading, setLoading] = useState(true);
  const [celebratedGoals, setCelebratedGoals] = useState<Set<string>>(new Set());

  // Monthly targets - January 2026 adjusted goals
  const MONTHLY_TARGETS = {
    alp: 75000, // $75k team ALP for January
    deals: 40, // 40 deals
    presentations: 150, // 150 presentations
    referrals: 25, // 25 referrals caught
  };

  useEffect(() => {
    fetchTeamProgress();
  }, []);

  const fetchTeamProgress = async () => {
    try {
      // Get first and last day of current month
      const now = new Date();
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split("T")[0];

      const { data, error } = await supabase
        .from("daily_production")
        .select("aop, deals_closed, presentations, referrals_caught")
        .gte("production_date", firstDay)
        .lte("production_date", lastDay);

      if (error) throw error;

      // Aggregate team totals
      const totals = (data || []).reduce(
        (acc, row) => ({
          alp: acc.alp + (row.aop || 0),
          deals: acc.deals + (row.deals_closed || 0),
          presentations: acc.presentations + (row.presentations || 0),
          referrals: acc.referrals + (row.referrals_caught || 0),
        }),
        { alp: 0, deals: 0, presentations: 0, referrals: 0 }
      );

      const newGoals: GoalData[] = [
        {
          label: "Team ALP",
          current: totals.alp,
          target: MONTHLY_TARGETS.alp,
          icon: <TrendingUp className="h-4 w-4" />,
          color: "from-emerald-500 to-teal-500",
          prefix: "$",
        },
        {
          label: "Deals Closed",
          current: totals.deals,
          target: MONTHLY_TARGETS.deals,
          icon: <Trophy className="h-4 w-4" />,
          color: "from-amber-500 to-orange-500",
        },
        {
          label: "Presentations",
          current: totals.presentations,
          target: MONTHLY_TARGETS.presentations,
          icon: <Users className="h-4 w-4" />,
          color: "from-blue-500 to-cyan-500",
        },
        {
          label: "Referrals",
          current: totals.referrals,
          target: MONTHLY_TARGETS.referrals,
          icon: <Sparkles className="h-4 w-4" />,
          color: "from-purple-500 to-pink-500",
        },
      ];

      setGoals(newGoals);

      // Check for newly completed goals and celebrate
      newGoals.forEach((goal) => {
        if (goal.current >= goal.target && !celebratedGoals.has(goal.label)) {
          triggerCelebration();
          setCelebratedGoals((prev) => new Set([...prev, goal.label]));
        }
      });
    } catch (error) {
      console.error("Error fetching team progress:", error);
    } finally {
      setLoading(false);
    }
  };

  const triggerCelebration = () => {
    // Burst from both sides
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { x: 0.1, y: 0.6 },
      colors: ["#10b981", "#14b8a6", "#f59e0b", "#8b5cf6"],
    });
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { x: 0.9, y: 0.6 },
      colors: ["#10b981", "#14b8a6", "#f59e0b", "#8b5cf6"],
    });
  };

  const getProgressPercentage = (current: number, target: number) => {
    return Math.min((current / target) * 100, 100);
  };

  const formatNumber = (num: number, prefix?: string) => {
    if (prefix === "$") {
      return `$${num.toLocaleString()}`;
    }
    return num.toLocaleString();
  };

  const currentMonth = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });

  if (loading) {
    return (
      <GlassCard className={`p-6 ${className}`}>
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-muted rounded w-1/3" />
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-16 bg-muted rounded" />
            ))}
          </div>
        </div>
      </GlassCard>
    );
  }

  return (
    <GlassCard className={`p-6 ${className}`}>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-primary/20 to-emerald-500/20 flex items-center justify-center">
            <Target className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold text-lg">Team Goals</h3>
            <p className="text-xs text-muted-foreground">{currentMonth} Targets</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Goals Hit</p>
          <p className="text-lg font-bold text-primary">
            {goals.filter((g) => g.current >= g.target).length} / {goals.length}
          </p>
        </div>
      </div>

      <div className="space-y-5">
        <AnimatePresence>
          {goals.map((goal, index) => {
            const percentage = getProgressPercentage(goal.current, goal.target);
            const isComplete = goal.current >= goal.target;

            return (
              <motion.div
                key={goal.label}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.1 }}
                className="space-y-2"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div
                      className={`h-7 w-7 rounded-lg bg-gradient-to-br ${goal.color} flex items-center justify-center text-white`}
                    >
                      {isComplete ? <CheckCircle2 className="h-4 w-4" /> : goal.icon}
                    </div>
                    <span className="text-sm font-medium">{goal.label}</span>
                    {isComplete && (
                      <motion.span
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        className="text-xs bg-emerald-500/20 text-emerald-500 px-2 py-0.5 rounded-full font-medium"
                      >
                        🎉 Goal Met!
                      </motion.span>
                    )}
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-semibold">
                      <AnimatedNumber
                        value={goal.current}
                        prefix={goal.prefix}
                        className="text-foreground"
                      />
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {" "}
                      / {formatNumber(goal.target, goal.prefix)}
                    </span>
                  </div>
                </div>

                <div className="relative">
                  <div className="h-3 w-full overflow-hidden rounded-full bg-secondary/50">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${percentage}%` }}
                      transition={{ duration: 1, delay: index * 0.1, ease: "easeOut" }}
                      className={`h-full bg-gradient-to-r ${goal.color} relative`}
                    >
                      {percentage > 10 && (
                        <div className="absolute inset-0 bg-white/20 animate-pulse" />
                      )}
                    </motion.div>
                  </div>
                  <motion.span
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.5 + index * 0.1 }}
                    className={`absolute -top-0.5 text-[10px] font-bold ${
                      isComplete ? "text-emerald-500" : "text-muted-foreground"
                    }`}
                    style={{ left: `${Math.min(percentage, 95)}%` }}
                  >
                    {Math.round(percentage)}%
                  </motion.span>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Motivational footer */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8 }}
        className="mt-6 pt-4 border-t border-border/50"
      >
        {goals.filter((g) => g.current >= g.target).length === goals.length ? (
          <div className="text-center">
            <p className="text-sm font-medium text-emerald-500 flex items-center justify-center gap-2">
              <Trophy className="h-4 w-4" />
              All goals achieved! Incredible month! 🏆
            </p>
          </div>
        ) : (
          <div className="text-center">
            <p className="text-xs text-muted-foreground">
              {goals.filter((g) => g.current >= g.target).length === 0
                ? "Let's crush these targets together! 💪"
                : `${goals.length - goals.filter((g) => g.current >= g.target).length} more goals to go. Keep pushing!`}
            </p>
          </div>
        )}
      </motion.div>
    </GlassCard>
  );
}
