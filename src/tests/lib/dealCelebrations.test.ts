import { afterEach, describe, expect, it, vi } from "vitest";
import { addDealToBatch, announcePostedDealReceipt, areDealCelebrationsSuppressed, DealCelebrationLedger, dealHeadline, POSTED_DEAL_RECEIPT_EVENT, readCelebrationAgentNames, readPostedDeal, readRealtimePostedDeal, subscribeDealCelebrationSuppression, suppressDealCelebrations } from "@/lib/dealCelebrations";

const now = Date.parse("2026-11-25T16:00:00Z");
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const native = { id, source: "apex_native", status: "submitted", posted_at: new Date(now).toISOString(), annual_premium: 1200, client_first_name: "Never shown", policy_number: "PRIVATE", subject: "Untrusted message" };

afterEach(() => vi.restoreAllMocks());

describe("confirmed deal events", () => {
  it("extracts only a stable ID, actual post time and stored annual premium", () => {
    expect(readPostedDeal(native, now - 100, now)).toEqual({ id, postedAt: now, annualPremium: 1200 });
  });

  it("accepts only a stable agent identity and separately authorized names", () => {
    const agentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    expect(readPostedDeal({ ...native, agent_id: agentId, agent_name: "Unverified Person" }, now, now)?.agentId).toBe(agentId);
    expect(readPostedDeal({ ...native, agent_id: "Avery Lane" }, now, now)?.agentId).toBeUndefined();
    expect(readCelebrationAgentNames([
      { id: agentId, display_name: "  Avery   Lane  " },
      { id, display_name: "Unauthorized Row" },
    ], [agentId])).toEqual({ [agentId]: "Avery Lane" });
    for (const name of [null, "", "Agent", "Unknown", "—"]) {
      expect(readCelebrationAgentNames([{ id: agentId, display_name: name }], [agentId])).toEqual({});
    }
  });

  it("uses the verified name for a single contributor without assigning unresolved deals to them", () => {
    const agentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const one = addDealToBatch(null, { id, postedAt: now, annualPremium: 1200, agentId });
    expect(dealHeadline(one, { [agentId]: "Avery Lane" })).toBe("Avery Lane closed a deal");
    const two = addDealToBatch(one, { id: "second", postedAt: now, annualPremium: 1200, agentId });
    expect(dealHeadline(two, { [agentId]: "Avery Lane" })).toBe("Avery Lane closed 2 deals");
    expect(dealHeadline(two, {})).toBe("2 deals posted");
    const unresolved = addDealToBatch(two, { id: "third", postedAt: now, annualPremium: 1200 });
    expect(dealHeadline(unresolved, { [agentId]: "Avery Lane" })).toBe("3 deals posted");
  });

  it.each([
    { status: "draft" }, { status: "cancelled" }, { status: "lapsed" }, { status: "unknown" },
    { source: "agent_link" }, { source: "discord" }, { source: "apex" },
    { id: "not-a-durable-id" }, { posted_at: "invalid" }, { posted_at: null },
    { posted_at: new Date(now - 101).toISOString() }, { posted_at: new Date(now + 10_000).toISOString() },
  ])("rejects drafts, imports, old rows and malformed receipts: %j", (patch) => {
    expect(readPostedDeal({ ...native, ...patch }, now - 100, now)).toBeNull();
  });

  it("accepts legacy native rows only after an explicit authorized receipt read", () => {
    const legacy = { ...native, source: "apex", posted_at: "2026-01-01T00:00:00Z", created_at: new Date(now).toISOString() };
    expect(readPostedDeal(legacy, now, now, true)?.id).toBe(id);
    expect(readPostedDeal(legacy, now, now)).toBeNull();
    expect(readPostedDeal({ ...legacy, created_at: "2026-01-01T00:00:00Z" }, now, now, true)).toBeNull();
    expect(readPostedDeal({ ...native, source: "agent_link" }, now, now, true)).toBeNull();
  });

  it("holds suppression until every presenting surface releases its lease", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDealCelebrationSuppression(listener);
    const first = suppressDealCelebrations();
    const second = suppressDealCelebrations();
    expect(areDealCelebrationsSuppressed()).toBe(true);
    first();
    first(); // an effect cleanup is safe if invoked twice
    expect(areDealCelebrationsSuppressed()).toBe(true);
    second();
    expect(areDealCelebrationsSuppressed()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("does not turn a backfill received during a long session into a live win", () => {
    expect(readPostedDeal({ ...native, posted_at: new Date(now - 100_000).toISOString() }, now - 500_000, now)).toBeNull();
  });

  it("covers draft→posted and RLS primary-key-only UPDATEs without celebrating corrections", () => {
    expect(readRealtimePostedDeal({ eventType: "UPDATE", old: { id, status: "draft" }, new: native }, now, now)?.id).toBe(id);
    expect(readRealtimePostedDeal({ eventType: "UPDATE", old: { id }, new: native }, now, now)?.id).toBe(id);
    expect(readRealtimePostedDeal({ eventType: "UPDATE", old: { id, status: "submitted" }, new: native }, now, now)).toBeNull();
    expect(readRealtimePostedDeal({ eventType: "DELETE", old: native }, now, now)).toBeNull();
  });

  it.each([undefined, null, "", "invalid", -1, Infinity, NaN])("does not invent annual premium for %s", (annual_premium) => {
    expect(readPostedDeal({ ...native, annual_premium }, now, now)?.annualPremium).toBeNull();
  });

  it("deduplicates the same durable ID and prevents an evicted older ID replay", () => {
    const ledger = new DealCelebrationLedger(now, 2);
    expect(ledger.accept({ id, postedAt: now, annualPremium: 1200 })).toBe(true);
    expect(ledger.accept({ id, postedAt: now + 1, annualPremium: 1200 })).toBe(false);
    ledger.accept({ id: "b", postedAt: now + 1, annualPremium: null });
    ledger.accept({ id: "c", postedAt: now + 2, annualPremium: null });
    expect(ledger.has(id)).toBe(false);
    expect(ledger.accept({ id, postedAt: now, annualPremium: 1200 })).toBe(false);
    expect(ledger.accept({ id: "d", postedAt: now + 3, annualPremium: null })).toBe(true);
  });

  it("aggregates actual deal counts and omits a partial money total", () => {
    const first = addDealToBatch(null, { id, postedAt: now, annualPremium: 1200 });
    const second = addDealToBatch(first, { id: "b", postedAt: now, annualPremium: 2400 });
    expect(second).toMatchObject({ count: 2, annualPremium: 3600 });
    expect(addDealToBatch(second, { id: "c", postedAt: now, annualPremium: null })).toMatchObject({ count: 3, annualPremium: null });
  });

  it("emits only the receipt ID/user and rejects replay, duplicate and draft responses", () => {
    const listener = vi.fn();
    window.addEventListener(POSTED_DEAL_RECEIPT_EVENT, listener);
    announcePostedDealReceipt("user-a", { dealId: id, status: "submitted" });
    for (const receipt of [{ dealId: id, replayed: true }, { dealId: id, status: "already_recorded" }, { dealId: id, status: "draft" }, { dealId: "invalid" }]) announcePostedDealReceipt("user-a", receipt);
    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({ userId: "user-a", dealId: id });
    window.removeEventListener(POSTED_DEAL_RECEIPT_EVENT, listener);
  });
});
