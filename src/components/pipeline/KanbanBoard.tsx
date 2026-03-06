import { useState } from "react";
import { AnimatePresence } from "framer-motion";
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
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { FOLLOWUP_TIMING } from "@/lib/apexConfig";
import { PipelineCard, type PipelineCardData } from "./PipelineCard";

export type KanbanStage =
  | "new_applicant"
  | "unlicensed"
  | "course_purchased"
  | "finished_course"
  | "test_scheduled"
  | "passed_test"
  | "fingerprints_done"
  | "waiting_on_license"
  | "licensed"
  | "dormant";

export type { PipelineCardData as KanbanApplication };

export interface KanbanColumn {
  id: string;
  label: string;
  stages: string[];
  color: string;
  emoji: string;
}

export const KANBAN_COLUMNS: KanbanColumn[] = [
  {
    id: "applicants",
    label: "Applicants",
    stages: ["new_applicant"],
    color: "border-sky-500/30 bg-sky-500/5",
    emoji: "📥",
  },
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
  {
    id: "dormant",
    label: "Dormant",
    stages: ["dormant"],
    color: "border-slate-500/30 bg-slate-500/5",
    emoji: "💤",
  },
];

/** Determine if a lead is dormant based on last contact */
function isDormant(app: PipelineCardData): boolean {
  const last = app.last_contacted_at || app.contacted_at || app.created_at;
  const daysSince = (Date.now() - new Date(last).getTime()) / (1000 * 60 * 60 * 24);
  return daysSince >= FOLLOWUP_TIMING.dormantDays;
}

/** Backward-compat: map a stage string to column id */
export function getColumnForStage(stage: string | null | undefined): string {
  if (!stage) return "applicants";
  if (stage === "licensed") return "licensed";
  for (const col of KANBAN_COLUMNS) {
    if (col.stages.includes(stage)) return col.id;
  }
  return "needs_outreach";
}

/** Map any application to its column id (uses dormant detection) */
export function getColumnForApp(app: PipelineCardData): string {
  // Dormant check first (except licensed)
  if (app.license_progress === "licensed") return "licensed";
  if (isDormant(app)) return "dormant";
  
  const stage = app.license_progress;
  if (!stage || stage === "unlicensed") {
    // New applicant: never contacted + no license progress
    if (!app.contacted_at && !app.last_contacted_at) return "applicants";
    return "needs_outreach";
  }
  
  for (const col of KANBAN_COLUMNS) {
    if (col.stages.includes(stage)) return col.id;
  }
  return "needs_outreach";
}

// Map column drop to a canonical target stage
const COLUMN_TARGET_STAGE: Record<string, KanbanStage> = {
  applicants: "new_applicant",
  needs_outreach: "unlicensed",
  course: "course_purchased",
  test_phase: "test_scheduled",
  final_steps: "fingerprints_done",
  licensed: "licensed",
  dormant: "dormant",
};

// ── Draggable Card Wrapper ──────────────────────────────────────────────────
function DraggableCard({
  app,
  onClick,
  onSchedule,
}: {
  app: PipelineCardData;
  onClick: (app: PipelineCardData) => void;
  onSchedule?: (app: PipelineCardData) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: app.id });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn("cursor-grab active:cursor-grabbing")}
    >
      <PipelineCard app={app} onClick={onClick} onSchedule={onSchedule} isDragging={isDragging} />
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
  apps: PipelineCardData[];
  onCardClick: (app: PipelineCardData) => void;
  onSchedule?: (app: PipelineCardData) => void;
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
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <span className="text-base">{column.emoji}</span>
          <span className="font-semibold text-sm text-foreground">{column.label}</span>
        </div>
        <Badge variant="outline" className="text-xs bg-muted border-border text-muted-foreground">
          {apps.length}
        </Badge>
      </div>

      <div className="flex-1 px-2 pb-3 space-y-2 overflow-y-auto max-h-[75vh]">
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
  applications: PipelineCardData[];
  onStageChange: (applicationId: string, newStage: KanbanStage) => Promise<void>;
  onCardClick: (app: PipelineCardData) => void;
  onScheduleInterview?: (app: PipelineCardData) => void;
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
  const columnApps = KANBAN_COLUMNS.reduce<Record<string, PipelineCardData[]>>(
    (acc, col) => {
      acc[col.id] = applications.filter(
        (app) => getColumnForApp(app) === col.id
      );
      return acc;
    },
    {}
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragOver = (event: DragOverEvent) => {
    setOverColumnId((event.over?.id as string) || null);
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

    const currentColumnId = getColumnForApp(app);
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
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3 min-h-[400px]">
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
