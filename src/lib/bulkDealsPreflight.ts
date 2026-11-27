/**
 * bulkDealsPreflight.ts: the client-side twin of the database's deal coverage
 * guard (trigger zz_deal_coverage_review_guard on public.deals, function
 * public.enforce_deal_coverage_review, migration 20261127050000, live since
 * 2026-11-26).
 *
 * The guard refuses any authenticated insert into public.deals that lacks a
 * carrier, an insured first AND last name, a date of birth before today, or a
 * phone that normalises to at least 10 digits. The Bulk Deal Import paste format
 * (client / carrier / product / policy line / agent) carries neither a DOB nor a
 * phone. Until this wave the page filled both with the sentinels '' and
 * 1900-01-01, so once the guard went live every pasted row was refused AFTER the
 * click, one generic message per row. This module lets the page say, per row and
 * before any request is sent, exactly what the guard will say.
 *
 * normalizeCoveragePhone mirrors public.deal_coverage_phone (digits only, a
 * leading country code 1 dropped from an 11-digit number) and
 * normalizeCoverageName mirrors public.deal_coverage_name (lower-cased, inner
 * whitespace collapsed). If the SQL changes, this file is what drifts, so
 * src/tests/lib/bulkDealsPreflight.test.ts pins the SQL fragments it mirrors.
 *
 * One rule here is stricter than the database on purpose: a DOB more than
 * MAX_INSURED_AGE_YEARS in the past is reported as a placeholder. 1900-01-01
 * satisfies the guard's `client_dob < current_date` test, which is how 114 rows
 * came to carry it; no living insured was born in 1900.
 */

export const COVERAGE_PHONE_MIN_DIGITS = 10;
export const MAX_INSURED_AGE_YEARS = 125;

/** Mirror of public.deal_coverage_phone(text). */
export function normalizeCoveragePhone(raw: string | null | undefined): string {
  const digits = (raw ?? "").replace(/[^0-9]/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

/** Mirror of public.deal_coverage_name(first, last). */
export function normalizeCoverageName(first: string | null | undefined, last: string | null | undefined): string {
  return `${first ?? ""} ${last ?? ""}`.trim().replace(/\s+/g, " ").toLowerCase();
}

/** The paste carries one "client" line; the first word is the first name, the rest the last name. */
export function splitClientName(client: string): { first: string; last: string } {
  const trimmed = client.trim().replace(/\s+/g, " ");
  const firstSpace = trimmed.indexOf(" ");
  if (firstSpace <= 0) return { first: trimmed, last: "" };
  return { first: trimmed.slice(0, firstSpace), last: trimmed.slice(firstSpace + 1) };
}

export interface PreflightInput {
  client: string;
  carrier: string;
  agentName: string;
  /** Resolved from the active roster by name; null when the name matched nobody. */
  agentId: string | null;
  /** Resolved from active carriers by name; null when the name matched none. */
  carrierId: string | null;
  /** As typed in the table, yyyy-mm-dd. */
  dob: string;
  /** As typed in the table, any punctuation. */
  phone: string;
}

export type PreflightBlocker =
  | "agent_not_found"
  | "carrier_not_found"
  | "last_name_missing"
  | "dob_missing"
  | "dob_invalid"
  | "dob_not_before_today"
  | "dob_placeholder"
  | "phone_short";

export interface PreflightResult {
  ok: boolean;
  blockers: PreflightBlocker[];
  /** One plain sentence per blocker, in the order the guard evaluates them. */
  reasons: string[];
  first: string;
  last: string;
  /** What will be stored in deals.client_phone: the normalised digits. */
  normalizedPhone: string;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function localIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isRealDate(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function reasonFor(blocker: PreflightBlocker, input: PreflightInput): string {
  switch (blocker) {
    case "agent_not_found":
      return `agent "${input.agentName}" is not on the active roster`;
    case "carrier_not_found":
      return `carrier "${input.carrier}" is not an active carrier`;
    case "last_name_missing":
      return "insured needs a first and last name";
    case "dob_missing":
      return "date of birth needed";
    case "dob_invalid":
      return "date of birth is not a real date";
    case "dob_not_before_today":
      return "date of birth must be before today";
    case "dob_placeholder":
      return `date of birth is more than ${MAX_INSURED_AGE_YEARS} years ago, a placeholder not a birth date`;
    case "phone_short":
      return `phone needs ${COVERAGE_PHONE_MIN_DIGITS} digits`;
  }
}

/**
 * Grade one parsed row against the guard's rules. Pure: no network, no
 * clock beyond `today`, so the page can run it on every keystroke.
 */
export function preflightDeal(input: PreflightInput, today: Date = new Date()): PreflightResult {
  const blockers: PreflightBlocker[] = [];
  const { first, last } = splitClientName(input.client);
  const normalizedPhone = normalizeCoveragePhone(input.phone);

  if (!input.agentId) blockers.push("agent_not_found");
  if (!input.carrierId) blockers.push("carrier_not_found");
  if (!first || !last) blockers.push("last_name_missing");

  const dob = input.dob.trim();
  if (!dob) {
    blockers.push("dob_missing");
  } else {
    const m = ISO_DATE.exec(dob);
    if (!m || !isRealDate(Number(m[1]), Number(m[2]), Number(m[3]))) {
      blockers.push("dob_invalid");
    } else {
      const todayIso = localIso(today);
      const oldest = new Date(today.getFullYear() - MAX_INSURED_AGE_YEARS, today.getMonth(), today.getDate());
      if (dob >= todayIso) blockers.push("dob_not_before_today");
      else if (dob <= localIso(oldest)) blockers.push("dob_placeholder");
    }
  }

  if (normalizedPhone.length < COVERAGE_PHONE_MIN_DIGITS) blockers.push("phone_short");

  return {
    ok: blockers.length === 0,
    blockers,
    reasons: blockers.map((b) => reasonFor(b, input)),
    first,
    last,
    normalizedPhone,
  };
}
