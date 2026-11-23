import { describe, expect, test } from "vitest";
import { levelFor, parseCompCell, parseGrid } from "@/lib/contractingDownlines";

describe("contracting downlines · spreadsheet paste parser (MP-304)", () => {
  test("tab-separated paste with the IMO sheet's own headers maps by meaning", () => {
    const text = "Request Type\tAgent First Name (as appears on license)\tAgent Last Name (as appears on license)\tNPN\tAgent Email Address\tCommission Level\tAgent Phone\tSSN\n" +
      "transfer\tDylan\tHarvey\t21756683\tdlanoharv8@gmail.com\t78\t(217) 652-6416\t\n";
    const g = parseGrid(text);
    expect(g.delimiter).toBe("\t");
    expect(g.rows).toHaveLength(1);
    expect(g.rows[0]).toMatchObject({ first_name: "Dylan", last_name: "Harvey", npn: "21756683", email: "dlanoharv8@gmail.com", phone: "(217) 652-6416", comp_pct: 78, request_type: "transfer" });
    // SSN is never a field. It is ignored and REPORTED, so the manager sees it was not taken.
    expect(g.ignoredHeaders).toEqual(["SSN"]);
  });

  test("CSV with quoted commas and Ethos level labels", () => {
    const text = 'First,Last,Email,Mobile,NPN,Comp\n"Aisha","Kebbeh",kebbeh045@gmail.com,"(978) 804-7212",21448924,Level 15\n';
    const g = parseGrid(text);
    expect(g.delimiter).toBe(",");
    expect(g.rows[0]).toMatchObject({ first_name: "Aisha", last_name: "Kebbeh", comp_pct: 75 });
  });

  test("blank comp stays null so the SERVER applies the default; never guessed client-side", () => {
    expect(parseCompCell("")).toBeNull();
    expect(parseCompCell("70%")).toBe(70);
    expect(parseCompCell("Level 17")).toBe(85);
    expect(parseCompCell("sixty")).toBeNull();
  });

  test("levelFor mirrors fn_ethos_level_for_pct: 60→12, 75→15, 85→17, clamp 12..27, blank→12", () => {
    expect(levelFor(60)).toBe("Level 12");
    expect(levelFor(75)).toBe("Level 15");
    expect(levelFor(85)).toBe("Level 17");
    expect(levelFor(200)).toBe("Level 27");
    expect(levelFor(null)).toBe("Level 12");
  });

  test("rows with nothing identifying are dropped", () => {
    const g = parseGrid("First\tLast\tNPN\n\t\t\nAda\tLovelace\t21000002\n");
    expect(g.rows).toHaveLength(1);
  });
});
