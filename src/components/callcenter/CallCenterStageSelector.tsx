import { useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { BookOpen, BookCheck, CalendarClock, FileCheck, Fingerprint, Clock, Award, CalendarIcon } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";

export type LicensingStage = 
  | "course_purchased" 
  | "finished_course" 
  | "test_scheduled" 
  | "passed_test" 
  | "fingerprints_done"
  | "waiting_on_license" 
  | "licensed";

interface StageDef {
  id: LicensingStage;
  label: string;
  icon: React.ElementType;
  color: string;
  bgColor: string;
}

const stages: StageDef[] = [
  { id: "course_purchased", label: "Course Started", icon: BookOpen, color: "text-blue-400", bgColor: "bg-blue-500/20" },
  { id: "finished_course", label: "Finished Course", icon: BookCheck, color: "text-indigo-400", bgColor: "bg-indigo-500/20" },
  { id: "test_scheduled", label: "Test Scheduled", icon: CalendarClock, color: "text-purple-400", bgColor: "bg-purple-500/20" },
  { id: "passed_test", label: "Passed Test", icon: FileCheck, color: "text-violet-400", bgColor: "bg-violet-500/20" },
  { id: "fingerprints_done", label: "Fingerprints", icon: Fingerprint, color: "text-teal-400", bgColor: "bg-teal-500/20" },
  { id: "waiting_on_license", label: "Waiting on License", icon: Clock, color: "text-orange-400", bgColor: "bg-orange-500/20" },
  { id: "licensed", label: "Licensed", icon: Award, color: "text-green-400", bgColor: "bg-green-500/20" },
];

interface CallCenterStageSelectorProps {
  currentStage: LicensingStage;
  onStageChange: (stage: LicensingStage) => void;
  testScheduledDate?: string | null;
  onTestDateChange?: (date: Date | undefined) => void;
  disabled?: boolean;
  className?: string;
}

export function CallCenterStageSelector({
  currentStage,
  onStageChange,
  testScheduledDate,
  onTestDateChange,
  disabled,
  className,
}: CallCenterStageSelectorProps) {
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const currentStageIndex = stages.findIndex((s) => s.id === currentStage);
  const current = stages[currentStageIndex] || stages[0];
  const CurrentIcon = current.icon;

  const handleDateSelect = (date: Date | undefined) => {
    onTestDateChange?.(date);
    setDatePickerOpen(false);
  };

  return (
    <div className={cn("space-y-2", className)}>
      <label className="text-xs font-medium text-muted-foreground">Licensing Progress</label>
      <Select value={currentStage} onValueChange={(v) => onStageChange(v as LicensingStage)} disabled={disabled}>
        <SelectTrigger className={cn("w-full", current.bgColor, current.color, "border-0")}>
          <div className="flex items-center gap-2">
            <CurrentIcon className="h-4 w-4" />
            <SelectValue placeholder="Select stage" />
          </div>
        </SelectTrigger>
        <SelectContent>
          {stages.map((stage) => {
            const StageIcon = stage.icon;
            return (
              <SelectItem key={stage.id} value={stage.id}>
                <div className="flex items-center gap-2">
                  <StageIcon className={cn("h-4 w-4", stage.color)} />
                  <span className={stage.color}>{stage.label}</span>
                </div>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>

      {/* Visual Pipeline */}
      <div className="flex items-center gap-1 mt-3">
        {stages.map((stage, index) => {
          const isActive = currentStageIndex >= index;
          return (
            <motion.div
              key={stage.id}
              className={cn(
                "flex-1 h-1.5 rounded-full transition-colors duration-300",
                isActive ? stage.bgColor.replace("/20", "/60") : "bg-muted/30"
              )}
              initial={false}
              animate={{ 
                scale: stage.id === currentStage ? 1.1 : 1,
                opacity: isActive ? 1 : 0.5 
              }}
            />
          );
        })}
      </div>

      {/* Test Date Picker - shown when test_scheduled is active */}
      {currentStage === "test_scheduled" && (
        <div className="mt-3 p-3 rounded-lg bg-purple-500/10 border border-purple-500/30">
          <label className="text-xs text-muted-foreground mb-2 block">
            Test Scheduled Date
          </label>
          <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
            <PopoverTrigger asChild>
              <Button 
                variant="outline" 
                size="sm" 
                className={cn(
                  "w-full justify-start text-left font-normal",
                  !testScheduledDate && "text-muted-foreground"
                )}
                disabled={disabled}
              >
                <CalendarIcon className="h-4 w-4 mr-2" />
                {testScheduledDate 
                  ? format(new Date(testScheduledDate), "MMM d, yyyy")
                  : "Select test date"
                }
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={testScheduledDate ? new Date(testScheduledDate) : undefined}
                onSelect={handleDateSelect}
                initialFocus
                className="pointer-events-auto"
              />
            </PopoverContent>
          </Popover>
        </div>
      )}

      {/* Show test date if set and past the test_scheduled stage */}
      {testScheduledDate && currentStageIndex > stages.findIndex(s => s.id === "test_scheduled") && (
        <div className="mt-2 text-xs text-muted-foreground flex items-center gap-1.5">
          <CalendarIcon className="h-3 w-3" />
          Test was scheduled: {format(new Date(testScheduledDate), "MMM d, yyyy")}
        </div>
      )}
    </div>
  );
}
