#!/usr/bin/env bash
# prove-gate-detector-mp416 — MP-416
#
# Proves the migration of check-credential-minting.mjs onto
# scripts/lib/in-handler-gate.mjs (a) moved no verdict, (b) did NOT open the hole
# MP-357 refused, and (c) that each newly inherited convention is load-bearing in
# THIS guard rather than only in its sibling.
#
# Fixtures live in the REAL tree because the scanner hardcodes supabase/functions
# and refuses to vouch below 100 functions — a stub tree would prove the harness,
# not the ship. Fixtures are EXCLUSIVE (each clears the last), because MP-413
# recorded a run where they accumulated and a POSITIVE gate went red for another
# fixture's reason: a red that proves nothing about its own case is worse than no
# gate.
set -uo pipefail
cd "$(dirname "$0")/../.."

CM=scripts/check-credential-minting.mjs
GD=scripts/check-gate-detector-copies.mjs
MOD=scripts/lib/in-handler-gate.mjs
FIXROOT=supabase/functions
FIX=""
PASS=0; FAIL=0
BK=$(mktemp -d)
cp "$CM" "$BK/cm"; cp "$MOD" "$BK/mod"; cp "$GD" "$BK/gd"

ok(){ PASS=$((PASS+1)); echo "  PASS  $1"; }
no(){ FAIL=$((FAIL+1)); echo "  FAIL  $1"; }

mkfix(){ rmfix; FIX="$FIXROOT/zz-mp416-fixture"; mkdir -p "$FIX"; cat > "$FIX/index.ts"; }
rmfix(){ [ -n "$FIX" ] && rm -rf "$FIX"; FIX=""; }
cm(){ node "$CM" 2>&1; }
restore(){ cp "$BK/cm" "$CM"; cp "$BK/mod" "$MOD"; cp "$BK/gd" "$GD"; }
trap 'rmfix; restore' EXIT

echo "=== G1 baseline: the tree is green AND the annotation list is non-empty"
BASE=$(cm); RC=$?
# A 'no difference' diff between two empty outputs is the vacuous proof this bot
# has shipped before. Assert the content exists before trusting any comparison.
if [ $RC -eq 0 ] && [ "$(printf '%s\n' "$BASE" | grep -c '^  - ')" -ge 12 ] \
   && printf '%s\n' "$BASE" | grep -q 'cron-newhire-portal-login \[SHARED_SECRET\]' \
   && printf '%s\n' "$BASE" | grep -q 'verify-magic-link \[SELECTOR\]'; then
  ok "green with $(printf '%s\n' "$BASE" | grep -c '^  - ') annotated functions, incl. the SHARED_SECRET and SELECTOR cases"
else
  no "baseline is not a populated green (rc=$RC) — every later verdict would be vacuous"; echo "$BASE"
fi

echo "=== G2 NEGATIVE: an ungated minter that RETURNS the credential is refused, by name"
mkfix <<'EOF'
const handler = async (req: Request) => {
  const email = (await req.json()).email;
  const { data } = await supabase.auth.admin.generateLink({ type: "magiclink", email });
  return new Response(JSON.stringify({ action_link: data.properties.action_link }));
};
Deno.serve(handler);
EOF
OUT=$(cm); RC=$?
if [ $RC -ne 0 ] && printf '%s\n' "$OUT" | grep -q "zz-mp416-fixture"; then
  ok "refused and NAMES itself"
else no "an ungated returner passed, or the red did not name it (rc=$RC)"; fi

echo "=== G3 NEGATIVE: MP-357's hole stays shut — reading the header then minting anyway"
mkfix <<'EOF'
const handler = async (req: Request) => {
  const got = req.headers.get("x-cron-secret");
  console.log("secret length", got?.length);
  const email = (await req.json()).email;
  const { data } = await supabase.auth.admin.generateLink({ type: "magiclink", email });
  return new Response(JSON.stringify({ action_link: data.properties.action_link }));
};
Deno.serve(handler);
EOF
OUT=$(cm); RC=$?
if [ $RC -ne 0 ] && printf '%s\n' "$OUT" | grep -q "zz-mp416-fixture"; then
  ok "a bare header read is still not a gate"
else no "the migration acquitted a look-then-mint function (rc=$RC)"; fi

echo "=== G4 POSITIVE: shared secret refused POSITIONALLY — json(body, 401) — now acquits"
mkfix <<'EOF'
const handler = async (req: Request) => {
  const got = req.headers.get("x-cron-secret");
  const want = Deno.env.get("NEWHIRE_CRON_SECRET");
  if (got !== want) return json({ error: "Wrong code." }, 401);
  const email = (await req.json()).email;
  const { data } = await supabase.auth.admin.generateLink({ type: "magiclink", email });
  return new Response(JSON.stringify({ action_link: data.properties.action_link }));
};
Deno.serve(handler);
EOF
OUT=$(cm); RC=$?
if [ $RC -eq 0 ] && printf '%s\n' "$OUT" | grep -q "zz-mp416-fixture \[SHARED_SECRET\]"; then
  ok "acquitted via SHARED_SECRET on the positional refusal shape"
else no "positional refusal not recognised (rc=$RC)"; printf '%s\n' "$OUT" | grep zz-mp416 || true; fi

echo "=== G5 POSITIVE: a MAC-verified selector now acquits (youtube-auth's convention)"
mkfix <<'EOF'
const handler = async (req: Request) => {
  const secret = Deno.env.get("YT_STATE_SECRET");
  const good = await verifyHex(secret, new URL(req.url).searchParams.get("state"));
  if (!good) return new Response("bad state", { status: 401 });
  const email = (await req.json()).email;
  const { data } = await supabase.auth.admin.generateLink({ type: "magiclink", email });
  return new Response(JSON.stringify({ action_link: data.properties.action_link }));
};
Deno.serve(handler);
EOF
OUT=$(cm); RC=$?
if [ $RC -eq 0 ] && printf '%s\n' "$OUT" | grep -q "zz-mp416-fixture \[MAC_VERIFY\]"; then
  ok "acquitted via MAC_VERIFY"
else no "MAC_VERIFY not recognised by this guard (rc=$RC)"; printf '%s\n' "$OUT" | grep zz-mp416 || true; fi

echo "=== G6 NEGATIVE: ordering survived the migration — a gate BELOW the mint guards nothing"
mkfix <<'EOF'
const handler = async (req: Request) => {
  const email = (await req.json()).email;
  const { data } = await supabase.auth.admin.generateLink({ type: "magiclink", email });
  const user = await requireAuth(req);
  return new Response(JSON.stringify({ action_link: data.properties.action_link }));
};
Deno.serve(handler);
EOF
OUT=$(cm); RC=$?
if [ $RC -ne 0 ] && printf '%s\n' "$OUT" | grep -q "zz-mp416-fixture"; then
  ok "a gate under the mint is still refused"
else no "ordering contract lost in the migration (rc=$RC)"; fi
rmfix

echo "=== G7 the single-source guard SEES a planted second copy"
printf '\nfunction sharedSecretGateAt(code) { return Infinity; }\n' >> "$CM"
OUT=$(node "$GD" 2>&1); RC=$?
grep -q "^function sharedSecretGateAt" "$CM" || no "G7 mutation never landed — verdict would be meaningless"
if [ $RC -ne 0 ] && printf '%s\n' "$OUT" | grep -q "check-credential-minting.mjs defines sharedSecretGateAt"; then
  ok "planted copy caught and named"
else no "a second copy passed the single-source guard (rc=$RC)"; fi
cp "$BK/cm" "$CM"

echo "=== G8 the single-source guard fails when a consumer stops importing it"
python3 - <<'PY'
import io
p="scripts/check-credential-minting.mjs"; s=io.open(p,encoding="utf8").read()
s=s.replace('} from "./lib/in-handler-gate.mjs";','} from "./lib/NOPE.mjs";',1)
io.open(p,"w",encoding="utf8").write(s)
PY
grep -q 'lib/NOPE.mjs' "$CM" || no "G8 mutation never landed"
OUT=$(node "$GD" 2>&1); RC=$?
if [ $RC -ne 0 ] && printf '%s\n' "$OUT" | grep -q "without importing the shared answer"; then
  ok "an unwired consumer is caught (green on a repo with no shared source is impossible)"
else no "unwired consumer passed (rc=$RC)"; fi
cp "$BK/cm" "$CM"

echo "=== M1 MUTATION: revert the module's REFUSAL vocabulary to pre-MP-415 — G4 must go RED"
python3 - <<'PY'
import io
p="scripts/lib/in-handler-gate.mjs"; s=io.open(p,encoding="utf8").read()
old='const REFUSAL = /status\\s*:\\s*40[13]\\b|,\\s*40[13]\\s*\\)|\\bthrow\\b/;'
assert old in s, "M1 anchor not found"
s=s.replace(old,'const REFUSAL = /status\\s*:\\s*40[13]\\b|\\bthrow\\b/;',1)
io.open(p,"w",encoding="utf8").write(s)
PY
grep -q 'REFUSAL = /status..s...s.40\[13\]..b|..bthrow..b/;' "$MOD" || grep -q ',\\s\*40\[13\]' "$MOD" && true
if grep -q ',\\s\*40\[13\]\\s\*\\)' "$MOD"; then no "M1 mutation never landed — the positional shape is still present"; else
  mkfix <<'EOF'
const handler = async (req: Request) => {
  const got = req.headers.get("x-cron-secret");
  const want = Deno.env.get("NEWHIRE_CRON_SECRET");
  if (got !== want) return json({ error: "Wrong code." }, 401);
  const email = (await req.json()).email;
  const { data } = await supabase.auth.admin.generateLink({ type: "magiclink", email });
  return new Response(JSON.stringify({ action_link: data.properties.action_link }));
};
Deno.serve(handler);
EOF
  OUT=$(cm); RC=$?
  if [ $RC -ne 0 ] && printf '%s\n' "$OUT" | grep -q "zz-mp416-fixture"; then
    ok "positional-refusal recognition is load-bearing IN THIS GUARD — reverting it convicts correct code"
  else no "M1: the positional shape was not load-bearing (rc=$RC)"; fi
  rmfix
fi
cp "$BK/mod" "$MOD"

echo "=== M2 MUTATION: drop MAC_VERIFY from this guard's table — G5 must go RED"
python3 - <<'PY'
import io
p="scripts/check-credential-minting.mjs"; s=io.open(p,encoding="utf8").read()
old="  MAC_VERIFY: macVerifyGateAt,\n"
assert old in s, "M2 anchor not found"
s=s.replace(old,"",1)
io.open(p,"w",encoding="utf8").write(s)
PY
if grep -q "MAC_VERIFY: macVerifyGateAt" "$CM"; then no "M2 mutation never landed"; else
  mkfix <<'EOF'
const handler = async (req: Request) => {
  const secret = Deno.env.get("YT_STATE_SECRET");
  const good = await verifyHex(secret, new URL(req.url).searchParams.get("state"));
  if (!good) return new Response("bad state", { status: 401 });
  const email = (await req.json()).email;
  const { data } = await supabase.auth.admin.generateLink({ type: "magiclink", email });
  return new Response(JSON.stringify({ action_link: data.properties.action_link }));
};
Deno.serve(handler);
EOF
  OUT=$(cm); RC=$?
  if [ $RC -ne 0 ] && printf '%s\n' "$OUT" | grep -q "zz-mp416-fixture"; then
    ok "MAC_VERIFY is load-bearing here, not decoration inherited from the sibling"
  else no "M2: dropping MAC_VERIFY changed nothing (rc=$RC)"; fi
  rmfix
fi
cp "$BK/cm" "$CM"

echo "=== M3 MUTATION: revert the boundIdents block-brace fix — G4 must go RED"
python3 - <<'PY2'
import io
p="scripts/lib/in-handler-gate.mjs"; s=io.open(p,encoding="utf8").read()
new=r"(?::\s*[^=;{]+)?=\s*((?:\$\{[^{}]*\}|[^;{]){0,300}?);"
old=r"(?::\s*[^=;]+)?=\s*([\s\S]{0,300}?);"
assert new in s, "M3 anchor not found"
io.open(p,"w",encoding="utf8").write(s.replace(new, old, 1))
PY2
if grep -q 'S\]{0,300}?);' "$MOD"; then
  mkfix <<'EOF'
const handler = async (req: Request) => {
  const got = req.headers.get("x-cron-secret");
  const want = Deno.env.get("NEWHIRE_CRON_SECRET");
  if (got !== want) return json({ error: "Wrong code." }, 401);
  const email = (await req.json()).email;
  const { data } = await supabase.auth.admin.generateLink({ type: "magiclink", email });
  return new Response(JSON.stringify({ action_link: data.properties.action_link }));
};
Deno.serve(handler);
EOF
  OUT=$(cm); RC=$?
  if [ $RC -ne 0 ] && printf '%s\n' "$OUT" | grep -q "zz-mp416-fixture"; then
    ok "the block-brace exclusion is load-bearing — without it the handler declaration eats its own first statement and correct code is convicted"
  else no "M3: reverting boundIdents changed nothing (rc=$RC)"; fi
  rmfix
else no "M3 mutation never landed"; fi
cp "$BK/mod" "$MOD"

echo "=== G9 restored byte-identical, no fixture left behind, tree green"
restore
R=0
cmp -s "$BK/cm" "$CM" || { no "check-credential-minting.mjs not restored"; R=1; }
cmp -s "$BK/mod" "$MOD" || { no "in-handler-gate.mjs not restored"; R=1; }
cmp -s "$BK/gd" "$GD" || { no "check-gate-detector-copies.mjs not restored"; R=1; }
[ -d "$FIXROOT/zz-mp416-fixture" ] && { no "fixture left in the tree"; R=1; }
FIN=$(cm); FRC=$?
GDO=$(node "$GD" 2>&1); GRC=$?
if [ $R -eq 0 ] && [ $FRC -eq 0 ] && [ $GRC -eq 0 ] && [ "$FIN" = "$BASE" ]; then
  ok "all three files byte-identical, 0 fixtures left, both guards green, output identical to baseline"
else
  no "restore/final state wrong (files=$R cm=$FRC gd=$GRC output-identical=$([ "$FIN" = "$BASE" ] && echo yes || echo no))"
fi

echo
echo "prove-gate-detector-mp416: PASS=$PASS FAIL=$FAIL"
[ $FAIL -eq 0 ] || exit 1
