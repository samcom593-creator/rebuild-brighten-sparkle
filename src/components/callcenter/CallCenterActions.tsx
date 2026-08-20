import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  UserCheck,
  FileCheck,
  X as XIcon,
  PhoneMissed,
  Check,
  Calendar as CalendarIcon,
  PhoneOff,
  Bell,
  ChevronRight,
  ChevronLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// MP-260 disposition grid — 8 outcomes total. Keys 1..8. Order below MUST match
// the shortcut key labels rendered on each tile.
export type ActionId =
  | "hired"
  | "contracted"
  | "bad_applicant"    // "Not a Fit"
  | "no_pickup"
  | "contacted"        // MP-260 new
  | "reschedule"       // MP-260 new
  | "bad_number"       // MP-260 new — separate from "not a fit"
  | "needs_followup";  // MP-260 new

interface ActionDef {
  id: ActionId;
  label: string;
  description: string;
  icon: React.ElementType;
  gradient: string;
  color: string;
  glowColor: string;
  key: string;
}

const actions: ActionDef[] = [
  {
    id: "hired",
    label: "Hired",
    description: "Signed on the call",
    icon: UserCheck,
    color: "text-emerald-300",
    gradient: "from-emerald-500/15 to-emerald-600/10 hover:from-emerald-500/25 hover:to-emerald-600/20 border-emerald-500/30 hover:border-emerald-500/50",
    glowColor: "rgba(34, 197, 94, 0.4)",
    key: "1",
  },
  {
    id: "contracted",
    label: "Contracted",
    description: "Onboarding started",
    icon: FileCheck,
    color: "text-emerald-300",
    gradient: "from-emerald-500/10 to-teal-500/10 hover:from-emerald-500/20 hover:to-teal-500/20 border-emerald-500/25 hover:border-emerald-500/45",
    glowColor: "rgba(16, 185, 129, 0.35)",
    key: "2",
  },
  {
    id: "bad_applicant",
    label: "Not a Fit",
    description: "Reject applicant",
    icon: XIcon,
    color: "text-rose-300",
    gradient: "from-rose-500/10 to-rose-600/10 hover:from-rose-500/20 hover:to-rose-600/20 border-rose-500/25 hover:border-rose-500/45",
    glowColor: "rgba(244, 63, 94, 0.35)",
    key: "3",
  },
  {
    id: "no_pickup",
    label: "No Pickup",
    description: "Didn't answer",
    icon: PhoneMissed,
    color: "text-slate-200",
    gradient: "from-slate-500/10 to-slate-600/10 hover:from-slate-500/20 hover:to-slate-600/20 border-slate-500/25 hover:border-slate-500/45",
    glowColor: "rgba(148, 163, 184, 0.30)",
    key: "4",
  },
  {
    id: "contacted",
    label: "Contacted",
    description: "Reached but no decision",
    icon: Check,
    color: "text-teal-300",
    gradient: "from-teal-500/15 to-teal-600/10 hover:from-teal-500/25 hover:to-teal-600/20 border-teal-500/30 hover:border-teal-500/50",
    glowColor: "rgba(20, 184, 166, 0.35)",
    key: "5",
  },
  {
    id: "reschedule",
    label: "Reschedule",
    description: "Book a meeting",
    icon: CalendarIcon,
    color: "text-amber-300",
    gradient: "from-amber-500/15 to-amber-600/10 hover:from-amber-500/25 hover:to-amber-600/20 border-amber-500/30 hover:border-amber-500/50",
    glowColor: "rgba(245, 158, 11, 0.35)",
    key: "6",
  },
  {
    id: "bad_number",
    label: "Bad Number",
    description: "Wrong / dead line",
    icon: PhoneOff,
    color: "text-rose-300",
    gradient: "from-rose-500/15 to-rose-600/10 hover:from-rose-500/25 hover:to-rose-600/20 border-rose-500/30 hover:border-rose-500/50",
    glowColor: "rgba(244, 63, 94, 0.35)",
    key: "7",
  },
  {
    id: "needs_followup",
    label: "Needs Follow-Up",
    description: "Circle back later",
    icon: Bell,
    color: "text-amber-300",
    gradient: "from-amber-500/10 to-yellow-500/10 hover:from-amber-500/20 hover:to-yellow-500/20 border-amber-500/25 hover:border-amber-500/45",
    glowColor: "rgba(245, 185, 66, 0.35)",
    key: "8",
  },
];

interface CallCenterActionsProps {
  onAction: (actionId: ActionId) => void;
  onSkip: () => void;
  onPrevious?: () => void;
  processing: boolean;
  canGoPrevious?: boolean;
  className?: string;
}

export function CallCenterActions({
  onAction,
  onSkip,
  onPrevious,
  processing,
  canGoPrevious,
  className,
}: CallCenterActionsProps) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [successAction, setSuccessAction] = useState<ActionId | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip when typing in input/textarea/contentEditable/select
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) {
          return;
        }
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (["1", "2", "3", "4", "5", "6", "7", "8", "n", "p"].includes(key)) {
        setActiveKey(key);
      }
    };

    const handleKeyUp = () => {
      setActiveKey(null);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  const handleAction = (actionId: ActionId) => {
    setSuccessAction(actionId);
    setTimeout(() => setSuccessAction(null), 500);
    onAction(actionId);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1, type: "spring", stiffness: 300, damping: 30 }}
      className={cn("space-y-3", className)}
    >
      {/* 8-button disposition grid — 2-col mobile, 4-col desktop */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        {actions.map((action, index) => (
          <motion.div
            key={action.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 + index * 0.03, type: "spring", stiffness: 400, damping: 25 }}
          >
            <motion.button
              type="button"
              disabled={processing}
              onClick={() => handleAction(action.id)}
              whileHover={{ scale: 1.02, y: -1 }}
              whileTap={{ scale: 0.98 }}
              aria-label={`${action.label} — shortcut ${action.key}`}
              style={{
                boxShadow: activeKey === action.key ? `0 0 16px ${action.glowColor}` : "none",
              }}
              className={cn(
                "w-full h-20 md:h-20 relative overflow-hidden rounded-md transition-all duration-200",
                // Flat-fill tint per wave-59 pattern — bg-gradient-cards gate
                // blocks multi-stop gradients on card-style outer wrappers.
                "border bg-card/60 hover:bg-card",
                action.color,
                "disabled:opacity-50 disabled:cursor-not-allowed",
                activeKey === action.key && "ring-2 ring-white/20"
              )}
            >
              {/* Success checkmark overlay */}
              <AnimatePresence>
                {successAction === action.id && (
                  <motion.div
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 1.4, opacity: 0 }}
                    className="absolute inset-0 flex items-center justify-center bg-emerald-500/25 z-20"
                  >
                    <Check className="h-8 w-8 text-white" />
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="flex flex-col items-center gap-1 relative z-10 px-2">
                <action.icon className="h-5 w-5" />
                <span className="text-sm font-semibold leading-tight text-center">{action.label}</span>
                <span className="text-[10px] opacity-60 leading-tight text-center hidden sm:block">
                  {action.description}
                </span>
              </div>

              {/* Keyboard hint */}
              <span
                className={cn(
                  "absolute bottom-1 right-1.5 text-[10px] px-1.5 py-0.5 rounded transition-all bg-black/30",
                  activeKey === action.key ? "opacity-100" : "opacity-40"
                )}
              >
                {action.key}
              </span>
            </motion.button>
          </motion.div>
        ))}
      </div>

      {/* Navigation Buttons */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="flex gap-2"
      >
        {onPrevious && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onPrevious}
            disabled={processing || !canGoPrevious}
            aria-label="Go to previous lead"
            className={cn(
              "flex-1 group hover:bg-muted/50",
              activeKey === "p" && "bg-muted/50"
            )}
          >
            <ChevronLeft className="h-4 w-4 mr-1.5" />
            <span>Previous</span>
            <span className="text-[10px] opacity-40 ml-3 hidden sm:inline">[P]</span>
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onSkip}
          disabled={processing}
          aria-label="Skip to next lead"
          className={cn(
            "flex-1 group hover:bg-muted/50",
            activeKey === "n" && "bg-muted/50"
          )}
        >
          <span>Skip to Next</span>
          <ChevronRight className="h-4 w-4 ml-1.5" />
          <span className="text-[10px] opacity-40 ml-3 hidden sm:inline">[N]</span>
        </Button>
      </motion.div>
    </motion.div>
  );
}
