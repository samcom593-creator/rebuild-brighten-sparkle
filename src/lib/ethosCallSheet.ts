/**
 * Ethos call sheet (MP-ETHOS-CALLSHEET, 2026-11-19): the pure rules behind /dashboard/ethos-call-sheet.
 *
 * Sam: "people who already have my Ethos contract ... that I can call on the spot, figure out what made
 * them drop off, and get them rolling." The list is everyone on the Ethos hierarchy performance export;
 * a manager sees the people under them, the owner sees everyone (enforced by ethos_call_sheet()).
 *
 * Kept free of React and Supabase so the lane rules, the call order and the export parser can be tested.
 */

export type CallOutcome =
  | "no_answer"
  | "voicemail"
  | "texted"
  | "callback"
  | "coming_back"
  | "needs_help"
  | "not_interested"
  | "wrong_number";

export type DropOffReason =
  | "no_leads"
  | "other_job"
  | "other_agency"
  | "portal_or_contracting"
  | "no_training"
  | "no_sales"
  | "life"
  | "no_follow_up"
  | "other";

export const OUTCOME_LABEL: Record<CallOutcome, string> = {
  no_answer: "No answer",
  voicemail: "Left voicemail",
  texted: "Texted",
  callback: "Call back later",
  coming_back: "Coming back",
  needs_help: "Wants in, needs help",
  not_interested: "Not interested",
  wrong_number: "Wrong number",
};

/** The results that mean a real conversation happened, in the order the form offers them. */
export const SPOKE_OUTCOMES: CallOutcome[] = ["coming_back", "needs_help", "callback", "not_interested"];

export const REASON_LABEL: Record<DropOffReason, string> = {
  no_leads: "No leads or could not afford them",
  no_training: "Did not know how to start",
  no_sales: "Tried, did not close",
  portal_or_contracting: "Portal, login or contracting problem",
  no_follow_up: "Nobody followed up with them",
  other_job: "Took another job or no time",
  other_agency: "Went to another agency",
  life: "Personal or life",
  other: "Something else",
};

export const REASON_ORDER: DropOffReason[] = [
  "no_leads",
  "no_training",
  "no_sales",
  "portal_or_contracting",
  "no_follow_up",
  "other_job",
  "other_agency",
  "life",
  "other",
];

export interface EthosCallSheetRow {
  id: string;
  full_name: string;
  npn: string | null;
  phone: string | null;
  email: string | null;
  comp_level: string | null;
  sub_agency: string | null;
  manager_name: string | null;
  first_seen_on: string | null;
  first_seen_source: string | null;
  issued_premium: number;
  inforce_premium: number;
  persistency_4m: number | null;
  persistency_7m: number | null;
  persistency_13m: number | null;
  chargeback_total: number | null;
  chargeback_personal: number | null;
  snapshot_on: string;
  in_app: boolean;
  /** The person's standing in this app: active, inactive or terminated. Null when they have no record here. */
  standing: string | null;
  license: string | null;
  has_login: boolean | null;
  last_sign_in_at: string | null;
  lifetime_ap: number | null;
  last_deal_on: string | null;
  deals_30d: number | null;
  last_outcome: CallOutcome | null;
  last_reason: DropOffReason | null;
  last_note: string | null;
  follow_up_on: string | null;
  last_called_at: string | null;
  last_called_by: string | null;
  calls: number;
}

export interface EthosCallSheetPayload {
  sees_all: boolean;
  snapshot_on: string | null;
  rows: EthosCallSheetRow[];
}

export type CallLane = "call_now" | "follow_up" | "coming_back" | "needs_action" | "closed" | "selling" | "left";
export type CallLaneFilter = CallLane | "all";

export const LANES: { key: CallLaneFilter; label: string; hint: string }[] = [
  { key: "call_now", label: "Call now", hint: "Has the contract, nothing in force, nobody has called yet." },
  { key: "follow_up", label: "Follow up", hint: "Tried or asked for a call back. Not resolved yet." },
  { key: "coming_back", label: "Coming back", hint: "Said yes. Get them selling." },
  { key: "needs_action", label: "Needs action", hint: "Wants in but is blocked, or the number is wrong." },
  { key: "closed", label: "Not interested", hint: "Spoke to them and they are done." },
  { key: "selling", label: "Already selling", hint: "Has Ethos premium in force." },
  { key: "left", label: "Left the agency", hint: "Marked terminated in this app. Still holds the Ethos contract." },
  { key: "all", label: "Everyone", hint: "Every person on the export you can see." },
];

/**
 * One lane per person. What was said on the last call wins; with no call yet, a person who left sits apart,
 * a person with Ethos premium in force is already selling, and everyone else is a call to make now.
 */
export function laneOf(row: Pick<EthosCallSheetRow, "last_outcome" | "standing" | "inforce_premium">): CallLane {
  switch (row.last_outcome) {
    case "not_interested":
      return "closed";
    case "coming_back":
      return "coming_back";
    case "needs_help":
    case "wrong_number":
      return "needs_action";
    case "no_answer":
    case "voicemail":
    case "texted":
    case "callback":
      return "follow_up";
    default:
      break;
  }
  if (row.standing === "terminated") return "left";
  if (Number(row.inforce_premium) > 0) return "selling";
  return "call_now";
}

export function formatDollars(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "$0";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function daysBetween(fromIso: string, now: number): number | null {
  const t = Date.parse(fromIso);
  if (!Number.isFinite(t)) return null;
  return Math.floor((now - t) / 86_400_000);
}

export interface CallAngle {
  /** 1 is the easiest pick. */
  tier: 1 | 2 | 3 | 4;
  text: string;
}

/**
 * Why this person is worth a call, and how early in the list they belong.
 *   1  wrote Ethos business and none of it is in force: already knows the product
 *   2  sold in this app but never on Ethos: a working producer with an unused contract
 *   3  signed in to the app in the last 30 days: still paying attention
 *   4  holds the contract and has never sold
 */
export function callAngle(
  row: Pick<EthosCallSheetRow, "issued_premium" | "inforce_premium" | "lifetime_ap" | "last_sign_in_at">,
  now: number = Date.now(),
): CallAngle {
  const issued = Number(row.issued_premium) || 0;
  const inforce = Number(row.inforce_premium) || 0;
  const appAp = Number(row.lifetime_ap) || 0;
  if (issued > 0 && inforce <= 0) {
    return { tier: 1, text: `Wrote ${formatDollars(issued)} on Ethos, none of it in force` };
  }
  if (issued <= 0 && appAp > 0) {
    return { tier: 2, text: `Sold ${formatDollars(appAp)} here, nothing on Ethos yet` };
  }
  const sinceLogin = row.last_sign_in_at ? daysBetween(row.last_sign_in_at, now) : null;
  if (issued <= 0 && sinceLogin !== null && sinceLogin <= 30) {
    return { tier: 3, text: "Signed in this month, never sold on Ethos" };
  }
  if (issued > 0) {
    return { tier: 3, text: `${formatDollars(inforce)} in force on Ethos` };
  }
  return { tier: 4, text: "Has the contract, never sold" };
}

function timeOrZero(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

/**
 * The order to work a lane in.
 *   follow up   a call back that is due comes first (earliest date), then the oldest attempt
 *   otherwise   easiest pick first, then most recent sign-in, then newest to the team, then name
 */
export function sortForLane(rows: EthosCallSheetRow[], lane: CallLaneFilter, now: number = Date.now()): EthosCallSheetRow[] {
  const copy = [...rows];
  if (lane === "follow_up") {
    return copy.sort((a, b) => {
      const fa = a.follow_up_on ?? "9999-12-31";
      const fb = b.follow_up_on ?? "9999-12-31";
      if (fa !== fb) return fa.localeCompare(fb);
      return timeOrZero(a.last_called_at) - timeOrZero(b.last_called_at) || a.full_name.localeCompare(b.full_name);
    });
  }
  return copy.sort((a, b) => {
    const ta = callAngle(a, now).tier;
    const tb = callAngle(b, now).tier;
    if (ta !== tb) return ta - tb;
    const la = timeOrZero(a.last_sign_in_at);
    const lb = timeOrZero(b.last_sign_in_at);
    if (la !== lb) return lb - la;
    const sa = a.first_seen_on ?? "";
    const sb = b.first_seen_on ?? "";
    if (sa !== sb) return sb.localeCompare(sa);
    return a.full_name.localeCompare(b.full_name);
  });
}

/** "3 wk", "8 mo", "1 yr 2 mo". Empty when the start date is unknown. */
export function tenureLabel(firstSeenOn: string | null | undefined, now: number = Date.now()): string {
  if (!firstSeenOn) return "";
  const days = daysBetween(`${firstSeenOn}T12:00:00Z`, now);
  if (days === null || days < 0) return "";
  if (days < 14) return `${Math.max(days, 1)} d`;
  if (days < 60) return `${Math.floor(days / 7)} wk`;
  const months = Math.floor(days / 30.44);
  if (months < 12) return `${months} mo`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return rest ? `${years} yr ${rest} mo` : `${years} yr`;
}

export function monthYear(dateIso: string | null | undefined): string {
  if (!dateIso) return "";
  const t = Date.parse(`${dateIso.slice(0, 10)}T12:00:00Z`);
  if (!Number.isFinite(t)) return "";
  return new Date(t).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

export function shortDate(dateIso: string | null | undefined): string {
  if (!dateIso) return "";
  const t = Date.parse(`${dateIso.slice(0, 10)}T12:00:00Z`);
  if (!Number.isFinite(t)) return "";
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export const FIRST_SEEN_SOURCE_LABEL: Record<string, string> = {
  agent_record: "from their agent record",
  application: "from their application",
  ethos_portal: "from the Ethos portal date",
};

/* ----------------------------------------------------------------------------------------------------
 * Ethos export parser. The portal's "Performance summary, hierarchy" export is a CSV whose header is:
 *   Name, NPN, Issued Premium, In-Force Issued Premium, Persistency - 4M, Persistency - 7M,
 *   Persistency - 13M, Chargeback - Total Created, Chargeback - Personal
 * A dash means "no value". Columns are found by name, so a reordered export still loads.
 * -------------------------------------------------------------------------------------------------- */

export interface EthosExportRow {
  name: string;
  npn: string;
  issued: string;
  inforce: string;
  p4: string;
  p7: string;
  p13: string;
  cb_total: string;
  cb_personal: string;
}

export interface EthosExportParse {
  rows: EthosExportRow[];
  error: string | null;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      out.push(cell);
      cell = "";
    } else {
      cell += ch;
    }
  }
  out.push(cell);
  return out.map((c) => c.trim());
}

function headerKey(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function numberCell(value: string | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw || raw === "-") return "";
  const cleaned = raw.replace(/[$,\s]/g, "");
  return /^-?\d+(\.\d+)?$/.test(cleaned) ? cleaned : "";
}

export function parseEthosExport(text: string): EthosExportParse {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return { rows: [], error: "That file has no rows." };
  const header = splitCsvLine(lines[0]).map(headerKey);
  const col = (key: string) => header.indexOf(key);
  const iName = col("name");
  const iNpn = col("npn");
  const iIssued = col("issuedpremium");
  const iInforce = col("inforceissuedpremium");
  if (iName < 0 || iIssued < 0 || iInforce < 0) {
    return {
      rows: [],
      error: "This is not the Ethos hierarchy performance export. It needs Name, Issued Premium and In-Force Issued Premium columns.",
    };
  }
  const iP4 = col("persistency4m");
  const iP7 = col("persistency7m");
  const iP13 = col("persistency13m");
  const iCbTotal = col("chargebacktotalcreated");
  const iCbPersonal = col("chargebackpersonal");
  const rows: EthosExportRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const name = (cells[iName] ?? "").trim();
    if (!name) continue;
    rows.push({
      name,
      npn: iNpn >= 0 ? (cells[iNpn] ?? "").replace(/\D/g, "") : "",
      issued: numberCell(cells[iIssued]),
      inforce: numberCell(cells[iInforce]),
      p4: iP4 >= 0 ? numberCell(cells[iP4]) : "",
      p7: iP7 >= 0 ? numberCell(cells[iP7]) : "",
      p13: iP13 >= 0 ? numberCell(cells[iP13]) : "",
      cb_total: iCbTotal >= 0 ? numberCell(cells[iCbTotal]) : "",
      cb_personal: iCbPersonal >= 0 ? numberCell(cells[iCbPersonal]) : "",
    });
  }
  if (rows.length === 0) return { rows: [], error: "No people found in that file." };
  return { rows, error: null };
}
