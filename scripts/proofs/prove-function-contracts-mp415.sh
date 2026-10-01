#!/usr/bin/env bash
# MP-415 proof: the allowlist can no longer be satisfied by a name alone.
#
# Every case asserts its MUTATION LANDED before any verdict is believed. The
# recorded reason: a red-proof in this repo once printed EXIT=0 GREEN because
# backticks in an unquoted heredoc ate the mutation, and a mutation proof that
# silently does nothing passes while proving nothing.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
G=scripts/check-function-contracts.mjs
L=scripts/lib/in-handler-gate.mjs
GB=$(mktemp); LB=$(mktemp); cp "$G" "$GB"; cp "$L" "$LB"
PASS=0; FAIL=0
restore() { cp "$GB" "$G"; cp "$LB" "$L"; }
trap 'restore; rm -f "$GB" "$LB"' EXIT

run() { node "$G" 2>&1; }

# want_red <case> <bucket> ; want_green <case>
want_red() {
  local name="$1" bucket="$2" out
  out=$(run)
  if grep -q "^${bucket}: \|❌ ${bucket}" <<<"$out"; then
    echo "  PASS  $name -> RED on $bucket"; PASS=$((PASS+1))
  else
    echo "  FAIL  $name -> expected RED on $bucket, got:"; grep -E "✅|❌" <<<"$out" | sed 's/^/        /'; FAIL=$((FAIL+1))
  fi
}
want_green() {
  local name="$1" out
  out=$(run)
  if grep -q "No new edge-function contract violations" <<<"$out"; then
    echo "  PASS  $name -> GREEN"; PASS=$((PASS+1))
  else
    echo "  FAIL  $name -> expected GREEN, got:"; grep -E "❌" <<<"$out" | sed 's/^/        /'; FAIL=$((FAIL+1))
  fi
}
# A red in the right BUCKET is not proof when several mutations share a bucket:
# the verdict must name the function the case is about. Recorded reason (MP-413):
# fixtures accumulated, the positive gate went red for ANOTHER fixture's reason,
# and a red that proves nothing about its own case is worse than no gate.
want_red_naming() {
  local name="$1" bucket="$2" fn="$3" out
  out=$(run)
  if grep -E "❌ ${bucket}" <<<"$out" >/dev/null && grep -E "'${fn}'" <<<"$out" >/dev/null; then
    echo "  PASS  $name -> RED on $bucket naming '$fn'"; PASS=$((PASS+1))
  else
    echo "  FAIL  $name -> expected RED on $bucket naming '$fn', got:"; grep -E "❌|   - " <<<"$out" | sed 's/^/        /'; FAIL=$((FAIL+1))
  fi
}

# assert a mutation actually changed the file it claims to change
landed() {
  local name="$1" file="$2" backup="$3"
  if cmp -s "$file" "$backup"; then
    echo "  FAIL  $name -> MUTATION DID NOT LAND ($file unchanged); verdict below would be vacuous"; FAIL=$((FAIL+1)); return 1
  fi
  return 0
}

echo "== G0 baseline: the tree as shipped =="
want_green "shipped tree"

echo
echo "== M1 the youtube-auth case: an UNGATED function claiming in_handler_gate =="
# poke-webhook reads no caller credential at all (measured, MP-415). Under the
# old guard, moving it between categories was invisible: both were just
# membership in one Set.
restore
python3 - <<'PY'
import io;p="scripts/check-function-contracts.mjs";s=io.open(p,encoding="utf8").read()
s=s.replace('"poke-webhook": "public_by_design",','"poke-webhook": "in_handler_gate",',1)
io.open(p,"w",encoding="utf8").write(s)
PY
if landed "M1" "$G" "$GB"; then want_red_naming "M1 ungated fn claims in_handler_gate" "allowlist_gate_unproven" "poke-webhook"; fi

echo
echo "== M2 an allowlisted name with NO declared contract (the old standard) =="
restore
python3 - <<'PY'
import io;p="scripts/check-function-contracts.mjs";s=io.open(p,encoding="utf8").read()
s=s.replace('  "youtube-auth": "in_handler_gate",\n','',1)
io.open(p,"w",encoding="utf8").write(s)
PY
if landed "M2" "$G" "$GB"; then want_red_naming "M2 allowlisted, undeclared" "allowlist_undeclared" "youtube-auth"; fi

echo
echo "== M3 a 14th gateless endpoint, ceiling not raised =="
restore
python3 - <<'PY'
import io;p="scripts/check-function-contracts.mjs";s=io.open(p,encoding="utf8").read()
s=s.replace('  "content-share": "url_token",','  "content-share": "public_by_design",',1)
io.open(p,"w",encoding="utf8").write(s)
PY
if landed "M3" "$G" "$GB"; then want_red "M3 over the gateless ceiling" "public_by_design_over_ceiling"; fi

echo
echo "== M4 restore the pre-MP-415 refusal pattern (status: only) =="
# brand-photo-upload gates correctly and refuses with json(body, 401). If only
# `status: 40x` counts, its in_handler_gate claim must fail -- which is what the
# detector did before this wave widened it.
restore
python3 - <<'PY'
import io;p="scripts/lib/in-handler-gate.mjs";s=io.open(p,encoding="utf8").read()
s=s.replace('/status\\s*:\\s*40[13]\\b|,\\s*40[13]\\s*\\)|\\bthrow\\b/','/status\\s*:\\s*40[13]\\b|\\bthrow\\b/',1)
io.open(p,"w",encoding="utf8").write(s)
PY
if landed "M4" "$L" "$LB"; then want_red_naming "M4 positional-401 blindness" "allowlist_gate_unproven" "brand-photo-upload"; fi

echo
echo "== M5 delete the MAC_VERIFY convention =="
# youtube-auth holds no === against a header anywhere; the comparison IS the MAC
# verification. Without this leg, MP-412's proven-live gate reads as absent.
restore
python3 - <<'PY'
import io;p="scripts/lib/in-handler-gate.mjs";s=io.open(p,encoding="utf8").read()
s=s.replace('    MAC_VERIFY: macVerifyGateAt(code),','    MAC_VERIFY: Infinity,',1)
io.open(p,"w",encoding="utf8").write(s)
PY
if landed "M5" "$L" "$LB"; then want_red_naming "M5 MAC_VERIFY load-bearing" "allowlist_gate_unproven" "youtube-auth"; fi

echo
echo "== M6 tree restored byte-identical, and green again =="
restore
if cmp -s "$G" "$GB" && cmp -s "$L" "$LB"; then
  echo "  PASS  both files restored byte-identical"; PASS=$((PASS+1))
else
  echo "  FAIL  files NOT restored"; FAIL=$((FAIL+1))
fi
want_green "restored tree"

echo
echo "================================"
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
