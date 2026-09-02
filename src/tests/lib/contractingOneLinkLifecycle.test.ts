import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = (file: string) => fs.readFileSync(path.resolve(__dirname, `../../${file}`), "utf8");

describe("contracting one-link lifecycle", () => {
  it("creates portal access, unlocks onboarding and drains only its own intake", () => {
    const submit = source("../supabase/functions/submit-contracting-intake/index.ts");
    expect(submit).toContain("provisionOnboarding");
    expect(submit).toContain("validateNpnClaim");
    expect(submit).toContain('error: "npn_in_use"');
    expect(submit).toContain("nipr_verified: false");
    expect(submit).toContain("normalizedPayload");
    expect(submit).toContain('has_training_course: true');
    expect(submit).toContain("send-course-enrollment-email");
    expect(submit).toContain("onboarding_email_sent: onboardingEmailSent");
    expect(submit).not.toContain("redirect_url:");
    expect(submit).toContain("contractingIntakeId: result.intake_id");
    expect(submit).not.toContain('delivery: "queued"');

    const dispatcher = source("../supabase/functions/apex-outbox-dispatcher/index.ts");
    expect(dispatcher).toContain('sb.rpc("claim_contracting_intake_events"');
    for (const field of [
      "comp_percentage",
      "license_status",
      "license_states",
      "eo_certificate_url",
      "eo_expires_at",
      "eo_per_claim_limit",
      "eo_aggregate_limit",
      "eft_ready",
      "contracting_contact_name",
    ]) {
      expect(dispatcher).toContain(field);
    }
  });
});
