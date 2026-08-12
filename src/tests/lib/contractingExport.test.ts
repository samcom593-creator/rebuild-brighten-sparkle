import { describe, it, expect } from "vitest";

import {
  WORKBOOK_COLUMNS,
  buildContractingCsv,
  contractingCsvFilename,
  csvField,
  formatPhoneForWorkbook,
  type ContractingExportRow,
} from "@/lib/contractingExport";

const ROW: ContractingExportRow = {
  intake_id: "11111111-2222-3333-4444-555555555555",
  first_name: "Jane",
  last_name: "Doe",
  email: "jane.doe@example.com",
  phone_e164: "+16025550143",
  npn: "21346999",
  status: "accepted",
  created_at: "2026-08-12T04:00:00.000Z",
};

describe("contracting export · csv safety", () => {
  it("quotes fields containing commas, quotes or newlines", () => {
    expect(csvField("Doe, Jane")).toBe('"Doe, Jane"');
    expect(csvField('He said "hi"')).toBe('"He said ""hi"""');
    expect(csvField("line1\nline2")).toBe('"line1\nline2"');
    expect(csvField("plain")).toBe("plain");
  });

  it("neutralises formula injection so a surname cannot execute", () => {
    // A producer legitimately named -Smith, or an attacker supplying
    // =HYPERLINK(...), must land in a cell as text. Spreadsheet software
    // evaluates leading =, +, - and @ otherwise.
    expect(csvField("=1+1")).toBe("'=1+1");
    expect(csvField("+1")).toBe("'+1");
    expect(csvField("-Smith")).toBe("'-Smith");
    expect(csvField("@here")).toBe("'@here");
  });

  it("quotes a de-fanged value that also contains a comma", () => {
    expect(csvField("=cmd,x")).toBe("\"'=cmd,x\"");
  });

  it("renders null and undefined as empty, not as the words", () => {
    expect(csvField(null)).toBe("");
    expect(csvField(undefined)).toBe("");
  });
});

describe("contracting export · workbook contract", () => {
  it("emits the workbook's column order", () => {
    const csv = buildContractingCsv([]);
    expect(csv.trim()).toBe(WORKBOOK_COLUMNS.join(","));
  });

  it("writes one line per intake in column order", () => {
    const lines = buildContractingCsv([ROW]).trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe(
      "11111111-2222-3333-4444-555555555555,Jane,Doe,21346999,(602) 555-0143,jane.doe@example.com,accepted,2026-08-12T04:00:00.000Z",
    );
  });

  it("formats the phone the way the workbook holds it", () => {
    expect(formatPhoneForWorkbook("+16025550143")).toBe("(602) 555-0143");
    expect(formatPhoneForWorkbook("weird")).toBe("weird");
  });

  it("ends with a newline so the last row is a complete line", () => {
    expect(buildContractingCsv([ROW]).endsWith("\n")).toBe(true);
  });

  it("names the file by export date", () => {
    expect(contractingCsvFilename(new Date("2026-08-12T04:00:00Z"))).toBe(
      "apex-contracting-intakes-2026-08-12.csv",
    );
  });
});
