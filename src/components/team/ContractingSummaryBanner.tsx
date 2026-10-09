import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useTeamContracting } from "@/lib/teamContracting";
import { cn } from "@/lib/utils";

/**
 * One line on Home and My Day that reads the SAME calculation as My Team and links there. It owns no rule, no
 * threshold and no list: the people, the reasons and the actions live on My Team. It shows nothing for accounts
 * the server will not give the list to, and says so plainly when the read fails rather than looking all clear.
 */
export function ContractingSummaryBanner({ className }: { className?: string }) {
  const { isAdmin, isManager, isVaManager, isVa } = useAuth();
  const allowed = isAdmin || isManager || isVaManager || isVa;
  const q = useTeamContracting(allowed);
  if (!allowed || q.isLoading) return null;

  if (q.isError || !q.data) {
    return (
      <Link to="/dashboard/team" className={cn("flex items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200", className)}>
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
        <span className="flex-1">Contracting status unavailable. Open My Team to retry.</span>
        <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
      </Link>
    );
  }
  if (!q.data.basis.confirmed) {
    return (
      <Link to="/dashboard/team" className={cn("flex items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200", className)}>
        <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden />
        <span className="flex-1">Contracting urgency is off until the timing rule is confirmed on My Team.</span>
        <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
      </Link>
    );
  }
  const n = q.data.counts.p1_people;
  if (n === 0) return null;
  return (
    <Link to="/dashboard/team" className={cn("flex items-center gap-3 rounded-lg border-2 border-red-500/60 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-800 dark:text-red-200", className)}>
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
      <span className="flex-1">{n} {n === 1 ? "person needs" : "people need"} contact now: contracting overdue. Open My Team.</span>
      <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
    </Link>
  );
}
