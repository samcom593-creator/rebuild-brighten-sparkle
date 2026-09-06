#!/usr/bin/env node
// check-credential-minting — MP-450 (2026-09-06)
//
// THE BUG THIS EXISTS FOR (MP-447):
// supabase/functions/applicant-magic-link took an email address off the request
// body, created the auth user if it did not exist, minted a Supabase NATIVE
// magic link, and RETURNED that link in its response — under verify_jwt = false
// and Access-Control-Allow-Origin: *, reading no credential of any kind. A bare
// POST of {"email":"<any admin>"} came back with a working login URL for that
// account. Sweeping the class found a second, worse live instance: simple-login
// returned a magic-link tokenHash for any address, admins included, because its
// password branches were dead code (password_required was true for 0 of 201
// agents).
//
// That is account takeover, not a data leak. An email address is not a secret —
// the site publishes staff names, applicants hand theirs over on a public form,
// and submit-application lets anyone put an admin's address on a row.
//
// THE PROPERTY, STATED ONCE:
//   A function that hands a MINTED AUTH CREDENTIAL back to its caller must not
//   let an uncredentialed stranger choose whose credential it is.
//
// Three ways to satisfy that, any one of which is enough:
//   CRED     — it reads a credential off the request before minting.
//   SELECTOR — the account is chosen by an unguessable value the caller had to
//              already possess, validated against the database (verify-magic-link
//              looks its body `token` up in magic_login_tokens).
//   PRIVGATE — it refuses to mint for an account holding admin/manager before
//              minting (applicant-magic-link + simple-login after MP-447).
//
// ORDERING IS PART OF THE CONTRACT. A gate that sits BELOW the mint call reads
// as present to grep and protects nothing, so every gate must appear at a lower
// source offset than the mint it guards. MP-307 shipped a page-ordering probe
// for exactly this reason: a bypassed gate looks intact.
//
// THE CONTRACT IS ABSOLUTE, NOT A COUNT:
// deliberately no numeric baseline. MP-356/357 proved a count-only floor is
// fungible — a real regression sits red until an unrelated pay-down launders it
// green, and a brand-new endpoint with no gate at all can pass by allowlisting a
// bystander. "Zero functions return a minted credential to a caller who proved
// nothing" is a property, so there is nothing to trade it against.
//
// WHAT THIS GUARD DELIBERATELY DOES NOT CLAIM:
//   - It does not grade functions that MAIL the minted link instead of
//     returning it. send-password-reset generates a recovery action_link and
//     puts it in Resend HTML, returning only {success:true}. The attacker never
//     sees the credential, so it is out of scope, and a guard that flagged it
//     would be red on correct code from its first run.
//   - It does not grade account CREATION on its own. add-agent, agent-signup,
//     manager-signup and the rest call auth.admin.createUser without returning a
//     credential; unauthenticated account creation is a real and separate
//     question, and pretending this gate covers it would be worse than leaving
//     it named and open.
//   - It is NOT only prevention, and the first cut of this comment said it was.
//     On its first complete run this guard found a LIVE third instance:
//     generate-magic-link read no credential, took `agentId` off the body, and
//     returned a working login URL for that agent — with no privilege refusal at
//     all, so it was the privileged half too. Closed in the same commit. The
//     remaining 4 returners are defensible. No dollar figure is claimed: an
//     account-takeover path that nobody is proven to have walked is a risk, not
//     a loss, and MP-312 is the standing reminder about sizing an operand you
//     have not measured.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = "supabase/functions";

// Comments only — string bodies are load-bearing. The header name, the table
// name and the role strings all live inside string literals, and MP-277 shipped
// a scanner that blanked string bodies and consequently reported every call site
// as "table name is a variable". Blanking comments alone is also what stops this
// guard reading the bug out of its own header prose (MP-399).
function stripComments(src) {
  let out = "", i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") { while (i < n && src[i] !== "\n") { out += " "; i++; } }
    else if (c === "/" && src[i + 1] === "*") { i += 2; out += "  "; while (i + 1 < n && !(src[i] === "*" && src[i + 1] === "/")) { out += " "; i++; } i += 2; out += "  "; }
    else if (c === '"' || c === "'" || c === "`") {
      const q = c; out += q; i++;
      while (i < n) {
        if (src[i] === "\\") { out += src.slice(i, i + 2); i += 2; continue; }
        if (src[i] === q) break;
        out += src[i]; i++;
      }
      out += q; i++;
    } else { out += c; i++; }
  }
  return out;
}

// Mints a credential a bearer can log in with, BYPASSING any credential the
// caller might hold. Only the auth.admin.* surface qualifies.
//
// signInWithPassword is deliberately NOT here, and the first cut of this guard
// that included it went RED on correct code: simple-login's dead password
// branch (line 191) sits above its privilege refusal (line 231), so the
// ordering test called a properly gated function a violation. A password
// sign-in cannot be an unguarded mint — the caller had to present the account's
// password, which IS the credential. Caught by running the guard rather than
// trusting the edit; a gate red on working code is a gate everybody learns to
// skip.
//
// The SECOND mint shape was found only because the positive-control floor
// refused to reconcile: the first cut counted 3 returners where the tree has 4.
// Apex does not only use Supabase's native links — 12 functions issue their own
// bearer token into magic_login_tokens, and /magic-login?token=<that> logs the
// holder in through verify-magic-link. A row in that table IS a credential, so
// writing one and handing it back is the same act as generateLink.
const MINTS = [
  /auth\s*\.\s*admin\s*\.\s*generateLink\s*\(/g,
  /auth\s*\.\s*admin\s*\.\s*createSession\s*\(/g,
  /\.from\s*\(\s*["'`]magic_login_tokens["'`]\s*\)[\s\S]{0,200}?\.insert\s*\(/g,
];

// Identifiers whose presence in a RESPONSE payload means the caller walked away
// holding the credential itself.
const CREDENTIAL_KEYS = /\b(action_link|actionLink|hashed_token|hashedToken|tokenHash|token_hash|access_token|accessToken|refresh_token|refreshToken|magicLink|magic_link|magicLinkUrl|loginLink|login_link|loginUrl|login_url|portalLink|portal_link|recoveryUrl|recovery_url)\b/;

// MP-451: a minted credential that is MAILED instead of returned is still a
// credential minted for a caller-named target. send-agent-portal-login and
// send-bulk-portal-logins both wrote a magic_login_tokens row and mailed the
// link while reading no caller credential at all, and BOTH were invisible to
// the returns-a-credential test above — the guard shipped green over them the
// day they were found. Weaker than the returner class (the link lands in the
// agent's own inbox, not the attacker's) so it is graded and reported
// SEPARATELY, never folded into the returner count.
const MAILS = [
  /resend\s*\.\s*emails\s*\.\s*send\s*\(/g,
  /\bsendEmail\s*\(/g,
];

const GATES = {
  CRED: [
    /requireAuth\s*\(/g,
    // MP-452: the four patterns above all match a CALL, and the repo's other
    // gating convention is not a call — createHandler({ requireAuth: true })
    // makes the WRAPPER call requireAuth(req) before the handler body ever
    // runs. 6 functions already gate this way, and to this guard every one of
    // them read as ungated. That is the failure mode this file's own header
    // warns about in the other direction: a gate that is red on correct code is
    // a gate everybody learns to skip. Ordering still holds — the opts object
    // is necessarily at a lower source offset than the handler that mints.
    /requireAuth\s*:\s*true/g,
    /requireSendAuth\s*\(/g,
    /headers\s*\.\s*get\s*\(\s*["'`]\s*[Aa]uthorization/g,
    /auth\s*\.\s*get(User|Claims)\s*\(/g,
  ],
  SELECTOR: [
    /\.eq\s*\(\s*["'`](token|invite_token|inviteToken|invite_code|token_hash|magic_token|hash|code|nonce)["'`]/g,
  ],
  PRIVGATE: [
    /\.from\s*\(\s*["'`]user_roles["'`]/g,
    /\bis_admin\b/g,
    /\bhas_role\s*\(/g,
  ],
};

// Earliest source offset at which any pattern in the list matches, or Infinity.
function firstOffset(pats, src) {
  let best = Infinity;
  for (const r of pats) {
    r.lastIndex = 0;
    const m = r.exec(src);
    if (m && m.index < best) best = m.index;
  }
  return best;
}

// Every JSON.stringify(...) argument that is actually being RETURNED, extracted
// by balanced parens so nested object literals and template strings come along
// whole.
//
// The `new Response(` proximity test is load-bearing. Without it,
// JSON.stringify(sendError) — an error being serialised into a log or a message
// string — counted as a response payload, and send-agent-portal-login plus
// send-bulk-portal-logins landed in the "unprovable" bucket. Both actually MAIL
// the link through Resend and return only {success, error}, so they belong in
// neither bucket. A notice nobody can act on costs what a false failure costs.
function responsePayloads(src) {
  const out = [];
  const needle = "JSON.stringify(";
  let at = 0;
  while ((at = src.indexOf(needle, at)) !== -1) {
    if (!/new\s+Response\s*\(\s*$/.test(src.slice(Math.max(0, at - 60), at))) { at += needle.length; continue; }
    let i = at + needle.length, depth = 1;
    const start = i;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === "(") depth++;
      else if (c === ")") depth--;
      else if (c === '"' || c === "'" || c === "`") {
        const q = c; i++;
        while (i < src.length) {
          if (src[i] === "\\") { i += 2; continue; }
          if (src[i] === q) break;
          i++;
        }
      }
      i++;
    }
    out.push({ text: src.slice(start, i - 1), at });
    at = i;
  }
  return out;
}

if (!existsSync(ROOT)) {
  console.error(`check:credential-minting FAILED — ${ROOT} not found; refusing to pass on nothing`);
  process.exit(1);
}

// The mint is frequently written as a top-level helper (generateMagicToken) and
// CALLED from inside the handler. A raw first-offset test then measures the
// helper's DECLARATION, which is hoisted above every gate, and reports correctly
// gated code as a violation — which is what this extension did on its first run,
// against the two functions MP-451 had just proven gated 7/7 on live prod. A
// gate red on working code is a gate everybody learns to skip, so the mint point
// is the first place the credential can actually be written: a direct mint in
// the handler, or the first CALL of the helper that performs one.
function handlerStart(code) {
  const m = /const\s+handler\s*=|serve\s*\(\s*async|Deno\s*\.\s*serve\s*\(/.exec(code);
  return m ? m.index : 0;
}
function effectiveMintAt(code) {
  const hs = handlerStart(code);
  const offs = [];
  for (const re of MINTS) { re.lastIndex = 0; let m; while ((m = re.exec(code)) !== null) offs.push(m.index); }
  if (offs.length === 0) return Infinity;
  let best = Infinity;
  for (const off of offs) {
    if (off >= hs) { best = Math.min(best, off); continue; }
    // Mint sits above the handler => it is inside a helper. Grade its call site.
    const before = code.slice(0, off);
    const decl = [...before.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)].pop();
    if (!decl) { best = Math.min(best, off); continue; }
    const callRe = new RegExp("\\b" + decl[1] + "\\s*\\(", "g");
    let c, callAt = Infinity;
    while ((c = callRe.exec(code)) !== null) { if (c.index > off) { callAt = c.index; break; } }
    best = Math.min(best, callAt === Infinity ? off : callAt);
  }
  return best;
}

const violations = [];
const unprovable = [];
const passing = [];
const weakSelector = [];
// Found by this extension on its first correct run, and NOT adjudicated by
// MP-451 — so they are named here rather than blocked or laundered green. Keyed
// by NAME, never by count: a count is fungible and would let a brand-new
// ungated endpoint pass by absorbing one of these (MP-357 proved exactly that).
// Any function not on this list violates immediately.
//
// These are not equivalent to each other and must not be cleared as a batch:
// send-password-reset is plausibly public BY DESIGN (a logged-out user must be
// able to request a reset), so demanding CRED on it could break real resets --
// that one likely needs rate-limiting and a target-enumeration check, not a
// gate. The other three are unexamined. Each needs its callers measured the way
// MP-451 measured this pair before anything is changed.
const MAIL_UNADJUDICATED = new Set([
  "notify-set-goals",
  "send-course-enrollment-email",
  "send-login-to-manager",
  "send-password-reset",
]);
const mailViolations = [];
const mailPassing = [];
const mailNamed = [];
let scanned = 0;

for (const dir of readdirSync(ROOT).sort()) {
  if (dir.startsWith("_")) continue;
  const p = join(ROOT, dir, "index.ts");
  if (!existsSync(p)) continue;
  scanned++;
  const code = stripComments(readFileSync(p, "utf8"));

  const mintAt = effectiveMintAt(code);
  if (mintAt === Infinity) continue;

  // Does the credential leave in the response?
  const payloads = responsePayloads(code);
  const returnsCred = payloads.some((b) => CREDENTIAL_KEYS.test(b.text));

  if (!returnsCred) {
    // A Response body that is a bare identifier cannot be read by this scanner.
    // Reported as its own outcome — never laundered into "passes" (MP-276).
    const opaque = payloads.some((b) => /^\s*[A-Za-z_$][\w$]*\s*$/.test(b.text));
    if (opaque && CREDENTIAL_KEYS.test(code)) unprovable.push(dir);

    // Mint-and-mail: same ordering contract, separate ledger.
    const mailAt = firstOffset(MAILS, code);
    if (mailAt !== Infinity) {
      const held = [];
      for (const [name, pats] of Object.entries(GATES)) {
        if (firstOffset(pats, code) < mintAt) held.push(name);
      }
      if (held.length === 0) {
        if (MAIL_UNADJUDICATED.has(dir)) mailNamed.push(dir);
        else mailViolations.push(dir);
      }
      else mailPassing.push(`${dir} [${held.join("+")}]`);
    }
    continue;
  }

  const gatesHeld = [];
  for (const [name, pats] of Object.entries(GATES)) {
    const gateAt = firstOffset(pats, code);
    // Ordering is the contract: a gate below the mint guards nothing.
    if (gateAt < mintAt) gatesHeld.push(name);
  }

  if (gatesHeld.length === 0) { violations.push(dir); continue; }

  passing.push(`${dir} [${gatesHeld.join("+")}]`);

  // Non-voting: a token lookup with no expiry/single-use check is a weaker
  // selector than it looks. Printed so it cannot hide behind this green, never
  // graded here — grading it would make this gate red for a reason it was not
  // built to judge.
  if (gatesHeld.length === 1 && gatesHeld[0] === "SELECTOR" && !/used_at|expires_at|expired_at|expiresAt/.test(code)) {
    weakSelector.push(dir);
  }
}

// A scan that silently matched nothing proves nothing (MP-399: a dead status
// filter printed green for its entire life). Two floors, both hard.
if (scanned < 100) {
  console.error(`check:credential-minting FAILED — only ${scanned} functions scanned; expected the full tree. Refusing to vouch.`);
  process.exit(1);
}
const returners = violations.length + passing.length;
if (returners < 3) {
  console.error(`check:credential-minting FAILED — the detector found only ${returners} function(s) returning a minted credential.`);
  console.error("Measured 2026-09-06 there are 5: applicant-magic-link, simple-login, verify-magic-link,");
  console.error("create-agent-from-leaderboard, generate-magic-link.");
  console.error("A confident zero here means the DETECTOR broke, not that the codebase got safer. Fix the scanner before trusting a pass.");
  process.exit(1);
}

// Same positive-control discipline as the returner floor: a confident zero here
// means the mail detector broke, not that the codebase got safer.
const mailers = mailViolations.length + mailPassing.length + mailNamed.length;
if (mailers < 2) {
  console.error(`check:credential-minting FAILED — the mint-and-mail detector found only ${mailers} function(s).`);
  console.error("Measured 2026-09-06 there are at least 2: send-agent-portal-login, send-bulk-portal-logins.");
  console.error("Fix the scanner before trusting a pass.");
  process.exit(1);
}

if (mailViolations.length > 0) {
  console.error(`check:credential-minting FAILED — ${mailViolations.length} function(s) mint an auth credential and MAIL it for a caller who proved nothing:`);
  for (const v of mailViolations) console.error(`  supabase/functions/${v}/index.ts`);
  console.error("");
  console.error("The link lands in the target's inbox rather than the caller's, so this is not a direct");
  console.error("takeover — but it is an unauthenticated outbound trigger on Sam's verified sending domain,");
  console.error("and it writes live credential rows on demand. Same remedy, positioned ABOVE the mint:");
  console.error("  CRED / SELECTOR / PRIVGATE (see below).");
  process.exit(1);
}

if (violations.length > 0) {
  console.error(`check:credential-minting FAILED — ${violations.length} function(s) return a minted auth credential to a caller who proved nothing:`);
  for (const v of violations) console.error(`  supabase/functions/${v}/index.ts`);
  console.error("");
  console.error("Satisfy ONE of these, positioned ABOVE the mint call:");
  console.error("  CRED     — read a credential off the request (requireAuth / Authorization header / auth.getUser).");
  console.error("  SELECTOR — select the account by an unguessable value validated against the DB (.eq('token', ...)).");
  console.error("  PRIVGATE — refuse admin/manager accounts before minting (query user_roles; unknown must refuse).");
  console.error("");
  console.error("Do NOT 'fix' this by setting verify_jwt = true — the gateway accepts the public anon key, which ships");
  console.error("inside the browser bundle (MP-443). The gate has to live in the function.");
  console.error("Mailing the link instead of returning it also satisfies this guard, and is the stronger fix.");
  process.exit(1);
}

if (unprovable.length > 0) {
  console.log(`note credential-minting: ${unprovable.length} function(s) mint and respond with an opaque identifier this scanner cannot read (not passed, not failed):`);
  for (const u of unprovable) console.log(`  - ${u}`);
}
if (weakSelector.length > 0) {
  console.log(`note credential-minting: ${weakSelector.length} function(s) rest on a DB token lookup with no expiry/single-use check visible:`);
  for (const w of weakSelector) console.log(`  - ${w}`);
}
console.log(`ok credential-minting: ${returners} of ${scanned} edge functions return a minted credential; all ${returners} gate it before the mint`);
console.log(`   plus ${mailers} that mint and MAIL one; all ${mailers} gate it before the mint`);
for (const m of mailPassing) console.log(`  - ${m} [mailed]`);
if (mailNamed.length > 0) {
  console.log(`   ${mailNamed.length} UNADJUDICATED mint-and-mail endpoint(s) — named, not cleared:`);
  for (const m of mailNamed) console.log(`  ! supabase/functions/${m}/index.ts`);
}
for (const p of passing) console.log(`  - ${p}`);
