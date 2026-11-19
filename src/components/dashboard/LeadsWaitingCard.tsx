/**
 * LeadsWaitingCard, first thing on a producer's Home (MP-BEST-3, 2026-11-19).
 *
 * Shows only when the person holds leads that still need a call, and says how many, with the warm ones named first.
 * No leads, or every lead worked: nothing renders, never an empty shell. A failed read says so in one line instead of
 * passing for "no leads".
 */
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, PhoneCall } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { MY_LEADS_QUERY_KEY, fetchMyLeads, leadsWaitingSummary } from "@/lib/myLeads";

const leads = (n: number) => `${n} lead${n === 1 ? "" : "s"}`;

export function LeadsWaitingCard() {
  const q = useQuery({ queryKey: MY_LEADS_QUERY_KEY, queryFn: () => fetchMyLeads(), staleTime: 30_000 });
  if (q.isError) {
    return (
      <p role="status" className="rounded-lg border border-border/60 px-4 py-3 text-sm text-muted-foreground" data-testid="leads-waiting-error">
        Your leads did not load. <Link to="/dashboard/my-leads" className="font-medium text-primary hover:underline">Open My Leads</Link> to try again.
      </p>
    );
  }
  const w = leadsWaitingSummary(q.data ?? []);
  if (w.open === 0) return null;

  const detail = [
    w.callbacks > 0 ? `${w.callbacks} waiting on your call back` : null,
    w.neverCalled > 0 ? `${w.neverCalled} never called` : null,
    w.toCall > 0 && w.closedHours > 0 ? `${w.closedHours} more open later` : null,
  ].filter(Boolean).join(" · ");

  return (
    <GlassCard className="flex flex-wrap items-center justify-between gap-3 border-primary/40 bg-primary/5 p-4" data-testid="leads-waiting">
      <div className="flex min-w-0 items-center gap-3">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary" aria-hidden="true">
          <PhoneCall className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-base font-semibold leading-tight">
            {w.toCall > 0 ? `${leads(w.toCall)} to call` : `Calling hours are closed for your ${leads(w.closedHours)}`}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {w.toCall > 0 ? detail || "Each one is waiting on a call from you." : "They open again in the morning where those clients live."}
          </p>
        </div>
      </div>
      <Button asChild className="h-11 w-full sm:h-10 sm:w-auto">
        <Link to="/dashboard/my-leads">{w.toCall > 0 ? "Work my leads" : "See my leads"} <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" /></Link>
      </Button>
    </GlassCard>
  );
}

export default LeadsWaitingCard;
