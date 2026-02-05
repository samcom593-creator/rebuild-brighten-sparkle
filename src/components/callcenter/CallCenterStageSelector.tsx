import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type PipelineStage = 
  | "new" 
  | "contacted" 
  | "qualified" 
  | "contracted" 
  | "onboarding" 
  | "active";

interface StageDef {
  id: PipelineStage;
  label: string;
  color: string;
  bgColor: string;
}

const stages: StageDef[] = [
  { id: "new", label: "New", color: "text-slate-400", bgColor: "bg-slate-500/20" },
  { id: "contacted", label: "Contacted", color: "text-blue-400", bgColor: "bg-blue-500/20" },
  { id: "qualified", label: "Qualified", color: "text-purple-400", bgColor: "bg-purple-500/20" },
  { id: "contracted", label: "Contracted", color: "text-amber-400", bgColor: "bg-amber-500/20" },
  { id: "onboarding", label: "Onboarding", color: "text-teal-400", bgColor: "bg-teal-500/20" },
  { id: "active", label: "Active", color: "text-green-400", bgColor: "bg-green-500/20" },
];

interface CallCenterStageSelectorProps {
  currentStage: PipelineStage;
  onStageChange: (stage: PipelineStage) => void;
  disabled?: boolean;
  className?: string;
}

export function CallCenterStageSelector({
  currentStage,
  onStageChange,
  disabled,
  className,
}: CallCenterStageSelectorProps) {
  const current = stages.find((s) => s.id === currentStage) || stages[0];

  return (
    <div className={cn("space-y-2", className)}>
      <label className="text-xs font-medium text-muted-foreground">Pipeline Stage</label>
      <Select value={currentStage} onValueChange={(v) => onStageChange(v as PipelineStage)} disabled={disabled}>
        <SelectTrigger className={cn("w-full", current.bgColor, current.color, "border-0")}>
          <SelectValue placeholder="Select stage" />
        </SelectTrigger>
        <SelectContent>
          {stages.map((stage) => (
            <SelectItem key={stage.id} value={stage.id}>
              <div className="flex items-center gap-2">
                <div className={cn("w-2 h-2 rounded-full", stage.bgColor.replace("/20", ""))} />
                <span className={stage.color}>{stage.label}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Visual Pipeline */}
      <div className="flex items-center gap-1 mt-3">
        {stages.map((stage, index) => {
          const isActive = stages.findIndex((s) => s.id === currentStage) >= index;
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
    </div>
  );
}
