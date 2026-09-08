import { stripComments } from "./lib/strip-comments.mjs";
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

// Surfaces where a raw tel:/sms: is the CORRECT behaviour. Exempt with a reason,
// never silently skipped.
//
// THE CRITERION IS WHO HOLDS THE MOUSE, NOT WHETHER THE ROUTE IS PUBLIC. This
// list was named PUBLIC_RAW_TEL_OK and described as "public/marketing surfaces"
// until 2026-09-08, and that wording is what let two surfaces through: the
// 2026-09-07 onboarding wave shipped ApplicantHome and ContractingSuccessModal
// with raw `tel:`/`sms:` to APEX's own number, both AUTHENTICATED and neither
// marketing, so the walk graded them and demanded a conversion that is wrong for
// them. They are now allowed at the site with written reasons.
//
// phoneHref/smsHref exist for ONE direction: an APEX operator (VA, recruiter,
// admin) dialing OUT to someone else's number from a desktop with no dialer, who
// therefore needs Sam's Google Voice. Point them inbound — at APEX's own number,
// clicked by a visitor, applicant or newly contracted agent — and they ask that
// person to sign into Google and provision their own Voice line to reach us. All
// 49 phoneHref/smsHref call sites in src/ are outbound; all 7 sites linking Sam's
// own number are raw. The split is direction, and it is NOT a literal-vs-dynamic
// test either: PublicAgentLanding and MyLandingPage below use `tel:${...}` on an
// AGENT's number and are still inbound, because a prospect does the clicking.
const NON_OPERATOR_SURFACE_RAW_OK = [
  "src/components/landing/Footer.tsx",
  "src/components/landing/CalendlyEmbed.tsx",
  "src/pages/Contact.tsx",
  "src/pages/Storefront.tsx",
  "src/pages/PublicAgentLanding.tsx",
  // Renders a PREVIEW of PublicAgentLanding inside the dashboard. Converting it
  // would make the preview behave differently from the page it previews.
  "src/pages/MyLandingPage.tsx",
];

// `sms:?&body=` — a share-this-link action with NO recipient. smsHref() needs a
// number to normalise, so the helper cannot express this call at all. This is a
// real remaining dead click on desktop; it is exempt because no remedy exists in
// the current helper, and it is NAMED here rather than hidden in a count.
const NO_RECIPIENT_SCHEME = [
  "src/pages/RecruitingLinks.tsx",
];

/** Remove comments, preserving line structure and string/template bodies. */

const lineOf = (text, index) => text.slice(0, index).split("\n").length;

/**
 * The scope a guard needle must appear in for THIS site to count as guarded:
 * the enclosing JSX tag when the match really is inside one, otherwise the
 * match's own line.
 *
 * 2026-09-08 (MP-472): the first cut walked back to the nearest '<' and forward
 * to the first '>' at brace depth 0, and trusted whatever came back. Neither end
 * was anchored to an actual tag, so on a helper that returns an href — the very
 * shape the header above says this guard was widened to catch — it produced a
 * 39,925-character slab spanning the whole component, swept up the file's three
 * legitimate phoneHref() calls, and reported the raw site as GUARDED. Proximity
 * is not scope. Two ways it went wrong, both live in src/ when this was written:
 *
 *   - The '<' it walked back to was a COMPARISON (`if (untilExam <= 2)`) or a
 *     TYPE PARAMETER (`<{ className?: string }>`), not a tag opening.
 *   - Even when it found a real tag, it never checked that `index` was INSIDE
 *     that tag. `<ShieldOff className="h-3 w-3" />` closes long before a
 *     `return phoneHref(x) ?? \`tel:${x}\`` fifty lines later.
 *
 * A raw scheme laundered by an unrelated phoneHref elsewhere in the file is the
 * worst direction this guard has: a partially-converted file reads clean, which
 * is how admin/RecoveryQueue.tsx kept two dead VA dial controls through MP-404,
 * MP-405 and MP-433. Falling back to the LINE is what makes the `??` fallback
 * (`phoneHref(x) ?? \`tel:${x}\``) still read as guarded, because that idiom
 * always puts the helper and the raw scheme on one line.
 */
function enclosingTag(text, index) {
  const lineStart = text.lastIndexOf("\n", index) + 1;
  const lineEndRaw = text.indexOf("\n", index);
  const line = text.slice(lineStart, lineEndRaw === -1 ? text.length : lineEndRaw);

  let start = index;
  while (start > 0 && text[start] !== "<") start -= 1;
  // A tag opens with `<` + name, `</`, or `<>`. `<=`, `< ` and `<{` do not.
  if (text[start] !== "<" || !/^<[A-Za-z/>]/.test(text.slice(start, start + 2))) return line;

  let depth = 0;
  let end = start;
  while (end < text.length) {
    const c = text[end];
    if (c === "{") depth += 1;
    else if (c === "}") depth -= 1;
    else if (c === ">" && depth <= 0) break;
    end += 1;
  }
  // The match must actually fall inside the tag; past its '>' we are in the
  // element's CHILDREN, which the tag's attributes cannot vouch for.
  if (end < index) return line;
  return text.slice(start, Math.min(end + 1, text.length));
}

/**
 * A `tel:`/`sms:` that is actually a URL, anchored on the opening quote or
 * backtick of the literal it begins. Getting this needle right took three cuts
 * and both wrong ones are worth keeping written down:
 *
 *   1. /\b(tel|sms):/ anywhere. Safe while the population was 8 curated
 *      recruiting surfaces, wrong across src/**: NotificationHub and
 *      ClientMarketing declare `sms:` as an OBJECT KEY on channel-label and
 *      channel-colour maps, and the guard reported seven dead clicks in files
 *      whose channel badges are correct. Matching a needle's shape in a context
 *      that is not the thing is the footnote-bug family this repo keeps paying
 *      for (MP-277, MP-399).
 *
 *   2. Requiring `href=` or `open(` adjacency. This killed the object keys and
 *      went BLIND to two real defects — RecoveryBatchDrawer.tsx and
 *      admin/UnlicensedAll.tsx both build the href in a helper
 *      (`return \`tel:${digits}\``) that an anchor then consumes, so the scheme
 *      never sits next to an `href=`. A detector that got quieter is not the
 *      same as a codebase that got cleaner; the drop from 25 findings to 14 was
 *      checked site by site, which is the only reason this was caught.
 *
 * A scheme immediately after a quote or backtick is the start of a URL literal
 * and nothing else — an object key cannot be quoted that way and still parse as
 * `sms:`. This catches the attribute, the `location.href =` assignment, the
 * `window.open()` and the helper-returned href alike.
 */
const SCHEME_IN_LINK_POSITION = /["'`](tel|sms):/g;

// src/tests/** is excluded BY NAME. AgentCloudParity.test.tsx asserts on the
// SOURCE TEXT of DashboardCRM (`expect(crm).toContain("tel:${r.phone}")`), so a
// test is a place the literal legitimately appears without being a link a human
// can click. Tests are not user surfaces; grading them makes the guard red for
// asserting on the very thing it guards.
const isTestPath = (p) => p.startsWith("src/tests/") || /\.test\.tsx?$/.test(p);

const failures = [];
const sources = {};
const rawSources = {};

/**
 * Site-level opt-out, mirroring this repo's existing `empty-catch-allow:`
 * convention. A file-level exemption is too coarse — StatCardPopup and
 * DashboardAgedLeads each hold three CORRECT converted controls beside one
 * multi-recipient blast, and exempting the file would stop grading the three to
 * excuse the one. The marker is read from the RAW text, before comments are
 * stripped, and every use must carry a reason after the colon.
 */
// The reason is REQUIRED and must be prose. The first cut asked only for one
// non-space character after the colon, which `*/` satisfies — so
// `/* contact-scheme-allow:*/` read as a written justification. An
// exemption whose reason can be empty is not an exemption, it is an off
// switch. Caught by proof F3, not by inspection.
const ALLOW_MARKER = /contact-scheme-allow:\s*[A-Za-z][^*\n]{15,}/;
let allowedSites = 0;
function isAllowed(path, line) {
  const src = rawSources[path];
  if (!src) return false;
  const lines = src.split("\n");
  // Same line OR the line immediately above, the way eslint-disable-next-line
  // works: these reasons are far too long to trail the code they excuse.
  return ALLOW_MARKER.test(lines[line - 1] ?? "") || ALLOW_MARKER.test(lines[line - 2] ?? "");
}

// MP-405 widened the graded population from the 8 MP-392 surfaces to every
// .tsx in src/ minus the two NAMED exempt lists above. That widening was
// refused by MP-404 for a documented reason -- "a guard spanning all of src/
// would be red on day one with no available remedy" -- and the reason has since
// been retired, not overruled: the 50 internal sites it would have failed on
// were converted in the same commit that widened it. Do not re-widen a guard
// past its remedy; widen the remedy first.
//
// WATCHED keeps a job the walk cannot do. A file in the walk that is deleted or
// renamed simply stops being enumerated, which is indistinguishable from a file
// that was cleaned. The 8 surfaces below are read by name so that losing one
// fails CLOSED instead of quietly grading fewer files and reporting success.
for (const path of WATCHED) {
  let text;
  try {
    text = read(path);
  } catch (error) {
    console.error(`✗ check:recruiting-contact-actions — cannot read ${path} (${error.code ?? error.message}).`);
    console.error("  A watched recruiting surface moved or was deleted; the guard refuses to grade the rest.");
    process.exit(1);
  }
  sources[path] = stripComments(text);
  rawSources[path] = text;
}

// Everything else under src/ joins the same two contracts. walkTsx is declared
// below (function declarations hoist); it deliberately uses no post-Node-20 fs
// API -- see the note on its definition.
let graded_walk = 0;
for (const path of walkTsx("src")) {
  if (sources[path] || NON_OPERATOR_SURFACE_RAW_OK.includes(path) || NO_RECIPIENT_SCHEME.includes(path)) continue;
  if (isTestPath(path)) continue;
  let text;
  try { text = read(path); } catch { continue; }
  sources[path] = stripComments(text);
  rawSources[path] = text;
  graded_walk += 1;
}

// ---- Contract 1: no unguarded raw tel:/sms: on a watched surface ------------
// The raw scheme is permitted ONLY as the `??` fallback of a phoneHref/smsHref
// call, which is how an un-normalizable number keeps the control it has today
// instead of losing it.
/**
 * The needle `phoneHref(`/`smsHref(` only means the REAL helper when the file
 * actually imports it. HireLaunchBoard.tsx declared its own phoneHref/smsHref
 * returning a bare `tel:`/`sms:` (no device branch, no Google Voice, not even a
 * +1) and admin/RecoveryQueue.tsx did the same under `telHref`/`smsHref` — so a
 * name-keyed test read both as guarded and two VA dialing surfaces kept dead
 * desktop controls through MP-404, MP-405 and MP-433. Matching a needle's SHAPE
 * in a context that is not the thing is this repo's recurring bill (MP-277,
 * MP-399); measured 2026-09-08, 39 of the 40 files using the needle import the
 * helper, and the one that does not is exempt at the site with a written reason.
 *
 * A file cannot both import `phoneHref` and declare one — TypeScript rejects the
 * redeclaration — so this test and a local shadow are mutually exclusive.
 */
const IMPORTS_REAL_HELPER =
  /import\s*\{[^}]*\b(?:phoneHref|smsHref)\b[^}]*\}\s*from\s*["'\u0060]@\/lib\/phone["'\u0060]/;

for (const [path, code] of Object.entries(sources)) {
  const realHelper = IMPORTS_REAL_HELPER.test(rawSources[path] ?? "");
  for (const m of code.matchAll(SCHEME_IN_LINK_POSITION)) {
    const tag = enclosingTag(code, m.index);
    const guarded = realHelper && /phoneHref\(|smsHref\(/.test(tag);
    const line = lineOf(code, m.index);
    if (!guarded && isAllowed(path, line)) { allowedSites += 1; continue; }
    if (!guarded) {
      failures.push(
        `${path}:${lineOf(code, m.index)} — raw \`${m[1]}:\` href with no phoneHref()/smsHref() guard.\n` +
        `    On a desktop with no phone/SMS app this click does nothing. THE REMEDY DEPENDS ON\n` +
        `    WHO CLICKS IT, and this check cannot tell — decide before converting:\n` +
        `      - an APEX operator dialing OUT to someone else's number -> route it through\n` +
        `        @/lib/phone (phoneHref/smsHref + contactLinkProps). This is the common case.\n` +
        `      - a visitor, applicant or agent reaching APEX's OWN number -> leave the raw\n` +
        `        scheme and add \`contact-scheme-allow: <reason>\` on this line or the one above.\n` +
        `        Converting sends them to Google's account chooser to provision their own Voice\n` +
        `        line, which does not reach us; every other site linking Sam's number is raw.`,
      );
    }
  }
}

// ---- Contract 2: every desktop-capable contact anchor sets target/rel -------
// phoneHref/smsHref return an https Google Voice URL on desktop; without
// contactLinkProps that navigates the current tab and destroys the workspace.
/**
 * Names that produce a contact href in this file: the shared helpers, plus any
 * LOCAL function whose body calls them. RecoveryBatchDrawer and admin/
 * UnlicensedAll both wrap the rule in a file-local `telHref()`, so an anchor
 * reading `href={telHref(row.phone)}` returns a desktop Google Voice URL and was
 * invisible to a contract keyed on the helper names alone — it could lose its
 * target/rel with nothing going red. Proof F2 found this; the guard did not.
 */
function contactHrefProducers(code) {
  const names = ["phoneHref", "smsHref"];
  for (const m of code.matchAll(/(?:function\s+(\w+)\s*\(|const\s+(\w+)\s*=\s*(?:\([^)]*\)|\w+)\s*=>)/g)) {
    const name = m[1] ?? m[2];
    if (!name || names.includes(name)) continue;
    // Body = from the declaration to the next line that closes at column 0.
    const rest = code.slice(m.index);
    const end = rest.search(/\n\}/);
    if (/phoneHref\(|smsHref\(/.test(rest.slice(0, end === -1 ? rest.length : end))) names.push(name);
  }
  return names;
}

for (const [path, code] of Object.entries(sources)) {
  const producers = contactHrefProducers(code).join("|");
  for (const m of code.matchAll(new RegExp(`href=\\{[^}]*?(${producers})\\(`, "g"))) {
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
// The remainder this block used to publish is now GRADED above. What is left to
// publish is the exempt population itself: an exemption nobody can see is how a
// silent skip survives. NODE VERSION SKEW (MP-404): this walk first used
// fs.globSync, which exists on the Node 26 this repo is developed on and NOT on
// the Node 20 pinned by .github/workflows/verify-core.yml -- every contract
// passed and the guard then died with `globSync is not a function`, green
// locally and permanently red in CI. Walk with readdirSync/withFileTypes,
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

// Counting must NEVER decide this guard's exit code: the contracts have already
// passed by the time we get here, so a fault in an ungraded statistic would fail
// a clean tree. Reported, never swallowed silently.
let exemptSites = null;
try {
  exemptSites = 0;
  for (const p of [...NON_OPERATOR_SURFACE_RAW_OK, ...NO_RECIPIENT_SCHEME]) {
    let code;
    try { code = stripComments(read(p)); } catch { continue; }
    for (const m of code.matchAll(SCHEME_IN_LINK_POSITION)) {
      if (!/phoneHref\(|smsHref\(/.test(enclosingTag(code, m.index))) exemptSites += 1;
    }
  }
} catch (error) {
  exemptSites = null;
  console.log(`  context UNAVAILABLE — could not tally the exempt sites (${error.message}).`);
}

console.log(
  `✓ check:recruiting-contact-actions — ${Object.keys(sources).length} src/ surface(s) clean ` +
  `(${WATCHED.length} read by name so a move fails closed, ${graded_walk} more from the walk): ` +
  `no unguarded tel:/sms:, every phoneHref/smsHref anchor sets target/rel; 4 helper contracts intact.`,
);
if (exemptSites !== null) {
  console.log(
    `  allowed at the site (marker + written reason): ${allowedSites}.`,
  );
  console.log(
    `  exempt (not graded, by name): ${exemptSites} raw site(s) across ` +
    `${NON_OPERATOR_SURFACE_RAW_OK.length} non-operator surface(s) where the clicker is a prospect ` +
    `or applicant reaching an APEX number and must get the native handoff, ` +
    `and ${NO_RECIPIENT_SCHEME.length} file(s) using a recipient-less \`sms:?&body=\` share the ` +
    `helper cannot express — the latter IS still a desktop dead click, with no remedy in @/lib/phone.`,
  );
}
