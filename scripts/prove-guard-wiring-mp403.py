#!/usr/bin/env python3
"""MP-403 proof harness for check-guard-wiring.

Builds a throwaway git repo per case so the real repo's index is never touched.
Every mutation is ASSERTED to have landed before its verdict is believed.
"""
import json, os, shutil, subprocess, sys, tempfile

import pathlib
GUARD_SRC = str(pathlib.Path(__file__).resolve().parent / "check-guard-wiring.mjs")
results = []

def rec(name, passed, detail=""):
    results.append((name, passed, detail))
    print(f"  {'PASS' if passed else 'FAIL'}  {name}   {detail}")

def sh(cwd, *args, check=False):
    return subprocess.run(args, cwd=cwd, capture_output=True, text=True, check=check)

def build(tmp, *, n_guards=45, guard_text=None, wire_all=True):
    """Committed fixture repo: n_guards guards, all wired via verify:core."""
    os.makedirs(f"{tmp}/scripts")
    os.makedirs(f"{tmp}/.husky")
    os.makedirs(f"{tmp}/.github/workflows")
    names = [f"check-fx{i:03d}.mjs" for i in range(n_guards)]
    for nm in names:
        open(f"{tmp}/scripts/{nm}", "w").write("process.exit(0);\n")
    scripts = {f"check:fx{i:03d}": f"node scripts/{nm}" for i, nm in enumerate(names)}
    scripts["verify:core"] = " && ".join(f"npm run --silent check:fx{i:03d}" for i in range(n_guards)) if wire_all else "echo none"
    scripts["check:guard-wiring"] = "node scripts/check-guard-wiring.mjs"
    json.dump({"scripts": scripts}, open(f"{tmp}/package.json", "w"), indent=2)
    open(f"{tmp}/.husky/pre-commit", "w").write("#!/bin/sh\nnpm run --silent check:guard-wiring\n")
    open(f"{tmp}/.github/workflows/verify-core.yml", "w").write("jobs:\n  v:\n    steps:\n      - run: npm run verify:core\n")
    shutil.copy(guard_text or GUARD_SRC, f"{tmp}/scripts/check-guard-wiring.mjs")
    sh(tmp, "git", "init", "-q", "-b", "main")
    sh(tmp, "git", "config", "user.email", "t@t"); sh(tmp, "git", "config", "user.name", "t")
    sh(tmp, "git", "add", "-A"); sh(tmp, "git", "commit", "-qm", "base")
    return names

def run(tmp):
    r = sh(tmp, "node", "scripts/check-guard-wiring.mjs")
    return r.returncode, (r.stdout + r.stderr)

def case(name, fn):
    tmp = tempfile.mkdtemp(prefix="mp403-")
    try:
        fn(tmp, name)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

print("=== BASELINE ===")
def c_base(tmp, name):
    build(tmp)
    rc, out = run(tmp)
    rec("F0 fully-wired committed repo passes", rc == 0 and "all 46 committed guard(s) reachable" in out, f"rc={rc} (45 fixtures + the guard itself)")
case("F0", c_base)

print("=== FAIL DIRECTIONS ===")
def c_orphan(tmp, name):
    build(tmp)
    # a COMMITTED guard that nothing runs
    open(f"{tmp}/scripts/check-orphan.mjs", "w").write("process.exit(0);\n")
    sh(tmp, "git", "add", "scripts/check-orphan.mjs"); sh(tmp, "git", "commit", "-qm", "orphan")
    landed = sh(tmp, "git", "ls-files", "scripts/check-orphan.mjs").stdout.strip() != ""
    rc, out = run(tmp)
    rec("F1 committed orphan FAILS", landed and rc == 1 and "check-orphan.mjs" in out and "run by nothing" in out,
        f"mutation_landed={landed} rc={rc}")
case("F1", c_orphan)

def c_staged_orphan(tmp, name):
    build(tmp)
    # STAGED but not yet committed: the commit-in-progress must be graded
    open(f"{tmp}/scripts/check-staged.mjs", "w").write("process.exit(0);\n")
    sh(tmp, "git", "add", "scripts/check-staged.mjs")
    landed = "scripts/check-staged.mjs" in sh(tmp, "git", "diff", "--cached", "--name-only").stdout
    rc, out = run(tmp)
    rec("F1b STAGED orphan FAILS (graded before commit)", landed and rc == 1 and "check-staged.mjs" in out,
        f"mutation_landed={landed} rc={rc}")
case("F1b", c_staged_orphan)

def c_unstaged_wiring(tmp, name):
    names = build(tmp)
    # guard committed, wiring written on disk only -> orphan in CI, green under MP-351
    open(f"{tmp}/scripts/check-diskwire.mjs", "w").write("process.exit(0);\n")
    sh(tmp, "git", "add", "scripts/check-diskwire.mjs"); sh(tmp, "git", "commit", "-qm", "g")
    pkg = json.load(open(f"{tmp}/package.json"))
    pkg["scripts"]["check:diskwire"] = "node scripts/check-diskwire.mjs"
    pkg["scripts"]["verify:core"] += " && npm run --silent check:diskwire"
    json.dump(pkg, open(f"{tmp}/package.json", "w"), indent=2)
    idx = sh(tmp, "git", "show", ":package.json").stdout
    landed = "check:diskwire" in open(f"{tmp}/package.json").read() and "check:diskwire" not in idx
    rc, out = run(tmp)
    rec("F2 wiring only on disk FAILS (MP-398 direction)",
        landed and rc == 1 and "check-diskwire.mjs" in out and "wired ONLY in the working tree" in out,
        f"mutation_landed={landed} rc={rc}")
case("F2", c_unstaged_wiring)

def c_floor(tmp, name):
    build(tmp, n_guards=5)
    rc, out = run(tmp)
    rec("F4 population floor refuses a small sweep", rc == 1 and "Refusing to report a clean sweep" in out, f"rc={rc}")
case("F4", c_floor)

def c_nogit(tmp, name):
    build(tmp)
    shutil.rmtree(f"{tmp}/.git")
    landed = not os.path.exists(f"{tmp}/.git")
    rc, out = run(tmp)
    rec("F5 no git -> FAILS, never degrades to filesystem",
        landed and rc == 1 and "UNKNOWN" in out, f"mutation_landed={landed} rc={rc}")
case("F5", c_nogit)

print("=== PASS DIRECTION (must not vote) ===")
def c_untracked(tmp, name):
    build(tmp)
    open(f"{tmp}/scripts/check-untracked.mjs", "w").write("process.exit(0);\n")
    landed = "scripts/check-untracked.mjs" in sh(tmp, "git", "status", "--porcelain").stdout
    rc, out = run(tmp)
    rec("F3 untracked guard: notice, does NOT vote",
        landed and rc == 0 and "check-untracked.mjs" in out and "in NO commit" in out,
        f"mutation_landed={landed} rc={rc}")
    rec("F3b untracked notice is printed on the GREEN path too",
        rc == 0 and "protect nothing today" in out, f"rc={rc}")
case("F3", c_untracked)

print("=== MUTATION PROOFS (is the new code load-bearing?) ===")
def c_m1(tmp, name):
    # M1: revert the population to the FILESYSTEM (MP-351 behaviour). The
    # untracked fixture must then go RED -- reproducing the live 18.9h block.
    src = open(GUARD_SRC).read()
    mut = src.replace(
        'const trackedGuards = (git(["ls-files", "scripts/check-*.mjs"]) ?? "")\n  .split("\\n")\n  .filter(Boolean)\n  .map((p) => p.replace(/^scripts\\//, ""))\n  .sort();',
        'const trackedGuards = readdirSync(resolve(root, "scripts")).filter((f) => /^check-.*\\.mjs$/.test(f)).sort();')
    assert mut != src, "M1 mutation did not land in the source text"
    mp = f"{tmp}-m1.mjs"; open(mp, "w").write(mut)
    build(tmp, guard_text=mp)
    open(f"{tmp}/scripts/check-untracked.mjs", "w").write("process.exit(0);\n")
    rc, out = run(tmp)
    os.unlink(mp)
    rec("M1 filesystem population -> untracked file goes RED (the live block)",
        rc == 1 and "check-untracked.mjs" in out, f"rc={rc}")
case("M1", c_m1)

def c_m2(tmp, name):
    # M2: delete the unstaged-wiring branch. F2's case must then pass vacuously.
    src = open(GUARD_SRC).read()
    mut = src.replace("  if (diskText.includes(ref)) unstagedWiring.push(file);\n  else orphans.push(file);",
                      "  orphans.push(file);")
    assert mut != src, "M2 mutation did not land in the source text"
    mut = mut.replace("if (unstagedWiring.length) {", "if (false && unstagedWiring.length) {")
    mp = f"{tmp}-m2.mjs"; open(mp, "w").write(mut)
    names = build(tmp, guard_text=mp)
    open(f"{tmp}/scripts/check-diskwire.mjs", "w").write("process.exit(0);\n")
    sh(tmp, "git", "add", "scripts/check-diskwire.mjs"); sh(tmp, "git", "commit", "-qm", "g")
    pkg = json.load(open(f"{tmp}/package.json"))
    pkg["scripts"]["check:diskwire"] = "node scripts/check-diskwire.mjs"
    pkg["scripts"]["verify:core"] += " && npm run --silent check:diskwire"
    json.dump(pkg, open(f"{tmp}/package.json", "w"), indent=2)
    rc, out = run(tmp)
    os.unlink(mp)
    rec("M2 without the unstaged-wiring branch, F2 is mis-reported",
        rc == 1 and "wired ONLY in the working tree" not in out, f"rc={rc} (fails as generic orphan, not as the real fault)")
case("M2", c_m2)

print()
bad = [n for n, p, _ in results if not p]
print(f"=== {len(results)-len(bad)}/{len(results)} PASS ===")
if bad:
    print("FAILED:", bad); sys.exit(1)
