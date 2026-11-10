// Resend suppression, mirrored into the DB so senders can skip it.
//
// PL-WIB-RESEND-SUPPRESSION (2026-10-21). Resend keeps an account suppression
// list (hard bounces, spam complaints). A send to an address on it is accepted
// by the API with an id, then never attempted: last_event = "suppressed". Our
// senders read only the API reply, so every one of those was logged as sent.
// Measured over 7d: 10 non-gateway addresses suppressed 2-7 times each, incl.
// three active agent rows, and numbers-reminder mailing one of them every day
// with numbers_reminder_delivery_log.email_status = 'sent' each time. The DB
// had no way to know: no Resend webhook is registered and nothing read
// last_event back.
//
// resend-suppression-sync writes the list into public.email_suppressions;
// sendEmail refuses an address seen there in the last RECHECK_DAYS. The window
// is what keeps this from being a permanent block: once we stop sending we stop
// learning, so after RECHECK_DAYS one send goes out, and Resend either says
// "suppressed" again (row refreshed, another RECHECK_DAYS) or delivers it (the
// sync deletes the row). One probe a month per dead address instead of one a day.
//
// A failed lookup does NOT block. This gate removes waste; it must never be
// the reason an applicant misses an onboarding email because the DB blinked.

export const RECHECK_DAYS = 30;

const DELIVERED = new Set(["delivered", "opened", "clicked"]);

export interface ResendEmailRow {
  to?: string[] | string | null;
  created_at?: string | null;
  last_event?: string | null;
  id?: string | null;
  subject?: string | null;
  from?: string | null;
}

export function recipientOf(r: ResendEmailRow): string {
  const t = r.to;
  const first = Array.isArray(t) ? (t[0] ?? "") : String(t ?? "");
  return first.trim().toLowerCase();
}

export interface SuppressionVerdict {
  /** latest send to this address in the window was suppressed by Resend */
  suppressed: Map<string, { last_event: string; resend_email_id: string | null; seen_at: string }>;
  /** latest send to this address in the window was delivered: clear any row */
  cleared: Set<string>;
}

/**
 * One verdict per recipient, from that recipient's LATEST send in the rows.
 * Only "suppressed" blocks. "bounced" alone does not: a soft bounce is not on
 * Resend's list, and a hard bounce shows up as "suppressed" on the next send.
 */
export function verdictFromRows(rows: ResendEmailRow[]): SuppressionVerdict {
  const latest = new Map<string, ResendEmailRow>();
  for (const r of rows) {
    const a = recipientOf(r);
    if (!a || !a.includes("@")) continue;
    const prev = latest.get(a);
    if (!prev || String(r.created_at ?? "") > String(prev.created_at ?? "")) latest.set(a, r);
  }
  const suppressed: SuppressionVerdict["suppressed"] = new Map();
  const cleared = new Set<string>();
  for (const [a, r] of latest) {
    const ev = String(r.last_event ?? "");
    if (ev === "suppressed") {
      suppressed.set(a, { last_event: ev, resend_email_id: r.id ?? null, seen_at: String(r.created_at ?? "") });
    } else if (DELIVERED.has(ev)) {
      cleared.add(a);
    }
  }
  return { suppressed, cleared };
}

/** PostgREST in.() list with every value double-quoted, so commas and parens in an address cannot split it. */
export function inList(emails: string[]): string {
  return "(" + emails.map((e) => '"' + e.replace(/["\\]/g, (c) => "\\" + c) + '"').join(",") + ")";
}

/**
 * The subset of `emails` that is currently suppressed, or null if the lookup
 * could not be made (no env, network error, non-2xx). Callers treat null as
 * "send": see the header.
 */
export async function lookupSuppressed(
  emails: string[],
  opts: { url?: string; key?: string; now?: Date; fetchImpl?: typeof fetch } = {},
): Promise<Set<string> | null> {
  const url = opts.url ?? Deno.env.get("SUPABASE_URL") ?? "";
  const key = opts.key ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const list = [...new Set(emails.map((e) => String(e ?? "").trim().toLowerCase()).filter(Boolean))];
  if (list.length === 0) return new Set();
  if (!url || !key) return null;
  const since = new Date((opts.now ?? new Date()).getTime() - RECHECK_DAYS * 86400_000).toISOString();
  const q = `${url}/rest/v1/email_suppressions?select=email&email=in.${encodeURIComponent(inList(list))}` +
    `&last_seen_at=gte.${encodeURIComponent(since)}`;
  try {
    const res = await (opts.fetchImpl ?? fetch)(q, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const rows = await res.json();
    if (!Array.isArray(rows)) return null;
    return new Set(rows.map((r: { email?: string }) => String(r.email ?? "").toLowerCase()));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// WP4 (2026-11-10): the email_events ledger.
//
// The rows resend-suppression-sync already pulls every hour are the ONLY
// delivery truth this system has (no Resend webhook; delivered_at is never
// written anywhere), and Resend's list forgets them after ~30 days. Each row is
// persisted as a hash of the recipient, its domain, its latest event and a
// family derived from the subject in SQL (fn_email_events_ingest). The raw
// address never leaves this function except into email_suppressions, which
// already holds raw addresses by design.
// ---------------------------------------------------------------------------

/** Plain address from "Name <a@b.c>" or "a@b.c"; lower-cased and trimmed. */
export function plainAddress(raw: unknown): string {
  const s = String(raw ?? "").trim();
  const m = s.match(/<([^<>]+)>\s*$/);
  return (m ? m[1] : s).trim().toLowerCase();
}

/**
 * sha256 of the lower-cased, trimmed address, lowercase hex. Must equal the SQL
 * side: encode(sha256(convert_to(lower(btrim(email)), 'UTF8')), 'hex').
 */
export async function recipientHash(address: string): Promise<string> {
  const bytes = new TextEncoder().encode(plainAddress(address));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface EmailEventRow {
  resend_id: string;
  last_event: string;
  recipient_hash: string;
  recipient_domain: string | null;
  subject: string | null;
  sender: string | null;
  created_at: string;
}

export interface EventBatch {
  events: EmailEventRow[];
  /** recipient_hash -> raw address, kept in memory only (for the suppression mirror) */
  addressByHash: Map<string, string>;
  /** raw address -> its latest send in this batch (created_at, resend id) */
  latestByAddress: Map<string, { created_at: string; resend_id: string | null }>;
}

/** Resend list rows -> ingest rows. Rows without an id, a recipient or a send time are skipped. */
export async function toEventRows(rows: ResendEmailRow[]): Promise<EventBatch> {
  const events: EmailEventRow[] = [];
  const addressByHash = new Map<string, string>();
  const latestByAddress = new Map<string, { created_at: string; resend_id: string | null }>();
  for (const r of rows) {
    const id = String(r.id ?? "").trim();
    const t = r.to;
    const address = plainAddress(Array.isArray(t) ? (t[0] ?? "") : t);
    const createdAt = String(r.created_at ?? "").trim();
    if (!id || !address.includes("@") || !createdAt) continue;
    const hash = await recipientHash(address);
    addressByHash.set(hash, address);
    const prev = latestByAddress.get(address);
    if (!prev || createdAt > prev.created_at) latestByAddress.set(address, { created_at: createdAt, resend_id: id });
    events.push({
      resend_id: id,
      last_event: String(r.last_event ?? "unknown").toLowerCase(),
      recipient_hash: hash,
      recipient_domain: address.split("@").pop() || null,
      subject: r.subject ?? null,
      sender: r.from ?? null,
      created_at: createdAt,
    });
  }
  return { events, addressByHash, latestByAddress };
}

/** Split into chunks of at most `size` (PostgREST body size stays small). */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
