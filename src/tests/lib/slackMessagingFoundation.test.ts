import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = (file: string) => fs.readFileSync(path.resolve(__dirname, `../../../${file}`), "utf8");

describe("Slack messaging foundation", () => {
  it("stores semantic routes and idempotent provider receipts without raw tokens", () => {
    const migration = source("supabase/migrations/20260826001000_slack_messaging_foundation.sql");
    for (const table of [
      "messaging_workspace_installations",
      "messaging_identity_links",
      "messaging_destinations",
      "messaging_route_rules",
      "messaging_delivery_receipts",
    ]) {
      expect(migration).toContain(`public.${table}`);
    }
    expect(migration).toContain("unique (installation_id, idempotency_key)");
    expect(migration).toContain("bot_token_secret_ref");
    expect(migration).not.toContain("bot_token text");
  });

  it("keeps contracting on the immediate onboarding result", () => {
    const page = source("src/pages/StartContracting.tsx");
    const result = source("src/components/contracting/ContractingSuccessModal.tsx");
    expect(page).toContain("<ContractingSuccessModal accepted={accepted}");
    expect(result).toContain("Contracting Initiated — Fast Track Active");
    expect(result).toContain("Book instant onboarding");
    expect(`${page}\n${result}`.toLowerCase()).not.toContain("in a queue");
    expect(`${page}\n${result}`.toLowerCase()).not.toContain("pending review");
  });

  it("provides an admin-only live Slack and destination health probe", () => {
    const health = source("supabase/functions/slack-integration-health/index.ts");
    expect(health).toContain('callSlack<SlackAuthResult>("auth.test"');
    expect(health).toContain('callSlack<SlackConversationResult>("conversations.info"');
    expect(health).toContain('from("messaging_destinations")');
    expect(health).toContain('rpc("apex_is_admin")');
    expect(health).not.toContain("SLACK_BOT_TOKEN:");
  });

  it("routes licensing milestones through the durable Slack receipt ledger", () => {
    const migration = source("supabase/migrations/20260826005000_candidate_workflow_and_slack_milestones.sql");
    const dispatcher = source("supabase/functions/apex-outbox-dispatcher/index.ts");
    expect(migration).toContain("public.candidate_smart_goals");
    expect(migration).toContain("public.candidate_notes");
    expect(migration).toContain("public.licensing_milestone_events");
    expect(migration).toContain("candidate.licensing_milestone");
    expect(migration).toContain("on conflict (idempotency_key) do nothing");
    expect(migration).not.toContain("create table if not exists public.policies");
    expect(dispatcher).toContain('event.destination === "slack"');
    expect(dispatcher).toContain('from("messaging_delivery_receipts")');
    expect(dispatcher).toContain('https://slack.com/api/chat.postMessage');
    expect(dispatcher).not.toContain("C01LICENSING");
  });

  it("binds the production workspace to verified semantic channels and core event routes", () => {
    const routes = source("supabase/migrations/20260826013000_apex_slack_live_routes.sql");
    const dispatcher = source("supabase/functions/apex-outbox-dispatcher/index.ts");

    expect(routes).toContain("T0BSN03M2AJ");
    expect(routes).toContain("C0BTJLBKC2C");
    expect(routes).toContain("C0BSTVB98DA");
    expect(routes).toContain("C0BSNBA5NES");
    for (const eventType of [
      "candidate.application_submitted",
      "candidate.licensing_milestone",
      "contracting.intake_submitted",
      "deal.posted",
    ]) {
      expect(routes).toContain(eventType);
    }
    expect(dispatcher).toContain("candidate.application_submitted");
    expect(dispatcher).toContain("contracting.intake_submitted");
    expect(dispatcher).toContain("deal.posted");
    expect(routes).toContain("SLACK_BOT_TOKEN");
    expect(routes).not.toContain("xoxb-");
    expect(routes).not.toContain("'email'");
    expect(routes).not.toContain("'phone'");
    expect(routes).not.toContain("clientName");
  });
});
