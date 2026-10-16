import { useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, CalendarCheck, CheckCircle2, ChevronRight, Circle,
  DollarSign, Flame, PlayCircle, WalletCards,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAgentIdentity, type UseAgentIdentityResult } from "@/hooks/useAgentIdentity";
import { useAuth } from "@/hooks/useAuth";
import { useBusinessToday } from "@/hooks/useBusinessToday";
import { usePageTitle } from "@/hooks/usePageTitle";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { QueryState, describeQuery, errorMessage } from "@/components/ui/query-state";
import {
  BUSINESS_TZ, describeEventTime, formatClock, formatDay, viewerTimeZone, zoneAbbreviation, zonedWallTimeToUtc,
} from "@/lib/calendarTime";
import {
  callsOnBusinessDay, completedOnBusinessDay, dueBucket, nextMeetingAfter, rankTodayTasks, summarizePostedPremium,
  type DueBucket, type PostedPremiumSummary, type RankClock, type TodayTask,
} from "@/lib/todayTasks";
import { cn } from "@/lib/utils";

interface Call {
  id: number;
  prospect_name: string | null;
  summary: string | null;
  location: string | null;
  start_at: string;
  end_at: string | null;
  call_type: string;
  status: string;
  outcome: string | null;
}

interface ContentItem {
  id: number;
  title: string | null;
  hook: string | null;
  platform: string | null;
  status: string;
}

interface Blocker {
  id: number;
  title: string | null;
  description: string | null;
  severity: string | null;
  dollar_impact: number | null;
}

interface FinanceSnapshot {
  ghost_ap_at_risk: number | string | null;
  dup_charges_open: number | null;
  ica_paid_stuck: number | null;
  as_of: string | null;
}

/** Currency for a value a successful read returned. A missing value reads as unavailable, never as $0. */
function money(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "Unavailable";
  const amount = Number(value);
  if (Number.isNaN(amount)) return "Unavailable";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(amount);
}

/** A count a successful read returned. A missing value reads as unknown, never as 0. */
function countLabel(value: number | null | undefined): string {
  return value === null || value === undefined || Number.isNaN(Number(value)) ? "Unknown" : Number(value).toLocaleString();
}

/** The REVENUE headline. When no posted deal carries a premium the total is unknown, not $0. */
function revenueTitle(summary: PostedPremiumSummary): string {
  if (summary.deals > 0 && summary.unpriced === summary.deals) return "ALP unknown";
  return `${money(summary.aop)} ALP`;
}

/** The deal count, naming the deals whose premium is missing instead of counting them as $0. */
function revenueDetail(summary: PostedPremiumSummary): string {
  const posted = `${summary.deals.toLocaleString()} ${summary.deals === 1 ? "deal" : "deals"} posted today`;
  return summary.unpriced > 0 ? `${posted}, ${summary.unpriced.toLocaleString()} without a premium amount` : posted;
}

/**
 * The state to show in place of the task sections when the login does not
 * resolve to exactly one agent record (F17). Null once it is resolved. A
 * failed read is an error with Retry, never "no tasks".
 */
function identityGate(me: UseAgentIdentityResult, compact?: boolean): ReactNode | null {
  if (me.isLoading) return <QueryState status="loading" label="your agent record" compact={compact} />;
  const identity = me.identity;
  const failure = !identity ? "The agent record could not be read." : identity.status === "error" ? identity.message : null;
  if (failure !== null) {
    return <QueryState status="error" label="your agent record" error={failure} onRetry={me.refetch} compact={compact} />;
  }
  if (identity.status === "ambiguous") {
    return (
      <QueryState
        status="empty"
        compact={compact}
        title="More than one agent record matches this login"
        body={`${identity.candidates.length} records match. Ask an admin to merge them. Nothing is shown until then.`}
      />
    );
  }
  if (identity.status === "none") {
    return <QueryState status="empty" compact={compact} title="This login has no agent record" body="Ask an admin to link it." />;
  }
  return null;
}

export default function DashboardToday() {
  usePageTitle("Galaxy Today");
  const qc = useQueryClient();
  const me = useAgentIdentity();
  const { isAdmin, isVa, isVaManager } = useAuth();
  // Same staff set as public.is_agency_staff(), which gates production_period_totals.
  const seesAgency = isAdmin || isVa || isVaManager;
  // The business day in Phoenix, kept live across midnight (F21). Every "today"
  // on this page derives from this key, never from the browser's calendar.
  const todayKey = useBusinessToday();
  const noonToday = zonedWallTimeToUtc(todayKey, "12:00", BUSINESS_TZ);
  const headerDate = `${formatDay(noonToday, BUSINESS_TZ)} · ${zoneAbbreviation(noonToday, BUSINESS_TZ)} business day`;

  const tasks = useQuery({
    queryKey: ["apex-today-tasks", me.agentId],
    enabled: !!me.agentId,
    refetchInterval: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("today_tasks")
        .select("id,title,notes,due_at,completed_at,priority,is_income_producing,created_at")
        .eq("owner_agent_id", me.agentId as string)
        .order("created_at", { ascending: true });
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error("The task read returned no result set.");
      return data as TodayTask[];
    },
  });

  const calls = useQuery({
    queryKey: ["apex-today-calls", todayKey],
    refetchInterval: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_upcoming_calls")
        .select("id,prospect_name,summary,location,start_at,end_at,call_type,status,outcome")
        .order("start_at", { ascending: true });
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error("The calls read returned no result set.");
      return callsOnBusinessDay(data as Call[], todayKey);
    },
  });

  const revenue = useQuery({
    queryKey: ["apex-today-revenue", todayKey, seesAgency ? "agency" : me.agentId],
    enabled: seesAgency || Boolean(me.agentId),
    refetchInterval: 300_000,
    queryFn: async () => {
      // Today's production, by the definition the leaderboard hero and
      // production_period_totals use: v_production_unified on its posted_date
      // bucket, without the external daily gap rows and rows with no agent.
      // Until 2026-10-15 this tile read the AgentLink book, which has had no
      // posted deal since 2026-10-02 (AgentLink is retired), so it showed a
      // successful $0 on days with real native deals: 6 deals / $9,802.44 on
      // 2026-10-15 alone. Agency staff see the agency; everyone else sees only
      // their own deals, never more than the old tile showed.
      // Known server-side gap (DDL, not changed here): v_production_canonical's
      // native branch casts posted_at to a UTC date, so a deal posted after
      // 17:00 Phoenix lands on the next day here and on the leaderboard alike.
      let query = supabase
        .from("v_production_unified")
        .select("annual_premium")
        .eq("posted_date", todayKey)
        .neq("origin", "external_daily_gap")
        .not("agent_id", "is", null);
      if (!seesAgency) query = query.eq("agent_id", me.agentId as string);
      const { data, error } = await query;
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error("The production read returned no result set.");
      return summarizePostedPremium(data);
    },
  });

  const content = useQuery({
    queryKey: ["apex-today-content"],
    refetchInterval: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("social_bot_drafts")
        .select("id,title,hook,platform,status")
        .in("status", ["approved", "pending", "awaiting_approval"])
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error("The content read returned no result set.");
      const rows = data as ContentItem[];
      return rows.find((row) => row.status === "approved") ?? rows[0] ?? null;
    },
  });

  const blockers = useQuery({
    queryKey: ["apex-today-blockers"],
    refetchInterval: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("social_bot_blockers")
        .select("id,title,description,severity,dollar_impact")
        .eq("status", "open")
        .order("dollar_impact", { ascending: false })
        .limit(3);
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error("The blockers read returned no result set.");
      return data as Blocker[];
    },
  });

  const finances = useQuery({
    queryKey: ["apex-today-finances"],
    refetchInterval: 300_000,
    queryFn: async () => {
      // v_cfo_snapshot is one row for the owner login and no row for any other
      // login. No row is reported as "no snapshot", never as $0 at risk.
      const { data, error } = await supabase
        .from("v_cfo_snapshot")
        .select("ghost_ap_at_risk,dup_charges_open,ica_paid_stuck,as_of")
        .limit(1);
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error("The finance snapshot read returned no result set.");
      return (data[0] as FinanceSnapshot | undefined) ?? null;
    },
  });

  const toggleTask = useMutation({
    mutationFn: async (task: TodayTask) => {
      const { error } = await supabase
        .from("today_tasks")
        .update({ completed_at: task.completed_at ? null : new Date().toISOString() })
        .eq("id", task.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["apex-today-tasks"] }),
    onError: (error: unknown) => toast.error(errorMessage(error, "Task update failed")),
  });

  // Ranked once per successful read (F20): dataUpdatedAt moves on every
  // fetch even when the rows did not change, so "overdue" is re-judged then.
  const ranked = useMemo(() => {
    const clock: RankClock = { nowMs: Math.max(Date.now(), tasks.dataUpdatedAt), todayKey };
    return { clock, open: tasks.data ? rankTodayTasks(tasks.data, clock) : [] };
  }, [tasks.data, tasks.dataUpdatedAt, todayKey]);
  const openTasks = ranked.open;
  const top3 = openTasks.slice(0, 3);
  const nowTaskId = top3[0]?.id ?? null;
  const done = useMemo(
    () => (tasks.data ? tasks.data.filter((task) => completedOnBusinessDay(task, todayKey)) : []),
    [tasks.data, todayKey],
  );
  const nextMeeting = calls.data ? nextMeetingAfter(calls.data, Date.now()) : null;
  const taskGate = identityGate(me);

  return (
    <div className="page-enter px-4 sm:px-6 pb-24 space-y-5 max-w-4xl mx-auto">
      <PageHeader eyebrow={headerDate} title="Galaxy Today" subtitle="One screen. Every item leads to an action." />

      <Section title="PRIORITIES" icon={<Flame className="h-4 w-4 text-rose-500" />} badge={tasks.isSuccess ? `${openTasks.length} open` : undefined}>
        {taskGate ?? (
          <QueryState
            {...describeQuery({ isPending: tasks.isPending, isError: tasks.isError, data: tasks.data, error: tasks.error, isEmpty: openTasks.length === 0 })}
            label="your tasks"
            onRetry={() => void tasks.refetch()}
            asOf={tasks.dataUpdatedAt}
            title={tasks.data?.length ? "No open tasks" : "No tasks yet"}
            body={tasks.data?.length ? "Everything on your list is done." : "Tasks added to your list show up here, most urgent first."}
          >
            <div className="space-y-2">
              {top3.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  active={task.id === nowTaskId}
                  bucket={dueBucket(task, ranked.clock)}
                  onToggle={() => toggleTask.mutate(task)}
                />
              ))}
              {openTasks.length > top3.length && (
                <p className="text-xs text-muted-foreground">{openTasks.length - top3.length} more open after these three.</p>
              )}
            </div>
          </QueryState>
        )}
      </Section>

      <Section title="NEXT MEETING" icon={<CalendarCheck className="h-4 w-4 text-amber-500" />}>
        <QueryState
          {...describeQuery({ isPending: calls.isPending, isError: calls.isError, data: calls.data, error: calls.error, isEmpty: nextMeeting === null })}
          label="today's calls"
          onRetry={() => void calls.refetch()}
          asOf={calls.dataUpdatedAt}
          title="No remaining meeting today"
          body={calls.data?.length ? `${calls.data.length} ${calls.data.length === 1 ? "call" : "calls"} today already ended.` : "Nothing is booked for the rest of the business day."}
        >
          {nextMeeting && <MeetingCard call={nextMeeting} />}
        </QueryState>
      </Section>

      <Section title="REVENUE" icon={<DollarSign className="h-4 w-4 text-emerald-500" />}>
        {(!seesAgency && identityGate(me, true)) || (
          <QueryState {...describeQuery(revenue)} label="today's production" onRetry={() => void revenue.refetch()} asOf={revenue.dataUpdatedAt}>
            {revenue.data && (
              <ActionCard
                href="/dashboard/leaderboard"
                title={revenueTitle(revenue.data)}
                detail={revenueDetail(revenue.data)}
              />
            )}
          </QueryState>
        )}
      </Section>

      <Section title="CONTENT" icon={<PlayCircle className="h-4 w-4 text-violet-500" />}>
        <QueryState
          {...describeQuery(content)}
          label="ready content"
          onRetry={() => void content.refetch()}
          asOf={content.dataUpdatedAt}
          title="No ready content"
          body={<Link to="/dashboard/admin/content-command" className="underline underline-offset-4">Open Content Command to stage one piece.</Link>}
        >
          {content.data && (
            <ActionCard
              href="/dashboard/admin/content-command"
              title={content.data.title || content.data.hook || "Publish next approved piece"}
              detail={`${content.data.platform ?? "platform"} · ${content.data.status}`}
            />
          )}
        </QueryState>
      </Section>

      <Section title="BLOCKED" icon={<AlertTriangle className="h-4 w-4 text-rose-500" />} badge={blockers.isSuccess ? String(blockers.data.length) : undefined}>
        <QueryState
          {...describeQuery(blockers)}
          label="open blockers"
          onRetry={() => void blockers.refetch()}
          asOf={blockers.dataUpdatedAt}
          title="No open blockers"
          body="Nothing is flagged as blocking right now."
        >
          <div className="space-y-2">
            {blockers.data?.map((blocker) => (
              <ActionCard
                key={blocker.id}
                href="/dashboard/admin/content-command"
                title={blocker.title || blocker.description || "Open blocker"}
                detail={`${blocker.severity ?? "open"}${Number(blocker.dollar_impact ?? 0) ? ` · ${money(blocker.dollar_impact)} impact` : ""}`}
              />
            ))}
          </div>
        </QueryState>
      </Section>

      <Section title="FINANCES" icon={<WalletCards className="h-4 w-4 text-amber-500" />}>
        <QueryState
          {...describeQuery(finances)}
          label="the finance snapshot"
          onRetry={() => void finances.refetch()}
          asOf={finances.dataUpdatedAt}
          title="No finance snapshot for this login"
          body="The CFO snapshot returned no row for this account, so no amounts are shown."
        >
          {finances.data && <FinanceCard snapshot={finances.data} />}
        </QueryState>
      </Section>

      <Section title="DONE" icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />} badge={tasks.isSuccess ? String(done.length) : undefined}>
        {identityGate(me, true) ?? (
          <QueryState
            {...describeQuery({ isPending: tasks.isPending, isError: tasks.isError, data: tasks.data, error: tasks.error, isEmpty: done.length === 0 })}
            label="completed tasks"
            compact
            onRetry={() => void tasks.refetch()}
            asOf={tasks.dataUpdatedAt}
            title="Nothing completed yet."
            body="Tasks you finish today land here."
          >
            <div className="space-y-2">
              {done.map((task) => (
                <TaskCard key={task.id} task={task} onToggle={() => toggleTask.mutate(task)} />
              ))}
            </div>
          </QueryState>
        )}
      </Section>
    </div>
  );
}

function Section({ title, icon, badge, children }: { title: string; icon: ReactNode; badge?: string; children: ReactNode }) {
  return <section className="space-y-2"><div className="flex items-center gap-2">{icon}<h2 className="text-sm font-black tracking-[0.16em]">{title}</h2>{badge && <Badge variant="outline" className="text-[11px]">{badge}</Badge>}</div>{children}</section>;
}

/** The due line under a task, in the business zone. Nothing for an unscheduled task. */
function describeDue(task: TodayTask, bucket: DueBucket | undefined): string | null {
  if (!bucket || !task.due_at || bucket === "unscheduled") return null;
  const clockLabel = `${formatClock(task.due_at, BUSINESS_TZ)} ${zoneAbbreviation(task.due_at, BUSINESS_TZ)}`;
  if (bucket === "due_today") return `Due today · ${clockLabel}`;
  const stamp = `${formatDay(task.due_at, BUSINESS_TZ)}, ${clockLabel}`;
  return bucket === "overdue" ? `Overdue · was due ${stamp}` : `Due ${stamp}`;
}

function TaskCard({ task, active, bucket, onToggle }: { task: TodayTask; active?: boolean; bucket?: DueBucket; onToggle: () => void }) {
  const dueLine = describeDue(task, bucket);
  return (
    <Card className={cn(task.completed_at ? "opacity-60" : task.is_income_producing && "border-emerald-500/40 bg-emerald-500/5", active && "ring-1 ring-primary/40")}>
      <CardContent className="p-3 flex items-center gap-3">
        <button type="button" onClick={onToggle} aria-label={task.completed_at ? "Reopen task" : "Complete task"}>
          {task.completed_at ? <CheckCircle2 className="h-6 w-6 text-emerald-500" /> : <Circle className="h-6 w-6 text-muted-foreground" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            {active && <Badge className="text-[10px] shrink-0">NOW</Badge>}
            {task.priority === "high" && !task.completed_at && <Badge variant="outline" className="text-[10px] shrink-0">High</Badge>}
            <p className={cn("text-sm font-semibold truncate", task.completed_at && "line-through")}>{task.title}</p>
          </div>
          {task.notes && <p className="text-xs text-muted-foreground truncate">{task.notes}</p>}
          {dueLine && <p className={cn("text-xs", bucket === "overdue" ? "text-destructive" : "text-muted-foreground")}>{dueLine}</p>}
        </div>
        {task.is_income_producing && <DollarSign className="h-4 w-4 text-emerald-500" />}
      </CardContent>
    </Card>
  );
}

function MeetingCard({ call }: { call: Call }) {
  const label = call.prospect_name || call.summary || "Meeting";
  // v_upcoming_calls stores no zone, so the business zone labels the start and
  // the viewer's own clock is added only when it reads differently (F21).
  const when = describeEventTime(call.start_at, null, viewerTimeZone());
  return (
    <Card className="border-amber-500/30 bg-amber-500/5">
      <CardContent className="p-4 flex items-center gap-3">
        <div className="w-24 shrink-0">
          <p className="font-black tabular-nums">{when.eventLabel}</p>
          {when.viewerLabel && <p className="text-[11px] text-muted-foreground">{when.viewerLabel} your time</p>}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate">{label}</p>
          <p className="text-xs text-muted-foreground">{call.call_type}</p>
        </div>
        {call.location?.startsWith("http") && (
          <Button asChild size="sm"><a href={call.location} target="_blank" rel="noopener noreferrer">Join</a></Button>
        )}
      </CardContent>
    </Card>
  );
}

function FinanceCard({ snapshot }: { snapshot: FinanceSnapshot }) {
  const atRisk = snapshot.ghost_ap_at_risk === null || snapshot.ghost_ap_at_risk === undefined
    ? "At-risk total unavailable"
    : `${money(snapshot.ghost_ap_at_risk)} at risk`;
  return (
    <ActionCard
      href="/dashboard/finances"
      title={atRisk}
      detail={`${countLabel(snapshot.dup_charges_open)} duplicate-charge flags · ${countLabel(snapshot.ica_paid_stuck)} paid-and-stuck`}
    />
  );
}

function ActionCard({ href, title, detail }: { href: string; title: string; detail: string }) {
  return <Link to={href}><Card className="hover:border-emerald-500/40 transition-colors"><CardContent className="p-4 flex items-center gap-3"><div className="min-w-0 flex-1"><p className="text-sm font-semibold truncate">{title}</p><p className="text-xs text-muted-foreground">{detail}</p></div><ChevronRight className="h-4 w-4 text-muted-foreground" /></CardContent></Card></Link>;
}
