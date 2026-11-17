#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

// check-guard-failure-paging — MP-WIB-GUARD-PAGING (2026-11-17)
//
// This repo runs ~12 SCHEDULED live-surface guards every day (robots-indexable-
// live, funnel-share-card-live, lead-magnet-cta-live, vsl-media, hero-carrier-
// count-live, share-card-live, brand-static-live, crawl-entrypoints-live,
// apply-form-render, edge-boot, funnel-capture, Vantage production sync). Each
// fetches the LIVE public funnel to catch drift between deploys. When one FAILED,
// its only trace was a red X in the GitHub Actions tab and an `echo "::warning::"`
// annotation. Sam runs the business from his phone and the entire APEX alert
// stack is ntfy — external-cron-backup.yml was the ONLY workflow in the repo that
// ever pushed to his phone. A guard whose failure reaches no phone is a silent
// guard: it fires, catches the money defect (a dead sell4daddy door, a deindexed
// funnel, a broken og:image, a 404 VSL), and the finding dies in a tab nobody
// opens.
//
// notify-guard-failure.yml is the single phone-exit: a workflow_run listener that
// pages ntfy when any listed guard fails. THIS guard keeps that exit complete.
// The contract, stated precisely so it can never go fuzzy:
//
//   Every workflow that runs on a SCHEDULE and does NOT page ntfy itself MUST be
//   named in notify-guard-failure.yml's `workflows:` list, and every name in that
//   list MUST match an existing workflow. A future scheduled guard therefore
//   cannot ship without a phone exit, and a renamed/typo'd watch (which silently
//   watches nothing) is caught.
//
// WHICH TREE IS THE QUESTION ABOUT (the MP-403 lesson, same as check-guard-
// wiring): CI checks out HEAD. The population and the wiring are both read from
// the git INDEX (HEAD + staged), never the raw working directory, so an untracked
// WIP workflow from a concurrent wave is neither falsely flagged nor able to
// satisfy the contract until it is actually staged — exactly what CI will see.
//
// Could-not-look is never a pass: if git is unreachable, or the workflows dir is
// empty in the index, this exits 1 rather than reporting a clean tree.

const SELFTEST = process.argv.includes("--selftest");
const NOTIFIER = "notify-guard-failure.yml";

// ───────────────────────── pure analysis (shared by live + selftest) ─────────

function parseName(text) {
  const m = String(text).match(/^name:\s*(.+?)\s*$/m);
  return m ? m[1].replace(/^["']|["']$/g, "").trim() : null;
}

function hasSchedule(text) {
  const t = String(text);
  // block form `schedule:` with a `- cron:` child; either token alone is enough.
  return /^\s*schedule:\s*$/m.test(t) || /^\s*-\s*cron:/m.test(t);
}

function selfPages(text) {
  return /ntfy\.sh/.test(String(text));
}

// Extract the `- <name>` entries under the notifier's `workflows:` key, by
// indentation: items sit deeper than `workflows:`; the first line at or below
// that indent (e.g. `types:`) ends the list. Names may contain spaces.
function parseWatched(notifierText) {
  const lines = String(notifierText).split("\n");
  const idx = lines.findIndex((l) => /^\s*workflows:\s*$/.test(l));
  if (idx < 0) return { names: [], present: false };
  const baseIndent = lines[idx].match(/^\s*/)[0].length;
  const names = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    const indent = line.match(/^\s*/)[0].length;
    const item = line.match(/^\s*-\s+(.+?)\s*$/);
    if (item && indent > baseIndent) {
      names.push(item[1].replace(/^["']|["']$/g, "").trim());
      continue;
    }
    if (indent <= baseIndent) break; // next key at/below workflows: — list over
    if (!item) break;
  }
  return { names, present: true };
}

// workflows: [{file, name, hasSchedule, selfPages}] EXCLUDING the notifier.
// Returns a list of problem strings ([] = clean).
function analyze({ notifierPresent, notifierText, workflows }) {
  const problems = [];
  if (!notifierPresent) {
    problems.push(
      `${NOTIFIER} is missing — there is no phone exit for any scheduled guard. ` +
        `Restore it or the daily live-surface guards fail silently again.`,
    );
    return problems;
  }
  if (!selfPages(notifierText)) {
    problems.push(`${NOTIFIER} never POSTs to ntfy.sh — it cannot page; the phone exit is a no-op.`);
  }
  const { names: watched, present } = parseWatched(notifierText);
  if (!present || watched.length === 0) {
    problems.push(`${NOTIFIER} has no workflow_run.workflows list — it watches nothing.`);
    return problems;
  }
  const watchedSet = new Set(watched);
  const allNames = new Set(workflows.map((w) => w.name).filter(Boolean));

  // (1) every SILENT scheduled workflow must have a phone exit.
  for (const w of workflows) {
    if (!w.hasSchedule || w.selfPages) continue;
    if (!w.name) {
      problems.push(`${w.file} runs on a schedule but has no parseable \`name:\` — the notifier cannot match it.`);
    } else if (!watchedSet.has(w.name)) {
      problems.push(
        `${w.file} ("${w.name}") runs on a schedule and never pages ntfy itself, but is NOT listed in ` +
          `${NOTIFIER} — a silent guard with no phone exit. Add "${w.name}" to its workflow_run.workflows list.`,
      );
    }
  }

  // (2) no stale watch — a renamed/typo'd name silently watches nothing.
  for (const n of watched) {
    if (!allNames.has(n)) {
      problems.push(
        `${NOTIFIER} watches "${n}" but no workflow declares that \`name:\` — a stale/typo entry that pages for nothing. ` +
          `Fix the name or remove it.`,
      );
    }
  }
  return problems;
}

// ───────────────────────── selftest: prove both directions ───────────────────

function runSelftest() {
  const mk = (name, { sched = false, ntfy = false } = {}) =>
    `name: ${name}\non:\n${sched ? "  schedule:\n    - cron: \"0 14 * * *\"\n" : "  push:\n"}${
      ntfy ? "jobs:\n  go:\n    steps:\n      - run: curl https://ntfy.sh/x -d hi\n" : "jobs:\n  go:\n    steps:\n      - run: echo hi\n"
    }`;

  const notifier = (watched) =>
    `name: notify-guard-failure\non:\n  workflow_run:\n    workflows:\n${watched
      .map((w) => `      - ${w}`)
      .join("\n")}\n    types: [completed]\njobs:\n  page:\n    steps:\n      - run: curl https://ntfy.sh/topic -d page\n`;

  const toWf = (file, text) => ({
    file,
    name: parseName(text),
    hasSchedule: hasSchedule(text),
    selfPages: selfPages(text),
  });

  const cases = [];

  // A — clean: two silent scheduled guards, both watched; one self-pager; one
  //     non-scheduled silent workflow (must NOT be required).
  {
    const wfs = [
      toWf("guard-a.yml", mk("guard-a", { sched: true })),
      toWf("guard-b.yml", mk("guard-b", { sched: true })),
      toWf("selfpager.yml", mk("selfpager", { sched: true, ntfy: true })),
      toWf("on-push.yml", mk("on-push", {})), // not scheduled -> not required
    ];
    const problems = analyze({ notifierPresent: true, notifierText: notifier(["guard-a", "guard-b"]), workflows: wfs });
    cases.push(["clean set passes", problems.length === 0, problems]);
  }

  // B — a silent scheduled guard is NOT in the notifier -> must fail, naming it.
  {
    const wfs = [
      toWf("guard-a.yml", mk("guard-a", { sched: true })),
      toWf("guard-c.yml", mk("guard-c", { sched: true })), // silent, unwatched
    ];
    const problems = analyze({ notifierPresent: true, notifierText: notifier(["guard-a"]), workflows: wfs });
    cases.push([
      "unwatched silent scheduled guard fails",
      problems.some((p) => p.includes("guard-c.yml") && p.includes("no phone exit")),
      problems,
    ]);
  }

  // C — a stale watched name (no such workflow) -> must fail.
  {
    const wfs = [toWf("guard-a.yml", mk("guard-a", { sched: true }))];
    const problems = analyze({ notifierPresent: true, notifierText: notifier(["guard-a", "ghost"]), workflows: wfs });
    cases.push(["stale watched name fails", problems.some((p) => p.includes("\"ghost\"") && p.includes("stale")), problems]);
  }

  // D — notifier present but never pages ntfy -> must fail.
  {
    const noNtfy =
      "name: notify-guard-failure\non:\n  workflow_run:\n    workflows:\n      - guard-a\n    types: [completed]\njobs:\n  page:\n    steps:\n      - run: echo nope\n";
    const wfs = [toWf("guard-a.yml", mk("guard-a", { sched: true }))];
    const problems = analyze({ notifierPresent: true, notifierText: noNtfy, workflows: wfs });
    cases.push(["notifier that cannot page fails", problems.some((p) => p.includes("cannot page")), problems]);
  }

  // E — notifier missing entirely -> must fail.
  {
    const problems = analyze({ notifierPresent: false, notifierText: "", workflows: [] });
    cases.push(["missing notifier fails", problems.some((p) => p.includes("missing")), problems]);
  }

  // F — a scheduled guard that pages ITSELF (like external-cron-backup) is NOT
  //     required to be in the list (anti-FP).
  {
    const wfs = [toWf("selfpager.yml", mk("selfpager", { sched: true, ntfy: true }))];
    const problems = analyze({ notifierPresent: true, notifierText: notifier(["guard-a"]), workflows: wfs });
    // "guard-a" is stale here (no such wf), so expect ONLY the stale problem, not a selfpager one.
    cases.push([
      "self-paging scheduled guard is exempt",
      !problems.some((p) => p.includes("selfpager")),
      problems,
    ]);
  }

  let ok = true;
  for (const [label, pass, detail] of cases) {
    console.log(`${pass ? "✓" : "✗"} selftest: ${label}`);
    if (!pass) {
      ok = false;
      console.error(`    problems were: ${JSON.stringify(detail)}`);
    }
  }
  if (!ok) {
    console.error("✗ check:guard-failure-paging selftest FAILED — the detector itself regressed.");
    process.exit(1);
  }
  console.log("✓ check:guard-failure-paging selftest — detector proven in both directions.");
  process.exit(0);
}

if (SELFTEST) runSelftest();

// ───────────────────────── live run: read the INDEX ──────────────────────────

const root = resolve(import.meta.dirname, "..");
const git = (args) => {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
};

if (git(["rev-parse", "--git-dir"]) === null) {
  console.error("✗ check:guard-failure-paging — cannot run git, so 'what will this commit ship' is UNKNOWN.");
  console.error("  Refusing to read the working directory instead (the MP-403 substitution). Fix git, do not skip.");
  process.exit(1);
}

const indexRead = (p) => git(["show", `:${p}`]);
const wfFiles = (git(["ls-files", ".github/workflows/*.yml"]) ?? "")
  .split("\n")
  .filter(Boolean);

if (wfFiles.length === 0) {
  console.error("✗ check:guard-failure-paging — no workflow files in the index; refusing to report a clean tree.");
  process.exit(1);
}

const notifierPath = `.github/workflows/${NOTIFIER}`;
const notifierText = indexRead(notifierPath);
const notifierPresent = notifierText !== null;

const workflows = wfFiles
  .filter((p) => p !== notifierPath)
  .map((p) => {
    const text = indexRead(p) ?? "";
    return {
      file: p.replace(/^\.github\/workflows\//, ""),
      name: parseName(text),
      hasSchedule: hasSchedule(text),
      selfPages: selfPages(text),
    };
  });

const problems = analyze({ notifierPresent, notifierText: notifierText ?? "", workflows });

if (problems.length) {
  console.error("✗ check:guard-failure-paging — scheduled guard(s) with no exit to Sam's phone:\n");
  for (const p of problems) console.error(`  • ${p}`);
  console.error(
    `\n  Fix: list every silent scheduled guard in ${notifierPath} (workflow_run.workflows), or give the guard its own ntfy push.`,
  );
  process.exit(1);
}

// Healthy: print WHAT was verified so a green run is never blank-green.
const { names: watched } = parseWatched(notifierText);
const silentScheduled = workflows.filter((w) => w.hasSchedule && !w.selfPages);
console.log(
  `✓ check:guard-failure-paging — ${silentScheduled.length} silent scheduled guard(s) all have a phone exit via ${NOTIFIER} ` +
    `(${watched.length} watched): ${silentScheduled.map((w) => w.name).sort().join(", ")}`,
);
process.exit(0);
