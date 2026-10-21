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
