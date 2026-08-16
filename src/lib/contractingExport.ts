/**
 * Admin export for the contracting workbook.
 *
 * There is no hosted workbook destination configured for this project — Sam's
 * updated workbook is an .xlsx file on a laptop, and a file on one machine
 * cannot be a production sink. Rather than claim a sync that is not happening,
 * the contracting page says "Not configured" and offers this: a real export of
 * the authoritative database rows, in the workbook's own column order, that a
 * person can paste in.
 *
 * The database is the source of truth. This is a mirror of it, produced on
 * demand, and it never pretends to be the reverse.
 */

export type ContractingExportRow = {
  intake_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone_e164: string;
  npn: string;
  status: string;
  created_at: string;
};

/** The workbook's Contracting Intake column order. */
export const WORKBOOK_COLUMNS = [
  "Intake ID",
  "First Name",
  "Last Name",
  "NPN",
  "Mobile Number",
  "Email",
  "Status",
  "Submitted",
] as const;

/**
 * Escape one CSV field.
 *
 * Quotes anything containing a comma, a quote, a newline — and anything
 * starting with =, +, - or @, which spreadsheet software otherwise evaluates as
 * a formula. A producer surname beginning with a hyphen should land in a cell,
 * not execute; the leading apostrophe is the standard neutraliser.
 */
export function csvField(value: unknown): string {
  const raw = value === null || value === undefined ? "" : String(value);
  const deFanged = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(deFanged) ? `"${deFanged.replace(/"/g, '""')}"` : deFanged;
}

export function formatPhoneForWorkbook(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164 ?? "");
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : (e164 ?? "");
}

export function buildContractingCsv(rows: ContractingExportRow[]): string {
  const lines = [WORKBOOK_COLUMNS.map(csvField).join(",")];
  for (const row of rows) {
    lines.push([
      row.intake_id,
      row.first_name,
      row.last_name,
      row.npn,
      formatPhoneForWorkbook(row.phone_e164),
      row.email,
      row.status,
      row.created_at,
    ].map(csvField).join(","));
  }
  // Trailing newline so the last row is a complete line for every consumer.
  return `${lines.join("\n")}\n`;
}

export function contractingCsvFilename(now: Date): string {
  const stamp = now.toISOString().slice(0, 10);
  return `apex-contracting-intakes-${stamp}.csv`;
}

/**
 * The Ethos Agent Portal signup sheet's column order (A–I).
 *
 * Proven by the 2026-07-16 fill of 188 agents into that sheet: First, Last, NPN,
 * agent number (unknown at intake time — the carrier issues it later, so it stays
 * blank), Phone, Email, a blank column, advance option, organization.
 *
 * Ethos is a third party's private Google Sheet and no service credential exists,
 * so nothing can write to it over an API today. This produces a file whose
 * columns line up with the sheet exactly, so the row pastes in without retyping
 * or re-ordering. Sam's own contract workbook uses buildContractingCsv above —
 * different sheet, different columns, deliberately not shared.
 */
export const ETHOS_COLUMNS = [
  "First Name",
  "Last Name",
  "NPN",
  "Agent Number",
  "Phone",
  "Email",
  "",
  "Advance",
  "Organization",
] as const;

export function buildEthosCsv(rows: ContractingExportRow[]): string {
  const lines = [ETHOS_COLUMNS.map(csvField).join(",")];
  for (const row of rows) {
    lines.push([
      row.first_name,
      row.last_name,
      row.npn,
      "",
      formatPhoneForWorkbook(row.phone_e164),
      row.email,
      "",
      "6 Month Advance",
      "Apex Financial Empire",
    ].map(csvField).join(","));
  }
  return `${lines.join("\n")}\n`;
}

export function ethosCsvFilename(now: Date): string {
  return `apex-ethos-signup-${now.toISOString().slice(0, 10)}.csv`;
}
