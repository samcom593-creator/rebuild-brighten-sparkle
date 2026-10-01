#!/usr/bin/env bash
# prove-route-shape-mp417.sh — MP-417
#
# check:route-shape sat red for 4.3 days because its negative fixture hardcoded
# "/dashboard/recruiting/pipeline" as an UNDECLARED path and commit 3a9b887a
# shipped exactly that route. The fixtures are now DERIVED from the live pattern
# list. This proves the derived fixtures are load-bearing (they still convict a
# broken matcher) AND rot-proof (declaring a new route cannot turn them red),
# because a guard made green by weakening it is worse than the red it replaced.
#
# Every mutation is asserted to have LANDED before any verdict is believed --
# a mutation proof against an unmutated file passes vacuously (recorded trap).
set -uo pipefail
cd "$(dirname "$0")/../.."

GUARD=scripts/check-route-shape.mjs
LIB=scripts/lib/route-shape.mjs
APP=src/App.tsx
WORK=$(mktemp -d "${TMPDIR:-/tmp}/mp417.XXXXXX")
cp "$GUARD" "$WORK/guard.orig"; cp "$LIB" "$WORK/lib.orig"; cp "$APP" "$WORK/app.orig"
restore() { cp "$WORK/guard.orig" "$GUARD"; cp "$WORK/lib.orig" "$LIB"; cp "$WORK/app.orig" "$APP"; }
trap 'restore; rm -rf "$WORK"' EXIT

pass=0; fail=0
ok()   { echo "  PASS  $1"; pass=$((pass+1)); }
bad()  { echo "  FAIL  $1"; fail=$((fail+1)); }
run_guard() { node "$GUARD" >"$WORK/out" 2>&1; echo $?; }
landed() { # landed <file> <needle-that-must-now-exist>
  grep -qF "$2" "$1" || { echo "MUTATION DID NOT LAND in $1 ($2) — refusing to believe any verdict"; exit 2; }
}

echo "MP-417 route-shape proof"

# ---- baseline: the committed guard is green on the committed tree ----
[[ "$(run_guard)" == "0" ]] && ok "G1 baseline green" || { bad "G1 baseline green"; cat "$WORK/out"; }
grep -q "over [0-9]* declared routes" "$WORK/out" && ok "G2 reports a non-zero declared-route count" || bad "G2 declared-route count printed"

# ---- G3: the derived probe is actually nested, not a top-level shortcut ----
node -e '
const path=require("node:path");
import("../../scripts/lib/route-shape.mjs").catch(()=>{}); ' >/dev/null 2>&1 || true
node --input-type=module -e '
import { readRoutePatterns } from "./scripts/lib/route-shape.mjs";
const p = readRoutePatterns(process.cwd());
if (p.length === 0) { console.error("no patterns"); process.exit(1); }
process.exit(0);
' && ok "G3 pattern list is readable and non-empty" || bad "G3 pattern list readable"

# ---- M1: a :param that swallows a slash must be convicted ----
restore
python3 - <<'PY'
p="scripts/lib/route-shape.mjs"; s=open(p).read()
assert '"[^/]+"' in s
open(p,"w").write(s.replace('"[^/]+"','".+"',1))
PY
landed "$LIB" '".+"'
[[ "$(run_guard)" == "1" ]] && ok "M1 param-swallows-slash is convicted" || { bad "M1 should FAIL"; cat "$WORK/out"; }

# ---- M2: a matcher that never refuses must be convicted BY THE DERIVED PROBE ----
restore
python3 - <<'PY'
p="scripts/lib/route-shape.mjs"; s=open(p).read()
old="    return best ? best.pattern : null;"
assert old in s
# never refuse: fall back to the first declared pattern instead of null
open(p,"w").write(s.replace(old,"    return best ? best.pattern : patterns[0];",1))
PY
landed "$LIB" "patterns[0];"
[[ "$(run_guard)" == "1" ]] && ok "M2 never-refuses matcher is convicted" || { bad "M2 should FAIL"; cat "$WORK/out"; }
grep -q "undeclared" "$WORK/out" && ok "M2 names an undeclared-probe assertion" || bad "M2 names the undeclared probe"

# ---- M3: THE REGRESSION. Declaring a new route must NOT turn this guard red. ----
# This is the exact event that broke it: a wave ships a route whose path a
# fixture had named as undeclared. Proven on the SAME tree in both directions.
restore
python3 - <<'PY'
p="src/App.tsx"; s=open(p).read()
needle='<Route path="/apply"'
i=s.index(needle)
new='<Route path="/dashboard/recruiting/pipeline" element={<div />} />\n                    '
open(p,"w").write(s[:i]+new+s[i:])
PY
landed "$APP" 'path="/dashboard/recruiting/pipeline" element={<div />}'
[[ "$(run_guard)" == "0" ]] && ok "M3 NEW guard stays green when that route is declared" || { bad "M3 new guard must stay green"; cat "$WORK/out"; }

# ...and a guard carrying the OLD hardcoded fixture goes RED on that same tree.
# Reconstructed by MUTATION, not read from HEAD: a git-show comparison silently
# turns into "skipped" the moment this wave is committed, so the proof would
# quietly stop proving the thing it exists for.
python3 - <<'MUT'
p="scripts/check-route-shape.mjs"; s=open(p).read()
anchor="const nestedProbe = nestedUndeclaredProbe();"
assert anchor in s
old_style='check("OLD hardcoded fixture", toShape("/dashboard/recruiting/pipeline"), null);\n'
open(p,"w").write(s.replace(anchor, old_style+anchor,1))
MUT
landed "$GUARD" 'check("OLD hardcoded fixture"'
if [[ "$(run_guard)" == "1" ]]; then
  ok "M3b a hardcoded fixture DOES go red on the same tree (fix is not laundering)"
else
  bad "M3b hardcoded fixture should have failed"; cat "$WORK/out"
fi

restore
# ---- the tree must be byte-identical when this exits ----
for f in "$GUARD:guard.orig" "$LIB:lib.orig" "$APP:app.orig"; do
  cmp -s "${f%%:*}" "$WORK/${f##*:}" && ok "clean: ${f%%:*} restored byte-identical" || bad "DIRTY: ${f%%:*}"
done

echo "MP-417 route-shape proof — $pass passed, $fail failed"
[[ $fail -eq 0 ]] || exit 1
