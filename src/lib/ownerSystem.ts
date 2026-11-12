/**
 * Owner System page rules (MP-302 part 8). Pure.
 *
 * A subscription's cost and renewal date are whatever someone recorded, or "not recorded":
 * a blank is never shown as $0 and never filled in from anything else.
 */
import type { Tone } from "@/lib/tones";

export type SubscriptionStatus = "active" | "canceled" | "needs_review";

export interface Subscription {
  id: string;
  service: string;
  purpose: string | null;
  plan: string | null;
  cost_cents: number | null;
  billing_frequency: string | null;
  currency: string;
  renewal_date: string | null;
  account_owner: string | null;
  billing_url: string | null;
  status: SubscriptionStatus;
  source: string;
  last_verified: string | null;
  notes: string | null;
}

export interface SubscriptionDraft {
  id?: string;
  service: string; purpose: string; plan: string; cost: string; billing_frequency: string; currency: string; renewal_date: string;
  account_owner: string; billing_url: string; status: string; source: string; last_verified: string; notes: string;
}

export const STATUS_LABEL: Record<SubscriptionStatus, string> = { active: "Active", canceled: "Canceled", needs_review: "Needs review" };
export const STATUS_TONE: Record<SubscriptionStatus, Tone> = { active: "good", canceled: "slate", needs_review: "warm" };

const FREQUENCY_WORD: Record<string, string> = { monthly: "a month", yearly: "a year", weekly: "a week", quarterly: "a quarter", usage: "by usage", one_time: "one time" };

export function formatCost(cents: number | null | undefined, currency = "USD", frequency?: string | null): string {
  if (cents === null || cents === undefined) return "Cost not recorded";
  let amount: string;
  try { amount = new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100); }
  catch { amount = `${(cents / 100).toFixed(2)} ${currency}`; }
  const word = frequency ? FREQUENCY_WORD[frequency] : null;
  return word ? `${amount} ${word}` : amount;
}

export function emptyDraft(row?: Subscription): SubscriptionDraft {
  return {
    id: row?.id,
    service: row?.service ?? "", purpose: row?.purpose ?? "", plan: row?.plan ?? "",
    cost: row?.cost_cents != null ? (row.cost_cents / 100).toFixed(2) : "",
    billing_frequency: row?.billing_frequency ?? "", currency: row?.currency ?? "USD", renewal_date: row?.renewal_date ?? "",
    account_owner: row?.account_owner ?? "", billing_url: row?.billing_url ?? "", status: row?.status ?? "active",
    source: row?.source ?? "entered by hand", last_verified: row?.last_verified ?? "", notes: row?.notes ?? "",
  };
}

const DAY_RX = /^\d{4}-\d{2}-\d{2}$/;
const blank = (s: string) => (s.trim() === "" ? null : s.trim());

/** The row to write, or the reason it cannot be written. A blank stays null. */
export function validateSubscription(d: SubscriptionDraft): { ok: true; row: Record<string, unknown> } | { ok: false; error: string } {
  if (!d.service.trim()) return { ok: false, error: "Name the service." };
  let cost_cents: number | null = null;
  if (d.cost.trim() !== "") {
    const n = Number(d.cost.replace(/[$,\s]/g, ""));
    if (!Number.isFinite(n) || n < 0) return { ok: false, error: "Cost must be a number, or blank if it is not known." };
    cost_cents = Math.round(n * 100);
  }
  for (const [label, value] of [["Renewal date", d.renewal_date], ["Last verified", d.last_verified]] as const) {
    if (value.trim() !== "" && !DAY_RX.test(value.trim())) return { ok: false, error: `${label} must be a date.` };
  }
  if (d.billing_url.trim() !== "" && !/^https:\/\/\S+$/.test(d.billing_url.trim())) return { ok: false, error: "The billing link must start with https://" };
  if (!["active", "canceled", "needs_review"].includes(d.status)) return { ok: false, error: "Pick a status." };
  if (!d.source.trim()) return { ok: false, error: "Say where this information came from." };
  return {
    ok: true,
    row: {
      service: d.service.trim(), purpose: blank(d.purpose), plan: blank(d.plan), cost_cents,
      billing_frequency: blank(d.billing_frequency), currency: (d.currency.trim() || "USD").toUpperCase(), renewal_date: blank(d.renewal_date),
      account_owner: blank(d.account_owner), billing_url: blank(d.billing_url), status: d.status, source: d.source.trim(),
      last_verified: blank(d.last_verified), notes: blank(d.notes),
    },
  };
}

export interface Integration {
  group: string; service: string; last_success: string | null; health: string; detail: string; affects: string | null; recovery: string | null;
}

export const HEALTH_LABEL: Record<string, string> = {
  ok: "Working", failing: "Not working", paused: "Paused on purpose", retired: "Retired", idle: "Nothing to carry", not_connected: "Not connected", unknown: "Not checked here",
};
export const HEALTH_TONE: Record<string, Tone> = {
  ok: "good", failing: "hot", paused: "slate", retired: "slate", idle: "slate", not_connected: "warm", unknown: "slate",
};

const HEALTH_ORDER = ["failing", "not_connected", "unknown", "paused", "idle", "ok", "retired"];

/** Groups in a fixed order, each with what needs a look first. */
export function groupIntegrations(items: readonly Integration[]): Array<{ group: string; items: Integration[] }> {
  const groups = new Map<string, Integration[]>();
  for (const item of items) groups.set(item.group, [...(groups.get(item.group) ?? []), item]);
  const rank = (h: string) => { const i = HEALTH_ORDER.indexOf(h); return i === -1 ? HEALTH_ORDER.length : i; };
  return [...groups.entries()]
    .map(([group, list]) => ({ group, items: [...list].sort((a, b) => rank(a.health) - rank(b.health) || a.service.localeCompare(b.service)) }))
    .sort((a, b) => Math.min(...a.items.map((i) => rank(i.health))) - Math.min(...b.items.map((i) => rank(i.health))) || a.group.localeCompare(b.group));
}

export interface Obligations {
  failed_jobs_24h: Array<{ job: string; failures: number; last: string; message: string | null }>;
  critical_alerts_24h: Array<{ subject: string | null; at: string; link: string | null }>;
  open_blockers: Array<{ title: string; fix: string | null }>;
  renewals_30d: Array<{ service: string; renewal_date: string; cost_cents: number | null; currency: string }>;
  subscriptions_to_review: number;
}

export function obligationCount(o: Obligations): number {
  return o.failed_jobs_24h.length + o.critical_alerts_24h.length + o.open_blockers.length + o.renewals_30d.length + (o.subscriptions_to_review > 0 ? 1 : 0);
}
