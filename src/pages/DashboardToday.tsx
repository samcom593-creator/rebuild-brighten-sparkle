import { useMemo } from "react";
import { Link } from "react-router-dom";
import { format, isToday } from "date-fns";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, CalendarCheck, CheckCircle2, ChevronRight, Circle,
  DollarSign, Flame, PlayCircle, WalletCards,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePageTitle } from "@/hooks/usePageTitle";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Task {
  id: string;
  title: string;
  notes: string | null;
  due_at: string | null;
  completed_at: string | null;
  priority: "low" | "med" | "high";
  is_income_producing: boolean;
}

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
  ghost_ap_at_risk: number | string;
  dup_charges_open: number;
  ica_paid_stuck: number;
  as_of: string;
}

const money = (value: number | string | null | undefined) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })
    .format(Number(value ?? 0));

export default function DashboardToday() {
  usePageTitle("APEX Today");
  const { user } = useAuth();
  const qc = useQueryClient();
  const today = format(new Date(), "yyyy-MM-dd");

  const agent = useQuery({
    queryKey: ["today-agent", user?.id], enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from("agents").select("id").eq("user_id", user!.id).maybeSingle();
      if (error) throw error;
      return data as { id: string } | null;
    },
  });

  const tasks = useQuery({
    queryKey: ["apex-today-tasks", agent.data?.id], enabled: !!agent.data?.id,
    refetchInterval: 300_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("today_tasks")
        .select("id,title,notes,due_at,completed_at,priority,is_income_producing")
        .eq("owner_agent_id", agent.data!.id)
        .order("is_income_producing", { ascending: false })
        .order("completed_at", { ascending: true, nullsFirst: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Task[];
    },
  });

  const calls = useQuery({
    queryKey: ["apex-today-calls", today], refetchInterval: 300_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("v_upcoming_calls")
        .select("id,prospect_name,summary,location,start_at,end_at,call_type,status,outcome")
        .order("start_at", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as unknown as Call[]).filter((call) => isToday(new Date(call.start_at)));
    },
  });

  const revenue = useQuery({
    queryKey: ["apex-today-revenue", today], refetchInterval: 300_000 * 60_000,
    queryFn: async () => {
      // Source from agentlink_book (posted_date) — the SAME truth the leaderboard uses.
      // daily_production was inflated ~2.2x vs the book, so the dashboard revenue
      // disagreed with the leaderboard. One source of truth.
      const { data, error } = await (supabase as any).from("v_agentlink_book_scoped" as any)
        .select("annual_premium").eq("posted_date", today).not("is_dead", "is", true);
      if (error) throw error;
      const rows = (data ?? []) as Array<{ annual_premium: number | string | null }>;
      return { aop: rows.reduce((s, r) => s + Number(r.annual_premium ?? 0), 0), deals: rows.length };
    },
  });

  const content = useQuery({
    queryKey: ["apex-today-content"], refetchInterval: 300_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("social_bot_drafts")
        .select("id,title,hook,platform,status")
        .in("status", ["approved", "pending", "awaiting_approval"])
        .order("created_at", { ascending: false }).limit(20);
      if (error) throw error;
      const rows = (data ?? []) as ContentItem[];
      return rows.find((row) => row.status === "approved") ?? rows[0] ?? null;
    },
  });

  const blockers = useQuery({
    queryKey: ["apex-today-blockers"], refetchInterval: 300_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("social_bot_blockers")
        .select("id,title,description,severity,dollar_impact")
        .eq("status", "open").order("dollar_impact", { ascending: false }).limit(3);
      if (error) throw error;
      return (data ?? []) as Blocker[];
    },
  });

  const finances = useQuery({
    queryKey: ["apex-today-finances"], refetchInterval: 300_000 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("v_cfo_snapshot")
        .select("ghost_ap_at_risk,dup_charges_open,ica_paid_stuck,as_of").maybeSingle();
      if (error) throw error;
      return data as FinanceSnapshot | null;
    },
  });

  const toggleTask = useMutation({
    mutationFn: async (task: Task) => {
      const { error } = await (supabase as any).from("today_tasks")
        .update({ completed_at: task.completed_at ? null : new Date().toISOString() }).eq("id", task.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["apex-today-tasks"] }),
    onError: (error: any) => toast.error(error?.message ?? "Task update failed"),
  });

  const openTasks = useMemo(() => (tasks.data ?? []).filter((task) => !task.completed_at), [tasks.data]);
  const top3 = openTasks.slice(0, 3);
  const done = useMemo(() => (tasks.data ?? []).filter((task) => task.completed_at && isToday(new Date(task.completed_at))), [tasks.data]);
  const nextMeeting = (calls.data ?? []).find((call) => new Date(call.end_at ?? call.start_at) > new Date()) ?? null;
  const nowTask = top3[0] ?? null;

  return (
    <div className="page-enter px-4 sm:px-6 pb-24 space-y-5 max-w-4xl mx-auto">
      <PageHeader eyebrow={format(new Date(), "EEEE · MMM d")} title="APEX Today" subtitle="One screen. Every item leads to an action." />

      <Section title="NOW" icon={<PlayCircle className="h-4 w-4 text-emerald-500" />}>
        {nowTask ? <TaskCard task={nowTask} onToggle={() => toggleTask.mutate(nowTask)} /> : <Empty text="No open task. Use the next meeting or content action below." />}
      </Section>

      <Section title="TOP 3" icon={<Flame className="h-4 w-4 text-rose-500" />} badge={`${top3.length}/3`}>
        {tasks.isLoading ? <Skeleton className="h-20" /> : top3.length ? top3.map((task) => <TaskCard key={task.id} task={task} onToggle={() => toggleTask.mutate(task)} />) : <Empty text="Top 3 cleared." />}
      </Section>

      <Section title="NEXT MEETING" icon={<CalendarCheck className="h-4 w-4 text-amber-500" />}>
        {nextMeeting ? <MeetingCard call={nextMeeting} /> : <Empty text="No remaining meeting today." />}
      </Section>

      <Section title="REVENUE" icon={<DollarSign className="h-4 w-4 text-emerald-500" />}>
        <ActionCard href="/dashboard/leaderboard" title={`${money(revenue.data?.aop)} ALP`} detail={`${revenue.data?.deals ?? 0} deals today`} />
      </Section>

      <Section title="CONTENT" icon={<PlayCircle className="h-4 w-4 text-violet-500" />}>
        {content.data ? <ActionCard href="/dashboard/admin/content-command" title={content.data.title || content.data.hook || "Publish next approved piece"} detail={`${content.data.platform ?? "platform"} · ${content.data.status}`} /> : <Empty text="No ready content. Open Content Command to stage one piece." href="/dashboard/admin/content-command" />}
      </Section>

      <Section title="BLOCKED" icon={<AlertTriangle className="h-4 w-4 text-rose-500" />} badge={String(blockers.data?.length ?? 0)}>
        {(blockers.data ?? []).length ? blockers.data!.map((blocker) => <ActionCard key={blocker.id} href="/dashboard/admin/content-command" title={blocker.title || blocker.description || "Open blocker"} detail={`${blocker.severity ?? "open"}${Number(blocker.dollar_impact ?? 0) ? ` · ${money(blocker.dollar_impact)} impact` : ""}`} />) : <Empty text="No open blockers." />}
      </Section>

      <Section title="FINANCES" icon={<WalletCards className="h-4 w-4 text-amber-500" />}>
        <ActionCard href="/dashboard/finances" title={`${money(finances.data?.ghost_ap_at_risk)} at risk`} detail={`${finances.data?.dup_charges_open ?? 0} duplicate-charge flags · ${finances.data?.ica_paid_stuck ?? 0} paid-and-stuck`} />
      </Section>

      <Section title="DONE" icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />} badge={String(done.length)}>
        {done.length ? done.map((task) => <TaskCard key={task.id} task={task} onToggle={() => toggleTask.mutate(task)} />) : <Empty text="Nothing completed yet." />}
      </Section>
    </div>
  );
}

function Section({ title, icon, badge, children }: { title: string; icon: React.ReactNode; badge?: string; children: React.ReactNode }) {
  return <section className="space-y-2"><div className="flex items-center gap-2">{icon}<h2 className="text-sm font-black tracking-[0.16em]">{title}</h2>{badge && <Badge variant="outline" className="text-[10px]">{badge}</Badge>}</div>{children}</section>;
}

function TaskCard({ task, onToggle }: { task: Task; onToggle: () => void }) {
  return <Card className={cn(task.completed_at ? "opacity-60" : task.is_income_producing && "border-emerald-500/40 bg-emerald-500/5")}><CardContent className="p-3 flex items-center gap-3"><button onClick={onToggle} aria-label={task.completed_at ? "Reopen task" : "Complete task"}>{task.completed_at ? <CheckCircle2 className="h-6 w-6 text-emerald-500" /> : <Circle className="h-6 w-6 text-muted-foreground" />}</button><div className="min-w-0 flex-1"><p className={cn("text-sm font-semibold", task.completed_at && "line-through")}>{task.title}</p>{task.notes && <p className="text-xs text-muted-foreground truncate">{task.notes}</p>}</div>{task.is_income_producing && <DollarSign className="h-4 w-4 text-emerald-500" />}</CardContent></Card>;
}

function MeetingCard({ call }: { call: Call }) {
  const label = call.prospect_name || call.summary || "Meeting";
  return <Card className="border-amber-500/30 bg-amber-500/5"><CardContent className="p-4 flex items-center gap-3"><div className="w-16 text-center"><p className="font-black tabular-nums">{format(new Date(call.start_at), "h:mm")}</p><p className="text-[10px] text-muted-foreground">{format(new Date(call.start_at), "a")}</p></div><div className="min-w-0 flex-1"><p className="text-sm font-semibold truncate">{label}</p><p className="text-xs text-muted-foreground">{call.call_type}</p></div>{call.location?.startsWith("http") && <Button asChild size="sm"><a href={call.location} target="_blank" rel="noopener noreferrer">Join</a></Button>}</CardContent></Card>;
}

function ActionCard({ href, title, detail }: { href: string; title: string; detail: string }) {
  return <Link to={href}><Card className="hover:border-emerald-500/40 transition-colors"><CardContent className="p-4 flex items-center gap-3"><div className="min-w-0 flex-1"><p className="text-sm font-semibold truncate">{title}</p><p className="text-xs text-muted-foreground">{detail}</p></div><ChevronRight className="h-4 w-4 text-muted-foreground" /></CardContent></Card></Link>;
}

function Empty({ text, href }: { text: string; href?: string }) {
  const body = <Card><CardContent className="p-4 flex items-center justify-between gap-3"><p className="text-sm text-muted-foreground">{text}</p>{href && <ChevronRight className="h-4 w-4" />}</CardContent></Card>;
  return href ? <Link to={href}>{body}</Link> : body;
}
