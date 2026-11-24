import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyHistory, loadManifest, prepareCopy, topLevelStatements } from "../../.github/scripts/recover-producer-migrations.mjs";

const temporaryRoot = mkdtempSync(join(tmpdir(), "producer-recovery-test-"));
try {
  const manifest = loadManifest();
  const prepared = prepareCopy(manifest, temporaryRoot);
  const earlier = prepared.versions.filter((version) => !manifest.pending_versions.includes(version));
  assert.equal(earlier.length, 1193);
  assert.equal(classifyHistory(earlier, prepared.versions), "ready");
  assert.equal(classifyHistory(prepared.versions, prepared.versions), "complete");
  assert.throws(() => classifyHistory(earlier.slice(1), prepared.versions));
  assert.throws(() => classifyHistory([...earlier, manifest.pending_versions[0]], prepared.versions));
  assert.throws(() => classifyHistory([...earlier, "20990101000000"], prepared.versions));
  assert.throws(() => classifyHistory([...earlier, earlier[0]], prepared.versions));
  assert.throws(() => classifyHistory(["not-a-version"], prepared.versions));
  assert.throws(() => prepareCopy({ ...manifest, original_sha256: "0".repeat(64) }, temporaryRoot));
  assert.throws(() => prepareCopy({ ...manifest, corrected_sha256: "0".repeat(64) }, temporaryRoot));
  assert.equal(readdirSync(join(prepared.copy, "supabase/migrations")).length, 1198);
  assert.equal(createHash("sha256").update(readFileSync(join(prepared.copy, manifest.producer_path))).digest("hex"), manifest.corrected_sha256);
  assert.equal(topLevelStatements("-- COMMIT;\nCREATE FUNCTION f() RETURNS void AS $$ BEGIN PERFORM 1; END $$ LANGUAGE plpgsql; /* ROLLBACK; */").length, 1);
  for (const sql of ["COMMIT;", "BEGIN;", "ROLLBACK;", "DO $$ BEGIN END $$;", "CALL f();", "SELECT f();", "CREATE TABLE t(x text); COMMIT;", "CREATE FUNCTION f() RETURNS text AS $f$ bad body", "/* unterminated"]) {
    assert.throws(() => topLevelStatements(sql), sql);
  }
  execFileSync("git", ["diff", "--exit-code", "--", "supabase/migrations", "supabase/config.toml"], { stdio: "pipe" });
  console.log("Recovery preparation passed: exact original/corrected hashes,1198 isolated migrations,1193-recorded precondition, five-version scope, idempotence, fail-closed histories, SQL transaction-control rejection, and unchanged tracked migration source. No database requests or CLI writes executed.");
} finally { rmSync(temporaryRoot, { recursive: true, force: true }); }
