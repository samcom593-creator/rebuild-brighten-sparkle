#!/bin/bash
# prove-prod-write-census-claims.sh — MP-606 (2026-09-21)
#
# Proves the three branches MP-606 added to check-prod-write-ref-gate.mjs, and
# proves each was LOAD-BEARING by running the same mutation against the guard as
# it stood at the base commit (MP-604, c6754f27). A branch the old guard already
# caught is not a fix; it is decoration.
#
# Every case asserts its mutation LANDED before reading a verdict — a fixture
# that fails to apply makes every case pass vacuously.
#
# TWO TRAPS THIS HARNESS FELL INTO ON ITS FIRST RUN, both recorded here because
# neither was visible in a verdict:
#   1. Its restore() ran `git checkout -- <guard>`, which reverted the
#      UNCOMMITTED guard it existed to test. Every later case then graded HEAD's
#      guard while printing "new guard". The first repair only spared the guard
#      and kept `git checkout` for the FIXTURES — so the next run silently ate
#      an uncommitted edit to the census instead. `git checkout` restores the
#      COMMITTED file, which is a different thing from the file this run found.
#      Nothing here is restored from git: every mutated path is snapshotted
#      before the first mutation and restored from that snapshot.
#   2. The base guard was first run from /tmp, where node cannot resolve
#      js-yaml — ERR_MODULE_NOT_FOUND read as an ordinary red. It runs from
#      inside the repo tree, and this script proves it can go green before
#      trusting any "old guard was blind" claim.
set -uo pipefail
cd "$(dirname "$0")/.."
CENSUS=.github/prod-write-census.json
GUARD=scripts/check-prod-write-ref-gate.mjs
WF=.github/workflows/deploy-supabase.yml
OLD=scripts/.mp606-base-guard.mjs
SNAPDIR=$(mktemp -d)

# Snapshot every path any case below mutates, as this run FOUND it.
for f in "$GUARD" "$CENSUS" "$WF"; do cp "$f" "$SNAPDIR/$(basename "$f")"; done
git show HEAD:$GUARD > "$OLD" 2>/dev/null || { echo "FATAL: cannot recover the base guard"; exit 1; }
if /usr/bin/grep -q "CLASSIFICATIONS" "$OLD"; then
  echo "FATAL: HEAD already carries MP-606 — this harness must run against the pre-fix base"; rm -f "$OLD"; exit 1
fi

PASS=0; FAIL=0
restore() { for f in "$GUARD" "$CENSUS" "$WF"; do cp "$SNAPDIR/$(basename "$f")" "$f"; done; }
cleanup() { restore; rm -f "$OLD"; rm -rf "$SNAPDIR"; }
trap cleanup EXIT

# ok <label> <expected rc> <expected substring|-> <cmd...>
ok() {
  local label=$1 want=$2 needle=$3; shift 3
  local out rc
  out=$("$@" 2>&1); rc=$?
  if [ "$rc" != "$want" ]; then echo "  ✖ $label — rc=$rc want=$want"; FAIL=$((FAIL+1)); return; fi
  if [ "$needle" != "-" ] && ! printf '%s' "$out" | /usr/bin/grep -qF "$needle"; then
    echo "  ✖ $label — rc ok but missing: $needle"; FAIL=$((FAIL+1)); return
  fi
  echo "  ✓ $label"; PASS=$((PASS+1))
}

reclass() { # $1=step key  $2=classification value
  python3 - "$1" "$2" <<'PY'
import json,sys
p=".github/prod-write-census.json"; d=json.load(open(p))
d["steps"][sys.argv[1]]["classification"]=sys.argv[2]
json.dump(d,open(p,"w"),indent=2)
PY
  python3 -c "
import json,sys
d=json.load(open('.github/prod-write-census.json'))
sys.exit(0 if d['steps'][sys.argv[1]]['classification']==sys.argv[2] else 1)" "$1" "$2" \
    || { echo "  ✖ FIXTURE DID NOT LAND: $1 -> $2"; FAIL=$((FAIL+1)); return 1; }
}

DEPLOY="deploy-supabase.yml::deploy::Deploy edge functions"
VANTAGE="vantage-production-sync.yml::sync::Fetch and reconcile production"

echo "BASELINE — both guards must be green on the untouched repo, or nothing below means anything"
ok "new guard green"                                  0 "prod write ref-gate intact" node $GUARD
ok "base guard green (runs, resolves deps)"           0 "prod write ref-gate intact" node "$OLD"

echo "M1  the 35-branch deploy step relabelled \"read\""
reclass "$DEPLOY" read && {
  ok "new guard REFUSES the mislabel"                 1 "refuted by this guard's own evidence" node $GUARD
  ok "  …and names the evidence it already held"      1 "runs in command position: supabase functions deploy" node $GUARD
  ok "LOAD-BEARING: base guard called it intact"      0 "prod write ref-gate intact" node "$OLD"
}
restore

echo "M2  one transposed letter in the classification"
reclass "$DEPLOY" wrote && {
  ok "new guard REFUSES the vocabulary"               1 'outside ["read","write"]' node $GUARD
  ok "LOAD-BEARING: base guard called it intact"      0 "prod write ref-gate intact" node "$OLD"
}
restore

echo "M3  the SQL-only writer relabelled \"read\" (no shell write verb exists anywhere in it)"
reclass "$VANTAGE" read && {
  ok "new guard REFUSES on payload evidence"          1 "sends SQL that mutates: insert" node $GUARD
  ok "LOAD-BEARING: base guard called it intact"      0 "prod write ref-gate intact" node "$OLD"
}
restore

echo "M4  the SQL detector itself broken — the dead-filter case (MP-399)"
python3 - <<'PY'
p="scripts/check-prod-write-ref-gate.mjs"; s=open(p).read()
a="const MUTATING = /(^|\\n|;)"
assert s.count(a)==1, "M4 anchor absent"
open(p,"w").write(s.replace(a,"const MUTATING = /(^|\\n|;)ZZNEVER",1))
PY
if /usr/bin/grep -q "ZZNEVER" $GUARD; then
  ok "control refuses to grade with a dead detector"  1 "SQL-mutation detector found no" node $GUARD
else echo "  ✖ FIXTURE DID NOT LAND: M4"; FAIL=$((FAIL+1)); fi
restore

echo "M5  NEGATIVE CONTROL — a read step that TALKS about writing"
python3 - <<'PY'
p=".github/workflows/deploy-supabase.yml"; s=open(p).read()
a='echo "### Deploy summary" >> $GITHUB_STEP_SUMMARY'
assert s.count(a)==1, "M5 anchor absent"
open(p,"w").write(s.replace(a,'echo "this run will insert into nothing and delete from nothing" >> $GITHUB_STEP_SUMMARY\n          '+a,1))
PY
if /usr/bin/grep -q "insert into nothing" .github/workflows/deploy-supabase.yml; then
  ok "prose is not evidence — still green"            0 "prod write ref-gate intact" node $GUARD
else echo "  ✖ FIXTURE DID NOT LAND: M5"; FAIL=$((FAIL+1)); fi
restore

echo
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
