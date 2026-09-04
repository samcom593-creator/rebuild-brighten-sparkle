import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = (file: string) => fs.readFileSync(path.resolve(__dirname, `../../${file}`), "utf8");

describe("client pipeline fast-call workflow", () => {
  it("creates a client from the minimum phone-call fields and progressively discloses the rest", () => {
    const pipeline = source("pages/ClientPipeline.tsx");
    expect(pipeline).toContain("Thirty-second setup");
    expect(pipeline).toContain("Create & open call sheet");
    expect(pipeline).toContain("Add DOB or address now");
    expect(pipeline).not.toContain("AgentLinkConnectionPrompt");
  });

  it("uses one guided call sheet and one save instead of a tab maze", () => {
    const detail = source("pages/ClientDetail.tsx");
    const callSheet = source("components/clients/ClientCallWorkspace.tsx");
    expect(detail).toContain("<ClientCallWorkspace");
    expect(detail).not.toContain("<Tabs");
    expect(callSheet).toContain("Fast Call Sheet");
    expect(callSheet).toContain("Save all call progress");
    expect(callSheet).toContain("Full underwriting details");
    expect(callSheet).toContain("Full financial picture and banking");
  });

  it("keeps critical application facts writable without storing a full SSN", () => {
    const callSheet = source("components/clients/ClientCallWorkspace.tsx");
    for (const key of ["height", "weight", "is_smoker", "ssn_last4", "social_security_income", "medical_notes", "monthly_surplus", "beneficiary_first_name"]) {
      expect(callSheet).toContain(key);
    }
    expect(callSheet).toContain("Store only the last four digits of SSN here");
    expect(callSheet).not.toContain('key: "ssn"');
  });
});
