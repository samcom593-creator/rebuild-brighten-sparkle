/**
 * Lead search and the applicant duplicate guard behind the Calendar's
 * "Schedule interview" dialog (F30 in the 2026-10-14 Galaxy OS map).
 *
 * What these encode:
 *   - A failed read is reported as an error, never as "no match". The page
 *     offers "Add New Applicant" only after a search that completed with no
 *     rows.
 *   - Typed text is LIKE-escaped and quoted before it enters a PostgREST
 *     .or() filter, so a comma, parenthesis, % or _ is searched for rather
 *     than interpreted. A comma used to be a request error that the page
 *     read as "no leads found".
 *   - The duplicate check before an insert is an exact .in() match on email
 *     and phone, never a pattern match. The server's own rule
 *     (trg_applications_flag_duplicates, BEFORE INSERT) is: same email,
 *     case-insensitive, among live rows not already flagged; the oldest such
 *     row is canonical and a flagged row points at it through duplicate_of.
 *     Rows the server would call canonical are listed first and a pointer is
 *     followed one hop.
 *   - Responses carry a sequence number so a slow, older response can never
 *     replace the result of a newer request.
 *
 * Reads take the client as an argument so tests drive them with a stub.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { escapeLikePattern } from "@/lib/like-escape";
import { errorMessage } from "@/lib/queryState";

export const LEAD_SEARCH_MIN_CHARS = 2;
export const LEAD_SEARCH_DEBOUNCE_MS = 250;
export const LEAD_SEARCH_LIMIT = 10;
export const DUPLICATE_LOOKUP_LIMIT = 20;
export const LEAD_COLUMNS = "id, first_name, last_name, email, phone, status, is_duplicate, duplicate_of";
export const LEAD_SEARCH_COLUMNS = ["first_name", "last_name", "email", "phone"] as const;

export type LeadResult = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  status: string;
  is_duplicate: boolean | null;
  duplicate_of: string | null;
};

export type LeadSearchClient = Pick<SupabaseClient<Database>, "from">;

/**
 * Quote a value for a PostgREST filter list. Inside double quotes the list
 * separators and operators (, . : ( )) are plain characters; a backslash
 * escapes the next character, so backslashes and quotes in the value are
 * escaped first.
 */
export function quoteFilterValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * The .or() filter for a free-text lead search: every searched column gets
 * the same contains-pattern, LIKE-escaped (%, _, \ and *, which PostgREST
 * rewrites to %) and quoted. Empty when the text is too short to search.
 */
export function leadSearchFilter(query: string): string {
  const text = query.trim();
  if (text.length < LEAD_SEARCH_MIN_CHARS) return "";
  const pattern = quoteFilterValue(`%${escapeLikePattern(text)}%`);
  return LEAD_SEARCH_COLUMNS.map((column) => `${column}.ilike.${pattern}`).join(",");
}

export type LeadSearchOutcome =
  | { status: "short" }
  | { status: "ready"; rows: LeadResult[] }
  | { status: "error"; error: unknown };

/** One search request. "ready" with no rows means the read completed and matched nothing. */
export async function searchLeads(client: LeadSearchClient, query: string): Promise<LeadSearchOutcome> {
  const filter = leadSearchFilter(query);
  if (!filter) return { status: "short" };
  try {
    const { data, error } = await client
      .from("applications")
      .select(LEAD_COLUMNS)
      .or(filter)
      .is("terminated_at", null)
      .limit(LEAD_SEARCH_LIMIT);
    if (error) return { status: "error", error };
    if (!Array.isArray(data)) return { status: "error", error: new Error("The lead search returned no result.") };
    return { status: "ready", rows: data as unknown as LeadResult[] };
  } catch (err) {
    return { status: "error", error: err };
  }
}

export type LatestGuard = {
  /** Take the next sequence number for a request about to be sent. */
  next: () => number;
  /** True only for the most recently issued sequence number. */
  isLatest: (seq: number) => boolean;
  /** Make every in-flight request stale, for example when the dialog closes. */
  invalidate: () => void;
};

/** Ordered requests: a response is applied only if no newer request was issued after it. */
export function createLatestGuard(): LatestGuard {
  let latest = 0;
  return {
    next: () => {
      latest += 1;
      return latest;
    },
    isLatest: (seq) => seq === latest,
    invalidate: () => {
      latest += 1;
    },
  };
}

/** The exact values an email is compared against: as typed, plus lower-cased when that differs. */
export function emailMatchValues(email: string): string[] {
  const trimmed = email.trim();
  if (!trimmed) return [];
  const lower = trimmed.toLowerCase();
  return lower === trimmed ? [trimmed] : [trimmed, lower];
}

/**
 * The exact values a phone is compared against. The table stores numbers as
 * bare digits, 1 + digits or +1 + digits (measured 2026-10-15: 577 / 189 of
 * 824 live phones, 58 in other formats), so every one of those spellings of
 * a ten-digit number is tried, plus the text as typed.
 */
export function phoneMatchValues(phone: string): string[] {
  const trimmed = phone.trim();
  if (!trimmed) return [];
  const digits = trimmed.replace(/\D/g, "");
  const values = new Set<string>([trimmed]);
  if (digits) values.add(digits);
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (national.length === 10) {
    values.add(national);
    values.add(`1${national}`);
    values.add(`+1${national}`);
  }
  return Array.from(values);
}

export type LeadMatch = LeadResult & { matchedOn: "email" | "phone" };

/** A row the server has not flagged as a duplicate of another row. */
export function isCanonicalLead(row: Pick<LeadResult, "is_duplicate">): boolean {
  return row.is_duplicate !== true;
}

/** Canonical rows first; otherwise the input order is kept (Array.prototype.sort is stable). */
export function orderCanonicalFirst<T extends Pick<LeadResult, "is_duplicate">>(rows: T[]): T[] {
  return [...rows].sort((a, b) => Number(!isCanonicalLead(a)) - Number(!isCanonicalLead(b)));
}

/** duplicate_of targets that are not already among the rows, in first-seen order. */
export function unresolvedCanonicalIds(rows: LeadResult[]): string[] {
  const present = new Set(rows.map((row) => row.id));
  const ids: string[] = [];
  for (const row of rows) {
    if (row.is_duplicate === true && row.duplicate_of && !present.has(row.duplicate_of) && !ids.includes(row.duplicate_of)) {
      ids.push(row.duplicate_of);
    }
  }
  return ids;
}

export type DuplicateLookup =
  | { status: "none" }
  | { status: "found"; matches: LeadMatch[]; byEmail: boolean }
  | { status: "error"; message: string };

type LeadRead = { data: unknown; error: { message: string } | null };

function readRows(result: LeadRead, what: string): { rows: LeadResult[] } | { message: string } {
  if (result.error) return { message: errorMessage(result.error) };
  if (!Array.isArray(result.data)) return { message: `${what} returned no result.` };
  return { rows: result.data as LeadResult[] };
}

/**
 * Exact-match lookup of live applicants by email and phone, run before an
 * insert. "none" is returned only when every read completed and matched
 * nothing; any failed read is "error", so the caller never creates a record
 * on the strength of a lookup that did not happen.
 */
export async function findExistingApplicants(
  client: LeadSearchClient,
  input: { email: string; phone?: string | null },
): Promise<DuplicateLookup> {
  const emails = emailMatchValues(input.email);
  const phones = phoneMatchValues(input.phone ?? "");
  const matches = new Map<string, LeadMatch>();
  const add = (rows: LeadResult[], matchedOn: "email" | "phone") => {
    for (const row of rows) if (!matches.has(row.id)) matches.set(row.id, { ...row, matchedOn });
  };
  try {
    if (emails.length) {
      const read = readRows(
        await client
          .from("applications")
          .select(LEAD_COLUMNS)
          .is("terminated_at", null)
          .in("email", emails)
          .order("created_at", { ascending: true })
          .limit(DUPLICATE_LOOKUP_LIMIT),
        "The email check",
      );
      if ("message" in read) return { status: "error", message: read.message };
      add(read.rows, "email");
    }
    if (phones.length) {
      const read = readRows(
        await client
          .from("applications")
          .select(LEAD_COLUMNS)
          .is("terminated_at", null)
          .in("phone", phones)
          .order("created_at", { ascending: true })
          .limit(DUPLICATE_LOOKUP_LIMIT),
        "The phone check",
      );
      if ("message" in read) return { status: "error", message: read.message };
      add(read.rows, "phone");
    }
    const pointers = unresolvedCanonicalIds(Array.from(matches.values()));
    if (pointers.length) {
      const read = readRows(
        await client.from("applications").select(LEAD_COLUMNS).in("id", pointers).limit(DUPLICATE_LOOKUP_LIMIT),
        "The canonical lookup",
      );
      if ("message" in read) return { status: "error", message: read.message };
      const found = Array.from(matches.values());
      for (const row of read.rows) {
        if (matches.has(row.id)) continue;
        const pointer = found.find((match) => match.duplicate_of === row.id);
        matches.set(row.id, { ...row, matchedOn: pointer?.matchedOn ?? "email" });
      }
    }
  } catch (err) {
    return { status: "error", message: errorMessage(err, "The duplicate check could not run.") };
  }
  if (matches.size === 0) return { status: "none" };
  const ordered = orderCanonicalFirst(Array.from(matches.values()));
  return { status: "found", matches: ordered, byEmail: ordered.some((match) => match.matchedOn === "email") };
}

export type LeadFetch =
  | { status: "ready"; lead: LeadResult | null }
  | { status: "error"; message: string };

/** One applicant by primary key. A failed read is "error", not a missing applicant. */
export async function fetchLeadById(client: LeadSearchClient, id: string): Promise<LeadFetch> {
  try {
    const read = readRows(
      await client.from("applications").select(LEAD_COLUMNS).eq("id", id).limit(1),
      "The applicant lookup",
    );
    if ("message" in read) return { status: "error", message: read.message };
    return { status: "ready", lead: read.rows[0] ?? null };
  } catch (err) {
    return { status: "error", message: errorMessage(err, "The applicant lookup could not run.") };
  }
}
