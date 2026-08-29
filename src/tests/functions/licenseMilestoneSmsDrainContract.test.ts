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
 * pending at send_attempts=0.
 *
 * The CHECK list is read from the migration that mirrors it; if that
 * migration ever stops declaring the constraint this test FAILS rather than
 * falling back to a hardcoded copy (a fallback is the stale mirror this
 * wave exists to kill). Comments are stripped before scanning so a status
 * named in prose cannot satisfy or trip the assertion (MP-277 footnote bug).
 */
const ROOT = resolve(__dirname, "../../..");
const FN_RAW = readFileSync(resolve(ROOT, "supabase/functions/license-milestone-sms-drain/index.ts"), "utf8");
const FN = FN_RAW.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
const MIG = readFileSync(
  resolve(ROOT, "supabase/migrations/20260829170000_license_milestone_outbox_status_check_mirror.sql"),
  "utf8",
).replace(/^\s*--[^\n]*$/gm, "");

function checkSet(): Set<string> {
  const m = MIG.match(/license_milestone_outbox_status_check\s*check\s*\(\s*status\s+in\s*\(([^)]+)\)/i);
  if (!m) throw new Error("status CHECK not declared in the mirror migration — the contract has no source of truth");
  return new Set([...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]));
}

function writtenStatuses(): string[] {
  // Both shapes the fn uses: `{ status: "x" }` and `patch.status = "x"`.
  const literal = [...FN.matchAll(/\bstatus:\s*"([a-z_]+)"/g)].map((m) => m[1]);
  const assigned = [...FN.matchAll(/\.status\s*=\s*"([a-z_]+)"/g)].map((m) => m[1]);
  return [...literal, ...assigned];
}

describe("license-milestone-sms-drain contract", () => {
  it("writes only statuses the CHECK constraint admits", () => {
    const allowed = checkSet();
    expect(allowed.size).toBeGreaterThanOrEqual(4);
    const written = writtenStatuses();
    // The scanner must see the three outcomes the fn is documented to record,
    // or it is matching nothing and proving nothing.
    for (const must of ["sent", "failed", "skipped"]) expect(written, `scanner never saw "${must}"`).toContain(must);
    for (const s of written) expect(allowed.has(s), `status "${s}" is outside ${[...allowed].join("|")}`).toBe(true);
  });

  it("reads the verdict of every outbox write and fails loud on persistence errors", () => {
    const updates = [...FN.matchAll(/\.from\("license_milestone_outbox"\)\.update\(/g)].length;
    const checked = [...FN.matchAll(/const \{ error: \w+ \} = await sb\s*\.from\("license_milestone_outbox"\)\.update\(/g)].length;
    expect(updates).toBeGreaterThanOrEqual(2);
    expect(checked, "every update must bind its error").toBe(updates);
    expect(FN).toMatch(/persistFailures === 0 \? 200 : 500/);
    expect(FN).toMatch(/ok: persistFailures === 0/);
  });
});
