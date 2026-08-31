#!/usr/bin/env python3
"""Proof harness for scripts/check-rpc-args.mjs (MP-349).

Every fixture runs the REAL checker against a throwaway copy of the repo tree.
Every mutation asserts the edit LANDED before believing the verdict -- a sed that
silently rewrites nothing produces a green run that proves nothing, which has
caught this ledger's authors repeatedly (MP-347 B3, MP-348 M3, MP-345).
"""
import json, os, re, shutil, subprocess, sys, tempfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHECK = "scripts/check-rpc-args.mjs"
CATALOG = "scripts/data/rpc-catalog.json"
results = []

def sandbox():
    d = tempfile.mkdtemp(prefix="rpcproof-")
    os.makedirs(os.path.join(d, "scripts/data"), exist_ok=True)
    shutil.copy(os.path.join(REPO, CHECK), os.path.join(d, CHECK))
    shutil.copy(os.path.join(REPO, CATALOG), os.path.join(d, CATALOG))
    for sub in ("src", "supabase/functions"):
        os.makedirs(os.path.join(d, sub), exist_ok=True)
    return d

def run(d):
    p = subprocess.run(["node", CHECK], cwd=d, capture_output=True, text=True)
    return p.returncode, p.stdout + p.stderr

def write(d, rel, text):
    p = os.path.join(d, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, "w").write(text)

def check(name, cond, detail=""):
    results.append((name, cond, detail))
    print(("PASS " if cond else "FAIL ") + name + (("  :: " + detail) if detail and not cond else ""))

# A real function from the live catalog, used so fixtures are not hypothetical.
cat = json.load(open(os.path.join(REPO, CATALOG)))
FN = "acknowledge_strike"
assert FN in cat["functions"], "fixture function vanished from the catalog"
SIG = cat["functions"][FN][0]
assert SIG["required"] == ["p_strike_id"], f"fixture signature changed: {SIG}"

# --- B1 correct call resolves ------------------------------------------------
d = sandbox()
write(d, "src/ok.ts", f'const x = await supabase.rpc("{FN}", {{ p_strike_id: id }});\n')
rc, out = run(d)
check("B1 correct arg name -> OK", rc == 0 and "OK  1" in out, out[:300])

# --- B2 wrong arg name is caught (the class) ---------------------------------
d = sandbox()
write(d, "src/bad.ts", f'const x = await (supabase as any).rpc("{FN}", {{ p_strike_idd: id }});\n')
rc, out = run(d)
check("B2 wrong arg name behind a cast -> FAIL", rc == 1 and "p_strike_idd" in out and "unknown=" in out, out[:400])

# --- B3 missing required arg is caught ---------------------------------------
d = sandbox()
write(d, "src/miss.ts", f'const x = await supabase.rpc("{FN}", {{ }});\n')
rc, out = run(d)
check("B3 missing required arg -> FAIL", rc == 1 and "missing_required=[p_strike_id]" in out, out[:400])

# --- B4 nonexistent function is caught ---------------------------------------
d = sandbox()
write(d, "src/nofn.ts", 'const x = await (supabase as any).rpc("no_such_function_at_all", { z: 1 });\n')
rc, out = run(d)
check("B4 nonexistent function -> FAIL", rc == 1 and "no function named" in out, out[:400])

# --- B5 prose inside a string literal is NOT a call site ---------------------
# src/data/shipped-data.ts documents past waves by quoting their code verbatim.
d = sandbox()
write(d, "src/data/shipped-data.ts",
      'export const w = [{ detail: "Calls supabase.rpc(\'%s\', {p_bogus_key: 1}) and surfaces the URL." }];\n' % FN)
rc, out = run(d)
check("B5 prose in a string is not graded -> OK", rc == 0 and "OK  0" in out, out[:400])

# --- B6 ternary value does not corrupt key parsing ---------------------------
d = sandbox()
write(d, "src/tern.ts",
      f'const x = await supabase.rpc("{FN}", {{ p_strike_id: licensed ? "a" : "b" }});\n')
rc, out = run(d)
check("B6 depth-0 ternary parses as one key -> OK graded, not excused",
      rc == 0 and "OK  1" in out and "unprovable 0" not in out and "1 unprovable" not in out, out[:400])

# --- B7 truncated catalog refuses to grade -----------------------------------
d = sandbox()
small = {"functions": {k: cat["functions"][k] for k in list(cat["functions"])[:10]}}
json.dump(small, open(os.path.join(d, CATALOG), "w"))
write(d, "src/ok.ts", f'const x = await supabase.rpc("{FN}", {{ p_strike_id: id }});\n')
rc, out = run(d)
check("B7 truncated catalog -> FAIL, never a silent pass", rc == 1 and "Refusing to grade" in out, out[:300])

# --- B8 absent catalog refuses to grade --------------------------------------
d = sandbox()
os.remove(os.path.join(d, CATALOG))
rc, out = run(d)
check("B8 absent catalog -> FAIL", rc == 1 and "no catalog" in out, out[:300])

# --- B9 computed keys are reported unprovable, never passed silently ---------
d = sandbox()
write(d, "src/spread.ts", f'const x = await supabase.rpc("{FN}", {{ ...args }});\n')
rc, out = run(d)
check("B9 spread -> unprovable and named", rc == 0 and "unprovable" in out and "computed argument keys" in out, out[:400])

# --- B10 test files are excluded (they assert on source text) ----------------
d = sandbox()
write(d, "src/thing.test.ts", f'expect(s).toContain(\'supabase.rpc("{FN}", {{ p_bogus: 1 }})\');\n')
rc, out = run(d)
check("B10 .test. files excluded -> OK 0", rc == 0 and "OK  0" in out, out[:300])

# ---------------------------------------------------------------------------
# Mutations. Each asserts the edit LANDED, then asserts the guard's behaviour
# actually degrades. A mutation that rewrites nothing proves nothing.
# ---------------------------------------------------------------------------
def mutate(sub, repl, count=1):
    d = sandbox()
    p = os.path.join(d, CHECK)
    src = open(p).read()
    new, n = re.subn(sub, repl, src, count=count)
    assert n == count, f"MUTATION DID NOT LAND: {sub!r} matched {n} times, expected {count}"
    assert new != src, "MUTATION produced identical source"
    open(p, "w").write(new)
    return d

# M1: remove the string-literal mask -> prose becomes a phantom call site.
d = mutate(r"if \(inStr\[m\.index\]\) continue;", "if (false) continue;")
write(d, "src/data/shipped-data.ts",
      'export const w = [{ detail: "Calls supabase.rpc(\'%s\', {p_bogus_key: 1}) and surfaces the URL." }];\n' % FN)
rc, out = run(d)
check("M1 without the string mask, prose is graded as a real call (phantom finding)",
      rc == 1 and "p_bogus_key" in out, out[:400])

# M2: revert the ternary fix -> a real, gradeable site is excused as unprovable.
d = mutate(r'ch === ":" && depth === 0 && !haveKey', 'ch === ":" && depth === 0')
write(d, "src/tern.ts",
      f'const x = await supabase.rpc("{FN}", {{ p_strike_id: licensed ? "a" : "b" }});\n')
rc, out = run(d)
check("M2 without the ternary fix, a real site is excused as unprovable",
      rc == 0 and "unprovable" in out and "computed argument keys" in out, out[:400])

# M3: gut the unknown-key test -> the class stops being caught at all.
#
# The fixture MUST be a function whose every parameter has a DEFAULT. The first
# version of this mutation used acknowledge_strike(p_strike_id uuid NOT NULL) and
# reported the guard still red -- but the redness came from the INDEPENDENT
# missing-required test, so it proved nothing about the branch it was gutting.
# A mutation aimed at the wrong fixture is a green light nobody earned.
ALLOPT = "apex_contracts_summary"
assert ALLOPT in cat["functions"], "all-optional fixture function vanished"
_sig = cat["functions"][ALLOPT][0]
assert _sig["all"] and not _sig["required"], f"fixture is no longer all-optional: {_sig}"
d = mutate(r"const extra = \[\.\.\.keys\]\.filter\(\(k\) => !o\.all\.includes\(k\)\);",
           "const extra = [];")
write(d, "src/bad.ts", f'const x = await (supabase as any).rpc("{ALLOPT}", {{ p_bogus_key: id }});\n')
rc, out = run(d)
check("M3 with the unknown-key test gutted, an unknown key ships green", rc == 0, out[:400])

# M3b: the same fixture against the UNMUTATED guard must be caught, or M3 above
# would pass for the trivial reason that nothing ever grades it.
d = sandbox()
write(d, "src/bad.ts", f'const x = await (supabase as any).rpc("{ALLOPT}", {{ p_bogus_key: id }});\n')
rc, out = run(d)
check("M3b the same unknown key IS caught by the real guard",
      rc == 1 and "p_bogus_key" in out and "unknown=[p_bogus_key]" in out, out[:400])

# M4: gut the truncated-catalog floor -> grades against a 10-row snapshot.
d = mutate(r"Object\.keys\(fns\)\.length < 300", "Object.keys(fns).length < 0")
json.dump(small, open(os.path.join(d, CATALOG), "w"))
write(d, "src/ok.ts", f'const x = await supabase.rpc("{FN}", {{ p_strike_id: id }});\n')
rc, out = run(d)
check("M4 without the floor, a 10-function catalog is graded as authoritative",
      rc == 0 and "10 live functions" in out, out[:400])

print()
bad = [n for n, c, _ in results if not c]
print(f"{len(results) - len(bad)}/{len(results)} proofs passed")
sys.exit(1 if bad else 0)
