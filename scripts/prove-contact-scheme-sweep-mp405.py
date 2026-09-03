#!/usr/bin/env python3
"""prove-contact-scheme-sweep-mp405 — proves the widened contact-scheme guard.

MP-405 took check-recruiting-contact-actions from 8 curated surfaces to every
.tsx under src/. A widened guard that cannot go red is worse than the narrow one
it replaced, so every contract and both precision decisions are driven here
against a throwaway fixture tree. The real repo is never mutated.

Each mutation is ASSERTED TO HAVE LANDED in the file text before its verdict is
believed — this repo has shipped a proof that passed because the mutation was
silently eaten (MP-402's heredoc, MP-403's indentation).
"""
import shutil, subprocess, sys, tempfile, pathlib, re

REPO = pathlib.Path("/Users/samjames/projects/rebuild-brighten-sparkle")
GUARD = "scripts/check-recruiting-contact-actions.mjs"
results = []

def build():
    """Fixture tree: the guard, phone.ts, the 8 fail-closed surfaces, and the
    files whose SHAPES the precision decisions turn on."""
    d = pathlib.Path(tempfile.mkdtemp(prefix="mp405-"))
    (d / "scripts").mkdir()
    shutil.copy(REPO / GUARD, d / GUARD)
    watched = re.search(r"const WATCHED = \[(.*?)\];", (REPO / GUARD).read_text(), re.S).group(1)
    keep = re.findall(r'"([^"]+)"', watched) + [
        "src/lib/phone.ts",
        "src/pages/NotificationHub.tsx",            # object key `sms:` — must stay green
        "src/components/unlicensed/RecoveryBatchDrawer.tsx",  # helper-returned href
        "src/components/dashboard/StatCardPopup.tsx",         # carries an allow marker
        "src/pages/Contact.tsx",                    # named public exemption
        "src/pages/RecruitingLinks.tsx",            # named no-recipient exemption
        "src/pages/MyLandingPage.tsx",
        "src/components/landing/Footer.tsx", "src/components/landing/CalendlyEmbed.tsx",
        "src/pages/Storefront.tsx", "src/pages/PublicAgentLanding.tsx",
    ]
    for rel in keep:
        src = REPO / rel
        dst = d / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(src, dst)
    return d

def run(d):
    r = subprocess.run(["node", GUARD], cwd=d, capture_output=True, text=True)
    return r.returncode, r.stdout + r.stderr

def check(name, cond, detail=""):
    results.append((name, cond, detail))
    print(f"  {'PASS' if cond else 'FAIL'}  {name}" + (f"  — {detail}" if detail and not cond else ""))

def mutate(path, old, new, label):
    t = path.read_text()
    assert old in t, f"{label}: premise false — {old[:70]!r} absent, mutation would prove nothing"
    path.write_text(t.replace(old, new, 1))
    assert new in path.read_text(), f"{label}: mutation did not land"

# ---- F0: the shipped tree is green, and actually grades a wide population ----
d = build()
rc, out = run(d)
check("F0 fixture tree green", rc == 0, out[-400:])
m = re.search(r"(\d+) src/ surface\(s\) clean", out)
check("F0 grades the walk, not just WATCHED", bool(m) and int(m.group(1)) > 8,
      f"graded {m.group(1) if m else '?'}")
check("F0 publishes the site-level allows", "allowed at the site" in out, out[-300:])

# ---- F1: a raw scheme in a WALK-ONLY file fails (the widening is load-bearing)
d1 = build()
mutate(d1 / "src/components/unlicensed/RecoveryBatchDrawer.tsx",
       "return phoneHref(e164) ?? `tel:${e164}`;", 'return `tel:${e164}`;', "F1")
rc1, out1 = run(d1)
check("F1 raw scheme in a walk-only file FAILS", rc1 == 1 and "RecoveryBatchDrawer" in out1, out1[-300:])

# ---- F2: a helper href with no contactLinkProps fails in a walk-only file ----
d2 = build()
p2 = d2 / "src/components/unlicensed/RecoveryBatchDrawer.tsx"
mutate(p2, "href={telHref(row.phone)} {...contactLinkProps(telHref(row.phone))}",
       "href={telHref(row.phone)}", "F2")
rc2, out2 = run(d2)
check("F2 helper href without contactLinkProps FAILS", rc2 == 1 and "without" in out2, out2[-300:])

# ---- F3: an allow marker with NO written reason does not excuse --------------
d3 = build()
p3 = d3 / "src/components/dashboard/StatCardPopup.tsx"
t3 = p3.read_text()
assert "contact-scheme-allow: multi-recipient" in t3, "F3 premise false"
p3.write_text(re.sub(r"contact-scheme-allow:[^*]*", "contact-scheme-allow:", t3, count=1))
assert "contact-scheme-allow:" in p3.read_text(), "F3 mutation did not land"
rc3, out3 = run(d3)
check("F3 reasonless marker does NOT excuse", rc3 == 1 and "StatCardPopup" in out3, out3[-300:])

# ---- F4: a named exempt public page may keep its raw tel: -------------------
d4 = build()
rc4, out4 = run(d4)
check("F4 public pages keep raw tel: and stay green", rc4 == 0 and "Contact.tsx" not in out4, out4[-300:])

# ---- F5: fail-closed — a WATCHED surface that moves stops the whole guard ----
d5 = build()
(d5 / "src/pages/Interviews.tsx").unlink()
rc5, out5 = run(d5)
check("F5 missing WATCHED surface fails CLOSED", rc5 == 1 and "cannot read" in out5, out5[-300:])

# ---- M1: revert the needle to the bare token -> object keys go red ----------
# Proves the precision fix is load-bearing, not cosmetic.
dm1 = build()
mutate(dm1 / GUARD, 'const SCHEME_IN_LINK_POSITION = /["\'`](tel|sms):/g;',
       "const SCHEME_IN_LINK_POSITION = /\\b(tel|sms):/g;", "M1")
rcm1, outm1 = run(dm1)
check("M1 bare-token needle reports NotificationHub's object keys",
      rcm1 == 1 and "NotificationHub" in outm1, outm1[-300:])

# ---- M2: href-adjacency needle -> the helper-returned href goes invisible ----
# The wrong fix that looked right: quieter, and blind to two real defects.
dm2 = build()
mutate(dm2 / GUARD, 'const SCHEME_IN_LINK_POSITION = /["\'`](tel|sms):/g;',
       'const SCHEME_IN_LINK_POSITION = /href\\s*=\\s*\\{?[`"\']?\\s*\\$?\\{?\\s*(?:`)?(tel|sms):/g;', "M2")
# with the adjacency needle, break the helper the same way F1 did
mutate(dm2 / "src/components/unlicensed/RecoveryBatchDrawer.tsx",
       "return phoneHref(e164) ?? `tel:${e164}`;", 'return `tel:${e164}`;', "M2b")
rcm2, outm2 = run(dm2)
check("M2 adjacency needle is BLIND to the helper-returned href",
      "RecoveryBatchDrawer" not in outm2,
      "adjacency needle still saw it — M2 proves nothing")

# ---- M3: delete the walk -> F1's defect stops being reported -----------------
dm3 = build()
mutate(dm3 / GUARD, 'for (const path of walkTsx("src")) {\n  if (sources[path]',
       'for (const path of []) {\n  if (sources[path]', "M3")
mutate(dm3 / "src/components/unlicensed/RecoveryBatchDrawer.tsx",
       "return phoneHref(e164) ?? `tel:${e164}`;", 'return `tel:${e164}`;', "M3b")
rcm3, outm3 = run(dm3)
check("M3 without the walk the same defect is unreported",
      "RecoveryBatchDrawer" not in outm3, "walk removal changed nothing — M3 proves nothing")

for d_ in list(pathlib.Path(tempfile.gettempdir()).glob("mp405-*")):
    shutil.rmtree(d_, ignore_errors=True)

ok = sum(1 for _, c, _ in results if c)
print(f"\n{ok}/{len(results)} proofs passed")
sys.exit(0 if ok == len(results) else 1)
