import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Minus, Flame, Trophy } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

/**
 * ManagerPostCounter — the manager social-post board.
 *
 * One tap = one post logged for today. Backed by
 * public.bump_manager_post(p_delta) which takes the caller's identity from
 * current_agent_id(), so a manager cannot inflate anyone else's number.
 *
 * Reads public.v_manager_social_leaderboard (today / week / month, all in
 * America/Chicago with a Monday week start to match src/lib/dateUtils.ts).
 */

interface LeaderRow {
  agent_id: string;
  manager_name: string;
  avatar_url: string | null;
  posts_today: number;
  posts_week: number;
  active_days_week: number;
  week_rank: number;
}

interface DataResult<T> {
  data: T | null;
  error: { message: string } | null;
}

interface ManagerPostQuery extends PromiseLike<DataResult<unknown[]>> {
  select(columns: string): ManagerPostQuery;
  order(column: string, options?: { ascending?: boolean }): ManagerPostQuery;
}

interface ManagerPostDataClient {
  from(table: string): ManagerPostQuery;
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<DataResult<unknown>>;
}

// The generated Supabase types lag this additive migration until the next
// schema regeneration. Keep the temporary escape hatch local and typed.
const managerPostData = supabase as unknown as ManagerPostDataClient;

const LEADERBOARD_KEY = ["manager-social-leaderboard"];

export function ManagerPostCounter({ className }: { className?: string }) {
  const { user, isManager, isAdmin } = useAuth();
  const queryClient = useQueryClient();

  const board = useQuery({
    queryKey: LEADERBOARD_KEY,
    enabled: !!user?.id && (isManager || isAdmin),
    staleTime: 30_000,
    queryFn: async (): Promise<LeaderRow[]> => {
      const { data, error } = await managerPostData
        .from("v_manager_social_leaderboard")
        .select("*")
        .order("posts_week", { ascending: false })
        .order("manager_name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as LeaderRow[];
    },
  });

  // The signed-in manager's own row, matched by agent — resolved from the
  // board itself so we never need a second round-trip for the agent id.
  const myAgentId = useQuery({
    queryKey: ["my-agent-id-for-posts", user?.id],
    enabled: !!user?.id && (isManager || isAdmin),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await managerPostData.rpc("current_agent_id");
      if (error) throw error;
      return (data as string | null) ?? null;
    },
  });

  const rows = useMemo(() => board.data ?? [], [board.data]);
  const me = useMemo(
    () => rows.find((r) => r.agent_id === myAgentId.data) ?? null,
    [rows, myAgentId.data],
  );

  const bump = useMutation({
    mutationFn: async (delta: 1 | -1): Promise<number> => {
      const { data, error } = await managerPostData.rpc("bump_manager_post", {
        p_delta: delta,
      });
      if (error) throw error;
      return Number(data ?? 0);
    },
    // Optimistic: the button must feel instant on mobile.
    onMutate: async (delta) => {
      await queryClient.cancelQueries({ queryKey: LEADERBOARD_KEY });
      const previous = queryClient.getQueryData<LeaderRow[]>(LEADERBOARD_KEY);
      const mineId = myAgentId.data;
      if (previous && mineId) {
        queryClient.setQueryData<LeaderRow[]>(
          LEADERBOARD_KEY,
          previous.map((r) =>
            r.agent_id === mineId
              ? {
                  ...r,
                  posts_today: Math.max(r.posts_today + delta, 0),
                  posts_week: Math.max(r.posts_week + delta, 0),
                }
              : r,
          ),
        );
      }
      return { previous };
    },
    onError: (err, _delta, context) => {
      if (context?.previous) {
        queryClient.setQueryData(LEADERBOARD_KEY, context.previous);
      }
      toast.error(err instanceof Error ? err.message : "Could not log that post");
    },
    onSuccess: (newCount, delta) => {
      if (delta === 1) {
        toast.success(`Post logged — ${newCount} today`);
      } else {
        toast.success(`Removed — ${newCount} today`);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: LEADERBOARD_KEY });
    },
  });

  const handleAdd = useCallback(() => bump.mutate(1), [bump]);
  const handleUndo = useCallback(() => bump.mutate(-1), [bump]);

  if (!isManager && !isAdmin) return null;

  const todayCount = me?.posts_today ?? 0;
  const weekCount = me?.posts_week ?? 0;
  const canUndo = todayCount > 0 && !bump.isPending;
  const topWeek = rows.length > 0 ? rows[0].posts_week : 0;

  return (
    <GlassCard className={cn("p-4", className)}>
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <Flame className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
          <h3 className="text-sm font-semibold truncate">Manager Post Board</h3>
        </div>
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground shrink-0">
          This week
        </span>
      </div>

      {/* ── My counter + the big button ────────────────────────── */}
      {me ? (
        <div className="mb-3">
          <div className="flex items-baseline gap-2 mb-1.5">
            <span className="text-3xl font-bold tabular-nums leading-none">{todayCount}</span>
            <span className="text-sm text-muted-foreground">
              post{todayCount === 1 ? "" : "s"} today
            </span>
            <span className="ml-auto text-xs text-muted-foreground tabular-nums">
              {weekCount} this week
            </span>
          </div>

          <div className="flex items-stretch gap-2">
            <button
              type="button"
              onClick={handleAdd}
              disabled={bump.isPending}
              aria-label="Log one social post for today"
              className={cn(
                "flex-1 h-11 rounded-md bg-primary text-primary-foreground",
                "flex items-center justify-center gap-2 text-base font-bold",
                "transition-transform duration-150 active:scale-[0.98] touch-manipulation",
                "disabled:opacity-60",
              )}
            >
              <Plus className="h-5 w-5" aria-hidden="true" />
              1 Post
            </button>
            <button
              type="button"
              onClick={handleUndo}
              disabled={!canUndo}
              aria-label="Remove one post from today"
              className={cn(
                "w-11 h-11 rounded-md border border-border text-muted-foreground",
                "flex items-center justify-center",
                "transition-transform duration-150 active:scale-[0.98] touch-manipulation",
                "disabled:opacity-40",
              )}
            >
              <Minus className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground mb-4">
          {myAgentId.isPending || board.isPending
            ? "Loading your counter…"
            : "No manager record linked to this login yet."}
        </p>
      )}

      {/* ── The board ──────────────────────────────────────────── */}
      {board.isError ? (
        <p className="text-xs text-destructive">Could not load the board.</p>
      ) : (
        <ul className="space-y-1">
          {rows.map((row) => {
            const isMe = row.agent_id === myAgentId.data;
            const pct = topWeek > 0 ? Math.round((row.posts_week / topWeek) * 100) : 0;
            return (
              <li
                key={row.agent_id}
                className={cn(
                  "relative flex items-center gap-3 rounded-md px-2 py-2 overflow-hidden",
                  isMe ? "bg-primary/10 border border-primary/30" : "border border-transparent",
                )}
              >
                {/* progress fill, purely relative to the week leader */}
                <div
                  className="absolute inset-y-0 left-0 bg-primary/5"
                  style={{ width: `${pct}%` }}
                  aria-hidden="true"
                />
                <span className="relative w-6 text-xs font-bold tabular-nums text-muted-foreground shrink-0">
                  {row.week_rank}
                </span>
                {row.week_rank === 1 && row.posts_week > 0 ? (
                  <Trophy className="relative h-3.5 w-3.5 text-primary shrink-0" aria-hidden="true" />
                ) : null}
                <span className={cn("relative flex-1 truncate text-sm", isMe && "font-semibold")}>
                  {row.manager_name}
                </span>
                {row.posts_today > 0 ? (
                  <span className="relative text-[10px] tabular-nums text-primary shrink-0">
                    +{row.posts_today} today
                  </span>
                ) : null}
                <span className="relative text-sm font-bold tabular-nums shrink-0 w-8 text-right">
                  {row.posts_week}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </GlassCard>
  );
}
