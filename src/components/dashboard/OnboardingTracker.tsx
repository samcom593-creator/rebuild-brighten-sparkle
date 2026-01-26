import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ClipboardCheck,
  Monitor,
  Users,
  Award,
  ChevronRight,
  ChevronLeft,
  Loader2,
  Check,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { ConfettiCelebration } from "@/components/dashboard/ConfettiCelebration";
import { useSoundEffects } from "@/hooks/useSoundEffects";

const ONBOARDING_STAGES = [
  {
    key: "onboarding",
    label: "Onboarding",
    description: "Initial paperwork & contracting",
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

  const handleStageChange = async (direction: "forward" | "backward") => {
    if (loading) return;
    
    const targetIndex = direction === "forward" ? currentIndex + 1 : currentIndex - 1;
    if (targetIndex < 0 || targetIndex >= ONBOARDING_STAGES.length) return;

    const targetStage = ONBOARDING_STAGES[targetIndex];
    if (!targetStage) return;

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
          notes: direction === "backward" ? "Moved back to previous stage" : null,
          updated_by: user?.id,
        });

      // Celebration effects for forward progression
      if (direction === "forward") {
        setShowConfetti(true);
        playSound("celebrate");
        
        toast({
          title: `🎉 ${targetStage.label} Unlocked!`,
          description: agentName ? `${agentName} is now in ${targetStage.label}` : `Advanced to ${targetStage.label}`,
        });

        // Special handling for going LIVE
        if (targetStage.key === "evaluated") {
          // Send portal login email
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

          // Trigger Instagram prompt callback
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
        {/* Compact Progress Steps */}
        <div className="flex items-center gap-1">
          {ONBOARDING_STAGES.map((stage, index) => {
            const isCompleted = index < currentIndex;
            const isCurrent = index === currentIndex;
            const Icon = stage.icon;

            return (
              <div key={stage.key} className="flex items-center">
                <motion.div
                  initial={false}
                  animate={{
                    scale: isCurrent ? 1.05 : 1,
                  }}
                  className={cn(
                    "w-7 h-7 rounded-full flex items-center justify-center transition-all",
                    isCompleted && "bg-primary text-primary-foreground",
                    isCurrent && "bg-primary/20 ring-1 ring-primary text-primary",
                    !isCompleted && !isCurrent && "bg-muted text-muted-foreground"
                  )}
                  title={stage.label}
                >
                  {isCompleted ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    <Icon className="h-3 w-3" />
                  )}
                </motion.div>
                
                {/* Connector Line */}
                {index < ONBOARDING_STAGES.length - 1 && (
                  <div className={cn(
                    "w-4 h-0.5 mx-0.5",
                    index < currentIndex ? "bg-primary" : "bg-muted"
                  )} />
                )}
              </div>
            );
          })}
          
          {/* Navigation Buttons */}
          {canNavigate && (
            <div className="flex items-center gap-1 ml-2">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 transition-transform hover:scale-110 active:scale-95"
                onClick={() => handleStageChange("backward")}
                disabled={!canGoBack || loading}
              >
                <ChevronLeft className="h-3 w-3" />
              </Button>
              <AnimatePresence mode="wait">
                <motion.div
                  key={loading ? "loading" : "ready"}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ duration: 0.15 }}
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 transition-transform hover:scale-110 active:scale-95"
                    onClick={() => handleStageChange("forward")}
                    disabled={!canAdvance || loading}
                  >
                    {loading ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                  </Button>
                </motion.div>
              </AnimatePresence>
            </div>
          )}
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
