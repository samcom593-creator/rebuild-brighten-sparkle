import { Flame } from "lucide-react";
import { useProducerWorkspace } from "@/hooks/useProducerWorkspace";
import { productionStreak, type ProducerWorkspace } from "@/lib/producerWorkspace";

/** Canonical posted production on effective-dated selling days, never button taps. */
export function StreakFlameCard({ agentId, workspace }: { agentId?: string | null; workspace?: ProducerWorkspace }) {
  const query = useProducerWorkspace(agentId, !workspace);
  const data = workspace ?? query.data;
  if (!data) return <p className="text-sm text-muted-foreground">{query.isError ? "Production streak unavailable." : "Loading production streak…"}</p>;
  const streak = productionStreak(data.days, data.today);
  return (
    <section aria-label="Production streak" className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
      <Flame className="h-7 w-7 shrink-0 text-primary" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{streak.current} selling-day production streak</p>
        <p className="text-sm text-muted-foreground">
          {streak.todayEarned ? "Today is earned." : streak.todayScheduled ? "Today is still open." : "Rest day. Your streak is held."}
          {" "}Best in the last 180 days: {streak.best}.
        </p>
      </div>
      <p className="max-w-xs text-xs text-muted-foreground">One canonical posted policy on each scheduled selling day. Team sales and call dispositions do not count.</p>
    </section>
  );
}
