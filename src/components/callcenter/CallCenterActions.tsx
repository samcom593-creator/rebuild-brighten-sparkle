import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle2,
  XCircle,
  FileText,
  ChevronRight,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ActionId = "hired" | "contracted" | "bad_applicant";

interface ActionDef {
  id: ActionId;
  label: string;
  description: string;
  icon: React.ElementType;
  color: string;
  gradient: string;
  glowColor: string;
  key: string;
}

const actions: ActionDef[] = [
  {
    id: "hired",
    label: "Hired",
    description: "Contacted & interested",
    icon: CheckCircle2,
    color: "text-green-400",
    gradient: "from-green-500/20 to-emerald-500/20 hover:from-green-500/30 hover:to-emerald-500/30 border-green-500/30 hover:border-green-500/50",
    glowColor: "rgba(34, 197, 94, 0.4)",
    key: "1",
  },
  {
    id: "contracted",
    label: "Contracted",
    description: "Ready to onboard",
    icon: FileText,
    color: "text-blue-400",
    gradient: "from-blue-500/20 to-indigo-500/20 hover:from-blue-500/30 hover:to-indigo-500/30 border-blue-500/30 hover:border-blue-500/50",
    glowColor: "rgba(59, 130, 246, 0.4)",
    key: "2",
  },
  {
    id: "bad_applicant",
    label: "Not a Fit",
    description: "Reject applicant",
    icon: XCircle,
    color: "text-red-400",
    gradient: "from-red-500/10 to-rose-500/10 hover:from-red-500/20 hover:to-rose-500/20 border-red-500/20 hover:border-red-500/40",
    glowColor: "rgba(239, 68, 68, 0.3)",
    key: "3",
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
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [successAction, setSuccessAction] = useState<ActionId | null>(null);

  // Listen for keyboard presses to show visual feedback
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (["1", "2", "3", "n"].includes(key)) {
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
    setTimeout(() => setSuccessAction(null), 600);
    onAction(actionId);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2, type: "spring", stiffness: 300, damping: 30 }}
      className={cn("space-y-4", className)}
    >
      {/* Primary Actions - 2 columns */}
      <div className="grid grid-cols-2 gap-3">
        {actions.slice(0, 2).map((action, index) => (
          <motion.div
            key={action.id}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + index * 0.05, type: "spring", stiffness: 400, damping: 25 }}
          >
            <motion.button
              disabled={processing}
              onClick={() => handleAction(action.id)}
              whileHover={{ scale: 1.02, y: -2 }}
              whileTap={{ scale: 0.98 }}
              style={{
                boxShadow: activeKey === action.key ? `0 0 20px ${action.glowColor}` : "none",
              }}
              className={cn(
                "w-full h-20 relative overflow-hidden rounded-xl transition-all duration-200",
                "bg-gradient-to-br border",
                action.gradient,
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
                    exit={{ scale: 1.5, opacity: 0 }}
                    className="absolute inset-0 flex items-center justify-center bg-green-500/30 z-20"
                  >
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: [0, 1.2, 1] }}
                      transition={{ duration: 0.3 }}
                    >
                      <Check className="h-10 w-10 text-white" />
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Shimmer effect on hover */}
              <motion.div
                className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full"
                whileHover={{ translateX: "100%" }}
                transition={{ duration: 0.6 }}
              />

              <div className="flex flex-col items-center gap-1.5 relative z-10">
                <motion.div
                  animate={activeKey === action.key ? { scale: [1, 1.1, 1] } : {}}
                  transition={{ duration: 0.2 }}
                >
                  <action.icon className="h-6 w-6" />
                </motion.div>
                <span className="text-sm font-semibold">{action.label}</span>
                <span className="text-[10px] opacity-60">{action.description}</span>
              </div>

              {/* Keyboard hint */}
              <motion.span
                className={cn(
                  "absolute bottom-1.5 right-2 text-[10px] px-1.5 py-0.5 rounded transition-all",
                  activeKey === action.key
                    ? "bg-white/20 opacity-100"
                    : "opacity-40"
                )}
              >
                [{action.key}]
              </motion.span>
            </motion.button>
          </motion.div>
        ))}
      </div>

      {/* Bad Applicant - Full width */}
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, type: "spring", stiffness: 400, damping: 25 }}
      >
        <motion.button
          disabled={processing}
          onClick={() => handleAction("bad_applicant")}
          whileHover={{ scale: 1.01, y: -1 }}
          whileTap={{ scale: 0.99 }}
          style={{
            boxShadow: activeKey === "3" ? `0 0 15px ${actions[2].glowColor}` : "none",
          }}
          className={cn(
            "w-full h-14 relative overflow-hidden rounded-xl transition-all duration-200",
            "bg-gradient-to-br border",
            actions[2].gradient,
            actions[2].color,
            "disabled:opacity-50 disabled:cursor-not-allowed",
            activeKey === "3" && "ring-2 ring-white/20"
          )}
        >
          {/* Success overlay */}
          <AnimatePresence>
            {successAction === "bad_applicant" && (
              <motion.div
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 1.5, opacity: 0 }}
                className="absolute inset-0 flex items-center justify-center bg-red-500/30 z-20"
              >
                <Check className="h-8 w-8 text-white" />
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex items-center justify-center gap-2 relative z-10">
            <XCircle className="h-5 w-5" />
            <span className="font-medium">{actions[2].label}</span>
            <span className="text-xs opacity-60">({actions[2].description})</span>
          </div>
          <motion.span
            className={cn(
              "absolute bottom-1 right-2 text-[10px] px-1.5 py-0.5 rounded transition-all",
              activeKey === "3" ? "bg-white/20 opacity-100" : "opacity-40"
            )}
          >
            [{actions[2].key}]
          </motion.span>
        </motion.button>
      </motion.div>

      {/* Skip Button */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.25 }}
      >
        <Button
          variant="ghost"
          size="lg"
          onClick={onSkip}
          disabled={processing}
          className={cn(
            "w-full group hover:bg-muted/50",
            activeKey === "n" && "bg-muted/50"
          )}
        >
          <span>Skip to Next</span>
          <motion.div
            animate={activeKey === "n" ? { x: [0, 4, 0] } : {}}
            transition={{ duration: 0.3 }}
          >
            <ChevronRight className="h-4 w-4 ml-2 group-hover:translate-x-1 transition-transform" />
          </motion.div>
          <span className="text-[10px] opacity-40 ml-4 hidden sm:inline">[N]</span>
        </Button>
      </motion.div>

      {/* Keyboard Hints */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="text-center text-xs text-muted-foreground hidden sm:block"
      >
        <span className="opacity-60">
          Press{" "}
          <kbd className={cn(
            "px-1.5 py-0.5 rounded bg-muted/50 text-foreground transition-all",
            activeKey === "r" && "bg-primary/30 ring-1 ring-primary/50"
          )}>R</kbd>{" "}
          to record •{" "}
          <kbd className={cn(
            "px-1.5 py-0.5 rounded bg-muted/50 text-foreground transition-all",
            ["1", "2", "3"].includes(activeKey || "") && "bg-primary/30 ring-1 ring-primary/50"
          )}>1-3</kbd>{" "}
          for actions •{" "}
          <kbd className={cn(
            "px-1.5 py-0.5 rounded bg-muted/50 text-foreground transition-all",
            activeKey === "n" && "bg-primary/30 ring-1 ring-primary/50"
          )}>N</kbd>{" "}
          skip •{" "}
          <kbd className="px-1.5 py-0.5 rounded bg-muted/50 text-foreground">ESC</kbd>{" "}
          exit
        </span>
      </motion.div>
    </motion.div>
  );
}
