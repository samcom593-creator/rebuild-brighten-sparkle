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
});
