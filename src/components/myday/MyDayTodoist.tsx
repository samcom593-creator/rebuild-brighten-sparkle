import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

/**
 * Todoist link: the real to-do list on My Day, and a push of the schedule into Todoist (and from there into
 * Google Calendar). Everything goes through the myday-todoist function, so the Todoist token never reaches
 * the browser. Pushing only ever touches tasks it created itself.
 */
type TodoistTask = { id: string; content: string; priority: number | null; due: string | null; recurring: boolean };
export type PushResult = { ok: boolean; created?: number; updated?: number; deleted?: number; unchanged?: number; errors?: string[]; error?: string };

export async function pushMyDayToTodoist(): Promise<PushResult> {
  const { data, error } = await supabase.functions.invoke("myday-todoist", { body: { action: "push" } });
  if (error) return { ok: false, error: error.message };
  return data as PushResult;
}

const KEY = ["myday_todoist_today"] as const;

export function MyDayTodoist() {
  const qc = useQueryClient();
  const { data, isError, isLoading, refetch } = useQuery({
    queryKey: KEY,
    staleTime: 60_000,
    queryFn: async (): Promise<TodoistTask[]> => {
      const { data: res, error } = await supabase.functions.invoke("myday-todoist", { body: { action: "today" } });
      if (error || !(res as { ok?: boolean })?.ok) throw new Error(error?.message ?? "Todoist unavailable");
      return (res as { tasks: TodoistTask[] }).tasks;
    },
  });

  const complete = useMutation({
    mutationFn: async (id: string) => {
      const { data: res, error } = await supabase.functions.invoke("myday-todoist", { body: { action: "complete", task_id: id } });
      if (error || !(res as { ok?: boolean })?.ok) throw new Error(error?.message ?? "Not completed");
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: KEY }); },
    onError: (e: Error) => toast.error(`Could not complete: ${e.message}`),
  });

  const sync = useMutation({
    mutationFn: pushMyDayToTodoist,
    onSuccess: (r) => {
      if (r.ok) toast.success(`Synced to Todoist: ${r.created ?? 0} new, ${r.updated ?? 0} changed, ${r.deleted ?? 0} removed`);
      else toast.error(`Todoist sync problem: ${r.errors?.[0] ?? r.error ?? "unknown"}`);
    },
    onError: (e: Error) => toast.error(`Todoist sync failed: ${e.message}`),
  });

  return (
    <section aria-label="To-do list" className="mb-4 rounded-2xl border border-border bg-card p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Your to-do list today</h2>
        <button
          type="button"
          onClick={() => sync.mutate()}
          disabled={sync.isPending}
          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-border px-3 text-sm font-medium hover:bg-muted disabled:opacity-60"
        >
          {sync.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Sync schedule to Todoist
        </button>
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading Todoist…</p>
      ) : isError ? (
        <p className="text-sm text-amber-500">
          Could not reach Todoist. This is not an empty list.{" "}
          <button type="button" className="underline" onClick={() => void refetch()}>Try again</button>
        </p>
      ) : !data || data.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing due or overdue in Todoist.</p>
      ) : (
        <ul className="space-y-1.5">
          {data.map((t) => (
            <li key={t.id} className="flex items-start gap-2.5">
              <button
                type="button"
                onClick={() => complete.mutate(t.id)}
                disabled={complete.isPending && complete.variables === t.id}
                aria-label={`Complete: ${t.content}`}
                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-muted-foreground/50 hover:border-primary"
              >
                {complete.isPending && complete.variables === t.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3.5 w-3.5 opacity-0 hover:opacity-100" />}
              </button>
              <span className="text-sm leading-snug text-foreground">{t.content}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
