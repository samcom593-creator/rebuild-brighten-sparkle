#!/usr/bin/env bash
# MP-361 proof harness for check:realtime-invalidate-coalesce.
#
# Runs the REAL guard (never a reimplementation) against mutated working copies
# of the real source, restoring every file on exit. Each mutation asserts it
# LANDED before the verdict is believed — a sed that matched nothing produces a
# green that proves nothing (MP-284/MP-360).
set -uo pipefail
cd "$(dirname "$0")/../.."
GUARD=scripts/check-realtime-invalidate-coalesce.mjs
IMO=src/components/dashboard/ImoByAgency.tsx
STRIKES=src/pages/AdminStrikes.tsx
PASS=0; FAIL=0
BK=$(mktemp -d)
cp "$IMO" "$BK/imo" ; cp "$STRIKES" "$BK/strikes"
restore() { cp "$BK/imo" "$IMO"; cp "$BK/strikes" "$STRIKES"; rm -rf "$BK"; }
trap restore EXIT

ok(){ PASS=$((PASS+1)); echo "  PASS $1"; }
no(){ FAIL=$((FAIL+1)); echo "  FAIL $1"; }
run(){ node "$GUARD" >/tmp/mp361.out 2>&1; echo $?; }

echo "== C1: unmutated tree is green =="
[ "$(run)" = "0" ] && ok "guard green on HEAD+fix" || { no "guard red on clean tree"; cat /tmp/mp361.out; }
grep -q "37 subscription site" /tmp/mp361.out && ok "population 37, not truncated" || no "site count moved — re-read before trusting"

echo "== M1: strip coalesceMs from the PROVEN stampede site (deals @ ImoByAgency) =="
perl -0pi -e 's/\{ table: "deals", channelSuffix: "imo-agency", coalesceMs: COALESCE_MS \}/{ table: "deals", channelSuffix: "imo-agency" }/' "$IMO"
if grep -q 'table: "deals", channelSuffix: "imo-agency" }' "$IMO"; then
  ok "M1 mutation landed"
  [ "$(run)" != "0" ] && ok "M1 guard goes RED" || no "M1 guard stayed green — it does not watch the site it was written for"
  grep -q 'ImoByAgency.tsx' /tmp/mp361.out && ok "M1 names the offending file" || no "M1 red but does not name the file"
else no "M1 mutation did NOT land — verdict discarded"; fi
cp "$BK/imo" "$IMO"

echo "== M2: fungibility — a NEW table on an already-tolerated file+handler =="
# AdminStrikes::inline::agent_strikes is baselined. Add a sibling inline
# subscription on a different table. A file::handler key would inherit the
# tolerance; the file::handler::table key must not.
perl -0pi -e 's/(useRealtimeTable\(\{ table: "agent_strikes")/useRealtimeTable({ table: "deals", channelSuffix: "strikes" }, () => { queryClient.invalidateQueries({ queryKey: ["x"] }); });\n  $1/' "$STRIKES"
if grep -q 'table: "deals", channelSuffix: "strikes"' "$STRIKES"; then
  ok "M2 mutation landed"
  [ "$(run)" != "0" ] && ok "M2 guard goes RED on the new table" || no "M2 green — tolerance is fungible across tables"
  grep -q 'AdminStrikes.tsx' /tmp/mp361.out && ok "M2 names AdminStrikes" || no "M2 red without naming the file"
else no "M2 mutation did NOT land — verdict discarded"; fi
cp "$BK/strikes" "$STRIKES"

echo "== C2: restored tree is green again =="
[ "$(run)" = "0" ] && ok "green restored (mutations fully reverted)" || no "tree left dirty by the harness"

echo "-- $PASS pass / $FAIL fail --"
[ "$FAIL" -eq 0 ]
