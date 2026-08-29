import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * MP-341b — license-milestone-sms-drain must only ever write a status the
 * table's CHECK admits, and must never discard the write's verdict.
 *
 * 2026-08-29: the first cut wrote "skipped_no_carrier". The UPDATE violated
 * license_milestone_outbox_status_check, the error went unread, and the
 * 16:10 cron tick answered {processed:3} while all three rows stayed
 * pending at send_attempts=0. The CHECK list below is read from the
 * migration that owns it so this test cannot drift from the contract by hand.
 */
const ROOT = resolve(__dirname, "../../..");
const FN = readFileSync(resolve(ROOT, "supabase/functions/license-milestone-sms-drain/index.ts"), "utf8");
const MIG = readFileSync(resolve(ROOT, "supabase/migrations/20260828020000_xcel_milestones_v3.sql"), "utf8")
  + readFileSync(resolve(ROOT, "supabase/migrations/20260828080000_license_milestone_sms_drain_cron.sql"), "utf8");

function checkSet(): Set<string> {
  // Prefer an explicit outbox status CHECK in the migrations; fall back to the
  // deployed contract proven live on 2026-08-29.
  const m = MIG.match(/license_milestone_outbox[\s\S]{0,400}?status[^\n]*?in \(([^)]+)\)/i);
  const raw = m ? m[1] : "'pending','sent','failed','skipped'";
  return new Set([...raw.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]));
}

describe("license-milestone-sms-drain contract", () => {
  it("writes only statuses the CHECK constraint admits", () => {
    const allowed = checkSet();
    const written = [...FN.matchAll(/status:\s*"([a-z_]+)"/g)].map((m) => m[1]);
    expect(written.length).toBeGreaterThan(0);
    for (const s of written) expect(allowed.has(s), `status "${s}" is outside ${[...allowed].join("|")}`).toBe(true);
  });

  it("reads the verdict of every outbox write and fails loud on persistence errors", () => {
    const updates = [...FN.matchAll(/\.from\("license_milestone_outbox"\)\.update\(/g)].length;
    const checked = [...FN.matchAll(/const \{ error: \w+ \} = await sb\s*\.from\("license_milestone_outbox"\)\.update\(/g)].length;
    expect(updates).toBeGreaterThan(0);
    expect(checked, "every update must bind its error").toBe(updates);
    expect(FN).toMatch(/persistFailures === 0 \? 200 : 500/);
    expect(FN).toMatch(/ok: persistFailures === 0/);
  });
});
