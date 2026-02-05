import { motion } from "framer-motion";
import {
  CheckCircle2,
  XCircle,
  FileText,
  ChevronRight,
  MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ActionId = "contacted" | "hired" | "contracted" | "bad_applicant";

interface ActionDef {
  id: ActionId;
  label: string;
  icon: React.ElementType;
  color: string;
  gradient: string;
  key: string;
}

const actions: ActionDef[] = [
  {
    id: "contacted",
    label: "Contacted",
    icon: MessageSquare,
    color: "text-teal-400",
    gradient: "from-teal-500/20 to-emerald-500/20 hover:from-teal-500/30 hover:to-emerald-500/30 border-teal-500/30",
    key: "1",
  },
  {
    id: "hired",
    label: "Hired",
    icon: CheckCircle2,
    color: "text-green-400",
    gradient: "from-green-500/20 to-emerald-500/20 hover:from-green-500/30 hover:to-emerald-500/30 border-green-500/30",
    key: "2",
  },
  {
    id: "contracted",
    label: "Contracted",
    icon: FileText,
    color: "text-blue-400",
    gradient: "from-blue-500/20 to-indigo-500/20 hover:from-blue-500/30 hover:to-indigo-500/30 border-blue-500/30",
    key: "3",
  },
  {
    id: "bad_applicant",
    label: "Bad Applicant",
    icon: XCircle,
    color: "text-red-400",
    gradient: "from-red-500/10 to-rose-500/10 hover:from-red-500/20 hover:to-rose-500/20 border-red-500/20",
    key: "4",
  },
];

interface CallCenterActionsProps {
  onAction: (actionId: ActionId) => void;
  onSkip: () => void;
  processing: boolean;
  className?: string;
}

export function CallCenterActions({
  onAction,
  onSkip,
  processing,
  className,
}: CallCenterActionsProps) {
  return (
    <div className={cn("space-y-4", className)}>
      {/* Action Grid */}
      <div className="grid grid-cols-2 gap-3">
        {actions.map((action, index) => (
          <motion.div
            key={action.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
          >
            <Button
              variant="outline"
              size="lg"
              disabled={processing}
              onClick={() => onAction(action.id)}
              className={cn(
                "w-full h-16 relative overflow-hidden transition-all duration-300",
                "bg-gradient-to-br border",
                action.gradient,
                action.color
              )}
            >
              <div className="flex flex-col items-center gap-1">
                <action.icon className="h-5 w-5" />
                <span className="text-xs font-medium">{action.label}</span>
              </div>
              <span className="absolute bottom-1 right-2 text-[10px] opacity-40">
                [{action.key}]
              </span>
            </Button>
          </motion.div>
        ))}
      </div>

      {/* Skip Button */}
      <Button
        variant="ghost"
        size="lg"
        onClick={onSkip}
        disabled={processing}
        className="w-full group hover:bg-muted/50"
      >
        <span>Skip to Next</span>
        <ChevronRight className="h-4 w-4 ml-2 group-hover:translate-x-1 transition-transform" />
        <span className="text-[10px] opacity-40 ml-4 hidden sm:inline">[N]</span>
      </Button>

      {/* Keyboard Hints */}
      <div className="text-center text-xs text-muted-foreground hidden sm:block">
        <span className="opacity-60">
          Press <kbd className="px-1.5 py-0.5 rounded bg-muted/50 text-foreground">R</kbd> to record
          • <kbd className="px-1.5 py-0.5 rounded bg-muted/50 text-foreground">1-4</kbd> for actions
          • <kbd className="px-1.5 py-0.5 rounded bg-muted/50 text-foreground">N</kbd> skip
          • <kbd className="px-1.5 py-0.5 rounded bg-muted/50 text-foreground">ESC</kbd> exit
        </span>
      </div>
    </div>
  );
}
