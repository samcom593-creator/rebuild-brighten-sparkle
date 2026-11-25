import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ListTodo, Loader2, Plus, RotateCcw } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useRolePreview } from "@/hooks/useRolePreview";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { createMyTask, myTasksKey, readMyTasks, resolveMyTaskOwner, setMyTaskCompleted, type MyTaskOwner, type PersonalTaskInput } from "@/lib/myTasks";

export default function MyTasks() {
  const { user, isLoading } = useAuth();
  const { isPreviewing } = useRolePreview();
  if (isLoading) return <p role="status" className="p-6 text-sm text-muted-foreground">Loading your account…</p>;
  if (!user || isPreviewing) return <p role="status" className="p-6 text-sm text-muted-foreground">{isPreviewing ? "Exit role preview to open your own tasks." : "Sign in to open your tasks."}</p>;
  return <MyTasksAccount key={user.id} userId={user.id} />;
}

function MyTasksAccount({ userId }: { userId: string }) {
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const owner = useQuery({ queryKey: ["my-task-owner", userId], queryFn: () => resolveMyTaskOwner(userId, () => active.current), retry: false, gcTime: 0, staleTime: 30_000 });
  return (
    <main className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6">
      <PageHeader title="My Tasks" subtitle="Your next move. One clear list." eyebrow="DAILY EXECUTION" eyebrowIcon={<ListTodo className="h-4 w-4" />} />
      {owner.isPending ? <p role="status" className="text-sm text-muted-foreground">Checking your task account…</p>
        : owner.isError ? <div role="alert" className="space-y-3 rounded-lg border border-destructive/40 bg-card p-4"><p>{owner.error.message}</p><Button variant="outline" onClick={() => void owner.refetch()}>Try again</Button></div>
          : owner.data ? <MyTasksList key={`${userId}:${owner.data.agentId}`} owner={owner.data} /> : null}
    </main>
  );
}

function MyTasksList({ owner }: { owner: MyTaskOwner }) {
  const qc = useQueryClient();
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState<PersonalTaskInput["priority"]>("normal");
  const [showCompleted, setShowCompleted] = useState(false);
  const queryKey = myTasksKey(owner.userId, owner.agentId);
  const tasks = useQuery({ queryKey, queryFn: () => readMyTasks(owner, () => active.current), gcTime: 0, retry: false });
  const create = useMutation({
    mutationFn: (input: PersonalTaskInput) => {
      if (!active.current) throw new Error("Reopen your task list.");
      return createMyTask(owner, input, () => active.current);
    },
    onSuccess: () => {
      if (!active.current) return;
      setTitle(""); setDescription(""); setDueDate(""); setPriority("normal");
      void qc.invalidateQueries({ queryKey });
    },
    onError: () => { if (active.current) void qc.invalidateQueries({ queryKey }); },
  });
  const complete = useMutation({
    mutationFn: ({ id, completed }: { id: string; completed: boolean }) => {
      if (!active.current) throw new Error("Reopen your task list.");
      return setMyTaskCompleted(owner, id, completed, () => active.current);
    },
    onSuccess: () => { if (active.current) void qc.invalidateQueries({ queryKey }); },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || create.isPending) return;
    create.mutate({ title, description: description || null, due_date: dueDate || null, priority });
  };
  const rows = tasks.data ?? [];
  const open = rows.filter(task => task.status !== "completed");
  const visible = showCompleted ? rows : open;
  return <>
    <Card><CardContent className="p-4 sm:p-5">
      <form onSubmit={submit} className="space-y-3" aria-label="Add a task">
        <label htmlFor="personal-task-title" className="block text-sm font-semibold">What needs to happen?</label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input id="personal-task-title" value={title} onChange={event => setTitle(event.target.value)} maxLength={200} placeholder="Add your next task" className="min-h-11 flex-1" disabled={create.isPending} />
          <Button type="submit" disabled={!title.trim() || create.isPending} className="min-h-11">{create.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}Add task</Button>
        </div>
        <details className="text-sm"><summary className="w-fit cursor-pointer py-1 text-muted-foreground">Date, priority, and notes</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="space-y-1"><span>Due date</span><Input aria-label="Due date" type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} disabled={create.isPending} /></label>
            <label className="space-y-1"><span>Priority</span><select aria-label="Priority" value={priority} onChange={event => setPriority(event.target.value as PersonalTaskInput["priority"])} disabled={create.isPending} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label>
            <label className="space-y-1 sm:col-span-2"><span>Notes</span><Textarea aria-label="Task notes" value={description} onChange={event => setDescription(event.target.value)} maxLength={2000} rows={2} disabled={create.isPending} /></label>
          </div>
        </details>
        {create.isError ? <p role="alert" className="text-sm text-destructive">{create.error.message}</p> : null}
      </form>
    </CardContent></Card>
    <section className="space-y-3" aria-label="Your tasks">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-bold italic">{tasks.isSuccess ? `${open.length} open in this list` : "Your list"}</h2><Button variant="ghost" size="sm" onClick={() => setShowCompleted(value => !value)}>{showCompleted ? "Hide completed" : "Show completed"}</Button></div>
      {tasks.isPending ? <p role="status" className="text-sm text-muted-foreground">Loading tasks…</p> : tasks.isError ? <div role="alert" className="space-y-2 rounded-lg border border-destructive/40 p-4"><p>{tasks.error.message}</p><Button variant="outline" onClick={() => void tasks.refetch()}>Try again</Button></div> : visible.length === 0 ? <Card><CardContent className="p-6 text-sm text-muted-foreground">{rows.length ? "Your open list is clear." : "Add your first task to get started."}</CardContent></Card> : <ul className="space-y-2">{visible.map(task => <li key={task.id} className="flex items-start gap-3 rounded-lg border border-border bg-card p-4">
        <Button variant="outline" size="icon" className="h-11 w-11 shrink-0" disabled={complete.isPending} aria-label={`${task.status === "completed" ? "Reopen" : "Complete"}: ${task.title}`} onClick={() => complete.mutate({ id: task.id, completed: task.status !== "completed" })}>{complete.isPending && complete.variables?.id === task.id ? <Loader2 className="h-4 w-4 animate-spin" /> : task.status === "completed" ? <RotateCcw className="h-4 w-4" /> : <Check className="h-4 w-4" />}</Button>
        <div className="min-w-0 flex-1"><p className={cn("break-words font-semibold", task.status === "completed" && "text-muted-foreground line-through")}>{task.title}</p>{task.description ? <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">{task.description}</p> : null}<div className="mt-2 flex flex-wrap gap-3 text-sm text-muted-foreground">{task.due_date ? <span>Due {task.due_date}</span> : null}{task.priority !== "normal" ? <span className={task.priority === "urgent" ? "font-semibold text-destructive" : "capitalize"}>{task.priority}</span> : null}{task.status === "completed" ? <span className="text-emerald-600 dark:text-emerald-300">Completed</span> : null}</div></div>
      </li>)}</ul>}
      {complete.isError ? <p role="alert" className="text-sm text-destructive">{complete.error.message}</p> : null}
      {rows.length === 200 ? <p className="text-sm text-muted-foreground">Showing your 200 most recent tasks.</p> : null}
    </section>
  </>;
}
