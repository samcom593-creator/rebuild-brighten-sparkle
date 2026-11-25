import { Link } from "react-router-dom";
import { ArrowUpRight, ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useContractReview } from "@/hooks/useContractReview";
import { useAgentProfileDrawer } from "@/stores/agentProfileDrawer";
import { CarrierContractsPanel } from "@/components/team/CarrierContractsPanel";

/**
 * Saved profile details plus the existing team receipt tracker. Old portal circles are historical; their count
 * is never presented here as current readiness. This summary remains read-only.
 */
export function ContractingStanding({ agentId }: { agentId: string | null | undefined }) {
  const review = useContractReview(!!agentId);
  if (!agentId || !review.canRead) return null;
  const agent = review.roster?.agents.find((a) => a.agent_id === agentId);
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground"><ShieldCheck className="h-4 w-4 text-primary" aria-hidden /> Contracting</h3>
            <p className="text-sm text-muted-foreground">Profile details and manually verified contract receipts.</p>
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
              <span className="font-semibold">{agent.profile.complete ? "Profile details saved" : "Profile details incomplete"}</span>
            </p>
            <CarrierContractsPanel key={agentId} agentId={agentId} readOnly />
          </>
        )}
      </CardContent>
    </Card>
  );
}
