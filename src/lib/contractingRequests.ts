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

/** My Team: who opened the contracting link, in order, and who never did. */
export interface LinkActivityRow {
  agent_id: string; display_name: string; start_date: string | null;
  opened: boolean; first_opened_at: string | null; last_opened_at: string | null; opens: number;
  profile_saved: boolean; details_saved: boolean; marked_count: number; request_status: RequestStatus | null;
}
export interface LinkActivityPayload { ok: boolean; count: number; opened: number; rows: LinkActivityRow[] }

export async function fetchLinkActivity(): Promise<LinkActivityPayload> {
  const { data, error } = await supabase.rpc("contracting_link_activity" as never);
  if (error) throw new Error(error.message);
  const p = data as unknown as LinkActivityPayload | null;
  if (!p || p.ok !== true || !Array.isArray(p.rows)) throw new Error("The link activity did not load completely.");
  return p;
}
