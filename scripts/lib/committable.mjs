// MP-457. Which files a guard is entitled to answer for.
//
// This box runs several workers against ONE checkout. Guards here walk the
// whole working tree, so a file that is untracked AND unstaged -- another
// worker mid-wave, in nobody's index -- fails every other worker's commit.
// The two escapes that leaves are `git add -A` (absorption: the documented
// failure mode of this environment) and --no-verify (skipping the gate).
// MP-403 moved a guard's verdict off the working tree and onto the index for
// exactly this reason; this is that rule, single-sourced so two call sites
// cannot drift the way curl's --max-time and fn_agentlink_reap_stuck did.
//
// This does NOT narrow coverage of anything committable: a NEW file is graded
// the moment it is staged, and a tracked file is graded always. Callers must
// still PRINT what they skipped -- silently dropping another worker's real
// defect is the fake-success disease wearing a politeness costume.
import { execFileSync } from "node:child_process";

/**
 * Paths (repo-relative, forward slashes) that are untracked AND unstaged.
 * Returns an EMPTY set if git is unavailable or fails, so the conservative
 * direction is "grade everything" — a guard that quietly stops grading because
 * a subprocess failed is worse than one that is occasionally too strict.
 */
export function uncommittablePaths(cwd = process.cwd()) {
  try {
    const others = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], {
      cwd, encoding: "utf8",
    }).split("\n").filter(Boolean);
    const staged = new Set(
      execFileSync("git", ["diff", "--cached", "--name-only"], { cwd, encoding: "utf8" })
        .split("\n").filter(Boolean),
    );
    return new Set(others.filter((f) => !staged.has(f)));
  } catch {
    return new Set();
  }
}

/** Split findings into [graded, notices] on a repo-relative path extractor. */
export function splitUncommittable(findings, pathOf, cwd = process.cwd()) {
  const skip = uncommittablePaths(cwd);
  if (skip.size === 0) return [findings, []];
  const graded = [], notices = [];
  for (const f of findings) (skip.has(pathOf(f)) ? notices : graded).push(f);
  return [graded, notices];
}

/** The banner every caller prints, so the wording cannot drift either. */
export function noticeBanner(n) {
  return [
    `\n  NOTICE — ${n} finding(s) in untracked, unstaged files (another worker's`,
    "  in-flight tree). Not graded here because they are in no commit; they will be",
    "  graded the moment that worker stages them.",
  ].join("\n");
}
