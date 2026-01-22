import { useState } from "react";
import { motion } from "framer-motion";
import {
  ClipboardCheck,
  Monitor,
  Users,
  Award,
  ChevronRight,
  Loader2,
  Check,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const ONBOARDING_STAGES = [
  {
    key: "onboarding",
    label: "Onboarding",
    description: "Initial paperwork & contracting",
    icon: ClipboardCheck,
  },
  {
    key: "training_online",
    label: "Training Online",
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
    label: "Evaluated",
    description: "Ready for solo work",
    icon: Award,
  },
] as const;

type OnboardingStage = typeof ONBOARDING_STAGES[number]["key"];

interface OnboardingTrackerProps {
  agentId: string;
  currentStage: OnboardingStage;
  onStageUpdate?: () => void;
  readOnly?: boolean;
}

export function OnboardingTracker({
  agentId,
  currentStage,
  onStageUpdate,
  readOnly = false,
}: OnboardingTrackerProps) {
  const { user, isManager, isAdmin } = useAuth();
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState("");
  const [showNotes, setShowNotes] = useState(false);

  const currentIndex = ONBOARDING_STAGES.findIndex(s => s.key === currentStage);
  const canAdvance = (isManager || isAdmin) && !readOnly && currentIndex < ONBOARDING_STAGES.length - 1;

  const handleAdvanceStage = async () => {
    if (!canAdvance || loading) return;

    const nextStage = ONBOARDING_STAGES[currentIndex + 1];
    if (!nextStage) return;

    setLoading(true);
    try {
      // Update agent's onboarding stage
      const { error: agentError } = await supabase
        .from("agents")
        .update({ 
          onboarding_stage: nextStage.key,
          ...(nextStage.key === "evaluated" ? { onboarding_completed_at: new Date().toISOString() } : {})
        })
        .eq("id", agentId);

      if (agentError) throw agentError;

      // Log the stage transition
      const { error: logError } = await supabase
        .from("agent_onboarding")
        .insert({
          agent_id: agentId,
          stage: nextStage.key,
          notes: notes.trim() || null,
          updated_by: user?.id,
        });

      if (logError) console.error("Error logging onboarding:", logError);

      toast({
        title: "Stage Updated",
        description: `Advanced to ${nextStage.label}`,
      });

      setNotes("");
      setShowNotes(false);
      onStageUpdate?.();
    } catch (err) {
      console.error("Error advancing stage:", err);
      toast({
        title: "Error",
        description: "Failed to update onboarding stage",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <h4 className="text-sm font-medium text-muted-foreground">Onboarding Progress</h4>
      
      {/* Progress Steps */}
      <div className="flex items-center justify-between">
        {ONBOARDING_STAGES.map((stage, index) => {
          const isCompleted = index < currentIndex;
          const isCurrent = index === currentIndex;
          const isPending = index > currentIndex;
          const Icon = stage.icon;

          return (
            <div key={stage.key} className="flex items-center">
              <div className="flex flex-col items-center">
                <motion.div
                  initial={false}
                  animate={{
                    scale: isCurrent ? 1.1 : 1,
                    backgroundColor: isCompleted
                      ? "hsl(var(--primary))"
                      : isCurrent
                      ? "hsl(var(--primary) / 0.2)"
                      : "hsl(var(--muted))",
                  }}
                  className={cn(
                    "w-10 h-10 rounded-full flex items-center justify-center transition-all",
                    isCompleted && "text-primary-foreground",
                    isCurrent && "ring-2 ring-primary ring-offset-2 ring-offset-background",
                    isPending && "text-muted-foreground"
                  )}
                >
                  {isCompleted ? (
                    <Check className="h-5 w-5" />
                  ) : (
                    <Icon className={cn("h-5 w-5", isCurrent && "text-primary")} />
                  )}
                </motion.div>
                <div className="mt-2 text-center hidden sm:block">
                  <p className={cn(
                    "text-xs font-medium",
                    isCurrent && "text-primary",
                    isPending && "text-muted-foreground"
                  )}>
                    {stage.label}
                  </p>
                </div>
              </div>
              
              {/* Connector Line */}
              {index < ONBOARDING_STAGES.length - 1 && (
                <div className="flex-1 mx-2 sm:mx-4">
                  <div className={cn(
                    "h-0.5 w-full transition-colors",
                    index < currentIndex ? "bg-primary" : "bg-muted"
                  )} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Current Stage Info */}
      <div className="bg-muted/50 rounded-lg p-3 mt-4">
        <div className="flex items-center gap-2">
          {(() => {
            const CurrentIcon = ONBOARDING_STAGES[currentIndex]?.icon || ClipboardCheck;
            return <CurrentIcon className="h-4 w-4 text-primary" />;
          })()}
          <span className="text-sm font-medium">
            Current: {ONBOARDING_STAGES[currentIndex]?.label || "Unknown"}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {ONBOARDING_STAGES[currentIndex]?.description || ""}
        </p>
      </div>

      {/* Advance Button & Notes */}
      {canAdvance && (
        <div className="space-y-3 pt-2">
          {showNotes ? (
            <>
              <Textarea
                placeholder="Add notes about this stage transition (optional)..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="text-sm resize-none"
                rows={2}
              />
              <div className="flex gap-2">
                <Button
                  onClick={handleAdvanceStage}
                  disabled={loading}
                  className="flex-1"
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <ChevronRight className="h-4 w-4 mr-2" />
                  )}
                  Advance to {ONBOARDING_STAGES[currentIndex + 1]?.label}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowNotes(false);
                    setNotes("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <Button
              variant="outline"
              onClick={() => setShowNotes(true)}
              className="w-full"
            >
              <ChevronRight className="h-4 w-4 mr-2" />
              Advance to Next Stage
            </Button>
          )}
        </div>
      )}

      {/* Completed Badge */}
      {currentIndex === ONBOARDING_STAGES.length - 1 && (
        <div className="flex items-center gap-2 text-emerald-500 bg-emerald-500/10 rounded-lg p-3">
          <Award className="h-5 w-5" />
          <span className="text-sm font-medium">Onboarding Complete!</span>
        </div>
      )}
    </div>
  );
}
