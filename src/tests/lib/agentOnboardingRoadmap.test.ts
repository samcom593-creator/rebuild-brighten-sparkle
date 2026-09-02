import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = (file: string) => fs.readFileSync(path.resolve(__dirname, `../../../${file}`), "utf8");

describe("agent onboarding roadmap", () => {
  const migration = source("supabase/migrations/20260827213000_agent_onboarding_roadmap.sql");
  const roadmap = source("src/components/dashboard/AgentOnboardingStepper.tsx");
  const portal = source("src/pages/AgentPortal.tsx");
  const command = source("src/pages/AgentCommandDashboard.tsx");
  const agentLogin = source("src/pages/AgentNumbersLogin.tsx");
  const contractingSuccess = source("src/components/contracting/ContractingSuccessModal.tsx");
  const welcome = source("supabase/functions/welcome-new-agent/index.ts");
  const resources = source("src/components/training/RequiredOnboardingResources.tsx");
  const trainingMigration = source("supabase/migrations/20260827214500_training_experience_redesign.sql");

  it("uses receipt-backed milestones instead of entitlement flags", () => {
    expect(migration).toContain("apex_agent_onboarding_roadmap");
    expect(migration).toContain("messaging_identity_links");
    expect(migration).toContain("fn_agent_onboarding_call_booking");
    expect(migration).toContain("contracting_intakes");
    expect(migration).toContain("onboarding_progress");
    expect(migration).toContain("has_dialer_login");
    expect(migration).toContain("first_deal_at");
    expect(migration).not.toMatch(/v_training\s*:=\s*v_agent\.has_training_course/);
  });

  it("puts the live roadmap on the real post-login agent dashboard", () => {
    expect(portal).toContain("<AgentOnboardingStepper agentId={agentId}");
    expect(command).toContain("<AgentOnboardingStepper agentId={agentId}");
    expect(roadmap).toContain("Nothing skipped. You always know what happens next.");
    expect(roadmap).toContain('table: "messaging_identity_links"');
    expect(roadmap).toContain('table: "interview_events"');
    expect(roadmap).toContain('table: "onboarding_progress"');
    expect(roadmap).toContain('table: "agent_documents"');
  });

  it("keeps every required launch milestone visible", () => {
    for (const step of [
      "Confirm your account and profile",
      "Finish licensing and confirm your NPN",
      "OneLink contracting",
      "Book your onboarding call",
      "Upload license and identity documents",
      "Secure and upload E&O coverage",
      "Prepare EFT documentation",
      "Carrier appointments with Milver",
      "Complete every onboarding module",
      "Get ReadyMode field-ready",
      "Post your first deal",
    ]) {
      expect(roadmap).toContain(step);
    }
    expect(roadmap).toContain('label: `Join the ${BRAND.shortName} Slack`');
    expect(contractingSuccess).toContain("Your complete launch path");
    expect(contractingSuccess).toContain("Continue to your onboarding roadmap");
  });

  it("returns trained agents to the launch dashboard instead of skipping the roadmap", () => {
    expect(agentLogin).not.toContain('if (agent?.has_training_course)');
    expect(agentLogin).not.toContain('navigate("/onboarding-course", { replace: true })');
    expect(agentLogin).toContain('|| "/agent-portal"');
  });

  it("makes Slack and Milver the first post-hire contacts", () => {
    expect(welcome).toContain("Join the APEX Slack");
    expect(welcome).toContain("Milver Taca is your Contracting &amp; Onboarding Manager");
    expect(welcome).toContain("apex-onboarding-call");
    expect(welcome).not.toContain("Join Our Team Discord");
  });

  it("ships all four supplied system walkthroughs", () => {
    for (const videoId of ["55929817", "55930238", "55934385", "55934661"]) {
      expect(trainingMigration).toContain(videoId);
    }
    expect(resources).toContain("TRAINING_ROUTES.fieldCourse");
    expect(trainingMigration).toContain("transcript_segments");
    expect(trainingMigration).toContain("onboarding_questions");
  });
});
