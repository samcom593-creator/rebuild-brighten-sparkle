// WeeklyDigestCard: the week in calls, inside the app (MP-310, 2026-10-29).
//
// The weekly coaching digest lives in Call Training instead of being sent out, so nobody's inbox gets a message they
// did not ask for. call_training_digest() compares the last 7 days with the 7 before on the current rubric only, so the
// numbers are like for like: graded calls, average score, on script, great calls, compliance flags, the agents who
// moved most, the steps skipped most and the best clean calls. Security invoker: an upline sees their own team.
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, TrendingDown, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { dispositionLabel } from "@/lib/readymodeDispositions";
import { cn } from "@/lib/utils";

interface Week { graded: number; avg_score: number | null; great: number; flagged: number; avg_script: number | null; sold: number }
interface Mover { agent_name: string; n_this: number; n_prev: number; avg_this: number; avg_prev: number; delta: number }
interface Digest {
  this_week: Week | null;
  prev_week: Week | null;
  movers: Mover[] | null;
  most_skipped: Array<{ step: string; calls: number; skipped_pct: number }> | null;
  best_calls: Array<{ call_id: string; agent_name: string | null; overall_score: number; disposition: string | null }> | null;
  urgent: number | null;
}

async function fetchDigest(): Promise<Digest | null> {
  const { data, error } = await supabase.rpc("call_training_digest" as never);
  if (error) throw new Error(error.message);
  return (data ?? null) as Digest | null;
}

function Delta({ now, before, goodWhen = "up" }: { now: number | null | undefined; before: number | null | undefined; goodWhen?: "up" | "down" }) {
  if (now == null || before == null) return null;
  const d = Math.round((Number(now) - Number(before)) * 10) / 10;
  if (d === 0) return <span className="block text-xs text-muted-foreground">same as the week before</span>;
  const good = goodWhen === "up" ? d > 0 : d < 0;
  return (
    <span className={cn("block text-xs", good ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300")}>
      {d > 0 ? "+" : ""}{d} vs the week before
    </span>
  );
}
function Fig({ label, value, extra, tone }: { label: string; value: number | string; extra?: ReactNode; tone?: string }) {
  return (
    <div>
      <p className={cn("text-xl font-bold tabular-nums", tone)}>{value}</p>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {extra}
    </div>
  );
}

export function WeeklyDigestCard({ onPickAgent }: { onPickAgent: (name: string) => void }) {
  const q = useQuery({ queryKey: ["call-training-digest"], queryFn: fetchDigest, staleTime: 10 * 60_000 });
  const w = q.data?.this_week ?? null;
  const p = q.data?.prev_week ?? null;
  const movers = q.data?.movers ?? [];
  const skipped = q.data?.most_skipped ?? [];
  const best = q.data?.best_calls ?? [];
  const urgent = q.data?.urgent ?? 0;
  return (
    <GlassCard className="space-y-3 p-4">
      <div>
        <p className="inline-flex items-center gap-2 text-sm font-semibold"><CalendarDays className="h-4 w-4 text-primary" /> This week in calls</p>
        <p className="text-xs text-muted-foreground">The last 7 days against the 7 before, graded on the current rubric.</p>
      </div>
      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : q.isError ? (
        <p className="text-sm text-rose-700 dark:text-rose-300">The digest did not load: {(q.error as Error).message}</p>
      ) : !w ? (
        <p className="text-sm text-muted-foreground">
          No call from the last 7 days is graded on the current rubric yet{p ? ` (the 7 days before have ${p.graded})` : ""}. The grader now takes the newest calls first, so this fills in as the hourly runs reach them.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Fig label="Graded calls" value={w.graded} extra={<Delta now={w.graded} before={p?.graded} />} />
            <Fig label="Average score" value={w.avg_score ?? "—"} extra={<Delta now={w.avg_score} before={p?.avg_score} />} />
            <Fig label="On script" value={w.avg_script == null ? "—" : `${w.avg_script}/10`} extra={<Delta now={w.avg_script} before={p?.avg_script} />} />
            <Fig label="Great calls" value={w.great} tone="text-amber-700 dark:text-amber-300" />
            <Fig label="Compliance flags" value={w.flagged} tone={w.flagged ? "text-rose-700 dark:text-rose-300" : undefined} extra={<Delta now={w.flagged} before={p?.flagged} goodWhen="down" />} />
          </div>
          {movers.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Who moved</p>
              <ul className="space-y-1 text-sm">
                {movers.map((m) => (
                  <li key={m.agent_name} className="flex flex-wrap items-center gap-2">
                    {m.delta >= 0 ? <TrendingUp className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> : <TrendingDown className="h-4 w-4 text-rose-600 dark:text-rose-400" />}
                    <button type="button" className="font-medium text-primary hover:underline" onClick={() => onPickAgent(m.agent_name)}>{m.agent_name}</button>
                    <span className="text-muted-foreground">average {m.avg_prev} to {m.avg_this}, {m.n_this} calls this week</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {skipped.length > 0 && (
            <p className="text-sm">
              <span className="font-semibold">Skipped most:</span>{" "}
              {skipped.map((s) => `${s.step} (${s.skipped_pct}% of ${s.calls})`).join(" · ")}
            </p>
          )}
          {best.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold">Play these for the team:</span>
              {best.map((b) => (
                <button key={b.call_id} type="button" className="text-primary hover:underline" onClick={() => b.agent_name && onPickAgent(b.agent_name)}>
                  {b.agent_name ?? "Unknown"} {b.overall_score} · {dispositionLabel(b.disposition)}
                </button>
              ))}
            </div>
          )}
          {urgent > 0 && <p className="text-sm text-rose-700 dark:text-rose-300">{urgent} call{urgent === 1 ? "" : "s"} this week need urgent coaching. They sit at the top of the review list.</p>}
        </>
      )}
    </GlassCard>
  );
}
