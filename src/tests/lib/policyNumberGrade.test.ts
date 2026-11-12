import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { policyNumberGrade } from "@/lib/policyNumber";
import { LEAD_TYPES } from "@/lib/leadTypes";

// Every row below was also run through public.fn_policy_number_grade() on the live database (2026-11-12).
const CASES: [string, string][] = [
  ["", "blank"], ["tbd", "placeholder"], ["1234", "placeholder"], ["00000", "placeholder"], ["12345678910", "placeholder"],
  ["12345001", "placeholder"], ["09876", "placeholder"], ["654321", "placeholder"], ["1111111", "placeholder"],
  ["42552", "short"], ["34545", "short"],
  ["TER6617708", "ok"], ["7GG81630", "ok"], ["59545248", "ok"], ["3000021022", "ok"], ["TA7110655504", "ok"], ["000008253920", "ok"],
];

describe("policyNumberGrade", () => {
  it.each(CASES)("%j is %s", (raw, grade) => {
    expect(policyNumberGrade(raw)).toBe(grade);
  });

  it("ignores spaces, dashes and case the way the database does", () => {
    expect(policyNumberGrade(" t-b-d ")).toBe("placeholder");
    expect(policyNumberGrade("ter 661-7708")).toBe("ok");
    expect(policyNumberGrade(null)).toBe("blank");
  });

  it("keeps the same rules as the SQL function it mirrors", () => {
    const sql = readFileSync("supabase/migrations/20261113000000_perf_bot.sql", "utf8");
    const ts = readFileSync("src/lib/policyNumber.ts", "utf8");
    // The SQL copy upper-cases the key and the TypeScript copy lower-cases it, so the word list is compared
    // case-insensitively (the copy guard bans the upper-case placeholder word in src/).
    const words = sql.match(/\^\((PENDING\|[A-Z|+]+)\)\$/)?.[1];
    expect(words).toBeTruthy();
    expect(ts).toContain((words as string).toLowerCase());
    const digits = "12345|01234|09876|98765|87654|76543|65432|54321";
    expect(sql).toContain(digits);
    expect(ts).toContain(digits);
    expect(sql).toContain("length(k) <= 4");
    expect(ts).toContain("k.length <= 4");
    expect(sql).toContain("length(k) <= 6");
    expect(ts).toContain("k.length <= 6");
  });
});

describe("lead types", () => {
  it("offers the four types Sam named plus aged, referral and other", () => {
    expect(LEAD_TYPES.map((t) => t.label)).toEqual(["POS", "Veteran", "FEX", "Mortgage", "Aged", "Referral", "Other"]);
  });
});
