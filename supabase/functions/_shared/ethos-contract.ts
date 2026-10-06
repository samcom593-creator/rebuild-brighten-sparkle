// Ethos "Agent Portal Signup" sheet — contract, validation and submission gate.
//
// PURE FUNCTIONS ONLY. No network, no Deno/Node globals, no Date.now() (callers pass
// `now`). One implementation shared by the outbox dispatcher (Deno), the Contracting
// Health page (Vite), scripts/ethos-sheet-audit.ts (Node) and the vitest suite, so the
// rule that blocks a bad row in production is the SAME rule the UI shows and the audit
// counts. Erasable-TypeScript syntax only (no enums / parameter properties) so Node's
// --experimental-strip-types can load it unchanged.
//
// Operating rule (APEX/ETHOS operating guide, 2026-09-28):
//   collect -> verify -> approve -> submit once -> reconcile Ethos response.
// Being on the sheet, having an invite code and being authorized to sell are three
// different milestones; nothing here ever reports one as another.

// ── Sheet schema (verified against the live export 2026-10-03) ─────────────────

export const ETHOS_SPREADSHEET_ID = "1R5ZEjfDai0dFp1z8xbfpaFGbOAEiXzPc0F1KxnWPSMY";

/** The misspelled tab title is the real one. Do not rename it; validate the stable sheetId. */
export const SIGNUP_TAB = { title: "agwnts", sheetId: 517020732, headerRow: 1, firstDataRow: 2 } as const;
export const UPDATES_TAB = { title: "Agent Updates", sheetId: 1013052349, headerRow: 2, guidanceRow: 3, firstDataRow: 4 } as const;

export const SIGNUP_HEADERS = [
  "Agent First Name",
  "Agent Last Name",
  "Agent NPN",
  "Direct Upline NPN",
  "Agent Mobile Number",
  "Agent Email",
  "Comp Level",
  "Advance Pay Tier",
  "Sub-Agency Name",
  "Sub-Agent Head?",
  "Life Licensed?",
  "$1M in E&O coverage?",
  "Portal Created (Completed by Ethos)",
  "Date Portal Created / Date Reparenting Completed",
  "Ethos Partner ID",
  "Ethos Partner Code",
  "https://agents.ethoslife.com/invite/",
  "Ethos Partnership Ops Notes",
  "Comments",
] as const;

/** A:L is the agency-input block — the ONLY columns automation may ever write. M:S belong to Ethos. */
export const SIGNUP_AGENCY_COLUMNS = 12;

export const UPDATES_HEADERS = [
  "Agent First Name",
  "Agent Last Name",
  "Agent NPN",
  "Direct Upline's NPN",
  "Comp Level",
  "Advanced Payments",
  "PII Information",
  "Termination",
  "Information submitted Date",
  "Update Completed (Completed by Ethos)",
  "Update Processed Date",
  "Ethos Notes",
] as const;

/** A:H is the agency-input block of Agent Updates; I is automatic, J:L are Ethos-owned. */
export const UPDATES_AGENCY_COLUMNS = 8;

/** Zero-based column positions on the signup tab. */
export const S = {
  FIRST: 0, LAST: 1, NPN: 2, UPLINE: 3, MOBILE: 4, EMAIL: 5, LEVEL: 6, ADVANCE: 7, SUBAGENCY: 8,
  HEAD: 9, LICENSED: 10, EO: 11, PORTAL: 12, PORTAL_DATE: 13, PARTNER_ID: 14, PARTNER_CODE: 15,
  INVITE: 16, OPS_NOTES: 17, COMMENTS: 18,
} as const;

/** Zero-based column positions on the Agent Updates tab. */
export const U = {
  FIRST: 0, LAST: 1, NPN: 2, UPLINE: 3, LEVEL: 4, ADVANCE: 5, PII: 6, TERMINATION: 7,
  SUBMITTED: 8, COMPLETED: 9, PROCESSED: 10, NOTES: 11,
} as const;

/**
 * Compensation Grid!A9:A36 as exported 2026-10-03 ("Comp grid as of 7/8/26"). Labels only —
 * rates differ by product and age band and are never derived here. Callers that have read
 * the live grid pass its labels so a grid revision cannot be masked by this snapshot.
 */
export const ETHOS_COMP_GRID_VERSION = "Comp grid as of 7/8/26";
export const ETHOS_COMP_LEVELS = [
  "Level 27", "Level 26", "Level 25", "Level 24", "Level 23", "Level 22", "Level 21", "Level 20",
  "Level 19", "Level 18", "Level 17", "Level 16", "Level 15", "Level 14", "Level 13", "Level 12",
  "Level 11", "Level 10", "Level 09", "Level 08", "Level 07", "Level 06", "Level 05", "Level 04",
  "Level 03", "Level 02", "Level 01", "Level 00 (LOA)",
] as const;

export const ADVANCE_TIERS = ["As Earned", "6 Month Advance", "9 Month Advance"] as const;
export const INVITE_BASE = "https://agents.ethoslife.com/invite/";

export type SheetCell = string | boolean;

// ── Findings ──────────────────────────────────────────────────────────────────

export type Severity = "blocker" | "review";

export type Finding = {
  code: string;
  severity: Severity;
  /** The business field, e.g. "Agent NPN". */
  field: string;
  /** Sheet column letter when the finding maps to one, else null. */
  column: string | null;
  message: string;
  /** The human action that clears it. Never "auto-fix". */
  resolution: string;
};

function finding(code: string, severity: Severity, field: string, column: string | null, message: string, resolution: string): Finding {
  return { code, severity, field, column, message, resolution };
}

export function columnLetter(index: number): string {
  let n = index;
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

// ── Normalizers (comparison keys only — identity values are never rewritten) ──

/** Outer whitespace incl. NBSP. Interior spacing, apostrophes and hyphens are preserved. */
export function trimOuter(value: unknown): string {
  return String(value ?? "").replace(/^[\s ]+|[\s ]+$/g, "");
}

export function digitsOnly(value: unknown): string {
  return String(value ?? "").replace(/[^0-9]/g, "");
}

function normalizeHeader(value: unknown): string {
  return trimOuter(value).replace(/\s+/g, " ").toLowerCase();
}

/**
 * Pasted into Sheets, a leading = + - @ is parsed as a formula and a tab/newline splits the
 * row. Values are written RAW through the API, but the same payload feeds the paste export,
 * so a formula-looking value is refused at the gate instead of trusted to one transport.
 */
export function looksFormulaLike(value: unknown): boolean {
  const s = String(value ?? "");
  return /^[=+\-@]/.test(s) || /[\t\r\n]/.test(s);
}

/** Mask an identifier for logs and reports: keep the last three digits. */
export function maskId(value: unknown): string {
  const d = digitsOnly(value);
  if (!d) return "—";
  return d.length <= 3 ? "•".repeat(d.length) : "•".repeat(d.length - 3) + d.slice(-3);
}

const NPN_PLACEHOLDERS = new Set(["12345", "123456", "1234567", "12345678", "00000", "0000000", "123456789"]);

export type NpnClass = { digits: string | null; findings: Finding[] };

/**
 * Classify an NPN cell. A nine-digit value is a REVIEW item, not an invalidity: NIPR
 * verification decides, length never does. Placeholders and the agent's own phone number
 * are blockers because they can never be a producer's identifier.
 */
export function classifyNpn(raw: unknown, ctx: { mobileDigits?: string | null } = {}, field = "Agent NPN", column: string | null = "C"): NpnClass {
  const s = trimOuter(raw);
  const out: Finding[] = [];
  if (!s) {
    out.push(finding("npn_missing", "blocker", field, column, "No NPN on file.", "Collect the individual NPN from the agent and verify it against NIPR."));
    return { digits: null, findings: out };
  }
  if (!/^[0-9]+$/.test(s)) {
    out.push(finding("npn_not_digits", "blocker", field, column, `Value is not an ASCII digit string (${s.length} chars).`, "Re-enter the individual NPN as digits only; do not strip or reformat silently."));
    return { digits: null, findings: out };
  }
  if (/^0+$/.test(s)) {
    out.push(finding("npn_zero_placeholder", "blocker", field, column, "Zero placeholder instead of an NPN.", "Replace only with a verified individual NPN."));
    return { digits: s, findings: out };
  }
  if (NPN_PLACEHOLDERS.has(s) || /^(\d)\1+$/.test(s)) {
    out.push(finding("npn_placeholder", "blocker", field, column, "Sequential or repeated-digit placeholder.", "Collect the real individual NPN."));
    return { digits: s, findings: out };
  }
  const mobile10 = digitsOnly(ctx.mobileDigits).slice(-10);
  if (mobile10 && (s === mobile10 || s === `1${mobile10}` || (s.length >= 7 && mobile10.endsWith(s)))) {
    out.push(finding("npn_equals_phone", "blocker", field, column, "The NPN cell holds the agent's phone number.", "Collect the real individual NPN; never refill an NPN from a mobile number."));
    return { digits: s, findings: out };
  }
  if (s.length >= 9 || s.length <= 4) {
    out.push(finding("npn_unusual_length", "review", field, column, `${s.length}-digit value is outside the usual NPN length.`, "Verify against the NIPR individual record before submission; length alone proves nothing."));
  } else if (s.startsWith("0")) {
    out.push(finding("npn_leading_zero", "review", field, column, "NPN starts with 0.", "Verify against NIPR; a leading zero is unusual for an issued NPN."));
  }
  return { digits: s, findings: out };
}

export type MobileNorm =
  | { ok: true; national: string; display: string }
  | { ok: false; reason: "missing" | "unsupported_format" | "invalid_number" };

/** Supported US mobiles only; international numbers and extensions are reported, never guessed. */
export function normalizeUsMobile(raw: unknown): MobileNorm {
  const s = trimOuter(raw);
  if (!s) return { ok: false, reason: "missing" };
  if (/\bext\.?\b|\bx\s*\d/i.test(s)) return { ok: false, reason: "unsupported_format" };
  if (s.startsWith("+") && !s.startsWith("+1")) return { ok: false, reason: "unsupported_format" };
  let d = digitsOnly(s);
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  if (d.length !== 10 || !/^[2-9]/.test(d)) return { ok: false, reason: "invalid_number" };
  return { ok: true, national: d, display: `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` };
}

const SUSPICIOUS_EMAIL_DOMAINS = new Set([
  "gmai.com", "gmil.com", "gmial.com", "gamil.com", "gmal.com", "gnail.com", "gmaill.com", "gmail.co", "gmail.cm", "gmail.om",
  "yahoo.co", "yaho.com", "yahooo.com", "yhoo.com", "ymail.co",
  "hotmial.com", "hotmal.com", "hotmail.co", "outlok.com", "outloook.com",
  "iclould.com", "icloud.co", "aol.co",
]);

export type EmailNorm = { value: string | null; findings: Finding[] };

/** Lowercase + outer trim for comparison. A suspicious domain is a REVIEW item — never auto-corrected. */
export function normalizeEmail(raw: unknown, field = "Agent Email", column: string | null = "F"): EmailNorm {
  const s = trimOuter(raw).toLowerCase();
  const out: Finding[] = [];
  if (!s) {
    out.push(finding("email_missing", "blocker", field, column, "No email on file.", "Collect the agent's own reachable email."));
    return { value: null, findings: out };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) || /\.\./.test(s) || /^[.]|[.]@/.test(s)) {
    out.push(finding("email_invalid_syntax", "blocker", field, column, "Email is not syntactically valid.", "Correct the address with the agent."));
    return { value: s, findings: out };
  }
  const domain = s.slice(s.indexOf("@") + 1);
  if (SUSPICIOUS_EMAIL_DOMAINS.has(domain) || /\.(con|cmo|coom|ocm|comm|cim)$/.test(domain)) {
    out.push(finding("email_domain_suspicious", "review", field, column, `Domain "${domain}" looks like a typo.`, "Confirm the address with the agent; never silently rewrite it."));
  }
  return { value: s, findings: out };
}

export type SheetBool = boolean | "unknown";

/** Explicit boolean parsing: TRUE/FALSE strings or booleans; anything else — including blank — is unknown. */
export function parseSheetBoolean(value: unknown): SheetBool {
  if (value === true || value === false) return value;
  const s = trimOuter(value).toUpperCase();
  if (s === "TRUE") return true;
  if (s === "FALSE") return false;
  return "unknown";
}

export type LabelClass = { value: string | null; findings: Finding[] };

/** The Comp Level cell takes an exact grid label. Raw percentages and internal comp are refused. */
export function classifyCompLevel(raw: unknown, labels: readonly string[] = ETHOS_COMP_LEVELS, column: string | null = "G"): LabelClass {
  const s = trimOuter(raw);
  const out: Finding[] = [];
  if (!s) {
    out.push(finding("comp_level_missing", "blocker", "Comp Level", column, "No approved Ethos level.", "Leadership approves an exact grid level (e.g. Level 12); record approver and date."));
    return { value: null, findings: out };
  }
  if (/^\d+(\.\d+)?\s*%?$/.test(s)) {
    out.push(finding("comp_level_raw_number", "blocker", "Comp Level", column, `"${s}" is a percentage or internal comp figure, not an Ethos level.`, "Do not infer the level from a number; leadership picks the grid label."));
    return { value: null, findings: out };
  }
  if (labels.includes(s)) return { value: s, findings: out };
  const canonical = labels.find((l) => normalizeHeader(l) === normalizeHeader(s));
  if (canonical) {
    out.push(finding("comp_level_label_casing", "review", "Comp Level", column, `"${s}" differs from the grid label "${canonical}" only in spacing/case.`, "Use the exact grid label."));
    return { value: canonical, findings: out };
  }
  out.push(finding("comp_level_not_on_grid", "blocker", "Comp Level", column, `"${s}" is not a label on the compensation grid (${ETHOS_COMP_GRID_VERSION}).`, "Pick an approved label from Compensation Grid!A9:A36."));
  return { value: null, findings: out };
}

export function classifyAdvanceTier(raw: unknown, column: string | null = "H"): LabelClass {
  const s = trimOuter(raw);
  const out: Finding[] = [];
  if (!s) {
    out.push(finding("advance_tier_missing", "blocker", "Advance Pay Tier", column, "Blank — Ethos defaults a blank cell to 9 Month Advance.", "Enter the explicitly approved tier: As Earned, 6 Month Advance or 9 Month Advance."));
    return { value: null, findings: out };
  }
  if ((ADVANCE_TIERS as readonly string[]).includes(s)) return { value: s, findings: out };
  const canonical = ADVANCE_TIERS.find((t) => normalizeHeader(t) === normalizeHeader(s));
  if (canonical) {
    out.push(finding("advance_tier_label_casing", "review", "Advance Pay Tier", column, `"${s}" differs from "${canonical}" only in spacing/case.`, "Use the exact dropdown value."));
    return { value: canonical, findings: out };
  }
  out.push(finding("advance_tier_invalid", "blocker", "Advance Pay Tier", column, `"${s}" is not one of the three Ethos tiers.`, "Select As Earned, 6 Month Advance or 9 Month Advance."));
  return { value: null, findings: out };
}

export function classifySubAgency(raw: unknown, known?: readonly string[] | null, column: string | null = "I"): LabelClass {
  const s = trimOuter(raw);
  const out: Finding[] = [];
  if (!s) {
    out.push(finding("sub_agency_missing", "blocker", "Sub-Agency Name", column, "Blank — Ethos defaults a blank cell to Level 8 Financial.", "Enter the approved canonical sub-agency label."));
    return { value: null, findings: out };
  }
  if (known && known.length && !known.some((k) => normalizeHeader(k) === normalizeHeader(s))) {
    out.push(finding("sub_agency_unrecognized", "review", "Sub-Agency Name", column, `"${s}" is not a recognized sub-agency label.`, "Hierarchy approval: confirm the canonical label (a contaminated label must be corrected by a human)."));
  }
  return { value: s, findings: out };
}

// ── Header signature ──────────────────────────────────────────────────────────

export type HeaderCheck = { ok: boolean; drift: Array<{ column: string; expected: string; actual: string }> };

/** Positional header check. Extra trailing columns are tolerated; any mismatch in the expected block stops writes. */
export function verifyHeaderSignature(expected: readonly string[], actualRow: unknown[] | undefined): HeaderCheck {
  const drift: HeaderCheck["drift"] = [];
  for (let i = 0; i < expected.length; i++) {
    const actual = normalizeHeader(actualRow?.[i]);
    if (actual !== normalizeHeader(expected[i])) {
      drift.push({ column: columnLetter(i), expected: expected[i], actual: trimOuter(actualRow?.[i]) });
    }
  }
  return { ok: drift.length === 0, drift };
}

// ── Carrier-owned state (M:S) — observed, never written ──────────────────────

export type CarrierState = {
  portalCreated: SheetBool;
  reparenting: "needed" | "dated" | "blank" | "other";
  portalDateRaw: string;
  partnerId: string;
  partnerCode: string;
  inviteUnique: boolean;
  inviteRaw: string;
  opsNotes: string;
};

export function readCarrierState(row: unknown[]): CarrierState {
  const dateRaw = trimOuter(row[S.PORTAL_DATE]);
  const lower = dateRaw.toLowerCase();
  const reparenting = !dateRaw
    ? "blank"
    : lower.includes("reparent")
      ? "needed"
      : /\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2}/.test(dateRaw)
        ? "dated"
        : "other";
  const invite = trimOuter(row[S.INVITE]);
  const inviteUnique = invite.startsWith(INVITE_BASE) && invite.length > INVITE_BASE.length && !/\s/.test(invite);
  return {
    portalCreated: parseSheetBoolean(row[S.PORTAL]),
    reparenting,
    portalDateRaw: dateRaw,
    partnerId: trimOuter(row[S.PARTNER_ID]),
    partnerCode: trimOuter(row[S.PARTNER_CODE]),
    inviteUnique,
    inviteRaw: invite,
    opsNotes: trimOuter(row[S.OPS_NOTES]),
  };
}

// ── Row population ────────────────────────────────────────────────────────────

/** A row is an agent record only if identity/contact content exists in A:F. FALSE checkboxes, formulas or a lone agency label are not an agent. */
export function isPopulatedSignupRow(row: unknown[] | undefined): boolean {
  if (!row) return false;
  for (let i = S.FIRST; i <= S.EMAIL; i++) if (trimOuter(row[i])) return true;
  return false;
}

export function isPopulatedUpdateRow(row: unknown[] | undefined): boolean {
  if (!row) return false;
  for (let i = U.FIRST; i <= U.TERMINATION; i++) if (trimOuter(row[i])) return true;
  return false;
}

// ── Signup tab audit ──────────────────────────────────────────────────────────

export type Principal = { npn?: string | null; mobile?: string | null; email?: string | null };

export type RowAudit = {
  rowNumber: number;
  npn: string | null;
  npnMasked: string;
  findings: Finding[];
  carrier: CarrierState;
  duplicateGroup: string | null;
  hasBlocker: boolean;
};

export type DuplicateGroup = {
  key: string;
  keyMasked: string;
  rows: number[];
  kind: "repeat" | "conflict";
  differingColumns: string[];
};

export type SignupAuditCounts = {
  populatedRows: number;
  distinctNpn: number;
  blankOrZeroNpnRows: number;
  repeatedNpnGroups: number;
  repeatedNpnGroupsIdentical: number;
  repeatedNpnGroupsConflicting: number;
  needsReparentingRows: number;
  needsReparentingDistinctNpn: number;
  lifeUnchecked: number;
  eoUnchecked: number;
  portalCreatedRows: number;
  rowsWithBlockers: number;
  rowsReviewOnly: number;
  rowsClean: number;
};

export type SignupAudit = { header: HeaderCheck; rows: RowAudit[]; duplicates: DuplicateGroup[]; counts: SignupAuditCounts };

export type SignupAuditOptions = {
  principal?: Principal | null;
  compLevels?: readonly string[];
  knownSubAgencies?: readonly string[] | null;
};

function emptyCounts(): SignupAuditCounts {
  return {
    populatedRows: 0, distinctNpn: 0, blankOrZeroNpnRows: 0, repeatedNpnGroups: 0, repeatedNpnGroupsIdentical: 0,
    repeatedNpnGroupsConflicting: 0, needsReparentingRows: 0, needsReparentingDistinctNpn: 0, lifeUnchecked: 0,
    eoUnchecked: 0, portalCreatedRows: 0, rowsWithBlockers: 0, rowsReviewOnly: 0, rowsClean: 0,
  };
}

/**
 * Audit every populated row of the signup tab. `rows` is the whole tab including row 1.
 * Header drift stops the audit (header.ok=false, no rows) because every column index below
 * would be a guess.
 */
export function auditSignupTab(rows: unknown[][], opts: SignupAuditOptions = {}): SignupAudit {
  const header = verifyHeaderSignature(SIGNUP_HEADERS, rows[0]);
  const counts = emptyCounts();
  if (!header.ok) return { header, rows: [], duplicates: [], counts };

  const principalNpn = digitsOnly(opts.principal?.npn) || null;
  const principalMobile = normalizeUsMobile(opts.principal?.mobile);
  const principalEmail = trimOuter(opts.principal?.email).toLowerCase() || null;

  const audits: RowAudit[] = [];
  const byNpn = new Map<string, number[]>();
  const byMobile = new Map<string, Array<{ row: number; npn: string | null }>>();
  const byEmail = new Map<string, Array<{ row: number; npn: string | null }>>();
  const rowData = new Map<number, unknown[]>();

  for (let i = SIGNUP_TAB.firstDataRow - 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    if (!isPopulatedSignupRow(row)) continue;
    const rowNumber = i + 1;
    rowData.set(rowNumber, row);
    counts.populatedRows++;
    const f: Finding[] = [];

    const first = trimOuter(row[S.FIRST]);
    const last = trimOuter(row[S.LAST]);
    if (!first) f.push(finding("first_name_missing", "blocker", "Agent First Name", "A", "Blank first name.", "Enter the legal first name from the verified individual record."));
    if (!last) f.push(finding("last_name_missing", "blocker", "Agent Last Name", "B", "Blank last name.", "Enter the legal last name; no team labels or nicknames."));
    for (let c = S.FIRST; c <= S.SUBAGENCY; c++) {
      if (looksFormulaLike(trimOuter(row[c]))) {
        f.push(finding("formula_like_value", "blocker", SIGNUP_HEADERS[c], columnLetter(c), "Value begins with a formula character or contains a line break.", "Re-enter the value as plain text."));
      }
    }

    const mobile = normalizeUsMobile(row[S.MOBILE]);
    const npn = classifyNpn(row[S.NPN], { mobileDigits: mobile.ok ? mobile.national : digitsOnly(row[S.MOBILE]) });
    f.push(...npn.findings);
    if (!npn.digits || /^0+$/.test(npn.digits)) counts.blankOrZeroNpnRows++;

    const upline = trimOuter(row[S.UPLINE]);
    if (!upline) f.push(finding("upline_missing", "blocker", "Direct Upline NPN", "D", "No direct upline NPN.", "Record the APPROVED immediate upline's individual NPN; never infer it from the sub-agency label."));
    else if (!/^[0-9]+$/.test(upline) || /^0+$/.test(upline)) f.push(finding("upline_invalid", "blocker", "Direct Upline NPN", "D", `"${upline}" is not a nonzero digit string.`, "Enter the upline's individual NPN as digits."));
    else if (npn.digits && upline === npn.digits) f.push(finding("upline_self_parent", "blocker", "Direct Upline NPN", "D", "The row lists itself as its own upline.", "Hierarchy approval: set the real direct upline."));

    if (!mobile.ok) {
      f.push(mobile.reason === "missing"
        ? finding("mobile_missing", "blocker", "Agent Mobile Number", "E", "No mobile number.", "Collect the agent's own unique mobile; never use an admin phone to fill the cell.")
        : finding("mobile_invalid", "blocker", "Agent Mobile Number", "E", `Mobile could not be normalized (${mobile.reason}).`, "Collect a supported US mobile from the agent; international numbers and extensions need a manual path."));
    } else {
      if (principalMobile.ok && mobile.national === principalMobile.national && npn.digits !== principalNpn) {
        f.push(finding("mobile_matches_principal", "blocker", "Agent Mobile Number", "E", "Mobile equals the principal's phone from the Instructions tab.", "Collect the agent's own mobile; the principal's number cannot stand in."));
      }
      const list = byMobile.get(mobile.national) ?? [];
      list.push({ row: rowNumber, npn: npn.digits });
      byMobile.set(mobile.national, list);
    }

    const email = normalizeEmail(row[S.EMAIL]);
    f.push(...email.findings);
    if (email.value && !email.findings.some((x) => x.code === "email_invalid_syntax")) {
      if (principalEmail && email.value === principalEmail && npn.digits !== principalNpn) {
        f.push(finding("email_matches_principal", "blocker", "Agent Email", "F", "Email equals the principal's email from the Instructions tab.", "Collect the agent's own email."));
      }
      const list = byEmail.get(email.value) ?? [];
      list.push({ row: rowNumber, npn: npn.digits });
      byEmail.set(email.value, list);
    }

    f.push(...classifyCompLevel(row[S.LEVEL], opts.compLevels ?? ETHOS_COMP_LEVELS).findings);
    f.push(...classifyAdvanceTier(row[S.ADVANCE]).findings);
    f.push(...classifySubAgency(row[S.SUBAGENCY], opts.knownSubAgencies ?? null).findings);

    const head = parseSheetBoolean(row[S.HEAD]);
    if (head === "unknown" && trimOuter(row[S.HEAD])) f.push(finding("sub_agent_head_unparseable", "review", "Sub-Agent Head?", "J", `"${trimOuter(row[S.HEAD])}" is not TRUE/FALSE.`, "Set the checkbox explicitly; a manager title alone is not approval."));

    const licensed = parseSheetBoolean(row[S.LICENSED]);
    if (licensed !== true) {
      counts.lifeUnchecked++;
      f.push(finding("life_license_not_attested", "blocker", "Life Licensed?", "K", licensed === false ? "Life Licensed is FALSE." : "Life Licensed is blank/unknown.", "Verify current life authority (NIPR) and record the evidence; never check the box to bypass."));
    }
    const eo = parseSheetBoolean(row[S.EO]);
    if (eo !== true) {
      counts.eoUnchecked++;
      f.push(finding("eo_not_attested", "blocker", "$1M in E&O coverage?", "L", eo === false ? "E&O is FALSE." : "E&O is blank/unknown.", "Obtain the certificate (name, $1M limit, effective/expiration) and record the evidence reference."));
    }

    const carrier = readCarrierState(row);
    if (carrier.portalCreated === true) counts.portalCreatedRows++;
    if (carrier.reparenting === "needed") counts.needsReparentingRows++;
    if (carrier.portalCreated === true && carrier.reparenting === "needed") {
      f.push(finding("reparenting_pending_with_portal", "review", "Date Portal Created / Date Reparenting Completed", "N", "Portal exists but the hierarchy transfer is still pending.", "Open a transfer task: agent consent, request sent, Ethos acknowledgment, confirmation date. Do not toggle the portal flag."));
    }
    if (carrier.partnerCode && !carrier.inviteUnique) {
      f.push(finding("invite_link_missing", "review", "Invite link", "Q", "Partner code exists but the invite cell is blank or a bare base URL.", "Reconcile with Ethos; a bare https://agents.ethoslife.com/invite/ is not a unique invitation."));
    }

    if (npn.digits && !/^0+$/.test(npn.digits)) {
      const list = byNpn.get(npn.digits) ?? [];
      list.push(rowNumber);
      byNpn.set(npn.digits, list);
    }

    audits.push({ rowNumber, npn: npn.digits, npnMasked: maskId(npn.digits), findings: f, carrier, duplicateGroup: null, hasBlocker: false });
  }

  // Cross-row: repeated NPN groups (identical vs conflicting on A:P, invite formula excluded).
  const duplicates: DuplicateGroup[] = [];
  const reparentNpn = new Set<string>();
  for (const a of audits) if (a.carrier.reparenting === "needed" && a.npn) reparentNpn.add(a.npn);
  counts.needsReparentingDistinctNpn = reparentNpn.size;
  counts.distinctNpn = byNpn.size;

  const byRow = new Map<number, RowAudit>();
  for (const a of audits) byRow.set(a.rowNumber, a);

  for (const [key, rowsOfKey] of byNpn) {
    if (rowsOfKey.length < 2) continue;
    const tuples = rowsOfKey.map((r) => {
      const row = rowData.get(r) ?? [];
      const t: string[] = [];
      for (let c = S.FIRST; c <= S.PARTNER_CODE; c++) t.push(trimOuter(row[c]));
      return t;
    });
    const differing: string[] = [];
    for (let c = S.FIRST; c <= S.PARTNER_CODE; c++) {
      const vals = new Set(tuples.map((t) => t[c]));
      if (vals.size > 1) differing.push(columnLetter(c));
    }
    const kind = differing.length ? "conflict" : "repeat";
    duplicates.push({ key, keyMasked: maskId(key), rows: rowsOfKey.slice(), kind, differingColumns: differing });
    counts.repeatedNpnGroups++;
    if (kind === "repeat") counts.repeatedNpnGroupsIdentical++;
    else counts.repeatedNpnGroupsConflicting++;
    for (const r of rowsOfKey) {
      const a = byRow.get(r);
      if (!a) continue;
      a.duplicateGroup = key;
      a.findings.push(kind === "repeat"
        ? finding("duplicate_npn_repeat", "review", "Agent NPN", "C", `Repeated record: rows ${rowsOfKey.join(", ")} carry the same NPN with identical A:P values.`, "Resolve the repeat with a human; never delete populated rows automatically and never submit this identity again.")
        : finding("duplicate_npn_conflict", "blocker", "Agent NPN", "C", `Conflicting records: rows ${rowsOfKey.join(", ")} share an NPN but differ in column(s) ${differing.join(", ")}.`, "A person decides which values are true; do not pick latest, highest comp or most complete automatically."));
    }
  }

  // Cross-row: shared mobile / email across DIFFERENT identities.
  const collide = (
    map: Map<string, Array<{ row: number; npn: string | null }>>,
    code: string,
    field: string,
    column: string,
  ) => {
    for (const [, hits] of map) {
      if (hits.length < 2) continue;
      const identities = new Set(hits.map((h) => h.npn ?? `row:${h.row}`));
      if (identities.size < 2) continue;
      const rowsList = hits.map((h) => h.row).join(", ");
      for (const h of hits) {
        byRow.get(h.row)?.findings.push(finding(code, "blocker", field, column, `Shared with a different agent identity (rows ${rowsList}).`, "Each agent needs a unique, agent-owned contact. Confirm ownership with the agents; a repeated contact can also be a typo."));
      }
    }
  };
  collide(byMobile, "mobile_shared_across_agents", "Agent Mobile Number", "E");
  collide(byEmail, "email_shared_across_agents", "Agent Email", "F");

  for (const a of audits) {
    a.hasBlocker = a.findings.some((x) => x.severity === "blocker");
    if (a.hasBlocker) counts.rowsWithBlockers++;
    else if (a.findings.length) counts.rowsReviewOnly++;
    else counts.rowsClean++;
  }

  return { header, rows: audits, duplicates, counts };
}

// ── Agent Updates tab audit ──────────────────────────────────────────────────

export type UpdateRowAudit = { rowNumber: number; npn: string | null; npnMasked: string; findings: Finding[]; hasBlocker: boolean; requestedChanges: string[] };
export type UpdatesAudit = { header: HeaderCheck; rows: UpdateRowAudit[]; counts: { records: number; withChanges: number; outOfSchema: number; terminationRequests: number; rowsWithBlockers: number } };

export function auditUpdatesTab(rows: unknown[][], compLevels: readonly string[] = ETHOS_COMP_LEVELS): UpdatesAudit {
  const header = verifyHeaderSignature(UPDATES_HEADERS, rows[UPDATES_TAB.headerRow - 1]);
  const counts = { records: 0, withChanges: 0, outOfSchema: 0, terminationRequests: 0, rowsWithBlockers: 0 };
  if (!header.ok) return { header, rows: [], counts };
  const out: UpdateRowAudit[] = [];
  for (let i = UPDATES_TAB.firstDataRow - 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    if (!isPopulatedUpdateRow(row)) continue;
    counts.records++;
    const f: Finding[] = [];
    const changes: string[] = [];
    if (!trimOuter(row[U.FIRST])) f.push(finding("first_name_missing", "blocker", "Agent First Name", "A", "Blank first name.", "A:C must identify the agent."));
    if (!trimOuter(row[U.LAST])) f.push(finding("last_name_missing", "blocker", "Agent Last Name", "B", "Blank last name.", "A:C must identify the agent."));
    const npn = classifyNpn(row[U.NPN], {}, "Agent NPN", "C");
    f.push(...npn.findings);
    const upline = trimOuter(row[U.UPLINE]);
    if (upline) {
      changes.push("upline");
      if (!/^[0-9]+$/.test(upline) || /^0+$/.test(upline)) f.push(finding("upline_invalid", "blocker", "Direct Upline's NPN", "D", `"${upline}" is not a nonzero digit string.`, "Enter the new upline's individual NPN."));
    }
    if (trimOuter(row[U.LEVEL])) { changes.push("comp_level"); f.push(...classifyCompLevel(row[U.LEVEL], compLevels, "E").findings); }
    if (trimOuter(row[U.ADVANCE])) { changes.push("advance"); f.push(...classifyAdvanceTier(row[U.ADVANCE], "F").findings); }
    if (trimOuter(row[U.PII])) changes.push("pii_correction");
    if (trimOuter(row[U.TERMINATION])) {
      changes.push("termination");
      counts.terminationRequests++;
      f.push(finding("termination_requested_verify_authorization", "review", "Termination", "H", `Termination cell reads "${trimOuter(row[U.TERMINATION])}".`, "Confirm a separately authorized explicit request exists; inactivity, missing documents or team removal are not termination authority."));
    }
    if (!changes.length) f.push(finding("update_no_change_requested", "review", "D:H", null, "Identity only — no requested change in D:H.", "Determine whether this request is pending, completed or invalid before adding another."));
    else counts.withChanges++;

    // Out-of-schema: anything in M:S, booleans where dates/notes belong, dates where booleans belong.
    let outOfSchema = false;
    for (let c = UPDATES_HEADERS.length; c < row.length; c++) if (trimOuter(row[c])) outOfSchema = true;
    const completed = trimOuter(row[U.COMPLETED]);
    const processed = trimOuter(row[U.PROCESSED]);
    const notes = trimOuter(row[U.NOTES]);
    if (processed && parseSheetBoolean(processed) !== "unknown") outOfSchema = true;
    if (notes && parseSheetBoolean(notes) !== "unknown") outOfSchema = true;
    if (completed && parseSheetBoolean(completed) === "unknown" && !/^\d+$/.test(completed)) outOfSchema = true;
    if (outOfSchema) {
      counts.outOfSchema++;
      f.push(finding("update_row_out_of_schema", "blocker", "M:S / J:L", null, "Signup-style data or boolean/date type conflicts outside the Agent Updates schema.", "Reconcile the historical request with Ethos; do not overwrite it and do not auto-create another request."));
    }
    const hasBlocker = f.some((x) => x.severity === "blocker");
    if (hasBlocker) counts.rowsWithBlockers++;
    out.push({ rowNumber: i + 1, npn: npn.digits, npnMasked: maskId(npn.digits), findings: f, hasBlocker, requestedChanges: changes });
  }
  return { header, rows: out, counts };
}

// ── Submission gate for a NEW signup row ──────────────────────────────────────

export type SignupCandidate = { first_name: string; last_name: string; npn: string; mobile: string; email: string };

/** Approval + evidence record for one producer. Requested/internal comp never appears here — it never feeds column G. */
export type SignupApproval = {
  npn_verified_at?: string | null;
  npn_verified_source?: string | null;
  license_verified_at?: string | null;
  license_evidence_ref?: string | null;
  eo_verified_at?: string | null;
  eo_expires_at?: string | null;
  eo_evidence_ref?: string | null;
  contact_confirmed_at?: string | null;
  approved_comp_level?: string | null;
  approved_advance_tier?: string | null;
  approved_upline_npn?: string | null;
  approved_sub_agency?: string | null;
  approved_sub_agent_head?: boolean | null;
  approved_by?: string | null;
  approved_at?: string | null;
  comp_grid_version?: string | null;
};

export type QueueEntry = { id: string; npn?: string | null; email?: string | null; mobile?: string | null };

export type GateContext = {
  now: number;
  compLevels?: readonly string[];
  principal?: Principal | null;
  /** Whole signup tab incl. header, when the caller has a fresh read. */
  sheetRows?: unknown[][] | null;
  /** Other intakes/requests in the internal queue (collision check). */
  queue?: QueueEntry[] | null;
  selfId?: string | null;
};

export type GateResult = {
  ready: boolean;
  blockers: Finding[];
  review: Finding[];
  /** Exactly SIGNUP_AGENCY_COLUMNS cells when ready, else null. */
  payload: SheetCell[] | null;
  sheet: { npnRows: number[]; emailRows: number[]; mobileRows: number[] };
};

function parseWhen(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * Decide whether a producer may be submitted to Ethos, and build the exact A:L payload.
 *
 * Ready requires: valid identity + contact; NPN verified; current life authority verified;
 * unexpired $1M E&O verified; contact confirmed when any contact finding exists; every
 * approval field explicit and attributed; no collision with the sheet or the queue. The
 * payload's K and L are `true` only because that evidence exists — nothing else sets them.
 */
export function evaluateSignupGate(candidate: SignupCandidate, approval: SignupApproval | null, ctx: GateContext): GateResult {
  const blockers: Finding[] = [];
  const review: Finding[] = [];
  const push = (list: Finding[]) => { for (const x of list) (x.severity === "blocker" ? blockers : review).push(x); };
  const labels = ctx.compLevels ?? ETHOS_COMP_LEVELS;

  const first = trimOuter(candidate.first_name);
  const last = trimOuter(candidate.last_name);
  if (!first) blockers.push(finding("first_name_missing", "blocker", "Agent First Name", "A", "Blank first name.", "Enter the legal first name."));
  if (!last) blockers.push(finding("last_name_missing", "blocker", "Agent Last Name", "B", "Blank last name.", "Enter the legal last name."));

  const mobile = normalizeUsMobile(candidate.mobile);
  const npn = classifyNpn(candidate.npn, { mobileDigits: mobile.ok ? mobile.national : digitsOnly(candidate.mobile) });
  push(npn.findings);
  if (!mobile.ok) blockers.push(mobile.reason === "missing"
    ? finding("mobile_missing", "blocker", "Agent Mobile Number", "E", "No mobile number.", "Collect the agent's own mobile.")
    : finding("mobile_invalid", "blocker", "Agent Mobile Number", "E", `Mobile could not be normalized (${mobile.reason}).`, "Collect a supported US mobile."));
  const email = normalizeEmail(candidate.email);
  push(email.findings);

  const principalNpn = digitsOnly(ctx.principal?.npn) || null;
  const principalMobile = normalizeUsMobile(ctx.principal?.mobile);
  const principalEmail = trimOuter(ctx.principal?.email).toLowerCase() || null;
  if (mobile.ok && principalMobile.ok && mobile.national === principalMobile.national && npn.digits !== principalNpn) {
    blockers.push(finding("mobile_matches_principal", "blocker", "Agent Mobile Number", "E", "Mobile equals the principal's phone.", "Collect the agent's own mobile."));
  }
  if (email.value && principalEmail && email.value === principalEmail && npn.digits !== principalNpn) {
    blockers.push(finding("email_matches_principal", "blocker", "Agent Email", "F", "Email equals the principal's email.", "Collect the agent's own email."));
  }
  for (const [label, value] of [["Agent First Name", first], ["Agent Last Name", last]] as const) {
    if (looksFormulaLike(value)) blockers.push(finding("formula_like_value", "blocker", label, null, "Value begins with a formula character or contains a line break.", "Re-enter as plain text."));
  }

  // Evidence.
  const a = approval ?? {};
  if (!a.npn_verified_at) blockers.push(finding("npn_not_verified", "blocker", "Agent NPN", "C", "NPN ownership has not been verified.", "Verify against the NIPR individual record (or an authorized provider) and record source, timestamp and reviewer."));
  if (!a.license_verified_at) blockers.push(finding("license_not_verified", "blocker", "Life Licensed?", "K", "Current life authority has not been verified.", "Verify the applicable life license and record the evidence reference; an NPN alone is not enough."));
  if (!a.eo_verified_at) blockers.push(finding("eo_not_verified", "blocker", "$1M in E&O coverage?", "L", "E&O coverage has not been verified.", "Review the certificate: name, $1M limit, effective/expiration; record the evidence reference."));
  else {
    const exp = parseWhen(a.eo_expires_at ?? null);
    if (exp === null) blockers.push(finding("eo_expiry_unknown", "blocker", "$1M in E&O coverage?", "L", "E&O verified but no expiration recorded.", "Record the certificate's expiration date."));
    else if (exp < ctx.now) blockers.push(finding("eo_expired", "blocker", "$1M in E&O coverage?", "L", `E&O coverage expired ${a.eo_expires_at}.`, "Obtain a current certificate before submission."));
  }
  const contactFindings = [...blockers, ...review].some((x) => x.field === "Agent Email" || x.field === "Agent Mobile Number");
  if (contactFindings && !a.contact_confirmed_at) {
    blockers.push(finding("contact_not_confirmed", "blocker", "Agent Email", null, "A contact finding exists and the agent has not confirmed their contact details.", "Confirm email and mobile with the agent and record the confirmation."));
  }

  // Approvals — explicit, attributed, on-grid. Never defaulted.
  const level = classifyCompLevel(a.approved_comp_level ?? "", labels);
  push(level.findings.map((x) => ({ ...x, code: x.code === "comp_level_missing" ? "approval_comp_level_missing" : x.code })));
  const adv = classifyAdvanceTier(a.approved_advance_tier ?? "");
  push(adv.findings.map((x) => ({ ...x, code: x.code === "advance_tier_missing" ? "approval_advance_tier_missing" : x.code })));
  const uplineRaw = trimOuter(a.approved_upline_npn);
  if (!uplineRaw) blockers.push(finding("approval_upline_missing", "blocker", "Direct Upline NPN", "D", "No approved direct upline.", "Leadership approves the immediate upline's individual NPN; it is never defaulted to the principal or inferred from the sub-agency."));
  else if (!/^[0-9]+$/.test(uplineRaw) || /^0+$/.test(uplineRaw)) blockers.push(finding("upline_invalid", "blocker", "Direct Upline NPN", "D", `"${uplineRaw}" is not a nonzero digit string.`, "Enter the upline's individual NPN."));
  else if (npn.digits && uplineRaw === npn.digits) blockers.push(finding("upline_self_parent", "blocker", "Direct Upline NPN", "D", "Upline equals the agent's own NPN.", "Set the real direct upline."));
  const subAgency = classifySubAgency(a.approved_sub_agency ?? "", null);
  push(subAgency.findings.map((x) => ({ ...x, code: x.code === "sub_agency_missing" ? "approval_sub_agency_missing" : x.code })));
  if (a.approved_sub_agent_head !== true && a.approved_sub_agent_head !== false) {
    blockers.push(finding("approval_sub_agent_head_missing", "blocker", "Sub-Agent Head?", "J", "Sub-agent head designation not decided.", "Leadership sets TRUE/FALSE explicitly; a manager title is not proof."));
  }
  if (!a.approved_by || !a.approved_at) blockers.push(finding("approval_unattributed", "blocker", "Approval", null, "Level/advance/upline/sub-agency approval has no approver or date.", "Record who approved and when (and the grid version)."));

  // Collisions with the live sheet and the internal queue.
  const sheet = { npnRows: [] as number[], emailRows: [] as number[], mobileRows: [] as number[] };
  if (ctx.sheetRows && ctx.sheetRows.length) {
    const hdr = verifyHeaderSignature(SIGNUP_HEADERS, ctx.sheetRows[0]);
    if (!hdr.ok) blockers.push(finding("sheet_header_drift", "blocker", "Sheet", null, `Header drift on ${hdr.drift.map((d) => d.column).join(", ")}.`, "Stop writes; an admin reconciles the tab layout."));
    else {
      for (let i = SIGNUP_TAB.firstDataRow - 1; i < ctx.sheetRows.length; i++) {
        const row = ctx.sheetRows[i] ?? [];
        if (!isPopulatedSignupRow(row)) continue;
        const rowNpn = digitsOnly(row[S.NPN]);
        if (npn.digits && rowNpn === npn.digits) sheet.npnRows.push(i + 1);
        const rowEmail = trimOuter(row[S.EMAIL]).toLowerCase();
        if (email.value && rowEmail === email.value && rowNpn !== npn.digits) sheet.emailRows.push(i + 1);
        const rowMobile = normalizeUsMobile(row[S.MOBILE]);
        if (mobile.ok && rowMobile.ok && rowMobile.national === mobile.national && rowNpn !== npn.digits) sheet.mobileRows.push(i + 1);
      }
      if (sheet.npnRows.length) blockers.push(finding("sheet_npn_already_present", "blocker", "Agent NPN", "C", `This NPN is already on the sheet (row ${sheet.npnRows.join(", ")}).`, "No second submission. Reconcile the existing row's carrier state instead."));
      if (sheet.emailRows.length) blockers.push(finding("sheet_email_on_other_npn", "blocker", "Agent Email", "F", `This email is on the sheet under a different NPN (row ${sheet.emailRows.join(", ")}).`, "A person decides: shared household address or mistyped NPN."));
      if (sheet.mobileRows.length) blockers.push(finding("sheet_mobile_on_other_npn", "blocker", "Agent Mobile Number", "E", `This mobile is on the sheet under a different NPN (row ${sheet.mobileRows.join(", ")}).`, "A person decides: shared phone or mistyped NPN."));
    }
  }
  for (const q of ctx.queue ?? []) {
    if (ctx.selfId && q.id === ctx.selfId) continue;
    const qNpn = digitsOnly(q.npn);
    if (npn.digits && qNpn && qNpn === npn.digits) blockers.push(finding("queue_npn_duplicate", "blocker", "Agent NPN", "C", `Another intake (${q.id}) carries the same NPN.`, "Merge or resolve the duplicate intake before submission."));
    const qEmail = trimOuter(q.email).toLowerCase();
    if (email.value && qEmail && qEmail === email.value && qNpn !== npn.digits) blockers.push(finding("queue_email_duplicate", "blocker", "Agent Email", "F", `Another intake (${q.id}) uses this email under a different NPN.`, "Confirm identity before submission."));
    const qMobile = normalizeUsMobile(q.mobile);
    if (mobile.ok && qMobile.ok && qMobile.national === mobile.national && qNpn !== npn.digits) blockers.push(finding("queue_mobile_duplicate", "blocker", "Agent Mobile Number", "E", `Another intake (${q.id}) uses this mobile under a different NPN.`, "Confirm identity before submission."));
  }

  const ready = blockers.length === 0;
  const payload: SheetCell[] | null = ready && mobile.ok && email.value && npn.digits && level.value && adv.value && subAgency.value
    ? [first, last, npn.digits, uplineRaw, mobile.display, email.value, level.value, adv.value, subAgency.value, a.approved_sub_agent_head === true, true, true]
    : null;
  return { ready: ready && payload !== null, blockers, review, payload, sheet };
}

// ── Write planning + read-back for the signup tab ────────────────────────────

export type WritePlan =
  | { action: "append"; rowNumber: number }
  | { action: "already_present"; rowNumbers: number[] }
  | { action: "manual_review"; reason: string; rowNumbers: number[] };

/**
 * Where a ready payload may land. Never an update of an existing row: a matching NPN means
 * the producer is already submitted and only carrier state is reconciled; an email/mobile
 * match under another NPN is a human decision. The append row is the first row after the
 * last populated identity row — NOT Sheets' own append anchor, which would skip past the
 * pre-filled checkbox rows and land at row 1173.
 */
export function planSignupWrite(sheetRows: unknown[][], payload: SheetCell[]): WritePlan {
  const npn = digitsOnly(payload[S.NPN]);
  const email = trimOuter(payload[S.EMAIL]).toLowerCase();
  const mobile = normalizeUsMobile(payload[S.MOBILE]);
  const npnRows: number[] = [];
  const otherRows: number[] = [];
  let lastPopulated = SIGNUP_TAB.headerRow;
  for (let i = SIGNUP_TAB.firstDataRow - 1; i < sheetRows.length; i++) {
    const row = sheetRows[i] ?? [];
    if (!isPopulatedSignupRow(row)) continue;
    lastPopulated = i + 1;
    const rowNpn = digitsOnly(row[S.NPN]);
    if (npn && rowNpn === npn) { npnRows.push(i + 1); continue; }
    const rowEmail = trimOuter(row[S.EMAIL]).toLowerCase();
    const rowMobile = normalizeUsMobile(row[S.MOBILE]);
    if ((email && rowEmail === email) || (mobile.ok && rowMobile.ok && rowMobile.national === mobile.national)) otherRows.push(i + 1);
  }
  if (npnRows.length) return { action: "already_present", rowNumbers: npnRows };
  if (otherRows.length) return { action: "manual_review", reason: "contact_matches_a_different_npn", rowNumbers: otherRows };
  return { action: "append", rowNumber: lastPopulated + 1 };
}

export type ReadBack = { ok: boolean; mismatches: string[] };

/** The sheet must now hold exactly what was meant: all twelve A:L cells, booleans parsed explicitly, mobile compared on digits. */
export function verifySignupReadBack(written: unknown[] | undefined, payload: SheetCell[]): ReadBack {
  const mismatches: string[] = [];
  for (let c = 0; c < SIGNUP_AGENCY_COLUMNS; c++) {
    const want = payload[c];
    const got = written?.[c];
    let same: boolean;
    if (typeof want === "boolean") same = parseSheetBoolean(got) === want;
    else if (c === S.MOBILE) same = digitsOnly(got).slice(-10) === digitsOnly(want).slice(-10);
    else if (c === S.EMAIL) same = trimOuter(got).toLowerCase() === trimOuter(want).toLowerCase();
    else same = trimOuter(got) === trimOuter(want);
    if (!same) mismatches.push(SIGNUP_HEADERS[c]);
  }
  return { ok: mismatches.length === 0, mismatches };
}

/** A1 range for the agency block of one row. Only ever A:L. */
export function signupAgencyRange(tabTitle: string, rowNumber: number): string {
  return `${tabTitle}!A${rowNumber}:${columnLetter(SIGNUP_AGENCY_COLUMNS - 1)}${rowNumber}`;
}

// ── Agent Updates row builder ────────────────────────────────────────────────

export type UpdateRequest = {
  first_name: string;
  last_name: string;
  npn: string;
  change_upline_npn?: string | null;
  change_comp_level?: string | null;
  change_advance_tier?: string | null;
  change_pii_correction?: string | null;
  termination?: { requested: boolean; authorized_by?: string | null; authorized_at?: string | null } | null;
};

export type UpdateRowBuild = { row: SheetCell[] | null; blockers: Finding[]; review: Finding[] };

/**
 * A:C identify the agent; D:H carry ONLY the approved changes, blanks mean "unchanged" and
 * must never be read as "clear". I:L are never produced. A termination needs its own
 * explicit authorization record or the row is refused.
 */
export function buildUpdateRequestRow(req: UpdateRequest, compLevels: readonly string[] = ETHOS_COMP_LEVELS): UpdateRowBuild {
  const blockers: Finding[] = [];
  const review: Finding[] = [];
  const push = (list: Finding[]) => { for (const x of list) (x.severity === "blocker" ? blockers : review).push(x); };
  const first = trimOuter(req.first_name);
  const last = trimOuter(req.last_name);
  if (!first) blockers.push(finding("first_name_missing", "blocker", "Agent First Name", "A", "Blank first name.", "A:C must identify the agent."));
  if (!last) blockers.push(finding("last_name_missing", "blocker", "Agent Last Name", "B", "Blank last name.", "A:C must identify the agent."));
  const npn = classifyNpn(req.npn, {}, "Agent NPN", "C");
  push(npn.findings);

  const cells: SheetCell[] = [first, last, npn.digits ?? "", "", "", "", "", ""];
  let changes = 0;
  const upline = trimOuter(req.change_upline_npn);
  if (upline) {
    changes++;
    if (!/^[0-9]+$/.test(upline) || /^0+$/.test(upline)) blockers.push(finding("upline_invalid", "blocker", "Direct Upline's NPN", "D", `"${upline}" is not a nonzero digit string.`, "Enter the new upline's individual NPN."));
    else if (npn.digits && upline === npn.digits) blockers.push(finding("upline_self_parent", "blocker", "Direct Upline's NPN", "D", "Upline equals the agent's own NPN.", "Set the real upline."));
    cells[U.UPLINE] = upline;
  }
  if (trimOuter(req.change_comp_level)) {
    changes++;
    const level = classifyCompLevel(req.change_comp_level, compLevels, "E");
    push(level.findings);
    cells[U.LEVEL] = level.value ?? "";
  }
  if (trimOuter(req.change_advance_tier)) {
    changes++;
    const adv = classifyAdvanceTier(req.change_advance_tier, "F");
    push(adv.findings);
    cells[U.ADVANCE] = adv.value ?? "";
  }
  if (trimOuter(req.change_pii_correction)) {
    changes++;
    const pii = trimOuter(req.change_pii_correction);
    if (looksFormulaLike(pii)) blockers.push(finding("formula_like_value", "blocker", "PII Information", "G", "Correction text begins with a formula character or contains a line break.", "Re-enter as plain text."));
    cells[U.PII] = pii;
  }
  if (req.termination?.requested) {
    changes++;
    if (!req.termination.authorized_by || !req.termination.authorized_at) {
      blockers.push(finding("termination_not_authorized", "blocker", "Termination", "H", "Termination requested without a separate explicit authorization record.", "Record who authorized the termination and when; inactivity, missing documents or team removal are not authority."));
    }
    cells[U.TERMINATION] = "Yes — terminate";
  }
  if (!changes) blockers.push(finding("update_no_change_requested", "blocker", "D:H", null, "No change requested.", "An update row needs at least one approved change; identity alone is not a request."));

  const ready = blockers.length === 0;
  return { row: ready ? cells.slice(0, UPDATES_AGENCY_COLUMNS) : null, blockers, review };
}

// ── Pipeline stage derivation (one clear stage, every blocker kept) ───────────

export const PIPELINE_STAGES = [
  "failed_sync",
  "validation_conflict",
  "needs_information",
  "licensing_pending",
  "eo_pending",
  "approval_required",
  "ready_to_submit",
  "submitted_awaiting_ethos",
  "reparenting",
  "carrier_confirmed",
] as const;
export type PipelineStage = typeof PIPELINE_STAGES[number];

export const PIPELINE_STAGE_LABELS: Record<PipelineStage, string> = {
  failed_sync: "Failed sync",
  validation_conflict: "Validation conflicts",
  needs_information: "Needs information",
  licensing_pending: "Licensing pending",
  eo_pending: "E&O pending",
  approval_required: "Approval required",
  ready_to_submit: "Ready to submit (internal gate — not Ethos approval)",
  submitted_awaiting_ethos: "Submitted / awaiting Ethos",
  reparenting: "Reparenting",
  carrier_confirmed: "Portal confirmed by Ethos (not authorization to sell)",
};

const CONFLICT_CODES = new Set([
  "npn_equals_phone", "duplicate_npn_conflict", "duplicate_npn_repeat", "mobile_shared_across_agents", "email_shared_across_agents",
  "mobile_matches_principal", "email_matches_principal", "sheet_email_on_other_npn", "sheet_mobile_on_other_npn", "sheet_npn_already_present",
  "queue_npn_duplicate", "queue_email_duplicate", "queue_mobile_duplicate", "formula_like_value", "upline_self_parent", "sheet_header_drift",
  "update_row_out_of_schema",
]);
const LICENSING_CODES = new Set(["license_not_verified", "life_license_not_attested"]);
const EO_CODES = new Set(["eo_not_verified", "eo_expired", "eo_expiry_unknown", "eo_not_attested"]);
const APPROVAL_PREFIXES = ["approval_", "comp_level_", "advance_tier_", "sub_agency_", "upline_"];

export function categorizeFinding(f: Finding): "conflict" | "licensing" | "eo" | "approval" | "information" {
  if (CONFLICT_CODES.has(f.code)) return "conflict";
  if (LICENSING_CODES.has(f.code)) return "licensing";
  if (EO_CODES.has(f.code)) return "eo";
  if (APPROVAL_PREFIXES.some((p) => f.code.startsWith(p))) return "approval";
  return "information";
}

export type PipelineInput = {
  /** Export leg state from contracting_intake_deliveries (ethos_sheet), or null when there is no intake. */
  deliveryState?: string | null;
  /** Blockers + review items from the gate and/or the sheet audit for this identity. */
  findings: Finding[];
  /** Whether the producer's NPN is on the sheet (observed, fresh read). */
  onSheet: boolean;
  carrier?: CarrierState | null;
};

export function derivePipelineStage(input: PipelineInput): PipelineStage {
  const ds = input.deliveryState ?? "";
  if (ds === "failed" || ds === "dead_letter" || ds === "unknown_outcome") return "failed_sync";
  if (input.onSheet) {
    const c = input.carrier;
    if (c && c.reparenting === "needed") return "reparenting";
    if (c && c.portalCreated === true) return "carrier_confirmed";
    return "submitted_awaiting_ethos";
  }
  const blockers = input.findings.filter((f) => f.severity === "blocker");
  if (!blockers.length) return "ready_to_submit";
  const cats = new Set(blockers.map(categorizeFinding));
  if (cats.has("conflict")) return "validation_conflict";
  if (cats.has("information")) return "needs_information";
  if (cats.has("licensing")) return "licensing_pending";
  if (cats.has("eo")) return "eo_pending";
  return "approval_required";
}

// ── Masked report shape for audits (no PII) ──────────────────────────────────

export type MaskedReport = {
  generated_for: string;
  header_ok: boolean;
  counts: SignupAuditCounts;
  duplicates: Array<{ key_masked: string; rows: number[]; kind: string; differing_columns: string[] }>;
  rows: Array<{ row: number; npn_masked: string; blockers: string[]; review: string[]; portal_created: SheetBool; reparenting: string }>;
  updates: { header_ok: boolean; counts: UpdatesAudit["counts"]; rows: Array<{ row: number; npn_masked: string; blockers: string[]; review: string[]; changes: string[] }> } | null;
};

export function toMaskedReport(signup: SignupAudit, updates: UpdatesAudit | null, generatedFor: string): MaskedReport {
  return {
    generated_for: generatedFor,
    header_ok: signup.header.ok,
    counts: signup.counts,
    duplicates: signup.duplicates.map((d) => ({ key_masked: d.keyMasked, rows: d.rows, kind: d.kind, differing_columns: d.differingColumns })),
    rows: signup.rows.filter((r) => r.findings.length).map((r) => ({
      row: r.rowNumber,
      npn_masked: r.npnMasked,
      blockers: r.findings.filter((f) => f.severity === "blocker").map((f) => f.code),
      review: r.findings.filter((f) => f.severity === "review").map((f) => f.code),
      portal_created: r.carrier.portalCreated,
      reparenting: r.carrier.reparenting,
    })),
    updates: updates
      ? {
        header_ok: updates.header.ok,
        counts: updates.counts,
        rows: updates.rows.map((r) => ({
          row: r.rowNumber,
          npn_masked: r.npnMasked,
          blockers: r.findings.filter((f) => f.severity === "blocker").map((f) => f.code),
          review: r.findings.filter((f) => f.severity === "review").map((f) => f.code),
          changes: r.requestedChanges,
        })),
      }
      : null,
  };
}

// ── CSV (Google Sheets export) ───────────────────────────────────────────────

/** RFC-4180 CSV parser for the Sheets export: quoted cells, doubled quotes, CRLF, embedded newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** A Sheets CSV export URL for one tab. Works only while the file allows link-reader access. */
export function sheetCsvExportUrl(sheetId: number, spreadsheetId: string = ETHOS_SPREADSHEET_ID): string {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${sheetId}`;
}

/** A login wall or sharing change returns HTML with a 200. That is a failed read, never an empty sheet. */
export function looksLikeHtml(body: string): boolean {
  return /<(!doctype|html|head|body)\b/i.test(body.slice(0, 600));
}
