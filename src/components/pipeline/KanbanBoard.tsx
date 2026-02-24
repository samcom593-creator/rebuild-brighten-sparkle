import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
} from "@dnd-kit/core";
import { Phone, Mail, Calendar, Clock, GraduationCap, AlertCircle, CheckCircle, Loader2, Eye } from "lucide-react";
import { ApplicationDetailSheet } from "@/components/dashboard/ApplicationDetailSheet";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

export type KanbanStage =
  | "unlicensed"
  | "course_purchased"
  | "finished_course"
  | "test_scheduled"
  | "passed_test"
  | "fingerprints_done"
  | "waiting_on_license"
  | "licensed";

export interface KanbanApplication {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  license_progress: KanbanStage | null;
  license_status: string;
  last_contacted_at?: string | null;
  contacted_at?: string | null;
  created_at: string;
  assigned_agent_id?: string | null;
}

export interface KanbanColumn {
  id: string;
  label: string;
  stages: KanbanStage[];
  color: string;
  emoji: string;
}

export const KANBAN_COLUMNS: KanbanColumn[] = [
  {
    id: "needs_outreach",
    label: "Needs Outreach",
    stages: ["unlicensed"],
    color: "border-red-500/30 bg-red-500/5",
    emoji: "📣",
  },
  {
    id: "course",
    label: "Course",
    stages: ["course_purchased", "finished_course"],
    color: "border-amber-500/30 bg-amber-500/5",
    emoji: "📚",
  },
  {
    id: "test_phase",
    label: "Test Phase",
    stages: ["test_scheduled", "passed_test"],
    color: "border-blue-500/30 bg-blue-500/5",
    emoji: "📝",
  },
  {
    id: "final_steps",
    label: "Final Steps",
    stages: ["fingerprints_done", "waiting_on_license"],
    color: "border-violet-500/30 bg-violet-500/5",
    emoji: "🔑",
  },
  {
    id: "licensed",
    label: "Licensed ✓",
    stages: ["licensed"],
    color: "border-emerald-500/30 bg-emerald-500/5",
    emoji: "🏆",
  },
];

// Map any stage to its column id
export function getColumnForStage(stage: KanbanStage | null | undefined): string {
  if (!stage) return "needs_outreach";
  for (const col of KANBAN_COLUMNS) {
    if ((col.stages as string[]).includes(stage)) return col.id;
  }
  return "needs_outreach";
}

// Map column drop to a canonical target stage
const COLUMN_TARGET_STAGE: Record<string, KanbanStage> = {
  needs_outreach: "unlicensed",
  course: "course_purchased",
  test_phase: "test_scheduled",
  final_steps: "fingerprints_done",
  licensed: "licensed",
};

// Contact freshness
function getContactBadge(app: KanbanApplication) {
  const last = app.last_contacted_at || app.contacted_at;
  if (!last) {
    return { label: "Never contacted", color: "bg-red-500/20 text-red-400 border-red-500/30 animate-pulse" };
  }
  const hoursAgo = (Date.now() - new Date(last).getTime()) / (1000 * 60 * 60);
  if (hoursAgo > 48) {
    return { label: `${Math.floor(hoursAgo / 24)}d ago`, color: "bg-amber-500/20 text-amber-400 border-amber-500/30" };
  }
  return {
    label: formatDistanceToNow(new Date(last), { addSuffix: true }),
    color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  };
}

// ── Course Not Purchased Strip ───────────────────────────────────────────────
function CourseSendStrip({ app }: { app: KanbanApplication }) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSend = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setSending(true);
    try {
      const { error } = await supabase.functions.invoke("send-licensing-instructions", {
        body: {
          recipientEmail: app.email,
          recipientName: `${app.first_name} ${app.last_name}`,
          licenseStatus: app.license_status,
        },
      });
      if (error) throw error;
      setSent(true);
      toast.success(`Course email sent to ${app.first_name}!`);
      setTimeout(() => setSent(false), 4000);
    } catch {
      toast.error("Failed to send course email");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mt-2 flex items-center justify-between rounded-lg bg-amber-500/10 border border-amber-500/20 px-2 py-1.5">
      <span className="text-[10px] text-amber-400 flex items-center gap-1">
        <AlertCircle className="h-3 w-3" />
        Course not purchased
      </span>
      <button
        onClick={handleSend}
        disabled={sending || sent}
        className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-md bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 transition-colors disabled:opacity-60"
      >
        {sending ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : sent ? (
          <CheckCircle className="h-3 w-3 text-emerald-400" />
        ) : (
          <GraduationCap className="h-3 w-3" />
        )}
        {sent ? "Sent!" : "Send"}
      </button>
    </div>
  );
}

// ── Draggable Card ──────────────────────────────────────────────────────────
function DraggableCard({
  app,
  onClick,
  onSchedule,
}: {
  app: KanbanApplication;
  onClick: (app: KanbanApplication) => void;
  onSchedule?: (app: KanbanApplication) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: app.id });
  const contactBadge = getContactBadge(app);
  const [showAppSheet, setShowAppSheet] = useState(false);

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn("cursor-grab active:cursor-grabbing", isDragging && "opacity-40")}
    >
      <motion.div
        layout
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-card border border-border rounded-xl p-3 shadow-sm hover:shadow-md hover:border-primary/30 transition-all"
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <div>
            <p className="font-semibold text-sm text-foreground leading-tight">
              {app.first_name} {app.last_name}
            </p>
            <Badge variant="outline" className={cn("text-[10px] mt-1", contactBadge.color)}>
              <Clock className="h-2.5 w-2.5 mr-1" />
              {contactBadge.label}
            </Badge>
          </div>
          {app.license_status === "licensed" && (
            <GraduationCap className="h-4 w-4 text-emerald-400 flex-shrink-0" />
          )}
        </div>

        <div className="space-y-1 text-xs text-muted-foreground mb-3">
          <div className="flex items-center gap-1.5 truncate">
            <Mail className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">{app.email}</span>
          </div>
          {app.phone && (
            <div className="flex items-center gap-1.5">
              <Phone className="h-3 w-3 flex-shrink-0" />
              <span>{app.phone}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs flex-1 text-muted-foreground hover:text-foreground"
            onClick={(e) => { e.stopPropagation(); onClick(app); }}
          >
            View
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-primary hover:text-primary/80 hover:bg-primary/10"
            onClick={(e) => { e.stopPropagation(); setShowAppSheet(true); }}
            title="View Application"
          >
            <Eye className="h-3.5 w-3.5" />
          </Button>
          {onSchedule && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
              onClick={(e) => { e.stopPropagation(); onSchedule(app); }}
              title="Schedule Interview"
            >
              <Calendar className="h-3.5 w-3.5" />
            </Button>
          )}
          {app.phone && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
              asChild
              onClick={(e) => e.stopPropagation()}
            >
              <a href={`tel:${app.phone}`}>
                <Phone className="h-3.5 w-3.5" />
              </a>
            </Button>
          )}
        </div>

        {/* Course not purchased strip */}
        {(!app.license_progress || app.license_progress === "unlicensed") && (
          <CourseSendStrip app={app} />
        )}
      </motion.div>
      <ApplicationDetailSheet
        open={showAppSheet}
        onOpenChange={setShowAppSheet}
        applicationId={app.id}
      />
    </div>
  );
}

// ── Droppable Column ────────────────────────────────────────────────────────
function DroppableColumn({
  column,
  apps,
  onCardClick,
  onSchedule,
  isOver,
}: {
  column: KanbanColumn;
  apps: KanbanApplication[];
  onCardClick: (app: KanbanApplication) => void;
  onSchedule?: (app: KanbanApplication) => void;
  isOver: boolean;
}) {
  const { setNodeRef } = useDroppable({ id: column.id });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex flex-col rounded-xl border-2 transition-colors min-h-[300px]",
        column.color,
        isOver && "border-primary/60 bg-primary/5"
      )}
    >
      {/* Column Header */}
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <span className="text-base">{column.emoji}</span>
          <span className="font-semibold text-sm text-foreground">{column.label}</span>
        </div>
        <Badge variant="outline" className="text-xs bg-muted border-border text-muted-foreground">
          {apps.length}
        </Badge>
      </div>

      {/* Cards */}
      <div className="flex-1 px-2 pb-3 space-y-2 overflow-y-auto max-h-[60vh]">
        <AnimatePresence>
          {apps.length === 0 ? (
            <div className="flex items-center justify-center h-20 text-xs text-muted-foreground/50 italic">
              Drop leads here
            </div>
          ) : (
            apps.map((app) => (
              <DraggableCard
                key={app.id}
                app={app}
                onClick={onCardClick}
                onSchedule={onSchedule}
              />
            ))
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ── Main KanbanBoard Component ──────────────────────────────────────────────
interface KanbanBoardProps {
  applications: KanbanApplication[];
  onStageChange: (applicationId: string, newStage: KanbanStage) => Promise<void>;
  onCardClick: (app: KanbanApplication) => void;
  onScheduleInterview?: (app: KanbanApplication) => void;
  readOnly?: boolean;
}

export function KanbanBoard({
  applications,
  onStageChange,
  onCardClick,
  onScheduleInterview,
  readOnly = false,
}: KanbanBoardProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overColumnId, setOverColumnId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const activeApp = activeId ? applications.find((a) => a.id === activeId) : null;

  // Group applications by column
  const columnApps = KANBAN_COLUMNS.reduce<Record<string, KanbanApplication[]>>(
    (acc, col) => {
      acc[col.id] = applications.filter(
        (app) => getColumnForStage(app.license_progress) === col.id
      );
      return acc;
    },
    {}
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const overId = event.over?.id as string | null;
    setOverColumnId(overId || null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    setOverColumnId(null);

    if (!over || readOnly) return;

    const columnId = over.id as string;
    const targetStage = COLUMN_TARGET_STAGE[columnId];
    if (!targetStage) return;

    const app = applications.find((a) => a.id === active.id);
    if (!app) return;

    const currentColumnId = getColumnForStage(app.license_progress);
    if (currentColumnId === columnId) return;

    await onStageChange(app.id, targetStage);
  };

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 min-h-[400px]">
        {KANBAN_COLUMNS.map((col) => (
          <DroppableColumn
            key={col.id}
            column={col}
            apps={columnApps[col.id] || []}
            onCardClick={onCardClick}
            onSchedule={!readOnly ? onScheduleInterview : undefined}
            isOver={overColumnId === col.id}
          />
        ))}
      </div>

      {/* Drag overlay */}
      <DragOverlay>
        {activeApp && (
          <div className="bg-card border border-primary/40 rounded-xl p-3 shadow-xl opacity-95 w-52 rotate-1">
            <p className="font-semibold text-sm">{activeApp.first_name} {activeApp.last_name}</p>
            <p className="text-xs text-muted-foreground truncate">{activeApp.email}</p>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
