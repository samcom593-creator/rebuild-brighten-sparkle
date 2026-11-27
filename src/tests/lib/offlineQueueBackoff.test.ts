// 2026-11-27 incident: agents could not post. pg_stat_activity showed ten
// concurrent submit_apex_deal calls for ONE idempotency key queued on its
// advisory lock while an eleventh ran; each waiter died at the 8s statement
// timeout, the browsers retried at once, and the convoy refilled itself. The
// server now refuses a second concurrent attempt per key ({ok:false,
// status:'in_progress'}). These tests pin the client half: never two sends for
// one key at once, a growing pause after a transient failure, no burned attempt
// when the server says "still running", and a 504 or 57014 counted as transport.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  FIRST_RETRY_DELAY_MS,
  IN_PROGRESS_RETRY_MS,
  MAX_RETRY_DELAY_MS,
  SEND_LEASE_MS,
  backoffMs,
  clearQueue,
  enqueue,
  flushQueue,
  isDue,
  isInFlight,
  isLeased,
  isParked,
  isTransportError,
  markInFlight,
  readQueueForUser,
} from "@/lib/offlineQueue";
import { supabase } from "@/integrations/supabase/client";
import { sendQueuedEntry } from "@/components/layout/OfflineSyncStatus";

vi.mock("@/lib/dealCelebrations", () => ({ announcePostedDealReceipt: vi.fn() }));

const rpc = vi.mocked(supabase.rpc) as unknown as ReturnType<typeof vi.fn>;
const key = "44444444-4444-4444-8444-444444444444";
const T0 = Date.parse("2026-11-27T17:00:00Z");

function waiting(ownerUserId = "user-a", idempotencyKey = key) {
  return enqueue({ ownerUserId, kind: "submit_apex_deal", idempotencyKey, args: { p_idempotency_key: idempotencyKey }, label: "Waiting deal" });
}

describe("outbox retry pacing after the 2026-11-27 convoy", () => {
  beforeEach(() => { clearQueue(); rpc.mockReset(); });

  it("backs off 30s, then doubles, capped at 10 minutes", () => {
    expect(backoffMs(1)).toBe(FIRST_RETRY_DELAY_MS);
    expect(backoffMs(2)).toBe(FIRST_RETRY_DELAY_MS * 2);
    expect(backoffMs(3)).toBe(FIRST_RETRY_DELAY_MS * 4);
    expect(backoffMs(40)).toBe(MAX_RETRY_DELAY_MS);
  });

  it("a transient failure schedules a pause and the next flush skips the entry until it is due", async () => {
    waiting();
    const send = vi.fn(async () => ({ ok: false as const, error: "canceling statement due to statement timeout" }));
    expect(await flushQueue(send, "user-a", { now: () => T0 })).toMatchObject({ sent: 0, failed: 1, deferred: 0, remaining: 1 });
    const [entry] = readQueueForUser("user-a");
    expect(entry.attempts).toBe(1);
    expect(Date.parse(entry.nextAttemptAt as string)).toBe(T0 + FIRST_RETRY_DELAY_MS);
    expect(isDue(entry, T0 + 1_000)).toBe(false);
    expect(isDue(entry, T0 + FIRST_RETRY_DELAY_MS)).toBe(true);

    // One second later: not due, not sent, not failed, not idle.
    expect(await flushQueue(send, "user-a", { now: () => T0 + 1_000 })).toMatchObject({ sent: 0, failed: 0, deferred: 1, remaining: 1, idle: false });
    expect(send).toHaveBeenCalledTimes(1);

    // Once due it is sent again, and the second failure doubles the pause.
    expect(await flushQueue(send, "user-a", { now: () => T0 + FIRST_RETRY_DELAY_MS })).toMatchObject({ sent: 0, failed: 1, deferred: 0 });
    expect(send).toHaveBeenCalledTimes(2);
    expect(Date.parse(readQueueForUser("user-a")[0].nextAttemptAt as string)).toBe(T0 + FIRST_RETRY_DELAY_MS + FIRST_RETRY_DELAY_MS * 2);
  });

  it("a deliberate Sync now ignores the pause but a key in flight is still never sent twice", async () => {
    waiting();
    const send = vi.fn(async () => ({ ok: false as const, error: "timed out" }));
    await flushQueue(send, "user-a", { now: () => T0 });
    expect(await flushQueue(send, "user-a", { now: () => T0 + 1_000, ignoreBackoff: true })).toMatchObject({ failed: 1, deferred: 0 });
    expect(send).toHaveBeenCalledTimes(2);

    const release = markInFlight("user-a", key);
    expect(isInFlight("user-a", key)).toBe(true);
    expect(await flushQueue(send, "user-a", { now: () => T0 + 60_000, ignoreBackoff: true })).toMatchObject({ sent: 0, failed: 0, deferred: 1, idle: false });
    expect(send).toHaveBeenCalledTimes(2);
    release();
    expect(isInFlight("user-a", key)).toBe(false);
    expect(await flushQueue(send, "user-a", { now: () => T0 + 60_000, ignoreBackoff: true })).toMatchObject({ failed: 1 });
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("the flusher marks each key in flight only while its send is running, and leases it in storage for other tabs", async () => {
    waiting();
    let seenDuringSend = false;
    let leaseDuringSend: string | null | undefined;
    const send = vi.fn(async () => {
      seenDuringSend = isInFlight("user-a", key);
      leaseDuringSend = readQueueForUser("user-a")[0]?.leaseUntil;
      return { ok: false as const, error: "timed out" };
    });
    await flushQueue(send, "user-a", { now: () => T0 });
    expect(seenDuringSend).toBe(true);
    expect(Date.parse(leaseDuringSend as string)).toBe(T0 + SEND_LEASE_MS);
    expect(isInFlight("user-a", key)).toBe(false);
    expect(readQueueForUser("user-a")[0].leaseUntil).toBeNull();
  });

  it("another tab's live lease blocks a send even for Sync now, and an expired lease does not", async () => {
    waiting();
    const send = vi.fn(async () => ({ ok: true as const }));
    // Simulate a second tab mid-send: lease written to the shared outbox.
    const leased = readQueueForUser("user-a").map((row) => ({ ...row, leaseUntil: new Date(T0 + 60_000).toISOString() }));
    window.localStorage.setItem("apex.offline.outbox.v1", JSON.stringify(leased));
    expect(isLeased(readQueueForUser("user-a")[0], T0)).toBe(true);
    expect(await flushQueue(send, "user-a", { now: () => T0, ignoreBackoff: true })).toMatchObject({ sent: 0, deferred: 1, idle: false });
    expect(send).not.toHaveBeenCalled();
    expect(await flushQueue(send, "user-a", { now: () => T0 + 61_000 })).toMatchObject({ sent: 1, deferred: 0 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("a deal queued because the server was busy waits its first pause; one queued offline does not", () => {
    enqueue({ ownerUserId: "user-a", kind: "submit_apex_deal", idempotencyKey: key, args: {}, label: "busy", firstAttemptAt: T0 + FIRST_RETRY_DELAY_MS });
    expect(Date.parse(readQueueForUser("user-a")[0].nextAttemptAt as string)).toBe(T0 + FIRST_RETRY_DELAY_MS);
    enqueue({ ownerUserId: "user-a", kind: "submit_apex_deal", idempotencyKey: key, args: {}, label: "offline", firstAttemptAt: null });
    expect(readQueueForUser("user-a")[0].nextAttemptAt).toBeNull();
  });

  it("'still running on the server' defers without burning an attempt or parking", async () => {
    waiting();
    const send = vi.fn(async () => ({ ok: false as const, error: "An earlier attempt is still running.", retryAfterMs: IN_PROGRESS_RETRY_MS }));
    expect(await flushQueue(send, "user-a", { now: () => T0 })).toMatchObject({ sent: 0, failed: 0, deferred: 1, remaining: 1, idle: false });
    const [entry] = readQueueForUser("user-a");
    expect(entry.attempts).toBe(0);
    expect(isParked(entry)).toBe(false);
    expect(Date.parse(entry.nextAttemptAt as string)).toBe(T0 + IN_PROGRESS_RETRY_MS);
    expect(entry.lastError).toMatch(/still running/);
  });

  it("sendQueuedEntry maps the server's in_progress answer and a 55P03 lock timeout to a short wait, never to success or a park", async () => {
    const [entry] = (waiting(), readQueueForUser("user-a"));
    rpc.mockResolvedValueOnce({ data: { ok: false, status: "in_progress", idempotencyKey: key }, error: null });
    const result = await sendQueuedEntry(entry);
    expect(result).toMatchObject({ ok: false, retryAfterMs: IN_PROGRESS_RETRY_MS });
    expect((result as { permanent?: boolean }).permanent).toBeUndefined();

    rpc.mockResolvedValueOnce({ data: null, error: { message: "canceling statement due to lock timeout", code: "55P03" } });
    expect(await sendQueuedEntry(entry)).toMatchObject({ ok: false, retryAfterMs: IN_PROGRESS_RETRY_MS });
  });

  it("counts a gateway timeout and a Postgres statement timeout as transport, and a server refusal as not", () => {
    expect(isTransportError({ message: "", status: 504 })).toBe(true);
    expect(isTransportError({ message: "", statusCode: 503 })).toBe(true);
    expect(isTransportError({ message: "canceling statement due to statement timeout", code: "57014" })).toBe(true);
    expect(isTransportError({ message: "", code: "57014" })).toBe(true);
    expect(isTransportError({ message: "canceling statement due to lock timeout", code: "55P03" })).toBe(true);
    expect(isTransportError({ message: "Complete the insured name, valid date of birth, phone and carrier before submitting", code: "22023", status: 400 })).toBe(false);
    expect(isTransportError({ message: "" })).toBe(false);
  });

  it("source: the dialog never re-calls the RPC on in_progress, guards double posts, and names the real reason a deal sits on the device", () => {
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const dialog = strip(readFileSync(resolve(process.cwd(), "src/components/deals/SubmitDealDialog.tsx"), "utf8"));
    const sync = strip(readFileSync(resolve(process.cwd(), "src/components/layout/OfflineSyncStatus.tsx"), "utf8"));
    expect(dialog).toContain('data.status === "in_progress"');
    expect(dialog).toContain("await awaitReceiptByKey()");
    expect(dialog).toContain("isInFlight(user.id, idempotencyKey)");
    expect(dialog).toContain("markInFlight(user.id, idempotencyKey)");
    expect(dialog).toContain('queueCurrentDeal("still_saving")');
    expect(dialog).toContain("queueCurrentDeal(transportReason())");
    // Exactly one call site to the submit RPC in the dialog: the in_progress branch polls the ledger instead.
    expect(dialog.match(/"submit_apex_deal", queuedArgs\)/g) ?? []).toHaveLength(1);
    expect(sync).toContain("ignoreBackoff: Boolean(options?.manual)");
    expect(sync).toContain('data.status === "in_progress"');
  });
});
