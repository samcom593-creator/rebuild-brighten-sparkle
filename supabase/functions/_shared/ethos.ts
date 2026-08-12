// Ethos Agents-sheet contract.
//
// Pure functions only — no network, no Deno globals — so the dispatcher and the
// vitest suite share ONE implementation. A test that reimplements the mapping it
// is checking proves nothing about the code that touches the live sheet.
//
// THE COLUMN CONTRACT IS MEASURED, NOT ASSUMED. It comes from the verified
// export in ~/Downloads:
//
//   ETHOS-agents-paste-A-to-I.tsv   188 rows, headerless, columns A..I
//   ETHOS-comments-col-S.tsv        188 rows, the Comments column, column S
//
// So the sheet's writable contract is A..I plus S — NOT a contiguous block.
// Columns J..R exist in the live sheet and are none of our business; a blanket
// row write across A..L would silently overwrite three of them. Every write
// here is therefore two targeted ranges, never one row-shaped blob.
//
// There is no "Life Licensed" and no "E&O" column anywhere in the verified
// export. Earlier notes claimed both. They are not written, not read, and not
// invented.

export type EthosIntake = {
  first_name: string;
  last_name: string;
  email: string;
  phone_e164: string;
  npn: string;
};

export type EthosConfig = {
  sheet_id: string;
  tab: string;
  direct_upline_npn: string;
  advance_pay_tier: string;
  sub_agency_name: string;
  comment_prefix: string;
};

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
 * Comp Level (column G) is returned EMPTY, always, matching every one of the
 * 188 verified rows. It is negotiated, not derivable from a five-field intake,
 * and a guessed level has real money consequences. A blank a human fills in
 * from authoritative evidence is safe; a plausible number is not.
 */
export function buildEthosAiRow(intake: EthosIntake, config: EthosConfig): string[] {
  const row = new Array<string>(ETHOS_AI_COLUMNS.length).fill("");
  row[COL_FIRST] = intake.first_name;
  row[COL_LAST] = intake.last_name;
  row[COL_NPN] = intake.npn;
  row[COL_UPLINE] = config.direct_upline_npn;
  row[COL_PHONE] = formatUsPhoneForSheet(intake.phone_e164);
  row[COL_EMAIL] = intake.email;
  row[COL_COMP_LEVEL] = "";
  row[COL_ADVANCE] = config.advance_pay_tier;
  row[COL_SUBAGENCY] = config.sub_agency_name;
  return row;
}

/** The Comments cell (column S), carrying the APEX intake id for traceability. */
export function buildEthosComment(config: EthosConfig, intakeId: string): string {
  return `${config.comment_prefix} · APEX Intake ${intakeId}`;
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

/** Parse the row number back out of a Google updatedRange receipt. */
export function rowNumberFromRange(range: string): number | null {
  const m = /![A-Z]+(\d+)/.exec(range ?? "");
  return m ? Number(m[1]) : null;
}
