import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Users, BookOpen, Briefcase, Award, GraduationCap } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

interface PipelineStage {
  stage: string;
  label: string;
  count: number;
  icon: React.ReactNode;
  color: string;
}

export function OnboardingPipelineCard() {
  const { user, isAdmin } = useAuth();
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPipelineData();
  }, [user?.id, isAdmin]);

  const fetchPipelineData = async () => {
    if (!user) return;

    try {
      // Get current user's agent ID
      const { data: currentAgent } = await supabase
        .from("agents")
        .select("id")
        .eq("user_id", user.id)
        .eq("is_deactivated", false)
        .maybeSingle();

      if (!currentAgent) {
        setLoading(false);
        return;
      }

      // Build query based on role
      let query = supabase
        .from("agents")
        .select("onboarding_stage, license_status, has_training_course")
        .eq("is_deactivated", false);

      if (!isAdmin) {
        query = query.eq("invited_by_manager_id", currentAgent.id);
      }

      const { data: agents } = await query;

      if (agents) {
        // Count agents per stage
        const stageCounts: Record<string, number> = {
          onboarding: 0,
          training_online: 0,
          in_field_training: 0,
          evaluated: 0,
        };
        let preLicensingCount = 0;

        agents.forEach(agent => {
          const stage = agent.onboarding_stage || "onboarding";
          if (stageCounts[stage] !== undefined) {
            stageCounts[stage]++;
          }
          if (agent.license_status === "unlicensed" && agent.has_training_course === true) {
            preLicensingCount++;
          }
        });

        setStages([
          {
            stage: "pre_licensing",
            label: "Pre-Licensing",
            count: preLicensingCount,
            icon: <GraduationCap className="h-4 w-4" />,
            color: "text-amber-500 bg-amber-500/10",
          },
          {
            stage: "onboarding",
            label: "Onboarding",
            count: stageCounts.onboarding,
            icon: <Users className="h-4 w-4" />,
            color: "text-blue-500 bg-blue-500/10",
          },
          {
            stage: "training_online",
            label: "Training Online",
            count: stageCounts.training_online,
            icon: <BookOpen className="h-4 w-4" />,
            color: "text-cyan-500 bg-cyan-500/10",
          },
          {
            stage: "in_field_training",
            label: "Field Training",
            count: stageCounts.in_field_training,
            icon: <Briefcase className="h-4 w-4" />,
            color: "text-violet-500 bg-violet-500/10",
          },
          {
            stage: "evaluated",
            label: "Evaluated",
            count: stageCounts.evaluated,
            icon: <Award className="h-4 w-4" />,
            color: "text-emerald-500 bg-emerald-500/10",
          },
        ]);
      }
    } catch (error) {
      console.error("Error fetching pipeline:", error);
    } finally {
      setLoading(false);
    }
  };

  const totalAgents = stages.reduce((sum, s) => sum + s.count, 0);

  if (loading) {
    return (
      <GlassCard className="p-5">
        <div className="animate-pulse space-y-3">
          <div className="h-5 bg-muted rounded w-1/3" />
          <div className="grid grid-cols-4 gap-2">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-16 bg-muted rounded" />
            ))}
          </div>
        </div>
      </GlassCard>
    );
  }

  if (totalAgents === 0) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
    >
      <GlassCard className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            Onboarding Pipeline
          </h3>
          <span className="text-xs text-muted-foreground">{totalAgents} total</span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {stages.map((stage, index) => (
            <motion.div
              key={stage.stage}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: index * 0.1 }}
              className="relative"
            >
              <div className="bg-background/50 rounded-lg p-3 border border-border/50 text-center">
                <div className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center mx-auto mb-2",
                  stage.color
                )}>
                  {stage.icon}
                </div>
                <p className="text-2xl font-bold">{stage.count}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                  {stage.label}
                </p>
              </div>
              
              {/* Progress connector */}
              {index < stages.length - 1 && (
                <div className="hidden md:block absolute top-1/2 -right-1.5 w-3 h-0.5 bg-border" />
              )}
            </motion.div>
          ))}
        </div>
      </GlassCard>
    </motion.div>
  );
}
