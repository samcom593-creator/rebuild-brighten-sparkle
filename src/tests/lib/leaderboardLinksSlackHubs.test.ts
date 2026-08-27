import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("leaderboard profiles and Slack hub consolidation", () => {
  it("links mapped leaderboard agents to their profile", () => {
    expect(read("src/pages/Leaderboard.tsx")).toContain("/dashboard/profile?agentId=");
    expect(read("src/pages/BoardLive.tsx")).toContain("/dashboard/profile?agentId=");
  });

  it("routes both licensed and unlicensed hires into one company hub", () => {
    const card = read("src/components/recruiting/SlackJoinCard.tsx");
    expect(card).toContain("const COMPANY_HUB");
    expect(card).not.toContain("general-unlicensed");
    expect(card).toContain('name: "#general"');
  });

  it("keeps exactly four semantic Slack destinations enabled", () => {
    const migration = read("supabase/migrations/20260827242000_slack_four_hub_consolidation.sql");
    expect(migration).toContain("'general_licensed', 'sales_wins', 'recruiting_growth', 'contracting_support'");
    expect(migration).toContain("update public.messaging_route_rules");
  });
});
