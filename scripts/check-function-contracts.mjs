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
import { inHandlerGate } from "./lib/in-handler-gate.mjs";

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

// MP-415: the three buckets below the original trio are all BASELINE 0 and are
// meant to stay there. They do not record pre-existing debt — they grade a
// claim an allowlist entry makes about itself, and a claim that fails is a
// defect in the entry, never inherited debt to be absorbed.
const buckets = {
  missing_config_block: [], missing_local_source: [], unallowlisted_public: [],
  allowlist_undeclared: [], allowlist_gate_unproven: [], public_by_design_over_ceiling: [],
};

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
  // MP-491 — three functions that authenticate a caller-presented bot token
  // in-handler, so verify_jwt = true could never be their boundary: the gateway
  // refuses `Bearer <apex_bot_token>` (64-char hex, not a JWT) with
  // UNAUTHORIZED_INVALID_JWT_FORMAT before the handler runs, while verify_jwt
  // itself accepts the public anon key shipped in the site bundle and is
  // therefore the WEAKER of the two checks. Each gates in-handler on the bot
  // token or the service role; agentlink-clients-sync additionally accepts a
  // user JWT that passes has_role(admin). Probed live 2026-09-09: anonymous and
  // garbage-bearer requests get the handler's own {"ok":false,
  // "error":"unauthorized"}, never the gateway's.
  //
  // agentlink-clients-sync was NOT a hypothetical. It was defaulted to
  // verify_jwt = true on 2026-08-20, deployed, and its 30-minute pg_cron caller
  // 401ed for sixteen days — agentlink_clients_sync_log stopped at
  // 2026-08-24T12:30:03Z while cron.job_run_details recorded 333 "succeeded",
  // because that column reports whether net.http_post enqueued, not whether
  // anything answered. Listed with rationale rather than raising the floor,
  // because a count-only ratchet is fungible (MP-356).
  "agentlink-clients-sync",
  "content-library",
  // content-thumb (MP-520): same shape as content-library — the caller is the
  // MacBook testimonial classifier (apex-testimonial-classifier.py) storing
  // screenshot thumbnails into clip-thumbs, and it holds no Supabase JWT, only
  // the APEX bot token, which the handler checks in code before doing anything
  // (401 / bad uuid / no-such-clip branches proven live on deploy). Gating it
  // at the gateway would refuse its only caller and the Library would render
  // every screenshot as a blank tile.
  "content-thumb",
  "slack-unlicensed-welcome",
  // content-share (MP-483): the /share/:token page is an unauthenticated route
  // (App.tsx, in the public block beside /apply) and SharePage.tsx fetches this
  // function with no Authorization and no apikey, because the share token in the
  // URL IS the credential — validated by a ^[A-Za-z0-9_-]{16,64}$ shape check and
  // then by lookup, with expiry enforced. The function reads with the service role
  // and returns only the clips that token names; it writes nothing on the caller's
  // behalf beyond its own view counter, and content_shares is never read from the
  // client. verify_jwt=false is intentional and matches how it is ALREADY deployed
  // — the config said true, so the next deploy would have 401ed every share link
  // at the gateway before the function ran. Allowlisted 2026-09-09 with that fix.
  "content-share",
  // site-shell-watch (MP-304): cron-invoked production-shell watcher — the
  // inbound call comes from pg_cron/GitHub schedule with the anon key, like
  // poke-webhook and calendly-webhook below; it authenticates its own OUTBOUND
  // reads with SUPABASE_SERVICE_ROLE_KEY internally and writes nothing on
  // behalf of the caller. verify_jwt=false is intentional; allowlisted
  // 2026-08-19 after it landed in 82c3dc20 without this entry and turned CI
  // red on every subsequent push.
  "site-shell-watch",
  // instagram-dm-replay (MP-561): same shape as the MP-491 three. Its only
  // automated caller is trg_instagram_token_replay, which fires through pg_net
  // from an AFTER INSERT/UPDATE on system_settings.meta_instagram_token and
  // presents `Bearer <apex_bot_token>` — a 64-char hex string, not a JWT, which
  // the gateway refuses with UNAUTHORIZED_INVALID_JWT_FORMAT before the handler
  // can run. So verify_jwt = true could never be this function's boundary; it
  // would only break the trigger that exists to drain the hold queue the moment
  // a fresh Instagram token lands, leaving every held reply unsent.
  // The handler fails closed FIRST, before any read or any send: index.ts:36-38
  // 401s unless the bearer matches APEX_BOT_TOKEN or the service-role key
  // exactly, and both arms are `&&`-guarded on a non-empty env so an unset
  // secret cannot acquit a caller. PROVEN LIVE against prod 2026-10-04, not
  // read off the comment: no Authorization -> HTTP 401 {"ok":false,
  // "error":"unauthorized"}, and `Bearer not-a-real-token` -> the same 401 —
  // the handler's own refusal, never the gateway's. It sends DMs, so this gate
  // is load-bearing: listed with rationale rather than raising the floor,
  // because a count-only ratchet is fungible (MP-356).
  "instagram-dm-replay",
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
  // Public recruiter cards used by referral and link-in-bio entry points.
  // The handler is rate-limited and returns only display name, public social
  // handle, avatar, and the agent id required for attribution; no contact,
  // auth, or production data is exposed.
  "get-public-recruiters",
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
  // MP-415 — the eight that turned this bucket red on 2026-09-30, each
  // classified in PUBLIC_CONTRACT below. Seven gate their caller in code and
  // the detector confirms it on every run; brand-collab is a public form. They
  // are allowlisted here rather than added to the floor because the floor
  // records debt, and correct code is not debt.
  "brand-collab",
  "brand-photo-upload",
  "cron-inbound-brain-health",
  // monday-starter-reminders (2026-10-07): its Sunday pg_cron caller presents a
  // 48-char hex vault secret, which the gateway refuses as
  // UNAUTHORIZED_INVALID_JWT_FORMAT when verify_jwt = true. It was deployed that
  // way by CI on 2026-10-06, so the first Sunday run would have sent nothing while
  // cron.job_run_details said "succeeded" (the agentlink-clients-sync failure
  // above, again). The handler's first statement refuses any bearer that is not
  // the service role and does not pass check_monday_reminder_secret(); probed
  // live: a garbage bearer gets the handler's own {"ok":false,"error":"unauthorized"}.
  "monday-starter-reminders",
  "cron-newhire-portal-login",
  "instagram-comments-backfill",
  "instagram-token-keepalive",
  "youtube-auth",
  "youtube-comments",
  // test-email-flows (2026-10-07): was open to anyone; requireSendAuth now
  // refuses a bare POST and the anon key. Probed live after deploy.
  "test-email-flows",
  // send-admin-email (2026-10-08): caller-chosen to/from/html on Sam's domain
  // and no credential read. requireSendAuth now; its four pg callers were moved
  // to the service key first (migration 20261008050000).
  "send-admin-email",
  // send-instagram-dm (2026-10-08): caller-chosen text, comment_id and `public`
  // posted as Sam's Instagram with no credential read. requireSendAuth now; its
  // one pg caller (dm_send_retry) was moved to the service key first
  // (migration 20261008062000).
  "send-instagram-dm",
  // send-notification (2026-10-08): caller-chosen email, title, raw-HTML message
  // and url sent from notifications@apex-financial.org with no credential read.
  // requireSendAuth (any_authenticated) now. Its four anon-key pg callers are
  // unscheduled and uncalled and were left on the anon key on purpose (see the
  // function header); every live caller presents the service key or a user JWT.
  "send-notification",
  // send-aged-lead-email (2026-10-08): caller-chosen recipient for the aged-lead
  // pitch, cc Sam and an optional manager, no credential read. requireSendAuth
  // (any_authenticated) now. No pg or cron caller.
  "send-aged-lead-email",
  // bulk-agent-message and send-batch-blast (2026-10-08): caller-chosen agent
  // ids + unescaped HTML message, and an uncapped lead-id fan-out to push, email
  // and text, both with no credential read. requireSendAuth (admin_or_manager)
  // now. Only callers are admin pages on the user's JWT; no pg, cron or edge.
  "bulk-agent-message",
  "send-batch-blast",
  // send-reapply-blast, send-seminar-invite-blast, send-bulk-unlicensed-outreach,
  // bulk-send-licensing (2026-10-08): a bare POST mailed every matching applicant
  // (38 / 647 / 693 / 693) with no credential read. requireSendAuth
  // (admin_or_manager) now. Only callers are admin pages on the user's JWT.
  "send-reapply-blast",
  "send-seminar-invite-blast",
  "send-bulk-unlicensed-outreach",
  "bulk-send-licensing",
  // send-unlicensed-process-update, bulk-resend-course-emails (2026-10-10): the
  // same bare-POST blast shape, missed by 62e99158 because neither reads a
  // recipient off the body. 695 applicants / 117 agents (magic link each, CC
  // Sam + manager). requireSendAuth (admin_or_manager). No callers at all.
  "send-unlicensed-process-update",
  "bulk-resend-course-emails",
  // send-sms-via-email (2026-10-09): a bare POST {phone, body} texted any US
  // number with caller-chosen words; {agentId, body} texted any agent. No
  // credential read. requireSendAuth (admin_or_manager) now. Callers:
  // bulk-agent-message (service key) and pg drain_sms_fallback_queue (service key).
  "send-sms-via-email",
  // notify-deal-alert (2026-10-10): a bare POST sent a caller-chosen agentName
  // from Sam's sending domain to every non-deactivated agent (83) by email and
  // push. requireSendAuth (admin_or_manager) now. No callers at all.
  "notify-deal-alert",
]);

// ---------------------------------------------------------------------------
// MP-415 — what an allowlist entry has to SHOW, not merely assert.
//
// THE DEFECT THIS CLOSES: for its whole life the test above was
// `PUBLIC_ALLOWLIST.has(fn)`. A name in a Set was the entire evidence standard
// for shipping verify_jwt = false, and the prose rationale beside each entry —
// careful, specific, often citing a live probe — was read by humans and graded
// by nothing. So the cost of turning this guard green on a genuinely open
// endpoint was typing one line.
//
// That is not hypothetical. On 2026-09-30 this bucket went red naming eight
// functions at once. SEVEN of them gate their caller in code and were correct.
// The eighth, youtube-auth, had no gate of any kind: it walked Google consent
// with no `state` and no initiation secret, and its callback upserted
// youtube_connections with the service role, which youtube-comments then reads
// unfiltered and treats as a standing instruction. Clearing that red the cheap
// way — paste all eight names in — would have handed the hole a permanent green
// under a rationale nobody checked. MP-357 is the recorded precedent: a
// security floor was turned green by allowlisting a bystander.
//
// SO: every allowlisted function must declare HOW it is protected, and the one
// claim that can be mechanically checked is checked.
//
//   in_handler_gate    — refuses an unproven caller in code. VERIFIED against
//                        scripts/lib/in-handler-gate.mjs on every run. If the
//                        detector cannot find the gate, the claim fails the
//                        build. This is the load-bearing category.
//   url_token          — the credential is in the URL and is looked up; the
//                        share/feed/invite token IS the caller's proof.
//   provider_signature — a third-party webhook signature or shared secret
//                        (Stripe constructEvent, Meta app secret, et al).
//   public_by_design   — NO caller credential, intentionally. The dangerous
//                        set. Bounded by a ceiling below so it cannot grow
//                        quietly, and every member is NAMED on every run.
//
// WHY THE OTHER THREE ARE NOT MECHANICALLY GRADED, stated rather than claimed
// away: a url_token lookup and a provider signature are real gates, but writing
// detectors for them in the same breath as this one would be two more
// conventions sized by guesswork. They are declared, named, and counted. That
// is strictly more than the Set they replace, and less than in_handler_gate.
// The honest reading of a url_token line is "a human asserted this and nothing
// re-checks it" — the same standing every entry had before, now visible as such
// instead of hiding inside a flat list.
const PUBLIC_CONTRACT = {
  // --- gates its caller in code; CHECKED every run -----------------------
  "agentlink-clients-sync": "in_handler_gate",
  "content-library": "in_handler_gate",
  "content-thumb": "in_handler_gate",
  "slack-unlicensed-welcome": "in_handler_gate",
  "site-shell-watch": "in_handler_gate",
  "discord-webhook-notify": "in_handler_gate",
  "manychat-webhook": "in_handler_gate",
  "telegram-webhook": "in_handler_gate",
  "free-leads-weekly-alerts": "in_handler_gate",
  "onboarding-call-invites": "in_handler_gate",
  "numbers-reminder": "in_handler_gate",
  "license-milestone-sms-drain": "in_handler_gate",
  "slack-identity-admin": "in_handler_gate",
  "provision-agent-accounts": "in_handler_gate",
  "slack-announce": "in_handler_gate",
  // cron-newhire-portal-login + cron-inbound-brain-health: x-cron-secret
  // compared against the environment as the handler's first statement, probed
  // live 401 on a bare POST and on a wrong secret (MP-413).
  "cron-newhire-portal-login": "in_handler_gate",
  "cron-inbound-brain-health": "in_handler_gate",
  "monday-starter-reminders": "in_handler_gate",
  "instagram-comments-backfill": "in_handler_gate",
  "instagram-token-keepalive": "in_handler_gate",
  "instagram-dm-replay": "in_handler_gate",
  "youtube-comments": "in_handler_gate",
  // youtube-auth (MP-412): two gates, both proven live on prod — a connect key
  // derived HMAC-SHA256(APEX_BOT_TOKEN, "youtube-auth-connect-v1") to reach
  // consent, and a `state` this function signed within 15 minutes on the
  // callback. Absent APEX_BOT_TOKEN it returns 503 rather than falling open.
  // Detected via MAC_VERIFY: it holds no `===` against a header anywhere,
  // because the comparison IS the MAC verification.
  "youtube-auth": "in_handler_gate",
  // brand-photo-upload: x-edit-code compared against BRAND_EDIT_CODE, length
  // check first and a 700ms delay on mismatch so the code cannot be brute
  // forced fast. Refuses with json(body, 401) — a positional argument, which
  // is why the detector had to learn that shape (MP-415).
  "brand-photo-upload": "in_handler_gate",
  // test-email-flows: requireSendAuth (service key or admin/manager JWT), the
  // send-email gate. Its fan-out flows mail every manager.
  "test-email-flows": "in_handler_gate",
  // send-admin-email: requireSendAuth, same gate. The only live caller is the
  // trg_notify_sam_licensing trigger, which presents the service key.
  "send-admin-email": "in_handler_gate",
  // send-instagram-dm: requireSendAuth, same gate. Live callers are three edge
  // functions on the service key (instagram-webhook, -comments-backfill, -dm-replay).
  "send-instagram-dm": "in_handler_gate",
  // send-notification: requireSendAuth, floor any_authenticated. Live callers:
  // system-health-check (service key), two pg fns on the service key, and six
  // src/ sites on the signed-in user's JWT.
  "send-notification": "in_handler_gate",
  // send-aged-lead-email: requireSendAuth, floor any_authenticated. Callers:
  // AgedLeadImporter (user JWT) and send-batch-blast (service key).
  "send-aged-lead-email": "in_handler_gate",
  // bulk-agent-message: requireSendAuth, admin_or_manager. Caller AgentManagement.
  "bulk-agent-message": "in_handler_gate",
  // send-batch-blast: requireSendAuth, admin_or_manager. Caller NotificationHub.
  "send-batch-blast": "in_handler_gate",
  // The four applicant blasts: requireSendAuth, admin_or_manager. Callers
  // InboxPage + NotificationHub (seminar) and ControlTerminal (licensing).
  "send-reapply-blast": "in_handler_gate",
  "send-seminar-invite-blast": "in_handler_gate",
  "send-bulk-unlicensed-outreach": "in_handler_gate",
  "bulk-send-licensing": "in_handler_gate",
  // Two more blasts, 2026-10-10: requireSendAuth, admin_or_manager. No callers.
  "send-unlicensed-process-update": "in_handler_gate",
  "bulk-resend-course-emails": "in_handler_gate",
  // send-sms-via-email: requireSendAuth, admin_or_manager. Callers
  // bulk-agent-message and drain_sms_fallback_queue(), both on the service key.
  "send-sms-via-email": "in_handler_gate",
  // notify-deal-alert: requireSendAuth, admin_or_manager. No callers.
  "notify-deal-alert": "in_handler_gate",

  // --- the credential is the token in the URL ----------------------------
  "content-share": "url_token",
  "ics-feed": "url_token",
  "consume-invite-token": "url_token",

  // --- third-party webhook signature / shared secret ---------------------
  "stripe-webhook-lead-purchase": "provider_signature",
  "instagram-webhook": "provider_signature",
  "readymode-webhook": "provider_signature",
  "calendly-webhook": "provider_signature",

  // --- no caller credential, intentionally -------------------------------
  // Public forms, email-link endpoints and tracking pixels. Each writes with
  // the service role on behalf of a stranger BY DESIGN, which is why this set
  // is ceilinged and named rather than merely listed.
  "submit-application": "public_by_design",
  "submit-contracting-intake": "public_by_design",
  "seminar-register": "public_by_design",
  "seminar-confirmation": "public_by_design",
  "manager-signup": "public_by_design",
  "applicant-checkin": "public_by_design",
  "get-public-recruiters": "public_by_design",
  "track-email-click": "public_by_design",
  "track-email-open": "public_by_design",
  "unsubscribe": "public_by_design",
  // brand-collab (MP-415): the King of Sales collab form. POST-only, validates
  // an email shape and a message length, then inserts with the service role and
  // mails Sam. Same shape as submit-application. No gate, and correctly so.
  "brand-collab": "public_by_design",
  // MP-415 RECORDED HONESTLY RATHER THAN DRESSED UP: these two sat in the flat
  // allowlist under a shared comment asserting they "authenticate with the
  // rotating bot token or a valid user session". They do not. Neither reads any
  // caller credential — measured, not inferred:
  //   poke-webhook              — any caller can insert into poke_queue and ack
  //                               rows with the service role.
  //   update-application-referral — takes an applicationId and writes
  //                               applications.notes with the service role; the
  //                               user_roles/admin lookup inside it authorizes
  //                               the ASSIGNED AGENT, not the caller.
  // They are declared public_by_design because that is what the code is, not
  // because it is desirable. Classifying them in_handler_gate would fail this
  // guard, which is the point — the prose claim can no longer outrank the
  // source. Left functionally unchanged this wave: both have live callers and
  // closing them is a product change, not a guard change. They are NAMED on
  // every run instead of hiding in a list of 34.
  "poke-webhook": "public_by_design",
  "update-application-referral": "public_by_design",
};

// The ceiling on gateless endpoints. A ceiling, not a bump-me floor: the only
// way past it is to delete an entry or argue in a commit for raising it.
const PUBLIC_BY_DESIGN_CEILING = 13;

// Neither structure may drift from the other. An allowlist entry with no
// declared contract would silently keep the old name-is-enough standard, and a
// declared contract for a name that is not allowlisted is a dead rationale.
for (const fn of PUBLIC_ALLOWLIST) {
  if (!PUBLIC_CONTRACT[fn]) {
    logError("allowlist_undeclared", fn, `Function '${fn}' is in PUBLIC_ALLOWLIST with no declared PUBLIC_CONTRACT category`);
  }
}
for (const fn of Object.keys(PUBLIC_CONTRACT)) {
  if (!PUBLIC_ALLOWLIST.has(fn)) {
    logError("allowlist_undeclared", fn, `Function '${fn}' declares a PUBLIC_CONTRACT category but is not in PUBLIC_ALLOWLIST`);
  }
}

// The in_handler_gate claim is the one that is checked.
const gatelessByDesign = [];
for (const [fn, kind] of Object.entries(PUBLIC_CONTRACT)) {
  if (kind === "public_by_design") gatelessByDesign.push(fn);
  if (kind !== "in_handler_gate") continue;
  const srcPath = path.join(FUNCTIONS_DIR, fn, "index.ts");
  if (!fs.existsSync(srcPath)) {
    logError("allowlist_gate_unproven", fn, `Function '${fn}' claims in_handler_gate but has no local source to check`);
    continue;
  }
  const gate = inHandlerGate(fs.readFileSync(srcPath, "utf8"));
  if (!gate.via) {
    logError("allowlist_gate_unproven", fn, `Function '${fn}' is allowlisted as in_handler_gate but no in-handler gate was found. Either it does not refuse an unproven caller (fix the function), or it gates by a convention scripts/lib/in-handler-gate.mjs does not know yet (widen the detector and prove the new convention load-bearing -- do NOT reclassify it to silence this).`);
  }
}

if (gatelessByDesign.length > PUBLIC_BY_DESIGN_CEILING) {
  logError(
    "public_by_design_over_ceiling",
    "ceiling",
    `${gatelessByDesign.length} functions are declared public_by_design, over the ceiling of ${PUBLIC_BY_DESIGN_CEILING}. A gateless endpoint that writes with the service role is the most expensive thing in this file; raise the ceiling only in a commit that argues for it.`,
  );
}


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
