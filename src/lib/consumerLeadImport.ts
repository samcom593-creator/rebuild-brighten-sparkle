import { nationalDigits } from "@/lib/phone";
import type { Json } from "@/integrations/supabase/types";
import { z } from "zod";

const receiptCount = z.number().int().nonnegative();
export const consumerImportReceiptSchema = z.object({
  batch_id: z.string().min(1), source: z.string(), received: receiptCount,
  imported: receiptCount, matched: receiptCount, review: receiptCount,
  duplicate: receiptCount, suppressed: receiptCount, replayed: z.boolean(),
}).refine(r => r.imported + r.matched + r.review + r.duplicate === r.received && r.suppressed <= r.received, {
  message: "Import receipt counts could not be verified.",
});
export type ConsumerImportReceipt = z.infer<typeof consumerImportReceiptSchema>;
export const consumerImportHistorySchema = z.array(z.object({
  id: z.string().min(1), source_name: z.string(), created_at: z.string().datetime({ offset: true }),
  receipt: consumerImportReceiptSchema,
}));
export const consumerImportReviewSchema = z.array(z.object({
  id: z.string().min(1), source_row: z.number().int().positive(), issues: z.array(z.string()),
  source_name: z.string().optional(), source_key: z.string().optional(),
  payload: z.object({ first_name: z.string().nullish(), last_name: z.string().nullish(), state: z.string().nullish() }),
}));

/** Explicit source layouts: all three supplied files start with a consumer, not a header. */
export const CONSUMER_IMPORT_SOURCES = {
  master_pos: { label: "MSTERRRR — policy owners", kind: "pos", key: "master-policy-owners" },
  jt_pos: { label: "Jt — policy history", kind: "pos", key: "jt-policy-history" },
  mortgage: { label: "Mortgage leads — 2021 to July 2023", kind: "mortgage", key: "mortgage-2021-july-2023" },
} as const;
export type ConsumerImportLayout = keyof typeof CONSUMER_IMPORT_SOURCES;
export function consumerImportIssueLabel(issue: string): string {
  const labels: Record<string,string> = {
    incomplete_name: "Consumer name incomplete", invalid_phone: "Phone needs correction", state_needs_review: "State needs review",
    invalid_email: "Email needs correction", missing_policy_reference: "Policy reference missing", invalid_dob: "Birth date needs correction",
    invalid_source_date: "Source date needs correction", invalid_date: "Date needs correction",
    identity_match_needs_review: "Identity needs review", conflicting_contact_identifiers: "Identifiers match different consumers",
  };
  return labels[issue] ?? issue.replace(/_/g," ");
}
export type ConsumerCell = string | number | boolean | null;
export type ConsumerImportRow = {
  source_row: number;
  first_name: string;
  last_name: string;
  phone_digits: string | null;
  phone_alt: string | null;
  email: string | null;
  state: string | null;
  street_address: string | null;
  dob: string | null;
  policy_number: string | null;
  policy_carrier: string | null;
  policy_product: string | null;
  policy_date: string | null;
  original_agent: string | null;
  original_agent_code: string | null;
  loan_amount: number | null;
  loan_type: string | null;
  lender_name: string | null;
  lead_date: string | null;
  notes: string | null;
  dnc: boolean;
  last_disposition: string | null;
  issues: string[];
  raw: Record<string, Json>;
};
export const US_STATE_CODES = "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" ");
const STATES = new Set(US_STATE_CODES);
const text = (v: ConsumerCell | undefined): string => v == null ? "" : String(v).trim();
const nullable = (v: ConsumerCell | undefined): string | null => text(v) || null;
const email = (v: ConsumerCell | undefined): string | null => {
  const s = text(v).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null;
};
export const hasExplicitContactStop = (value: string): boolean =>
  /\b(d\s*\.?\s*n\s*\.?\s*c|do\s*not\s*(call|contact|text|email)|don['’]?t\s*(call|contact|text|email)|stop\s*(calling|contacting|texting|emailing)|remove\s+(me|my\s+(number|name))|unsubscribe)\b/i.test(value);

/** Dates are source dates, never a claim of a recent policy verification. */
export function consumerSourceDate(value: ConsumerCell | undefined): string | null {
  const s = text(value);
  if (!s) return null;
  let y: number, m: number, d: number;
  if (typeof value === "number" && value > 1000 && value < 100000) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000);
    return date.toISOString().substring(0, 10);
  }
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/);
  const us = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/);
  const named = s.match(/^(\d{1,2})[- ]([A-Za-z]+)[- ](\d{2}|\d{4})$/);
  if (iso) [, y, m, d] = iso.map(Number);
  else if (us) { m = Number(us[1]); d = Number(us[2]); y = Number(us[3]); if (y < 100) y += y >= 30 ? 1900 : 2000; }
  else if (named) { d = Number(named[1]); m = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"].indexOf(named[2].substring(0,3).toLowerCase()) + 1; y = Number(named[3]); if(y < 100)y += y >= 30 ? 1900 : 2000; }
  else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
    ? date.toISOString().substring(0, 10) : null;
}

function phone(value: ConsumerCell | undefined): string | null {
  const result = nationalDigits(text(value));
  return result && /^[2-9]\d{2}[2-9]\d{6}$/.test(result) ? result : null;
}
function nameParts(name: string): [string, string] {
  if (name.includes(",")) { const [last, ...first] = name.split(","); return [first.join(" ").trim(), last.trim()]; }
  const [first = "", ...rest] = name.split(/\s+/); return [first, rest.join(" ")];
}
function amount(value: ConsumerCell | undefined): number | null {
  const s = text(value).replace(/[$,\s]/g, "");
  if (!s || !/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s); return Number.isFinite(n) && n >= 0 ? n : null;
}

/** RFC 4180 quoting, embedded newlines and Excel TSV; never split quoted commas. */
export function parseConsumerTable(input: string): ConsumerCell[][] {
  const value = input.replace(/^\uFEFF/, "");
  if (value.trim().startsWith("[")) {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.some(row => !Array.isArray(row) || row.some(c => c != null && !["string", "number", "boolean"].includes(typeof c)))) {
      throw new Error("JSON must contain an array of spreadsheet rows.");
    }
    return parsed as ConsumerCell[][];
  }
  const delimiter = value.split(/\r?\n/, 1)[0].includes("\t") ? "\t" : ",";
  const rows: string[][] = []; let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === '"') {
      if (quoted && value[i + 1] === '"') { cell += '"'; i++; }
      else if (quoted || cell.length === 0) quoted = !quoted;
      else cell += ch;
    } else if (ch === delimiter && !quoted) { row.push(cell); cell = ""; }
    else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && value[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (quoted) throw new Error("The file contains an unfinished quoted cell.");
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export function prepareConsumerImport(cells: ConsumerCell[][], layout: ConsumerImportLayout) {
  if (cells.length > 10000) throw new Error("Import at most 10,000 rows at a time.");
  const rows: ConsumerImportRow[] = []; let headersSkipped = 0, emptySkipped = 0;
  cells.forEach((r, index) => {
    if (r.every(c => !text(c))) { emptySkipped++; return; }
    const lowered = r.map(c => text(c).toLowerCase());
    if ((lowered.includes("borrower name") && lowered.includes("borr cell")) ||
        (lowered.some(c => ["client name", "consumer name", "insured name"].includes(c)) && lowered.some(c => /^(phone|policy number|policy #)$/.test(c)))) {
      headersSkipped++; return;
    }
    const master = layout === "master_pos", mortgage = layout === "mortgage";
    const name = text(r[master ? 3 : 1]);
    const [first_name, last_name] = nameParts(name);
    const rawState = text(r[master ? 5 : mortgage ? 9 : 3]);
    const state = STATES.has(rawState.toUpperCase()) ? rawState.toUpperCase() : null;
    const rawPhone = r[master ? 6 : mortgage ? 2 : 4];
    const primaryPhone = phone(rawPhone);
    const altPhone = mortgage ? phone(r[3]) : null;
    const rawEmail = master ? r[7] : mortgage ? r[4] : null;
    const notes = mortgage ? r.slice(11).map(text).filter(Boolean).join(" · ") : master ? "" : r.slice(10).map(text).filter(Boolean).join(" · ");
    const dnc = hasExplicitContactStop(notes);
    const issues: string[] = [];
    if (!first_name || !last_name) issues.push("incomplete_name");
    if (!primaryPhone && !altPhone) issues.push("invalid_phone");
    if (!state) issues.push("state_needs_review");
    if (text(rawEmail) && !email(rawEmail)) issues.push("invalid_email");
    const policy_number = mortgage ? null : nullable(r[master ? 13 : 8]);
    if (!mortgage && !policy_number) issues.push("missing_policy_reference");
    const sourceDate = consumerSourceDate(r[mortgage ? 0 : master ? 11 : 6]);
    const dob = mortgage ? null : consumerSourceDate(r[master ? 8 : 5]);
    if (!mortgage && text(r[master ? 8 : 5]) && !dob) issues.push("invalid_dob");
    if (text(r[mortgage ? 0 : master ? 11 : 6]) && !sourceDate) issues.push("invalid_source_date");
    const source = CONSUMER_IMPORT_SOURCES[layout];
    rows.push({
      source_row: index + 1, first_name, last_name,
      phone_digits: primaryPhone ?? altPhone, phone_alt: primaryPhone && altPhone !== primaryPhone ? altPhone : null,
      email: email(rawEmail), state, street_address: mortgage ? null : nullable(r[master ? 4 : 2]), dob,
      policy_number, policy_carrier: master ? nullable(r[15]) : null,
      policy_product: mortgage ? null : nullable(r[master ? 12 : 7]), policy_date: mortgage ? null : sourceDate,
      original_agent: nullable(r[master ? 1 : mortgage ? 5 : 0]), original_agent_code: master ? nullable(r[2]) : null,
      loan_amount: mortgage ? amount(r[7]) : null, loan_type: mortgage ? nullable(r[8]) : null,
      lender_name: mortgage ? nullable(r[10]) : null, lead_date: mortgage ? sourceDate : null, notes: notes || null, dnc,
      last_disposition: dnc ? "do not call" : /bad\s*(#|number)|wrong\s*number/i.test(notes) ? "bad number" : /no\s*(answer|a\b)|dint\s*answer|didn['’]?t\s*answer/i.test(notes) ? "no answer" : null,
      issues,
      raw: {
        source_type: source.kind, source_key: source.key, source_layout: layout, source_row: index + 1,
        state_evidence: state ? "supplier_explicit" : "unknown", original_state: rawState,
        policy_ownership_claim: mortgage ? null : "supplier_reported",
        policy_status_claim: master ? nullable(r[10]) : null, policy_status_verified_at: null,
        supplier_amount: mortgage ? null : amount(r[master ? 14 : 9]), supplier_amount_cadence: "unknown",
        original_phone: text(rawPhone), original_email: text(rawEmail),
        import_review_required: issues.some(i => i !== "invalid_email"), import_issues: issues,
      },
    });
  });
  return { rows, headersSkipped, emptySkipped,
    review: rows.filter(r => r.raw.import_review_required).length,
    suppressed: rows.filter(r => r.dnc).length,
    validEmails: rows.filter(r => r.email).length,
  };
}
