import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ChevronDown, UserCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ToneBubble, TonePill } from "@/components/ui/delight/ToneBubble";
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
 *
 * Grow redesign (2026-10-28): under the recruiting worklist it was a second full
 * dashboard. It is now one summary row (title, counts, Open queue) with the preview
 * one tap away, so the page has one job until someone asks for this one.
 *
 * Colour layer (2026-10-28): the two counts are tone pills in the shared vocabulary
 * (src/lib/tones.ts): open steps need a nudge, a hire blocked from writing business is
 * "act now", and a zero on either reads as going well. Onboarding is paperwork, so the
 * title's bubble is royal. The words are the same as before.
 */
export function NoHireLeftBehindPanel() {
  const facts = useOnboardingExceptionFacts();
  const queue = useMemo(() => buildExceptionQueue(facts.data ?? []), [facts.data]);
  const blocking = queue.filter((q) => q.primary?.blocking).length;

  const [open, setOpen] = useState(false);

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card" aria-labelledby="nhlb-title">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 id="nhlb-title" className="flex items-center gap-2 text-base font-semibold text-foreground">
            <ToneBubble tone="royal" size="sm"><UserCheck /></ToneBubble>No Hire Left Behind
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            New hires with an open onboarding step.
            {facts.isError ? " The queue could not load. Open it to retry." : facts.isLoading ? " Counting them now." : ""}
          </p>
          {!facts.isError && !facts.isLoading && (
            <p className="mt-2 flex flex-wrap items-center gap-2">
              <TonePill tone={queue.length > 0 ? "warm" : "good"}>
                {queue.length} {queue.length === 1 ? "hire" : "hires"} with open steps
              </TonePill>
              <TonePill tone={blocking > 0 ? "hot" : "good"}>
                {blocking} blocked from writing business
              </TonePill>
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            variant="ghost"
            className="h-11 gap-1.5"
            aria-expanded={open}
            aria-controls="nhlb-preview"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Hide" : "Preview"}
            <ChevronDown className={open ? "h-4 w-4 rotate-180 transition-transform" : "h-4 w-4 transition-transform"} />
          </Button>
          <Button asChild variant="outline" className="h-11 gap-1.5">
            <Link to="/dashboard/onboarding-ladder">Open queue <ArrowRight className="h-4 w-4" /></Link>
          </Button>
        </div>
      </div>
      <div id="nhlb-preview" hidden={!open} className="border-t border-border p-3 sm:p-4">
        {open && <OnboardingExceptionQueue rows={facts.data} isLoading={facts.isLoading} error={facts.error} mode="compact" limit={8} />}
      </div>
    </section>
  );
}
