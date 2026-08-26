import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = (file: string) => fs.readFileSync(path.resolve(__dirname, `../../../${file}`), "utf8");

describe("Slack primary-app rollout", () => {
  const migration = source("supabase/migrations/20260826150000_slack_primary_rollout.sql");
  const reminder = source("supabase/functions/numbers-reminder/index.ts");
  const dispatcher = source("supabase/functions/apex-outbox-dispatcher/index.ts");
  const applicantConfirmation = source("src/components/landing/ApplicationConfirmationV2.tsx");
  const agentCard = source("src/components/recruiting/SlackJoinCard.tsx");

  it("keeps the approved eight in production while excluding them only from Slack", () => {
    for (const agentId of [
      "431dff0d-7c82-4134-a85e-457e5226fc7f",
      "45eebd82-7d41-438a-a7aa-45bcbe08d2bc",
      "c7ffeea3-0122-4f22-884e-54d8a3a645e5",
      "d607c992-7625-4e41-81de-b06c0a5c8161",
      "3523dc25-61e0-4ce3-bb97-197bbf1a049a",
      "021f1686-2560-4b05-9281-c3a66d23c1f2",
      "20344eff-2a14-4b9f-bae2-fabc87f55c07",
      "19e7f9d8-0277-43f9-a90c-3e326cca4403",
    ]) expect(migration).toContain(agentId);
    expect(migration).toContain("messaging_audience_exclusions");
    expect(migration).not.toMatch(/update public\.agents[\s\S]{0,200}(status|manager_id|is_deactivated|is_inactive)/i);
  });

  it("routes candidate traffic to private staff channels and disables applicant invitations", () => {
    expect(migration).toContain("C0BSPC0P2AX");
    expect(migration).toContain("C0BSXH22GL9");
    expect(migration.match(/privacy_level = 'private'/g)).toHaveLength(2);
    expect(migration).toContain("drop trigger if exists trg_applicant_slack_invite");
    expect(dispatcher).toContain('event.aggregate_type !== "agent"');
    expect(applicantConfirmation).not.toContain("SlackJoinCard");
    expect(agentCard).not.toContain("join.slack.com");
  });

  it("accepts only authenticated reminder calls and exposes aggregate dry-run data", () => {
    expect(reminder).toContain('req.method !== "POST"');
    expect(reminder).toContain('Deno.env.get("APEX_BOT_TOKEN")');
    expect(reminder).toContain("bearer !== botToken && bearer !== serviceKey");
    expect(reminder).toContain('verification_status === "verified"');
    expect(reminder).toContain('from("messaging_audience_exclusions")');
    expect(reminder).not.toContain("const plan = recipients.map");
    expect(reminder).not.toContain("message: `6pm CT");
    for (const field of ["triggered_at", "completed_at", "response_body", "duration_ms"]) {
      expect(reminder).toContain(field);
    }
  });

  it("provides conflict-safe verification and durable hired-agent invite receipts", () => {
    expect(migration).toContain("public.admin_verify_slack_identity");
    expect(migration).toContain("Slack email does not match the APEX hired-agent record");
    expect(migration).toContain("Slack user is already linked to another APEX agent");
    expect(migration).toContain("public.queue_active_hired_slack_invites");
    expect(migration).toContain("public.v_slack_invite_receipts");
    expect(dispatcher).toContain('from("v_slack_invite_eligibility")');
  });
});
