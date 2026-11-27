import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  clearQueue,
  enqueue,
  flushQueue,
  readQueue,
  readQueueForUser,
  isParked,
  removeQueuedDealAfterReceipt,
  retryParkedDeals,
} from "@/lib/offlineQueue";
import { supabase } from "@/integrations/supabase/client";
import { announcePostedDealReceipt } from "@/lib/dealCelebrations";
import { sendQueuedEntry } from "@/components/layout/OfflineSyncStatus";

vi.mock("@/lib/dealCelebrations", () => ({ announcePostedDealReceipt: vi.fn() }));

const rpc = vi.mocked(supabase.rpc) as unknown as ReturnType<typeof vi.fn>;
const retryKey = "11111111-1111-4111-8111-111111111111";
const reviewId = "22222222-2222-4222-8222-222222222222";
const dealId = "33333333-3333-4333-8333-333333333333";
const hold = (status: "review_required" | "review_rejected") => ({
  ok: false, status, reviewId, reviewVersion: 1, matchCount: 1,
});
function waiting(ownerUserId: string, idempotencyKey = retryKey) {
  return enqueue({ ownerUserId, kind: "submit_apex_deal", idempotencyKey,
    args: { p_idempotency_key: idempotencyKey, p_payload: { policyNumber: "SYNTHETIC-POLICY" } },
    label: "Synthetic waiting deal" });
}

describe("offline deal outbox", () => {
  beforeEach(() => { clearQueue(); rpc.mockReset(); vi.mocked(announcePostedDealReceipt).mockClear(); });

  it.each(["review_required", "review_rejected"] as const)("parks a %s response without counting a sale or celebrating", async (status) => {
    waiting("user-a"); waiting("user-b");
    // Even an unexpected dealId on a held response cannot turn it into success.
    rpc.mockResolvedValue({ data: { ...hold(status), dealId }, error: null });
    expect(await flushQueue(sendQueuedEntry, "user-a")).toMatchObject({ sent: 0, failed: 1, remaining: 1 });
    expect(isParked(readQueueForUser("user-a")[0])).toBe(true);
    expect(readQueueForUser("user-a")[0].lastError).toMatch(/no deal was posted/i);
    expect(readQueueForUser("user-b")[0].attempts).toBe(0);
    expect(announcePostedDealReceipt).not.toHaveBeenCalled();
    expect(await flushQueue(sendQueuedEntry, "user-a")).toMatchObject({ sent: 0, failed: 0, remaining: 1, idle: true });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("only clears a parked deal after a deliberate retry returns a durable receipt for that user", async () => {
    waiting("user-a"); waiting("user-b");
    rpc.mockResolvedValueOnce({ data: hold("review_required"), error: null });
    await flushQueue(sendQueuedEntry, "user-a");
    retryParkedDeals("user-a");
    const receipt = { ok: true, dealId, status: "submitted", replayed: false };
    rpc.mockResolvedValueOnce({ data: receipt, error: null });
    expect(await flushQueue(sendQueuedEntry, "user-a")).toMatchObject({ sent: 1, failed: 0, remaining: 0 });
    expect(readQueueForUser("user-a")).toHaveLength(0);
    expect(readQueueForUser("user-b")).toHaveLength(1);
    expect(announcePostedDealReceipt).toHaveBeenCalledExactlyOnceWith("user-a", receipt);
  });

  it("retains malformed review responses and transport errors without a success or celebration", async () => {
    waiting("user-a");
    rpc.mockResolvedValueOnce({ data: { ...hold("review_required"), reviewId: "invalid" }, error: null });
    expect(await flushQueue(sendQueuedEntry, "user-a")).toMatchObject({ sent: 0, failed: 1, remaining: 1 });
    rpc.mockResolvedValueOnce({ data: null, error: { message: "Network unavailable" } });
    expect(await flushQueue(sendQueuedEntry, "user-a")).toMatchObject({ sent: 0, failed: 1, remaining: 1 });
    expect(readQueueForUser("user-a")[0].attempts).toBe(2);
    expect(announcePostedDealReceipt).not.toHaveBeenCalled();
  });

  it("review-page receipt cleanup removes only the matching user and retry key", () => {
    waiting("user-a"); waiting("user-b"); waiting("user-a", reviewId);
    removeQueuedDealAfterReceipt("user-a", retryKey);
    expect(readQueueForUser("user-a").map(entry => entry.idempotencyKey)).toEqual([reviewId]);
    expect(readQueueForUser("user-b").map(entry => entry.idempotencyKey)).toEqual([retryKey]);
  });

  it("deduplicates retries for one user but never mixes account outboxes", () => {
    const base = {
      kind: "submit_apex_deal" as const,
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      args: { p_payload: { policyNumber: "POL-1" } },
      label: "Client · POL-1",
    };
    expect(enqueue({ ...base, ownerUserId: "user-a" }).ok).toBe(true);
    expect(enqueue({ ...base, ownerUserId: "user-a", label: "Updated · POL-1" }).ok).toBe(true);
    expect(enqueue({ ...base, ownerUserId: "user-b" }).ok).toBe(true);

    expect(readQueue()).toHaveLength(2);
    expect(readQueueForUser("user-a")).toHaveLength(1);
    expect(readQueueForUser("user-a")[0].label).toBe("Updated · POL-1");
  });

  it("flushes only the signed-in user's entries and removes them only on receipt", async () => {
    for (const ownerUserId of ["user-a", "user-b"]) {
      enqueue({
        ownerUserId,
        kind: "submit_apex_deal",
        idempotencyKey: `${ownerUserId}-1111-4111-8111-111111111111`,
        args: { p_idempotency_key: `${ownerUserId}-key` },
        label: `${ownerUserId} deal`,
      });
    }

    const outcome = await flushQueue(async () => ({ ok: true }), "user-a");
    expect(outcome).toMatchObject({ sent: 1, failed: 0, remaining: 0 });
    expect(readQueueForUser("user-a")).toHaveLength(0);
    expect(readQueueForUser("user-b")).toHaveLength(1);
  });

  it("keeps uncertain failures queued for a duplicate-safe retry", async () => {
    enqueue({
      ownerUserId: "user-a",
      kind: "submit_apex_deal",
      idempotencyKey: "33333333-3333-4333-8333-333333333333",
      args: { p_idempotency_key: "33333333-3333-4333-8333-333333333333" },
      label: "Waiting deal",
    });

    const outcome = await flushQueue(async () => ({ ok: false, error: "network unavailable" }), "user-a");
    expect(outcome).toMatchObject({ sent: 0, failed: 1, remaining: 1 });
    expect(readQueueForUser("user-a")[0].attempts).toBe(1);
  });

  it("is wired into deal submission and the authenticated app shell", () => {
    const dialog = readFileSync(resolve(process.cwd(), "src/components/deals/SubmitDealDialog.tsx"), "utf8");
    const shell = readFileSync(resolve(process.cwd(), "src/components/layout/AuthenticatedShell.tsx"), "utf8");
    const sync = readFileSync(resolve(process.cwd(), "src/components/layout/OfflineSyncStatus.tsx"), "utf8");

    expect(dialog).toContain('kind: "submit_apex_deal"');
    expect(dialog).toContain("p_idempotency_key: idempotencyKey");
    expect(dialog).toContain("isTransportError");
    expect(shell).toContain("<OfflineSyncStatus />");
    expect(sync).toContain('"submit_apex_deal"');
    expect(sync).toContain("invalidateOperationalTruth(queryClient)");
  });
});
