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
      "Join the Galaxy Slack",
      "Set Up Your Galaxy Account",
      "Set Up Your Course Account",
      "Open Your Galaxy Roadmap",
      "Finish Online Training",
      "Complete Your Contracting Profile",
    ]) {
      expect(licensing).toContain(expected);
    }
    // Owner directive 2026-10-05: Discord is out of the agent journey; Slack is the one team workspace.
    expect(licensing).not.toMatch(/discord/i);
    expect(licensing).not.toMatch(/whatsapp/i);
    // Contracting is the five-field profile on a signed-in page, not a spreadsheet or a private desk.
    expect(licensing).not.toMatch(/spreadsheet|contracting desk|start-contracting/i);
    expect(licensing).toContain("NOT_CONTRACTED_YET");
    expect(read("supabase/functions/_shared/contracting-profile.ts")).toContain("Submitting your information does not mean carrier contracting is complete.");
  });

  it("routes invite-created agents through the correct licensed or unlicensed welcome branch", () => {
    // §8 (2026-10-06): Invite Team no longer creates the account itself (that
    // path inserted a duplicate agents row and set a fixed password). It mints a
    // personal invitation; acceptance runs consume-invite-token, which branches
    // licensed vs unlicensed and queues contracting.
    expect(inviteModal).toContain("InviteAgentForm");
    expect(inviteModal).not.toContain("create-new-agent-account");
    expect(inviteModal).not.toContain('from("agents")');
    expect(welcome).toContain("licenseStatus === \"licensed\"");
    expect(welcome).toContain("Create Your XCEL Course Account");
    expect(welcome).toContain("Complete Online Training");
    expect(welcome).toContain("Open My Account &amp; Roadmap");
    expect(welcome).not.toMatch(/discord/i);
    expect(welcome).not.toMatch(/whatsapp/i);
  });

  it("uses the Galaxy licensed curriculum instead of sending licensed agents to prelicensing", () => {
    expect(queueWorker).toContain("Your Galaxy online training is ready");
    expect(queueWorker).toContain("dashboard/training/library");
    expect(queueWorker).not.toContain("Your Galaxy prelicensing course access is ready");
    expect(course).toContain("Your next-step roadmap");
    expect(course).toContain("Join the Galaxy Slack");
    expect(queueWorker).toContain("Join the Galaxy Slack");
    expect(queueWorker).not.toMatch(/discord\.gg|Join the Galaxy Discord|Join Discord/);
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
