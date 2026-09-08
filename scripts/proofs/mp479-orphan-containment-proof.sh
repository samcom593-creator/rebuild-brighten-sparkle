#!/usr/bin/env bash
# MP-479 — proof harness for check:orphan-mirror-containment.
#
# Every mutation here is chosen so it can NEVER create a directory under
# supabase/functions/. That directory is the one place a file becomes
# deployable, and a proof harness for a containment guard must not be the thing
# that breaches containment. M6 therefore renames a manifest slug to one that
# ALREADY has real source (daily-brief, paid down by MP-476) instead of
# creating a decoy function directory.
#
# The harness asserts (a) it can invoke the guard at all, (b) each mutation
# LANDED, and (c) the guard is green again at the end. MP-479's first attempt
# expanded the guard command from a string variable, every invocation exited
# 127, and all four cases reported FAIL while proving nothing — a harness that
# cannot run reports failure just as confidently as one that ran.
set -uo pipefail
cd "$(dirname "$0")/../.."

GUARD=scripts/check-orphan-mirror-containment.mjs
MANIFEST=scripts/data/deployed-function-orphans.json
BAK=$(mktemp); cp "$MANIFEST" "$BAK"
PASS=0; FAIL=0

guard() { node "$GUARD" 2>&1; }

# (a) the harness must be able to run the guard, green, before any mutation
if ! guard >/dev/null 2>&1; then
  echo "ABORT — guard is not green before mutations; proof would be meaningless"; exit 1
fi
echo "precondition: guard invokable and GREEN"

expect_red() {
  local desc="$1" needle="$2" out code
  out=$(guard); code=$?
  if [ "$code" -eq 127 ]; then
    echo "  FAIL  $desc — guard could not be invoked (127); result is vacuous"; FAIL=$((FAIL+1)); return
  fi
  if [ "$code" -ne 0 ] && printf '%s' "$out" | grep -qi -- "$needle"; then
    echo "  PASS  $desc"; PASS=$((PASS+1))
  else
    echo "  FAIL  $desc (exit=$code, needle '$needle' absent)"; printf '%s\n' "$out" | head -5; FAIL=$((FAIL+1))
  fi
}

echo "M3: manifest points a mirror INSIDE supabase/functions/"
python3 -c "
import json,sys
p='$MANIFEST'; d=json.load(open(p))
d['orphans'][0]['recovered_mirror']['path']='supabase/functions/create-va-account/index.ts'
json.dump(d,open(p,'w'),indent=2)
sys.exit(0 if 'supabase/functions/create-va-account/index.ts' in open(p).read() else 1)" \
  && echo "  mutation landed" || { echo "  MUTATION DID NOT LAND"; FAIL=$((FAIL+1)); }
expect_red "containment: mirror inside the deploy path" "INSIDE supabase/functions"
cp "$BAK" "$MANIFEST"

echo "M4: mirror body edited (evidence tampered)"
M=supabase/_recovered-orphans/set-va-account/index.ts
MB=$(mktemp); cp "$M" "$MB"
printf '\nconsole.log("mp479 tamper");\n' >> "$M"
grep -q "mp479 tamper" "$M" && echo "  mutation landed" || { echo "  MUTATION DID NOT LAND"; FAIL=$((FAIL+1)); }
expect_red "integrity: body no longer matches manifest sha" "no longer matches the manifest"
cp "$MB" "$M"; rm -f "$MB"

echo "M5: unlisted mirror directory on disk"
mkdir -p supabase/_recovered-orphans/mp479-ungoverned
echo "// scratch" > supabase/_recovered-orphans/mp479-ungoverned/index.ts
[ -f supabase/_recovered-orphans/mp479-ungoverned/index.ts ] && echo "  mutation landed" || { echo "  MUTATION DID NOT LAND"; FAIL=$((FAIL+1)); }
expect_red "drift: dir on disk with no manifest entry" "ungoverned mirror"
rm -rf supabase/_recovered-orphans/mp479-ungoverned

echo "M6: slug listed as orphan while real source exists"
if [ ! -d supabase/functions/daily-brief ]; then
  echo "  SKIP — supabase/functions/daily-brief absent; M6's premise is gone, re-point it at another paid-down slug"
else
  python3 -c "
import json,sys
p='$MANIFEST'; d=json.load(open(p))
d['orphans'][0]['slug']='daily-brief'
json.dump(d,open(p,'w'),indent=2)
sys.exit(0 if '\"slug\": \"daily-brief\"' in open(p).read() else 1)" \
    && echo "  mutation landed" || { echo "  MUTATION DID NOT LAND"; FAIL=$((FAIL+1)); }
  expect_red "double-life: graded as evidence AND armed for deploy" "armed for deploy at once"
  cp "$BAK" "$MANIFEST"
fi

cp "$BAK" "$MANIFEST"; rm -f "$BAK"
if guard >/dev/null 2>&1; then echo "postcondition: guard GREEN again after all restores"
else echo "  FAIL  restore incomplete — guard still red"; FAIL=$((FAIL+1)); fi

echo "MP-479 containment proof: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
