// ScriptStepImpactCard: which steps of the agency scripts get skipped, and what skipping costs (MP-310, 2026-10-29).
//
// Reads v_script_step_impact (security_invoker over the rubric v2 grades): Sam and Aisha see the agency, an upline sees
// their own team. Close rates are among graded calls, which all reached someone, so they run higher than the dialer's
// overall close rate; the comparison between a step done and a step skipped is the point.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ListChecks } from "lucide-react";
import { looseSupabase } from "@/lib/looseSupabase";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { stepGap, stepSentence, stepVerdict, type StepImpact, type StepVerdict } from "@/lib/scriptStepImpact";

const VERDICT: Record<StepVerdict, { label: string; tone: string }> = {
  costs_sales: { label: "Costs sales when skipped", tone: "border-rose-500/40 text-rose-700 dark:text-rose-300" },
  often_skipped: { label: "Often skipped", tone: "border-amber-500/40 text-amber-700 dark:text-amber-300" },
  solid: { label: "Mostly done", tone: "border-emerald-500/40 text-emerald-700 dark:text-emerald-300" },
  too_few: { label: "Too few calls yet", tone: "text-muted-foreground" },
};

async function fetchImpact(): Promise<StepImpact[]> {
  const { data, error } = await looseSupabase
    .from<StepImpact>("v_script_step_impact")
    .select("script_followed, step, step_order, calls, done, partly, skipped, skipped_pct, close_pct_when_done, close_pct_when_missed")
    .order("script_followed", { ascending: true })
    .order("step_order", { ascending: true })
    .limit(300);
  if (error) throw error;
  return data ?? [];
}

export function ScriptStepImpactCard() {
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ["script-step-impact"], queryFn: fetchImpact, staleTime: 5 * 60_000, enabled: open });
  const groups = useMemo(() => {
    const m = new Map<string, StepImpact[]>();
    for (const r of q.data ?? []) m.set(r.script_followed, [...(m.get(r.script_followed) ?? []), r]);
    const size = (list: StepImpact[]) => list.reduce((n, r) => Math.max(n, r.calls), 0);
    return Array.from(m.entries()).sort((a, b) => size(b[1]) - size(a[1]));
  }, [q.data]);
  const worst = useMemo(
    () => (q.data ?? []).filter((r) => stepVerdict(r) === "costs_sales").sort((a, b) => (stepGap(b) ?? 0) - (stepGap(a) ?? 0))[0],
    [q.data],
  );
  return (
    <GlassCard className="p-0">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold">
        <span className="inline-flex items-center gap-2"><ListChecks className="h-4 w-4 text-primary" /> Script steps that win and lose sales</span>
        <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-4 border-t border-border/60 px-4 py-3 text-sm">
          <p className="text-xs text-muted-foreground">Every graded call is checked against the agency script it followed. Close rates are among graded calls, so compare a step done against the same step skipped.</p>
          {q.isLoading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : q.isError ? (
            <p className="text-rose-700 dark:text-rose-300">This did not load: {(q.error as Error).message}</p>
          ) : groups.length === 0 ? (
            <p className="text-muted-foreground">No call is graded on the current rubric yet.</p>
          ) : (
            <>
              {worst && (
                <p className="rounded-md border border-rose-500/30 bg-rose-500/5 p-2">
                  <span className="font-semibold">Biggest leak:</span> {worst.step} ({worst.script_followed}). {stepSentence(worst)}
                </p>
              )}
              {groups.map(([script, steps]) => (
                <div key={script}>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{script}</p>
                  <ul className="divide-y divide-border/40">
                    {steps.map((r) => {
                      const v = VERDICT[stepVerdict(r)];
                      return (
                        <li key={`${script}|${r.step}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
                          <span className="font-medium">{r.step}</span>
                          <Badge variant="outline" className={cn("font-normal", v.tone)}>{v.label}</Badge>
                          <span className="w-full text-muted-foreground">{stepSentence(r)}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </GlassCard>
  );
}
