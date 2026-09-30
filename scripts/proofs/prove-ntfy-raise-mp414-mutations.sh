#!/usr/bin/env bash
# MP-414 mutation proofs — each shows one piece of the fix is LOAD-BEARING, by
# removing it and watching the defect come back.
#
# Every mutation ASSERTS IT LANDED before any verdict is believed. A sed that
# silently matched nothing produces a green run that proves nothing; this bot has
# paid for that twice (MP-413's vacuous fixtures, MP-380's harness).
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 90

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  PASS  %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL  %s\n' "$1"; }

RAISE=supabase/functions/_shared/alert-raise.ts
BRAIN=supabase/functions/cron-inbound-brain-health/index.ts
GUARD=scripts/check-ntfy-receipt.mjs
BK=/tmp/mp414-mut-backup; mkdir -p $BK
cp "$RAISE" $BK/raise.ts; cp "$BRAIN" $BK/brain.ts

restore() { cp $BK/raise.ts "$RAISE"; cp $BK/brain.ts "$BRAIN"; }
trap restore EXIT

drive() {  # $1=kind -> "<ok>|<receipt>|calls=N"
  cat > /tmp/mp414-mdrv.ts <<TS
import { raiseApexAlert } from "file://$(pwd)/$RAISE";
let calls = 0;
const stub = async (): Promise<Response> => {
  calls++;
  return new Response(JSON.stringify({ ok: true, alert_id: "a1", dispatched: true,
    email_id: null, sent_sms: false, sent_discord: false, sent_ntfy: false }),
    { status: 200, headers: { "Content-Type": "application/json" } });
};
const r = await raiseApexAlert({
  source: "m", eventType: "m", severity: "critical", subject: "m", body: "m",
  fetchImpl: stub as unknown as typeof fetch, sleepImpl: async () => {},
});
console.log(\`\${r.ok}|\${r.receipt}|calls=\${calls}\`);
TS
  env SUPABASE_URL=https://x.test SUPABASE_SERVICE_ROLE_KEY=k \
    deno run --quiet --allow-env /tmp/mp414-mdrv.ts 2>/dev/null
}
drive_nocreds() {
  env -u SUPABASE_URL -u SUPABASE_SERVICE_ROLE_KEY \
    deno run --quiet --allow-env /tmp/mp414-mdrv.ts 2>/dev/null
}

echo "== baseline: the shipped tree =="
B=$(drive)
[[ "${B%%|*}" == "false" ]] && ok "shipped: 200-with-no-channel is NOT a delivery" \
  || bad "shipped baseline wrong: $B"
node "$GUARD" >/dev/null 2>&1 && ok "shipped: check:ntfy-receipt green" \
  || bad "shipped: guard already red"

echo
echo "== M1: put the pre-fix bare ntfy fetch back into the watchdog =="
restore
python3 - <<'PY'
import sys
p="supabase/functions/cron-inbound-brain-health/index.ts"
s=open(p).read()
# the exact shape that shipped before MP-414
pre = '''  if (!healthy) {
    try {
      await fetch(NTFY_TOPIC_M1, {
        method: "POST",
        headers: { "Title": "APEX DM responder is DOWN", "Priority": "5", "Tags": "warning" },
        body: `failed: ${detail}`,
      });
    } catch (_e) { /* swallowed */ }
  }
'''
i = s.index("  return new Response(JSON.stringify({ ok: true, healthy, detail")
s = s[:i] + 'const NTFY_TOPIC_M1 = "https://ntfy.sh/sams-agent-yrkv9kbqp9e987nb";\n' + pre + s[i:]
open(p,"w").write(s)
PY
# ASSERT THE MUTATION LANDED, on stripped source, before grading anything.
if node --input-type=module -e "
import {stripComments} from './scripts/lib/strip-comments.mjs';
import fs from 'node:fs';
const s=stripComments(fs.readFileSync('$BRAIN','utf8'));
process.exit(/fetch\s*\(\s*NTFY_TOPIC_M1/.test(s)?0:1);
" 2>/dev/null; then
  ok "M1 mutation landed (a bare ntfy fetch is present in stripped source)"
  if node "$GUARD" >/dev/null 2>&1; then
    bad "M1: guard stayed GREEN on a reinstated ungraded push — it is not load-bearing"
  else
    ok "M1: guard goes RED on the pre-fix shape (the fix is what makes it green)"
  fi
else
  bad "M1 mutation did NOT land — verdict withheld rather than believed"
fi
restore

echo
echo "== M2: grade only res.ok, ignoring which channels landed =="
python3 - <<'PY'
p="supabase/functions/_shared/alert-raise.ts"
s=open(p).read()
old='''        if (names.length > 0) {
          return { ok: true, receipt: `ok:${names.join("+")}`, alertId, landed };
        }'''
new='''        if (res.ok) {
          return { ok: true, receipt: `ok:${names.join("+")}`, alertId, landed };
        }'''
assert old in s, "M2 anchor missing"
open(p,"w").write(s.replace(old,new,1))
PY
if grep -q "if (res.ok) {" "$RAISE"; then
  ok "M2 mutation landed"
  R=$(drive)
  if [[ "${R%%|*}" == "true" ]]; then
    ok "M2: reports DELIVERED for a page no channel carried (channel check is load-bearing)"
  else
    bad "M2: still false — the channel check may be redundant ($R)"
  fi
else bad "M2 mutation did NOT land"; fi
restore

echo
echo "== M3: drop the missing-credential close =="
python3 - <<'PY'
p="supabase/functions/_shared/alert-raise.ts"
s=open(p).read()
old='''  if (!base || !key) {
    return { ok: false, receipt: "error:no SUPABASE_URL/SERVICE_ROLE_KEY in env", alertId: null, landed: { ...NONE } };
  }'''
assert old in s, "M3 anchor missing"
open(p,"w").write(s.replace(old,'  // MUTATED: credential close removed\n',1))
PY
if ! grep -q "no SUPABASE_URL/SERVICE_ROLE_KEY in env" "$RAISE"; then
  ok "M3 mutation landed"
  # rebuild the driver against the mutated module, then run with NO creds
  drive >/dev/null 2>&1
  R=$(drive_nocreds)
  case "$R" in
    *"calls=0"*) bad "M3: still never called out — the env guard is not load-bearing ($R)";;
    *)           ok "M3: with no credential it now calls out blind instead of closing ($R)";;
  esac
else bad "M3 mutation did NOT land"; fi
restore

echo
echo "== restored tree is byte-identical and green again =="
cmp -s "$RAISE" $BK/raise.ts && cmp -s "$BRAIN" $BK/brain.ts \
  && ok "both files restored byte-for-byte" || bad "restore drifted"
node "$GUARD" >/dev/null 2>&1 && ok "guard green after restore" || bad "guard red after restore"

echo
echo "mutations: PASS=$PASS FAIL=$FAIL"
rm -f /tmp/mp414-mdrv.ts
[[ $FAIL -eq 0 ]] || exit 1
echo "ALL MUTATION PROOFS PASS"
