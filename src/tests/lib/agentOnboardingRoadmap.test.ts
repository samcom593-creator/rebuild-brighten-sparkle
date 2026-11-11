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
      "Contracting profile",
      "Book your onboarding call",
      "Upload license and identity documents",
      "Secure and upload E&O coverage",
      "Prepare EFT documentation",
      "Carrier appointments",
      "Complete every onboarding module",
      "Get ReadyMode field-ready",
      "Post your first deal",
    ]) {
      expect(roadmap).toContain(step);
    }
    expect(roadmap).toContain('label: `Join the ${BRAND.shortName} Slack`');
  });

  it("returns trained agents to the launch dashboard instead of skipping the roadmap", () => {
    expect(agentLogin).not.toContain('if (agent?.has_training_course)');
    expect(agentLogin).not.toContain('navigate("/onboarding-course", { replace: true })');
    expect(agentLogin).toContain('|| "/agent-portal"');
  });

  it("makes Slack and the onboarding call the first post-hire contacts, with no staff name", () => {
    expect(welcome).toContain("Join the Galaxy Slack");
    expect(welcome).toContain("Book Your Onboarding Call");
    expect(welcome).not.toContain("Milver");
    expect(welcome).toContain("apex-onboarding-call");
    expect(welcome).not.toContain("Join Our Team Discord");
  });

  it("WP7: Slack no longer gates licensing or contracting, and joining is an own-row mark", () => {
    const wp7 = source("supabase/migrations/20261111100600_wp7_channels.sql");
    const fn = wp7.slice(wp7.indexOf("create or replace function public.apex_agent_onboarding_roadmap"));
    const body = fn.slice(0, fn.indexOf("$function$;"));
    expect(body).toContain("v_slack := v_slack_verified or v_agent.slack_joined_at is not null;");
    expect(body).not.toMatch(/when v_slack then 'current' else 'locked'/);
    expect(body).not.toMatch(/when v_slack and v_licensed then 'current'/);
    expect(body).toContain("'Join the Galaxy Slack'");
    expect(wp7).toContain("create or replace function public.mark_slack_joined()");
    expect(wp7).toMatch(/where user_id = v_uid/);
    expect(roadmap).toContain('looseSupabase.rpc("mark_slack_joined")');
    expect(roadmap).toContain("detailsQuery.data?.agent?.user_id === user?.id");
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
