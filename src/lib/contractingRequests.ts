/**
 * Contracting requests: the 14-column carrier/IMO template, filled from verified records (migration
 * 20261014180000). The database builds every row (one mapping for the screen, the export and the submit path); this
 * module only reads, formats and exports. Nothing here invents a value.
 */
import { supabase } from "@/integrations/supabase/client";

/** The destination's headers, in order. The export and the sheet sync both refuse to deviate from these. */
export const CONTRACTING_HEADERS = [
  "Request Type",
  "Agent First Name (as appears on license)",
  "Agent Last Name (as appears on license)",
  "NPN",
  "Agent Email Address",
  "Agency Name (if applicable)",
  "Agency TIN (if applicable)",
  "Agency NPN (if applicable)",
  "Direct Upline",
  "Commission Level",
  "Advance?",
  "DOB",
  "Residential Address",
  "Agent Phone",
] as const;

export type RequestStatus = "draft" | "missing_information" | "needs_review" | "ready_to_submit" | "submitted" | "approved" | "declined" | "archived";
export type SheetStatus = "queued" | "processing" | "synced" | "failed" | "not_configured";

export interface RequestRow {
  agent_id: string;
  display_name: string;
  start_date: string | null;
  request_type: "contracting";
  first_name: string | null; first_name_source: string | null;
  last_name: string | null; last_name_source: string | null;
  npn: string | null; npn_source: string | null;
  email: string | null; email_source: string | null;
  agency_name: string | null; agency_tin: string | null; agency_npn: string | null; agency_applicability: string;
  direct_upline: string | null; direct_upline_id: string | null; direct_upline_source: string | null;
  commission_level_pct: number | null; commission_level: string | null; commission_level_source: string | null;
  advance: string | null; advance_source: string | null;
  dob: string | null;
  residential_address: string | null; residential_state: string | null;
  phone: string | null; phone_source: string | null;
  request_id: string | null; request_status: RequestStatus | null; request_version: number | null; submitted_at: string | null;
  sheet_status: SheetStatus | null; sheet_synced_at: string | null; sheet_error: string | null; sheet_row: number | null;
  snapshot: Record<string, unknown> | null;
  missing: string[];
  status: RequestStatus;
  next_action: string;
  owner: "agent" | "admin" | "imo" | "none";
}

export interface RequestsPayload {
  ok: boolean;
  agents: number;
  requests: number;
  default_advance: string | null;
  sheet: { id: string | null; last_synced_at: string | null; queued: number; failed: number; last_error: string | null };
  rows: RequestRow[];
}

export const STATUS_LABEL: Record<RequestStatus, string> = {
  draft: "Draft", missing_information: "Missing information", needs_review: "Needs review", ready_to_submit: "Ready to submit",
  submitted: "Submitted", approved: "Approved", declined: "Declined", archived: "Archived",
};

export const FIELD_LABEL: Record<string, string> = {
  first_name: "Legal first name", last_name: "Legal last name", npn: "NPN", email: "Email", direct_upline: "Direct upline",
  commission_level: "Commission level", advance: "Advance", dob: "DOB", residential_address: "Residential address", phone: "Phone",
};

export type RequestView = "attention" | "ready" | "submitted" | "all";
export const VIEWS: Array<{ key: RequestView; label: string }> = [
  { key: "attention", label: "Needs attention" },
  { key: "ready", label: "Ready to submit" },
  { key: "submitted", label: "Submitted" },
  { key: "all", label: "All" },
];

export function inView(r: RequestRow, v: RequestView): boolean {
  if (v === "all") return true;
  if (v === "ready") return r.status === "ready_to_submit";
  if (v === "submitted") return r.status === "submitted" || r.status === "approved";
  // Needs attention: missing information, a review hold, or a submitted row whose sheet write is not landing.
  return r.status === "missing_information" || r.status === "needs_review" || (r.status === "submitted" && (r.sheet_status === "failed" || r.sheet_status === "not_configured"));
}

/** "130" -> "130%", "130.5" -> "130.5%". A level is a percentage of a contract, never a fraction and never the advance. */
export function levelText(pct: number | string | null | undefined): string {
  if (pct == null || pct === "") return "";
  const n = typeof pct === "number" ? pct : Number(pct);
  if (!Number.isFinite(n)) return "";
  return `${String(n)}%`;
}

/** A cell that starts like a formula is written as text, so imported names and notes can never execute. */
export function cellText(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

/** The 14 values for one row, in header order, as the destination expects them. */
export function toExportRow(r: RequestRow): string[] {
  const s = (r.snapshot ?? null) as Record<string, unknown> | null;
  const pick = (k: keyof RequestRow) => (s && k in s ? (s[k as string] as unknown) : r[k]);
  const dob = pick("dob") ? String(pick("dob")).slice(0, 10) : "";
  return [
    "contracting",
    cellText(pick("first_name")), cellText(pick("last_name")), cellText(pick("npn")), cellText(pick("email")),
    cellText(pick("agency_name")), cellText(pick("agency_tin")), cellText(pick("agency_npn")),
    cellText(pick("direct_upline")), cellText(pick("commission_level")), cellText(pick("advance")),
    cellText(dob), cellText(pick("residential_address")), cellText(pick("phone")),
  ];
}

function csvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** A CSV of exactly the 14 headers and the given rows, text identifiers preserved. */
export function toCsv(rows: RequestRow[]): string {
  const lines = [CONTRACTING_HEADERS.map(csvCell).join(",")];
  for (const r of rows) lines.push(toExportRow(r).map(csvCell).join(","));
  return lines.join("\r\n") + "\r\n";
}

export async function fetchContractingRequests(): Promise<RequestsPayload> {
  const { data, error } = await supabase.rpc("contracting_request_rows" as never);
  if (error) throw new Error(error.message);
  const p = data as unknown as RequestsPayload | null;
  if (!p || p.ok !== true || !Array.isArray(p.rows)) throw new Error("The contracting requests did not load completely.");
  return p;
}

export async function submitContractingRequest(agentId: string, advance?: string): Promise<{ ok: boolean; request_id?: string; error?: string; missing?: string[] }> {
  const { data, error } = await supabase.rpc("submit_contracting_request" as never, { p_agent_id: agentId, p_advance: advance ?? null } as never);
  if (error) return { ok: false, error: error.message };
  return (data as unknown as { ok: boolean; request_id?: string; error?: string; missing?: string[] }) ?? { ok: false, error: "The submit did not come back." };
}

export async function setContractingRequestStatus(requestId: string, status: "approved" | "declined" | "archived", note?: string): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.rpc("set_contracting_request_status" as never, { p_request_id: requestId, p_status: status, p_note: note ?? null } as never);
  if (error) return { ok: false, error: error.message };
  return (data as unknown as { ok: boolean; error?: string }) ?? { ok: false, error: "The change did not come back." };
}

export async function setDefaultAdvance(value: string | null): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.rpc("set_contracting_default_advance" as never, { p_value: value } as never);
  if (error) return { ok: false, error: error.message };
  return (data as unknown as { ok: boolean; error?: string }) ?? { ok: false, error: "The change did not come back." };
}

export interface SyncResult { ok: boolean; processed?: number; synced?: number; failed?: number; blocker?: string; error?: string; service_email?: string | null; found?: string[] }

export async function syncContractingSheet(): Promise<SyncResult> {
  const { data, error } = await supabase.functions.invoke("contracting-sheet-sync", { body: { source: "manual" } });
  if (error) return { ok: false, error: error.message };
  return (data as SyncResult) ?? { ok: false, error: "The sync did not answer." };
}

/**
 * My Team › Contracting calls. Sam, 2026-10-14: "easily call agents who already have their license and fell off in the
 * contracting process". The database decides who is on the list and why (contracting_call_list); this module names the
 * next step in plain words, describes the last touch, and builds the text message. Every call or text is logged with
 * one tap (log_contracting_followup) so the list works itself down.
 */
export type CallBucket = "to_call" | "called_recently" | "not_now" | "selling" | "finished";
export type CallReason = "never_opened" | "opened_not_saved" | "missing_details";
export type FollowupChannel = "call" | "text" | "note";
export type FollowupOutcome = "reached" | "will_finish" | "voicemail" | "no_answer" | "not_interested";
export interface CallFollowup { channel: FollowupChannel; outcome: FollowupOutcome | null; at: string; by: string | null; mine: boolean }
export interface CallRow {
  agent_id: string; display_name: string; phone: string | null;
  license_states: string[] | null; licensed_at: string | null; start_date: string | null;
  bucket: CallBucket; reason: CallReason;
  last_opened_at: string | null; opens: number; marked_count: number;
  profile_saved: boolean; details_saved: boolean; request_status: RequestStatus | null;
  lifetime_deals: number; last_sale: string | null;
  followup: CallFollowup | null;
}
export interface CallListPayload {
  ok: boolean;
  counts: { to_call: number; called_recently: number; not_now: number; selling: number; finished: number; unlicensed: number; no_phone: number; total: number };
  rows: CallRow[];
}

export const OUTCOMES: Array<{ key: FollowupOutcome; label: string }> = [
  { key: "reached", label: "Reached them" },
  { key: "will_finish", label: "Said they'll finish" },
  { key: "voicemail", label: "Voicemail" },
  { key: "no_answer", label: "No answer" },
  { key: "not_interested", label: "Not interested" },
];
const OUTCOME_SHORT: Record<FollowupOutcome, string> = { reached: "reached", will_finish: "will finish", voicemail: "voicemail", no_answer: "no answer", not_interested: "not interested" };

const shortDay = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");

/** "just now" / "12 min ago" / "3 h ago" / "4 d ago"; a future stamp reads as now, never negative. */
export function ago(iso: string | null | undefined, nowMs: number = Date.now()): string {
  if (!iso) return "";
  const m = Math.max(0, Math.round((nowMs - new Date(iso).getTime()) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

/** "Licensed FL since Aug 25" when known, "Licensed since Aug 25", or just "Licensed". */
export function licenseText(r: Pick<CallRow, "license_states" | "licensed_at">): string {
  const states = (r.license_states ?? []).filter(Boolean).slice(0, 2);
  return `Licensed${states.length ? ` ${states.join("/")}` : ""}${r.licensed_at ? ` since ${shortDay(r.licensed_at)}` : ""}`;
}

/** The next thing this person has to do, in the words to say on the phone; for a finished person, what finished it. */
export function callReason(r: Pick<CallRow, "bucket" | "reason" | "last_opened_at" | "opens" | "marked_count" | "request_status" | "lifetime_deals" | "last_sale">, nowMs: number = Date.now()): string {
  if (r.bucket === "finished") {
    return r.marked_count === 4 ? "All four carriers confirmed" : r.request_status === "submitted" || r.request_status === "approved" ? `Request ${r.request_status}` : "Profile, DOB and address saved";
  }
  // A posted deal is contracting evidence the link log cannot see: link opens are only tracked from 2026-10-14.
  if (r.bucket === "selling") return `Selling · ${r.lifetime_deals} ${r.lifetime_deals === 1 ? "deal" : "deals"}${r.last_sale ? `, last ${shortDay(r.last_sale)}` : ""} · no contracting profile saved`;
  const base = r.reason === "missing_details"
    ? "Saved their profile, still needs DOB + address"
    : r.reason === "opened_not_saved"
      ? `Opened the link ${ago(r.last_opened_at, nowMs)}${r.opens > 1 ? ` (${r.opens} times)` : ""}, saved nothing`
      : "No contracting profile saved";
  return r.marked_count > 0 && r.marked_count < 4 ? `${base} · ${r.marked_count} of 4 carriers confirmed` : base;
}

/** "You called 2 h ago · voicemail" / "Maria texted 3 d ago". Empty when nobody has reached out. */
export function followupText(r: Pick<CallRow, "followup">, nowMs: number = Date.now()): string {
  const f = r.followup;
  if (!f) return "";
  const who = f.mine ? "You" : f.by?.trim().split(/\s+/)[0] || "Someone";
  const verb = f.channel === "call" ? "called" : f.channel === "text" ? "texted" : "noted";
  return `${who} ${verb} ${ago(f.at, nowMs)}${f.outcome ? ` · ${OUTCOME_SHORT[f.outcome]}` : ""}`;
}

export function contractingLink(): string {
  return `${typeof window !== "undefined" ? window.location.origin : "https://apex-financial.org"}/dashboard/contracting-profile`;
}

/** The text the Text button pre-fills. First name only; a record whose name is a raw email gets "there". */
export function smsBody(displayName: string, link: string = contractingLink()): string {
  const first = displayName.trim().split(/\s+/)[0] || "";
  const name = first && !first.includes("@") ? first : "there";
  return `Hey ${name}, your contracting isn't finished yet. Finish it here so we can get you contracted: ${link}`;
}

export async function fetchCallList(): Promise<CallListPayload> {
  const { data, error } = await supabase.rpc("contracting_call_list" as never);
  if (error) throw new Error(error.message);
  const p = data as unknown as CallListPayload | null;
  if (!p || p.ok !== true || !Array.isArray(p.rows) || !p.counts) throw new Error("The call list did not load completely.");
  return p;
}

export async function logFollowup(agentId: string, channel: FollowupChannel, outcome?: FollowupOutcome, note?: string): Promise<{ ok: boolean; id?: string; error?: string }> {
  const { data, error } = await supabase.rpc("log_contracting_followup" as never, { p_agent_id: agentId, p_channel: channel, p_outcome: outcome ?? null, p_note: note ?? null } as never);
  if (error) return { ok: false, error: error.message };
  return (data as unknown as { ok: boolean; id?: string; error?: string }) ?? { ok: false, error: "The log did not come back." };
}
