// Onboarding — the full exception queue ("Work full queue" from No Hire Left Behind).
//
// WHY IT CHANGED (APEX OS redesign §6, 2026-10-06):
//   This page used to render v_onboarding_sequence as eight rungs climbed in a
//   fixed order. Measured 2026-10-05: the order put "Join Slack" second (1 of 83
//   hires verified on Slack), so 74 of 84 rows were parked on Slack and no row
//   could ever be parked on contracting, licensing or training; rung 2 passed
//   every unlicensed agent automatically; and the labels said "Carrier
//   contracting" / "Carrier appointment" for an intake and a calendar booking.
//   A ladder that cannot name the real block is a scorecard, not a queue.
//
//   It now shows every open requirement per hire on parallel tracks
//   (contracting never waits on training, Slack or the onboarding call), each
//   with why it matters, the owner, time waiting from a real record, the last
//   real outreach, the next action and the button that resolves it. Facts:
//   public.onboarding_exception_facts(); rules: src/lib/onboardingExceptions.ts.
//
//   The "Active, never made a first sale" rail is folded into the queue (the
//   carrier and first-deal requirements); the "Licensed, then went inactive"
//   rail stays below because paused agents are deliberately outside the live
//   onboarding population and have no other surface.

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ListChecks, RotateCw, UserMinus } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { Button } from "@/components/ui/button";
import { AgentNameLink } from "@/components/dashboard/AgentNameLink";
import { OnboardingExceptionQueue } from "@/components/onboarding/OnboardingExceptionQueue";
import { useOnboardingExceptionFacts } from "@/components/onboarding/useOnboardingExceptionFacts";
import { AGENT_NAME_FALLBACK } from "@/shared/api/agentDisplayNames";
import { resolveBrand } from "@/config/brand";
import { cn } from "@/lib/utils";

interface PausedRow {
  agent_id: string;
  agent: string | null;
  owner: string | null;
  days_stuck: number | string | null;
}

export default function OnboardingLadder() {
  usePageTitle(`Onboarding queue · ${resolveBrand().shortName}`);
  const facts = useOnboardingExceptionFacts();

  const paused = useQuery<PausedRow[]>({
    queryKey: ["ladder-paused-licensed"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_queue_licensed_inactive" as never)
        .select("agent_id,agent,owner,days_stuck")
        .order("days_stuck", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as PausedRow[];
    },
    staleTime: 60_000,
  });

  if (facts.isLoading) return <PageSkeleton />;

  return (
    <div className="page-enter mx-auto w-full max-w-7xl space-y-5 px-4 pb-24 sm:px-6">
      <PageHeader
        eyebrow="Onboarding"
        eyebrowIcon={<ListChecks className="h-3 w-3" />}
        title="Onboarding queue"
        subtitle="Every live hire with an open requirement. Tracks run in parallel: contracting never waits on training, Slack or the onboarding call."
      />

      {facts.isError ? (
        <div className="flex flex-col gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div className="min-w-0">
              <p className="text-sm font-semibold">The onboarding queue could not load</p>
              <p className="mt-0.5 break-words text-xs text-muted-foreground">
                {(facts.error as Error | null)?.message ?? "No response."} This is an outage, not zero stalled hires.
              </p>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={() => void facts.refetch()}>
            <RotateCw className="mr-1.5 h-4 w-4" /> Try again
          </Button>
        </div>
      ) : (
        <OnboardingExceptionQueue rows={facts.data} isLoading={false} error={null} mode="full" />
      )}

      <section className="space-y-2" aria-labelledby="paused-title">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="paused-title" className="flex items-center gap-2 text-sm font-semibold">
            <UserMinus className="h-4 w-4 text-muted-foreground" /> Licensed, then went inactive
          </h2>
          {!paused.isLoading && !paused.isError && (
            <span className="text-xs tabular-nums text-muted-foreground">{paused.data?.length ?? 0}</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">Paused licensed agents sit outside the live onboarding queue. This is the retention list.</p>
        {paused.isError ? (
          <p className="text-xs text-destructive">Could not load this list. These agents are missing from the view, not from the business.</p>
        ) : paused.isLoading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : (paused.data?.length ?? 0) === 0 ? (
          <p className="text-xs text-muted-foreground">Nobody on this list.</p>
        ) : (
          <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-lg border border-border bg-card">
            {paused.data!.map((r) => {
              const raw = Number(r.days_stuck);
              const days = Number.isFinite(raw) ? Math.round(raw) : null;
              return (
                <li key={r.agent_id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <AgentNameLink agentId={r.agent_id} className="text-sm font-medium">
                      <span className="truncate">{r.agent?.trim() || AGENT_NAME_FALLBACK}</span>
                    </AgentNameLink>
                    <p className="truncate text-xs text-muted-foreground">{r.owner?.trim() || "Unassigned"}</p>
                  </div>
                  <span className={cn("shrink-0 text-sm tabular-nums", days !== null && days >= 30 ? "font-medium text-destructive" : "text-muted-foreground")}>
                    {days === null ? "unknown" : `${days}d`}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
