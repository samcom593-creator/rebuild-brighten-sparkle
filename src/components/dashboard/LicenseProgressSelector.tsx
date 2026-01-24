import { useState } from "react";
import { Check, ChevronRight, Loader2, GraduationCap, BookOpen, FileCheck, Clock, Award } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type LicenseProgress = "unlicensed" | "course_purchased" | "passed_test" | "waiting_on_license" | "licensed";

interface LicenseProgressSelectorProps {
  applicationId: string;
  currentProgress: LicenseProgress | null | undefined;
  onProgressUpdated?: () => void;
  className?: string;
}

const progressSteps: { value: LicenseProgress; label: string; icon: React.ElementType; color: string }[] = [
  { value: "unlicensed", label: "Unlicensed", icon: GraduationCap, color: "text-amber-400" },
  { value: "course_purchased", label: "Course Purchased", icon: BookOpen, color: "text-blue-400" },
  { value: "passed_test", label: "Passed Test", icon: FileCheck, color: "text-purple-400" },
  { value: "waiting_on_license", label: "Waiting on License", icon: Clock, color: "text-orange-400" },
  { value: "licensed", label: "Licensed", icon: Award, color: "text-emerald-400" },
];

const progressColors: Record<LicenseProgress, string> = {
  unlicensed: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  course_purchased: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  passed_test: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  waiting_on_license: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  licensed: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
};

export function LicenseProgressSelector({
  applicationId,
  currentProgress,
  onProgressUpdated,
  className,
}: LicenseProgressSelectorProps) {
  const [isUpdating, setIsUpdating] = useState(false);
  const initialProgress: LicenseProgress = currentProgress || "unlicensed";
  const [progress, setProgress] = useState<LicenseProgress>(initialProgress);

  const currentStepIndex = progressSteps.findIndex((s) => s.value === progress);
  const currentStep = progressSteps[currentStepIndex] || progressSteps[0];
  const CurrentIcon = currentStep.icon;

  const handleUpdateProgress = async (newProgress: LicenseProgress) => {
    if (newProgress === progress) return;
    
    setIsUpdating(true);
    try {
      // Update license_progress column
      const updateData: Record<string, unknown> = { license_progress: newProgress };
      
      // Also sync license_status if moving to/from licensed
      if (newProgress === "licensed") {
        updateData.license_status = "licensed";
      } else if (progress === "licensed") {
        // Moving backwards from licensed - set to pending
        updateData.license_status = "pending";
      }

      const { error } = await supabase
        .from("applications")
        .update(updateData)
        .eq("id", applicationId);

      if (error) throw error;

      setProgress(newProgress);
      toast.success(`Updated to: ${progressSteps.find(s => s.value === newProgress)?.label}`);
      onProgressUpdated?.();
    } catch (err) {
      console.error("Failed to update license progress:", err);
      toast.error("Failed to update progress");
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn("gap-2", progressColors[progress], className)}
          disabled={isUpdating}
        >
          {isUpdating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CurrentIcon className="h-4 w-4" />
          )}
          <span className="hidden sm:inline">{currentStep.label}</span>
          <ChevronRight className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          License Progression
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        
        {progressSteps.map((step, index) => {
          const StepIcon = step.icon;
          const isCurrentStep = step.value === progress;
          const isPastStep = index < currentStepIndex;
          
          return (
            <DropdownMenuItem
              key={step.value}
              onClick={() => handleUpdateProgress(step.value)}
              disabled={isUpdating}
              className={cn(
                "flex items-center gap-3 cursor-pointer",
                isCurrentStep && "bg-muted"
              )}
            >
              <div className={cn(
                "flex items-center justify-center w-6 h-6 rounded-full border",
                isCurrentStep ? progressColors[step.value] : isPastStep ? "bg-primary/20 border-primary/30" : "border-border"
              )}>
                {isPastStep ? (
                  <Check className="h-3 w-3 text-primary" />
                ) : (
                  <StepIcon className={cn("h-3 w-3", isCurrentStep ? step.color : "text-muted-foreground")} />
                )}
              </div>
              <span className={cn(
                "flex-1",
                isCurrentStep && "font-medium",
                isPastStep && "text-muted-foreground"
              )}>
                {step.label}
              </span>
              {isCurrentStep && (
                <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/30">
                  Current
                </Badge>
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
