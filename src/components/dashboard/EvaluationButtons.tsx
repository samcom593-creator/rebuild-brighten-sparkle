import { useState } from "react";
import { Check, X, AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

type EvaluationResult = "passed" | "failed" | "probational";

interface EvaluationButtonsProps {
  agentId: string;
  agentName: string;
  currentResult?: string | null;
  onEvaluated?: () => void;
}

export function EvaluationButtons({
  agentId,
  agentName,
  currentResult,
  onEvaluated,
}: EvaluationButtonsProps) {
  const { user } = useAuth();
  const [confirming, setConfirming] = useState<EvaluationResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleEvaluate = async () => {
    if (!confirming || !user) return;

    setSubmitting(true);
    try {
      // Update the agent record
      const updateData: Record<string, unknown> = {
        evaluation_result: confirming,
        evaluated_at: new Date().toISOString(),
        evaluated_by: user.id,
      };

      // If passed or probational, move to evaluated stage
      if (confirming === "passed" || confirming === "probational") {
        updateData.onboarding_stage = "evaluated";
      }

      const { error } = await supabase
        .from("agents")
        .update(updateData)
        .eq("id", agentId);

      if (error) throw error;

      toast.success(`Agent marked as ${confirming}`);
      
      // Trigger notification emails
      try {
        await supabase.functions.invoke("notify-evaluation-result", {
          body: { agentId, result: confirming },
        });
      } catch (notifyError) {
        console.log("Evaluation notification skipped:", notifyError);
      }

      setConfirming(null);
      onEvaluated?.();
    } catch (error) {
      console.error("Error updating evaluation:", error);
      toast.error("Failed to record evaluation");
    } finally {
      setSubmitting(false);
    }
  };

  if (currentResult) {
    const resultColors: Record<string, string> = {
      passed: "text-green-400",
      failed: "text-red-400",
      probational: "text-amber-400",
    };
    
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Evaluation:</span>
        <span className={resultColors[currentResult] || "text-foreground"}>
          {currentResult.charAt(0).toUpperCase() + currentResult.slice(1)}
        </span>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground mr-1">Evaluate:</span>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1 bg-green-500/10 border-green-500/30 text-green-400 hover:bg-green-500/20"
          onClick={() => setConfirming("passed")}
        >
          <Check className="h-3 w-3" />
          Passed
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1 bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20"
          onClick={() => setConfirming("failed")}
        >
          <X className="h-3 w-3" />
          Failed
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1 bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20"
          onClick={() => setConfirming("probational")}
        >
          <AlertTriangle className="h-3 w-3" />
          Probational
        </Button>
      </div>

      <AlertDialog open={!!confirming} onOpenChange={() => setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Evaluation</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to mark <strong>{agentName}</strong> as{" "}
              <strong className={
                confirming === "passed" ? "text-green-400" :
                confirming === "failed" ? "text-red-400" :
                "text-amber-400"
              }>
                {confirming}
              </strong>.
              <br /><br />
              This will send an email notification to the agent, their manager, and admin.
              {(confirming === "passed" || confirming === "probational") && (
                <> The agent will also be moved to the "Evaluated" stage.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleEvaluate} disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Confirming...
                </>
              ) : (
                "Confirm"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
