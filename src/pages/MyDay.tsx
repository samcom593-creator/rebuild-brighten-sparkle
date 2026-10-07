import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Pencil, Plus, EyeOff, Loader2, CloudOff, Cloud } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { DAY_THEMES, THEME_TONE, phoenixDateKey } from "@/lib/contentWeek";
import { cn } from "@/lib/utils";

interface Task {
  id: string;
  weekday: number;
  start_min: number;
  duration_min: number;
  title: string;
  detail: string | null;
  category: string;
  sort: number;
}
interface Draft extends Task { hidden?: boolean; isNew?: boolean }
interface Pending { task_id: string; day: string; done: boolean }
type SaveState = "idle" | "saving" | "saved" | "offline";

const CATEGORY_DOT: Record<string, string> = {
  faith: "bg-violet-400", health: "bg-emerald-400", sales: "bg-primary", recruiting: "bg-orange-400",
  content: "bg-sky-400", leadership: "bg-rose-400", ceo: "bg-amber-300", learning: "bg-teal-400",
  planning: "bg-indigo-400", rest: "bg-slate-400",
};
const LENGTHS = [5, 10, 15, 20, 30, 45, 60, 75, 90, 120, 150, 180, 240];
const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const PENDING_KEY = "myday:pending";

function lsGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { // empty-catch-allow:private-mode-storage
    return null;
  }
}
function lsSet(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { // empty-catch-allow:private-mode-storage
    return;
  }
}
function readJson<T>(key: string, fallback: T): T {
  const raw = lsGet(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { // empty-catch-allow:corrupt-cache
    return fallback;
  }
}

/** Add days to a YYYY-MM-DD key without touching the local time zone. */
function addDays(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function weekdayOf(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return w === 0 ? 7 : w;
}
function phoenixMinutes(now = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Phoenix", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}
function fmtClock(min: number): string {
  const total = ((min % 1440) + 1440) % 1440;
  const h = Math.floor(total / 60);
  const m = total % 60;
  const ap = h >= 12 ? "PM" : "AM";
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${ap}`;
}
function fmtRange(start: number, dur: number): string {
  const a = fmtClock(start);
  const b = fmtClock(start + dur);
  const apA = a.slice(-2);
  return apA === b.slice(-2) ? `${a.slice(0, -3)} – ${b}` : `${a} – ${b}`;
}
function fmtDur(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}
function toTimeValue(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}
function fromTimeValue(v: string): number {
  const [h, m] = v.split(":").map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

export default function MyDay() {
  const todayKey = phoenixDateKey();
  const [selected, setSelected] = useState(todayKey);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [save, setSave] = useState<SaveState>("idle");
  const [nowMin, setNowMin] = useState(phoenixMinutes());
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft[]>([]);
  const [savingEdit, setSavingEdit] = useState(false);
  const seeded = useRef(false);
  const scrolledFor = useRef<string>("");
  const nowRef = useRef<HTMLDivElement | null>(null);

  const weekday = weekdayOf(selected);
  const theme = DAY_THEMES[weekday];
  const tone = THEME_TONE[theme.theme];
  const isToday = selected === todayKey;

  // Minute clock for the "Now" highlight.
  useEffect(() => {
    const t = setInterval(() => setNowMin(phoenixMinutes()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Push queued check changes; anything that fails stays queued.
  const flushPending = useCallback(async () => {
    const queue = readJson<Pending[]>(PENDING_KEY, []);
    if (!queue.length) return;
    setSave("saving");
    const remaining: Pending[] = [];
    for (const p of queue) {
      const res = p.done
        ? await supabase.from("day_plan_checks").upsert({ task_id: p.task_id, day: p.day }, { onConflict: "user_id,task_id,day" })
        : await supabase.from("day_plan_checks").delete().eq("task_id", p.task_id).eq("day", p.day);
      if (res.error) remaining.push(p);
    }
    lsSet(PENDING_KEY, JSON.stringify(remaining));
    setSave(remaining.length ? "offline" : "saved");
  }, []);

  useEffect(() => {
    const onOnline = () => { void flushPending(); };
    window.addEventListener("online", onOnline);
    const t = setInterval(() => { void flushPending(); }, 30_000);
    return () => { window.removeEventListener("online", onOnline); clearInterval(t); };
  }, [flushPending]);

  const applyPendingTo = useCallback((base: Set<string>, day: string) => {
    const next = new Set(base);
    for (const p of readJson<Pending[]>(PENDING_KEY, [])) {
      if (p.day !== day) continue;
      if (p.done) next.add(p.task_id); else next.delete(p.task_id);
    }
    return next;
  }, []);

  const load = useCallback(async () => {
    const wd = weekdayOf(selected);
    const cachedTasks = readJson<Task[] | null>(`myday:tasks:${wd}`, null);
    if (cachedTasks) {
      setTasks(cachedTasks);
      setDone(applyPendingTo(new Set(readJson<string[]>(`myday:checks:${selected}`, [])), selected));
      setLoading(false);
    } else {
      setLoading(true);
    }
    try {
      if (!seeded.current) {
        const { error } = await supabase.rpc("day_plan_ensure_seeded");
        if (!error) seeded.current = true;
      }
      const [t, c] = await Promise.all([
        supabase.from("day_plan_tasks").select("id,weekday,start_min,duration_min,title,detail,category,sort")
          .eq("weekday", wd).eq("active", true).order("start_min", { ascending: true }).order("sort", { ascending: true }),
        supabase.from("day_plan_checks").select("task_id").eq("day", selected),
      ]);
      if (t.error) throw t.error;
      const rows = (t.data ?? []) as Task[];
      setTasks(rows);
      lsSet(`myday:tasks:${wd}`, JSON.stringify(rows));
      if (!c.error) {
        const ids = (c.data ?? []).map((r) => r.task_id);
        lsSet(`myday:checks:${selected}`, JSON.stringify(ids));
        setDone(applyPendingTo(new Set(ids), selected));
      }
    } catch { // empty-catch-allow:offline-uses-cache
      setSave((s) => (s === "saving" ? s : "offline"));
    } finally {
      setLoading(false);
    }
    void flushPending();
  }, [selected, applyPendingTo, flushPending]);

  useEffect(() => { void load(); }, [load]);

  const toggle = useCallback(async (task: Task) => {
    const nextDone = !done.has(task.id);
    setDone((prev) => {
      const next = new Set(prev);
      if (nextDone) next.add(task.id); else next.delete(task.id);
      lsSet(`myday:checks:${selected}`, JSON.stringify([...next]));
      return next;
    });
    const queue = readJson<Pending[]>(PENDING_KEY, []).filter((p) => !(p.task_id === task.id && p.day === selected));
    queue.push({ task_id: task.id, day: selected, done: nextDone });
    lsSet(PENDING_KEY, JSON.stringify(queue));
    await flushPending();
  }, [done, selected, flushPending]);

  // Scroll to the current task once per opened day.
  const currentId = useMemo(() => {
    if (!isToday) return null;
    return tasks.find((t) => nowMin >= t.start_min && nowMin < t.start_min + t.duration_min)?.id ?? null;
  }, [tasks, nowMin, isToday]);
  useEffect(() => {
    if (loading || !currentId || scrolledFor.current === selected) return;
    scrolledFor.current = selected;
    nowRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [loading, currentId, selected]);

  const doneCount = tasks.filter((t) => done.has(t.id)).length;
  const pct = tasks.length ? Math.round((doneCount / tasks.length) * 100) : 0;

  const chips = useMemo(() => {
    const list: { key: string; label: string }[] = [
      { key: todayKey, label: "Today" },
      { key: addDays(todayKey, 1), label: "Tomorrow" },
    ];
    const todayWd = weekdayOf(todayKey);
    for (let wd = 1; wd <= 7; wd++) {
      const offset = (wd - todayWd + 7) % 7;
      if (offset <= 1) continue;
      list.push({ key: addDays(todayKey, offset), label: WEEKDAY_SHORT[wd - 1] });
    }
    return list;
  }, [todayKey]);

  const dateLabel = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" })
    .format(new Date(`${selected}T12:00:00Z`));

  const startEdit = () => { setDraft(tasks.map((t) => ({ ...t }))); setEditing(true); };
  const patchDraft = (id: string, patch: Partial<Draft>) => setDraft((d) => d.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const addDraft = () => {
    const last = draft.filter((d) => !d.hidden).slice(-1)[0];
    const start = last ? Math.min(last.start_min + last.duration_min, 1410) : 6 * 60;
    setDraft((d) => [...d, {
      id: `new-${Date.now()}`, weekday, start_min: start, duration_min: 30, title: "", detail: null,
      category: "planning", sort: d.length, isNew: true,
    }]);
  };
  const saveEdit = async () => {
    if (draft.some((r) => !r.hidden && !r.title.trim())) { toast.error("Every task needs a title"); return; }
    setSavingEdit(true);
    try {
      for (const r of draft) {
        if (r.isNew) {
          if (r.hidden) continue;
          const { error } = await supabase.from("day_plan_tasks").insert({
            weekday, start_min: r.start_min, duration_min: r.duration_min, title: r.title.trim(),
            detail: r.detail, category: r.category, sort: r.sort, active: true,
          });
          if (error) throw error;
        } else {
          const { error } = await supabase.from("day_plan_tasks").update({
            start_min: r.start_min, duration_min: r.duration_min, title: r.title.trim(), active: !r.hidden,
            updated_at: new Date().toISOString(),
          }).eq("id", r.id);
          if (error) throw error;
        }
      }
      toast.success("Day saved");
      setEditing(false);
      await load();
    } catch {
      toast.error("Could not save. Your edits are still here, try again.");
    } finally {
      setSavingEdit(false);
    }
  };

  const status = {
    idle: null,
    saving: <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</>,
    saved: <><Cloud className="h-3.5 w-3.5 text-emerald-400" /> Saved</>,
    offline: <><CloudOff className="h-3.5 w-3.5 text-amber-400" /> Offline, will sync</>,
  }[save];

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-24 pt-4 sm:px-0">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{dateLabel}</h1>
          <span className={cn("mt-2 inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium", tone.chip)}>
            {theme.name} · {theme.themeLabel} day — {theme.angle}
          </span>
        </div>
        <Button variant={editing ? "secondary" : "outline"} className="min-h-[44px] shrink-0" onClick={editing ? () => setEditing(false) : startEdit}>
          <Pencil className="mr-2 h-4 w-4" /> {editing ? "Cancel" : "Edit day"}
        </Button>
      </div>

      <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0" role="tablist" aria-label="Pick a day">
        {chips.map((c) => (
          <button
            key={c.key + c.label}
            type="button"
            role="tab"
            aria-selected={selected === c.key}
            disabled={editing}
            onClick={() => setSelected(c.key)}
            className={cn(
              "min-h-[44px] shrink-0 rounded-full border px-4 text-sm font-medium transition-colors disabled:opacity-50",
              selected === c.key ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="mb-5 rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="font-semibold">{doneCount} of {tasks.length} done</span>
          <span className="flex items-center gap-1.5 text-muted-foreground" aria-live="polite">{status}</span>
        </div>
        <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-muted">
          <div className={cn("h-full rounded-full transition-all", tone.bar)} style={{ width: `${pct}%` }} />
        </div>
      </div>

      {loading && !tasks.length ? (
        <div className="space-y-3">
          {["a", "b", "c", "d", "e"].map((k) => <div key={k} className="h-20 animate-pulse rounded-2xl bg-muted" />)}
        </div>
      ) : editing ? (
        <div className="space-y-3">
          {draft.filter((r) => !r.hidden).map((r) => (
            <div key={r.id} className="space-y-3 rounded-2xl border border-border bg-card p-4">
              <input
                value={r.title}
                onChange={(e) => patchDraft(r.id, { title: e.target.value })}
                placeholder="Task title"
                aria-label="Task title"
                className="min-h-[48px] w-full rounded-lg border border-border bg-background px-3 text-base font-semibold"
              />
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm text-muted-foreground">
                  Start
                  <input
                    type="time"
                    value={toTimeValue(r.start_min)}
                    onChange={(e) => patchDraft(r.id, { start_min: fromTimeValue(e.target.value) })}
                    className="mt-1 min-h-[48px] w-full rounded-lg border border-border bg-background px-3 text-base text-foreground"
                  />
                </label>
                <label className="text-sm text-muted-foreground">
                  Length
                  <select
                    value={r.duration_min}
                    onChange={(e) => patchDraft(r.id, { duration_min: Number(e.target.value) })}
                    className="mt-1 min-h-[48px] w-full rounded-lg border border-border bg-background px-3 text-base text-foreground"
                  >
                    {(LENGTHS.includes(r.duration_min) ? LENGTHS : [...LENGTHS, r.duration_min].sort((a, b) => a - b)).map((n) => (
                      <option key={n} value={n}>{fmtDur(n)}</option>
                    ))}
                  </select>
                </label>
              </div>
              <Button variant="ghost" className="min-h-[44px] text-muted-foreground" onClick={() => patchDraft(r.id, { hidden: true })}>
                <EyeOff className="mr-2 h-4 w-4" /> Hide
              </Button>
            </div>
          ))}
          <Button variant="outline" className="min-h-[56px] w-full" onClick={addDraft}>
            <Plus className="mr-2 h-4 w-4" /> Add task
          </Button>
          <div className="sticky bottom-3 pt-2">
            <Button className="min-h-[56px] w-full text-base" disabled={savingEdit} onClick={() => { void saveEdit(); }}>
              {savingEdit ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Save day
            </Button>
          </div>
        </div>
      ) : tasks.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center text-muted-foreground">
          Nothing planned for {theme.name}. Tap Edit day to add tasks.
        </div>
      ) : (
        <ul className="space-y-2.5">
          {tasks.map((t) => {
            const isDone = done.has(t.id);
            const isNow = t.id === currentId;
            return (
              <li key={t.id}>
                <div
                  ref={isNow ? nowRef : undefined}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isDone}
                  onClick={() => { void toggle(t); }}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); void toggle(t); } }}
                  className={cn(
                    "flex min-h-[56px] w-full cursor-pointer select-none items-start gap-3 rounded-2xl border bg-card p-4 transition-all active:scale-[0.99]",
                    isNow ? "border-primary ring-2 ring-primary" : "border-border",
                    isDone && "opacity-55",
                  )}
                >
                  <span className={cn("mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2", isDone ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
                    {isDone ? <Check className="h-4 w-4" /> : null}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                      <span className={cn("h-2.5 w-2.5 rounded-full", CATEGORY_DOT[t.category] ?? "bg-muted-foreground")} aria-label={t.category} />
                      <span>{fmtRange(t.start_min, t.duration_min)}</span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[12px] font-medium">{fmtDur(t.duration_min)}</span>
                      {isNow ? <span className="rounded-full bg-primary px-2 py-0.5 text-[12px] font-bold text-primary-foreground">Now</span> : null}
                    </div>
                    <p className={cn("mt-1 text-base font-bold leading-snug", isDone && "line-through decoration-2 decoration-foreground dark:decoration-white")}>
                      {t.title}
                    </p>
                    {t.category === "content" ? <p className="mt-0.5 text-sm font-medium text-primary">{theme.angle}</p> : null}
                    {t.detail ? <p className="mt-1 text-sm text-muted-foreground">{t.detail}</p> : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
