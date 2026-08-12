import { describe, it, expect, vi } from "vitest";

// Imported from the SAME module the dispatcher runs. A test that reimplements
// the mapping proves nothing about the code that touches the live sheet.
import {
  ETHOS_AI_COLUMNS,
  COL_NPN,
  COL_EMAIL,
  COL_PHONE,
  COL_COMP_LEVEL,
  buildEthosAiRow,
  buildEthosComment,
  matchEthosRow,
  verifyReadBack,
  formatUsPhoneForSheet,
  detectDataStartRow,
  aiRangeForRow,
  commentRangeForRow,
  rowNumberFromRange,
  type EthosConfig,
  type EthosIntake,
} from "../../../supabase/functions/_shared/ethos.ts";
import { createSheetsClient } from "../../../supabase/functions/_shared/google-sheets.ts";

const CONFIG: EthosConfig = {
  sheet_id: "test-sheet",
  tab: "Agents",
  direct_upline_npn: "21346366",
  advance_pay_tier: "6 Month Advance",
  sub_agency_name: "Apex Financial Empire",
  comment_prefix: "Apex Financial Empire / Level 8 Financial",
};

const INTAKE: EthosIntake = {
  first_name: "Jane",
  last_name: "Doe",
  email: "jane.doe@example.com",
  phone_e164: "+16025550143",
  npn: "21346999",
};

/** A row shaped exactly like the verified ETHOS-agents-paste-A-to-I.tsv export. */
function row(npn: string, email: string, first = "Some", last = "Body"): string[] {
  return [first, last, npn, "21346366", "(608) 201-7833", email, "", "6 Month Advance", "Apex Financial Empire"];
}

describe("ethos · measured column contract", () => {
  it("writes columns A..I only, matching the verified export", () => {
    // The export proves nine columns A..I plus Comments at S. A tenth column
    // here would mean the dispatcher writes into J, which belongs to somebody
    // else's data.
    expect(ETHOS_AI_COLUMNS).toHaveLength(9);
    expect(ETHOS_AI_COLUMNS[COL_NPN]).toBe("Agent NPN");
    expect(ETHOS_AI_COLUMNS[COL_EMAIL]).toBe("Agent Email");
    expect(ETHOS_AI_COLUMNS[COL_PHONE]).toBe("Agent Mobile Number");
  });

  it("does not invent Life Licensed or E&O columns", () => {
    // Earlier notes claimed both. Neither appears anywhere in the verified
    // export, so neither is written, read, or guessed at.
    expect(ETHOS_AI_COLUMNS as readonly string[]).not.toContain("Life Licensed");
    expect(ETHOS_AI_COLUMNS as readonly string[]).not.toContain("E&O");
  });

  it("targets Comments at column S, nine clear of the A..I block", () => {
    expect(aiRangeForRow("Agents", 42)).toBe("Agents!A42:I42");
    expect(commentRangeForRow("Agents", 42)).toBe("Agents!S42:S42");
  });

  it("recovers the landed row number from a Google receipt", () => {
    expect(rowNumberFromRange("Agents!A190:I190")).toBe(190);
    expect(rowNumberFromRange("nonsense")).toBeNull();
  });
});

describe("ethos · row mapping", () => {
  it("maps the five intake fields and the verified APEX configuration", () => {
    const built = buildEthosAiRow(INTAKE, CONFIG);
    expect(built).toEqual([
      "Jane", "Doe", "21346999", "21346366",
      "(602) 555-0143", "jane.doe@example.com",
      "", "6 Month Advance", "Apex Financial Empire",
    ]);
  });

  it("leaves Comp Level blank, as all 188 verified rows do", () => {
    // Comp level is negotiated, not derivable from a five-field intake, and a
    // guessed level has real money consequences.
    expect(buildEthosAiRow(INTAKE, CONFIG)[COL_COMP_LEVEL]).toBe("");
  });

  it("builds a Comments cell carrying the intake id", () => {
    const comment = buildEthosComment(CONFIG, "intake-123");
    expect(comment).toContain("Apex Financial Empire / Level 8 Financial");
    expect(comment).toContain("intake-123");
  });

  it("formats the phone the way the sheet's human readers expect", () => {
    expect(formatUsPhoneForSheet("+16025550143")).toBe("(602) 555-0143");
    expect(formatUsPhoneForSheet("garbage")).toBe("garbage");
  });
});

describe("ethos · header detection", () => {
  it("treats an all-digit NPN in row 1 as data, not a header", () => {
    // The verified paste file is headerless. Being wrong by one row would skip
    // a real producer or overwrite the header.
    expect(detectDataStartRow(row("21679167", "a@x.com"))).toBe(1);
  });

  it("treats a text NPN cell in row 1 as a header", () => {
    expect(detectDataStartRow(["Agent First Name", "Agent Last Name", "Agent NPN"])).toBe(2);
  });
});

describe("ethos · dedupe and collision", () => {
  it("updates in place when the NPN already exists, in a headerless sheet", () => {
    const rows = [row("11111111", "a@x.com"), row("21346999", "old@x.com"), row("33333333", "c@x.com")];
    expect(matchEthosRow(rows, INTAKE)).toEqual({ action: "update", rowNumber: 2 });
  });

  it("updates the right row when the sheet does have a header", () => {
    const rows = [["Agent First Name", "Agent Last Name", "Agent NPN"], row("21346999", "old@x.com")];
    expect(matchEthosRow(rows, INTAKE)).toEqual({ action: "update", rowNumber: 2 });
  });

  it("matches an NPN regardless of punctuation in the sheet", () => {
    expect(matchEthosRow([row("21-346-999", "old@x.com")], INTAKE)).toEqual({ action: "update", rowNumber: 1 });
  });

  it("appends only when nothing matches", () => {
    expect(matchEthosRow([row("11111111", "a@x.com")], INTAKE)).toEqual({ action: "append" });
  });

  it("sends an email match under a different NPN to review, never an overwrite", () => {
    // One of the two readings (shared household address vs mistyped NPN) makes
    // each of overwrite and append destructive, so a machine does neither.
    const match = matchEthosRow([row("99999999", "jane.doe@example.com", "Jane", "Doe")], INTAKE);
    expect(match.action).toBe("manual_review");
    if (match.action === "manual_review") {
      expect(match.reason).toBe("email_matches_a_different_npn");
      expect(match.rowNumber).toBe(1);
    }
  });

  it("prefers the NPN match even when another row shares the email", () => {
    const rows = [row("99999999", "jane.doe@example.com"), row("21346999", "jane.doe@example.com")];
    expect(matchEthosRow(rows, INTAKE)).toEqual({ action: "update", rowNumber: 2 });
  });

  it("is case- and whitespace-insensitive on the email comparison", () => {
    expect(matchEthosRow([row("99999999", "  JANE.DOE@Example.com ")], INTAKE).action).toBe("manual_review");
  });

  it("refuses to act on an intake with no NPN", () => {
    expect(matchEthosRow([], { ...INTAKE, npn: "" }).action).toBe("manual_review");
  });
});

describe("ethos · read-back verification", () => {
  it("passes when the sheet holds what we meant to write", () => {
    expect(verifyReadBack(buildEthosAiRow(INTAKE, CONFIG), INTAKE)).toEqual({ ok: true });
  });

  it("compares phones across E.164 and national format", () => {
    // We store +16025550143 and the sheet holds (602) 555-0143. Comparing raw
    // digit strings makes a CORRECT write fail its own read-back, which would
    // dead-letter every Ethos row and blame the sheet.
    const written = buildEthosAiRow(INTAKE, CONFIG);
    expect(written[COL_PHONE]).toBe("(602) 555-0143");
    expect(verifyReadBack(written, INTAKE).ok).toBe(true);
  });

  it("fails when the NPN landed wrong, even though the API said 200", () => {
    const written = buildEthosAiRow(INTAKE, CONFIG);
    written[COL_NPN] = "00000000";
    const result = verifyReadBack(written, INTAKE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.mismatches).toContain("Agent NPN");
  });

  it("fails when the row is empty, which is what a wrong range returns", () => {
    const result = verifyReadBack([], INTAKE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.mismatches).toHaveLength(3);
  });

  it("fails when the phone landed as a different number", () => {
    const written = buildEthosAiRow(INTAKE, CONFIG);
    written[COL_PHONE] = "(602) 555-9999";
    const result = verifyReadBack(written, INTAKE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.mismatches).toContain("Agent Mobile Number");
  });
});

describe("ethos · sheets client receipts and errors", () => {
  const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

  it("returns updatedRange as the receipt for an update", async () => {
    const client = createSheetsClient("s", "t", vi.fn(() => ok({ updatedRange: "Agents!A5:I5" })) as never);
    await expect(client.updateRange("Agents!A5:I5", [["a"]])).resolves.toBe("Agents!A5:I5");
  });

  it("returns updatedRange as the receipt for an append", async () => {
    const client = createSheetsClient("s", "t", vi.fn(() => ok({ updates: { updatedRange: "Agents!A190:I190" } })) as never);
    await expect(client.appendRow("Agents!A:I", ["a"])).resolves.toBe("Agents!A190:I190");
  });

  it("refuses a 200 that carries no updatedRange", async () => {
    // Without a range we cannot read the row back, so we cannot evidence the
    // write. An unverifiable success is a failure, and gets retried.
    const client = createSheetsClient("s", "t", vi.fn(() => ok({})) as never);
    await expect(client.updateRange("Agents!A5:I5", [["a"]])).rejects.toThrow(/without returning updatedRange/);
  });

  it("surfaces a 4xx as a real error rather than an empty read", async () => {
    const stub = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ error: { message: "Insufficient permission" } }), { status: 403 })));
    const client = createSheetsClient("s", "t", stub as never);
    await expect(client.getRange("Agents!A:I")).rejects.toThrow(/403.*Insufficient permission/);
  });

  it("treats a 5xx as retryable by throwing, not by returning nothing", async () => {
    const stub = vi.fn(() => Promise.resolve(new Response("upstream boom", { status: 503 })));
    const client = createSheetsClient("s", "t", stub as never);
    await expect(client.getRange("Agents!A:I")).rejects.toThrow(/503/);
  });

  it("reads an empty sheet as an empty array, not as a failure", async () => {
    const client = createSheetsClient("s", "t", vi.fn(() => ok({})) as never);
    await expect(client.getRange("Agents!A:I")).resolves.toEqual([]);
  });

  it("never puts credentials into an error message", async () => {
    const stub = vi.fn(() => Promise.resolve(new Response("nope", { status: 401 })));
    const client = createSheetsClient("s", "super-secret-token", stub as never);
    await expect(client.getRange("Agents!A:I")).rejects.toThrow(
      expect.objectContaining({ message: expect.not.stringContaining("super-secret-token") }) as never,
    );
  });
});

describe("ethos · replay cannot duplicate a producer", () => {
  it("a second run after a successful append updates the row it just wrote", () => {
    const existing = [row("11111111", "a@x.com")];
    expect(matchEthosRow(existing, INTAKE)).toEqual({ action: "append" });

    // Simulate the append landing.
    const afterAppend = [...existing, buildEthosAiRow(INTAKE, CONFIG)];
    expect(matchEthosRow(afterAppend, INTAKE)).toEqual({ action: "update", rowNumber: 2 });

    // And the update in place leaves exactly one row for this NPN.
    afterAppend[1] = buildEthosAiRow(INTAKE, CONFIG);
    expect(afterAppend.filter((r) => r[COL_NPN] === "21346999")).toHaveLength(1);
    expect(afterAppend).toHaveLength(2);
  });
});
