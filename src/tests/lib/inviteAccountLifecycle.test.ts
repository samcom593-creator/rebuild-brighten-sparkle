import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = (file: string) => fs.readFileSync(path.resolve(__dirname, `../../${file}`), "utf8");

describe("invite-created account lifecycle", () => {
  it("keeps join-link recruits owned by the selected upline", () => {
    const edge = source("../supabase/functions/consume-invite-token/index.ts");
    expect(edge).toContain('error: "target_manager_unavailable"');
    expect(edge).toContain("assigned_agent_id: targetManager?.id ?? null");
    expect(edge).toContain("referral_manager_id: targetManager?.id ?? null");
    expect(edge).toContain("recruiter_id: targetManager?.id ?? null");
    expect(edge).toContain("hiring_manager_user_id: targetManager?.user_id ?? null");
  });

  it("starts licensed hires in onboarding and preserves both hierarchy keys", () => {
    const edge = source("../supabase/functions/consume-invite-token/index.ts");
    expect(edge).not.toContain('onboarding_stage: licensed ? "live"');
    expect(edge.match(/onboarding_stage: licensed \? "onboarding" : "pre_licensed"/g)).toHaveLength(2);
    expect(edge.match(/invited_by_manager_id: targetManager\?\.id \?\? null/g)).toHaveLength(2);
  });

  it("surfaces account readiness and editable comp in the admin account screen", () => {
    const accounts = source("pages/DashboardAccounts.tsx");
    for (const phrase of ["Setup readiness", "Needs Setup", "Comp Percentage", "portal_password_set", "has_discord_access", "has_training_course", "legacy record", "md:hidden"]) {
      expect(accounts).toContain(phrase);
    }
    expect(accounts).toContain("parsedContractPercentage > 200");
    expect(accounts).toContain("max={200}");
  });

  it("does not report success for a role-only login with no profile", () => {
    const accounts = source("pages/DashboardAccounts.tsx");
    expect(accounts).toContain("if (!editingAccount.hasProfile)");
    expect(accounts).toContain('.select("user_id")');
    expect(accounts).toContain("disabled={!hasReachableEmail(account)}");

    const edge = source("../supabase/functions/update-user-email/index.ts");
    expect(edge).toContain('.upsert({');
    expect(edge).toContain('{ onConflict: "user_id" }');
    expect(edge).toContain("auth rollback both failed");
    expect(edge).toContain("profileSynchronized: true");
  });

  it("fails every account-creation path closed when auth lookup is incomplete", () => {
    for (const file of [
      "../supabase/functions/consume-invite-token/index.ts",
      "../supabase/functions/create-new-agent-account/index.ts",
      "../supabase/functions/add-agent/index.ts",
      "../supabase/functions/setup-agent-password/index.ts",
      "../supabase/functions/create-agent-from-leaderboard/index.ts",
    ]) {
      expect(source(file)).toContain("!authLookup.exhaustive");
    }
  });
});
