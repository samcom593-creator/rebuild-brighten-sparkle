import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Check, Target } from "lucide-react";
import { toast } from "sonner";
import { useProducerWorkspace } from "@/hooks/useProducerWorkspace";
import { StreakFlameCard } from "@/components/agent/StreakFlameCard";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { looseSupabase } from "@/lib/looseSupabase";
import { producerMilestones, producerPace, type ProducerWorkspace } from "@/lib/producerWorkspace";

const dollars = (n: number | null) => n === null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function SellingSchedule({ data }: { data: ProducerWorkspace }) {
  const qc = useQueryClient();
  const savedDays = (data.next_schedule?.selling_days ?? data.schedule).join(",");
  const [days, setDays] = useState(data.next_schedule?.selling_days ?? data.schedule);
  useEffect(() => { setDays(savedDays.split(",").map(Number)); }, [savedDays]);
  const changed = days.join(",") !== savedDays;
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await looseSupabase.rpc("producer_set_work_schedule", { p_agent_id: data.agent_id, p_selling_days: days });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Selling schedule saved. It takes effect tomorrow.");
      void qc.invalidateQueries({ queryKey: ["producer-workspace", data.agent_id] });
    },
    onError: (e: Error) => toast.error(e.message || "Schedule could not be saved."),
  });
  return (
    <details className="rounded-lg border border-border px-3 py-2">
      <summary className="cursor-pointer text-sm font-medium">Selling schedule · {data.schedule.map((d) => DAY_NAMES[d]).join(", ")}</summary>
      <div className="space-y-3 pt-3">
        <p className="text-sm text-muted-foreground">Choose your regular selling days. Changes start tomorrow; past days keep their original schedule.</p>
        {data.next_schedule && <p className="text-sm">Next schedule starts {data.next_schedule.effective_on}.</p>}
        <div className="flex flex-wrap gap-2" role="group" aria-label="Selling days">
          {DAY_NAMES.map((label, day) => <Button key={label} type="button" variant={days.includes(day) ? "default" : "outline"} aria-pressed={days.includes(day)} disabled={save.isPending} onClick={() => setDays((prev) => prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort())}>{label}</Button>)}
        </div>
        {days.length === 0 && <p role="status" className="text-sm text-muted-foreground">Choose at least one selling day.</p>}
        <Button variant="outline" disabled={!changed || days.length === 0 || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save schedule"}</Button>
      </div>
    </details>
  );
}

export function ProducerWorkspaceCard({ agentId }: { agentId?: string | null }) {
  const q = useProducerWorkspace(agentId);
  if (!agentId) return null;
  if (q.isLoading) return <Skeleton className="h-72 w-full rounded-xl" aria-label="Loading personal production plan" />;
  if (!q.data) return (
    <section className="rounded-xl border border-border bg-card p-5" aria-label="Personal production plan">
      <h2 className="font-semibold">Your personal production plan</h2>
      <p className="mt-2 text-sm text-muted-foreground">Your plan could not be verified. Production and streaks are hidden until the source is available.</p>
      <Button className="mt-3" variant="outline" onClick={() => void q.refetch()}>Try again</Button>
    </section>
  );
  const d = q.data;
  const pace = producerPace(d);
  const currentSchedule = d.days.find((day) => day.day === d.today)?.scheduled === true;
  return (
    <section className="space-y-4 rounded-xl border border-primary/25 bg-card p-4 sm:p-5" aria-label="Personal production plan">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold"><Target className="h-5 w-5 text-primary" aria-hidden="true" /> Your {dollars(d.target_ap)} month</h2>
          <p className="text-sm text-muted-foreground">Personal production · {d.period_start} to {d.period_end} · Phoenix dates</p>
        </div>
        <span className="rounded-full border border-border px-3 py-1 text-sm font-semibold">{pace.status}</span>
      </header>
      {q.isError && <p role="status" className="text-sm text-destructive">The latest refresh failed. Showing the last verified read.</p>}
      <div>
        <p className="text-3xl font-bold tabular-nums">{dollars(d.production_ap)} <span className="text-base font-normal text-muted-foreground">of {dollars(d.target_ap)} posted ALP</span></p>
        <Progress value={pace.completionPct} className="mt-3 h-3" aria-label="Personal production goal progress" />
        <p className="mt-2 text-sm text-muted-foreground">{dollars(pace.remaining)} remaining · {d.selling_days_remaining} selling days left · {dollars(pace.apPerSellingDay)} per selling day</p>
        <p className="mt-1 text-xs text-muted-foreground">{pace.targetToday !== null ? `Pace target by the end of today: ${dollars(pace.targetToday)}. ` : ""}Posted production includes submissions; carrier status and payment evidence are separate below.</p>
        <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Production milestones">
          {producerMilestones(d.production_ap, d.target_ap).map((m) => <li key={m.amount} className={`flex items-center gap-2 rounded-lg border p-2 text-sm ${m.achieved ? "border-primary/40 bg-primary/10 font-semibold" : "border-border text-muted-foreground"}`}>
            {m.achieved && <Check className="h-4 w-4" aria-hidden="true" />}{dollars(m.amount)}<span className="sr-only">{m.achieved ? " achieved" : " remaining"}</span>
          </li>)}
        </ul>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Personal policies posted</p><p className="text-xl font-semibold">{d.production_deals}</p><p className="text-xs text-muted-foreground">Team sales excluded.</p></div>
        <div className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Carrier in force · written this month</p><p className="text-xl font-semibold">{dollars(d.carrier.in_force_month_ap)}</p><p className="text-xs text-muted-foreground">Covered carriers only. Payment confirmation: {dollars(d.carrier.paid_ap)}.</p></div>
        <div className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Active after 90 days</p><p className="text-xl font-semibold">{d.carrier.active_90d_policies ?? "—"}</p><p className="text-xs text-muted-foreground">Carrier observed active at 90+ days. Separate from this month’s goal; not a retention rate.</p></div>
      </div>
      <div className="rounded-xl border border-border p-4">
        <h3 className="flex items-center gap-2 font-semibold"><CalendarDays className="h-4 w-4" aria-hidden="true" /> {currentSchedule ? "Today’s closing plan" : "Next selling day"}</h3>
        <p className="mt-2 text-sm">{pace.remaining === 0 ? "Your monthly production goal is complete. Keep existing clients moving and protect the book." : pace.dealsRemaining === null ? "A policy estimate needs at least three recorded policies in your sample." : `${pace.dealsRemaining} more policies at your ${dollars(pace.averagePolicy)} average to reach the goal.`}</p>
        {pace.remaining === 0 ? null : d.selling_days_remaining === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">There are no scheduled selling days left this month. Your remaining goal is {dollars(pace.remaining)}.</p>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">Required calls are unavailable because provider sale dispositions are not linked to posted policies. {d.activity.completed_today} completed provider calls are recorded today.</p>
        )}
        <p className="mt-2 text-xs text-muted-foreground">Last {d.activity.sample_days} completed days: {d.activity.sample_calls} ReadyMode calls, {d.activity.sample_sold_calls} sale dispositions. Recorded sale-disposition rate: {pace.saleDispositionRate === null ? "unavailable" : `${pace.saleDispositionRate}%`}. This measures recorded call outcomes, not policy conversion or placement.</p>
        <p className="mt-1 text-xs text-muted-foreground">The policy-size estimate uses {d.activity.sample_policies} posted policies from that period. Dial taps, manual notes and sale dispositions do not add production.</p>
        <Button asChild className="mt-3"><Link to="/dashboard/agent-pipeline">Work my clients</Link></Button>
      </div>
      <StreakFlameCard agentId={agentId} workspace={d} />
      <SellingSchedule key={d.agent_id} data={d} />
      <p className="text-xs text-muted-foreground">Carrier evidence covers {d.carrier.covered_policies} policies. {d.carrier.oldest_seen_on ? `Oldest carrier observation: ${d.carrier.oldest_seen_on}.` : "No carrier evidence is available for this producer."} ALP is annualized premium, not take-home pay.</p>
    </section>
  );
}
