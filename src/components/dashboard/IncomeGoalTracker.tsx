import { useState, useEffect, Fragment } from "react";
import { motion } from "framer-motion";
import { Target, Lock, DollarSign, TrendingUp, Calendar, Sparkles, AlertCircle } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface IncomeGoalTrackerProps {
  agentId: string;
}

interface AgentStats {
  avgDealSize: number;
  avgCloseRate: number;
  totalDays: number;
  monthlyALP: number;
}

export function IncomeGoalTracker({ agentId }: IncomeGoalTrackerProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [stats, setStats] = useState<AgentStats | null>(null);
  const [goal, setGoal] = useState<{ income_goal: number; comp_percentage: number } | null>(null);
  const [incomeInput, setIncomeInput] = useState("");
  const [compInput, setCompInput] = useState("75");
  const [isEditing, setIsEditing] = useState(false);

  const currentMonth = new Date().toISOString().slice(0, 7); // e.g., "2026-02"
  const monthName = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });

  useEffect(() => {
    fetchData();
  }, [agentId]);

  const fetchData = async () => {
    try {
      // Get production history
      const { data: production, error: prodError } = await supabase
        .from("daily_production")
        .select("aop, deals_closed, presentations, production_date")
        .eq("agent_id", agentId);

      if (prodError) throw prodError;

      // Calculate stats
      const totalDays = production?.length || 0;
      const totalALP = production?.reduce((sum, p) => sum + Number(p.aop || 0), 0) || 0;
      const totalDeals = production?.reduce((sum, p) => sum + Number(p.deals_closed || 0), 0) || 0;
      const totalPresentations = production?.reduce((sum, p) => sum + Number(p.presentations || 0), 0) || 0;

      // Current month's ALP
      const monthStart = `${currentMonth}-01`;
      const monthlyProduction = production?.filter(p => p.production_date >= monthStart) || [];
      const monthlyALP = monthlyProduction.reduce((sum, p) => sum + Number(p.aop || 0), 0);

      setStats({
        avgDealSize: totalDeals > 0 ? totalALP / totalDeals : 0,
        avgCloseRate: totalPresentations > 0 ? (totalDeals / totalPresentations) * 100 : 0,
        totalDays,
        monthlyALP,
      });

      // Get existing goal for this month
      const { data: existingGoal } = await supabase
        .from("agent_goals")
        .select("income_goal, comp_percentage")
        .eq("agent_id", agentId)
        .eq("month_year", currentMonth)
        .single();

      if (existingGoal) {
        setGoal(existingGoal);
        setIncomeInput(existingGoal.income_goal.toString());
        setCompInput(existingGoal.comp_percentage?.toString() || "75");
      }
    } catch (error) {
      console.error("Error fetching goal data:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveGoal = async () => {
    const income = parseFloat(incomeInput);
    const comp = parseFloat(compInput);

    if (isNaN(income) || income <= 0) {
      toast.error("Please enter a valid income goal");
      return;
    }

    if (isNaN(comp) || comp <= 0 || comp > 100) {
      toast.error("Comp percentage must be between 1 and 100");
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from("agent_goals")
        .upsert({
          agent_id: agentId,
          month_year: currentMonth,
          income_goal: income,
          comp_percentage: comp,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: "agent_id,month_year",
        });

      if (error) throw error;

      setGoal({ income_goal: income, comp_percentage: comp });
      setIsEditing(false);
      toast.success("Income goal saved!");
    } catch (error: any) {
      console.error("Error saving goal:", error);
      toast.error("Failed to save goal");
    } finally {
      setSaving(false);
    }
  };

  const isLocked = (stats?.totalDays || 0) < 7;
  const daysRemaining = 7 - (stats?.totalDays || 0);

  // Calculate projections
  const incomeGoal = goal?.income_goal || 0;
  const compPercent = goal?.comp_percentage || 75;
  const requiredALP = incomeGoal > 0 ? incomeGoal / (compPercent / 100) : 0;
  const dealsNeeded = stats?.avgDealSize && stats.avgDealSize > 0 
    ? requiredALP / stats.avgDealSize 
    : 0;
  const presentationsNeeded = stats?.avgCloseRate && stats.avgCloseRate > 0 
    ? dealsNeeded / (stats.avgCloseRate / 100) 
    : 0;

  const progressPercent = requiredALP > 0 
    ? Math.min(100, ((stats?.monthlyALP || 0) / requiredALP) * 100) 
    : 0;

  if (loading) {
    return (
      <GlassCard className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-muted rounded w-1/3" />
          <div className="h-24 bg-muted rounded" />
        </div>
      </GlassCard>
    );
  }

  return (
    <GlassCard className="overflow-hidden">
      {/* Header */}
      <div className="p-4 sm:p-6 border-b border-border/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 to-violet-500/20 border border-primary/20">
              <Target className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold text-lg">Income Goal</h3>
              <p className="text-xs text-muted-foreground">{monthName}</p>
            </div>
          </div>
          {!isLocked && goal && !isEditing && (
            <Button variant="ghost" size="sm" onClick={() => setIsEditing(true)}>
              Edit Goal
            </Button>
          )}
        </div>
      </div>

      <div className="p-4 sm:p-6">
        <Fragment>
          {/* Locked State */}
          {isLocked && (
            <motion.div
              key="locked"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="text-center py-6"
            >
              <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-muted/50 mb-4">
                <Lock className="h-8 w-8 text-muted-foreground" />
              </div>
              <h4 className="font-semibold text-lg mb-2">Goal Calculator Locked</h4>
              <p className="text-muted-foreground text-sm max-w-sm mx-auto mb-4">
                Log {daysRemaining} more day{daysRemaining !== 1 ? "s" : ""} of production to unlock personalized goal tracking with accurate projections.
              </p>
              <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <Calendar className="h-4 w-4" />
                <span>{stats?.totalDays || 0} of 7 days logged</span>
              </div>
              <Progress value={(stats?.totalDays || 0) / 7 * 100} className="mt-4 max-w-xs mx-auto h-2" />
            </motion.div>
          )}

          {/* Set Goal Form */}
          {!isLocked && (!goal || isEditing) && (
            <motion.div
              key="form"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-4"
            >
              <div className="bg-primary/5 border border-primary/10 rounded-xl p-4 mb-4">
                <div className="flex items-start gap-3">
                  <Sparkles className="h-5 w-5 text-primary mt-0.5" />
                  <div>
                    <p className="font-medium text-sm">Set Your Monthly Income Goal</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Based on your {stats?.totalDays} days of data, we'll calculate exactly how many presentations you need.
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="income-goal">Target Income ($)</Label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="income-goal"
                      type="number"
                      placeholder="5000"
                      value={incomeInput}
                      onChange={(e) => setIncomeInput(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="comp-percent">Comp % (9-month advance)</Label>
                  <div className="relative">
                    <TrendingUp className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="comp-percent"
                      type="number"
                      placeholder="75"
                      value={compInput}
                      onChange={(e) => setCompInput(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <Button onClick={handleSaveGoal} disabled={saving} className="flex-1">
                  {saving ? "Saving..." : "Set Goal"}
                </Button>
                {isEditing && (
                  <Button variant="outline" onClick={() => setIsEditing(false)}>
                    Cancel
                  </Button>
                )}
              </div>
            </motion.div>
          )}

          {/* Goal Dashboard */}
          {!isLocked && goal && !isEditing && (
            <motion.div
              key="dashboard"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              {/* Progress Section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Monthly Progress</span>
                  <span className="font-semibold">{progressPercent.toFixed(0)}%</span>
                </div>
                <div className="relative">
                  <Progress value={progressPercent} className="h-3" />
                  {progressPercent >= 100 && (
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="absolute -right-2 -top-2"
                    >
                      <span className="text-xl">🎉</span>
                    </motion.div>
                  )}
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>${(stats?.monthlyALP || 0).toLocaleString()} earned</span>
                  <span>${requiredALP.toLocaleString()} ALP needed</span>
                </div>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="text-center p-3 rounded-xl bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/10">
                  <p className="text-xl sm:text-2xl font-bold text-primary">
                    ${incomeGoal.toLocaleString()}
                  </p>
                  <p className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wide">Goal</p>
                </div>
                <div className="text-center p-3 rounded-xl bg-gradient-to-br from-violet-500/10 to-violet-500/5 border border-violet-500/10">
                  <p className="text-xl sm:text-2xl font-bold text-violet-400">
                    ${requiredALP.toLocaleString()}
                  </p>
                  <p className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wide">ALP Needed</p>
                </div>
                <div className="text-center p-3 rounded-xl bg-gradient-to-br from-amber-500/10 to-amber-500/5 border border-amber-500/10">
                  <p className="text-xl sm:text-2xl font-bold text-amber-400">
                    {Math.ceil(dealsNeeded)}
                  </p>
                  <p className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wide">Deals</p>
                </div>
                <div className="text-center p-3 rounded-xl bg-gradient-to-br from-emerald-500/10 to-emerald-500/5 border border-emerald-500/10">
                  <p className="text-xl sm:text-2xl font-bold text-emerald-400">
                    {Math.ceil(presentationsNeeded)}
                  </p>
                  <p className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wide">Presentations</p>
                </div>
              </div>

              {/* Personal Stats */}
              <div className="text-xs text-muted-foreground flex flex-wrap items-center justify-center gap-4 pt-2 border-t border-border/50">
                <span>Avg Deal: <strong className="text-foreground">${stats?.avgDealSize.toLocaleString()}</strong></span>
                <span>•</span>
                <span>Close Rate: <strong className="text-foreground">{stats?.avgCloseRate.toFixed(1)}%</strong></span>
                <span>•</span>
                <span>Based on {stats?.totalDays} days</span>
              </div>
            </motion.div>
          )}
        </Fragment>
      </div>
    </GlassCard>
  );
}
