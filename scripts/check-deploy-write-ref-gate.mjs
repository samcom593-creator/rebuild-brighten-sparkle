import { readFileSync, readdirSync } from "node:fs";
import yaml from "js-yaml";

// check-deploy-write-ref-gate — MP-602 (2026-09-20)
//
// THE BUG THIS EXISTS FOR, measured, not hypothesised. deploy-supabase.yml
// triggers on `push: [main, feat/**]` AND `pull_request: [main]`, but its three
// prod-writing steps were gated only on WHAT changed, never on WHICH REF. Over
// 758 lifetime runs, 89 ran from a non-main ref and 35 of those successfully
// ran `supabase functions deploy` against xrzweoneiieddzxogewk — production —
// from branches whose PRs were still open. Run 30484091022 (pull_request,
// fix/audit-batch2, 2026-07-29) deployed the ENTIRE function set off unmerged
// code. It landed 35 times; this is not a near miss.
//
// RE-MEASURED 2026-09-21 before this shipped, and the count above was the only
// leg the first draft named. THREE commands write to prod from this workflow and
// TWO of them had already fired from a non-main ref:
//   supabase functions deploy  35 successes
//   supabase secrets set        2 successes (runs 33531886227 / 33548643802,
//                               pull_request, codex/apex-imo-vsl-rewrite-20260901)
//                               — that is APEX_BOT_TOKEN and
//                               BOT_SQL_PERSISTENT_TOKEN written into the prod
//                               project from unmerged code
//   supabase db push            0 applied; 3 runs reached it and all three
//                               logged "Remote database is up to date" because
//                               migrations are hand-applied via bot-sql before
//                               CI sees them. An accident of Sam's workflow, not
//                               a safety property — which is precisely why it is
//                               gated too.
//
// WHAT THIS GUARD GRADES: the CLASS, not the three instances. Any step in this
// workflow whose script writes to prod must carry the single-sourced
// `steps.scope.outputs.write_allowed` gate. A future step added with a fourth
// write command and no gate is the regression this catches.
//
// TWO WAYS THE OBVIOUS VERSION GETS IT WRONG, both already paid for by this
// repo:
//
//  1. A RAW-SOURCE grep counts its own footnotes. MP-277 shipped a ratchet that
//     matched ".maybeSingle()" inside code COMMENTS, so three comment mentions
//     inflated the baseline and every later wave could hold the count flat by
//     documenting a site while fixing nothing. The comment block directly above
//     — inside a `run:` body — contains the literal string
//     "supabase functions deploy". Scanning raw text flags the scope step,
//     which writes nothing. Bash comments are stripped before matching.
//
//  2. Grading only "is the gate present" lets the gate be turned off at the
//     SOURCE. If nothing ever sets write_allowed=true, every `if` is false,
//     every deploy silently stops, and this guard still reports green — the
//     "fix that stopped the false alarms also switched the alarm off" failure
//     (MP a3fa21b4). So the producer is graded too: the scope step must define
//     write_allowed AND still grant it for push-to-main.

const WF = ".github/workflows/deploy-supabase.yml";
const GATE = "steps.scope.outputs.write_allowed == 'true'";

// Commands that mutate the live Supabase project. Add to this list, never
// remove: a removal silently widens what may write to prod ungated.
const WRITE_CMDS = [
  "supabase functions deploy",
  "supabase functions delete",
  "supabase secrets set",
  "supabase secrets unset",
  "supabase db push",
];

// Strip bash comments so the guard cannot match its own prose. Only whole-line
// comments are removed.
const stripBashComments = (src) =>
  src
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");

// ── WHY COMMAND POSITION, NOT SUBSTRING ─────────────────────────────────────
// Stripping comments is not enough, and this guard proved it on its own first
// run: it accused "Deploy credential ALIVE? (present != working)" — a READ-ONLY
// capability probe — because that step echoes the sentence
//   "`SUPABASE_ACCESS_TOKEN` lacks the secrets scope, so `supabase secrets set`
//    was skipped."
// The command name appears in a MESSAGE, not as a command. That is MP-277's
// footnote bug one layer over (a ratchet counting ".maybeSingle()" inside
// comments) and MP-282's (a harness matching "launchctl" inside an error
// string). A guard that accuses working code is one nobody reads.
//
// So an occurrence only counts as a WRITE when it sits in command position:
// start of a line, or immediately after a shell operator/keyword that begins a
// new command. Anything else is a MENTION.
//
// MENTIONS ARE REPORTED, NEVER LAUNDERED. The one way this could produce a
// false PASS is a write smuggled through an exec wrapper —
// `bash -c "supabase db push …"`. That is a real blind spot, so mentions are
// printed on every run rather than dropped, and a human can see the string the
// guard declined to grade. Silence is what makes a blind spot dangerous.
// `if` / `elif` / `while` / `until` are load-bearing in this list. Leaving them
// out is not a theoretical gap — it was this guard's SECOND defect, caught by
// reading its output instead of trusting the green: both real writers are
// written `if supabase functions deploy "$name" …; then`, so without `if` the
// matcher graded ZERO real writes, reported "✓ gate intact", and listed the two
// steps that caused the 35 prod deploys as harmless "mentions". A guard whose
// matcher silently empties its own population prints a confident wrong zero —
// the MP-399 failure, where a dead `status='error'` filter matched no rows and
// the check printed green for its entire life. The positive control below
// exists so that can never be silent again.
const CMD_POSITION = (cmd) =>
  new RegExp(
    `(^|[;&|(]|\\b(?:if|elif|then|else|fi|do|while|until|not)\\b|!)\\s*(?:sudo\\s+)?${cmd.replace(/ /g, "\\s+")}`,
    "m",
  );

const doc = yaml.load(readFileSync(WF, "utf8"));
const problems = [];
const gated = [];
const noted = [];

for (const [jobName, job] of Object.entries(doc.jobs ?? {})) {
  for (const step of job.steps ?? []) {
    if (typeof step.run !== "string") continue;
    const body = stripBashComments(step.run);
    const present = WRITE_CMDS.filter((c) => body.includes(c));
    if (present.length === 0) continue;
    const hits = present.filter((c) => CMD_POSITION(c).test(body));
    const mentions = present.filter((c) => !CMD_POSITION(c).test(body));
    const label = `${jobName} › ${step.name ?? "(unnamed step)"}`;
    if (mentions.length) noted.push(`${label}  names but does not run: ${mentions.join(", ")}`);
    if (hits.length === 0) continue;
    const cond = step.if ?? "";
    if (cond.includes(GATE)) gated.push(`${label}  [${hits.join(", ")}]`);
    else problems.push(`${label}\n      writes: ${hits.join(", ")}\n      if:     ${cond || "(none — runs on every trigger)"}`);
  }
}

// Direction 2: the producer must exist and must still grant on push-to-main.
const rawScope =
  (doc.jobs?.deploy?.steps ?? []).find((s) => s.id === "scope")?.run ?? "";
// Anchored on the actual COMPARISON, not on the string "refs/heads/main".
// Third footnote-match of this wave, and the only one that produced a false
// PASS: a mutation repointing the grant at refs/heads/NOPE was acquitted,
// because "refs/heads/main" still appeared in this step's comment block AND in
// the human-readable write_block_reason message. Substring presence answers
// "is this text somewhere in the step", never "does the step still grant main".
const scopeCode = stripBashComments(rawScope);
const producerOk =
  scopeCode.includes("write_allowed=$write_allowed") &&
  /\$THIS_REF"?\s*=\s*"?refs\/heads\/main/.test(scopeCode) &&
  /^\s*write_allowed=true\s*$/m.test(scopeCode);

// ── POSITIVE CONTROL ────────────────────────────────────────────────────────
// A shape gate cannot catch a confident wrong zero. If a future edit to
// CMD_POSITION or WRITE_CMDS stops recognising a command that IS in this
// workflow, the graded population silently empties and every verdict below
// turns green while nothing is actually checked. These three commands are known
// to be run by this workflow; if any is no longer detected in command position
// anywhere, the matcher — not the workflow — is what broke.
const MUST_DETECT = ["supabase functions deploy", "supabase secrets set", "supabase db push"];
const allRun = (doc.jobs?.deploy?.steps ?? [])
  .filter((s) => typeof s.run === "string")
  .map((s) => stripBashComments(s.run))
  .join("\n");
const undetected = MUST_DETECT.filter((c) => !CMD_POSITION(c).test(allRun));

let rc = 0;
if (undetected.length) {
  rc = 1;
  console.error(`\n✖ matcher regression — these commands are run by ${WF} but are no`);
  console.error(`   longer detected in command position: ${undetected.join(", ")}`);
  console.error(`   The graded population has silently shrunk. Every "gated" verdict in`);
  console.error(`   this run is therefore unearned. Fix CMD_POSITION/WRITE_CMDS, not the`);
  console.error(`   workflow. (If a command was deliberately removed from the workflow,`);
  console.error(`   remove it from MUST_DETECT in the same commit, on purpose.)\n`);
}
if (problems.length) {
  rc = 1;
  console.error(`\n✖ ${problems.length} prod-writing step(s) in ${WF} are not ref-gated:\n`);
  for (const p of problems) console.error(`   - ${p}\n`);
  console.error(`   Each must AND in: ${GATE}`);
  console.error(`   Ungated, they write to prod from any ref the triggers accept —`);
  console.error(`   which is how 35 unmerged branches deployed functions to prod.\n`);
}
if (!producerOk) {
  rc = 1;
  console.error(`\n✖ ${WF}: the 'scope' step no longer produces a usable write_allowed.`);
  console.error(`   Every gated step would then be permanently false and deploys would`);
  console.error(`   stop SILENTLY while this guard reported green. Producer must set`);
  console.error(`   write_allowed, grant it for refs/heads/main, and emit it to GITHUB_OUTPUT.\n`);
}
if (rc === 0) {
  console.log(`✓ deploy write-ref gate intact — ${gated.length} prod-writing step(s), all gated on write_allowed:`);
  for (const g of gated) console.log(`    ${g}`);
  console.log(`  producer: scope step defines write_allowed and still grants push→refs/heads/main`);
  if (noted.length) {
    console.log(`  mentions (named in a message/comment, not run — reported, not graded):`);
    for (const n of noted) console.log(`    ${n}`);
  }
}
process.exit(rc);
