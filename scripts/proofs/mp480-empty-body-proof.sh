#!/bin/bash
# MP-480 proof harness — scripts/lib/empty-body.mjs + scripts/tests/empty-body.test.mjs
#
# Asserts, in order: (a) the harness can observe GREEN before mutating,
# (b) every mutation actually LANDED in the file, (c) the verdict then flips.
# A harness that cannot run reports failure just as confidently as one that ran
# (MP-479), and a mutation that silently fails to apply proves nothing (MP-284).
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1

LIB=scripts/lib/empty-body.mjs
BAK=$(mktemp); cp "$LIB" "$BAK"
FIXTURE=supabase/functions/_shared/mp480-proof-fixture.ts
restore() { cp "$BAK" "$LIB"; rm -f "$BAK" "$FIXTURE"; }
trap restore EXIT

pass=0; fail=0
ok()  { echo "  PASS  $1"; pass=$((pass+1)); }
bad() { echo "  FAIL  $1"; fail=$((fail+1)); }

echo "MP-480 proof"

# --- Baseline: the harness must be able to see green, or nothing below means anything.
node scripts/tests/empty-body.test.mjs >/dev/null 2>&1 && ok "baseline: test:empty-body GREEN" || bad "baseline: test:empty-body should be GREEN"
BASE=$(node scripts/check-empty-catch.mjs 2>&1 | grep -c 'supabase/functions: 265 files scanned, 51 ')
[ "$BASE" = "1" ] && ok "baseline: check:empty-catch counts 51 in supabase/functions" || bad "baseline: expected 51 (got line count $BASE)"

# --- M1: drop the load-bearing .trim(). The blinding the ratchet cannot see.
perl -0pi -e 's/return stripComments\(body\)\.trim\(\);/return stripComments(body);/' "$LIB"
if grep -q 'return stripComments(body);' "$LIB"; then
  ok "M1 mutation LANDED (.trim() removed)"
  node scripts/tests/empty-body.test.mjs >/dev/null 2>&1 && bad "M1: positive control still GREEN — it is not load-bearing" || ok "M1: test:empty-body goes RED"
  M1OUT=$(node scripts/check-empty-catch.mjs 2>&1); M1EXIT=$?
  echo "$M1OUT" | grep -q 'supabase/functions: 265 files scanned, 22 ' && ok "M1: count falls 51 -> 22 (29 real swallows go invisible)" || bad "M1: expected the count to fall to 22"
  [ "$M1EXIT" = "0" ] && ok "M1: the ratchet EXITS 0 on the blinding — why a count cannot grade this" || bad "M1: expected exit 0 from the ratchet"
  echo "$M1OUT" | grep -q 'Lower the supabase/functions baseline' && ok "M1: the guard PRINTS the instruction that would lock it in" || bad "M1: expected the lower-the-baseline remedy line"
else
  bad "M1 mutation did NOT land — every M1 result below would be vacuous"
fi
cp "$BAK" "$LIB"
node scripts/tests/empty-body.test.mjs >/dev/null 2>&1 && ok "M1 restore: GREEN again" || bad "M1 restore failed"

# --- M2: a NEW real empty catch must still break the ratchet at the current floor.
cat > "$FIXTURE" <<'TS'
export function mp480Fixture() {
  try { JSON.parse("{}"); } catch { /* proof fixture */ }
}
TS
if [ -f "$FIXTURE" ]; then
  ok "M2 fixture LANDED ($FIXTURE)"
  node scripts/check-empty-catch.mjs >/dev/null 2>&1
  [ "$?" = "1" ] && ok "M2: a 52nd comment-bodied swallow takes the guard to exit 1" || bad "M2: guard did not fail on a new empty catch"
else
  bad "M2 fixture did not land"
fi
rm -f "$FIXTURE"
node scripts/check-empty-catch.mjs >/dev/null 2>&1 && ok "M2 restore: guard GREEN again" || bad "M2 restore failed"

echo "MP-480 proof: $pass passed, $fail failed"
[ "$fail" = "0" ] || exit 1
