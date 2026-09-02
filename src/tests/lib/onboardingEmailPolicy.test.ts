import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => fs.readFileSync(path.resolve(__dirname, `../../../${file}`), "utf8");

describe("licensed and unlicensed onboarding email policy", () => {
  const licensing = read("supabase/functions/send-licensing-instructions/index.ts");
  const welcome = read("supabase/functions/welcome-new-agent/index.ts");
  const course = read("supabase/functions/send-course-enrollment-email/index.ts");
  const queueWorker = read("supabase/functions/send-agent-onboarding-email/index.ts");
  const inviteModal = read("src/components/dashboard/InviteTeamModal.tsx");
  const retirement = read("supabase/migrations/20260828060000_retire_whatsapp_onboarding.sql");

  it("gives both license cohorts an ordered roadmap with community, account, and training steps", () => {
    for (const expected of [
      "Join the APEX Slack",
      "Join the APEX Discord",
      "Set Up Your APEX Account",
      "Set Up Your Course Account",
      "Open Your APEX Roadmap",
      "Finish Online Training",
      "Complete APEX Contracting",
    ]) {
      expect(licensing).toContain(expected);
    }
    expect(licensing).toContain("https://discord.gg/JpUWA73UZX");
    expect(licensing).not.toMatch(/whatsapp/i);
  });

  it("routes invite-created agents through the correct licensed or unlicensed welcome branch", () => {
    expect(inviteModal).toContain("portalLink: magicLink");
    expect(inviteModal).toContain("licenseStatus,");
    expect(welcome).toContain("licenseStatus === \"licensed\"");
    expect(welcome).toContain("Create Your XCEL Course Account");
    expect(welcome).toContain("Complete Online Training");
    expect(welcome).toContain("Open My Account &amp; Roadmap");
    expect(welcome).toContain("Join Team Discord");
    expect(welcome).not.toMatch(/whatsapp/i);
  });

  it("uses the APEX licensed curriculum instead of sending licensed agents to prelicensing", () => {
    expect(queueWorker).toContain("Your APEX online training is ready");
    expect(queueWorker).toContain("dashboard/training/library");
    expect(queueWorker).not.toContain("Your APEX prelicensing course access is ready");
    expect(course).toContain("Your next-step roadmap");
    expect(course).toContain("Join the APEX Slack");
    expect(queueWorker).toContain("Join the APEX Discord");
    expect(course).not.toMatch(/whatsapp/i);
    expect(queueWorker.match(/Slack is your <strong>primary team hub<\/strong>/g)).toHaveLength(1);
  });

  it("removes the retired channel from every active unlicensed email surface", () => {
    for (const file of [
      "supabase/functions/send-unlicensed-process-update/index.ts",
      "supabase/functions/send-daily-checkin-prompt/index.ts",
      "supabase/functions/send-bulk-unlicensed-outreach/index.ts",
      "supabase/functions/submit-application/index.ts",
    ]) {
      const source = read(file);
      expect(source, file).not.toMatch(/whatsapp/i);
      expect(source, file).toMatch(/slack/i);
    }
  });

  it("retires old queue rows honestly and prevents future trigger enqueues", () => {
    expect(retirement).toContain("sent_at is null");
    expect(retirement).toContain("attempt_count = 5");
    expect(retirement).toContain("status = 'skipped'");
    expect(retirement.match(/hired_whatsapp/g)).toHaveLength(1);
    expect(retirement).toContain("'applicant-onboarding-v2'");
    expect(retirement).toContain("(new.id, 'course', now())");
    expect(retirement).toContain("(new.id, 'discord', now())");
  });

  it("keeps the old blast endpoint as a fail-closed compatibility route", () => {
    const retiredEndpoint = read("supabase/functions/send-whatsapp-onboarding-blast/index.ts");
    expect(retiredEndpoint).toContain("status: 410");
    expect(retiredEndpoint).toContain("sends nothing");
    expect(retiredEndpoint).not.toContain("resend.emails.send");
    expect(retiredEndpoint).not.toContain("send-sms");
  });
});
