import { RealFinancesCard } from "./RealFinancesCard";
import { CarrierBreakdownCard } from "./CarrierBreakdownCard";
import { TopDownlineCard } from "./TopDownlineCard";
import { PayoutScheduleCard } from "./PayoutScheduleCard";

/**
 * 2x2 grid combining all 4 InsuraCloud cards.
 * Pass agentId to scope to a specific agent, or omit for agency aggregate.
 */
export function FinancesGrid({ agentId }: { agentId?: string | null }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <RealFinancesCard agentId={agentId} />
      <PayoutScheduleCard agentId={agentId} />
      <CarrierBreakdownCard agentId={agentId} />
      <TopDownlineCard agentId={agentId} />
    </div>
  );
}
