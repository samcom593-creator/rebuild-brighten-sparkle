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
const BASELINES = {
  missing_config_block: 2,
  missing_local_source: 2,
  unallowlisted_public: 218,
};

const buckets = { missing_config_block: [], missing_local_source: [], unallowlisted_public: [] };

function logError(bucket, msg) {
  buckets[bucket].push(msg);
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
    logError("missing_local_source", `Invoked edge function '${fn}' has no local directory in supabase/functions/`);
  }
  if (!configBlocks.has(fn)) {
    logError("missing_config_block", `Invoked edge function '${fn}' is missing from supabase/config.toml`);
  }
}

// Rule 2: Every local edge function must have a config block, or the deploy
// pipeline will not ship it.
for (const fn of localFunctions) {
  if (!configBlocks.has(fn)) {
    logError("missing_config_block", `Local edge function '${fn}' is missing from supabase/config.toml`);
  }
}

// Rule 3 is informational only — see the header. Collected for the matrix.
const undefinedRpcs = Array.from(allRpcCalls)
  .filter((rpc) => !sqlFunctions.has(rpc.toLowerCase()))
  .sort();

// Allowed public functions (must have explicit rationale)
const PUBLIC_ALLOWLIST = new Set([
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
]);

// Rule 4: verify_jwt status. Ratcheted, not absolute. Flipping the ~236 legacy
// functions in one sweep is not deployment-safe: verify_jwt = true rejects any
// caller that presents no Supabase JWT, and this project has live pg_net
// triggers and external webhooks in that set. The ratchet stops the set growing
// while each flip is verified against its real caller inventory.
for (const [fn, cfg] of configBlocks.entries()) {
  if (!cfg.verifyJwt && !PUBLIC_ALLOWLIST.has(fn)) {
    logError("unallowlisted_public", `Function '${fn}' has verify_jwt = false but is not in the approved PUBLIC_ALLOWLIST`);
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

let failed = false;
for (const [bucket, found] of Object.entries(buckets)) {
  const baseline = BASELINES[bucket];
  if (found.length > baseline) {
    failed = true;
    console.error(`\n❌ ${bucket}: ${found.length} (baseline ${baseline}) — ${found.length - baseline} new`);
    for (const msg of found.slice(0, 20)) console.error(`   - ${msg}`);
  } else if (found.length < baseline) {
    console.log(`✅ ${bucket}: ${found.length} (baseline ${baseline}) — paid down ${baseline - found.length}; lower the baseline`);
  } else {
    console.log(`✅ ${bucket}: ${found.length} (at baseline)`);
  }
}

if (failed) {
  console.error("\nA new edge-function contract violation was introduced. Fix it, or move the");
  console.error("endpoint into PUBLIC_ALLOWLIST with a written rationale.");
  process.exit(1);
}
console.log("✅ No new edge-function contract violations.");
