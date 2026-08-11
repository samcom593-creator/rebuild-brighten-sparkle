#!/usr/bin/env node
/**
 * check:discord-pii — client identity must never reach an outbound webhook.
 *
 * On 2026-08-11 `notify-deal-submitted` was posting this to Discord on every
 * closed deal:
 *
 *     { name: "👤 Client", value: clientName, inline: true }
 *
 * ...where clientName was `${deal.client_first_name} ${deal.client_last_name}`.
 * 243 deals in the preceding 30 days, every one of them carrying a real client's
 * full name into a chat channel. The documented scope for Discord has always
 * been "deals/apps/hires/milestones, never PII".
 *
 * A naive grep for `client_first_name` inside the embed literal would NOT have
 * caught it: the PII was laundered through a local variable 17 lines earlier.
 * So this does a one-level taint check — that is the depth the real bug used,
 * and going deeper on a regex basis produces false positives, which are their
 * own failure mode (see check-enum-filter-literals, which blocked a correct
 * commit the same day).
 *
 * A win post is agent + carrier + product + money. Never who bought it.
 */
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const FUNCTIONS = path.join(repoRoot, "supabase/functions");

// Fields that identify a client. Agent/profile fields are deliberately absent:
// posting the AGENT's name is the entire point of a win post.
const PII_FIELDS = [
  "client_first_name",
  "client_last_name",
  "client_name",
  "client_phone",
  "client_email",
  "client_dob",
  "date_of_birth",
  "policy_number",
  "application_number",
  "beneficiary",
  "beneficiaries",
  "ssn",
];

// Marks a file as talking to an outbound chat webhook.
//
// 2026-08-11, widened after this guard's sibling sweep got it wrong. The first
// version required a vendor name (discord/slack). a71e321c then found a SECOND
// live leak — trg_fn_deal_celebration — that a vendor-name filter could never
// have found, because it fetched its webhook URL from a settings key and never
// spelled the vendor. Requiring a keyword the code need not contain turns a
// sweep into a coin flip and then reports the result as certainty.
//
// `webhook` (bare) is included so a URL pulled from config still trips it.
// Deliberately NOT widened to "any fetch()": several edge functions legitimately
// handle client_first_name and POST it to the carrier/CRM that is supposed to
// receive it (agentlink-import, insuracloud-outbox). Flagging those would make
// this permanently red, and a permanently red guard is one everybody learns to
// skip — the exact failure this file exists to prevent.
//
// RESIDUAL GAP, stated rather than implied away: an edge function that posts to
// a chat sink via a bare variable containing no form of the word "webhook" is
// not covered here. The database side has no such gap — apex-doctor Check #16
// queries pg_proc for client PII plus ANY outbound sink with no keyword filter,
// and is the authority on deployed state.
const WEBHOOK_HINT =
  /webhook|discord\.com\/api|hooks\.slack\.com|chat\.googleapis\.com/i;

function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n")
    .map((line) => (/^\s*\/\//.test(line) ? " ".repeat(line.length) : line))
    .join("\n");
}

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else if (/\.(ts|js)$/.test(e.name)) acc.push(full);
  }
  return acc;
}

const violations = [];
let filesScanned = 0;
let taintedVars = 0;

for (const file of walk(FUNCTIONS)) {
  const raw = fs.readFileSync(file, "utf8");
  if (!WEBHOOK_HINT.test(raw)) continue;
  filesScanned += 1;
  const text = stripComments(raw);
  const rel = path.relative(repoRoot, file);

  // Collect every declaration with its initialiser, then propagate taint to a
  // fixed point. One level is not enough: the real bug built `clientName` from
  // the PII, then built `const embed = { fields: [... clientName ...] }`, and
  // only passed `embed` to the webhook. A single-level check tracked the
  // tainted local, found it nowhere near `embeds:`, and reported a clean pass —
  // a guard that failed the one case it was written for.
  // Taint is tracked PER DECLARATION, not per name. post-deal/index.ts declares
  // `const r = await fetch(...)` twice — once for the Discord call and once for
  // the AgentLink call that legitimately carries client names — and a name-keyed
  // map let the second one poison the first, reporting a leak in a payload that
  // provably contains only agent_name/aop/product_type/instagram/photo_url.
  const decls = [];
  const declRx =
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([\s\S]*?)(?=\n\s*(?:const|let|var|function|return|if|for|await|\}\s*$)|$)/g;
  for (const m of text.matchAll(declRx)) {
    decls.push({ name: m[1], init: m[2], index: m.index, taint: null });
  }
  decls.sort((a, b) => a.index - b.index);

  // Nearest preceding declaration of `name` before `before` — JS shadowing as it
  // actually behaves for this purpose.
  const resolve = (name, before) => {
    let found = null;
    for (const d of decls) {
      if (d.index >= before) break;
      if (d.name === name) found = d;
    }
    return found;
  };

  for (const d of decls) {
    const hit = PII_FIELDS.find((f) => new RegExp(`\\b${f}\\b`).test(d.init));
    if (hit) d.taint = hit;
  }
  // Propagate transitively: a value built from a tainted value is tainted.
  for (let pass = 0; pass < 5; pass += 1) {
    let grew = false;
    for (const d of decls) {
      if (d.taint) continue;
      for (const ref of d.init.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) {
        const src = resolve(ref[1], d.index);
        if (src?.taint) {
          d.taint = `${src.taint} via ${ref[1]}`;
          grew = true;
          break;
        }
      }
    }
    if (!grew) break;
  }
  taintedVars += decls.filter((d) => d.taint).length;

  // Sink regions are keyed on the fetch TARGET, not on the file. Scanning every
  // payload in any file that mentions a webhook produced 6 false positives on
  // post-deal/index.ts in one run: three because a fixed-size window starting at
  // `body: JSON.stringify` ran past the Discord call and swallowed the AgentLink
  // call below it, and three because the AgentLink call legitimately sends client
  // names to the CRM that is supposed to receive them. Both would have pressured
  // a future reader into "fixing" correct code, which is how a guard starts
  // costing more than it saves.
  const CHAT_SINK =
    /discord|slack|chat\.googleapis|webhook-notify|WEBHOOK_URL|webhookUrl/i;
  const fetchRx = /\bfetch\s*\(/g;
  const fetchAt = [...text.matchAll(fetchRx)].map((m) => m.index);

  for (let i = 0; i < fetchAt.length; i += 1) {
    const start = fetchAt[i];
    // The call ends at the next fetch( or 1200 chars, whichever comes first, so
    // one call's payload can never be attributed to its neighbour.
    const end = Math.min(fetchAt[i + 1] ?? text.length, start + 1200);
    const call = text.slice(start, end);

    // The URL is everything up to the first comma at depth 0 — enough to tell a
    // chat webhook from a carrier API.
    const target = call.slice(0, call.indexOf(",") === -1 ? 120 : call.indexOf(","));
    if (!CHAT_SINK.test(target)) continue;

    const line = text.slice(0, start).split("\n").length;

    for (const f of PII_FIELDS) {
      if (new RegExp(`\\b${f}\\b`).test(call)) {
        violations.push(
          `${rel}:${line} — \`${f}\` appears in the payload of a chat-webhook fetch. A win post is agent + carrier + product + money, never who bought it.`,
        );
      }
    }
    // For every identifier used in the call, resolve it to the declaration that
    // is actually in effect at this point, and report only if THAT one is
    // tainted.
    const seen = new Set();
    for (const ref of call.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) {
      const name = ref[1];
      if (seen.has(name)) continue;
      seen.add(name);
      const d = resolve(name, start);
      if (d?.taint) {
        violations.push(
          `${rel}:${line} — \`${name}\` reaches a chat-webhook payload and is derived from \`${d.taint}\`. This is exactly how the "👤 Client" field shipped: the PII was laundered through a local first.`,
        );
      }
    }
  }
}

if (violations.length) {
  console.error(
    `\n✗ check:discord-pii — ${violations.length} client-identity leak(s) into outbound webhooks.\n`,
  );
  for (const v of [...new Set(violations)]) console.error(`  ${v}`);
  console.error("");
  process.exit(1);
}

console.log(
  `✓ check:discord-pii — ${filesScanned} webhook-posting functions scanned, ${taintedVars} PII-derived local(s) tracked, 0 leaks.`,
);
