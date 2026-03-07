import { useState } from "react";
import { Check, ChevronRight, Loader2, GraduationCap, BookOpen, BookCheck, CalendarClock, FileCheck, Fingerprint, Clock, Award, CalendarIcon } from "lucide-react";
import { format } from "date-fns";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type LicenseProgress = "unlicensed" | "course_purchased" | "finished_course" | "test_scheduled" | "passed_test" | "fingerprints_done" | "waiting_on_license" | "licensed";

interface LicenseProgressSelectorProps {
  applicationId: string;
  currentProgress: LicenseProgress | null | undefined;
  testScheduledDate?: string | null;
  onProgressUpdated?: () => void;
  className?: string;
}

const progressSteps: { value: LicenseProgress; label: string; icon: React.ElementType; color: string }[] = [
  { value: "unlicensed", label: "Unlicensed", icon: GraduationCap, color: "text-amber-400" },
  { value: "course_purchased", label: "Course Started", icon: BookOpen, color: "text-blue-400" },
  { value: "finished_course", label: "Finished Course", icon: BookCheck, color: "text-indigo-400" },
  { value: "test_scheduled", label: "Test Scheduled", icon: CalendarClock, color: "text-purple-400" },
  { value: "passed_test", label: "Passed Test", icon: FileCheck, color: "text-violet-400" },
  { value: "fingerprints_done", label: "Fingerprints", icon: Fingerprint, color: "text-teal-400" },
  { value: "waiting_on_license", label: "Waiting on License", icon: Clock, color: "text-orange-400" },
  { value: "licensed", label: "Licensed", icon: Award, color: "text-emerald-400" },
];

const progressColors: Record<LicenseProgress, string> = {
  unlicensed: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  course_purchased: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  finished_course: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30",
  test_scheduled: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  passed_test: "bg-violet-500/20 text-violet-400 border-violet-500/30",
  fingerprints_done: "bg-teal-500/20 text-teal-400 border-teal-500/30",
  waiting_on_license: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  licensed: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
};

export function LicenseProgressSelector({
  applicationId,
  currentProgress,
  testScheduledDate,
  onProgressUpdated,
  className,
}: LicenseProgressSelectorProps) {
  const [isUpdating, setIsUpdating] = useState(false);
  const initialProgress: LicenseProgress = currentProgress || "unlicensed";
  const [progress, setProgress] = useState<LicenseProgress>(initialProgress);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [selectedTestDate, setSelectedTestDate] = useState<Date | undefined>(
    testScheduledDate ? new Date(testScheduledDate) : undefined
  );

  const currentStepIndex = progressSteps.findIndex((s) => s.value === progress);
  const currentStep = progressSteps[currentStepIndex] || progressSteps[0];
  const CurrentIcon = currentStep.icon;

  const handleUpdateProgress = async (newProgress: LicenseProgress) => {
    if (newProgress === progress) return;
    
    // If selecting "test_scheduled", show date picker instead of updating immediately
    if (newProgress === "test_scheduled") {
      setShowDatePicker(true);
      return;
    }

    await applyProgressUpdate(newProgress);
  };

  const applyProgressUpdate = async (newProgress: LicenseProgress, testDate?: Date) => {
    setIsUpdating(true);
    try {
      const updateData: Record<string, unknown> = { license_progress: newProgress };
      
      if (newProgress === "licensed") {
        updateData.license_status = "licensed";
      } else if (progress === "licensed") {
        updateData.license_status = "pending";
      }

      if (testDate) {
        updateData.test_scheduled_date = format(testDate, "yyyy-MM-dd");
      }

      const { error } = await supabase
        .from("applications")
        .update(updateData)
        .eq("id", applicationId);

      if (error) throw error;

      setProgress(newProgress);
      const stepLabel = progressSteps.find(s => s.value === newProgress)?.label;
      toast.success(`Updated to: ${stepLabel}${testDate ? ` (${format(testDate, "MMM d, yyyy")})` : ""}`);
      onProgressUpdated?.();

      // Send notification when test date is set
      if (newProgress === "test_scheduled" && testDate) {
        try {
          await supabase.functions.invoke("notify-test-scheduled", {
            body: { applicationId, testDate: format(testDate, "yyyy-MM-dd") },
          });
        } catch (notifyErr) {
          console.error("Failed to send test scheduled notification:", notifyErr);
        }
      }
    } catch (err) {
      console.error("Failed to update license progress:", err);
      toast.error("Failed to update progress");
    } finally {
      setIsUpdating(false);
    }
  };

  const handleTestDateConfirm = (date: Date | undefined) => {
    if (!date) return;
    setSelectedTestDate(date);
    setShowDatePicker(false);
    applyProgressUpdate("test_scheduled", date);
  };

  return (
    <>
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
            <span>{currentStep.label}</span>
            {progress === "test_scheduled" && selectedTestDate && (
              <span className="text-[10px] opacity-70">
                ({format(selectedTestDate, "M/d")})
              </span>
            )}
            <ChevronRight className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56 z-50">
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

      {/* Test Scheduled Date Picker Dialog */}
      <Dialog open={showDatePicker} onOpenChange={setShowDatePicker}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Select Test Date</DialogTitle>
            <p className="text-xs text-muted-foreground">When is the licensing exam scheduled?</p>
          </DialogHeader>
          <Calendar
            mode="single"
            selected={selectedTestDate}
            onSelect={handleTestDateConfirm}
            disabled={(date) => date < new Date()}
            initialFocus
            className="p-3 pointer-events-auto"
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
