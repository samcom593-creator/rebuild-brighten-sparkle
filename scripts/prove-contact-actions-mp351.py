#!/usr/bin/env python3
"""MP-351 proof harness: is check-contact-actions load-bearing, and is it
immune to the footnote bug (needle satisfied by a COMMENT)?

Operates on an isolated COPY of the repo subset. Never mutates the real tree.
Every mutation asserts it LANDED before its verdict is believed.
"""
import os, re, shutil, subprocess, sys, tempfile

REPO = "/Users/samjames/projects/rebuild-brighten-sparkle"
FILES = [
    "scripts/check-contact-actions.mjs",
    "supabase/migrations/20260811222000_apex_contact_actions.sql",
    "src/pages/LicensedInbox.tsx",
    "supabase/functions/apex-outbox-dispatcher/index.ts",
    "supabase/functions/send-sms-auto-detect/index.ts",
    "supabase/functions/send-outreach-email/index.ts",
    "supabase/config.toml",
]
GUARD = "scripts/check-contact-actions.mjs"

def build():
    d = tempfile.mkdtemp(prefix="mp351-")
    for f in FILES:
        dst = os.path.join(d, f)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(os.path.join(REPO, f), dst)
    return d

def run(d):
    p = subprocess.run(["node", os.path.join(d, GUARD)],
                       capture_output=True, text=True, cwd=d)
    return p.returncode, (p.stdout + p.stderr).strip()

# Parse the 24 requirements straight out of the guard source, so the harness
# cannot drift from the contract list it claims to be proving.
src = open(os.path.join(REPO, GUARD)).read()
block = src.split("const requirements = [")[1].split("\n];")[0]
REQS = [(a,b,c) for a,b,c,_ in re.findall("""\[\"(\w+)\",\s*(\"(?:[^\"\\\\]|\\\\.)*\"|\'(?:[^\'\\\\]|\\\\.)*\'),\s*\"([^\"]+)\",\s*\"(code|doc)\"\]""", block)]
VAR2FILE = {
    "migration": "supabase/migrations/20260811222000_apex_contact_actions.sql",
    "inbox": "src/pages/LicensedInbox.tsx",
    "dispatcher": "supabase/functions/apex-outbox-dispatcher/index.ts",
    "sms": "supabase/functions/send-sms-auto-detect/index.ts",
    "email": "supabase/functions/send-outreach-email/index.ts",
    "config": "supabase/config.toml",
}

def unescape(lit):
    body = lit[1:-1]
    return body.encode().decode("unicode_escape")

results = []
def rec(name, ok, detail):
    results.append((name, ok, detail))
    print(("PASS " if ok else "FAIL ") + name + " :: " + detail)

# --- Baseline: clean copy must be GREEN ---
d = build()
rc, out = run(d)
rec("B0 baseline green", rc == 0 and "24 backend/UI/security contracts" in out, f"rc={rc} {out[:90]}")
shutil.rmtree(d)

print(f"\n--- parsed {len(REQS)} requirements from the guard source ---")
if len(REQS) != 24:
    rec("B1 parsed all 24", False, f"parsed {len(REQS)}, expected 24 — harness cannot grade what it cannot read")
    sys.exit(1)
rec("B1 parsed all 24", True, "24/24 parsed")

# --- R1..R24: each needle removed must turn the guard RED ---
print("\n--- R: is each contract load-bearing? (remove -> must go red) ---")
notload = []
for var, lit, label in REQS:
    needle = unescape(lit)
    path = VAR2FILE[var]
    d = build()
    full = os.path.join(d, path)
    txt = open(full).read()
    if needle not in txt:
        rec(f"R[{label}]", False, "needle absent from copy — cannot mutate")
        shutil.rmtree(d); continue
    mutated = txt.replace(needle, "/*MP351-REMOVED*/")
    open(full, "w").write(mutated)
    # ASSERT THE MUTATION LANDED before believing any verdict
    landed = open(full).read().count(needle) == 0
    if not landed:
        rec(f"R[{label}]", False, "MUTATION DID NOT LAND — verdict would be vacuous")
        shutil.rmtree(d); continue
    rc, out = run(d)
    ok = rc != 0
    if not ok:
        notload.append(label)
    rec(f"R[{label}]", ok, f"rc={rc}" + ("" if ok else "  <-- NOT LOAD-BEARING"))
    shutil.rmtree(d)

# --- C: footnote-bug immunity on the security-critical needles ---
# Replace the REAL occurrence with a COMMENTED one. A guard that greps raw
# source will still see the string and pass -- MP-277's bug.
print("\n--- C: footnote-bug immunity (real code commented out -> must go red) ---")
COMMENT_CASES = [
    ("dispatcher", '.eq("requested_by", authorization.userId)', "//", "staff ownership check"),
    ("sms", "authenticateCaller", "//", "SMS authentication"),
    ("email", "authenticateCaller", "//", "email authentication"),
    ("migration", "sms_consent_given", "--", "SMS consent check"),
    ("migration", "email_unsubscribes", "--", "email unsubscribe check"),
]
for var, needle, cmt, label in COMMENT_CASES:
    path = VAR2FILE[var]
    d = build()
    full = os.path.join(d, path)
    txt = open(full).read()
    lines = txt.split("\n")
    hit = [i for i, l in enumerate(lines) if needle in l and not l.strip().startswith(cmt)]
    if not hit:
        rec(f"C[{label}]", False, "no uncommented occurrence to comment out")
        shutil.rmtree(d); continue
    for i in hit:
        lines[i] = cmt + " " + lines[i]
    open(full, "w").write("\n".join(lines))
    landed = all(open(full).read().split("\n")[i].strip().startswith(cmt) for i in hit)
    if not landed:
        rec(f"C[{label}]", False, "MUTATION DID NOT LAND")
        shutil.rmtree(d); continue
    rc, out = run(d)
    ok = rc != 0
    rec(f"C[{label}]", ok, f"commented {len(hit)} line(s), rc={rc}" + ("" if ok else "  <-- FOOTNOTE BUG: passes on commented-out security code"))
    shutil.rmtree(d)

# --- M1: a missing target file must fail CLOSED, never silently pass ---
print("\n--- M: fail-closed behaviour ---")
d = build()
os.remove(os.path.join(d, "supabase/config.toml"))
rc, out = run(d)
rec("M1 missing target file fails closed", rc != 0, f"rc={rc}")
shutil.rmtree(d)

passed = sum(1 for _, ok, _ in results if ok)
print(f"\n=== {passed}/{len(results)} ===")
if notload:
    print("NOT LOAD-BEARING (" + str(len(notload)) + "): " + ", ".join(notload))
