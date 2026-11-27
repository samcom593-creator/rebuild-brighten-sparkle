import { X } from "lucide-react";
import { dealHeadline, type DealCelebrationBatch } from "@/lib/dealCelebrations";
import { CelebrationTrophy } from "./CelebrationTrophy";
import "./deal-celebration.css";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

/** A nonblocking production receipt. No client, policy, phone, or arbitrary alert text enters this UI. */
export function DealCelebration({ batch, agentNames, onDismiss }: { batch: DealCelebrationBatch; agentNames: Record<string, string>; onDismiss: () => void }) {
  const namedAgents = Object.entries(batch.agentCounts).filter(([agentId]) => agentNames[agentId]);
  const showNames = namedAgents.length > 1 || (namedAgents.length === 1 && namedAgents[0][1] !== batch.count);
  return (
    <aside className="deal-celebration" aria-label="Production celebration">
      <div className="deal-celebration-balloons" aria-hidden="true">
        {/* stable-key-allow:fixed-decorative-balloons */}
        {Array.from({ length: 6 }, (_, index) => <span key={index} />)}
      </div>
      <div className="deal-celebration-card">
        <CelebrationTrophy />
        <div role="status" aria-live="polite" aria-atomic="true">
          <p className="deal-celebration-eyebrow">New deal</p>
          <p className="deal-celebration-title">{dealHeadline(batch, agentNames)}</p>
          {showNames && <ul className="deal-celebration-agents">
            {namedAgents.slice(0, 4).map(([agentId, count]) => <li key={agentId}>{agentNames[agentId]} closed {count === 1 ? "a deal" : `${count} deals`}</li>)}
            {namedAgents.length > 4 && <li>and {namedAgents.length - 4} more agents</li>}
          </ul>}
          {batch.annualPremium !== null && <p className="deal-celebration-amount">{money.format(batch.annualPremium)} <span>annual premium</span></p>}
          <p className="deal-celebration-note">Saved to deal records. Carrier status is tracked separately.</p>
        </div>
        <button className="deal-celebration-dismiss" type="button" aria-label="Dismiss deal celebration" onClick={onDismiss}><X aria-hidden="true" size={20} /></button>
      </div>
    </aside>
  );
}
