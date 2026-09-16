// Ethos Agents-sheet contract.
//
// Pure functions only — no network, no Deno globals — so the dispatcher and the
// vitest suite share ONE implementation. A test that reimplements the mapping it
// is checking proves nothing about the code that touches the live sheet.
//
// The live sheet was re-measured on 2026-08-25. A..I is identity/comp,
// K=Life Licensed, L=$1M E&O, and S=Comments. J and M..R belong to other
// workflows, so writes remain targeted ranges instead of a destructive row.

export type EthosIntake = {
  first_name: string;
  last_name: string;
  email: string;
  phone_e164: string;
  npn: string;
  comp_percentage?: number | string | null;
  license_status?: string | null;
  license_states?: string[] | null;
  eo_certificate_url?: string | null;
  eo_expires_at?: string | null;
  eo_per_claim_limit?: number | string | null;
  eo_aggregate_limit?: number | string | null;
  eft_ready?: boolean | null;
  contracting_contact_name?: string | null;
};

export type EthosConfig = {
  sheet_id: string;
  tab: string;
  direct_upline_npn: string;
  advance_pay_tier: string;
  sub_agency_name: string;
  comment_prefix: string;
  /**
   * People who must appear on EVERY row's Comments cell so the shared-document
   * owners see each intake. Written as their real, resolvable Google addresses
   * (level8financial@gmail.com, apalejohnray@gmail.com) rather than the label
   * "@Level 8 Financial", which resolves to nobody. A bare address is what
   * Sheets turns into a person chip; a display name is not. Absent → the
   * verified default pair below.
   */
  notify_emails?: string;
};

/**
 * The Comments-cell notify list, as resolvable addresses.
 *
 * Sam's complaint was that "@Level 8 Financial" never actually tagged anyone —
 * a display-name string is inert. The two accounts that co-own/edit the sheet
 * are level8financial@gmail.com (owner) and apalejohnray@gmail.com (John Ray,
 * writer), so those are what a row must carry to name a real person. A push
 * NOTIFICATION to them rides the private contracting Discord, which already
 * @mentions; the sheet cell carries the addresses for reference and chip
 * resolution.
 */
export const ETHOS_DEFAULT_NOTIFY = "level8financial@gmail.com apalejohnray@gmail.com";

/** A Comp Level cell already carrying a real Ethos level, e.g. "Level 15". */
const ETHOS_LEVEL_RE = /^\s*level\s+\d{1,2}\s*$/i;

/**
 * Map an APEX contract percentage to an Ethos contract LEVEL string.
 *
 * The Ethos "Comp Level" column holds a LEVEL ("Level 12"), never an APEX
 * percentage ("60") — the two are different vocabularies, and writing the raw
 * percentage into a carrier-facing column was the bug Sam flagged. The anchor
 * Sam gave is the base: a standard agent is 60% = **Level 12**. The elevated
 * tiers follow the sheet's own data points (Aisha 75% = Level 15, An Ha = Level
 * 17), i.e. one level per five points above the base, clamped to the grid's
 * Level 12..27. A blank or non-numeric comp defaults to Level 12, never a guess
 * upward. This is only ever used to FILL an empty or raw-number cell; an
 * existing "Level N" set by John Ray/Ethos is preserved untouched.
 */
export function ethosLevelForPct(pct: number | string | null | undefined): string {
  const n = Number(pct);
  if (!Number.isFinite(n)) return "Level 12";
  const level = Math.min(27, Math.max(12, 12 + Math.round((n - 60) / 5)));
  return `Level ${level}`;
}

/** Columns A..I, in sheet order, exactly as the verified paste file holds them. */
export const ETHOS_AI_COLUMNS = [
  "Agent First Name",
  "Agent Last Name",
  "Agent NPN",
  "Direct Upline NPN",
  "Agent Mobile Number",
  "Agent Email",
  "Comp Level",
  "Advance Pay Tier",
  "Sub-Agency Name",
] as const;

/** Zero-based positions inside an A..I row. */
export const COL_FIRST = 0;
export const COL_LAST = 1;
export const COL_NPN = 2;
export const COL_UPLINE = 3;
export const COL_PHONE = 4;
export const COL_EMAIL = 5;
export const COL_COMP_LEVEL = 6;
export const COL_ADVANCE = 7;
export const COL_SUBAGENCY = 8;

/** Comments lives at column S, nine columns clear of the A..I block. */
export const COMMENTS_COLUMN = "S";

export function formatUsPhoneForSheet(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164 ?? "");
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : (e164 ?? "");
}

export function normalizeNpnForCompare(value: unknown): string {
  return String(value ?? "").replace(/[^0-9]/g, "");
}

export function normalizeEmailForCompare(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

/**
 * Compare phone numbers on their last ten digits.
 *
 * We store E.164 (+16025550143, eleven digits) and the sheet holds the national
 * format its human readers use ((608) 201-7833, ten digits). Comparing raw
 * digit strings makes those unequal, so a correct write would fail its own
 * read-back, throw, retry and dead-letter — the Ethos destination would have
 * been broken the day a credential was installed, and the error would have
 * blamed the sheet rather than this function.
 */
export function normalizePhoneForCompare(value: unknown): string {
  return String(value ?? "").replace(/[^0-9]/g, "").slice(-10);
}

/**
 * Build the A..I values for a producer.
 *
 * The Comp Level column (G) holds an Ethos LEVEL, never the APEX percentage.
 * `existingCompLevel` is the value already in that cell on an update-in-place: a
 * real "Level N" set by John Ray or Ethos is authoritative and preserved, so a
 * routine re-delivery cannot silently demote an elevated producer back to the
 * base level. A blank cell, or one still carrying the old raw percentage, is
 * (re)written from the APEX comp via `ethosLevelForPct`, which defaults to
 * Level 12 rather than guessing upward.
 */
export function buildEthosAiRow(
  intake: EthosIntake,
  config: EthosConfig,
  existingCompLevel?: string | null,
): string[] {
  const row = new Array<string>(ETHOS_AI_COLUMNS.length).fill("");
  row[COL_FIRST] = intake.first_name;
  row[COL_LAST] = intake.last_name;
  row[COL_NPN] = intake.npn;
  row[COL_UPLINE] = config.direct_upline_npn;
  row[COL_PHONE] = formatUsPhoneForSheet(intake.phone_e164);
  row[COL_EMAIL] = intake.email;
  row[COL_COMP_LEVEL] = ETHOS_LEVEL_RE.test(existingCompLevel ?? "")
    ? String(existingCompLevel).trim()
    : ethosLevelForPct(intake.comp_percentage);
  row[COL_ADVANCE] = config.advance_pay_tier;
  row[COL_SUBAGENCY] = config.sub_agency_name;
  return row;
}

/**
 * The Comments cell (column S), carrying the APEX intake id for traceability
 * and — on EVERY row — the shared-document owners as resolvable addresses so
 * they are actually named rather than labelled. The addresses come last so a
 * reader scanning the column sees the same "who to notify" pair on each row.
 */
export function buildEthosComment(config: EthosConfig, value: (EthosIntake & { id?: string }) | string): string {
  const intake = typeof value === "string" ? { id: value } : value;
  const parts = [`${config.comment_prefix} · APEX Intake ${intake.id ?? "—"}`];
  if ("eo_certificate_url" in intake && intake.eo_certificate_url) parts.push(`E&O: ${intake.eo_certificate_url}`);
  if ("eo_expires_at" in intake && intake.eo_expires_at) parts.push(`expires ${intake.eo_expires_at}`);
  if ("contracting_contact_name" in intake && intake.contracting_contact_name) parts.push(`contact: ${intake.contracting_contact_name}`);
  if ("eft_ready" in intake && intake.eft_ready !== null && intake.eft_ready !== undefined) parts.push(`EFT ${intake.eft_ready ? "ready" : "pending"}`);
  parts.push(`cc ${(config.notify_emails ?? ETHOS_DEFAULT_NOTIFY).trim()}`);
  return parts.join(" · ");
}

export function buildEthosKlRow(intake: EthosIntake): boolean[] {
  const licensed = (intake.license_status ?? "").toLowerCase() === "licensed";
  const expiryValue = intake.eo_expires_at ?? "";
  const expiry = expiryValue
    ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(expiryValue) ? `${expiryValue}T00:00:00Z` : expiryValue).getTime()
    : 0;
  const current = Boolean(intake.eo_certificate_url) && expiry >= Date.now();
  const covered = Number(intake.eo_per_claim_limit ?? 0) >= 1_000_000
    && Number(intake.eo_aggregate_limit ?? 0) >= 1_000_000;
  return [licensed, current && covered];
}

/**
 * Decide whether row 1 is a header or already data.
 *
 * The verified paste file is headerless, but the live sheet may carry a header
 * that was added separately. Getting this wrong by one row would either skip a
 * real producer or overwrite the header, so it is measured rather than assumed:
 * a data row has an all-digit NPN in column C, a header row does not.
 */
export function detectDataStartRow(firstRow: string[] | undefined): number {
  const npnCell = String(firstRow?.[COL_NPN] ?? "").trim();
  const looksLikeData = npnCell !== "" && /^[0-9\s()+.-]+$/.test(npnCell) && /[0-9]/.test(npnCell);
  return looksLikeData ? 1 : 2;
}

export type EthosMatch =
  | { action: "update"; rowNumber: number }
  | { action: "append" }
  | { action: "manual_review"; reason: string; rowNumber: number };

/**
 * Decide what to do with an intake against the sheet's current contents.
 *
 * Order is deliberate and is the whole safety argument:
 *
 *   1. NPN is identity. An NPN match is the SAME producer, so update in place.
 *   2. An email match under a DIFFERENT NPN is ambiguous — a shared household
 *      address, or a mistyped NPN. A machine cannot tell, so it goes to review.
 *      It must never overwrite the existing row and must never append a second
 *      one, because both outcomes are wrong under one of the two readings.
 *   3. Only a producer that matches nothing may be appended.
 *
 * `rows` is the full A..I range including row 1. Returned rowNumber is 1-based
 * sheet coordinates.
 */
export function matchEthosRow(rows: string[][], intake: EthosIntake): EthosMatch {
  const wantNpn = normalizeNpnForCompare(intake.npn);
  const wantEmail = normalizeEmailForCompare(intake.email);
  if (!wantNpn) return { action: "manual_review", reason: "intake_npn_missing", rowNumber: 0 };

  const start = detectDataStartRow(rows[0]);
  let emailHit = -1;

  for (let i = start - 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    if (normalizeNpnForCompare(row[COL_NPN]) === wantNpn) {
      return { action: "update", rowNumber: i + 1 };
    }
    if (wantEmail && normalizeEmailForCompare(row[COL_EMAIL]) === wantEmail && emailHit === -1) {
      emailHit = i;
    }
  }

  if (emailHit !== -1) {
    return { action: "manual_review", reason: "email_matches_a_different_npn", rowNumber: emailHit + 1 };
  }
  return { action: "append" };
}

// Both arms carry `mismatches` (undefined on success) because this project's
// tsconfig does not narrow a boolean discriminant.
export type ReadBackResult =
  | { ok: true; mismatches?: undefined }
  | { ok: false; mismatches: string[] };

/**
 * Confirm the sheet now holds what we meant to write.
 *
 * A Google API 2xx means Google accepted the request, not that the intended
 * producer is now in the intended row — a wrong range, a shifted column or a
 * concurrent edit all return 200. Reporting success on the status code alone is
 * the same defect as the 465 sync rows that logged success while receiving a
 * login page. NPN, email and phone are the three fields a carrier uses to find
 * the producer, so all three must match or the write is not a success.
 */
export function verifyReadBack(written: string[], intake: EthosIntake): ReadBackResult {
  const mismatches: string[] = [];
  if (normalizeNpnForCompare(written[COL_NPN]) !== normalizeNpnForCompare(intake.npn)) {
    mismatches.push("Agent NPN");
  }
  if (normalizeEmailForCompare(written[COL_EMAIL]) !== normalizeEmailForCompare(intake.email)) {
    mismatches.push("Agent Email");
  }
  if (normalizePhoneForCompare(written[COL_PHONE]) !== normalizePhoneForCompare(intake.phone_e164)) {
    mismatches.push("Agent Mobile Number");
  }
  return mismatches.length === 0 ? { ok: true } : { ok: false, mismatches };
}

/** A1-notation range for one producer's A..I cells. */
export function aiRangeForRow(tab: string, rowNumber: number): string {
  return `${tab}!A${rowNumber}:I${rowNumber}`;
}

/** A1-notation range for one producer's Comments cell. */
export function commentRangeForRow(tab: string, rowNumber: number): string {
  return `${tab}!${COMMENTS_COLUMN}${rowNumber}:${COMMENTS_COLUMN}${rowNumber}`;
}

export function klRangeForRow(tab: string, rowNumber: number): string {
  return `${tab}!K${rowNumber}:L${rowNumber}`;
}

/** Parse the row number back out of a Google updatedRange receipt. */
export function rowNumberFromRange(range: string): number | null {
  const m = /![A-Z]+(\d+)/.exec(range ?? "");
  return m ? Number(m[1]) : null;
}
