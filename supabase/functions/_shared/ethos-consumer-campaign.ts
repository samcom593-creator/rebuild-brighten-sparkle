/** Consumer coverage invitations. This link is never an agent signup or contracting link. */
export const ETHOS_CONSUMER_COVERAGE_URL = "https://agents.ethoslife.com/invite/e1c102";
export const ETHOS_CONSUMER_CAMPAIGN_KEY = "ethos-consumer-20261124-v1";
export const ETHOS_CONSUMER_TEMPLATE_VERSION = "coverage-invitation-v1";

export type ConsumerClaim = {
  delivery_id: string;
  claim_id: string;
  email: string;
  first_name: string | null;
  state: string;
};

export function consumerCoverageMessage(firstName: string | null) {
  const name = String(firstName ?? "").replace(/[\r\n<>]/g, "").trim().slice(0, 60);
  const greeting = name ? `Hi ${name},` : "Hi,";
  const subject = "Explore life insurance options with Sam";
  const text = `${greeting}\n\nI'm Sam James with Galaxy Financial. If you're interested in life insurance, you can review options and request a quote through my Ethos coverage page:\n\n${ETHOS_CONSUMER_COVERAGE_URL}\n\nAvailability, pricing, and eligibility depend on your state and the insurer's review. This invitation does not confirm coverage or approval.\n\nYou can reply with questions. There is no obligation to apply.\n\nSam James\nGalaxy Financial`;
  return { subject, text };
}

export type ConsumerSendResult = { ok: boolean; id: string | null; error?: string; refused?: string };
export type ConsumerDeliveryReceipt = {
  deliveryId: string;
  status: "provider_accepted" | "blocked" | "unknown";
  providerId: string | null;
  receiptSaved: boolean;
};

/** A DB claim is single-use. Ambiguous outcomes are never automatically requeued. */
export async function dispatchConsumerClaims(
  claims: ConsumerClaim[],
  deps: {
    send: (input: { to: string; subject: string; text: string; tagName: string }) => Promise<ConsumerSendResult>;
    settle: (input: { deliveryId: string; claimId: string; status: ConsumerDeliveryReceipt["status"]; providerId: string | null; reason: string | null }) => Promise<void>;
    pause?: () => Promise<void>;
  },
): Promise<ConsumerDeliveryReceipt[]> {
  const receipts: ConsumerDeliveryReceipt[] = [];
  for (const claim of claims) {
    let result: ConsumerSendResult;
    try {
      result = await deps.send({ to: claim.email, ...consumerCoverageMessage(claim.first_name), tagName: "ethos-consumer" });
    } catch {
      result = { ok: false, id: null, error: "Provider outcome unknown; reconcile before any retry." };
    }
    const status = result.ok && result.id ? "provider_accepted" : result.refused ? "blocked" : "unknown";
    let receiptSaved = false;
    try {
      await deps.settle({ deliveryId: claim.delivery_id, claimId: claim.claim_id, status, providerId: result.id ?? null,
        reason: status === "provider_accepted" ? null : result.refused ?? "Provider outcome unknown; manual reconciliation required." });
      receiptSaved = true;
    } catch {
      // Keep the durable DB claim in attempting state. It must not be retried after a lost receipt.
      receiptSaved = false;
    }
    receipts.push({ deliveryId: claim.delivery_id, status, providerId: result.id ?? null, receiptSaved });
    if (deps.pause && receipts.length < claims.length) await deps.pause();
  }
  return receipts;
}
