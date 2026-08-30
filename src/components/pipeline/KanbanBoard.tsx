import { useState, useMemo } from "react";
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
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { FOLLOWUP_TIMING } from "@/lib/apexConfig";
import { PipelineCard, type PipelineCardData } from "./PipelineCard";
import { Flame, TrendingUp } from "lucide-react";
import { differenceInHours } from "date-fns";

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
    color: "border-info/30 bg-info/5",
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
    stages: ["test_scheduled", "passed_test", "exam_passed", "failed_test"],
    color: "border-info/30 bg-info/5",
    emoji: "📝",
  },
  {
    id: "final_steps",
    label: "Final Steps",
    stages: ["fingerprints_done", "waiting_fingerprints", "waiting_on_license"],
    color: "border-violet-500/30 bg-violet-500/5",
    emoji: "🔑",
  },
  {
    id: "licensed",
    label: "Licensed ✓",
    stages: ["licensed", "in_field_training"],
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

function isDormant(app: PipelineCardData): boolean {
  const last = app.last_contacted_at || app.contacted_at || app.created_at;
  return differenceInHours(new Date(), new Date(last)) >= FOLLOWUP_TIMING.dormantDays * 24;
}

// "new_applicant" and "dormant" are board vocabulary, NOT license_progress
// members: the first is how an uncontacted lead is displayed, the second is
// derived from contact recency. Writing either raised 22P02 and the whole
// stage change was rolled back (MP-342).
const UI_ONLY_STAGES: readonly KanbanStage[] = ["new_applicant", "dormant"];

/**
 * Board stage -> a value the license_progress enum can actually hold.
 * Every writer MUST go through this. Two pages previously disagreed: one
 * mapped inline, the other wrote the raw stage and 22P02'd on 2 of 7 columns.
 */
export function toDbStage(stage: KanbanStage): string {
  return UI_ONLY_STAGES.includes(stage) ? "unlicensed" : stage;
}

/**
 * The ONE placement rule. Any surface counting these columns must call this —
 * a second derivation is how the Pipeline Funnel came to disagree with the
 * board underneath it on 6 of 7 columns (MP-342).
 *
 * A real licensing stage owns the card. Dormancy is a freshness attribute, not
 * a stage, so it must never evict someone from the column describing where they
 * actually are — it was hiding 82 in-progress applicants (69 course-stage)
 * behind a 14-day contact rule.
 */
export function getColumnForApp(app: PipelineCardData): string {
  const stage = app.license_progress;
  if (stage && stage !== "unlicensed") {
    for (const col of KANBAN_COLUMNS) {
      if (col.stages.includes(stage)) return col.id;
    }
  }
  if (isDormant(app)) return "dormant";
  if (!app.contacted_at && !app.last_contacted_at) return "applicants";
  return "needs_outreach";
}

const COLUMN_TARGET_STAGE: Record<string, KanbanStage> = {
  applicants:    "new_applicant",
  needs_outreach: "unlicensed",
  course:        "course_purchased",
  test_phase:    "test_scheduled",
  final_steps:   "fingerprints_done",
  licensed:      "licensed",
  dormant:       "dormant",
};

// ─── Draggable card wrapper ───────────────────────────────────────────────────
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
    <div ref={setNodeRef} {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing">
      <PipelineCard app={app} onClick={onClick} onSchedule={onSchedule} isDragging={isDragging} />
    </div>
  );
}

// ─── Column header with at-risk count + velocity ─────────────────────────────
function ColumnHeader({
  column,
  apps,
  isOver,
}: {
  column: KanbanColumn;
  apps: PipelineCardData[];
  isOver: boolean;
}) {
  const atRisk = apps.filter((a) => {
    const last = a.last_contacted_at || a.contacted_at;
    return !last || differenceInHours(new Date(), new Date(last)) >= 48;
  }).length;

  const isLicensedCol = column.id === "licensed";
  const isDormantCol  = column.id === "dormant";

  return (
    <div className="flex items-center justify-between px-3 pt-3 pb-2">
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="text-sm">{column.emoji}</span>
        <span className="font-semibold text-xs text-foreground truncate">{column.label}</span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {atRisk > 0 && !isLicensedCol && !isDormantCol && (
          <Badge className="text-[9px] px-1 py-0 h-4 bg-red-500/15 text-red-400 border-red-500/20">
            <Flame className="h-2.5 w-2.5 mr-0.5" />
            {atRisk}
          </Badge>
        )}
        <Badge
          variant="outline"
          className={cn(
            "text-[10px] bg-muted border-border text-muted-foreground",
            isOver && "border-primary/60 text-primary"
          )}
        >
          {apps.length}
        </Badge>
      </div>
    </div>
  );
}

// ─── Droppable column ─────────────────────────────────────────────────────────
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
        "flex flex-col rounded-md border-2 transition-all duration-150 min-h-[300px]",
        column.color,
        isOver && "border-primary/60 bg-primary/5 scale-[1.01]"
      )}
    >
      <ColumnHeader column={column} apps={apps} isOver={isOver} />

      <div className="flex-1 px-2 pb-3 space-y-2 overflow-y-auto max-h-[75vh]">
        {apps.length === 0 ? (
          <div className={cn(
            "flex items-center justify-center h-20 text-xs italic transition-colors",
            isOver ? "text-primary/50" : "text-muted-foreground/40"
          )}>
            {isOver ? "Drop here" : "Empty"}
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {apps.map((app) => (
              <motion.div
                key={app.id}
                layout
                initial={{ opacity: 0, y: -8, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
              >
                <DraggableCard app={app} onClick={onCardClick} onSchedule={onSchedule} />
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}

// ─── Main KanbanBoard ─────────────────────────────────────────────────────────
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
  const [activeId, setActiveId]         = useState<string | null>(null);
  const [overColumnId, setOverColumnId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const activeApp = activeId ? applications.find((a) => a.id === activeId) : null;

  const { columnApps, totalActive, totalLicensed, convRate } = useMemo(() => {
    const apps: Record<string, PipelineCardData[]> = {};
    KANBAN_COLUMNS.forEach((col) => { apps[col.id] = []; });
    let active = 0, licensed = 0;
    for (const app of applications) {
      apps[getColumnForApp(app)]?.push(app);
      if (app.license_status === "licensed") licensed++; else active++;
    }
    const rate = active + licensed > 0 ? Math.round((licensed / (active + licensed)) * 100) : 0;
    return { columnApps: apps, totalActive: active, totalLicensed: licensed, convRate: rate };
  }, [applications]);

  const handleDragStart = (event: DragStartEvent) => setActiveId(event.active.id as string);
  const handleDragOver  = (event: DragOverEvent)  => setOverColumnId((event.over?.id as string) || null);
  const handleDragEnd   = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    setOverColumnId(null);
    if (!over || readOnly) return;
    const targetStage = COLUMN_TARGET_STAGE[over.id as string];
    if (!targetStage) return;
    const app = applications.find((a) => a.id === active.id);
    if (!app) return;
    if (getColumnForApp(app) === over.id) return;
    await onStageChange(app.id, targetStage);
  };

  return (
    <div>
      {/* ── Conversion rate bar ─────────────────────────────────────────── */}
      {applications.length > 0 && (
        <div className="flex items-center gap-3 mb-4 px-1">
          <TrendingUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <div className="flex-1 h-1.5 bg-muted/40 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-emerald-500 rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${convRate}%` }}
              transition={{ duration: 0.7, ease: "easeOut" }}
            />
          </div>
          <span className="text-xs text-muted-foreground shrink-0">
            {convRate}% licensed ({totalLicensed}/{totalActive + totalLicensed})
          </span>
        </div>
      )}

      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        {/* Horizontally scrollable on every breakpoint — all 7 columns are
            always reachable. Fixed min-width per column so they stay readable
            even when the container shrinks. */}
        <div className="overflow-x-auto pb-2 -mx-2 px-2">
          <div className="grid grid-flow-col auto-cols-[minmax(260px,1fr)] gap-3 min-h-[400px]">
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
        </div>

        <DragOverlay>
          {activeApp && (
            <div className="bg-card border border-primary/40 rounded-md p-3 shadow-2xl opacity-95 w-52 rotate-2">
              <p className="font-semibold text-sm">{activeApp.first_name} {activeApp.last_name}</p>
              <p className="text-xs text-muted-foreground truncate">{activeApp.email}</p>
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
