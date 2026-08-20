import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useRef } from "react";
import { ExternalLink, X } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type TodoRow = {
  source: string;
  source_id: string;
  text: string;
  status: string;
  created_at: string;
  due_at: string | null;
  priority: number;
  link: string | null;
};

function priorityColor(p: number): string {
  if (p === 0) return "bg-red-500";
  if (p === 1) return "bg-orange-500";
  if (p === 2) return "bg-yellow-500";
  return "bg-slate-400";
}

function sourceBadge(src: string): string {
  if (src === "manual") return "Manual";
  if (src === "codex_blocker" || /^mp\d+/i.test(src)) return "Blocker";
  return src.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function SamTodo() {
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["sam-todo"],
    queryFn: async () => {
      // RPCs added after last supabase-types regen. Cast bypasses stale union.
      const { data, error } = await (supabase as unknown as {
        rpc: (name: string) => Promise<{ data: TodoRow[] | null; error: { message: string } | null }>;
      }).rpc("sam_todo_list");
      if (error) throw new Error(error.message);
      return (data ?? []) as TodoRow[];
    },
    refetchInterval: 300_000,
  });

  const dismiss = useMutation({
    mutationFn: async (row: TodoRow) => {
      const { error } = await (supabase as unknown as {
        rpc: (name: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
      }).rpc("sam_todo_dismiss", {
        p_source: row.source,
        p_source_id: row.source_id,
      });
      if (error) throw new Error(error.message);
    },
    onMutate: async (row) => {
      await qc.cancelQueries({ queryKey: ["sam-todo"] });
      const prev = qc.getQueryData<TodoRow[]>(["sam-todo"]) ?? [];
      qc.setQueryData<TodoRow[]>(
        ["sam-todo"],
        prev.filter((r) => !(r.source === row.source && r.source_id === row.source_id)),
      );
      return { prev };
    },
    onError: (_err, _row, ctx) => {
      if (ctx?.prev) qc.setQueryData(["sam-todo"], ctx.prev);
      toast.error("Could not dismiss");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sam-todo"] });
    },
  });

  const snooze = useMutation({
    mutationFn: async (row: TodoRow) => {
      const { error } = await (supabase as unknown as {
        rpc: (name: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
      }).rpc("sam_todo_snooze", {
        p_source: row.source,
        p_source_id: row.source_id,
        p_hours: 4,
      });
      if (error) throw new Error(error.message);
    },
    onMutate: async (row) => {
      await qc.cancelQueries({ queryKey: ["sam-todo"] });
      const prev = qc.getQueryData<TodoRow[]>(["sam-todo"]) ?? [];
      qc.setQueryData<TodoRow[]>(
        ["sam-todo"],
        prev.filter((r) => !(r.source === row.source && r.source_id === row.source_id)),
      );
      return { prev };
    },
    onError: (_err, _row, ctx) => {
      if (ctx?.prev) qc.setQueryData(["sam-todo"], ctx.prev);
      toast.error("Could not snooze");
    },
    onSuccess: () => {
      toast.success("Snoozed 4h");
      qc.invalidateQueries({ queryKey: ["sam-todo"] });
    },
  });

  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);

  function handlePressStart(row: TodoRow) {
    longPressFired.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      snooze.mutate(row);
    }, 550);
  }
  function handlePressEnd() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 pb-24">
      <PageHeader
        title="Sam Todo"
        subtitle="Tap dismiss · long-press to snooze 4h"
      />

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            /* stable-key-allow:skeleton */
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">
          Failed to load. {String((error as Error).message)}
        </div>
      )}

      {!isLoading && !error && (data?.length ?? 0) === 0 && (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
          Clear. No open items.
        </div>
      )}

      <ul className="space-y-2">
        {(data ?? []).map((row) => (
          <li
            key={`${row.source}-${row.source_id}`}
            className="flex min-h-16 items-start gap-3 rounded-lg border border-border bg-card p-3 select-none"
            onPointerDown={() => handlePressStart(row)}
            onPointerUp={handlePressEnd}
            onPointerLeave={handlePressEnd}
            onPointerCancel={handlePressEnd}
          >
            <div
              className={`mt-1 h-3 w-3 shrink-0 rounded-full ${priorityColor(row.priority)}`}
              aria-label={`priority ${row.priority}`}
            />
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-center gap-2">
                <Badge variant="outline" className="text-xs">
                  {sourceBadge(row.source)}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(row.created_at), { addSuffix: true })}
                </span>
              </div>
              <p className="text-sm leading-snug break-words">{row.text}</p>
              {row.link && (
                <a
                  href={row.link}
                  className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  Open <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0"
              onClick={(e) => {
                e.stopPropagation();
                if (!longPressFired.current) dismiss.mutate(row);
              }}
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
