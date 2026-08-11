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
const WEBHOOK_HINT =
  /DISCORD_WEBHOOK|discord\.com\/api\/webhooks|SLACK_WEBHOOK|hooks\.slack\.com/i;

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
  const decls = [];
  const declRx =
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([\s\S]*?)(?=\n\s*(?:const|let|var|function|return|if|for|await|\}\s*$)|$)/g;
  for (const m of text.matchAll(declRx)) decls.push({ name: m[1], init: m[2] });

  const tainted = new Map();
  for (const d of decls) {
    const hit = PII_FIELDS.find((f) => new RegExp(`\\b${f}\\b`).test(d.init));
    if (hit) tainted.set(d.name, hit);
  }
  // Propagate: a value built from a tainted value is itself tainted.
  for (let pass = 0; pass < 5; pass += 1) {
    let grew = false;
    for (const d of decls) {
      if (tainted.has(d.name)) continue;
      for (const [t, src] of tainted) {
        if (new RegExp(`\\b${t}\\b`).test(d.init)) {
          tainted.set(d.name, `${src} via ${t}`);
          grew = true;
          break;
        }
      }
    }
    if (!grew) break;
  }
  taintedVars += tainted.size;

  // Payload regions: an embeds/content/body construction headed to the webhook.
  const regionRx = /(embeds\s*:|content\s*:|body\s*:\s*JSON\.stringify)/g;
  for (const m of text.matchAll(regionRx)) {
    // Bounded window — long enough to cover an embed literal, short enough not
    // to swallow the rest of the function.
    const region = text.slice(m.index, m.index + 1200);
    const line = text.slice(0, m.index).split("\n").length;

    for (const f of PII_FIELDS) {
      if (new RegExp(`\\b${f}\\b`).test(region)) {
        violations.push(
          `${rel}:${line} — \`${f}\` appears inside an outbound webhook payload. A win post is agent + carrier + product + money, never who bought it.`,
        );
      }
    }
    for (const [v, src] of tainted) {
      if (new RegExp(`\\b${v}\\b`).test(region)) {
        violations.push(
          `${rel}:${line} — \`${v}\` reaches an outbound webhook payload and is derived from \`${src}\`. This is exactly how the "👤 Client" field shipped: the PII was laundered through a local first.`,
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
