// Edge-function contract ratchet.
//
// Grades on MOVEMENT, not on count. Every bucket below carries a committed
// baseline equal to the debt that existed when the guard was written. A new
// violation fails the build; paying debt down lowers the baseline. This is the
// same shape as check-tsc-error-count and check-empty-catch, and it exists
// because the first draft of this guard reported 236 errors against a healthy
// tree — a permanently red guard is a guard everybody learns to skip.
//
// RPC-definition drift is deliberately INFORMATIONAL, not an error. Postgres
// functions in this project are routinely applied by hand through bot-sql and
// never round-tripped into supabase/migrations, so the migrations directory does
// not model the deployed database. Grading against it would report absences that
// are not defects. apex-doctor queries pg_proc and is the authority on deployed
// state; this script is the authority on what the current commit declares.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const CONFIG_PATH = path.join(REPO_ROOT, "supabase/config.toml");
const FUNCTIONS_DIR = path.join(REPO_ROOT, "supabase/functions");
const MIGRATIONS_DIR = path.join(REPO_ROOT, "supabase/migrations");
const SRC_DIR = path.join(REPO_ROOT, "src");
const MATRIX_OUTPUT = path.join(REPO_ROOT, "docs/audits/apex-function-contract-matrix.md");

// Baselines measured at commit 8d37e7bd against the reverted (live) config.toml.
// Lower these when debt is paid down. Never raise one to make a build pass
// without saying so in the commit message.
// create-va-account and set-va-account account for the 2 in the first two
// buckets: both are live in production (v30, ACTIVE, verify_jwt=true) but their
// source was never committed here. Reconstructing it from inference and
// deploying would overwrite a working production function with a guess, so the
// debt is recorded rather than papered over. Clear it by exporting the real
// deployed source, not by writing a plausible replacement.
// The floor is a SET of function names, not three integers — see the WHY block
// at the bottom of this file. Regenerate with:  node scripts/check-function-contracts.mjs --write-baseline
const BASELINE_PATH = path.join(REPO_ROOT, "scripts/data/function-contracts-baseline.json");
const GLYPH_OK = "\u2705";
const GLYPH_BAD = "\u274c";

const buckets = { missing_config_block: [], missing_local_source: [], unallowlisted_public: [] };

// Every violation carries the FUNCTION NAME as its key. The prose message is
// for the human; the key is what the floor is graded on. See the WHY block at
// the bottom of this file (MP-357) for why a bare count was not enough.
function logError(bucket, key, msg) {
  buckets[bucket].push({ key, msg });
}

// 1. Read config.toml function blocks
const configContent = fs.readFileSync(CONFIG_PATH, "utf8");
const configBlocks = new Map();
const blockRegex = /\[functions\.([a-zA-Z0-9_-]+)\][\s\S]*?(?=\n\[|$)/g;
let match;
while ((match = blockRegex.exec(configContent)) !== null) {
  const funcName = match[1];
  const blockText = match[0];
  const verifyJwt = /verify_jwt\s*=\s*false/i.test(blockText) ? false : true;
  configBlocks.set(funcName, { verifyJwt, raw: blockText });
}

// 2. Read local edge function directories
const localFunctions = new Set(
  fs.readdirSync(FUNCTIONS_DIR)
    .filter(d => fs.statSync(path.join(FUNCTIONS_DIR, d)).isDirectory() && d !== "_shared" && d !== "tests")
);

// 3. Scan invoked edge functions from src/
function scanInvocations(dir) {
  const invocations = new Set();
  const rpcCalls = new Set();

  function traverse(currentDir) {
    for (const entry of fs.readdirSync(currentDir)) {
      const fullPath = path.join(currentDir, entry);
      if (fs.statSync(fullPath).isDirectory()) {
        if (entry !== "node_modules" && entry !== ".git" && entry !== "dist") {
          traverse(fullPath);
        }
      } else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry)) {
        const content = fs.readFileSync(fullPath, "utf8");
        
        // Match supabase.functions.invoke("name")
        const funcMatches = content.matchAll(/functions\.invoke\s*\(\s*["']([a-zA-Z0-9_-]+)["']/g);
        for (const m of funcMatches) {
          invocations.add(m[1]);
        }

        // Match supabase.rpc("name")
        const rpcMatches = content.matchAll(/rpc\s*\(\s*["']([a-zA-Z0-9_-]+)["']/g);
        for (const m of rpcMatches) {
          rpcCalls.add(m[1]);
        }
      }
    }
  }

  traverse(dir);
  return { invocations, rpcCalls };
}

const { invocations, rpcCalls } = scanInvocations(SRC_DIR);
// Also scan edge functions for rpc calls
const edgeScan = scanInvocations(FUNCTIONS_DIR);

const allInvocations = new Set([...invocations]);
const allRpcCalls = new Set([...rpcCalls, ...edgeScan.rpcCalls]);

// 4. Scan SQL functions defined in migrations
function scanMigrationFunctions() {
  const sqlFunctions = new Set();
  for (const file of fs.readdirSync(MIGRATIONS_DIR)) {
    if (file.endsWith(".sql")) {
      const content = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      const fnMatches = content.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([a-zA-Z0-9_-]+)\s*\(/gi);
      for (const m of fnMatches) {
        sqlFunctions.add(m[1].toLowerCase());
      }
    }
  }
  return sqlFunctions;
}

const sqlFunctions = scanMigrationFunctions();

// --- VALIDATION RULES ---

// Rule 1: Every invoked edge function must have local source and config block.
// This is the failure that silently 404s forever, so its baseline is 0.
for (const fn of allInvocations) {
  if (!localFunctions.has(fn)) {
    logError("missing_local_source", fn, `Invoked edge function '${fn}' has no local directory in supabase/functions/`);
  }
  if (!configBlocks.has(fn)) {
    logError("missing_config_block", fn, `Invoked edge function '${fn}' is missing from supabase/config.toml`);
  }
}

// Rule 2: Every local edge function must have a config block, or the deploy
// pipeline will not ship it.
for (const fn of localFunctions) {
  if (!configBlocks.has(fn)) {
    logError("missing_config_block", fn, `Local edge function '${fn}' is missing from supabase/config.toml`);
  }
}

// Rule 3 is informational only — see the header. Collected for the matrix.
const undefinedRpcs = Array.from(allRpcCalls)
  .filter((rpc) => !sqlFunctions.has(rpc.toLowerCase()))
  .sort();

// Allowed public functions (must have explicit rationale)
const PUBLIC_ALLOWLIST = new Set([
  // site-shell-watch (MP-304): cron-invoked production-shell watcher — the
  // inbound call comes from pg_cron/GitHub schedule with the anon key, like
  // poke-webhook and calendly-webhook below; it authenticates its own OUTBOUND
  // reads with SUPABASE_SERVICE_ROLE_KEY internally and writes nothing on
  // behalf of the caller. verify_jwt=false is intentional; allowlisted
  // 2026-08-19 after it landed in 82c3dc20 without this entry and turned CI
  // red on every subsequent push.
  "site-shell-watch",
  // Database triggers and durable outbox workers may authenticate with the
  // rotating bot token rather than a gateway-verifiable JWT. The function
  // itself fails closed and accepts only that trusted token or a valid user
  // session, with admin/manager authorization enforced for user calls.
  "discord-webhook-notify",
  "consume-invite-token",
  "ics-feed",
  "submit-application",
  "seminar-confirmation",
  "seminar-register",
  "update-application-referral",
  "poke-webhook",
  "calendly-webhook",
  "instagram-webhook",
  "manychat-webhook",
  "readymode-webhook",
  "telegram-webhook",
  "stripe-webhook-lead-purchase",
  "track-email-click",
  "track-email-open",
  "unsubscribe",
  "manager-signup",
  "applicant-checkin",
  // Public five-field contracting intake. No JWT because producers have no
  // APEX login; controls are the field allowlist, fail-closed rate limiting,
  // a honeypot, and a service-role-only RPC behind it.
  "submit-contracting-intake",
  // Cron workers use the rotating APEX bot token rather than a Supabase JWT.
  // Both handlers compare that bearer themselves and fail closed; the
  // onboarding worker additionally reserves diagnostics/send-one for the
  // service-role bearer.
  "free-leads-weekly-alerts",
  "onboarding-call-invites",
  // Scheduled numbers delivery and the Slack identity bridge cannot rely on a
  // user JWT. Both accept only the rotating APEX bot token or service-role
  // bearer in-code, fail closed when configuration is missing, and expose no
  // anonymous success path.
  "numbers-reminder",
  // license-milestone-sms-drain (MP-341): pg_cron jobid 94 invokes it every 10 min
  // through run_automation_job with the bot bearer; the handler rejects any
  // caller without it, so verify_jwt=false is the cron seam, not an open door.
  "license-milestone-sms-drain",
  "slack-identity-admin",
  // provision-agent-accounts + slack-announce (MP-357): both landed after the
  // floor was locked at 217 and turned verify:core red on every push. Gate READ
  // before allowlisting, not assumed:
  //   slack-announce/index.ts:29-31 — `auth !== \`Bearer ${APEX_BOT_TOKEN}\`` -> 401.
  //   provision-agent-accounts/index.ts:57-67 — accepts SERVICE_ROLE_KEY,
  //   APEX_BOT_TOKEN, or their system_settings copies, each required to be >16
  //   chars, and returns 401 on anything else. Wider than a single constant
  //   because the rotation leaves two live values (MP-304), but it fails closed.
  // Both are cron/bot seams like the entries above: verify_jwt=false is the
  // seam, not an open door.
  "provision-agent-accounts",
  "slack-announce",
]);

// Rule 4: verify_jwt status. Ratcheted, not absolute. Flipping the ~236 legacy
// functions in one sweep is not deployment-safe: verify_jwt = true rejects any
// caller that presents no Supabase JWT, and this project has live pg_net
// triggers and external webhooks in that set. The ratchet stops the set growing
// while each flip is verified against its real caller inventory.
for (const [fn, cfg] of configBlocks.entries()) {
  if (!cfg.verifyJwt && !PUBLIC_ALLOWLIST.has(fn)) {
    logError("unallowlisted_public", fn, `Function '${fn}' has verify_jwt = false but is not in the approved PUBLIC_ALLOWLIST`);
  }
}

// Generate contract matrix Markdown document
const matrixLines = [
  "# APEX Function Contract Matrix",
  "",
  `Generated: ${new Date().toISOString()}`,
  `Repository: \`${REPO_ROOT}\``,
  "",
  "## Inventory Summary",
  "",
  `- Total Local Edge Functions: **${localFunctions.size}**`,
  `- Configured in \`config.toml\`: **${configBlocks.size}**`,
  `- Invoked Edge Functions in Source: **${allInvocations.size}**`,
  `- Invoked RPC Calls in Source: **${allRpcCalls.size}**`,
  `- SQL Functions in Migrations: **${sqlFunctions.size}**`,
  "",
  "## Edge Function Auth & Verification Contracts",
  "",
  "| Function Name | Local Source | config.toml Entry | verify_jwt | Classification | Status |",
  "| --- | --- | --- | --- | --- | --- |",
];

const allFuncNames = Array.from(new Set([...localFunctions, ...configBlocks.keys()])).sort();

for (const fn of allFuncNames) {
  const hasSource = localFunctions.has(fn) ? "Yes" : "NO";
  const hasConfig = configBlocks.has(fn) ? "Yes" : "NO";
  const jwt = configBlocks.get(fn)?.verifyJwt ? "true" : "false";
  const isPub = PUBLIC_ALLOWLIST.has(fn);
  const classification = isPub ? "Public / Webhook In-Code Verified" : "Authenticated JWT";

  // A row is only PASS when it is actually clean. The prior version of this
  // line read `? "PASS" : "PASS"`, so the matrix reported a green wall no
  // matter what the tree contained and could not be used as evidence.
  const reasons = [];
  if (hasSource === "NO") reasons.push("no local source");
  if (hasConfig === "NO") reasons.push("not in config.toml");
  if (jwt === "false" && !isPub) reasons.push("public but not allowlisted");
  const status = reasons.length === 0 ? "PASS" : `DEBT: ${reasons.join("; ")}`;

  matrixLines.push(`| \`${fn}\` | ${hasSource} | ${hasConfig} | \`${jwt}\` | ${classification} | ${status} |`);
}

matrixLines.push(
  "",
  "## Invoked RPC Coverage (informational)",
  "",
  "Absence here is NOT a defect. Postgres functions in this project are routinely",
  "applied by hand through bot-sql and never round-tripped into",
  "`supabase/migrations`, so this directory does not model the deployed database.",
  "`apex-doctor` queries `pg_proc` and is the authority on deployed state.",
  "",
  `- Invoked RPCs: **${allRpcCalls.size}**`,
  `- Also declared in this commit's migrations: **${allRpcCalls.size - undefinedRpcs.length}**`,
  `- Declared only in the database: **${undefinedRpcs.length}**`,
  ""
);

// Create the output dir if it is absent. docs/audits/ is git-untracked, so on a
// fresh CI checkout it does not exist and writeFileSync threw ENOENT — which is
// how this guard reddened verify:core for the whole team on 2944f477. A guard
// must not depend on an untracked directory happening to be present.
fs.mkdirSync(path.dirname(MATRIX_OUTPUT), { recursive: true });
fs.writeFileSync(MATRIX_OUTPUT, matrixLines.join("\n"), "utf8");
console.log(`Generated ${MATRIX_OUTPUT}`);

// ---------------------------------------------------------------------------
// WHY THIS GRADES A SET OF NAMES AND NOT THREE INTEGERS (2026-08-31, MP-357).
//
// This guard used to compare `found.length` against one integer per bucket. An
// integer is FUNGIBLE, and on a SECURITY contract that is not a style problem:
// allowlisting one existing function and adding one brand-new unguarded public
// endpoint in the same tree nets zero, so the gate goes green over a live hole.
//
// PROVEN, not argued. From 2174bbf6 (green at exactly 217): allowlist
// `discord-leaderboards` (-1) and add `totally-new-open-hole`, whose entire
// body is `Deno.serve(() => new Response("secrets"))` with no auth of any kind
// (+1). The old guard printed "unallowlisted_public: 217 (at baseline)" and
// exited 0. The matrix it generated even LISTED the new endpoint. It saw it and
// reported green.
//
// The reporting was wrong in the same direction. On 219-vs-217 it printed
// "2 new" and then `found.slice(0, 20)` — the first twenty violators in scan
// order. The two actual regressions (provision-agent-accounts, slack-announce)
// were not among the twenty names it showed. An operator handed that output
// fixes, or allowlists, whichever innocent function is at the top of the list.
// A true alert nobody can act on costs what a false one costs.
//
// Keyed on function NAME only. No line numbers, no file positions: those move
// under unrelated edits and produce the permanently-red guard this repo has
// recorded many costumes of.
const observed = {};
for (const [bucket, found] of Object.entries(buckets)) {
  observed[bucket] = new Set(found.map((f) => f.key));
}

if (process.argv.includes("--write-baseline")) {
  const out = {
    _why:
      "Floor for check-function-contracts.mjs, keyed per function name so a new " +
      "violation cannot be offset by an unrelated pay-down in the same tree. " +
      "See the WHY block in the guard for the proof. Regenerate with --write-baseline.",
    _generated_from: "supabase/config.toml + supabase/functions + src invocation scan",
    buckets: Object.fromEntries(
      Object.entries(observed).map(([b, set]) => [b, [...set].sort()]),
    ),
  };
  fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(out, null, 2) + "\n");
  console.log(
    `wrote ${path.relative(REPO_ROOT, BASELINE_PATH)}: ` +
      Object.entries(out.buckets).map(([b, l]) => `${b}=${l.length}`).join("  "),
  );
  process.exit(0);
}

let baselineDoc;
try {
  baselineDoc = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
  if (!baselineDoc || typeof baselineDoc.buckets !== "object" || baselineDoc.buckets === null) {
    throw new Error("no `buckets` object");
  }
} catch (e) {
  // Never a silent pass. Without the floor nothing is being measured, and a
  // guard that cannot read its own baseline must say so rather than exit 0.
  console.error(`\n${GLYPH_BAD} ${path.relative(REPO_ROOT, BASELINE_PATH)} is missing or unreadable (${e.message}).`);
  console.error("It is the floor this guard grades against — without it nothing is measured.");
  console.error(`Regenerate with: node ${path.relative(REPO_ROOT, process.argv[1])} --write-baseline`);
  process.exit(1);
}

let failed = false;
const paydownBuckets = [];
for (const bucket of Object.keys(buckets)) {
  const now = observed[bucket];
  const was = new Set(baselineDoc.buckets[bucket] ?? []);
  const added = [...now].filter((k) => !was.has(k)).sort();
  const cleared = [...was].filter((k) => !now.has(k)).sort();

  if (added.length) {
    failed = true;
    console.error(`\n${GLYPH_BAD} ${bucket}: ${added.length} NEW (${now.size} total, floor ${was.size})`);
    for (const key of added) {
      const hit = buckets[bucket].find((f) => f.key === key);
      console.error(`   - ${hit ? hit.msg : key}`);
    }
    if (cleared.length) {
      console.error(
        `   (${cleared.length} unrelated entr(y/ies) were cleared in the same tree. They do ` +
          `NOT offset the above — that is the whole point of this floor.)`,
      );
    }
  } else if (cleared.length) {
    paydownBuckets.push({ bucket, cleared, size: now.size, was: was.size });
  } else {
    console.log(`${GLYPH_OK} ${bucket}: ${now.size} (at floor)`);
  }
}

if (failed) {
  console.error("\nA new edge-function contract violation was introduced. Fix it, or move the");
  console.error("endpoint into PUBLIC_ALLOWLIST with a written rationale.");
  process.exit(1);
}

if (paydownBuckets.length) {
  // Ground gained is locked in, not left available to absorb someone else's
  // regression later. Same rule as check-maybesingle-nonunique (MP-356).
  for (const p of paydownBuckets) {
    console.error(`\n${GLYPH_BAD} ${p.bucket}: ${p.cleared.length} entr(y/ies) paid down (${p.was} -> ${p.size}):`);
    for (const key of p.cleared) console.error(`   - ${key}`);
  }
  console.error(
    `\nUpdate the floor so the ground gained cannot be given back:\n` +
      `  node ${path.relative(REPO_ROOT, process.argv[1])} --write-baseline`,
  );
  process.exit(1);
}

console.log(`${GLYPH_OK} No new edge-function contract violations.`);
