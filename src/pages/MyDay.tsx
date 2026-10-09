import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Pencil, Plus, EyeOff, Loader2, CloudOff, Cloud } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { DAY_THEMES, THEME_TONE, phoenixDateKey } from "@/lib/contentWeek";
import { cn } from "@/lib/utils";
import { MyDayWins } from "@/components/myday/MyDayWins";
import { MyDayTodoist, pushMyDayToTodoist } from "@/components/myday/MyDayTodoist";
import { PrelicensingCheck } from "@/components/myday/PrelicensingCheck";
import { ContractingSummaryBanner } from "@/components/team/ContractingSummaryBanner";

interface Task {
  id: string;
  weekday: number;
  start_min: number;
  duration_min: number;
  title: string;
  detail: string | null;
  category: string;
  sort: number;
  alert: boolean;
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
/** Minutes from an <input type="time"> value; null while the field is cleared or half-typed. */
function fromTimeValue(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(v);
  if (!m) return null;
  const mins = Number(m[1]) * 60 + Number(m[2]);
  return mins >= 0 && mins < 1440 ? mins : null;
}

export default function MyDay() {
  const [todayKey, setTodayKey] = useState(phoenixDateKey);
  const [selected, setSelected] = useState(todayKey);
  const [loadFailed, setLoadFailed] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [save, setSave] = useState<SaveState>("idle");
  const [nowMin, setNowMin] = useState(phoenixMinutes());
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft[]>([]);
  const [savingEdit, setSavingEdit] = useState(false);
  const seeded = useRef(false);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const flushing = useRef<Promise<void> | null>(null);
  const flushAgain = useRef(false);
  const lastWriteAt = useRef(0);
  const scrolledFor = useRef<string>("");
  const nowRef = useRef<HTMLDivElement | null>(null);

  const weekday = weekdayOf(selected);
  const theme = DAY_THEMES[weekday];
  const tone = THEME_TONE[theme.theme];
  const isToday = selected === todayKey;

  // Minute clock for the "Now" highlight. It also rolls the page over at midnight
  // (Phoenix): if Sam was looking at "today", he moves to the new today, so a tap at
  // 12:05 AM never lands on yesterday. Re-checked whenever the app comes back to the front.
  useEffect(() => {
    const tick = () => {
      setNowMin(phoenixMinutes());
      const nextToday = phoenixDateKey();
      setTodayKey((prev) => {
        if (prev !== nextToday) setSelected((sel) => (sel === prev ? nextToday : sel));
        return nextToday;
      });
    };
    const t = setInterval(tick, 60_000);
    const onVisible = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", tick);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("focus", tick); };
  }, []);

  // Push queued check changes; anything that fails stays queued. Only one push runs at
  // a time (a call during a push asks for one more pass), and afterwards only the
  // entries that were actually sent are removed, re-read from storage, so a tap made
  // while a slow request was in flight can never be overwritten by an older copy.
  const flushPending = useCallback((): Promise<void> => {
    if (flushing.current) { flushAgain.current = true; return flushing.current; }
    const run = async () => {
      do {
        flushAgain.current = false;
        const queue = readJson<Pending[]>(PENDING_KEY, []);
        if (!queue.length) break;
        setSave("saving");
        const sent: Pending[] = [];
        for (const p of queue) {
          const res = p.done
            ? await supabase.from("day_plan_checks").upsert({ task_id: p.task_id, day: p.day }, { onConflict: "user_id,task_id,day" })
            : await supabase.from("day_plan_checks").delete().eq("task_id", p.task_id).eq("day", p.day);
          if (!res.error) { sent.push(p); lastWriteAt.current = Date.now(); }
        }
        const latest = readJson<Pending[]>(PENDING_KEY, []);
        const left = latest.filter((q) => !sent.some((x) => x.task_id === q.task_id && x.day === q.day && x.done === q.done));
        lsSet(PENDING_KEY, JSON.stringify(left));
        setSave(left.length ? (sent.length < queue.length ? "offline" : "saving") : "saved");
        if (sent.length < queue.length) break; // offline: the 30 s timer or 'online' retries
      } while (flushAgain.current);
    };
    flushing.current = run().finally(() => { flushing.current = null; });
    return flushing.current;
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
    const day = selected;
    const startedAt = Date.now();
    const wd = weekdayOf(day);
    const cachedTasks = readJson<Task[] | null>(`myday:tasks:${wd}`, null);
    if (cachedTasks) {
      setTasks(cachedTasks);
      setDone(applyPendingTo(new Set(readJson<string[]>(`myday:checks:${day}`, [])), day));
      setLoading(false);
    } else {
      setTasks([]);
      setDone(new Set());
      setLoading(true);
    }
    try {
      if (!seeded.current) {
        const { error } = await supabase.rpc("day_plan_ensure_seeded");
        if (!error) seeded.current = true;
      }
      const [t, c] = await Promise.all([
        supabase.from("day_plan_tasks").select("id,weekday,start_min,duration_min,title,detail,category,sort,alert")
          .eq("weekday", wd).eq("active", true).order("start_min", { ascending: true }).order("sort", { ascending: true }),
        supabase.from("day_plan_checks").select("task_id").eq("day", day),
      ]);
      if (t.error) throw t.error;
      // Sam switched days while this was loading: this answer belongs to another day.
      if (selectedRef.current !== day) return;
      const rows = (t.data ?? []) as Task[];
      setTasks(rows);
      setLoadFailed(false);
      lsSet(`myday:tasks:${wd}`, JSON.stringify(rows));
      // Skip a checks answer that started before a tap was saved; it would undo the tap.
      if (!c.error && lastWriteAt.current < startedAt) {
        const ids = (c.data ?? []).map((r) => r.task_id);
        lsSet(`myday:checks:${day}`, JSON.stringify(ids));
        setDone(applyPendingTo(new Set(ids), day));
      }
    } catch { // empty-catch-allow:offline-uses-cache
      if (selectedRef.current === day && !cachedTasks) setLoadFailed(true);
      setSave((s) => (s === "saving" ? s : "offline"));
    } finally {
      if (selectedRef.current === day) setLoading(false);
    }
    void flushPending();
  }, [selected, applyPendingTo, flushPending]);

  // A load that failed with nothing cached retries as soon as the phone is back online.
  useEffect(() => {
    if (!loadFailed) return;
    const retry = () => { void load(); };
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [loadFailed, load]);

  useEffect(() => { void load(); }, [load]);

  const toggle = useCallback(async (task: Task) => {
    // Checking off a day that hasn't happened yet would record work that wasn't done.
    if (selected > todayKey) { toast("You can check these off on the day."); return; }
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
  }, [done, selected, todayKey, flushPending]);

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
    // The rest of the coming week, in date order.
    for (let offset = 2; offset <= 6; offset++) {
      const key = addDays(todayKey, offset);
      list.push({ key, label: WEEKDAY_SHORT[weekdayOf(key) - 1] });
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
      category: "planning", sort: d.length, isNew: true, alert: true,
    }]);
  };
  const saveEdit = async () => {
    if (draft.some((r) => !r.hidden && !r.title.trim())) { toast.error("Every task needs a title"); return; }
    setSavingEdit(true);
    try {
      for (const r of draft) {
        if (r.isNew) {
          if (r.hidden) continue;
          const { data, error } = await supabase.from("day_plan_tasks").insert({
            weekday, start_min: r.start_min, duration_min: r.duration_min, title: r.title.trim(),
            detail: r.detail, category: r.category, sort: r.sort, active: true, alert: r.alert,
          }).select("id").single();
          if (error) throw error;
          // Saved: from now on it is an existing task, so a retry after a later failure
          // updates it instead of inserting a second copy.
          patchDraft(r.id, { id: data.id, isNew: false });
        } else {
          const { error } = await supabase.from("day_plan_tasks").update({
            start_min: r.start_min, duration_min: r.duration_min, title: r.title.trim(), active: !r.hidden,
            detail: r.detail?.trim() ? r.detail.trim() : null, category: r.category, alert: r.alert,
            updated_at: new Date().toISOString(),
          }).eq("id", r.id);
          if (error) throw error;
        }
      }
      toast.success("Day saved");
      setEditing(false);
      await load();
      // Keep the real to-do list and the calendar in step with what was just edited. A failure is shown,
      // never swallowed: a schedule that looks synced and is not is worse than one that says it is not.
      void pushMyDayToTodoist().then((r) => {
        if (r.ok) toast.success("Todoist and calendar updated");
        else toast.error(`Saved here, but Todoist did not update: ${r.errors?.[0] ?? r.error ?? "unknown"}`);
      });
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

      {!editing ? <ContractingSummaryBanner className="mb-4" /> : null}

      {!editing ? <MyDayWins /> : null}

      <div className="mb-5 rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="font-semibold">{doneCount} of {tasks.length} done</span>
          <span className="flex items-center gap-1.5 text-muted-foreground" aria-live="polite">{status}</span>
        </div>
        <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-muted">
          <div className={cn("h-full rounded-full transition-all", tone.bar)} style={{ width: `${pct}%` }} />
        </div>
      </div>

      {!editing ? (
        <>
          <MyDayTodoist />
          <PrelicensingCheck defaultOpen={weekday === 3 && isToday} />
        </>
      ) : null}

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
                    onChange={(e) => { const v = fromTimeValue(e.target.value); if (v !== null) patchDraft(r.id, { start_min: v }); }}
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
              <label className="block text-sm text-muted-foreground">
                Notes
                <textarea
                  value={r.detail ?? ""}
                  onChange={(e) => patchDraft(r.id, { detail: e.target.value })}
                  rows={2}
                  placeholder="What to do in this block"
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-base text-foreground"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm text-muted-foreground">
                  Type
                  <select
                    value={r.category}
                    onChange={(e) => patchDraft(r.id, { category: e.target.value })}
                    className="mt-1 min-h-[48px] w-full rounded-lg border border-border bg-background px-3 text-base text-foreground"
                  >
                    {Object.keys(CATEGORY_DOT).map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label className="flex items-end gap-2 pb-3 text-sm text-muted-foreground">
                  <input type="checkbox" checked={r.alert} onChange={(e) => patchDraft(r.id, { alert: e.target.checked })} className="h-5 w-5" />
                  Phone alert before it starts
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
      ) : tasks.length === 0 && loadFailed ? (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center text-muted-foreground">
          <p>Couldn't load your day. Check your signal.</p>
          <Button variant="outline" className="mt-3 min-h-[44px]" onClick={() => void load()}>Try again</Button>
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
                    {t.category === "content" ? <p className="mt-0.5 text-sm font-medium text-primary">{/tomorrow/i.test(t.title) ? `Tomorrow: ${DAY_THEMES[(weekday % 7) + 1].angle}` : theme.angle}</p> : null}
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
