import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repository = "samcom593-creator/rebuild-brighten-sparkle";
const project = "xrzweoneiieddzxogewk";
const sourceCommit = "c405bf29d5ac14054cac05a5d3cc731271f0abc8";
const manifestPath = fileURLToPath(new URL("../recovery/producer-migrations-20261124.json", import.meta.url));
const pendingVersions = ["20261124120000", "20261124121000", "20261124130000", "20261124131000", "20261124140000"];
const historyQuery = "select coalesce(json_agg(version), '[]'::json) as v from supabase_migrations.schema_migrations";
const originalExpression = "coalesce(a.status,'')";
const correctedExpression = "coalesce(a.status::text,'')";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
class RecoveryError extends Error {}
const requireThat = (value, message) => { if (!value) throw new RecoveryError(message); };
const git = (...args) => execFileSync("git", args, {
  encoding: "utf8", timeout: 20000, maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
});

export function loadManifest() {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  requireThat(manifest.source_commit === sourceCommit && manifest.expected_count === 1198, "Recovery source manifest changed.");
  requireThat(JSON.stringify(manifest.pending_versions) === JSON.stringify(pendingVersions), "Recovery version scope changed.");
  requireThat(manifest.producer_path === "supabase/migrations/20261124120000_producer_workspace.sql", "Recovery target changed.");
  for (const key of ["versions_sha256", "original_sha256", "corrected_sha256", "config_sha256"]) {
    requireThat(/^[a-f0-9]{64}$/.test(manifest[key]), "Recovery content hash is invalid.");
  }
  requireThat(/^[a-f0-9]{40}$/.test(manifest.migration_tree), "Recovery tree hash is invalid.");
  return manifest;
}

// Only classify statements outside comments, strings, and dollar-quoted bodies.
// This refuses transaction control and executable DO/CALL/SELECT commands in
// the reviewed migrations; their function bodies are definitions, not calls.
export function topLevelStatements(sql) {
  let visible = "", i = 0;
  while (i < sql.length) {
    if (sql.startsWith("--", i)) { const end = sql.indexOf("\n", i); i = end < 0 ? sql.length : end; continue; }
    if (sql.startsWith("/*", i)) {
      let depth = 1; i += 2;
      while (i < sql.length && depth) {
        if (sql.startsWith("/*", i)) { depth++; i += 2; }
        else if (sql.startsWith("*/", i)) { depth--; i += 2; }
        else i++;
      }
      requireThat(depth === 0, "Unterminated SQL comment."); visible += " "; continue;
    }
    const quote = sql[i];
    if (quote === "'" || quote === '"') {
      const escapes = quote === "'" && /[eE]/.test(sql[i - 1] ?? "") && !/[A-Za-z0-9_]/.test(sql[i - 2] ?? "");
      let closed = false; i++;
      while (i < sql.length) {
        if (escapes && sql[i] === "\\") { i += 2; continue; }
        if (sql[i] === quote && sql[i + 1] === quote) { i += 2; continue; }
        if (sql[i++] === quote) { closed = true; break; }
      }
      requireThat(closed, "Unterminated SQL literal."); visible += " "; continue;
    }
    const tag = sql[i] === "$" && !/[A-Za-z0-9_]/.test(sql[i - 1] ?? "")
      ? /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i))?.[0] : null;
    if (tag) {
      const end = sql.indexOf(tag, i + tag.length);
      requireThat(end >= 0, "Unterminated SQL function body.");
      i = end + tag.length; visible += " "; continue;
    }
    visible += sql[i++];
  }
  const statements = visible.split(";").map((value) => value.trim()).filter(Boolean);
  requireThat(statements.length > 0 && statements.every((value) => /^(?:create|alter|grant|revoke|insert|comment)\b/i.test(value)), "Recovery SQL contains an unapproved top-level command.");
  return statements;
}

export function prepareCopy(manifest, temporaryRoot) {
  requireThat(git("rev-parse", `${sourceCommit}:supabase/migrations`).trim() === manifest.migration_tree, "Reviewed migration tree does not match its pin.");
  requireThat(git("rev-parse", "HEAD:supabase/migrations").trim() === manifest.migration_tree, "Main migration source changed; recovery must be reviewed again.");
  const files = git("ls-tree", "-r", "--name-only", sourceCommit, "--", "supabase/migrations")
    .trim().split("\n").filter((path) => /^supabase\/migrations\/\d{14}_[^/]+\.sql$/.test(path)).sort();
  const versions = files.map((path) => path.match(/\/(\d{14})_/)[1]);
  requireThat(files.length === manifest.expected_count && new Set(versions).size === manifest.expected_count, "Reviewed migration population changed.");
  requireThat(sha256(`${versions.join("\n")}\n`) === manifest.versions_sha256, "Reviewed migration version list changed.");
  const config = git("show", `${sourceCommit}:supabase/config.toml`);
  requireThat(sha256(config) === manifest.config_sha256, "Reviewed project config changed.");
  const copy = mkdtempSync(join(temporaryRoot, "producer-migration-recovery-"));
  const pendingSql = [];
  try {
    mkdirSync(join(copy, "supabase/migrations"), { recursive: true });
    writeFileSync(join(copy, "supabase/config.toml"), config, { flag: "wx", mode: 0o600 });
    for (const path of files) {
      let sql = git("show", `${sourceCommit}:${path}`);
      if (path === manifest.producer_path) {
        requireThat(sha256(sql) === manifest.original_sha256, "Original producer migration differs from its reviewed hash.");
        requireThat(sql.split(originalExpression).length === 2, "The reviewed enum expression is not unique.");
        sql = sql.replace(originalExpression, correctedExpression);
        requireThat(sha256(sql) === manifest.corrected_sha256, "Corrected producer migration differs from its reviewed hash.");
      }
      if (pendingVersions.includes(path.match(/\/(\d{14})_/)[1])) {
        topLevelStatements(sql); pendingSql.push(sql);
      }
      writeFileSync(join(copy, path), sql, { flag: "wx", mode: 0o600 });
    }
    requireThat(pendingSql.length === 5, "The five pending migrations were not prepared.");
    return { copy, versions, pendingSql };
  } catch (error) { rmSync(copy, { recursive: true, force: true }); throw error; }
}

function validateVersionList(versions) {
  requireThat(Array.isArray(versions) && versions.length <= 10000
    && versions.every((version) => typeof version === "string" && /^\d{14}$/.test(version))
    && new Set(versions).size === versions.length, "Migration history is not a bounded unique version list.");
}

export function classifyHistory(versions, expected) {
  validateVersionList(versions);
  const recorded = new Set(versions), allowed = new Set(expected);
  requireThat(versions.every((version) => allowed.has(version)), "Migration history has an unexpected version.");
  const missing = expected.filter((version) => !recorded.has(version));
  if (missing.length === 0) return "complete";
  requireThat(JSON.stringify(missing) === JSON.stringify(pendingVersions)
    && versions.length === 1193, "Pending migrations differ from the reviewed five; no writes are allowed.");
  return "ready";
}

async function botSql(query, token, purpose) {
  let response;
  try {
    response = await fetch(`https://${project}.supabase.co/functions/v1/bot-sql`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query }), signal: AbortSignal.timeout(20000),
    });
  } catch { throw new RecoveryError(`${purpose} failed or timed out.`); }
  requireThat(response.ok, `${purpose} returned HTTP ${response.status}.`);
  let body;
  try { body = await response.json(); } catch { throw new RecoveryError(`${purpose} returned invalid JSON.`); }
  requireThat(body?.ok === true && Array.isArray(body.rows), `${purpose} did not report success.`);
  return body.rows;
}

function checkContext() {
  requireThat(process.env.GITHUB_REPOSITORY === repository && process.env.GITHUB_EVENT_NAME === "push"
    && process.env.GITHUB_REF === "refs/heads/main", "Recovery requires a push to this repository's main branch.");
  const head = process.env.GITHUB_SHA;
  requireThat(/^[a-f0-9]{40}$/.test(head ?? "") && git("rev-parse", "HEAD").trim() === head, "Recovery checkout does not match the event commit.");
  git("merge-base", "--is-ancestor", sourceCommit, head);
  requireThat(git("ls-remote", "--exit-code", "origin", "refs/heads/main").trim() === `${head}\trefs/heads/main`, "Remote main moved; recovery must be reviewed again.");
  return head;
}

async function readHistory(token, phase, expected, head) {
  const rows = await botSql(historyQuery, token, "Migration-history read");
  requireThat(rows.length === 1, "Migration history did not contain exactly one row.");
  const versions = rows[0]?.v;
  validateVersionList(versions);
  console.log(`RECOVERY_MIGRATION_HISTORY=${JSON.stringify({ phase, source_main: sourceCommit, run_commit: head, checked_at: new Date().toISOString(), versions: [...versions].sort() })}`);
  return classifyHistory(versions, expected);
}

async function main() {
  const head = checkContext(), manifest = loadManifest();
  requireThat(process.env.RUNNER_TEMP, "The isolated runner temporary directory is required.");
  const token = process.env.APEX_BOT_TOKEN?.trim();
  requireThat(token, "The configured migration verification credential is unavailable.");
  const prepared = prepareCopy(manifest, process.env.RUNNER_TEMP);
  try {
    const state = await readHistory(token, "before", prepared.versions, head);
    if (state === "ready") {
      const password = process.env.SUPABASE_DB_PASSWORD;
      requireThat(password, "The configured database migration credential is unavailable.");
      // Definitions and the disabled campaign seed are checked against the real
      // schema, then rolled back. There is no migration-history insertion here.
      const query = `BEGIN; SET LOCAL statement_timeout = '15s'; SET LOCAL lock_timeout = '5s';\n${prepared.pendingSql.join("\n")}\nROLLBACK; SELECT true AS recovery_rolled_back;`;
      checkContext();
      const trial = await botSql(query, token, "Rolled-back schema preflight");
      requireThat(trial.length === 1 && trial[0]?.recovery_rolled_back === true, "Schema preflight did not confirm rollback completion.");
      console.log("The five corrected migrations passed the live-schema transaction preflight and were rolled back.");
      requireThat(await readHistory(token, "after_rollback", prepared.versions, head) === "ready", "Migration history changed during the schema preflight.");
      checkContext();
      const version = spawnSync("supabase", ["--version"], { encoding: "utf8", timeout: 20000 });
      requireThat(version.status === 0 && version.stdout.trim() === "2.105.0", "The reviewed Supabase CLI version is unavailable.");
      const databaseUrl = `postgresql://postgres.${project}:${encodeURIComponent(password)}@aws-1-us-west-2.pooler.supabase.com:5432/postgres`;
      const childEnv = { ...process.env };
      delete childEnv.APEX_BOT_TOKEN;
      delete childEnv.SUPABASE_DB_PASSWORD;
      const applied = spawnSync("supabase", ["db", "push", "--db-url", databaseUrl, "--include-all", "--yes"], {
        cwd: prepared.copy, env: childEnv, encoding: "utf8", timeout: 180000, maxBuffer: 4 * 1024 * 1024,
      });
      // Never forward raw CLI output: it can contain a connection URL or SQL.
      const finalState = await readHistory(token, "after_apply", prepared.versions, head);
      requireThat(!applied.error && applied.status === 0, "Supabase migration application failed; inspect the recorded-version receipt before recovery is retried.");
      requireThat(finalState === "complete", "Not all 1198 reviewed migrations were recorded after application.");
    }
    checkContext();
    console.log(`RECOVERY_COMPLETE=${JSON.stringify({ source_main: sourceCommit, run_commit: head, recorded_versions: prepared.versions.length, recovered_versions: pendingVersions, corrected_sha256: manifest.corrected_sha256, idempotent: state === "complete" })}`);
  } finally { rmSync(prepared.copy, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`::error::${error instanceof RecoveryError ? error.message : "Migration recovery could not complete; no success receipt was recorded."}`);
    process.exitCode = 1;
  });
}
