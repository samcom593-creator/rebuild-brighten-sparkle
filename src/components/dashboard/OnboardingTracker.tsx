import { useState } from "react";
import { motion } from "framer-motion";
import {
  ClipboardCheck,
  Monitor,
  Users,
  Award,
  Loader2,
  Check,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { ConfettiCelebration } from "@/components/dashboard/ConfettiCelebration";
import { useSoundEffects } from "@/hooks/useSoundEffects";

const ONBOARDING_STAGES = [
  {
    key: "onboarding",
    label: "Hired",
    description: "Agent has been hired and onboarded",
    icon: ClipboardCheck,
  },
  {
    key: "training_online",
    label: "In Course",
    description: "Product training & certification",
    icon: Monitor,
  },
  {
    key: "in_field_training",
    label: "In-Field Training",
    description: "Shadowing & ride-alongs",
    icon: Users,
  },
  {
    key: "evaluated",
    label: "Live",
    description: "Active in the field",
    icon: Award,
  },
] as const;

type OnboardingStage = typeof ONBOARDING_STAGES[number]["key"];

interface OnboardingTrackerProps {
  agentId: string;
  agentName?: string;
  currentStage: OnboardingStage;
  onStageUpdate?: () => void;
  onGoLive?: () => void;
  readOnly?: boolean;
}

export function OnboardingTracker({
  agentId,
  agentName,
  currentStage,
  onStageUpdate,
  onGoLive,
  readOnly = false,
}: OnboardingTrackerProps) {
  const { user, isManager, isAdmin } = useAuth();
  const { playSound } = useSoundEffects();
  const [loading, setLoading] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);

  const currentIndex = ONBOARDING_STAGES.findIndex(s => s.key === currentStage);
  const canNavigate = (isManager || isAdmin) && !readOnly;
  const canGoBack = canNavigate && currentIndex > 0;
  const canAdvance = canNavigate && currentIndex < ONBOARDING_STAGES.length - 1;

  const handleStageClick = async (targetIndex: number) => {
    if (loading || !canNavigate) return;
    if (targetIndex === currentIndex) return;

    const targetStage = ONBOARDING_STAGES[targetIndex];
    if (!targetStage) return;

    const isForward = targetIndex > currentIndex;

    // Play click sound immediately for feedback
    playSound("click");
    setLoading(true);
    
    try {
      // Update agent's onboarding stage
      const { error: agentError } = await supabase
        .from("agents")
        .update({ 
          onboarding_stage: targetStage.key,
          ...(targetStage.key === "evaluated" ? { onboarding_completed_at: new Date().toISOString() } : {}),
          ...(targetStage.key === "in_field_training" ? { field_training_started_at: new Date().toISOString() } : {})
        })
        .eq("id", agentId);

      if (agentError) {
        console.error("Agent update error:", agentError);
        throw agentError;
      }

      // Log the stage transition
      await supabase
        .from("agent_onboarding")
        .insert({
          agent_id: agentId,
          stage: targetStage.key,
          notes: isForward ? null : "Moved back to previous stage",
          updated_by: user?.id,
        });

      // Celebration effects for forward progression
      if (isForward) {
        setShowConfetti(true);
        playSound("celebrate");
        
        // Send stage change email notification
        try {
          await supabase.functions.invoke("notify-stage-change", {
            body: {
              agentId,
              previousStage: currentStage,
              newStage: targetStage.key,
              agentName,
            }
          });
        } catch (err) {
          console.error("Error sending stage change notification:", err);
        }
        
        toast({
          title: `🎉 ${targetStage.label} Unlocked!`,
          description: agentName ? `${agentName} is now in ${targetStage.label}` : `Advanced to ${targetStage.label}`,
        });

        // Special handling for going LIVE
        if (targetStage.key === "evaluated") {
          try {
            await supabase.functions.invoke("send-agent-portal-login", {
              body: { agentId }
            });
            
            toast({
              title: "🚀 Portal Login Sent!",
              description: "Agent will receive their dashboard credentials via email",
            });
          } catch (err) {
            console.error("Error sending portal login:", err);
          }

          onGoLive?.();
        }
      } else {
        playSound("whoosh");
        toast({
          title: "Stage Updated",
          description: `Moved back to ${targetStage.label}`,
        });
      }

      onStageUpdate?.();
    } catch (err: any) {
      console.error("Error changing stage:", err);
      playSound("error");
      toast({
        title: "Error",
        description: `Failed to update: ${err.message || "Unknown error"}`,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <ConfettiCelebration 
        trigger={showConfetti} 
        onComplete={() => setShowConfetti(false)} 
      />
      
      <div className="space-y-2">
        {/* Clickable Progress Circles */}
        <div className="flex items-center gap-1">
          {ONBOARDING_STAGES.map((stage, index) => {
            const isCompleted = index < currentIndex;
            const isCurrent = index === currentIndex;
            const isClickable = canNavigate && index !== currentIndex;
            const Icon = stage.icon;

            return (
              <div key={stage.key} className="flex items-center">
                <motion.button
                  type="button"
                  disabled={!isClickable || loading}
                  onClick={() => handleStageClick(index)}
                  whileHover={isClickable ? { scale: 1.15 } : undefined}
                  whileTap={isClickable ? { scale: 0.95 } : undefined}
                  initial={false}
                  animate={{
                    scale: isCurrent ? 1.05 : 1,
                  }}
                  transition={{ type: "spring", stiffness: 400, damping: 20 }}
                  className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center transition-all",
                    isCompleted && "bg-primary text-primary-foreground shadow-lg shadow-primary/30",
                    isCurrent && "bg-primary/20 ring-2 ring-primary text-primary",
                    !isCompleted && !isCurrent && "bg-muted text-muted-foreground",
                    isClickable && "cursor-pointer hover:ring-2 hover:ring-primary/50",
                    !isClickable && "cursor-default"
                  )}
                  title={isClickable ? `Click to move to ${stage.label}` : stage.label}
                >
                  {loading && isCurrent ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : isCompleted ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Icon className="h-3.5 w-3.5" />
                  )}
                </motion.button>
                
                {/* Animated Connector Line */}
                {index < ONBOARDING_STAGES.length - 1 && (
                  <motion.div 
                    className={cn(
                      "w-6 h-0.5 mx-1",
                      index < currentIndex ? "bg-primary" : "bg-muted"
                    )}
                    animate={{
                      backgroundColor: index < currentIndex ? "hsl(var(--primary))" : "hsl(var(--muted))"
                    }}
                    transition={{ duration: 0.3 }}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Current Stage Label */}
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">
            {ONBOARDING_STAGES[currentIndex]?.label}
          </span>
          <span>•</span>
          <span>{ONBOARDING_STAGES[currentIndex]?.description}</span>
        </div>
      </div>
    </>
  );
}
