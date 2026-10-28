/**
 * The five contracting fields an inviter knows up front (first name, last name,
 * email, phone, NPN), kept with the invitation so the team can copy them into a
 * carrier or SureLC page one field at a time (Sam, 2026-10-28: "make it easy to
 * copy and paste through website for easy contracting").
 *
 * Where they live: invite_tokens has recipient_name, recipient_email and
 * recipient_phone, but list_invitations() returns no phone and there is no NPN
 * or first/last column. Rather than a schema change, the inviter's values ride
 * in the invitation's internal note (team-only, never shown on the recruit's
 * offer) as one leading line:
 *
 *   Contracting: First=Mary Ann; Last=Smith; Phone=2569756155; NPN=1234567
 *   <the free-text note, if any>
 *
 * The server trims notes to 200 characters (fn_invite_insert), so the form gives
 * the free note only what the line leaves. A note written before this format, or
 * by hand, decodes as a plain note with no fields; the name then falls back to
 * splitting recipient_name. A dedicated column is the proper long-term home.
 */
import { normalizeNpn } from "@/lib/contractingIntake";

export const INVITE_NOTE_LIMIT = 200;
const PREFIX = "Contracting: ";

export interface InviteContractingFields {
  firstName: string;
  lastName: string;
  phone: string;
  npn: string;
}

export interface ContractingInfo extends InviteContractingFields {
  email: string;
}

const KEYS: Array<[keyof InviteContractingFields, string]> = [
  ["firstName", "First"],
  ["lastName", "Last"],
  ["phone", "Phone"],
  ["npn", "NPN"],
];

/** The separators are the only characters a value cannot hold. */
const clean = (v: string) => (v ?? "").replace(/[;=\n\r]/g, " ").replace(/\s+/g, " ").trim();

/** The leading line for these fields, or "" when every field is empty. Phone and NPN are stored as digits. */
export function contractingLine(fields: InviteContractingFields): string {
  const values: InviteContractingFields = {
    firstName: clean(fields.firstName),
    lastName: clean(fields.lastName),
    phone: (fields.phone ?? "").replace(/\D/g, ""),
    npn: normalizeNpn(fields.npn ?? "") ?? "",
  };
  const parts = KEYS.filter(([k]) => values[k]).map(([k, label]) => `${label}=${values[k]}`);
  return parts.length ? `${PREFIX}${parts.join("; ")}` : "";
}

/** How many characters the free note may use after the contracting line. */
export function freeNoteRoom(fields: InviteContractingFields): number {
  const line = contractingLine(fields);
  return Math.max(0, INVITE_NOTE_LIMIT - (line ? line.length + 1 : 0));
}

/** The note to send: the contracting line, then the free note, never over the server's limit. */
export function encodeInviteNote(fields: InviteContractingFields, note: string): string | null {
  const line = contractingLine(fields);
  const free = (note ?? "").trim().slice(0, freeNoteRoom(fields));
  const out = [line, free].filter(Boolean).join("\n");
  return out || null;
}

/** Split a stored note back into its fields and the free note. Unknown text stays in the note. */
export function decodeInviteNote(notes: string | null | undefined): { fields: Partial<InviteContractingFields>; note: string } {
  const text = notes ?? "";
  if (!text.startsWith(PREFIX)) return { fields: {}, note: text.trim() };
  const newline = text.indexOf("\n");
  const line = newline === -1 ? text : text.slice(0, newline);
  const rest = newline === -1 ? "" : text.slice(newline + 1);
  const fields: Partial<InviteContractingFields> = {};
  for (const part of line.slice(PREFIX.length).split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const label = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    const key = KEYS.find(([, l]) => l === label)?.[0];
    if (key && value) fields[key] = value;
  }
  return { fields, note: rest.trim() };
}

/** First and last from a single stored name: everything before the last word, and the last word. */
export function splitName(name: string | null | undefined): { firstName: string; lastName: string } {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { firstName: "", lastName: "" };
  if (words.length === 1) return { firstName: words[0], lastName: "" };
  return { firstName: words.slice(0, -1).join(" "), lastName: words[words.length - 1] };
}

/** Everything known for an invitation row, preferring what the inviter typed field by field. */
export function contractingInfoFor(row: { recipient_name: string | null; recipient_email: string | null; notes: string | null }): ContractingInfo {
  const { fields } = decodeInviteNote(row.notes);
  const fallback = splitName(row.recipient_name);
  return {
    firstName: fields.firstName ?? fallback.firstName,
    lastName: fields.lastName ?? fallback.lastName,
    email: row.recipient_email ?? "",
    phone: fields.phone ?? "",
    npn: fields.npn ?? "",
  };
}

/** "(256) 975-6155" for ten digits; anything else as given. */
export function displayPhone(digits: string): string {
  const d = (digits ?? "").replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return ten.length === 10 ? `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}` : digits;
}

/** One block for "Copy all": one "Label: value" per line, skipping blanks. */
export function contractingBlock(info: ContractingInfo): string {
  return [
    ["First name", info.firstName],
    ["Last name", info.lastName],
    ["Email", info.email],
    ["Phone", info.phone ? displayPhone(info.phone) : ""],
    ["NPN", info.npn],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
}
