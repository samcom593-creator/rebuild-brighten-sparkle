import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2, Circle, DollarSign, Phone, Plus, Sparkles,
  Flame, ChevronRight, CalendarCheck, Timer, Star, Video,
} from "lucide-react";
import { format, isToday } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/* ------------------------------------------------------------------ */
/*  MP239 · /dashboard/today
    Sam directive 2026-07-05: "One simple todo list to mark income-
    producing tasks with auto-populating calendar appointments."

    Three surfaces, one page, one-tap complete on each:
      1. Today's income-producing tasks (today_tasks WHERE is_income_producing)
      2. Today's scheduled appointments (v_upcoming_calls → today only)
      3. Recovery Queue top 5 hot prospects (v_hot_licensing_prospects LIMIT 5)

    Extends the today_tasks table with is_income_producing + scheduled_call_id
    columns (migration 20260705140000_today_tasks_income_producing.sql).
------------------------------------------------------------------ */

interface TaskRow {
  id: string;
  owner_agent_id: string;
  title: string;
  notes: string | null;
  due_at: string | null;
  completed_at: string | null;
  priority: "low" | "med" | "high";
  source: string;
  is_income_producing: boolean;
  scheduled_call_id: number | null;
  created_at: string;
}

interface ScheduledCall {
  id: number;
  prospect_name: string | null;
  prospect_phone: string | null;
  prospect_email: string | null;
  summary: string | null;
  location: string | null;
  start_at: string;
  end_at: string | null;
  duration_minutes: number | null;
  call_type: string;
  status: string;
  outcome: string | null;
}

interface HotProspect {
  application_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  state: string | null;
  cohort: string;
  days_since_touch: number | null;
}

function telHref(raw: string | null): string {
  if (!raw) return "#";
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "#";
  return `tel:${digits.startsWith("1") ? "+" : "+1"}${digits}`;
}

/**
 * MP239b — extract a join-URL from an appointment's location field.
 * Calendly + Google Calendar stash the Zoom/Meet/Teams link in `location`
 * (sometimes as a bare URL, sometimes "Zoom · https://...").
 * Returns null when no https:// URL is present so the UI can hide the CTA.
 */
function extractJoinUrl(location: string | null): string | null {
  if (!location) return null;
  const m = location.match(/https?:\/\/[^\s"'<>]+/i);
  if (!m) return null;
  const url = m[0];
  // Anchor the button to real meeting hosts we know Sam uses. Anything
  // else is likely a stray link and we don't want a misleading "Join" CTA.
  if (/(zoom\.us|meet\.google\.com|teams\.microsoft\.com|meet\.jit\.si|whereby\.com|webex\.com)/i.test(url)) {
    return url;
  }
  return null;
}

function joinLabel(url: string): string {
  if (/zoom\.us/i.test(url)) return "Zoom";
  if (/meet\.google\.com/i.test(url)) return "Meet";
  if (/teams\.microsoft\.com/i.test(url)) return "Teams";
  return "Join";
}

function formatPhone(raw: string | null): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return raw;
}

export default function DashboardToday() {
  usePageTitle("Today · APEX");
  const { user, isAdmin } = useAuth();
  const qc = useQueryClient();

  /* ---------- agent_id lookup so we can insert new tasks ---------- */
  const agentQ = useQuery({
    queryKey: ["today-owner-agent", user?.id],
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agents")
        .select("id, display_name")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data as { id: string; display_name: string | null } | null;
    },
  });
  const ownerAgentId = agentQ.data?.id ?? null;

  /* ---------- tasks ---------- */
  const tasksQ = useQuery({
    queryKey: ["today-tasks", ownerAgentId, isAdmin],
    enabled: !!user?.id,
    staleTime: 15_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<TaskRow[]> => {
      // MP239 columns is_income_producing + scheduled_call_id are not yet in
      // src/integrations/supabase/types.ts (types regen ships separately) —
      // narrow the cast to `any` on this table until the next types pull.
      let q: any = (supabase as any)
        .from("today_tasks")
        .select("id, owner_agent_id, title, notes, due_at, completed_at, priority, source, is_income_producing, scheduled_call_id, created_at")
        .order("is_income_producing", { ascending: false })
        .order("completed_at", { ascending: true, nullsFirst: true })
        .order("priority", { ascending: false })
        .order("created_at", { ascending: true })
        .limit(100);
      // Non-admins get RLS-scoped automatically; admins get their own by default
      // (they can hit /admin/SamHQ for the full leadership view).
      if (ownerAgentId) q = q.eq("owner_agent_id", ownerAgentId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as TaskRow[];
    },
  });

  /* ---------- today's calls ---------- */
  const callsQ = useQuery({
    queryKey: ["today-page-calls"],
    staleTime: 30_000,
    refetchInterval: 2 * 60_000,
    queryFn: async (): Promise<ScheduledCall[]> => {
      // MP239b — apex_scheduled_calls is the source of truth (Calendly + Google
      // Calendar webhooks land here). v_upcoming_calls is a thin projection.
      // Server-side sort so first-call-of-the-day is always at the top even if
      // the query returns >100 rows across days. Client-side isToday() uses the
      // browser tz which, on Sam's Mac (America/Chicago), matches the daemon.
      const { data, error } = await supabase
        .from("v_upcoming_calls")
        .select("id, prospect_name, prospect_phone, prospect_email, summary, location, start_at, end_at, duration_minutes, call_type, status, outcome")
        .order("start_at", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as ScheduledCall[]).filter((c) => isToday(new Date(c.start_at)));
    },
  });

  /* ---------- top 5 hot prospects ---------- */
  const hotQ = useQuery({
    queryKey: ["today-hot-prospects"],
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    queryFn: async (): Promise<HotProspect[]> => {
      const { data, error } = await supabase
        .from("v_hot_licensing_prospects" as any)
        .select("application_id, name, phone, email, state, cohort, days_since_touch")
        .order("days_since_touch", { ascending: false })
        .limit(5);
      if (error) throw error;
      return ((data as unknown) as HotProspect[]) ?? [];
    },
  });

  /* ---------- mutations ---------- */
  const toggleDone = useMutation({
    mutationFn: async (t: TaskRow) => {
      const nextCompleted = t.completed_at ? null : new Date().toISOString();
      const { error } = await (supabase as any)
        .from("today_tasks")
        .update({ completed_at: nextCompleted })
        .eq("id", t.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["today-tasks"] }),
    onError: (e: any) => toast.error(e?.message ?? "Could not update task"),
  });

  const toggleIncome = useMutation({
    mutationFn: async (t: TaskRow) => {
      const { error } = await (supabase as any)
        .from("today_tasks")
        .update({ is_income_producing: !t.is_income_producing })
        .eq("id", t.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["today-tasks"] }),
    onError: (e: any) => toast.error(e?.message ?? "Could not tag task"),
  });

  const addTask = useMutation({
    mutationFn: async (payload: { title: string; income: boolean }) => {
      if (!ownerAgentId) throw new Error("No agent row for current user");
      const { error } = await (supabase as any)
        .from("today_tasks")
        .insert({
          owner_agent_id: ownerAgentId,
          title: payload.title,
          is_income_producing: payload.income,
          priority: payload.income ? "high" : "med",
          source: "dashboard-today",
        });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["today-tasks"] });
      toast.success("Task added");
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not add task"),
  });

  const markCallDone = useMutation({
    mutationFn: async (call: ScheduledCall) => {
      // 1. Flip the source appointment status.
      const { error: e1 } = await (supabase as any)
        .from("apex_scheduled_calls")
        .update({ status: "completed" })
        .eq("id", call.id);
      if (e1) throw e1;
      // 2. If a mirror task exists, complete it too.
      const { error: e2 } = await (supabase as any)
        .from("today_tasks")
        .update({ completed_at: new Date().toISOString() })
        .eq("scheduled_call_id", call.id)
        .is("completed_at", null);
      if (e2 && e2.code !== "PGRST116") throw e2;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["today-page-calls"] });
      qc.invalidateQueries({ queryKey: ["today-tasks"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not mark call done"),
  });

  /* ---------- new-task input ---------- */
  const [draft, setDraft] = useState("");
  const [draftIsIncome, setDraftIsIncome] = useState(true);

  /* ---------- derived: auto-mirror today's appointments into task list ----------
     Purely a UI convenience — surfaced inline so Sam does not need to
     round-trip via a background job. Not persisted unless he taps + on one. */
  const tasks = tasksQ.data ?? [];
  const income = tasks.filter((t) => t.is_income_producing && !t.completed_at);
  const other = tasks.filter((t) => !t.is_income_producing && !t.completed_at);
  const done = tasks.filter((t) => t.completed_at);

  const doneCount = done.length;
  const openCount = tasks.length - doneCount;
  const incomeOpen = income.length;

  const heroDate = format(new Date(), "EEEE · MMM d");

  return (
    <div className="page-enter px-4 sm:px-6 pb-24 space-y-5 max-w-4xl mx-auto">
      <PageHeader
        eyebrow={heroDate}
        eyebrowIcon={<CalendarCheck className="h-3 w-3" />}
        title="Today"
        subtitle="One list. Income-producing tasks pinned to the top. Appointments and hottest prospects one tap away. Tap a circle to mark it done."
      />

      {/* ---------------- hero band ---------------- */}
      <TodayHero
        incomeOpen={incomeOpen}
        openCount={openCount}
        doneCount={doneCount}
        callsToday={callsQ.data?.length ?? 0}
        hotProspects={hotQ.data?.length ?? 0}
      />

      {/* ---------------- add-task row ---------------- */}
      <Card>
        <CardContent className="p-3 flex items-center gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && draft.trim()) {
                addTask.mutate({ title: draft.trim(), income: draftIsIncome });
                setDraft("");
              }
            }}
            placeholder="Add a task and press Enter…"
            className="flex-1"
            disabled={!ownerAgentId}
          />
          <Button
            type="button"
            variant={draftIsIncome ? "default" : "outline"}
            size="sm"
            onClick={() => setDraftIsIncome((v) => !v)}
            className={cn(
              "shrink-0",
              draftIsIncome && "bg-emerald-600 hover:bg-emerald-700 text-white",
            )}
            title="Toggle income-producing"
          >
            <DollarSign className="h-3.5 w-3.5" />
            <span className="hidden sm:inline ml-1">Income</span>
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              if (!draft.trim()) return;
              addTask.mutate({ title: draft.trim(), income: draftIsIncome });
              setDraft("");
            }}
            disabled={!draft.trim() || !ownerAgentId || addTask.isPending}
            className="shrink-0"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </CardContent>
      </Card>

      {!ownerAgentId && !agentQ.isLoading && (
        <p className="text-xs text-amber-500 px-1">
          No agent profile linked to your login yet — task edits are disabled until an admin links one.
        </p>
      )}

      {/* ---------------- section 1: income-producing tasks ---------------- */}
      <SectionHeader
        icon={<DollarSign className="h-4 w-4 text-emerald-500" />}
        title="Income-producing today"
        count={incomeOpen}
        subtitle="These move money. Do these first."
      />
      {tasksQ.isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : income.length === 0 ? (
        <EmptyLine>
          Nothing tagged as income yet. Tap the dollar-sign on any task below to pin it here.
        </EmptyLine>
      ) : (
        <div className="space-y-2">
          {income.map((t) => (
            <TaskRowCard
              key={t.id}
              task={t}
              onToggleDone={() => toggleDone.mutate(t)}
              onToggleIncome={() => toggleIncome.mutate(t)}
            />
          ))}
        </div>
      )}

      {/* ---------------- section 2: today's appointments ---------------- */}
      <SectionHeader
        icon={<CalendarCheck className="h-4 w-4 text-amber-500" />}
        title="Appointments today"
        count={callsQ.data?.length ?? 0}
        subtitle="Auto-populated from your calendar. Tap the circle to mark done."
      />
      {callsQ.isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : (callsQ.data ?? []).length === 0 ? (
        <EmptyLine>No calls on the books for today. Book one, or work the hot prospects below.</EmptyLine>
      ) : (
        <div className="space-y-2">
          {(callsQ.data ?? []).map((c) => (
            <CallRowCard
              key={c.id}
              call={c}
              onMarkDone={() => markCallDone.mutate(c)}
            />
          ))}
        </div>
      )}

      {/* ---------------- section 3: hot prospects ---------------- */}
      <SectionHeader
        icon={<Flame className="h-4 w-4 text-rose-500" />}
        title="Hot recovery queue"
        count={hotQ.data?.length ?? 0}
        subtitle="Top 5 closest-to-licensed prospects. One tap dials."
        rightSlot={
          <Button asChild variant="ghost" size="sm">
            <Link to="/admin/recovery-queue" className="text-xs">
              Full queue <ChevronRight className="h-3 w-3 ml-1" />
            </Link>
          </Button>
        }
      />
      {hotQ.isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : (hotQ.data ?? []).length === 0 ? (
        <EmptyLine>Nothing hot right now. Fresh applicants will surface here as they enter the pipeline.</EmptyLine>
      ) : (
        <div className="space-y-2">
          {(hotQ.data ?? []).map((p) => (
            <ProspectRowCard key={p.application_id} p={p} />
          ))}
        </div>
      )}

      {/* ---------------- other open tasks (unpinned) ---------------- */}
      {other.length > 0 && (
        <>
          <SectionHeader
            icon={<Sparkles className="h-4 w-4 text-slate-400" />}
            title="Other open tasks"
            count={other.length}
            subtitle="Not tagged as income-producing yet."
          />
          <div className="space-y-2">
            {other.map((t) => (
              <TaskRowCard
                key={t.id}
                task={t}
                onToggleDone={() => toggleDone.mutate(t)}
                onToggleIncome={() => toggleIncome.mutate(t)}
              />
            ))}
          </div>
        </>
      )}

      {/* ---------------- done today (collapsed footer) ---------------- */}
      {doneCount > 0 && (
        <>
          <SectionHeader
            icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />}
            title="Cleared today"
            count={doneCount}
            subtitle="Nice."
          />
          <div className="space-y-2 opacity-60">
            {done.slice(0, 20).map((t) => (
              <TaskRowCard
                key={t.id}
                task={t}
                onToggleDone={() => toggleDone.mutate(t)}
                onToggleIncome={() => toggleIncome.mutate(t)}
              />
            ))}
          </div>
        </>
      )}

      {tasksQ.isError && (
        <Card className="border-rose-500/40 bg-rose-500/5">
          <CardContent className="p-4 text-sm text-rose-600 dark:text-rose-400">
            Task list failed to load: {(tasksQ.error as any)?.message ?? "unknown error"}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* -------------------- small pieces -------------------- */

function SectionHeader({
  icon, title, count, subtitle, rightSlot,
}: {
  icon: React.ReactNode; title: string; count: number; subtitle?: string; rightSlot?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 pt-2">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {icon}
        <h2 className="text-sm font-bold uppercase tracking-wide truncate">{title}</h2>
        <Badge variant="outline" className="text-[10px]">{count}</Badge>
      </div>
      {rightSlot}
      {subtitle && !rightSlot && (
        <p className="text-[11px] text-muted-foreground hidden sm:block truncate">{subtitle}</p>
      )}
    </div>
  );
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-4">
        <EmptyState
          icon={<Circle className="h-5 w-5" />}
          title="Nothing here yet"
          description={String(children)}
        />
      </CardContent>
    </Card>
  );
}

function TaskRowCard({
  task, onToggleDone, onToggleIncome,
}: {
  task: TaskRow;
  onToggleDone: () => void;
  onToggleIncome: () => void;
}) {
  const done = !!task.completed_at;
  return (
    <Card className={cn(
      task.is_income_producing && !done && "border-emerald-500/40 bg-emerald-500/5",
      done && "border-slate-200 dark:border-slate-800",
    )}>
      <CardContent className="p-3 flex items-center gap-3">
        <button
          type="button"
          onClick={onToggleDone}
          aria-label={done ? "Mark not done" : "Mark done"}
          className="shrink-0"
        >
          {done ? (
            <CheckCircle2 className="h-6 w-6 text-emerald-500" />
          ) : (
            <Circle className="h-6 w-6 text-slate-400 hover:text-emerald-500 transition-colors" />
          )}
        </button>
        <div className="flex-1 min-w-0">
          <p className={cn(
            "text-sm font-medium truncate",
            done && "line-through text-muted-foreground",
          )}>
            {task.title}
          </p>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
            {task.priority === "high" && !done && (
              <Badge variant="outline" className="text-[10px] border-rose-500/40 text-rose-500">
                high
              </Badge>
            )}
            {task.scheduled_call_id && (
              <span className="flex items-center gap-1">
                <CalendarCheck className="h-3 w-3" /> from calendar
              </span>
            )}
            {task.source && task.source !== "manual" && task.source !== "dashboard-today" && (
              <span className="truncate">{task.source}</span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onToggleIncome}
          aria-label={task.is_income_producing ? "Unmark income-producing" : "Mark income-producing"}
          className="shrink-0 p-1"
        >
          <Star
            className={cn(
              "h-5 w-5 transition-colors",
              task.is_income_producing
                ? "fill-emerald-500 text-emerald-500"
                : "text-slate-400 hover:text-emerald-500",
            )}
          />
        </button>
      </CardContent>
    </Card>
  );
}

function CallRowCard({
  call, onMarkDone,
}: {
  call: ScheduledCall; onMarkDone: () => void;
}) {
  const start = new Date(call.start_at);
  const isDone =
    (call.status ?? "").toLowerCase() === "completed" ||
    (call.outcome ?? "").toLowerCase() === "connected" ||
    (call.outcome ?? "").toLowerCase() === "booked";
  const label = call.prospect_name || call.summary || "Untitled call";

  return (
    <Card className={cn(
      "border",
      isDone
        ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-500/30"
        : "border-amber-500/20 bg-amber-500/5",
    )}>
      <CardContent className="p-3 flex items-center gap-3">
        <button
          type="button"
          onClick={onMarkDone}
          aria-label={isDone ? "Already completed" : "Mark call done"}
          className="shrink-0"
          disabled={isDone}
        >
          {isDone ? (
            <CheckCircle2 className="h-6 w-6 text-emerald-500" />
          ) : (
            <Circle className="h-6 w-6 text-slate-400 hover:text-emerald-500 transition-colors" />
          )}
        </button>
        <div className="text-center w-14 shrink-0">
          <p className="text-14 font-bold tabular-nums leading-none">{format(start, "h:mm")}</p>
          <p className="text-[10px] text-muted-foreground uppercase">{format(start, "a")}</p>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{label}</p>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            {call.duration_minutes && (
              <span className="flex items-center gap-1">
                <Timer className="h-3 w-3" /> {call.duration_minutes}m
              </span>
            )}
            {call.call_type && (
              <Badge variant="outline" className="text-[10px]">{call.call_type}</Badge>
            )}
          </div>
        </div>
        {(() => {
          const joinUrl = extractJoinUrl(call.location);
          return joinUrl ? (
            <Button asChild size="sm" className="shrink-0 bg-sky-600 hover:bg-sky-700 text-white">
              <a href={joinUrl} target="_blank" rel="noopener noreferrer">
                <Video className="h-3.5 w-3.5 mr-1" /> {joinLabel(joinUrl)}
              </a>
            </Button>
          ) : null;
        })()}
        {call.prospect_phone && (
          <Button asChild size="sm" variant="outline" className="shrink-0">
            <a href={telHref(call.prospect_phone)}>
              <Phone className="h-3.5 w-3.5 mr-1" /> Call
            </a>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function ProspectRowCard({ p }: { p: HotProspect }) {
  return (
    <Card className="border-rose-500/25 bg-rose-500/5">
      <CardContent className="p-3 flex items-center gap-3">
        <Flame className="h-5 w-5 text-rose-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{p.name}</p>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground flex-wrap">
            {p.state && <span>{p.state}</span>}
            {p.days_since_touch !== null && (
              <span className="text-amber-500">{p.days_since_touch}d stale</span>
            )}
            {p.cohort && <Badge variant="outline" className="text-[10px]">{p.cohort.replace(/^[A-G]_/, "")}</Badge>}
          </div>
        </div>
        {p.phone && (
          <Button asChild size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white shrink-0">
            <a href={telHref(p.phone)}>
              <Phone className="h-3.5 w-3.5 mr-1" />
              <span className="hidden sm:inline">{formatPhone(p.phone)}</span>
              <span className="sm:hidden">Call</span>
            </a>
          </Button>
        )}
        <Button asChild variant="ghost" size="sm" className="shrink-0 h-8 w-8 p-0">
          <Link to={`/dashboard/applicants?id=${p.application_id}`} aria-label="Open applicant">
            <ChevronRight className="h-4 w-4" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

/* -------------------- hero -------------------- */

function TodayHero({
  incomeOpen, openCount, doneCount, callsToday, hotProspects,
}: {
  incomeOpen: number; openCount: number; doneCount: number; callsToday: number; hotProspects: number;
}) {
  const total = openCount + doneCount;
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  return (
    <div className="rounded-2xl border border-emerald-500/25 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 text-white overflow-hidden relative">
      <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-emerald-500/20 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -left-24 h-72 w-72 rounded-full bg-amber-500/10 blur-3xl pointer-events-none" />
      <div className="relative p-5 sm:p-6">
        <div className="flex items-center gap-2 mb-3">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
          </span>
          <p className="text-[11px] uppercase tracking-[0.32em] font-bold text-emerald-300">TODAY · LIVE</p>
          <p className="text-[11px] text-white/50 ml-auto tabular-nums">{pct}% cleared</p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <HeroTile label="INCOME OPEN" value={incomeOpen} accent="text-emerald-300" />
          <HeroTile label="APPOINTMENTS" value={callsToday} accent="text-amber-300" />
          <HeroTile label="HOT PROSPECTS" value={hotProspects} accent="text-rose-300" />
          <HeroTile label="DONE / TOTAL" value={`${doneCount}/${total}`} accent="text-white" />
        </div>
      </div>
    </div>
  );
}

function HeroTile({ label, value, accent }: { label: string; value: number | string; accent: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-white/50 font-bold mb-1">{label}</p>
      <p className={cn("text-[32px] sm:text-[36px] leading-none font-black tabular-nums", accent)}>{value}</p>
    </div>
  );
}
