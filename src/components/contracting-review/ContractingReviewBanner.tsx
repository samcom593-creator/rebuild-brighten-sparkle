import { Link } from "react-router-dom";
import { ArrowRight, ClipboardList } from "lucide-react";
import { cn } from "@/lib/utils";
import { useContractReview } from "@/hooks/useContractReview";

/**
 * One link to incomplete saved profiles. Historical carrier-circle counts do not describe current readiness.
 * Failed reads stay visible; this does not infer carrier eligibility or approval.
 */
export function ContractingReviewBanner({ className }: { className?: string }) {
  const review = useContractReview(true);
  if (!review.canRead || review.query.isLoading) return null;
  const base = "flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-foreground hover:border-primary";
  if (review.query.isError || !review.roster) {
    return (
      <Link to="/dashboard/team" className={cn(base, className)}>
        <ClipboardList className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="flex-1">The contracting review did not load. Open My Team to retry.</span>
        <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
      </Link>
    );
  }
  const n = review.roster.agents.filter((agent) => !agent.profile.complete).length;
  if (n === 0) return null;
  return (
    <Link to="/dashboard/team?view=contracting" className={cn(base, className)}>
      <ClipboardList className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="flex-1">{n} {n === 1 ? "agent has" : "agents have"} incomplete contracting profile details. Open My Team.</span>
      <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
    </Link>
  );
}
