#!/usr/bin/env python3
"""MP-351 proof: is check-guard-wiring load-bearing, and is each of its four
reachability routes load-bearing? Operates on an isolated COPY."""
import json, os, shutil, subprocess, tempfile

REPO="/Users/samjames/projects/rebuild-brighten-sparkle"
def build():
    d=tempfile.mkdtemp(prefix="mp351w-")
    for sub in ["scripts",".husky",".github/workflows"]:
        src=os.path.join(REPO,sub)
        if os.path.isdir(src):
            shutil.copytree(src,os.path.join(d,sub),dirs_exist_ok=True)
    shutil.copy2(os.path.join(REPO,"package.json"),os.path.join(d,"package.json"))
    return d
def run(d):
    p=subprocess.run(["node",os.path.join(d,"scripts/check-guard-wiring.mjs")],
                     capture_output=True,text=True,cwd=d)
    return p.returncode,(p.stdout+p.stderr).strip()
res=[]
def rec(n,ok,det):
    res.append(ok); print(("PASS " if ok else "FAIL ")+n+" :: "+det)

d=build(); rc,out=run(d); rec("B0 baseline green", rc==0 and "57 guard" in out, f"rc={rc} {out[:70]}"); shutil.rmtree(d)

# M1: reproduce the REAL MP-351 defect — unwire check:contact-actions entirely.
d=build()
pj=os.path.join(d,"package.json"); s=open(pj).read()
before=s
s=s.replace(" && npm run check:contact-actions","")
open(pj,"w").write(s)
hp=os.path.join(d,".husky/pre-commit"); h=open(hp).read()
h=h.replace("  npm run --silent check:contact-actions || exit 1","  true")
open(hp,"w").write(h)
landed = ("&& npm run check:contact-actions" not in open(pj).read()
          and "--silent check:contact-actions" not in open(hp).read())
rc,out=run(d)
rec("M1 real MP-351 defect reproduced", landed and rc!=0 and "check-contact-actions.mjs" in out,
    f"landed={landed} rc={rc} names_it={'check-contact-actions.mjs' in out}")
shutil.rmtree(d)

# M2: is the DIRECT `node scripts/…` route load-bearing? Kill it and the
# hook-invoked relative-time-guard must be accused.
d=build()
src=os.path.join(d,"scripts/check-guard-wiring.mjs"); c=open(src).read()
c2=c.replace("const viaDirect = direct.includes(ref);","const viaDirect = false;")
assert c2!=c; open(src,"w").write(c2)
landed = "const viaDirect = false;" in open(src).read()
rc,out=run(d)
rec("M2 direct-node route load-bearing", landed and rc!=0 and "check-relative-time-guard.mjs" in out,
    f"landed={landed} rc={rc} accuses_relative_time={'check-relative-time-guard.mjs' in out}")
shutil.rmtree(d)

# M3: is the npm LIFECYCLE (prebuild) route load-bearing? Kill it and the
# prebuild-invoked check-live-polling must be accused.
d=build()
src=os.path.join(d,"scripts/check-guard-wiring.mjs"); c=open(src).read()
c2=c.replace("      if (life in scripts && !seen.has(life)) stack.push(life);","      void life;")
assert c2!=c; open(src,"w").write(c2)
landed = "void life;" in open(src).read()
rc,out=run(d)
rec("M3 prebuild-lifecycle route load-bearing", landed and rc!=0 and "check-live-polling.mjs" in out,
    f"landed={landed} rc={rc} accuses_live_polling={'check-live-polling.mjs' in out}")
shutil.rmtree(d)

# M4: truncated population must FAIL, never report a clean sweep over nothing.
d=build()
sd=os.path.join(d,"scripts")
kept=0
for f in sorted(os.listdir(sd)):
    if f.startswith("check-") and f.endswith(".mjs") and f!="check-guard-wiring.mjs":
        kept+=1
        if kept>4: os.remove(os.path.join(sd,f))
remaining=[f for f in os.listdir(sd) if f.startswith("check-") and f.endswith(".mjs")]
landed = len(remaining)==5 and "check-guard-wiring.mjs" in remaining
rc,out=run(d)
rec("M4 truncated population fails loudly", landed and rc!=0 and "Refusing" in out,
    f"landed={landed} rc={rc}")
shutil.rmtree(d)

print(f"\n=== {sum(res)}/{len(res)} ===")
