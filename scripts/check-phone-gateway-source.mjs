#!/usr/bin/env node
/**
 * MP-420 — the local part of a carrier SMS gateway address must come from
 * nanpTenDigits(), which REFUSES a non-NANP number instead of truncating it.
 *
 * THE BUG THIS EXISTS FOR: nine edge functions built the address as
 * `phone.replace(/\D/g, "").slice(-10)`. slice(-10) cannot fail — it returns
 * the last ten digits of whatever it is handed — so a Nigerian applicant stored
 * as 2348061399263 became 8061399263, which is area code 806, Amarillo, Texas,
 * a real number belonging to somebody else. The message went to that stranger.
 * notification_log recorded the applicant's own +234 number and status 'sent',
 * so nothing in the record could say what had happened.
 *
 * Four of the nine had NO length check at all. The other five read
 * `if (cleaned.length === 10)` (or `!== 10`), which looks like the fix and is
 * structurally dead in the only direction that matters: the slice has already
 * truncated to ten, so the test can never observe an eleventh digit. It could
 * only ever reject numbers that were too SHORT. That is why this guard grades
 * the SOURCE of the value and not the presence of a length check — a length
 * check downstream of a truncation is decoration.
 *
 * Measured in prod on 2026-09-04: 21 applications rows hold a non-NANP phone,
 * 19 of them carry a carrier value (so the send path resolves), and
 * notification_log books 205 'sent' rows against them, the newest 2026-08-05
 * on the single-gateway path that MP-270 left behind. Of 463 distinct phones
 * texted in 90 days, 457 are NANP and unaffected by this change; the 6 that
 * now refuse are exactly this bug's victims.
 *
 * TWO LEGS, because the two populations have different consequences and only
 * one of them was fixed this wave.
 *
 *   A. GRADED, hard fail. A carrier-gateway address whose local part is not
 *      bound from nanpTenDigits(). This is the population that mails a message
 *      to a stranger.
 *
 *   B. PUBLISHED against a shrink-only inventory. Every other `slice(-10)` on a
 *      phone in supabase/functions — identity and lookup keys (link-account,
 *      claim-account, simple-login, readymode-webhook, telegram-webhook,
 *      submit-application, manychat-webhook, consume-invite-token, ethos.ts,
 *      check-email-status). Same dead gate, different blast radius: two people
 *      whose numbers share a last-ten collide into one identity rather than one
 *      of them being texted. consume-invite-token is the sharpest of these — it
 *      writes `+1${digits.slice(-10)}`, stamping an international number as US
 *      at the source. None of them are fixed here and this guard does not
 *      pretend they are; they are named, frozen, and can only go down.
 *
 * WHY AN INVENTORY AND NOT A COUNT: MP-356 proved a count-only floor is
 * fungible — a real regression sat red for 8 commits and was then absorbed by
 * an unrelated pay-down, and the gate went green having lost the regression.
 * Leg B is keyed per site, so a NEW truncation fails even if two old ones were
 * removed in the same commit.
 *
 * WHAT THIS DOES NOT COVER, stated rather than implied: it does not grade the
 * Resend/Twilio legs of the same senders, does not follow a phone across a
 * helper boundary (a function that returns a truncated value and is called
 * elsewhere reads as clean at the address site), does not grade SQL or
 * client-side senders, and cannot tell whether a NANP number is the right
 * person's — only that it was not manufactured by truncation.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const BASELINE = "scripts/data/phone-truncation-baseline.json";
const HELPER = "nanpTenDigits";

// Strip comments so this file's own prose, and every converted site's note
// about the bug, is never matched as code. MP-277: a guard that scans raw
// source counts its own footnotes — that one held a baseline flat while the
// code improved, and it stopped measuring without going red. String bodies are
// preserved, because the gateway address IS a template string.
function stripComments(src) {
  let out = "", i = 0, mode = "code", quote = "";
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (mode === "code") {
      if (c === "/" && n === "*") { mode = "block"; out += "  "; i += 2; continue; }
      if (c === "/" && n === "/") { mode = "line"; out += "  "; i += 2; continue; }
      if (c === '"' || c === "'" || c === "`") { mode = "str"; quote = c; out += c; i++; continue; }
      out += c; i++; continue;
    }
    if (mode === "str") {
      if (c === "\\") { out += src.slice(i, i + 2); i += 2; continue; }
      if (c === quote) mode = "code";
      out += c; i++; continue;
    }
    if (mode === "block" && c === "*" && n === "/") { mode = "code"; out += "  "; i += 2; continue; }
    if (mode === "line" && c === "\n") { mode = "code"; out += "\n"; i++; continue; }
    out += c === "\n" ? "\n" : " ";
    i++;
  }
  return out;
}

const lineOf = (src, idx) => src.slice(0, idx).split("\n").length;

const files = execSync("git ls-files 'supabase/functions/**/*.ts'", { encoding: "utf8" })
  .split("\n").filter(Boolean)
  // the helper and its test define the contract; they do not consume it, and
  // the test deliberately keeps a copy of the broken primitive to prove it
  // still loses the answer.
  .filter((f) => !f.includes("_shared/nanp-phone"));

// ---------------------------------------------------------------- leg A
// `${local}@${domain}` inside a file that knows about carrier gateways.
const ADDRESS = /`\$\{\s*([A-Za-z_$][\w$]*)\s*\}@\$\{/g;
// A binding that produces the local part. Only nanpTenDigits acquits.
const bindingOf = (body, name) => {
  const m = body.match(new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*=\\s*([^;\\n]+)`));
  return m ? m[1].trim() : null;
};

const violations = [];
const gradedSites = [];
const legB = [];

for (const f of files) {
  const raw = readFileSync(f, "utf8");
  const src = stripComments(raw);
  const isGatewaySender = /CARRIER_GATEWAYS/.test(src);

  if (isGatewaySender) {
    for (const m of src.matchAll(ADDRESS)) {
      const local = m[1];
      const line = lineOf(src, m.index);
      const binding = bindingOf(src, local);
      const site = { f, line, local, binding };
      gradedSites.push(site);
      if (!binding) {
        violations.push({ ...site, why: `local part \`${local}\` has no resolvable binding in this file — cannot prove it is not a truncation` });
      } else if (!binding.includes(`${HELPER}(`)) {
        violations.push({ ...site, why: `local part \`${local}\` is bound from \`${binding}\`, not ${HELPER}()` });
      }
    }
    if (gradedSites.some((s) => s.f === f) && !/nanp-phone\.ts/.test(src)) {
      violations.push({ f, line: 1, local: "-", why: `builds carrier gateway addresses but does not import ${HELPER} from _shared/nanp-phone.ts` });
    }
  }

  // ------------------------------------------------------------- leg B
  // every remaining truncation of a phone, wherever it lives
  for (const m of src.matchAll(/\.slice\(\s*-10\s*\)/g)) {
    const line = lineOf(src, m.index);
    const lineText = raw.split("\n")[line - 1]?.trim() ?? "";
    legB.push({ f, line, key: `${f}::${lineText.replace(/\s+/g, " ")}`, text: lineText });
  }
}

const seen = JSON.parse(readFileSync(BASELINE, "utf8"));
const known = new Set(seen.sites);
const present = new Set(legB.map((s) => s.key));
const added = legB.filter((s) => !known.has(s.key));
const removed = [...known].filter((k) => !present.has(k));

if (process.argv.includes("--update")) {
  writeFileSync(BASELINE, JSON.stringify({ ...seen, sites: [...present].sort() }, null, 2) + "\n");
  console.log(`baseline rewritten: ${present.size} site(s)`);
  process.exit(0);
}

console.log(
  `check:phone-gateway-source — ${gradedSites.length} carrier-gateway address site(s) graded; ` +
  `${legB.length} phone truncation(s) inventoried (${known.size} baselined)`,
);
for (const s of gradedSites.filter((s) => !violations.some((v) => v.f === s.f && v.line === s.line))) {
  console.log(`  ok       ${s.f}:${s.line} — local part \`${s.local}\` from ${HELPER}()`);
}
for (const k of removed) console.log(`  paid off ${k}`);
if (removed.length) {
  console.log(`\n${removed.length} baselined truncation(s) are gone — rerun with --update to lock the gain in.`);
}
for (const s of added) {
  console.log(`  NEW      ${s.f}:${s.line} — ${s.text}`);
}
if (violations.length || added.length || removed.length) {
  for (const v of violations) {
    console.log(`  VIOLATION ${v.f}:${v.line} — ${v.why}`);
  }
  const parts = [];
  if (violations.length) parts.push(`${violations.length} gateway address(es) not sourced from ${HELPER}()`);
  if (added.length) parts.push(`${added.length} new phone truncation(s)`);
  if (removed.length) parts.push(`${removed.length} baseline entr(y/ies) to retire`);
  console.log(`\n${parts.join("; ")}.`);
  process.exit(1);
}
console.log(`OK — every carrier gateway address is sourced from ${HELPER}(); leg B inventory unchanged.`);
