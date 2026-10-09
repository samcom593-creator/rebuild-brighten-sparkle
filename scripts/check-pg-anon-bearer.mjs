#!/usr/bin/env node
/**
 * check:pg-anon-bearer (PL-WIB-PG-ANON-BEARER)
 *
 * A database function that reads system_settings.supabase_anon_key and sends it
 * as the Bearer on a pg_net call to an edge function. Measured 2026-10-09 with an
 * empty body:
 *
 *   send-sms-auto-detect    anon -> 401 UNAUTHORIZED_LEGACY_JWT at the gateway
 *   send-notification       anon -> 401 in requireSendAuth
 *   send-agent-portal-login anon -> 401
 *
 * pg_net records the 401 and nothing reads it, so the caller looks like it sent.
 * Eleven functions shipped that way, two of them on live triggers
 * (20261009130000). The service key (system_settings.service_role_key) passes
 * the same gateway.
 *
 * Rule: the LAST definition of each function across supabase/migrations must not
 * read 'supabase_anon_key' and post to /functions/v1/<target> unless <target> is
 * in ANON_ACCEPTING, where a pg_net call with the anon key was seen answering 200
 * in function_edge_logs. Comments are stripped before matching, so a comment that
 * names the key does not count.
 *
 * Repo half only. supabase/migrations does not model every live function (some
 * are applied by hand), so this grades what the repo would deploy. The live half
 * is ~/business-ops/website-integrity-bot/scripts/pg-anon-bearer.py over pg_proc.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = "supabase/migrations";

// target -> evidence. Adding a target needs a 200 for a pg_net anon call.
const ANON_ACCEPTING = new Map([
  ["applicant-magic-link", "verify_jwt=false; pg_net anon calls answered 200 (24h edge logs, 2026-10-09)"],
  ["next-step-dispatch", "verify_jwt=false; pg_net anon calls answered 200 (24h edge logs, 2026-10-09)"],
]);
// function -> why its anon read is not a Bearer to a refusing target.
const ALLOW_FN = new Map([
  ["run_automation_job", "reads service_role_key first; the anon key is a fallback for a missing service key"],
]);

function stripSqlComments(src) {
  // Drops -- line comments and /* */ blocks, leaving '...' literals intact.
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "'") {
      const j = src.indexOf("'", i + 1);
      const end = j === -1 ? src.length : j + 1;
      out += src.slice(i, end);
      i = end;
    } else if (c === "-" && src[i + 1] === "-") {
      const j = src.indexOf("\n", i);
      i = j === -1 ? src.length : j;
    } else if (c === "/" && src[i + 1] === "*") {
      const j = src.indexOf("*/", i + 2);
      i = j === -1 ? src.length : j + 2;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

const HEAD = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:"?public"?\.)?"?([A-Za-z0-9_]+)"?\s*\(/gi;

function definitions(sql) {
  const defs = [];
  HEAD.lastIndex = 0;
  let m;
  while ((m = HEAD.exec(sql))) {
    const as = /\bAS\s+(\$[A-Za-z0-9_]*\$)/gi;
    as.lastIndex = m.index;
    const a = as.exec(sql);
    if (!a) continue;
    const tag = a[1];
    const start = a.index + a[0].length;
    const end = sql.indexOf(tag, start);
    if (end === -1) continue;
    defs.push({ name: m[1].toLowerCase(), body: sql.slice(start, end) });
    HEAD.lastIndex = end + tag.length;
  }
  return defs;
}

const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const last = new Map();
for (const f of files) {
  for (const d of definitions(readFileSync(join(DIR, f), "utf8"))) {
    last.set(d.name, { file: f, body: d.body });
  }
}

const offenders = [];
let readers = 0;
for (const [name, { file, body }] of last) {
  const code = stripSqlComments(body);
  if (!/'supabase_anon_key'/.test(code)) continue;
  const targets = [...code.matchAll(/functions\/v1\/([a-z0-9_-]+)/g)].map((x) => x[1]);
  if (targets.length === 0) continue;
  readers += 1;
  if (ALLOW_FN.has(name)) continue;
  const bad = [...new Set(targets)].filter((t) => !ANON_ACCEPTING.has(t));
  if (bad.length) offenders.push(`${name} (${file}) -> ${bad.join(", ")}`);
}

if (last.size < 100) {
  console.error(`check:pg-anon-bearer FAILED: parsed only ${last.size} function definitions from ${files.length} migrations; the parser is broken, not the code.`);
  process.exit(1);
}
if (offenders.length) {
  console.error(`check:pg-anon-bearer FAILED: ${offenders.length} function(s) send the anon key as the Bearer to an edge function that refuses it (401, recorded by pg_net, read by nothing):`);
  for (const o of offenders) console.error(`  - ${o}`);
  console.error("Read system_settings.service_role_key instead. If the target really answers an anon pg_net call 200, add it to ANON_ACCEPTING with the log evidence.");
  process.exit(1);
}
console.log(`check:pg-anon-bearer OK: ${last.size} function definitions graded (last per name), ${readers} read the anon key and post to an edge function, 0 to a target that refuses it.`);
