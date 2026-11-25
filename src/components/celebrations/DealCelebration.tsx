import { X } from "lucide-react";
import type { DealCelebrationBatch } from "@/lib/dealCelebrations";
import "./deal-celebration.css";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

/** A nonblocking production receipt. No client, policy, phone, or arbitrary alert text enters this UI. */
export function DealCelebration({ batch, onDismiss }: { batch: DealCelebrationBatch; onDismiss: () => void }) {
  return (
    <aside className="deal-celebration" aria-label="Production celebration">
      <div className="deal-celebration-balloons" aria-hidden="true">
        {/* stable-key-allow:fixed-decorative-balloons */}
        {Array.from({ length: 6 }, (_, index) => <span key={index} />)}
      </div>
      <div className="deal-celebration-card">
        <div role="status" aria-live="polite" aria-atomic="true">
          <p className="deal-celebration-eyebrow">New production</p>
          <p className="deal-celebration-title">{batch.count === 1 ? "Deal posted" : `${batch.count} deals posted`}</p>
          {batch.annualPremium !== null && <p className="deal-celebration-amount">{money.format(batch.annualPremium)} <span>annual premium</span></p>}
          <p className="deal-celebration-note">Saved to your deal records.</p>
        </div>
        <button className="deal-celebration-dismiss" type="button" aria-label="Dismiss deal celebration" onClick={onDismiss}><X aria-hidden="true" size={20} /></button>
      </div>
    </aside>
  );
}
