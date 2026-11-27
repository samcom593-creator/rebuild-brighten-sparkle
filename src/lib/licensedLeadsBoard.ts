/**
 * Leads for every licensed agent (MP-MORNING-LEADS, 2026-11-23): the rules behind the owner card.
 *
 * Source: owner_licensed_leads_board(). One row per active licensed agent with the reason the
 * morning grant would or would not hand them leads. The grant tops everyone eligible up to 25
 * unworked leads; this file decides what the owner is shown: the count that is covered, and the
 * people who are waiting on something only a person can supply.
 */

export const LICENSED_LEADS_QUERY_KEY = ["owner-licensed-leads-board"] as const;

export type LeadsReason =
  | "ready"
  | "has_leads"
  | "license_state_unknown"
  | "not_interviewed_yet"
  | "no_login"
  | "suspended"
  | "login_banned";

export interface LicensedLeadsRow {
  agent_id: string;
  name: string;
  phone: string | null;
  phone_state_hint: string | null;
  last_sign_in_at: string | null;
  license_states: string[] | null;
  state_source: string | null;
  new_leads: number;
  live_leads: number;
  reason: LeadsReason | string;
}

/** One slice of the hourly refill (MP-LEAD-BLEND): where it draws from and its share of a pack. */
export interface RefillSlice {
  source: string;
  tiers: string[];
  share: number;
  label?: string;
}

export interface LicensedLeadsPayload {
  enabled: boolean;
  rows: LicensedLeadsRow[];
  /** The mix every refill draws from, strongest pool first. Older payloads omit it. */
  blend?: RefillSlice[] | null;
  /** Automatic batches untouched this many days go back to the pool. */
  recycle_days?: number | null;
  /** Leads recycled back to the pool in the last 7 days. */
  recycled_7d?: number | null;
}

const SLICE_LABEL: Record<string, string> = {
  "marketing:A,B": "Marketing A/B",
  "marketing:A": "Marketing A",
  "marketing:B": "Marketing B",
  "marketing:C": "Marketing C",
  "dialer:F": "Dialer fresh (never called)",
  "dialer:C": "Dialer lightly dialed",
  "dialer:C,D": "Dialer already dialed",
};

export function sliceLabel(slice: RefillSlice): string {
  if (slice.label) return slice.label;
  const key = `${slice.source}:${[...slice.tiers].sort().join(",")}`;
  return SLICE_LABEL[key] ?? `${slice.source} ${slice.tiers.join("/")}`;
}

/**
 * The one sentence under the card title. Sam (2026-11-27): every hourly assignment must draw from
 * more than one lead pool so the brand-new leads are not ripped out and exhausted; leads that sit
 * untouched go back. The sentence states the mix the database actually uses, never a hardcoded copy
 * of it, so a change to the setting shows up here without a deploy.
 */
export function refillSentence(payload: Pick<LicensedLeadsPayload, "blend" | "recycle_days"> | null | undefined): string {
  const slices = (payload?.blend ?? []).filter((s) => s && s.share > 0);
  const head = "Everyone eligible is kept at 25 unworked leads matched to their state, refilled hourly through the day.";
  if (slices.length === 0) return head;
  const mix = slices.map((s) => `${Math.round(s.share * 100)}% ${sliceLabel(s)}`).join(", ");
  const recycle = payload?.recycle_days && payload.recycle_days > 0
    ? ` Leads untouched for ${payload.recycle_days} day${payload.recycle_days === 1 ? "" : "s"} go back to the pool.`
    : "";
  return `${head} Each refill mixes the pools: ${mix}.${recycle}`;
}

/** What a save on the owner's list reports back about that person's leads. */
export interface LeadsReply {
  decision?: string;
  leads?: number;
  reason?: string;
}

/** The sentence added to a save's confirmation. Empty when the save did not touch leads. */
export function leadsReplyLine(reply: LeadsReply | null | undefined): string {
  if (!reply || !reply.decision) return "";
  if (reply.decision === "granted") return ` ${reply.leads ?? 0} leads are in their My Leads now.`;
  if (reply.decision === "error") return " The leads did not grant; the next hourly run will retry.";
  switch (reply.reason) {
    case "has_leads":
      return " They already hold leads.";
    case "not_interviewed_yet":
      return " No leads until they are marked interviewed.";
    case "license_state_unknown":
      return " No leads until a license state is on file.";
    case "no_login":
      return " No leads: they have no portal login.";
    default:
      return reply.reason && reply.reason.startsWith("only ") ? ` No leads granted: ${reply.reason}.` : "";
  }
}

/** Reasons only a person can clear. Everything else is either covered or deliberately off. */
const WAITING: readonly string[] = ["license_state_unknown", "not_interviewed_yet", "no_login"];

export function isWaiting(row: Pick<LicensedLeadsRow, "reason">): boolean {
  return WAITING.includes(row.reason);
}

/** Holds unworked leads now, or the next run hands them some. */
export function isCovered(row: Pick<LicensedLeadsRow, "reason" | "new_leads">): boolean {
  return row.new_leads > 0 || row.reason === "ready" || row.reason === "has_leads";
}

export function waitingLabel(reason: string): string {
  switch (reason) {
    case "license_state_unknown":
      return "No license state on file";
    case "not_interviewed_yet":
      return "Not interviewed yet";
    case "no_login":
      return "No portal login";
    default:
      return "Waiting";
  }
}

export interface LicensedLeadsSummary {
  total: number;
  covered: number;
  waiting: number;
  accessOff: number;
  needState: number;
  needInterview: number;
}

export function summarizeBoard(rows: readonly LicensedLeadsRow[]): LicensedLeadsSummary {
  const s: LicensedLeadsSummary = { total: rows.length, covered: 0, waiting: 0, accessOff: 0, needState: 0, needInterview: 0 };
  for (const r of rows) {
    if (r.reason === "suspended" || r.reason === "login_banned") s.accessOff += 1;
    else if (isWaiting(r)) {
      s.waiting += 1;
      if (r.reason === "license_state_unknown") s.needState += 1;
      if (r.reason === "not_interviewed_yet") s.needInterview += 1;
    } else if (isCovered(r)) s.covered += 1;
  }
  return s;
}

/**
 * The people to act on, in the order worth calling: whoever signed in most recently first,
 * because a person using the portal this week turns a saved state into dials today.
 */
export function waitingRows(rows: readonly LicensedLeadsRow[]): LicensedLeadsRow[] {
  const at = (r: LicensedLeadsRow) => (r.last_sign_in_at ? new Date(r.last_sign_in_at).getTime() : 0);
  return rows.filter(isWaiting).sort((a, b) => at(b) - at(a) || a.name.localeCompare(b.name));
}
