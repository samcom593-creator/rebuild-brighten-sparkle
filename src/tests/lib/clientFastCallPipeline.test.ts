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

  it("loads the entire scoped book and renders a phone-first priority cockpit", () => {
    const pipeline = source("pages/ClientPipeline.tsx");
    expect(pipeline).toContain("for (let from = 0; ; from += pageSize)");
    expect(pipeline).toContain(".range(from, from + pageSize - 1)");
    expect(pipeline).toContain("Today&apos;s game plan");
    expect(pipeline).toContain("Work next client");
    expect(pipeline).toContain("Follow-up coverage");
    expect(pipeline).not.toContain('min-w-[940px]');
  });

  it("records structured outcomes and refuses to close the loop without a date", () => {
    const callSheet = source("components/clients/ClientCallWorkspace.tsx");
    expect(callSheet).toContain("CALL_OUTCOMES");
    expect(callSheet).toContain('p_activity_type: selectedOutcome ? (selectedOutcome.reached ? "contact_logged" : "no_answer")');
    expect(callSheet).toContain("Choose a callback or next-action date for today or later before closing this call");
    expect(callSheet).toContain("Save outcome & next step");
    expect(callSheet).toContain('queryKey: ["client-pipeline-overrides"]');
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
