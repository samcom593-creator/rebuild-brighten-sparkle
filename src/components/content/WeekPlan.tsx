// The Launch Board's Week view (2026-10-06; restyled OVERHAUL-launchboard, 2026-10-31): seven themed days driven by
// src/lib/contentWeek.ts. Drag a video between days (on a phone, press and hold first), or use its Move menu.
// Long-form planned against 5 a week, Shorts posted against 30 to 60. Each card shows where the video is with the same
// coloured bar and word as the list, so a day reads at a glance; the coloured left edge the cards had is gone.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  DndContext, DragOverlay, MouseSensor, TouchSensor, pointerWithin, rectIntersection, useDraggable, useDroppable, useSensor, useSensors,
  type CollisionDetection, type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { TonePill } from "@/components/ui/delight/ToneBubble";
import { VideoStageMark } from "@/components/content/LaunchBoardList";
import { DAY_THEMES, THEME_TONE, WEEKLY_TARGETS, phoenixDateKey, phoenixWeekday, piecesByDay } from "@/lib/contentWeek";
import { videoFormat, videoStep, videoStepKey, type BoardVideo } from "@/lib/launchBoardList";
import { TONE_CLASS } from "@/lib/tones";
import { cn } from "@/lib/utils";

export interface WeekVideo extends BoardVideo {
  sort: number;
  day: number;
  planned_week?: string | null;
}

const DAY_OPTIONS = [{ v: 0, label: "Not planned" }, ...[1, 2, 3, 4, 5, 6, 7].map((d) => ({ v: d, label: DAY_THEMES[d].name }))];
const cardIsLong = (c: BoardVideo) => videoFormat(c) === "Long-form";
const isPublished = (c: BoardVideo) => { const k = videoStepKey(c); return k === "published" || k === "no_link"; };

function WeekCard({ c, planned, now, onOpen, onMove }: { c: WeekVideo; planned: boolean; now: Date; onOpen: (c: WeekVideo) => void; onMove: (c: WeekVideo, day: number) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: c.id });
  const step = videoStep(c, now);
  const title = c.title.replace(/^Story · /, "").trim() || "Untitled video";
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn("touch-manipulation space-y-2 rounded-xl border border-border bg-card p-3", isDragging && "opacity-40")}
    >
      <button type="button" onClick={() => onOpen(c)} aria-haspopup="dialog" className="line-clamp-3 w-full rounded-sm text-left text-base font-semibold leading-snug text-foreground [overflow-wrap:anywhere] focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)] [@media(hover:hover)_and_(pointer:fine)]:hover:text-primary">
        {title}
      </button>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <VideoStageMark step={{ ...step, detail: null }} />
        <span className="text-sm text-muted-foreground">{cardIsLong(c) ? "Long-form" : "Short"}</span>
      </div>
      <select
        value={planned ? c.day : 0}
        aria-label={`Move ${title} to a day`}
        onChange={(e) => onMove(c, Number(e.target.value))}
        className="h-11 w-full rounded-md border border-input bg-background px-2 text-base text-foreground"
      >
        {DAY_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
      </select>
    </div>
  );
}

function DropZone({ id, className, children }: { id: string; className: string; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return <div ref={setNodeRef} className={cn(className, isOver && "border-primary bg-primary/5")}>{children}</div>;
}

export function WeekPlan({ cards, formatLine, onOpen, onMove, onAdd }: {
  cards: readonly WeekVideo[];
  /** The delivery format, in one line, printed under the plan. */
  formatLine: string;
  onOpen: (c: WeekVideo) => void;
  onMove: (c: WeekVideo, day: number) => void;
  onAdd: (day: number) => void;
}) {
  const todayDow = phoenixWeekday();
  const now = useMemo(() => new Date(), [cards]);
  const [shortsByDay, setShortsByDay] = useState<Record<number, number> | null>(null);
  const [shortsFailed, setShortsFailed] = useState(false);
  const [showAllIdeas, setShowAllIdeas] = useState(false);
  // Mouse + touch, not Pointer: dnd-kit's PointerSensor also claims touches and then loses
  // them to page scrolling, so on a phone a drag never started. Touch = press and hold.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  );
  // Drop where the pointer is, not where the (wide) card's rectangle overlaps most.
  const collision: CollisionDetection = (args) => { const hits = pointerWithin(args); return hits.length ? hits : rectIntersection(args); };
  const [activeId, setActiveId] = useState<string | null>(null);
  const dayKeys = useMemo(() => {
    const [y, m, d] = phoenixDateKey().split("-").map(Number);
    const base = Date.UTC(y, m - 1, d) - (todayDow - 1) * 86400_000;
    return Array.from({ length: 7 }, (_, i) => new Date(base + i * 86400_000).toISOString().slice(0, 10));
  }, [todayDow]);
  useEffect(() => {
    let off = false;
    void (async () => {
      const { data, error } = await supabase.from("content_posts").select("posted_at, format, platform").gte("posted_at", `${dayKeys[0]}T00:00:00-07:00`);
      // A failed load shows "—", never a confident 0.
      if (off || error) { if (!off) setShortsFailed(true); return; }
      // Repurpose sends one Short to every platform, so a day's Shorts = its busiest platform, not the sum.
      const byDate = piecesByDay((data ?? []) as { posted_at: string | null; format: string | null; platform: string | null }[], "short");
      const m: Record<number, number> = {};
      dayKeys.forEach((k, i) => { if (byDate[k]) m[i + 1] = byDate[k]; });
      setShortsByDay(m);
    })();
    return () => { off = true; };
  }, [dayKeys]);
  const shortsTotal = Object.values(shortsByDay ?? {}).reduce((a, b) => a + b, 0);
  // A card belongs to THIS week only if it was put on a day this week. Older plans go back
  // to the tray (or drop off once published), so last week's videos never fill this week.
  const thisWeek = dayKeys[0];
  const plannedNow = (c: WeekVideo) => c.day > 0 && c.planned_week === thisWeek;
  const longPlanned = cards.filter((c) => plannedNow(c) && cardIsLong(c)).length;
  const ideas = cards.filter((c) => !plannedNow(c) && !isPublished(c)).sort((a, b) => b.sort - a.sort);
  const activeCard = activeId ? cards.find((c) => c.id === activeId) ?? null : null;
  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    if (!e.over) return;
    const day = Number(String(e.over.id).replace("day-", ""));
    const c = cards.find((x) => x.id === String(e.active.id));
    if (c && Number.isFinite(day) && !(plannedNow(c) && c.day === day) && !(day === 0 && !plannedNow(c))) onMove(c, day);
  };
  const shortsText = shortsFailed ? "—" : shortsByDay ? shortsTotal.toLocaleString() : "…";
  return (
    <DndContext sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
      <div className="space-y-5">
        <p className="text-[15px] leading-6 text-muted-foreground">
          <span className="font-semibold text-foreground">This week</span>
          {" · "}<span className="whitespace-nowrap">Long-form planned <b className="tabular-nums text-foreground">{longPlanned} of {WEEKLY_TARGETS.long}</b></span>
          {" · "}<span className="whitespace-nowrap">Shorts posted <b className="tabular-nums text-foreground">{shortsText}</b> (goal {WEEKLY_TARGETS.shortsMin} to {WEEKLY_TARGETS.shortsMax})</span>
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 7 }, (_, i) => i + 1).map((d) => {
            const t = DAY_THEMES[d];
            const tone = THEME_TONE[t.theme];
            const items = cards.filter((c) => plannedNow(c) && c.day === d);
            const posted = shortsByDay?.[d] ?? 0;
            const isToday = d === todayDow;
            return (
              <section key={d} aria-label={`${t.name}${isToday ? ", today" : ""}`} className={cn("flex flex-col gap-3 rounded-xl border bg-card p-4", isToday ? "border-primary/60" : "border-border")}>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-lg font-bold text-foreground">{t.name}</h3>
                    {isToday && <TonePill tone="gold" dot>Today</TonePill>}
                  </div>
                  <span className={cn("inline-flex max-w-full items-center rounded-full border px-3 py-1 text-sm font-semibold leading-snug", tone.chip)}>{t.themeLabel}: {t.angle}</span>
                </div>
                <DropZone id={`day-${d}`} className="flex min-h-[132px] flex-1 flex-col gap-2 rounded-lg border border-dashed border-border p-2.5">
                  <p className="text-sm font-semibold text-muted-foreground">{t.longTarget > 0 ? "Long-form" : d === 7 ? "Plan and batch" : "Long-form (bonus)"}</p>
                  {items.map((c) => <WeekCard key={c.id} c={c} planned now={now} onOpen={onOpen} onMove={onMove} />)}
                  {items.length === 0 && <p className="py-1 text-sm text-muted-foreground">Drop a video here</p>}
                  <button type="button" onClick={() => onAdd(d)} className="mt-auto inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-dashed border-border px-3 text-[15px] font-medium text-muted-foreground focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)] [@media(hover:hover)_and_(pointer:fine)]:hover:border-primary/50 [@media(hover:hover)_and_(pointer:fine)]:hover:text-foreground">
                    <Plus className="h-4 w-4" aria-hidden /> Add a video for {t.short}
                  </button>
                </DropZone>
                {t.shortsTarget > 0 && (
                  <div>
                    <div className="flex justify-between text-sm text-muted-foreground"><span>Shorts posted</span><span className="tabular-nums text-foreground">{shortsFailed ? "—" : shortsByDay ? `${posted} of ${t.shortsTarget}` : "…"}</span></div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted" aria-hidden><div className={cn("h-full rounded-full", tone.bar)} style={{ width: `${Math.min(100, Math.round((posted / t.shortsTarget) * 100))}%` }} /></div>
                  </div>
                )}
              </section>
            );
          })}
        </div>
        <DropZone id="day-0" className="rounded-xl border border-dashed border-border bg-card/60 p-3">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h3 className="text-base font-semibold text-foreground">Not planned yet <span className="font-normal tabular-nums text-muted-foreground">{ideas.length}</span></h3>
            <span className="text-sm text-muted-foreground">Drag onto a day (on a phone, hold first), or use Move</span>
          </div>
          {ideas.length === 0 ? <p className="py-1 text-sm text-muted-foreground">Everything is planned.</p> : (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {(showAllIdeas ? ideas : ideas.slice(0, 8)).map((c) => <WeekCard key={c.id} c={c} planned={false} now={now} onOpen={onOpen} onMove={onMove} />)}
            </div>
          )}
          {ideas.length > 8 && (
            <button type="button" onClick={() => setShowAllIdeas(!showAllIdeas)} className="mt-3 inline-flex min-h-11 items-center rounded-full border border-border bg-card px-4 text-[15px] font-medium text-foreground focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)] [@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted">
              {showAllIdeas ? "Show fewer" : `Show all ${ideas.length}`}
            </button>
          )}
        </DropZone>
        <p className="text-sm leading-6 text-muted-foreground"><span className="font-semibold text-foreground">Delivery format.</span> {formatLine} Every card carries a script to record and an edit prompt: open the card, copy, paste.</p>
      </div>
      <DragOverlay>
        {activeCard ? (
          <div className={cn("w-56 rounded-xl border bg-card p-2.5 text-sm font-semibold text-foreground", TONE_CLASS.gold.border)}>
            {activeCard.title.replace(/^Story · /, "")}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
