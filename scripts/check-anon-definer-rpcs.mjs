#!/usr/bin/env node
// check-anon-definer-rpcs (WP3, 2026-11-10)
//
// cc_dispose_interview was SECURITY DEFINER, EXECUTE-granted to anon and PUBLIC, with no
// role check: anyone holding the public anon key (shipped in the SPA bundle) could
// rewrite interview outcomes and flip recruits to 'rejected'. WP3 closed that one.
// This ratchet stops the next one: it lists every public SECURITY DEFINER function
// that anon (or PUBLIC, which anon inherits) can EXECUTE and whose body has no
// role/auth check, and fails when that list GROWS past the frozen allowlist.
//
// Truth lives in the live catalog, not in supabase/migrations (functions are
// routinely hand-applied), so this reads pg_proc through bot-sql. Without the bot-sql
// credentials (CI) it prints SKIP and exits 0; apex-doctor #44 runs it live weekly
// and goes CRITICAL on growth.
//
//   node scripts/check-anon-definer-rpcs.mjs                 check (exit 1 on growth)
//   node scripts/check-anon-definer-rpcs.mjs --json          machine-readable verdict
//   node scripts/check-anon-definer-rpcs.mjs --write-baseline  refreeze (shrink only, by review)
//   node scripts/check-anon-definer-rpcs.mjs --selftest      prove the comparison can fail
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ROOT = process.cwd();
const ALLOWLIST = join(ROOT, "scripts/data/anon-definer-rpcs-allowlist.json");
const URL_FILE = join(homedir(), ".config/apex-creds/bot-sql.url");
const TOK_FILE = join(homedir(), ".config/apex-creds/bot-sql.token");

// A body that mentions any of these is treated as checking its caller. Coarse on
// purpose: the ratchet's job is "no NEW unchecked anon definer", not a proof of safety.
export const ROLE_CHECK =
  "(has_role|auth\\.uid\\(\\)|auth\\.role\\(\\)|api_is_|is_agency_staff|calendar_is_scheduling_staff|" +
  "fn_require_caller_role|apex_is_admin|is_admin|current_setting\\(.request\\.jwt|_is_staff|fn_recruit_scope_ok)";

export const QUERY = `
select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosecdef and p.prokind = 'f'
   and p.prorettype <> 'trigger'::regtype
   and (p.proacl is null or exists (
         select 1 from aclexplode(p.proacl) a
          where a.privilege_type = 'EXECUTE'
            and (a.grantee = 0 or a.grantee = (select oid from pg_roles where rolname = 'anon'))))
   and p.prosrc !~* '${ROLE_CHECK}'
 order by 1`;

export function diff(allow, live) {
  const a = new Set(allow);
  const l = new Set(live);
  return { added: [...l].filter((s) => !a.has(s)).sort(), removed: [...a].filter((s) => !l.has(s)).sort() };
}

async function fetchLive() {
  if (!existsSync(URL_FILE) || !existsSync(TOK_FILE)) return null;
  const url = readFileSync(URL_FILE, "utf8").trim();
  const tok = readFileSync(TOK_FILE, "utf8").trim();
  let lastErr = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: QUERY }),
        signal: AbortSignal.timeout(60_000),
      });
      const body = await res.json();
      if (res.ok && body?.ok && Array.isArray(body.rows)) return body.rows.map((r) => r.sig);
      lastErr = `HTTP ${res.status} ${JSON.stringify(body).slice(0, 200)}`;
    } catch (e) {
      lastErr = String(e?.message ?? e);
    }
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  throw new Error(`bot-sql unreadable after 3 tries: ${lastErr}`);
}

function selftest() {
  const cases = [
    ["identical list passes", diff(["a()", "b()"], ["a()", "b()"]).added.length === 0],
    ["a new unchecked function fails", diff(["a()"], ["a()", "cc_dispose_interview(p_id uuid)"]).added.length === 1],
    ["a removed function is reported, not failed", diff(["a()", "b()"], ["a()"]).removed.length === 1],
    ["query excludes trigger functions", QUERY.includes("prorettype <> 'trigger'::regtype")],
    ["query treats a NULL acl as PUBLIC execute", QUERY.includes("p.proacl is null")],
  ];
  let bad = 0;
  for (const [name, ok] of cases) { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) bad++; }
  if (bad) { console.error("selftest failed: this guard cannot be trusted"); process.exit(1); }
  console.log("selftest: all cases behave; the guard can fail");
}

const args = new Set(process.argv.slice(2));
if (args.has("--selftest")) { selftest(); process.exit(0); }

let live;
try {
  live = await fetchLive();
} catch (e) {
  const msg = `UNKNOWN: ${e.message}`;
  if (args.has("--json")) console.log(JSON.stringify({ verdict: "UNKNOWN", error: e.message }));
  else console.error(`check-anon-definer-rpcs: ${msg}`);
  process.exit(args.has("--json") ? 0 : 2);
}
if (live === null) {
  if (args.has("--json")) console.log(JSON.stringify({ verdict: "UNKNOWN", error: "no bot-sql credentials" }));
  else console.log("check-anon-definer-rpcs: SKIP (no bot-sql credentials here; apex-doctor #44 runs this against the live catalog)");
  process.exit(0);
}
if (args.has("--write-baseline")) {
  writeFileSync(ALLOWLIST, JSON.stringify({ frozen_at: new Date().toISOString(), count: live.length, functions: live }, null, 2) + "\n");
  console.log(`wrote ${ALLOWLIST}: ${live.length} functions`);
  process.exit(0);
}
const allow = JSON.parse(readFileSync(ALLOWLIST, "utf8")).functions ?? [];
const { added, removed } = diff(allow, live);
if (args.has("--json")) {
  console.log(JSON.stringify({ verdict: added.length ? "CRITICAL" : "OK", live: live.length, allowlisted: allow.length, added, removed }));
  process.exit(0);
}
if (removed.length) console.log(`check-anon-definer-rpcs: ${removed.length} allowlisted function(s) no longer anon-unchecked (good; prune with --write-baseline): ${removed.join(", ")}`);
if (added.length) {
  console.error(`check-anon-definer-rpcs: ${added.length} NEW SECURITY DEFINER function(s) anon can execute with no role check:`);
  for (const s of added) console.error(`  - ${s}`);
  console.error("Add a role/auth check in the body, or REVOKE EXECUTE ... FROM anon, PUBLIC.");
  process.exit(1);
}
console.log(`check-anon-definer-rpcs: OK (${live.length} live, ${allow.length} allowlisted, none new)`);
