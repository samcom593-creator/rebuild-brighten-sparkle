import { execFileSync, spawnSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { resolve } from "node:path";

const base = "a679d70e0b5ffd82aed3e660da898a2452cff502";
const expectedTree = "c8932ddadf439b870c0ed0b65eea95aa7f04d2fa";
const branch = "codex/producer-workspace-20261124";
const branchRef = `refs/heads/${branch}`;
const releaseDirectory = process.env.RELEASE_WORKTREE;
class ReleaseError extends Error {}
const fail = (message) => { throw new ReleaseError(message); };
const git = (...args) => execFileSync("git", args, {
  cwd: releaseDirectory, encoding: "utf8", timeout: 60000, stdio: ["ignore", "pipe", "pipe"],
}).trim();

function checkMain() {
  if (git("rev-parse", "refs/remotes/origin/main") !== base
    || git("ls-remote", "--exit-code", "origin", "refs/heads/main") !== `${base}\trefs/heads/main`) {
    fail("Main moved from the reviewed base; release publication remains blocked.");
  }
}

function readFeatureHead() {
  const value = git("ls-remote", "--exit-code", "origin", branchRef);
  const match = value.match(/^([a-f0-9]{40})\t(.+)$/);
  if (!match || match[2] !== branchRef) fail("The expected release branch could not be verified.");
  return match[1];
}

function checkFeature() {
  const head = readFeatureHead();
  if (head === base) return null;
  git("fetch", "--no-tags", "origin", branchRef);
  if (git("rev-parse", "FETCH_HEAD") !== head) fail("The release branch changed while it was being verified.");
  if (git("rev-parse", `${head}^{tree}`) !== expectedTree) fail("The release branch moved to unexpected source; no force update is allowed.");
  git("merge-base", "--is-ancestor", base, head);
  return head;
}

function receipt(commit, idempotent) {
  console.log(`RELEASE_SOURCE_PUBLISHED=${JSON.stringify({ base, branch, commit, tree: expectedTree, idempotent })}`);
}

async function main() {
  if (!releaseDirectory || !process.env.RUNNER_TEMP
    || resolve(releaseDirectory) !== resolve(process.env.RUNNER_TEMP, "galaxy-producer-release-20261124")) fail("The verified runner worktree is unavailable.");
  if (git("rev-parse", "HEAD^{tree}") !== expectedTree || git("rev-parse", "HEAD^") !== base) fail("The local release commit does not match the reviewed base and source.");
  if (git("status", "--porcelain", "--untracked-files=no")) fail("The release worktree has uncommitted source changes.");
  if (git("config", "--get", "core.hooksPath") !== ".husky") fail("The repository's normal Git hooks are not active.");
  accessSync(resolve(releaseDirectory, ".husky/pre-commit"), constants.X_OK);
  accessSync(resolve(releaseDirectory, ".husky/pre-push"), constants.X_OK);
  checkMain();
  const existing = checkFeature();
  if (existing) { receipt(existing, true); return; }

  const token = process.env.APEX_BOT_TOKEN?.trim();
  if (!token) fail("The configured migration-history credential is unavailable.");
  let response;
  try {
    response = await fetch("https://xrzweoneiieddzxogewk.supabase.co/functions/v1/bot-sql", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "select coalesce(json_agg(version), '[]'::json) as v from supabase_migrations.schema_migrations" }),
      signal: AbortSignal.timeout(20000),
    });
  } catch { fail("The fresh migration-history read failed or timed out."); }
  if (!response.ok) fail(`The fresh migration-history read returned HTTP ${response.status}.`);
  let body;
  try { body = await response.json(); } catch { fail("The fresh migration-history response was not valid JSON."); }
  const versions = body?.rows?.[0]?.v;
  if (body?.ok !== true || !Array.isArray(body.rows) || body.rows.length !== 1
    || !Array.isArray(versions) || versions.length > 10000
    || !versions.every((version) => typeof version === "string" && /^\d{14}$/.test(version))
    || new Set(versions).size !== versions.length) fail("The fresh migration-history response was not a valid bounded version list.");

  // These are actual values just read above, not fabricated fixture data.
  // The unchanged pre-push hook compares them against origin/main's versions.
  const childEnv = { ...process.env, MIGRATIONS_RECORDED_FIXTURE: JSON.stringify(versions) };
  delete childEnv.APEX_BOT_TOKEN;
  delete childEnv.ALLOW_UNVERIFIED_MIGRATION_PUSH;
  checkMain();
  const alreadyPublished = checkFeature();
  if (alreadyPublished) { receipt(alreadyPublished, true); return; }
  const commit = git("rev-parse", "HEAD");
  console.log(`Fresh migration-history evidence validated: ${versions.length} recorded versions. Running normal Git push hooks.`);
  const pushed = spawnSync("git", ["push", "origin", `HEAD:${branchRef}`], {
    cwd: releaseDirectory, env: childEnv, encoding: "utf8", timeout: 600000, maxBuffer: 10 * 1024 * 1024,
  });
  for (const output of [pushed.stdout, pushed.stderr]) {
    if (output) console.log(output.split(token).join("[redacted]"));
  }
  if (pushed.error || pushed.status !== 0) fail("Normal Git push or its hooks failed; inspect the preceding hook output.");
  if (readFeatureHead() !== commit) fail("The release branch did not read back at the published commit.");
  checkMain();
  receipt(commit, false);
}

main().catch((error) => {
  console.error(`::error::${error instanceof ReleaseError ? error.message : "Release publication could not complete; no success receipt was recorded."}`);
  process.exitCode = 1;
});
