import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Check, Loader2 } from "lucide-react";

/**
 * TaskInbox — read open tasks from public.agent_inbox (RLS scopes to current user),
 * group by list, sort by priority then due date, one-click complete.
 *
 * Mirrors tasks/schema.ts. Supabase is the authoritative source for the UI;
 * the Mac CLI keeps tasks.json in sync via tasks/sync.ts.
 */

type TaskList = "APEX-Daily" | "Recruiting" | "Build" | "Follow-ups";
type TaskPriority = "low" | "medium" | "high" | "urgent";
type TaskStatus = "open" | "in_progress" | "blocked" | "done" | "cancelled";

interface AgentTaskRow {
  id: string;
  user_id: string;
  local_id: string | null;
  title: string;
  list: TaskList;
  due: string | null;
  priority: TaskPriority;
  tags: string[];
  status: TaskStatus;
  source: string;
  reminder_external_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

const LISTS: TaskList[] = ["APEX-Daily", "Recruiting", "Build", "Follow-ups"];
const PRIORITY_RANK: Record<TaskPriority, number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
};

const PRIORITY_VARIANT: Record<TaskPriority, "default" | "secondary" | "destructive" | "outline"> = {
  urgent: "destructive",
  high: "default",
  medium: "secondary",
  low: "outline",
};

function formatDue(due: string | null): string {
  if (!due) return "";
  const d = new Date(due);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  const diffDays = Math.round(
    (target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`;
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "tomorrow";
  if (diffDays < 7) return `${diffDays}d`;
  return d.toLocaleDateString();
}

export function TaskInbox() {
  const [rows, setRows] = useState<AgentTaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    // The Supabase types file doesn't know about agent_inbox until the migration is
    // applied + types are regenerated. Cast through `unknown` to avoid the spurious
    // generic-table type error in the meantime.
    const { data, error } = await (supabase as unknown as {
      from: (t: string) => {
        select: (q: string) => {
          in: (
            col: string,
            v: string[],
          ) => {
            order: (
              c: string,
              o: { ascending: boolean; nullsFirst?: boolean },
            ) => Promise<{ data: AgentTaskRow[] | null; error: { message: string } | null }>;
          };
        };
      };
    })
      .from("agent_inbox")
      .select("*")
      .in("status", ["open", "in_progress"])
      .order("due", { ascending: true, nullsFirst: false });
    if (error) {
      setError(error.message);
      setRows([]);
    } else {
      setRows(data || []);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
    // Subscribe to changes for live updates
    const channel = supabase
      .channel("agent_inbox_inbox")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "agent_inbox" },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
     
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<TaskList, AgentTaskRow[]>();
    for (const list of LISTS) map.set(list, []);
    for (const r of rows) {
      const arr = map.get(r.list) ?? [];
      arr.push(r);
      map.set(r.list, arr);
    }
    for (const list of LISTS) {
      const arr = map.get(list)!;
      arr.sort((a, b) => {
        const p = PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
        if (p !== 0) return p;
        const da = a.due ? new Date(a.due).getTime() : Infinity;
        const db = b.due ? new Date(b.due).getTime() : Infinity;
        return da - db;
      });
    }
    return map;
  }, [rows]);

  async function complete(id: string) {
    setCompleting((s) => {
      const next = new Set(s);
      next.add(id);
      return next;
    });
    const { error } = await (supabase as unknown as {
      from: (t: string) => {
        update: (
          v: Record<string, unknown>,
        ) => {
          eq: (col: string, v: string) => Promise<{ error: { message: string } | null }>;
        };
      };
    })
      .from("agent_inbox")
      .update({ status: "done", completed_at: new Date().toISOString() })
      .eq("id", id);
    setCompleting((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });
    if (error) {
      setError(error.message);
      return;
    }
    setRows((rs) => rs.filter((r) => r.id !== id));
  }

  if (loading) {
    return (
      <div className="space-y-4 p-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-destructive bg-destructive/10 p-4 text-sm">
        Failed to load tasks: {error}
      </div>
    );
  }

  const total = rows.length;

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold tracking-tight">Inbox</h2>
        <span className="text-sm text-muted-foreground">
          {total} open task{total === 1 ? "" : "s"}
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {LISTS.map((list) => {
          const items = grouped.get(list) ?? [];
          return (
            <Card key={list}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between text-base">
                  <span>{list}</span>
                  <Badge variant="secondary">{items.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {items.length === 0 && (
                  <p className="text-sm text-muted-foreground">Nothing open.</p>
                )}
                {items.map((t) => {
                  const dueLabel = formatDue(t.due);
                  const isOverdue = dueLabel.includes("overdue");
                  return (
                    <div
                      key={t.id}
                      className="flex items-start gap-2 rounded-md border bg-card p-2 transition-colors hover:bg-accent/50"
                    >
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        aria-label="Mark done"
                        disabled={completing.has(t.id)}
                        onClick={() => complete(t.id)}
                      >
                        {completing.has(t.id) ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Check className="h-4 w-4" />
                        )}
                      </Button>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">
                            {t.title}
                          </span>
                          <Badge variant={PRIORITY_VARIANT[t.priority]} className="text-[10px]">
                            {t.priority}
                          </Badge>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                          {dueLabel && (
                            <span className={isOverdue ? "text-destructive" : ""}>
                              {dueLabel}
                            </span>
                          )}
                          {t.tags.length > 0 && (
                            <span className="flex gap-1">
                              {t.tags.map((tag) => (
                                <span key={tag} className="rounded bg-muted px-1">
                                  #{tag}
                                </span>
                              ))}
                            </span>
                          )}
                          <span className="opacity-60">via {t.source}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

export default TaskInbox;
