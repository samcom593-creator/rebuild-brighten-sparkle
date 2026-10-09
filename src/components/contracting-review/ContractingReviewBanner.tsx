import { Link } from "react-router-dom";
import { ArrowRight, ClipboardList } from "lucide-react";
import { cn } from "@/lib/utils";
import { useContractReview } from "@/hooks/useContractReview";
import { reviewCounts } from "@/lib/contractReview";

/**
 * One calm line on Home and My Day: how many agents still have a carrier circle to review, linking to My Team. It owns
 * no rule and no list, and it is not an alarm: Not yet reviewed is not late. It says so plainly when the read fails
 * rather than looking all clear, and shows nothing for accounts the server will not give the review to.
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
  const n = reviewCounts(review.roster.agents, review.roster.carriers.length).needsReview;
  if (n === 0) return null;
  return (
    <Link to="/dashboard/team" className={cn(base, className)}>
      <ClipboardList className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="flex-1">{n} {n === 1 ? "agent still has" : "agents still have"} a carrier circle to review. Open My Team.</span>
      <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
    </Link>
  );
}
