import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = (file: string) => fs.readFileSync(path.resolve(__dirname, `../../${file}`), "utf8");

describe("P0 repair packet", () => {
  it("renders live production skeletons without placeholder money", () => {
    // OVERHAUL-myteam (2026-10-31): My Team's numbers are the four list counts in src/components/team/TeamList.tsx;
    // while the roster loads they read "—" and the list is a skeleton (pinned in src/tests/pages/DashboardCRM.test.tsx).
    const crm = source("pages/DashboardCRM.tsx");
    const list = source("components/team/TeamList.tsx");
    expect(crm).toContain("<TeamList");
    expect(list).toContain("Loading your team");
    expect(list).toContain("<Skeleton");
    expect(`${crm}\n${list}`).not.toContain('"$40K"');
  });

  it("serializes the real deals ledger and returns a replay receipt", () => {
    const migration = source("../supabase/migrations/20260825232500_deals_idempotency.sql");
    expect(migration).toContain("deals_policy_identity_unique");
    expect(migration).toContain("carrier_id, lower(btrim(policy_number)), writing_npn");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("'status', 'already_recorded'");
    expect(migration).toContain("duplicate_of_deal_id");
  });
});
