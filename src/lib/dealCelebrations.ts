/** Client events carry only a durable ID; the provider re-reads that row through the caller's RLS. */
export const POSTED_DEAL_RECEIPT_EVENT = "galaxy:posted-deal-receipt";
export const DEAL_FRESHNESS_MS = 90_000;
export const DEAL_BATCH_DELAY_MS = 400;
export const DEAL_CELEBRATION_GAP_MS = 6_000;
export const DEAL_CELEBRATION_DURATION_MS = 3_800;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POSTED_STATUSES = new Set(["submitted", "needs_review", "pending", "approved", "issued", "in_force", "active"]);
const suppressionListeners = new Set<() => void>();
let suppressionLeases = 0;

export function areDealCelebrationsSuppressed(): boolean { return suppressionLeases > 0; }
export function subscribeDealCelebrationSuppression(listener: () => void): () => void {
  suppressionListeners.add(listener);
  return () => { suppressionListeners.delete(listener); };
}
/** Screens that hide figures can silence the global receipt for exactly their mounted lifetime. */
export function suppressDealCelebrations(): () => void {
  suppressionLeases += 1;
  if (suppressionLeases === 1) suppressionListeners.forEach((listener) => listener());
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    suppressionLeases -= 1;
    if (suppressionLeases === 0) suppressionListeners.forEach((listener) => listener());
  };
}

export type PostedDeal = { id: string; postedAt: number; annualPremium: number | null; agentId?: string };
export type PostedDealReceipt = { dealId?: unknown; status?: unknown; replayed?: unknown };
export type LocalDealReceiptDetail = { userId: string; dealId: string };
export type DealCelebrationBatch = { key: string; count: number; annualPremium: number | null; agentCounts: Record<string, number> };

export function isDealId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function announcePostedDealReceipt(userId: string, receipt: PostedDealReceipt): void {
  if (typeof window === "undefined" || !userId || !isDealId(receipt.dealId) || receipt.replayed === true || receipt.status === "already_recorded" || receipt.status === "draft") return;
  window.dispatchEvent(new CustomEvent<LocalDealReceiptDetail>(POSTED_DEAL_RECEIPT_EVENT, { detail: { userId, dealId: receipt.dealId } }));
}

/** Only a new native post has a reliable, stable ID today. Import timestamps are not sale timestamps. */
export function readPostedDeal(value: unknown, armedAt: number, now: number, allowLegacyReceipt = false): PostedDeal | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (!isDealId(row.id) || (row.source !== "apex_native" && !(allowLegacyReceipt && row.source === "apex"))) return null;
  if (typeof row.status !== "string" || !POSTED_STATUSES.has(row.status)) return null;
  // The old direct form's posted_at is its effective date at midnight. Only
  // an explicit new-row receipt may use its real insertion time instead.
  const eventTime = allowLegacyReceipt && row.source === "apex" ? row.created_at : row.posted_at;
  if (typeof eventTime !== "string") return null;
  const postedAt = Date.parse(eventTime);
  if (!Number.isFinite(postedAt) || postedAt < armedAt || postedAt < now - DEAL_FRESHNESS_MS || postedAt > now + 5_000) return null;
  const premium = typeof row.annual_premium === "number" ? row.annual_premium : typeof row.annual_premium === "string" && row.annual_premium.trim() ? Number(row.annual_premium) : NaN;
  return {
    id: row.id, postedAt, annualPremium: Number.isFinite(premium) && premium > 0 ? premium : null,
    ...(isDealId(row.agent_id) ? { agentId: row.agent_id } : {}),
  };
}

/** A known non-draft UPDATE is a correction/status change, not a second new deal. */
export function readRealtimePostedDeal(payload: { eventType?: string; new?: unknown; old?: unknown }, armedAt: number, now: number): PostedDeal | null {
  if (payload.eventType !== "INSERT" && payload.eventType !== "UPDATE") return null;
  if (payload.eventType === "UPDATE" && payload.old && typeof payload.old === "object") {
    const previous = payload.old as Record<string, unknown>;
    if (typeof previous.status === "string" && previous.status !== "draft") return null;
  }
  // Under RLS Postgres may send only the old primary key. The immutable fresh
  // posted_at boundary plus ID ledger still handles that draft→posted event.
  return readPostedDeal(payload.new, armedAt, now);
}

/** Bounded, per-login dedupe. Eviction advances a time floor so old IDs cannot replay. */
export class DealCelebrationLedger {
  private seen = new Map<string, number>();
  private floor: number;
  constructor(readonly armedAt: number, private readonly capacity = 1_024) { this.floor = armedAt - 1; }
  has(id: string): boolean { return this.seen.has(id); }
  accept(deal: PostedDeal): boolean {
    if (this.seen.has(deal.id) || deal.postedAt <= this.floor) return false;
    this.seen.set(deal.id, deal.postedAt);
    if (this.seen.size > this.capacity) {
      const oldest = [...this.seen.entries()].sort((left, right) => left[1] - right[1])[0];
      this.floor = Math.max(this.floor, oldest[1]);
      for (const [id, time] of this.seen) if (time <= this.floor) this.seen.delete(id);
    }
    return true;
  }
}

export function addDealToBatch(batch: DealCelebrationBatch | null, deal: PostedDeal): DealCelebrationBatch {
  const agentCounts = { ...batch?.agentCounts };
  if (deal.agentId) agentCounts[deal.agentId] = (agentCounts[deal.agentId] ?? 0) + 1;
  return {
    key: deal.id,
    count: (batch?.count ?? 0) + 1,
    annualPremium: batch ? batch.annualPremium !== null && deal.annualPremium !== null ? batch.annualPremium + deal.annualPremium : null : deal.annualPremium,
    agentCounts,
  };
}

/** Only the separately authorized agent rows may supply a person's name, never deal payload text. */
export function readCelebrationAgentNames(value: unknown, agentIds: readonly string[]): Record<string, string> {
  const allowed = new Set(agentIds);
  const names: Record<string, string> = {};
  if (!Array.isArray(value)) return names;
  for (const row of value) {
    if (!row || typeof row !== "object" || !isDealId(row.id) || !allowed.has(row.id)) continue;
    const name = typeof row.display_name === "string" ? row.display_name.trim().replace(/\s+/g, " ").slice(0, 80) : "";
    if (!name || /^(agent|unknown|unassigned|n\/a|[-—])$/i.test(name)) continue;
    names[row.id] = name;
  }
  return names;
}

export function dealHeadline(batch: DealCelebrationBatch, agentNames: Record<string, string>): string {
  const entries = Object.entries(batch.agentCounts);
  if (entries.length === 1) {
    const [agentId, count] = entries[0];
    const name = agentNames[agentId];
    if (name && count === batch.count) return `${name} closed ${count === 1 ? "a deal" : `${count} deals`}`;
  }
  return batch.count === 1 ? "Deal posted" : `${batch.count} deals posted`;
}
