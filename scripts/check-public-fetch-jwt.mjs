import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { stripComments } from "./lib/strip-comments.mjs";

// check-public-fetch-jwt — MP-483 (2026-09-09)
//
// A page calls an edge function with a bare fetch() — no Authorization header,
// no apikey — because the surface is public and the URL's own token is the
// credential. Supabase's gateway decides whether that request is even allowed
// to reach the function, and it decides from supabase/config.toml's verify_jwt.
// `supabase functions deploy <name>` (deploy-supabase.yml:266,289 — no
// --no-verify-jwt flag) applies whatever config.toml says. So config.toml and
// the caller have to agree, and NOTHING checked that they did.
//
// THE BUG THIS WAS WRITTEN FOR. /share/:token is a public route (App.tsx:391,
// in the unauthenticated block beside /apply). SharePage.tsx:26 fetches
// content-share with no headers. The function's own header says "public,
// token-gated … the token is the only credential", and the migration that
// created content_shares says "the public page /share/<token> calls the
// content-share edge function". config.toml declared verify_jwt = true.
//
// It worked anyway, which is why nobody noticed: content-share is deployed
// with verification OFF, so prod and the repo disagreed and only the repo was
// wrong. The next deploy of that function closes the gap in the wrong
// direction and every share link Sam has pasted returns 401 before the
// function runs.
//
// MEASURED, not assumed (2026-09-09, live prod):
//   content-share            declared true  → function RAN  (404 "not found or expired", its own body)
//   slack-integration-health declared true  → gateway REFUSED (401 UNAUTHORIZED_NO_AUTH_HEADER)
//   consume-invite-token     declared false → function RAN  (405 method_not_allowed)
// The middle line is the control: config.toml's verify_jwt = true really is
// enforced at the gateway in this project, so this is a live hazard and not a
// theoretical one.
//
// TWO WAYS TO FAIL, and the second is the quiet one:
//   1. declared verify_jwt = true  → gateway refuses the bare fetch.
//   2. NOT DECLARED AT ALL         → the Supabase CLI defaults verify_jwt to
//      TRUE, so an omitted stanza fails exactly like an explicit true. That is
//      short-link-tap: RecruitingShortLink.tsx:27 beacons to it with no auth
//      and no config stanza. (That function is also not deployed and has no
//      source in this repo — a separate fault, recorded in the MP-483 ledger,
//      not laundered into this guard's verdict.)
//
// WHY IT MATCHES CALL SHAPE, NOT NAME SHAPE (MP-309's lesson). A grep for
// "functions/v1/" hits src/data/shipped-data.ts:1303, where a bot-sql URL sits
// inside a `detail:` string describing past work. That is prose, not a call
// site. This walks out from `fetch(` to its matching paren and only reads what
// is inside that span, so prose cannot enter the population. Comments are
// stripped with the shared lexer (MP-474/MP-481/MP-482) for the same reason.
//
// SCOPE OF THAT RULE, MEASURED RATHER THAN ASSERTED (2026-09-09): dropping the
// call-shape anchor takes the population from 5 real call sites to 15 text
// matches, but the verdict stays green, because every non-call-site mention in
// src/ today names bot-sql — which is declared verify_jwt = false. So the rule
// is load-bearing for the COUNT this guard prints, not for today's verdict, and
// the proof harness asserts it on the count for that reason. It becomes
// verdict-load-bearing the first time a comment or a changelog string mentions
// a private function, which is why it is not being removed as unnecessary.
//
// DIRECTION: this guard only asserts that a NO-AUTH caller needs a public
// function. It deliberately says nothing about authenticated callers — a
// fetch that sends a bearer token is fine against either setting, and grading
// that would be inventing violations to look thorough.

const ROOT = resolve(import.meta.dirname, "..");
const CONFIG = join(ROOT, "supabase", "config.toml");

// Carried, NOT fixed. A no-auth caller whose fault is not the JWT gate at all.
// Declaring verify_jwt = false for a function with no source in this repo would
// be config for a phantom — green by laundering. The entry states the real
// fault and the list can only shrink: a baselined site that stops violating is
// reported STALE below and fails, so this cannot rot into permanent cover.
const BASELINE = [
  {
    file: "src/components/RecruitingShortLink.tsx",
    fn: "short-link-tap",
    why:
      "Not a JWT problem: the function has no source in supabase/functions/, is not deployed " +
      "(gateway answers NOT_FOUND, measured 2026-09-09) and there is no short_link_* table to " +
      "receive a tap. The beacon is fire-and-forget behind an empty catch, so the page has never " +
      "been able to notice. Recruiting short-link tap attribution has recorded nothing, ever. " +
      "Building it is a feature, not this guard's business.",
  },
];

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(e)) out.push(p);
  }
  return out;
}

// verify_jwt per function, read from config.toml's [functions.<name>] stanzas.
const cfgText = readFileSync(CONFIG, "utf8");
const declared = new Map();
{
  let current = null;
  for (const raw of cfgText.split("\n")) {
    const line = raw.trim();
    const hdr = line.match(/^\[functions\.([A-Za-z0-9_-]+)\]$/);
    if (hdr) { current = hdr[1]; if (!declared.has(current)) declared.set(current, undefined); continue; }
    if (/^\[/.test(line)) { current = null; continue; }
    const vj = line.match(/^verify_jwt\s*=\s*(true|false)\b/);
    if (vj && current) declared.set(current, vj[1] === "true");
  }
}

// Every fetch( … ) span in src/, with the function it targets and whether it
// carries any auth header.
const sites = [];
for (const file of walk(join(ROOT, "src"))) {
  const src = stripComments(readFileSync(file, "utf8"));
  for (const m of src.matchAll(/\bfetch\s*\(/g)) {
    let i = m.index + m[0].length, depth = 1;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === "(") depth++;
      else if (c === ")") depth--;
      i++;
    }
    const span = src.slice(m.index, i);
    const fn = span.match(/\/functions\/v1\/([A-Za-z0-9_-]+)/);
    if (!fn) continue;
    const hasAuth = /\bAuthorization\b|\bapikey\b/i.test(span);
    const line = src.slice(0, m.index).split("\n").length;
    sites.push({ file: file.slice(ROOT.length + 1), line, fn: fn[1], hasAuth });
  }
}

const noAuth = sites.filter((s) => !s.hasAuth);
const offending = noAuth.filter((s) => declared.get(s.fn) !== false);
const isBaselined = (s) => BASELINE.some((b) => b.file === s.file && b.fn === s.fn);
const violations = offending.filter((s) => !isBaselined(s));

// A baseline entry that no longer describes a live violation is cover for
// nothing and must not sit there implying it is.
const stale = BASELINE.filter((b) => !offending.some((s) => s.file === b.file && s.fn === b.fn));
if (stale.length) {
  console.error(`\u2717 check:public-fetch-jwt — ${stale.length} STALE baseline entr(y/ies):`);
  for (const b of stale) console.error(`    ${b.file} → ${b.fn} no longer violates; delete the entry.`);
  process.exit(1);
}

if (violations.length) {
  console.error(
    `✗ check:public-fetch-jwt — ${violations.length} unauthenticated fetch() call(s) target a function the gateway will refuse:`,
  );
  for (const v of violations) {
    const state = declared.has(v.fn)
      ? `config.toml declares verify_jwt = true`
      : `no [functions.${v.fn}] stanza — the Supabase CLI defaults verify_jwt to TRUE`;
    console.error(`    ${v.file}:${v.line}  → ${v.fn}`);
    console.error(`      ${state}`);
  }
  console.error(
    "\n  The caller sends no Authorization and no apikey, so the gateway 401s before the\n" +
      "  function runs. If the surface is meant to be public, declare it:\n" +
      "      [functions.<name>]\n      verify_jwt = false\n" +
      "  If it is NOT meant to be public, the caller is the bug — give it a real credential\n" +
      "  rather than opening the function.",
  );
  process.exit(1);
}

console.log(
  `✓ check:public-fetch-jwt — ${sites.length} fetch() call(s) to edge functions, ` +
    `${noAuth.length} unauthenticated: ${noAuth.length - BASELINE.length} declared verify_jwt = false, ` +
    `${BASELINE.length} carried; ${sites.length - noAuth.length} authenticated (not graded, either setting works).`,
);
if (BASELINE.length) {
  console.log(`\n  ${BASELINE.length} unauthenticated call site(s) carried in the baseline, not fixed:`);
  for (const b of BASELINE) {
    console.log(`    ${b.file} → ${b.fn}`);
    console.log(`      ${b.why}`);
  }
}
process.exit(0);
