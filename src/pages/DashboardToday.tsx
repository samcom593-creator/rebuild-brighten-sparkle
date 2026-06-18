/**
 * /dashboard/today — Sam's daily flow surface.
 *
 * 2026-06-17 — Sam directive: "biggest problem is the calendars and the user
 * what to do list ... I could just tap circles and just mark that done shit."
 *
 * Phone-first. Native, no Todoist dep.
 * Hero: today's date + count of bookings + count of open tasks
 * Bookings: apex_scheduled_calls today, click → AgentProfileDrawer if linkable
 * Tasks: today_tasks open for current owner, tap-circle to complete
 * Add-input: Enter → INSERT new task
 */

import { useEffect, useMemo, useState, useCallback, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { CalendarCheck, Check, MoreHorizontal, Plus, Phone, Mail } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

interface TodayTask {
  id: string;
  owner_agent_id: string;
  title: string;
  notes: string | null;
  due_at: string | null;
  completed_at: string | null;
  priority: "low" | "med" | "high";
  source: string;
  created_at: string;
}

interface ScheduledCall {
  id: number;
  prospect_name: string | null;
  prospect_phone: string | null;
  prospect_email: string | null;
  start_at: string;
  duration_minutes: number | null;
  status: string | null;
  call_type: string | null;
  summary: string | null;
}

const PRIORITY_ORDER: Record<TodayTask["priority"], number> = { high: 3, med: 2, low: 1 };

function formatLongDate(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "long", month: "numeric", day: "numeric" });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

function todayBoundsUtc(): { startIso: string; endIso: string } {
  // Use local-day bounds; server tz can vary but Sam's bookings should be filtered by his perceived "today".
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

export default function DashboardToday() {
  const { user } = useAuth();
  const [ownerAgentId, setOwnerAgentId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TodayTask[]>([]);
  const [calls, setCalls] = useState<ScheduledCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTitle, setNewTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Resolve current user's agents.id once
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("agents")
        .select("id")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (!cancelled) setOwnerAgentId(data?.id ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const fetchAll = useCallback(async () => {
    if (!ownerAgentId) return;
    setLoading(true);
    const { startIso, endIso } = todayBoundsUtc();

    const [tasksResp, callsResp] = await Promise.all([
      // Note: 'high'/'low'/'med' don't alpha-sort to expected order; we re-sort
      // client-side in `sortedTasks` via PRIORITY_ORDER.
      supabase
        .from("today_tasks")
        .select("*")
        .eq("owner_agent_id", ownerAgentId)
        .is("completed_at", null)
        .order("due_at", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true }),
      supabase
        .from("apex_scheduled_calls")
        .select("id,prospect_name,prospect_phone,prospect_email,start_at,duration_minutes,status,call_type,summary")
        .gte("start_at", startIso)
        .lte("start_at", endIso)
        .neq("status", "cancelled")
        .order("start_at", { ascending: true }),
    ]);

    if (tasksResp.data) setTasks(tasksResp.data as TodayTask[]);
    if (callsResp.data) setCalls(callsResp.data as ScheduledCall[]);
    setLoading(false);
  }, [ownerAgentId]);

  useEffect(() => {
    if (ownerAgentId) {
      void fetchAll();
    }
  }, [ownerAgentId, fetchAll]);

  const heroDate = useMemo(() => formatLongDate(new Date()), []);

  const sortedTasks = useMemo(() => {
    return [...tasks].sort((a, b) => {
      const pa = PRIORITY_ORDER[a.priority] ?? 2;
      const pb = PRIORITY_ORDER[b.priority] ?? 2;
      if (pa !== pb) return pb - pa;
      if (a.due_at && b.due_at) return a.due_at.localeCompare(b.due_at);
      if (a.due_at) return -1;
      if (b.due_at) return 1;
      return a.created_at.localeCompare(b.created_at);
    });
  }, [tasks]);

  const toggleComplete = useCallback(
    async (task: TodayTask) => {
      const wasOpen = !task.completed_at;
      const optimisticAt = wasOpen ? new Date().toISOString() : null;

      // Optimistic update — drop if completing
      setTasks((prev) =>
        wasOpen ? prev.filter((t) => t.id !== task.id) : prev.map((t) => (t.id === task.id ? { ...t, completed_at: null } : t)),
      );

      const { error } = await supabase
        .from("today_tasks")
        .update({ completed_at: optimisticAt })
        .eq("id", task.id);

      if (error) {
        toast.error("Couldn't update task");
        void fetchAll();
      }
    },
    [fetchAll],
  );

  const updatePriority = useCallback(
    async (task: TodayTask, priority: TodayTask["priority"]) => {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, priority } : t)));
      const { error } = await supabase.from("today_tasks").update({ priority }).eq("id", task.id);
      if (error) {
        toast.error("Couldn't change priority");
        void fetchAll();
      }
    },
    [fetchAll],
  );

  const deleteTask = useCallback(
    async (task: TodayTask) => {
      setTasks((prev) => prev.filter((t) => t.id !== task.id));
      const { error } = await supabase.from("today_tasks").delete().eq("id", task.id);
      if (error) {
        toast.error("Couldn't delete");
        void fetchAll();
      }
    },
    [fetchAll],
  );

  const handleAdd = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      const title = newTitle.trim();
      if (!title || !ownerAgentId || submitting) return;
      setSubmitting(true);
      const { error, data } = await supabase
        .from("today_tasks")
        .insert({ owner_agent_id: ownerAgentId, title, priority: "med", source: "manual" })
        .select("*")
        .maybeSingle();
      setSubmitting(false);
      if (error || !data) {
        toast.error("Couldn't add task");
        return;
      }
      setTasks((prev) => [...prev, data as TodayTask]);
      setNewTitle("");
    },
    [newTitle, ownerAgentId, submitting],
  );

  return (
    <div className="min-h-screen bg-background pb-32">
      <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:py-8">
        {/* HERO */}
        <header className="mb-6 rounded-3xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
              <CalendarCheck className="h-6 w-6 text-primary" aria-hidden />
            </div>
            <div className="flex-1">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Today
              </div>
              <div className="mt-0.5 text-2xl font-bold tracking-tight">{heroDate}</div>
              <div className="mt-1 text-sm text-muted-foreground tabular-nums">
                {calls.length} {calls.length === 1 ? "call" : "calls"} &middot; {tasks.length}{" "}
                {tasks.length === 1 ? "task" : "tasks"}
              </div>
            </div>
          </div>
        </header>

        {/* BOOKINGS */}
        <section className="mb-6">
          <h2 className="mb-3 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Bookings
          </h2>
          {loading && calls.length === 0 ? (
            <div className="rounded-3xl border border-border bg-card p-5 text-sm text-muted-foreground">
              Loading...
            </div>
          ) : calls.length === 0 ? (
            <div className="rounded-3xl border border-border bg-card p-5 text-sm text-muted-foreground">
              No calls scheduled today.
            </div>
          ) : (
            <div className="space-y-2">
              {calls.map((c) => (
                <article
                  key={c.id}
                  className="rounded-3xl border border-border bg-card p-4 shadow-sm transition-colors hover:bg-accent/40"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-11 w-14 flex-shrink-0 flex-col items-center justify-center rounded-2xl bg-primary/10 px-2">
                      <span className="text-[10px] font-semibold uppercase text-primary/70">
                        {new Date(c.start_at).toLocaleTimeString("en-US", { hour12: true }).split(":")[0].replace(/^0+/, "") || "12"}
                      </span>
                      <span className="text-[10px] font-semibold uppercase text-primary">
                        {new Date(c.start_at).getHours() >= 12 ? "PM" : "AM"}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-base font-semibold tracking-tight">
                        {c.prospect_name || c.summary || "Unnamed call"}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground tabular-nums">
                        <span>{formatTime(c.start_at)}</span>
                        {c.duration_minutes ? <span>&middot; {c.duration_minutes}m</span> : null}
                        {c.call_type ? <span>&middot; {c.call_type}</span> : null}
                      </div>
                      {(c.prospect_phone || c.prospect_email) && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {c.prospect_phone && (
                            <a
                              href={`tel:${c.prospect_phone}`}
                              className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium hover:bg-secondary/80"
                            >
                              <Phone className="h-3 w-3" aria-hidden />
                              <span>{c.prospect_phone}</span>
                            </a>
                          )}
                          {c.prospect_email && (
                            <a
                              href={`mailto:${c.prospect_email}`}
                              className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium hover:bg-secondary/80"
                            >
                              <Mail className="h-3 w-3" aria-hidden />
                              <span className="max-w-[10rem] truncate">{c.prospect_email}</span>
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        {/* TASKS */}
        <section>
          <h2 className="mb-3 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Open tasks
          </h2>

          <div className="space-y-2">
            {loading && tasks.length === 0 ? (
              <div className="rounded-3xl border border-border bg-card p-5 text-sm text-muted-foreground">
                Loading...
              </div>
            ) : sortedTasks.length === 0 ? (
              <div className="rounded-3xl border border-border bg-card p-5 text-sm text-muted-foreground">
                Nothing open. Add something below.
              </div>
            ) : (
              sortedTasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  onToggle={() => toggleComplete(task)}
                  onPriority={(p) => updatePriority(task, p)}
                  onDelete={() => deleteTask(task)}
                />
              ))
            )}
          </div>

          {/* ADD TASK */}
          <form onSubmit={handleAdd} className="mt-3 flex items-center gap-2">
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border-2 border-dashed border-border bg-card">
              <Plus className="h-5 w-5 text-muted-foreground" aria-hidden />
            </div>
            <input
              type="text"
              inputMode="text"
              placeholder="Add a task..."
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className="h-11 w-full flex-1 rounded-3xl border border-border bg-card px-4 text-sm outline-none placeholder:text-muted-foreground focus:border-primary"
              disabled={!ownerAgentId || submitting}
              aria-label="Add task"
            />
          </form>
        </section>
      </div>
    </div>
  );
}

interface TaskRowProps {
  task: TodayTask;
  onToggle: () => void;
  onPriority: (p: TodayTask["priority"]) => void;
  onDelete: () => void;
}

function TaskRow({ task, onToggle, onPriority, onDelete }: TaskRowProps) {
  const isHigh = task.priority === "high";
  const isLow = task.priority === "low";
  const dueChip = task.due_at ? formatTime(task.due_at) : "—";

  return (
    <article
      className={cn(
        "flex items-center gap-3 rounded-3xl border border-border bg-card p-3 shadow-sm",
        isHigh && "border-primary/40 bg-primary/[0.03]",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-label={task.completed_at ? "Mark incomplete" : "Mark complete"}
        className={cn(
          "flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border-2 transition-colors",
          "active:scale-95",
          task.completed_at
            ? "border-primary bg-primary text-primary-foreground"
            : isHigh
              ? "border-primary/70 hover:bg-primary/10"
              : "border-border hover:bg-accent",
        )}
        style={{ touchAction: "manipulation" }}
      >
        {task.completed_at ? <Check className="h-5 w-5" aria-hidden /> : null}
      </button>

      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "truncate text-sm font-medium",
            task.completed_at && "text-muted-foreground line-through",
            isHigh && !task.completed_at && "font-semibold",
          )}
        >
          {task.title}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground tabular-nums">
          {isHigh ? <span className="font-semibold uppercase text-primary">High</span> : null}
          {isLow ? <span className="uppercase">Low</span> : null}
          <span>{dueChip}</span>
        </div>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Task menu"
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent"
          >
            <MoreHorizontal className="h-5 w-5" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onClick={() => onPriority("high")} disabled={task.priority === "high"}>
            Set high priority
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onPriority("med")} disabled={task.priority === "med"}>
            Set medium
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onPriority("low")} disabled={task.priority === "low"}>
            Set low
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onDelete} className="text-destructive">
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </article>
  );
}
