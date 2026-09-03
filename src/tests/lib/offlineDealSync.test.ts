import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  clearQueue,
  enqueue,
  flushQueue,
  readQueue,
  readQueueForUser,
} from "@/lib/offlineQueue";

describe("offline deal outbox", () => {
  beforeEach(() => clearQueue());

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
