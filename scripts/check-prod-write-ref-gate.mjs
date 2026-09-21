import { readFileSync, readdirSync, existsSync } from "node:fs";
import yaml from "js-yaml";

// check-prod-write-ref-gate — MP-603 (2026-09-21)
// Supersedes check-deploy-write-ref-gate (MP-602), whose own handoff named the
// two limits this closes.
//
// MP-602 proved the bug: deploy-supabase.yml's three prod-writing steps were
// gated on WHAT changed and never on WHICH REF, and over 758 runs, 35 branches
// with open PRs successfully ran `supabase functions deploy` against
// xrzweoneiieddzxogewk — production. It shipped a guard, and closed by naming
// its own blind spot: the guard reads ONE file by name.
//
// THAT HANDOFF'S PRESCRIBED FIX IS INERT, AND WAS MEASURED BEFORE THIS WAS
// WRITTEN. It said "widening to every .github/workflows/*.yml is the real fix"
// and named auto-register-functions.yml and vantage-production-sync.yml as the
// unaudited writers. Running exactly that widening — the same five `supabase`
// command strings over all 8 workflow files — finds ZERO new steps. The file
// list was never what was narrow.
//
//   auto-register-functions.yml does not write to prod AT ALL. Its only write
//   is `git push` to this repo. Both of its non-main runs (33548643873,
//   33531888670, pull_request, codex/apex-imo-vsl-rewrite-20260901) SKIPPED
//   that step: changed=false. It is not in this class.
//
//   vantage-production-sync.yml DOES write to prod, and contains the string
//   "xrzweoneiieddzxogewk" ZERO times. The write is
//   `insert into public.production_external_daily_snapshots ... on conflict
//   do update`, POSTed to bot-sql inside scripts/sync-vantage-production.ts.
//   No amount of scanning workflow YAML for `supabase ...` can see it.
//
// SO THE NARROW THING WAS THE VOCABULARY, NOT THE FILE LIST. This repo writes
// to prod through TWO channels — the supabase CLI, and an authenticated POST to
// bot-sql carrying SQL — and the guard knew one of them. external-cron-backup
// .yml uses the second channel too and was equally invisible.
//
// ── WHY THIS IS A CENSUS AND NOT A PATTERN MATCH ────────────────────────────
// A third write channel will be added one day, and a vocabulary guard cannot
// know about a verb nobody has taught it — it prints a confident green. That is
// MP-399, where a dead `status='error'` filter matched no rows and the check
// was green for its entire life.
//
// So the population is defined by REACHING PRODUCTION, not by the verb: a step
// is PROD-TOUCHING if it names the prod project ref, or invokes a repo file
// that does, or runs a supabase write subcommand. Every prod-touching step must
// be classified in .github/prod-write-census.json as "read" or "write". A new
// one that nobody classified is RED — the guard does not have to recognise the
// verb, only that the step can reach prod.
//
// Keyed on file::job::step, never on a COUNT. MP-356: a count-only floor is
// fungible — a real regression sat red for 8 commits and was then laundered
// green by an unrelated pay-down. A stale census entry is RED for the same
// reason: without that, a write step could be deleted and its "write" slot
// reused by something else.
//
// ── WHAT "GATED" MEANS, AND WHY TWO FORMS ARE ACCEPTED ──────────────────────
// deploy-supabase.yml has a `scope` step that single-sources the decision into
// steps.scope.outputs.write_allowed; that is MP-602's shipped form and grading
// it also grades the producer. The other two workflows have no scope step, so
// requiring that expression there would demand they grow one. They may instead
// gate directly on github.ref. Both are accepted; neither is optional.
//
// ── REACHABILITY: WHY A GATE IS NOT ALWAYS REQUIRED ─────────────────────────
// A guard that demands a ref gate on a workflow that cannot run from a non-main
// ref is the permanently-pointless guard this codebase has shipped five times
// (36 false pages/day -> a gate that could not cry -> true-but-misleading ->
// permanent Stripe CRITICAL). `schedule` fires ONLY on the default branch —
// measured, not assumed: vantage-production-sync is 100/100 schedule/main and
// external-cron-backup is 200/200 schedule/main, zero non-main runs between
// them. So schedule alone requires no gate.
//
// `workflow_dispatch` DOES admit any ref (`gh workflow run --ref feat/x`), and
// that is the live exposure on both: a human could dispatch either from an
// unmerged branch and it would write production data using unmerged code. That
// is LATENT — it has never happened — and this guard is prevention, not
// recovered money. Said plainly because 35 prod deploys from unmerged branches
// in the same repo is why the cheap gate is worth its one line.

const WF_DIR = ".github/workflows";
const CENSUS_PATH = ".github/prod-write-census.json";
const PROD_REF = "xrzweoneiieddzxogewk";

const GATE_SCOPED = "steps.scope.outputs.write_allowed == 'true'";
const GATE_DIRECT = "github.ref == 'refs/heads/main'";

// Commands that mutate the live Supabase project. Add to this list, never
// remove: a removal silently widens what may write to prod ungated.
const WRITE_CMDS = [
  "supabase functions deploy",
  "supabase functions delete",
  "supabase secrets set",
  "supabase secrets unset",
  "supabase db push",
];

// Strip bash comments so the guard cannot match its own prose. MP-277 shipped a
// ratchet that matched ".maybeSingle()" inside code COMMENTS; three comment
// mentions inflated its baseline and every later wave could hold the count flat
// by documenting a site while fixing nothing.
const stripBashComments = (src) =>
  src.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

// An occurrence only counts as a WRITE when it sits in command position: start
// of a line, or straight after a shell operator/keyword beginning a new
// command. MP-602's first run accused a READ-ONLY credential probe because it
// echoes the sentence "`supabase secrets set` was skipped" in a message.
//
// `if`/`elif`/`while`/`until` are load-bearing here. Leaving them out was that
// guard's SECOND defect: both real writers are written
// `if supabase functions deploy "$name" …; then`, so without `if` the matcher
// graded ZERO real writes and reported "gate intact".
const CMD_POSITION = (cmd) =>
  new RegExp(
    `(^|[;&|(]|\\b(?:if|elif|then|else|fi|do|while|until|not)\\b|!)\\s*(?:sudo\\s+)?${cmd.replace(/ /g, "\\s+")}`,
    "m",
  );

// MP-602 named this blind spot and left it open: a write smuggled through
// `bash -c "supabase db push …"` is not in command position. Unwrapping the
// payload of an exec wrapper and re-scanning it closes the route it named.
// Anything still not in command position after this is reported as a MENTION —
// printed, never dropped. Silence is what makes a blind spot dangerous.
const unwrapExec = (src) => {
  const parts = [src];
  for (const m of src.matchAll(/\b(?:ba|z|k)?sh\s+-[a-z]*c\s+(['"])([\s\S]*?)\1/g)) parts.push(m[2]);
  return parts.join("\n");
};

// EXECUTABLE scripts only. The first cut also matched .toml/.sql and accused
// four innocent steps: supabase/config.toml carries `project_id =
// "xrzweoneiieddzxogewk"`, so every step that merely edits or commits that file
// looked like it reached prod. config.toml is DATA the supabase CLI consumes,
// not a write channel — and any CLI call that consumes it is already caught in
// command position by WRITE_CMDS, so dropping the extension hides nothing. A
// guard that accuses working code is one nobody reads (MP-277/MP-282).
const repoFilesIn = (body) =>
  [...new Set(
    [...body.matchAll(/(?:^|[\s"'`(])((?:scripts|supabase|src|\.github)\/[A-Za-z0-9_\-./]+\.(?:ts|mjs|js|sh))/g)]
      .map((m) => m[1]),
  )].filter((p) => existsSync(p));

// ── THIRD ROUTE: PROD REACHED THROUGH AN ENV VAR ───────────────────────────
// Caught by reading this guard's own output against external-cron-backup.yml
// rather than trusting its green. That workflow sets, at JOB level,
//   BOT_SQL: https://xrzweoneiieddzxogewk.supabase.co/functions/v1/bot-sql
// so a step whose body only ever says "$BOT_SQL" reaches prod while naming
// nothing. The first cut flagged `Fire critical jobs` (which also inlines the
// URL on one line) and MISSED `Check pg_cron heartbeat`, which uses the
// variable alone. A population that quietly omits a member is the confident
// wrong zero this guard's control exists to prevent — so env values are
// resolved to their names and those names are matched in step bodies.
const prodEnvNames = (doc, jobDef, step) => {
  const names = new Set();
  for (const src of [doc.env, jobDef.env, step.env]) {
    for (const [k, v] of Object.entries(src ?? {}))
      if (typeof v === "string" && v.includes(PROD_REF)) names.add(k);
  }
  return [...names];
};
const usesEnv = (body, name) => new RegExp(`\\$\\{?${name}\\b`).test(body);

// ── TRIGGER REACHABILITY ────────────────────────────────────────────────────
// `on:` is the YAML 1.1 boolean `true` after parsing unless quoted, so both
// spellings are read. Anything unrecognised coerces TOWARD alarm (assume a
// non-main ref is reachable) — MP-282: a garbled operand that coerces toward
// ACQUIT is how a false green is manufactured.
const nonMainReachable = (doc) => {
  const on = doc.on ?? doc[true];
  if (!on || typeof on !== "object") return { reachable: true, why: "triggers unparseable — assuming reachable" };
  const why = [];
  if ("workflow_dispatch" in on) why.push("workflow_dispatch (any ref selectable)");
  if ("pull_request" in on || "pull_request_target" in on) why.push("pull_request");
  if ("push" in on) {
    const br = on.push?.branches;
    if (!br) why.push("push (no branch filter — every branch)");
    else if (br.some((b) => b !== "main")) why.push(`push branches ${JSON.stringify(br)}`);
  }
  return { reachable: why.length > 0, why: why.join(", ") || "schedule only — default branch by construction" };
};

// ── SCAN ────────────────────────────────────────────────────────────────────
const wfFiles = readdirSync(WF_DIR).filter((f) => /\.ya?ml$/.test(f)).sort();
const found = new Map(); // key -> {file, job, step, writeCmds, mentions, reason, cond, reach}
const mentionsOut = [];

for (const file of wfFiles) {
  const doc = yaml.load(readFileSync(`${WF_DIR}/${file}`, "utf8"));
  const reach = nonMainReachable(doc);
  for (const [job, jobDef] of Object.entries(doc.jobs ?? {})) {
    for (const step of jobDef.steps ?? []) {
      if (typeof step.run !== "string") continue;
      const name = step.name ?? "(unnamed step)";
      const body = unwrapExec(stripBashComments(step.run));

      const present = WRITE_CMDS.filter((c) => body.includes(c));
      const cmds = present.filter((c) => CMD_POSITION(c).test(body));
      const mentions = present.filter((c) => !CMD_POSITION(c).test(body));

      const direct = body.includes(PROD_REF);
      const viaFile = repoFilesIn(body).filter((p) => readFileSync(p, "utf8").includes(PROD_REF));
      const viaEnv = prodEnvNames(doc, jobDef, step).filter((n) => usesEnv(body, n));

      const label = `${file}::${job}::${name}`;
      if (mentions.length) mentionsOut.push(`${label}  names but does not run: ${mentions.join(", ")}`);
      if (!cmds.length && !direct && !viaFile.length && !viaEnv.length) continue;

      const reason = [
        cmds.length ? `runs ${cmds.join(", ")}` : null,
        direct ? `names ${PROD_REF}` : null,
        viaFile.length ? `invokes ${viaFile.join(", ")} (which names ${PROD_REF})` : null,
        viaEnv.length ? `uses env ${viaEnv.map((n) => "$" + n).join(", ")} (set to a ${PROD_REF} URL)` : null,
      ].filter(Boolean).join("; ");

      found.set(label, { file, job, name, cmds, reason, cond: step.if ?? "", reach });
    }
  }
}

// ── CENSUS ──────────────────────────────────────────────────────────────────
if (!existsSync(CENSUS_PATH)) {
  console.error(`\n✖ ${CENSUS_PATH} is missing. Every prod-touching CI step must be`);
  console.error(`   classified read/write there. Refusing to grade an unknown population.\n`);
  process.exit(1);
}
const census = JSON.parse(readFileSync(CENSUS_PATH, "utf8"));
const classified = new Map(Object.entries(census.steps ?? {}));

const unclassified = [...found.keys()].filter((k) => !classified.has(k));
const stale = [...classified.keys()].filter((k) => !found.has(k));

const ungated = [];
const gated = [];
const mainOnly = [];
for (const [key, f] of found) {
  const entry = classified.get(key);
  if (!entry) continue;
  if (entry.classification !== "write") continue;
  if (!f.reach.reachable) { mainOnly.push(`${key}  [${f.reach.why}]`); continue; }
  const ok = f.cond.includes(GATE_SCOPED) || f.cond.includes(GATE_DIRECT);
  if (ok) gated.push(`${key}  [${f.reason}]`);
  else ungated.push(`${key}\n      reaches prod by: ${f.reason}\n      non-main ref via: ${f.reach.why}\n      if: ${f.cond || "(none — runs on every trigger)"}`);
}

// ── PRODUCER (only for workflows that use the single-sourced form) ──────────
const producerProblems = [];
for (const file of new Set([...found.values()].filter((f) => f.cond.includes(GATE_SCOPED)).map((f) => f.file))) {
  const doc = yaml.load(readFileSync(`${WF_DIR}/${file}`, "utf8"));
  const raw = Object.values(doc.jobs ?? {}).flatMap((j) => j.steps ?? []).find((s) => s.id === "scope")?.run ?? "";
  const code = stripBashComments(raw);
  // Anchored on the actual COMPARISON, not on the string "refs/heads/main":
  // MP-602's third footnote-match, and its only false PASS — a mutation
  // repointing the grant at refs/heads/NOPE was acquitted because the literal
  // still appeared in the step's comment block and in a human-readable message.
  const ok =
    code.includes("write_allowed=$write_allowed") &&
    /\$THIS_REF"?\s*=\s*"?refs\/heads\/main/.test(code) &&
    /^\s*write_allowed=true\s*$/m.test(code);
  if (!ok) producerProblems.push(file);
}

// ── POSITIVE CONTROL ────────────────────────────────────────────────────────
// A shape gate cannot catch a confident wrong zero. If an edit to CMD_POSITION,
// WRITE_CMDS or PROD_REF stops recognising something that IS in these
// workflows, the graded population silently empties and every verdict above
// turns green while nothing is checked. These facts are known-true today; if
// one stops holding, the MATCHER broke, not the workflows.
const allBodies = wfFiles
  .flatMap((f) => Object.values(yaml.load(readFileSync(`${WF_DIR}/${f}`, "utf8")).jobs ?? {}))
  .flatMap((j) => j.steps ?? [])
  .filter((s) => typeof s.run === "string")
  .map((s) => unwrapExec(stripBashComments(s.run)))
  .join("\n");
const MUST_DETECT = ["supabase functions deploy", "supabase secrets set", "supabase db push"];
const undetected = MUST_DETECT.filter((c) => !CMD_POSITION(c).test(allBodies));
// The prod ref must still be findable BOTH ways, because each route has its own
// failure mode: direct (external-cron-backup names it inline) and via an
// invoked repo file (vantage-production-sync names it only inside
// scripts/sync-vantage-production.ts). Losing the second route is what would
// make vantage invisible again — the exact regression this wave exists for.
const routes = [...found.values()];
const controlProblems = [];
if (!routes.some((f) => f.reason.includes(`names ${PROD_REF}`)))
  controlProblems.push("no step detected naming the prod ref DIRECTLY");
if (!routes.some((f) => f.reason.includes("invokes ")))
  controlProblems.push("no step detected reaching the prod ref VIA an invoked repo file");
if (!routes.some((f) => f.reason.includes("uses env ")))
  controlProblems.push("no step detected reaching the prod ref VIA an env var");

let rc = 0;
const die = (lines) => { rc = 1; for (const l of lines) console.error(l); };

if (undetected.length || controlProblems.length) {
  die([
    `\n✖ matcher regression — the guard's own population has shrunk.`,
    ...undetected.map((c) => `   command no longer detected in command position: ${c}`),
    ...controlProblems.map((c) => `   ${c}`),
    `   Every verdict in this run is therefore unearned. Fix the matcher, not the`,
    `   workflows. If a command/route was deliberately removed, remove it from`,
    `   MUST_DETECT / the control in the same commit, on purpose.\n`,
  ]);
}
if (unclassified.length) {
  die([
    `\n✖ ${unclassified.length} CI step(s) can reach production and are not in ${CENSUS_PATH}:\n`,
    ...unclassified.map((k) => `   - ${k}\n       ${found.get(k).reason}\n`),
    `   Classify each as "read" or "write". A "write" must also carry a ref gate`,
    `   if its workflow admits a non-main ref.\n`,
  ]);
}
if (stale.length) {
  die([
    `\n✖ ${stale.length} census entr(y/ies) no longer match any step — remove them:\n`,
    ...stale.map((k) => `   - ${k}`),
    `   A stale entry lets a deleted write's slot be silently reused.\n`,
  ]);
}
if (ungated.length) {
  die([
    `\n✖ ${ungated.length} prod-WRITING step(s) are reachable from a non-main ref and are not gated:\n`,
    ...ungated.map((p) => `   - ${p}\n`),
    `   Each must AND in one of:`,
    `     ${GATE_SCOPED}`,
    `     ${GATE_DIRECT}`,
    `   Ungated, they write to prod from any ref their triggers accept — which is`,
    `   how 35 unmerged branches deployed functions to prod (MP-602).\n`,
  ]);
}
if (producerProblems.length) {
  die([
    `\n✖ ${producerProblems.join(", ")}: the 'scope' step no longer produces a usable`,
    `   write_allowed. Every gated step would be permanently false and deploys`,
    `   would stop SILENTLY while this guard reported green. The producer must set`,
    `   write_allowed, grant it for refs/heads/main, and emit it to GITHUB_OUTPUT.\n`,
  ]);
}

if (rc === 0) {
  console.log(`✓ prod write ref-gate intact — ${found.size} prod-touching step(s) across ${wfFiles.length} workflow(s), all classified:`);
  if (gated.length) { console.log(`  WRITE, non-main ref reachable, gated:`); for (const g of gated) console.log(`    ${g}`); }
  if (mainOnly.length) { console.log(`  WRITE, no gate required:`); for (const m of mainOnly) console.log(`    ${m}`); }
  const reads = [...found.keys()].filter((k) => classified.get(k)?.classification === "read");
  if (reads.length) { console.log(`  READ-only (classified, not gated):`); for (const r of reads) console.log(`    ${r}`); }
  if (producerProblems.length === 0 && gated.some((g) => g.includes("deploy-supabase")))
    console.log(`  producer: scope step defines write_allowed and still grants push→refs/heads/main`);
  if (mentionsOut.length) {
    console.log(`  mentions (named in a message, not run — reported, never graded):`);
    for (const n of mentionsOut) console.log(`    ${n}`);
  }
}
process.exit(rc);
