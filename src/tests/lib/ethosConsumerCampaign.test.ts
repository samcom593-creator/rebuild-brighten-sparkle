import { describe, expect, it, vi } from "vitest";
import { consumerCoverageMessage, dispatchConsumerClaims, ETHOS_CONSUMER_COVERAGE_URL } from "../../../supabase/functions/_shared/ethos-consumer-campaign.ts";

const claim = { delivery_id: "delivery-1", claim_id: "claim-1", email: "consumer@example.com", first_name: "Pat", state: "WI" };

describe("consumer Ethos coverage invitation receipts", () => {
  it("uses the supplied coverage link and makes no agent-contracting or approval claim", () => {
    const message = consumerCoverageMessage("Pat<script>\n");
    expect(message.text).toContain(ETHOS_CONSUMER_COVERAGE_URL);
    expect(message.text).toContain("does not confirm coverage or approval");
    expect(message.text).not.toMatch(/<script>|contracting|join my team|guaranteed approval/i);
  });
  it("records provider acceptance only with an actual provider id", async () => {
    const send = vi.fn().mockResolvedValue({ ok: true, id: "provider-123" });
    const settle = vi.fn().mockResolvedValue(undefined);
    const receipts = await dispatchConsumerClaims([claim], { send, settle });
    expect(send).toHaveBeenCalledTimes(1);
    expect(receipts[0]).toEqual({ deliveryId: "delivery-1", status: "provider_accepted", providerId: "provider-123", receiptSaved: true });
    expect(settle).toHaveBeenCalledWith(expect.objectContaining({ claimId: "claim-1", status: "provider_accepted" }));
  });
  it("a missing provider id is unknown, even when the helper reports ok", async () => {
    const receipts = await dispatchConsumerClaims([claim], { send: vi.fn().mockResolvedValue({ ok: true, id: null }), settle: vi.fn().mockResolvedValue(undefined) });
    expect(receipts[0].status).toBe("unknown");
  });
  it("suppressed or muted recipients are blocked rather than reported as sent", async () => {
    const send = vi.fn().mockResolvedValue({ ok: false, id: null, refused: "suppressed" });
    const receipts = await dispatchConsumerClaims([claim], { send, settle: vi.fn().mockResolvedValue(undefined) });
    expect(receipts[0].status).toBe("blocked");
  });
  it("never retries a transport failure whose provider outcome is unknown", async () => {
    const send = vi.fn().mockRejectedValue(new Error("connection closed after submission"));
    const receipts = await dispatchConsumerClaims([claim], { send, settle: vi.fn().mockResolvedValue(undefined) });
    expect(send).toHaveBeenCalledTimes(1);
    expect(receipts[0].status).toBe("unknown");
  });
  it("a lost receipt stays explicit and cannot cause a second provider call", async () => {
    const send = vi.fn().mockResolvedValue({ ok: true, id: "provider-123" });
    const settle = vi.fn().mockRejectedValue(new Error("database unavailable"));
    const receipts = await dispatchConsumerClaims([claim], { send, settle });
    expect(send).toHaveBeenCalledTimes(1);
    expect(receipts[0]).toMatchObject({ status: "provider_accepted", receiptSaved: false });
  });
});
