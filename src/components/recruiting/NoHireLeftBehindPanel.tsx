import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, UserCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { OnboardingExceptionQueue } from "@/components/onboarding/OnboardingExceptionQueue";
import { useOnboardingExceptionFacts } from "@/components/onboarding/useOnboardingExceptionFacts";
import { buildExceptionQueue } from "@/lib/onboardingExceptions";

/**
 * No Hire Left Behind — the onboarding EXCEPTION queue (APEX OS redesign §6).
 *
 * It used to be four tiles and six names over v_onboarding_sequence's single
 * "next missing step" chain, which put "Join Slack" (1 of 83 verified) ahead of
 * licensing and contracting, so 74 of 84 rows said "Join Slack" and no row could
 * ever say contracting was the block. Nothing on it was clickable but the name.
 *
 * Now: every live hire with an open requirement, led by the most urgent one
 * (contracting first), each with why it matters, the accountable owner, time
 * waiting from a real record, the last real outreach, the next action and the
 * button that resolves it. Facts come from public.onboarding_exception_facts()
 * (realtime on agents / onboarding_progress / contracting_intakes); requirement
 * rules live in src/lib/onboardingExceptions.ts.
 *
 * Props: none — kept stable for DashboardApplicants, which mounts it bare.
 */
export function NoHireLeftBehindPanel() {
  const facts = useOnboardingExceptionFacts();
  const queue = useMemo(() => buildExceptionQueue(facts.data ?? []), [facts.data]);
  const blocking = queue.filter((q) => q.primary?.blocking).length;

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card" aria-labelledby="nhlb-title">
      <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 id="nhlb-title" className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <UserCheck className="h-4 w-4 text-primary" />No Hire Left Behind
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Live Milver + VA handoff queue.{" "}
            {facts.isLoading || facts.isError
              ? "Every live hire with an open onboarding requirement, most urgent first."
              : `${queue.length} hires with open requirements · ${blocking} blocked from writing business.`}
          </p>
        </div>
        <Button asChild size="sm" className="gap-1.5">
          <Link to="/dashboard/onboarding-ladder">Work full queue <ArrowRight className="h-3.5 w-3.5" /></Link>
        </Button>
      </div>
      <div className="p-3 sm:p-4">
        <OnboardingExceptionQueue rows={facts.data} isLoading={facts.isLoading} error={facts.error} mode="compact" limit={8} />
      </div>
    </section>
  );
}
