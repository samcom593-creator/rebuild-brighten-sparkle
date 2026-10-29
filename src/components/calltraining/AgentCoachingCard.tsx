// AgentCoachingCard: what the grader keeps noticing across one agent's calls (MP-310, 2026-10-28).
//
// Sam: "whenever you tap an agent and filter by an agent, at the top, give a summarization of what it notices: how to
// improve the calls, habits of that agent, things to watch out for, coaching tips." Written by
// readymode-bot/scripts/coach-agents.py from the agent's graded calls and refreshed as new calls are graded. Sam and
// Aisha read every agent; an upline reads only their own team (RLS on readymode_agent_coaching).
import { useQuery } from "@tanstack/react-query";
import { Sparkles, X } from "lucide-react";
import { looseSupabase } from "@/lib/looseSupabase";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";

interface Coaching {
  agent_name: string;
  summary: string | null;
  habits: string[] | null;
  watch_outs: string[] | null;
  coaching_tips: string[] | null;
  strengths: string[] | null;
  next_call_focus: string | null;
  source_count: number | null;
  generated_at: string | null;
}

async function fetchCoaching(agentName: string): Promise<Coaching | null> {
  const { data, error } = await (looseSupabase
    .from("readymode_agent_coaching")
    .select("agent_name, summary, habits, watch_outs, coaching_tips, strengths, next_call_focus, source_count, generated_at")
    .eq("agent_name", agentName)
    .limit(1) as unknown as Promise<{ data: Coaching[] | null; error: Error | null }>);
  if (error) throw error;
  return data?.[0] ?? null;
}

function Points({ title, items, tone }: { title: string; items: string[] | null; tone?: string }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <ul className={`list-disc space-y-0.5 pl-5 text-sm ${tone ?? ""}`}>{items.map((s) => <li key={s}>{s}</li>)}</ul>
    </div>
  );
}

export function AgentCoachingCard({ agentName, onClear }: { agentName: string; onClear: () => void }) {
  const q = useQuery({ queryKey: ["agent-coaching", agentName], queryFn: () => fetchCoaching(agentName), staleTime: 5 * 60_000 });
  const c = q.data;
  return (
    <GlassCard className="space-y-3 border-primary/30 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="inline-flex items-center gap-2 text-sm font-semibold"><Sparkles className="h-4 w-4 text-primary" /> Coaching for {agentName}</p>
          {c && (
            <p className="text-xs text-muted-foreground">
              From {c.source_count ?? 0} graded calls{c.generated_at ? ` · written ${new Date(c.generated_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}
            </p>
          )}
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={onClear}><X className="mr-1 h-3.5 w-3.5" /> Every agent</Button>
      </div>
      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading the coaching summary…</p>
      ) : q.isError ? (
        <p className="text-sm text-rose-700 dark:text-rose-300">The coaching summary did not load: {(q.error as Error).message}</p>
      ) : !c ? (
        <p className="text-sm text-muted-foreground">No coaching summary for this agent yet. One is written once an agent has 3 graded calls, and it refreshes as new calls are graded.</p>
      ) : (
        <>
          {c.summary && <p className="text-sm">{c.summary}</p>}
          {c.next_call_focus && (
            <p className="rounded-md border border-primary/30 bg-primary/5 p-2 text-sm"><span className="font-semibold">Next call:</span> {c.next_call_focus}</p>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            <Points title="Habits" items={c.habits} />
            <Points title="Watch out for" items={c.watch_outs} tone="text-rose-700 dark:text-rose-300" />
            <Points title="Coaching tips" items={c.coaching_tips} />
            <Points title="Keep doing" items={c.strengths} tone="text-emerald-700 dark:text-emerald-300" />
          </div>
        </>
      )}
    </GlassCard>
  );
}
