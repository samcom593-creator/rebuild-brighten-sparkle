#!/usr/bin/env node
/**
 * MP-417 — a caller that BINDS send-sms-auto-detect's response must read
 * `outcome` before it treats the person as contacted.
 *
 * THE BUG THIS EXISTS FOR: send-sms-auto-detect answers HTTP 200 with
 * `outcome: "skipped"` when no carrier is on file and it sent NOTHING, and 200
 * with `outcome: "failed"` when the gateway rejected it. Its own source says so
 * in a comment — "callers should branch on this rather than treating the person
 * as contacted" (MP-270). Two callers did not:
 *
 *   next-step-dispatch returned a `gateway:` receipt on any 200, so
 *   next_step_messages.sent_at was stamped and `delivered = true` was set, which
 *   made the email fallback below it unreachable for the one person the SMS
 *   could not reach. 14 such receipts between 2026-08-12 and 2026-09-03.
 *
 *   licensing-stage-nudge awaited the invoke and returned { ok: true }
 *   unconditionally, stamping applications.last_contacted_at — which is also
 *   that function's own 72h idempotency gate, over plans that fire on exact
 *   stage-age equality, so the stamp did not delay a rung, it deleted it.
 *
 * TWO LEGS, and the second one exists because the first could not catch its own
 * motivating bug. The first cut graded only BOUND call sites, on the premise
 * that a call whose response nothing reads cannot lie about delivery. The
 * mutation proof restored licensing-stage-nudge's real pre-fix code and the
 * guard stayed GREEN: that caller DISCARDED the response and then returned a
 * hardcoded `{ ok: true }`, so the lie was not in reading the answer wrong, it
 * was in manufacturing an answer it never asked for.
 *
 *   A. A BOUND response — assigned or destructured — must consult a field that
 *      discriminates sent from not-sent before anything downstream acts on it.
 *   B. An UNBOUND call inside a wrapper that RETURNS a success-shaped literal
 *      (`{ ok: true }`, `return true`) is manufacturing a receipt. That value is
 *      what the caller gates its durable write on.
 *
 * An unbound call in a wrapper that returns nothing is neither: it can fail to
 * reach someone, but it tells no one it succeeded. Those are counted and
 * PUBLISHED every run, never failed, because turning them red would demand a
 * fallback decision this guard has no standing to make and would park it
 * permanently yellow (apex-doctor Check #19's lesson).
 *
 * WHY NOT AN ALLOWLIST: a floor or an exemption list can be turned green by
 * exempting a bystander (MP-357). The discriminator here is derived from the
 * call site's own shape, so a new bound caller is graded automatically and a new
 * fire-and-forget one is published automatically.
 *
 * WHAT IT DOES NOT COVER, stated rather than implied: it does not verify that
 * the branch a caller writes on `outcome` is the CORRECT branch, does not follow
 * the response across a function boundary or a helper, does not grade the
 * Resend/Twilio legs of the same senders, and does not grade SQL callers that
 * net.http_post this function directly.
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const FN = "send-sms-auto-detect";

const files = execSync(`git ls-files 'supabase/functions/**/*.ts'`, { encoding: "utf8" })
  .split("\n").filter(Boolean)
  // the sender itself defines the contract; it does not consume it
  .filter((f) => !f.startsWith(`supabase/functions/${FN}/`));

// Strip comments so the prose above — and every caller's own notes about this
// bug — is never matched as code (MP-277: a guard that scans raw source counts
// its own footnotes). String bodies are preserved: the call site IS a string.
function stripComments(src) {
  let out = "";
  let i = 0;
  let mode = "code";
  let quote = "";
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (mode === "code") {
      if (c === "/" && n === "*") { mode = "block"; out += "  "; i += 2; continue; }
      if (c === "/" && n === "/") { mode = "line"; out += "  "; i += 2; continue; }
      if (c === '"' || c === "'" || c === "`") { mode = "str"; quote = c; out += c; i++; continue; }
      out += c; i++; continue;
    }
    if (mode === "str") {
      if (c === "\\") { out += src.slice(i, i + 2); i += 2; continue; }
      if (c === quote) { mode = "code"; }
      out += c; i++; continue;
    }
    // inside a comment: keep newlines so line numbers survive
    if (mode === "block" && c === "*" && n === "/") { mode = "code"; out += "  "; i += 2; continue; }
    if (mode === "line" && c === "\n") { mode = "code"; out += "\n"; i++; continue; }
    out += c === "\n" ? "\n" : " ";
    i++;
  }
  return out;
}

// A bound call: the invocation is the right-hand side of an assignment or a
// destructure. `const x = await fetch(...)`, `const { data } = await invoke(...)`,
// `return await fetch(...)`, `if (await fetch(...))`.
// The member chain in `supabase.functions.invoke(` sits between the `=` and the
// call, so it is stripped before the test — without that, every destructured
// invoke read as fire-and-forget. That was this guard's own first-run defect.
const BOUND_PREFIX = /(?:=|return|\(|\?\?|&&|\|\|)\s*(?:await\s+)?$/;
const MEMBER_CHAIN = /[\w$)\]]+(?:\s*\.\s*[\w$]+)*\s*\.?\s*$/;

function isBound(preamble) {
  const stripped = preamble.replace(MEMBER_CHAIN, "");
  return BOUND_PREFIX.test(stripped);
}

// Scope by BRACE MATCHING, not by the nearest `const NAME =` before the call.
// Name-matching picked up `const expectedALP = (` and arithmetic parens, which
// scoped `outcome` lookups to the wrong body and flipped verdicts in both
// directions. Walk outward one block at a time until the block's header looks
// like a function; if no function header is found, fall back to the whole file
// and SAY SO — a wider scope is the permissive direction, so an unscoped site is
// published rather than silently failed on a scope this guard could not resolve.
const FN_HEADER = /(?:function\s*[\w$]*\s*\([^)]*\)\s*(?::[^{;]*)?|=>|\)\s*(?::\s*[^{;]+)?)\s*$/;

function enclosingBody(src, index) {
  let cursor = index;
  for (let level = 0; level < 8; level++) {
    let depth = 0;
    let open = -1;
    for (let i = cursor - 1; i >= 0; i--) {
      const c = src[i];
      if (c === "}") depth++;
      else if (c === "{") {
        if (depth === 0) { open = i; break; }
        depth--;
      }
    }
    if (open < 0) return { body: src, scope: "file" };
    const header = src.slice(Math.max(0, open - 200), open);
    let close = src.length;
    let d = 0;
    for (let i = open; i < src.length; i++) {
      if (src[i] === "{") d++;
      else if (src[i] === "}") { d--; if (d === 0) { close = i; break; } }
    }
    if (FN_HEADER.test(header.trimEnd())) {
      const nameMatch = header.match(/(?:function\s+([\w$]+)|(?:const|let)\s+([\w$]+)\s*=)[^{]*$/);
      return {
        body: src.slice(open, close + 1),
        scope: "function",
        name: nameMatch ? (nameMatch[1] || nameMatch[2]) : "(anonymous)",
      };
    }
    cursor = open;
  }
  return { body: src, scope: "file" };
}

const bound = [];
const unbound = [];

for (const f of files) {
  const src = stripComments(readFileSync(f, "utf8"));
  const re = new RegExp(`["'\`][^"'\`]*${FN}[^"'\`]*["'\`]`, "g");
  let m;
  while ((m = re.exec(src))) {
    // walk back to the start of the call expression this literal sits in
    const head = src.slice(Math.max(0, m.index - 400), m.index);
    const callStart = Math.max(head.lastIndexOf("fetch("), head.lastIndexOf("invoke("));
    if (callStart < 0) continue; // a bare mention, e.g. an error string
    const absolute = Math.max(0, m.index - 400) + callStart;
    const preamble = src.slice(Math.max(0, absolute - 160), absolute);
    const line = src.slice(0, absolute).split("\n").length;
    const scope = enclosingBody(src, absolute);
    const site = { f, line, name: scope.name ?? "(top level)", scope: scope.scope, body: scope.body };
    if (isBound(preamble)) bound.push(site);
    else unbound.push(site);
  }
}

// THE DISCRIMINATOR IS THE QUESTION, NOT THE FIELD NAME. send-sms-auto-detect
// derives `outcome`, `success` and `successCount` from the SAME variable, so a
// caller reading `json.successCount > 0` has consulted exactly the fact this
// guard is about and must not be failed for spelling it differently. Requiring
// the literal word `outcome` flagged three correct callers on this guard's own
// first run (send-notification, send-reapply-blast, send-batch-blast) — a guard
// that cries wolf on working code is one nobody reads.
const CONSULTED = /\.\s*(?:outcome|successCount|success)\b|\{[^}]*\b(?:outcome|successCount)\b[^}]*\}\s*=/;
// A caller that spreads the parsed body straight into its own response has
// FORWARDED the contract intact rather than consumed it — it decides nothing and
// hides nothing, so it is published, not failed.
const FORWARDED = /\.\.\.\s*\w*(?:[Rr]es(?:ult|ponse)?|json|body|data)\w*\b/;

const forwarded = bound.filter((s) => !CONSULTED.test(s.body) && FORWARDED.test(s.body));
const legA = bound.filter((s) => !CONSULTED.test(s.body) && !FORWARDED.test(s.body))
  .map((s) => ({ ...s, leg: "A", why: "binds the response but never consults outcome/successCount" }));

// Leg B: a wrapper that discards the response and then returns a success-shaped
// literal has invented a receipt. `return;` / `return null` / no return is not a
// receipt and is published, not failed.
const MANUFACTURED = /return\s*(?:\{[^{}]*\b(?:ok|success|sent|delivered)\b\s*:\s*true[^{}]*\}|true)\s*[;\n]/;
const legB = unbound.filter((s) => !CONSULTED.test(s.body) && MANUFACTURED.test(s.body))
  .map((s) => ({ ...s, leg: "B", why: "discards the response, then returns a hardcoded success its caller writes a receipt on" }));

const published = unbound.filter((s) => !legB.some((b) => b.f === s.f && b.line === s.line));
const violations = [...legA, ...legB];

console.log(
  `check:sms-outcome-contract — ${bound.length} bound + ${unbound.length} unbound call site(s) of ${FN}; ` +
  `${bound.length + legB.length} graded, ${published.length} published as receipt-free`,
);
for (const s of published) {
  console.log(`  unbound  ${s.f}:${s.line} :: ${s.name} — response discarded and no receipt manufactured; reaches nobody, lies to nobody`);
}
for (const s of forwarded) {
  console.log(`  forwarded ${s.f}:${s.line} :: ${s.name} — parsed body returned to its own caller unmodified; decides nothing`);
}
for (const s of bound.filter((b) => b.scope === "file")) {
  console.log(`  note     ${s.f}:${s.line} — no function header resolved; graded against the whole file (permissive)`);
}
if (violations.length) {
  for (const v of violations) {
    console.log(
      `  VIOLATION [leg ${v.leg}] ${v.f}:${v.line} :: ${v.name} — ${v.why}; ` +
      `HTTP 200 with outcome:"skipped" means nothing was sent`,
    );
  }
  console.log(`\n${violations.length} violation(s).`);
  process.exit(1);
}
console.log("OK — every bound caller branches on the outcome contract.");
