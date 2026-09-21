#!/usr/bin/env bash
# prove-prod-write-ref-gate — MP-603
#
# A guard nobody has watched fail is a guard nobody has tested. Every case below
# asserts the MUTATION LANDED before believing the verdict: this repo has shipped
# a red-proof that printed GREEN because backticks in an unquoted heredoc ate the
# mutation, and a harness whose slice silently matched nothing and "passed" while
# proving none of its branches.
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PASS=0; FAIL=0
GUARD="scripts/check-prod-write-ref-gate.mjs"
CENSUS=".github/prod-write-census.json"

new_tree() {  # $1 = dest
  rm -rf "$1"; mkdir -p "$1/scripts" "$1/.github/workflows"
  cp "$REPO/$GUARD" "$1/scripts/"
  cp "$REPO/$CENSUS" "$1/.github/"
  cp "$REPO"/.github/workflows/*.yml "$1/.github/workflows/"
  # the guard follows invoked repo scripts, so the real ones must be present
  mkdir -p "$1/supabase"
  cp "$REPO"/scripts/*.mjs "$1/scripts/" 2>/dev/null
  cp "$REPO"/scripts/*.ts  "$1/scripts/" 2>/dev/null
  cp "$REPO"/scripts/*.sh  "$1/scripts/" 2>/dev/null
  ln -s "$REPO/node_modules" "$1/node_modules"
}

# check <name> <expect pass|fail> <grep-for|-> ; tree already mutated at $T
check() {
  local name="$1" expect="$2" needle="$3" out rc
  out="$(cd "$T" && node "$GUARD" 2>&1)"; rc=$?
  local got=pass; [ $rc -ne 0 ] && got=fail
  if [ "$got" != "$expect" ]; then
    echo "  ✖ $name — expected $expect, got $got"; echo "$out" | head -4 | sed 's/^/      /'; FAIL=$((FAIL+1)); return
  fi
  if [ "$needle" != "-" ] && ! printf '%s' "$out" | /usr/bin/grep -q "$needle"; then
    echo "  ✖ $name — $expect as expected, but not for the stated reason (missing: $needle)"
    echo "$out" | head -6 | sed 's/^/      /'; FAIL=$((FAIL+1)); return
  fi
  echo "  ✓ $name"; PASS=$((PASS+1))
}

# assert_changed <file> <before-sha> : the mutation must have LANDED
assert_changed() {
  local f="$1" before="$2" after
  after="$(shasum "$f" | cut -d' ' -f1)"
  if [ "$before" = "$after" ]; then echo "  ✖ MUTATION DID NOT LAND: $f unchanged — the case below would prove nothing"; FAIL=$((FAIL+1)); return 1; fi
  return 0
}

echo "prove-prod-write-ref-gate (MP-603)"
T="$(mktemp -d)/t"

# ── C0 positive control: the real tree is GREEN ────────────────────────────
new_tree "$T"
check "C0 healthy tree passes" pass "prod write ref-gate intact"

# ── M1 a prod WRITE loses its ref gate → RED ───────────────────────────────
new_tree "$T"; F="$T/.github/workflows/vantage-production-sync.yml"; B=$(shasum "$F"|cut -d' ' -f1)
perl -0pi -e "s/      - name: Fetch and reconcile production\n        if: github\.ref == 'refs\/heads\/main'\n/      - name: Fetch and reconcile production\n/" "$F"
assert_changed "$F" "$B" && check "M1 ungated prod write is caught" fail "are reachable from a non-main ref and are not gated"

# ── M2 a NEW prod-touching step nobody classified → RED ────────────────────
new_tree "$T"; F="$T/.github/prod-write-census.json"; B=$(shasum "$F"|cut -d' ' -f1)
python3 - "$F" <<'PY'
import json,sys
p=sys.argv[1]; d=json.load(open(p))
del d["steps"]["vantage-production-sync.yml::sync::Fetch and reconcile production"]
json.dump(d,open(p,"w"),indent=2)
PY
assert_changed "$F" "$B" && check "M2 unclassified prod-touching step is caught" fail "not in .github/prod-write-census.json"

# ── M3 a census entry that matches nothing → RED (no silent slot reuse) ─────
new_tree "$T"; F="$T/.github/prod-write-census.json"; B=$(shasum "$F"|cut -d' ' -f1)
python3 - "$F" <<'PY'
import json,sys
p=sys.argv[1]; d=json.load(open(p))
d["steps"]["ghost.yml::ghost::Ghost"]={"classification":"write","why":"stale"}
json.dump(d,open(p,"w"),indent=2)
PY
assert_changed "$F" "$B" && check "M3 stale census entry is caught" fail "no longer match any step"

# ── M4 matcher regression: drop `if` from command position → RED ───────────
# Both real supabase writers are written `if supabase functions deploy …; then`.
# Without `if` the matcher grades ZERO writes — MP-602's second defect, which
# printed "gate intact" while listing the 35-deploy steps as harmless mentions.
new_tree "$T"; F="$T/scripts/check-prod-write-ref-gate.mjs"; B=$(shasum "$F"|cut -d' ' -f1)
perl -0pi -e 's/\(\?:if\|elif\|then\|else\|fi\|do\|while\|until\|not\)/(?:then|else|fi|do|not)/' "$F"
assert_changed "$F" "$B" && check "M4 crippled command-position matcher is caught" fail "matcher regression"

# ── M5 the env route is what found `Check pg_cron heartbeat`; kill it → RED ─
new_tree "$T"; F="$T/scripts/check-prod-write-ref-gate.mjs"; B=$(shasum "$F"|cut -d' ' -f1)
perl -0pi -e 's/const usesEnv = \(body, name\) =>.*$/const usesEnv = () => false;/m' "$F"
assert_changed "$F" "$B" && check "M5 dead env route is caught by the control" fail "VIA an env var"

# ── M6 producer repointed away from main → RED (deploys would stop silently) ─
new_tree "$T"; F="$T/.github/workflows/deploy-supabase.yml"; B=$(shasum "$F"|cut -d' ' -f1)
perl -0pi -e 's/(\$THIS_REF"?\s*=\s*"?refs\/heads\/)main/${1}NOPE/' "$F"
assert_changed "$F" "$B" && check "M6 producer that no longer grants main is caught" fail "no longer produces a usable"

# ── M7 the census itself is missing → refuse to grade, never green ──────────
new_tree "$T"; rm -f "$T/.github/prod-write-census.json"
check "M7 missing census refuses to grade" fail "Refusing to grade an unknown population"

echo
echo "prove-prod-write-ref-gate: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
