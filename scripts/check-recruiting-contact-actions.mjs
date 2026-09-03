import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

// check-recruiting-contact-actions — MP-392
//
// Guards the one-tap Call/Text controls on the applications / interviews /
// recruiting-pipeline surfaces against the two defects this wave fixed.
//
// DEFECT 1 — the dead click. src/lib/phone.ts records, from Sam on 2026-08-16:
// bare `tel:`/`sms:` hrefs are DEAD CLICKS on a desktop with no phone or SMS
// app, which is every APEX VA ("the buttons just don't work at all for her").
// phoneHref/smsHref were introduced to route desktop through Google Voice while
// keeping native dialing on touch devices. HiringPipeline — the page literally
// called the recruiting pipeline — still used raw `tel:`/`sms:` on all three of
// its contact controls, plus four applicant surfaces beside it. The helper was
// fixed; the callers were never swept.
//
// CONTRACT 2 GRADES THE MECHANISM, NOT THE BEHAVIOUR. A site that inlines an
// equivalent scheme test is behaviourally correct and will still FAIL here. That
// is deliberate — the helper exists to single-source the rule — but it means a
// Contract 2 failure is NOT evidence of a live user-facing defect, and the
// message must not claim one. Measured 2026-09-03 (MP-404): DashboardApplicants
// .tsx was the only such site and it was correct; it was converted to remove the
// duplicated test, not to fix a bug.
//
// DEFECT 2 — the lost workspace. On desktop those helpers return an **https**
// Google Voice URL, and an https href in a bare <a> navigates the CURRENT tab.
// Interviews.tsx carried a private externalLinkProps helper and used it on four
// of six call sites; the two that lacked it were the priority-candidate hero
// buttons — the most prominent contact controls on the page, driven by J/K
// keyboard nav. Tapping Call there threw the recruiter out of the queue and
// into Google Voice, losing filters, scroll position, and paying a full SPA
// cold boot to return.
//
// WHY THIS FILE LIST AND NOT src/** : a large remainder of raw tel:/sms: sites
// exists across CRM, client, and agent surfaces that this bounded wave did not
// touch — the count is MEASURED and printed on every green run rather than
// written down here, because a hardcoded remainder goes stale silently (the
// draft of this header said "~55" while the guard measured 77),
// and the public marketing pages (Footer, Contact, CalendlyEmbed, Storefront,
// PublicAgentLanding) use raw `tel:` CORRECTLY — a cold visitor on a phone
// should get the native dialer, not a Google Voice account chooser. A guard
// spanning all of src/ would be red on day one with no available remedy, which
// is the permanently-red failure mode this repo has recorded repeatedly. It
// grades the surfaces this wave actually converted and PUBLISHES the unswept
// remainder as context so the number is not lost.
//
// WHY COMMENTS ARE STRIPPED: every test here is substring/positional, so before
// stripping, the word `tel:` inside this very header — or inside a caller's
// explanatory comment — would count as a violation. That footnote bug has bitten
// this repo before (MP-277). The stripper is string-aware: string and template
// bodies are copied verbatim, because the needles legitimately live inside
// template literals.

const root = resolve(import.meta.dirname, "..");
const read = (p) => readFileSync(resolve(root, p), "utf8");

// Surfaces converted by MP-392. A file here must never regress to a raw scheme.
const WATCHED = [
  "src/pages/Interviews.tsx",
  "src/pages/DashboardApplicants.tsx",
  "src/pages/HiringPipeline.tsx",
  "src/pages/admin/MyApplicants.tsx",
  "src/pages/OldApplicants.tsx",
  "src/pages/AgentPipeline.tsx",
  "src/pages/XcelPipeline.tsx",
  "src/pages/StaleRecovery.tsx",
];

// Public/marketing surfaces where a raw tel: is the CORRECT behaviour.
const PUBLIC_RAW_TEL_OK = [
  "src/components/landing/Footer.tsx",
  "src/components/landing/CalendlyEmbed.tsx",
  "src/pages/Contact.tsx",
  "src/pages/Storefront.tsx",
  "src/pages/PublicAgentLanding.tsx",
];

/** Remove comments, preserving line structure and string/template bodies. */
function stripComments(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      out += ch;
      i += 1;
      while (i < text.length) {
        if (text[i] === "\\") {
          out += text[i] + (text[i + 1] ?? "");
          i += 2;
          continue;
        }
        out += text[i];
        if (text[i] === quote) { i += 1; break; }
        i += 1;
      }
      continue;
    }
    if (text.startsWith("/*", i)) {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? text.length : end + 2;
      for (let j = i; j < stop; j += 1) out += text[j] === "\n" ? "\n" : " ";
      i = stop;
      continue;
    }
    if (text.startsWith("//", i)) {
      while (i < text.length && text[i] !== "\n") i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

const lineOf = (text, index) => text.slice(0, index).split("\n").length;

/**
 * Bounds of the JSX tag enclosing `index`: back to the nearest '<', forward to
 * the first '>' at brace depth 0 so a '>' inside an expression does not end it.
 */
function enclosingTag(text, index) {
  let start = index;
  while (start > 0 && text[start] !== "<") start -= 1;
  let depth = 0;
  let end = index;
  while (end < text.length) {
    const c = text[end];
    if (c === "{") depth += 1;
    else if (c === "}") depth -= 1;
    else if (c === ">" && depth <= 0) break;
    end += 1;
  }
  return text.slice(start, Math.min(end + 1, text.length));
}

const failures = [];
const sources = {};

for (const path of WATCHED) {
  let text;
  try {
    text = read(path);
  } catch (error) {
    // A watched surface that moved must fail CLOSED, never grade fewer files
    // and report success.
    console.error(`✗ check:recruiting-contact-actions — cannot read ${path} (${error.code ?? error.message}).`);
    console.error("  A watched recruiting surface moved or was deleted; the guard refuses to grade the rest.");
    process.exit(1);
  }
  sources[path] = stripComments(text);
}

// ---- Contract 1: no unguarded raw tel:/sms: on a watched surface ------------
// The raw scheme is permitted ONLY as the `??` fallback of a phoneHref/smsHref
// call, which is how an un-normalizable number keeps the control it has today
// instead of losing it.
for (const [path, code] of Object.entries(sources)) {
  for (const m of code.matchAll(/\b(tel|sms):/g)) {
    const tag = enclosingTag(code, m.index);
    const guarded = /phoneHref\(|smsHref\(/.test(tag);
    if (!guarded) {
      failures.push(
        `${path}:${lineOf(code, m.index)} — raw \`${m[1]}:\` href with no phoneHref()/smsHref() guard.\n` +
        `    Dead click on desktop (no native dialer). Route it through @/lib/phone.`,
      );
    }
  }
}

// ---- Contract 2: every desktop-capable contact anchor sets target/rel -------
// phoneHref/smsHref return an https Google Voice URL on desktop; without
// contactLinkProps that navigates the current tab and destroys the workspace.
for (const [path, code] of Object.entries(sources)) {
  for (const m of code.matchAll(/href=\{[^}]*?(phoneHref|smsHref)\(/g)) {
    const tag = enclosingTag(code, m.index);
    if (!tag.includes("contactLinkProps(")) {
      failures.push(
        `${path}:${lineOf(code, m.index)} — ${m[1]}() href without {...contactLinkProps(...)}.\n` +
        `    On desktop these helpers return an https Google Voice URL, so the anchor MUST set\n` +
        `    target/rel or it navigates the current tab and throws the recruiter out of the queue.\n` +
        `    NOTE: this grades the MECHANISM, not the behaviour. An equivalent inline test\n` +
        `    (target={...startsWith("https://") ? "_blank" : undefined}) is not a live defect —\n` +
        `    DashboardApplicants.tsx shipped exactly that and was correct. It is still a FAIL:\n` +
        `    contactLinkProps exists so this rule lives in one place, and an inline copy is the\n` +
        `    drift this repo keeps paying for. Route it through the shared helper.`,
      );
    }
  }
}

// ---- Contract 3: the helper itself still branches on device + scheme --------
const phoneLib = stripComments(read("src/lib/phone.ts"));
for (const [needle, label] of [
  ["isTouchDevice()", "touch-device branch (mobile keeps native dialing)"],
  ["googleVoiceHref(", "desktop Google Voice call path"],
  ["googleVoiceSmsHref(", "desktop Google Voice SMS path"],
  ['startsWith("https://")', "scheme test behind contactLinkProps"],
]) {
  if (!phoneLib.includes(needle)) {
    failures.push(`src/lib/phone.ts — missing ${label} (\`${needle}\`). The contact contract is gutted.`);
  }
}

if (failures.length) {
  console.error("✗ check:recruiting-contact-actions — recruiting contact controls regressed:\n");
  for (const f of failures) console.error(`  ${f}\n`);
  console.error(`  ${failures.length} violation(s). See scripts/check-recruiting-contact-actions.mjs header.`);
  process.exit(1);
}

// ---- Context, deliberately NOT graded --------------------------------------
// Published so the unswept remainder stays visible instead of being silently
// implied clean by a passing guard.
// NODE VERSION SKEW (MP-404): this block first used fs.globSync, which exists on
// the Node 26 this repo is developed on and NOT on the Node 20 pinned by
// .github/workflows/verify-core.yml. Every contract above passed and the guard
// then died here with `globSync is not a function` — green locally, permanently
// red in CI, which is worse than no guard. Walk with readdirSync/withFileTypes,
// available since Node 10; do not reintroduce a post-20 fs API here.
function walkTsx(dir, acc = []) {
  for (const entry of readdirSync(resolve(root, dir), { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walkTsx(rel, acc);
    else if (entry.name.endsWith(".tsx")) acc.push(rel);
  }
  return acc;
}

// Context gathering must NEVER decide this guard's exit code: the contracts have
// already passed by the time we get here, so a fault in an ungraded statistic
// would fail a clean tree. Reported, never swallowed silently.
let unswept = null;
try {
  unswept = 0;
  for (const p of walkTsx("src")) {
    if (WATCHED.includes(p) || PUBLIC_RAW_TEL_OK.includes(p)) continue;
    let code;
    try { code = stripComments(read(p)); } catch { continue; }
    for (const m of code.matchAll(/\b(tel|sms):/g)) {
      if (!/phoneHref\(|smsHref\(/.test(enclosingTag(code, m.index))) unswept += 1;
    }
  }
} catch (error) {
  unswept = null;
  console.log(`  context UNAVAILABLE — could not sweep the remainder (${error.message}).`);
}

console.log(
  `✓ check:recruiting-contact-actions — ${WATCHED.length} recruiting surfaces clean ` +
  `(no unguarded tel:/sms:, every phoneHref/smsHref anchor sets target/rel; 4 helper contracts intact).`,
);
if (unswept !== null) {
  console.log(
    `  context (not graded): ${unswept} raw tel:/sms: site(s) remain outside the recruiting scope ` +
    `and outside the ${PUBLIC_RAW_TEL_OK.length} public pages where raw tel: is correct.`,
  );
}
