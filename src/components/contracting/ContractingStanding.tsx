import { Link } from "react-router-dom";
import { ArrowUpRight, ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useContractReview } from "@/hooks/useContractReview";
import { useAgentProfileDrawer } from "@/stores/agentProfileDrawer";
import { levelText, markSentence } from "@/lib/contractReview";

/**
 * Where contracting stands for one agent, straight from the review (the only contracting truth). Read-only here:
 * every confirmation happens on the review itself, so no second place can disagree with it. The link closes the
 * global agent drawer when it came from there (a no-op on the producer profile), so the review is not under a sheet.
 */
export function ContractingStanding({ agentId }: { agentId: string | null | undefined }) {
  const review = useContractReview(!!agentId);
  if (!agentId || !review.canRead) return null;
  const agent = review.roster?.agents.find((a) => a.agent_id === agentId);
  const carriers = review.roster?.carriers ?? [];
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground"><ShieldCheck className="h-4 w-4 text-primary" aria-hidden /> Contracting</h3>
            <p className="text-xs text-muted-foreground">Confirmed by hand on the review after checking each carrier&apos;s portal.</p>
          </div>
          <Link to={`/dashboard/team?view=contracting&review=${agentId}`} onClick={() => useAgentProfileDrawer.getState().close()} className="inline-flex min-h-10 items-center gap-1 text-xs font-semibold text-primary underline-offset-2 hover:underline">
            Open in review <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
        {review.query.isLoading ? <Skeleton className="h-16 w-full" /> : review.query.isError || !review.roster ? (
          <p role="alert" className="text-sm text-amber-700 dark:text-amber-400">
            The contracting review did not load. <button type="button" className="font-semibold underline" onClick={() => void review.query.refetch()}>Retry</button>
          </p>
        ) : !agent ? (
          <p className="text-sm text-muted-foreground">Not part of the contracting review (only active agents are).</p>
        ) : (
          <>
            <p className="text-sm text-foreground">
              <span className="font-semibold">{agent.marked_count} of {carriers.length} carriers confirmed</span>
              <span className="text-muted-foreground"> · Placement level {levelText(agent.level)}</span>
            </p>
            <ul className="grid gap-1 sm:grid-cols-2">
              {carriers.map((c) => (
                <li key={c.key} className="flex items-center justify-between gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs">
                  <span className="font-medium text-foreground">{c.label}</span>
                  <span className={agent.marks[c.key] ? "text-foreground" : "text-muted-foreground"}>{agent.marks[c.key] ? "Confirmed" : "Not yet reviewed"}</span>
                  <span className="sr-only">{markSentence(agent.marks[c.key] ?? null)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
