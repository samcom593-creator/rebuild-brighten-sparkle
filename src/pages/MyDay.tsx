import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Pencil, Plus, EyeOff, Loader2, CloudOff, Cloud } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { DAY_THEMES, THEME_TONE, phoenixDateKey } from "@/lib/contentWeek";
import { cn } from "@/lib/utils";
import { MyDayWins } from "@/components/myday/MyDayWins";
import { MyDayTodoist, pushMyDayToTodoist } from "@/components/myday/MyDayTodoist";
import { PrelicensingCheck } from "@/components/myday/PrelicensingCheck";
import { useSamPrivateAccess } from "@/hooks/useSamPrivateAccess";
import { assertSamTaskSession, myDayCacheKey, taskAuthorization } from "@/lib/privateTasks";
import { isDayCheckIds, isDayCheckRows, isDayPlanTasks, isPendingDayChecks, MyDayStorageError, readDayCache, writeDayCache, type DayPlanTask as Task, type PendingDayCheck as Pending } from "@/lib/myDayStorage";
import { ContractingReviewBanner } from "@/components/contracting-review/ContractingReviewBanner";

interface Draft extends Task { hidden?: boolean; isNew?: boolean }
type SaveState = "idle" | "saving" | "saved" | "offline";

const CATEGORY_DOT: Record<string, string> = {
  faith: "bg-violet-400", health: "bg-emerald-400", sales: "bg-primary", recruiting: "bg-orange-400",
  content: "bg-sky-400", leadership: "bg-rose-400", ceo: "bg-amber-300", learning: "bg-teal-400",
  planning: "bg-indigo-400", rest: "bg-slate-400",
};
// Q4 schedule (MP-BRAND-ENGINE part 5): the weekday spine is the same every day; this is what rotates.
// Topics are decided Tuesday and filmed Saturday, so no block names a topic for the day.
const Q4_FOCUS: Record<number, string> = {
  1: "Business audit, builder meeting",
  2: "Content planning, builder meeting",
  3: "Data check, pre-licensing push",
  4: "Business audit, builder meeting",
  5: "Applicant calls, Saturday prep",
  6: "Record Day",
  7: "Numbers video, edit the week, weekly review",
};
const LENGTHS = [5, 10, 15, 20, 30, 45, 60, 75, 90, 120, 150, 180, 240];
const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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
  const { allowed, isChecking, userId } = useSamPrivateAccess();
  if (!allowed || !userId) return <p role="status" className="p-6 text-sm text-muted-foreground">{isChecking ? "Checking owner access…" : "Owner access required."}</p>;
  return <MyDayContent key={userId} userId={userId} />;
}

function MyDayContent({ userId }: { userId: string }) {
  const PENDING_KEY = myDayCacheKey(userId, "pending");
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const [todayKey, setTodayKey] = useState(phoenixDateKey);
  const [selected, setSelected] = useState(todayKey);
  const [loadFailed, setLoadFailed] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [checksState, setChecksState] = useState<"loading" | "cached" | "verified" | "stale" | "unavailable">("loading");
  const hasChecks = checksState === "cached" || checksState === "verified" || checksState === "stale";
  const [loading, setLoading] = useState(true);
  const [save, setSave] = useState<SaveState>("idle");
  const [queueIssue, setQueueIssue] = useState<string | null>(null);
  const [cacheUnavailable, setCacheUnavailable] = useState(false);
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
    if (!active.current) return Promise.resolve();
    if (flushing.current) { flushAgain.current = true; return flushing.current; }
    const run = async () => { try {
      do {
        flushAgain.current = false;
        const queue = readDayCache(PENDING_KEY, isPendingDayChecks) ?? [];
        if (!queue.length || !active.current) break;
        let authorization: string;
        try { authorization = await assertSamTaskSession(userId, () => active.current); } catch {
          if (active.current) setSave("offline");
          return;
        }
        if (!active.current) return;
        setSave("saving");
        const sent: Pending[] = [];
        for (const p of queue) {
          if (!active.current) return;
          const res = p.done
            ? await supabase.from("day_plan_checks").upsert({ user_id: userId, task_id: p.task_id, day: p.day }, { onConflict: "user_id,task_id,day" }).setHeader("Authorization", authorization)
            : await supabase.from("day_plan_checks").delete().eq("user_id", userId).eq("task_id", p.task_id).eq("day", p.day).setHeader("Authorization", authorization);
          if (!res.error) { sent.push(p); lastWriteAt.current = Date.now(); }
        }
        if (!active.current) return;
        const latest = readDayCache(PENDING_KEY, isPendingDayChecks) ?? [];
        const left = latest.filter((q) => !sent.some((x) => x.task_id === q.task_id && x.day === q.day && x.done === q.done));
        writeDayCache(PENDING_KEY, left);
        setQueueIssue(null);
        setSave(left.length ? (sent.length < queue.length ? "offline" : "saving") : "saved");
        if (sent.length < queue.length) break; // offline: the 30 s timer or 'online' retries
      } while (flushAgain.current);
    } catch (error) {
      if (!active.current) return;
      if (error instanceof MyDayStorageError) setQueueIssue("Checkmark sync is paused because saved browser data could not be read or updated. Your existing queue has not been cleared.");
      else setSave("offline");
    }
    };
    flushing.current = run().finally(() => { flushing.current = null; });
    return flushing.current;
  }, [PENDING_KEY, userId]);

  useEffect(() => {
    const onOnline = () => { void flushPending(); };
    window.addEventListener("online", onOnline);
    const t = setInterval(() => { void flushPending(); }, 30_000);
    return () => { window.removeEventListener("online", onOnline); clearInterval(t); };
  }, [flushPending]);

  const applyPendingTo = useCallback((base: Set<string>, day: string) => {
    const next = new Set(base);
    try {
      for (const p of readDayCache(PENDING_KEY, isPendingDayChecks) ?? []) {
        if (p.day !== day) continue;
        if (p.done) next.add(p.task_id); else next.delete(p.task_id);
      }
    } catch {
      if (active.current) setQueueIssue("Saved checkmarks could not be read. Checkmark sync is paused; no saved queue entries were sent.");
    }
    return next;
  }, [PENDING_KEY]);

  const load = useCallback(async () => {
    if (!active.current) return;
    const day = selected;
    const startedAt = Date.now();
    const wd = weekdayOf(day);
    let cachedTasks: Task[] | null = null;
    let cachedChecks: string[] | null = null;
    try {
      cachedTasks = readDayCache(myDayCacheKey(userId, "tasks", wd), isDayPlanTasks);
      if (cachedTasks?.some(task => task.weekday !== wd)) throw new Error("Cached day does not match.");
      setCacheUnavailable(false);
    } catch {
      cachedTasks = null;
      setCacheUnavailable(true);
    }
    try { cachedChecks = readDayCache(myDayCacheKey(userId, "checks", day), isDayCheckIds); }
    catch { setCacheUnavailable(true); }
    setDone(applyPendingTo(new Set(cachedChecks ?? []), day));
    setChecksState(cachedChecks === null ? "loading" : "cached");
    if (cachedTasks) {
      setTasks(cachedTasks);
      setLoading(false);
    } else {
      setTasks([]);
      setLoading(true);
    }
    try {
      const authorization = await taskAuthorization(userId, () => active.current);
      if (!seeded.current) {
        await assertSamTaskSession(userId, () => active.current);
        if (!active.current) return;
        const { error } = await supabase.rpc("day_plan_ensure_seeded").setHeader("Authorization", authorization);
        if (!error) seeded.current = true;
      }
      if (!active.current) return;
      const [t, c] = await Promise.all([
        supabase.from("day_plan_tasks").select("id,weekday,start_min,duration_min,title,detail,category,sort,alert")
          .eq("user_id", userId).eq("weekday", wd).eq("active", true).order("start_min", { ascending: true }).order("sort", { ascending: true }).setHeader("Authorization", authorization),
        supabase.from("day_plan_checks").select("task_id").eq("user_id", userId).eq("day", day).setHeader("Authorization", authorization),
      ]);
      if (t.error) throw t.error;
      // Sam switched days while this was loading: this answer belongs to another day.
      if (!active.current || selectedRef.current !== day) return;
      if (!isDayPlanTasks(t.data) || t.data.some(task => task.weekday !== wd)) throw new Error("Day response could not be verified.");
      const rows = t.data;
      setTasks(rows);
      setLoadFailed(false);
      try { writeDayCache(myDayCacheKey(userId, "tasks", wd), rows); }
      catch { setCacheUnavailable(true); }
      // Skip a checks answer that started before a tap was saved; it would undo the tap.
      if (lastWriteAt.current < startedAt) {
        if (c.error || !isDayCheckRows(c.data)) {
          setChecksState(cachedChecks === null ? "unavailable" : "stale");
        } else {
          const ids = c.data.map((r) => r.task_id);
          try { writeDayCache(myDayCacheKey(userId, "checks", day), ids); }
          catch { setCacheUnavailable(true); }
          setDone(applyPendingTo(new Set(ids), day));
          setChecksState("verified");
        }
      }
    } catch { // empty-catch-allow:offline-uses-cache
      if (active.current && selectedRef.current === day) {
        if (!cachedTasks) setLoadFailed(true);
        setChecksState(cachedChecks === null ? "unavailable" : "stale");
      }
      if (active.current) setSave((s) => (s === "saving" ? s : "offline"));
    } finally {
      if (active.current && selectedRef.current === day) setLoading(false);
    }
    void flushPending();
  }, [selected, applyPendingTo, flushPending, userId]);

  // A load that failed with nothing cached retries as soon as the phone is back online.
  useEffect(() => {
    if (!loadFailed) return;
    const retry = () => { void load(); };
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [loadFailed, load]);

  useEffect(() => { void load(); }, [load]);

  const toggle = useCallback(async (task: Task) => {
    if (!active.current || !hasChecks) return;
    // Checking off a day that hasn't happened yet would record work that wasn't done.
    if (selected > todayKey) { toast("You can check these off on the day."); return; }
    const nextDone = !done.has(task.id);
    try {
      const queue = (readDayCache(PENDING_KEY, isPendingDayChecks) ?? []).filter((p) => !(p.task_id === task.id && p.day === selected));
      queue.push({ task_id: task.id, day: selected, done: nextDone });
      writeDayCache(PENDING_KEY, queue);
    } catch {
      setQueueIssue("Checkmark not changed. Browser storage could not save or verify the queue. Restore browser storage, then try again.");
      return;
    }
    setQueueIssue(null);
    const next = new Set(done);
    if (nextDone) next.add(task.id); else next.delete(task.id);
    setDone(next);
    try { writeDayCache(myDayCacheKey(userId, "checks", selected), [...next]); }
    catch { setCacheUnavailable(true); }
    await flushPending();
  }, [done, selected, todayKey, flushPending, PENDING_KEY, userId, hasChecks]);

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
      const authorization = await assertSamTaskSession(userId, () => active.current);
      for (const r of draft) {
        if (!active.current) return;
        if (r.isNew) {
          if (r.hidden) continue;
          const { data, error } = await supabase.from("day_plan_tasks").insert({
            user_id: userId, weekday, start_min: r.start_min, duration_min: r.duration_min, title: r.title.trim(),
            detail: r.detail, category: r.category, sort: r.sort, active: true, alert: r.alert,
          }).select("id").single().setHeader("Authorization", authorization);
          if (error) throw error;
          if (!data?.id) throw new Error("Task save could not be confirmed");
          // Saved: from now on it is an existing task, so a retry after a later failure
          // updates it instead of inserting a second copy.
          patchDraft(r.id, { id: data.id, isNew: false });
        } else {
          const { data, error } = await supabase.from("day_plan_tasks").update({
            start_min: r.start_min, duration_min: r.duration_min, title: r.title.trim(), active: !r.hidden,
            detail: r.detail?.trim() ? r.detail.trim() : null, category: r.category, alert: r.alert,
            updated_at: new Date().toISOString(),
          }).eq("user_id", userId).eq("id", r.id).select("id").maybeSingle().setHeader("Authorization", authorization);
          if (error) throw error;
          if (!data?.id) throw new Error("Task was not updated");
        }
      }
      if (!active.current) return;
      toast.success("Day saved");
      setEditing(false);
      await load();
      // Keep the real to-do list and the calendar in step with what was just edited. A failure is shown,
      // never swallowed: a schedule that looks synced and is not is worse than one that says it is not.
      if (!active.current) return;
      void pushMyDayToTodoist(userId, () => active.current).then((r) => {
        if (!active.current) return;
        if (r.ok) toast.success("Todoist and calendar updated");
        else toast.error(`Saved here, but Todoist did not update: ${r.errors?.[0] ?? r.error ?? "unknown"}`);
      }).catch(() => { if (active.current) toast.error("Saved here, but Todoist did not update."); });
    } catch {
      if (!active.current) return;
      toast.error("Could not save. Your edits are still here, try again.");
    } finally {
      if (active.current) setSavingEdit(false);
    }
  };

  const status = queueIssue ? <><CloudOff className="h-3.5 w-3.5 text-amber-400" /> Sync paused</> : {
    idle: null,
    saving: <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</>,
    saved: <><Cloud className="h-3.5 w-3.5 text-emerald-400" /> Saved</>,
    offline: <><CloudOff className="h-3.5 w-3.5 text-amber-400" /> Not synced; will retry</>,
  }[save];

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-24 pt-4 sm:px-0">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{dateLabel}</h1>
          <span className={cn("mt-2 inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium", tone.chip)}>
            {theme.name} · {Q4_FOCUS[weekday]}
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

      {!editing ? <ContractingReviewBanner className="mb-4" /> : null}

      {!editing ? <MyDayWins /> : null}

      <div className="mb-5 rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="font-semibold">{hasChecks ? `${checksState === "verified" ? "" : "Last saved: "}${doneCount} of ${tasks.length} done` : checksState === "loading" ? "Loading checkmarks…" : "Checkmarks unavailable"}</span>
          <span className="flex items-center gap-1.5 text-muted-foreground" aria-live="polite">{status}</span>
        </div>
        {hasChecks ? <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-muted">
          <div className={cn("h-full rounded-full transition-all", tone.bar)} style={{ width: `${pct}%` }} />
        </div> : null}
        {checksState === "stale" || checksState === "unavailable" ? <div role="alert" className="mt-3 text-sm text-amber-600 dark:text-amber-300">
          <p>{checksState === "stale" ? "Could not refresh checkmarks. Showing the last saved checkmarks." : "Saved checkmarks could not be loaded or verified. Completion totals are unavailable."}</p>
          <button type="button" className="mt-1 underline" onClick={() => void load()}>Retry checkmarks</button>
        </div> : null}
        {queueIssue ? <p role="alert" className="mt-3 text-sm text-amber-600 dark:text-amber-300">{queueIssue}</p>
          : cacheUnavailable ? <p role="status" className="mt-3 text-sm text-amber-600 dark:text-amber-300">Offline copies are unavailable in this browser. Only confirmed online saves are durable.</p> : null}
        <p className="mt-3 text-sm text-muted-foreground">
          If it isn't tapped done, it didn't happen. Every tap fills the scorecard on{" "}
          <Link to={weekday === 7 ? "/dashboard/admin/brand-command?review=1" : "/dashboard/admin/brand-command"} className="font-semibold text-foreground underline underline-offset-4">Brand Command</Link>.
        </p>
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
                  tabIndex={hasChecks ? 0 : -1}
                  aria-pressed={hasChecks ? isDone : "mixed"}
                  aria-disabled={!hasChecks}
                  onClick={() => { void toggle(t); }}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); void toggle(t); } }}
                  className={cn(
                    "flex min-h-[56px] w-full cursor-pointer select-none items-start gap-3 rounded-2xl border bg-card p-4 transition-all active:scale-[0.99]",
                    isNow ? "border-primary ring-2 ring-primary" : "border-border",
                    isDone && "opacity-55",
                  )}
                >
                  <span className={cn("mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2", isDone ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
                    {!hasChecks ? <span aria-hidden="true">?</span> : isDone ? <Check className="h-4 w-4" /> : null}
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
