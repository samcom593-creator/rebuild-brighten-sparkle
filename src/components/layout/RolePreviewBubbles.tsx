import { useEffect, useRef, useState } from "react";
import { motion, type PanInfo } from "framer-motion";
import { Eye, GripVertical, ShieldCheck, User, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { type RolePreview, useRolePreview } from "@/hooks/useRolePreview";
import { cn } from "@/lib/utils";

const roleOptions: Array<{ role: RolePreview; label: string; icon: React.ElementType }> = [
  { role: "agent", label: "Agent View", icon: User },
  { role: "manager", label: "Manager View", icon: Users },
  { role: "admin", label: "Admin View", icon: ShieldCheck },
];

// PL-015: persistent position so Sam can park the bubble strip anywhere on
// his screen and it stays there across reloads. Stored as { x, y } pixel
// offsets from the default top-right anchor in localStorage.
const STORAGE_KEY = "apex.role-preview-bubbles.pos";

interface StoredPos {
  x: number;
  y: number;
}

function loadStoredPos(): StoredPos {
  if (typeof window === "undefined") return { x: 0, y: 0 };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { x: 0, y: 0 };
    const parsed = JSON.parse(raw) as StoredPos;
    if (typeof parsed.x !== "number" || typeof parsed.y !== "number") return { x: 0, y: 0 };
    return parsed;
  } catch {
    return { x: 0, y: 0 };
  }
}

export function RolePreviewBubbles() {
  const { canPreviewRoles, effectiveRole, setPreviewRole } = useRolePreview();
  const [pos, setPos] = useState<StoredPos>(() => loadStoredPos());
  const dragging = useRef(false);

  // Persist position whenever it settles. Throttled via the drag-end event.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pos));
    } catch { // empty-catch-allow:localstorage-incognito
      /* swallow quota / private-mode errors */
    }
  }, [pos]);

  if (!canPreviewRoles) return null;

  const onDragEnd = (_: unknown, info: PanInfo) => {
    // Clamp inside viewport so the strip can never get dragged offscreen.
    const W = typeof window !== "undefined" ? window.innerWidth : 1280;
    const H = typeof window !== "undefined" ? window.innerHeight : 720;
    const strip = 280; // approx strip width
    const stripH = 44;
    const next: StoredPos = {
      x: Math.min(Math.max(pos.x + info.offset.x, -(W - strip - 16)), 0),
      y: Math.min(Math.max(pos.y + info.offset.y, 0), H - stripH - 16),
    };
    setPos(next);
    // Defer to next tick so the click-through after drag doesn't fire a button click
    setTimeout(() => { dragging.current = false; }, 50);
  };

  return (
    <motion.div
      drag
      dragMomentum={false}
      dragElastic={0}
      onDragStart={() => { dragging.current = true; }}
      onDragEnd={onDragEnd}
      animate={{ x: pos.x, y: pos.y }}
      transition={{ type: "tween", duration: 0 }}
      className="fixed right-4 top-4 z-30 hidden items-center gap-1 rounded-full border border-border/70 bg-background/90 p-1 shadow-sm backdrop-blur lg:flex select-none cursor-grab active:cursor-grabbing"
      // Prevent the drag from also dispatching button clicks on touch + mouse.
      onClickCapture={(e) => { if (dragging.current) { e.preventDefault(); e.stopPropagation(); } }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
            <GripVertical className="h-4 w-4" />
          </div>
        </TooltipTrigger>
        <TooltipContent>Drag to move · Sam-only role preview</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Eye className="h-4 w-4" />
          </div>
        </TooltipTrigger>
        <TooltipContent>Preview role-specific dashboard routing</TooltipContent>
      </Tooltip>
      {roleOptions.map((option) => {
        const Icon = option.icon;
        const active = effectiveRole === option.role;
        return (
          <Button
            key={option.role}
            type="button"
            size="sm"
            variant={active ? "default" : "ghost"}
            className={cn("h-8 rounded-full px-3 text-xs", active && "shadow-none")}
            onClick={() => {
              if (dragging.current) return;
              setPreviewRole(option.role === "admin" ? null : option.role);
            }}
          >
            <Icon className="mr-1.5 h-3.5 w-3.5" />
            {option.label}
          </Button>
        );
      })}
    </motion.div>
  );
}
