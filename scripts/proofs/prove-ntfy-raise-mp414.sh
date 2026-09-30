#!/usr/bin/env bash
# MP-414 — proof that a refused page is now reported as refused, and that the
# thing which reports it cannot be satisfied by anything short of a landed channel.
#
# The gates run the REAL shipped module under deno with an INJECTED fetch, so what
# is under test is supabase/functions/_shared/alert-raise.ts itself and never a
# reimplementation of it (a harness that restates the logic proves the harness).
#
# Most gates are NEGATIVE, because the risk of this wave runs one way: the defect
# being fixed is a refusal reported as a delivery, so the expensive failure is a
# false OK, not a false alarm.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 90

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); printf '  PASS  %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  FAIL  %s\n' "$1"; }
grade(){ if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1 (got '$2', want '$3')"; fi; }

RAISE=supabase/functions/_shared/alert-raise.ts
GUARD=scripts/check-ntfy-receipt.mjs
BRAIN=supabase/functions/cron-inbound-brain-health/index.ts
KEEP=supabase/functions/instagram-token-keepalive/index.ts

[[ -f $RAISE ]] || { echo "FATAL: $RAISE missing"; exit 91; }

# --- the driver. Boots the real module, injects a fetch, prints one word. -----
# stub kinds map to what the dispatcher could actually answer.
run_case() {  # $1=kind  -> prints "<ok>|<receipt>"
  cat > /tmp/mp414-drv.ts <<'TS'
import { raiseApexAlert } from "RAISE_URL";
const kind = Deno.args[0];
let calls = 0;
const stub = async (_u: string | URL, _i?: RequestInit): Promise<Response> => {
  calls++;
  const J = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });
  switch (kind) {
    // ntfy quota refusal surfaced by the dispatcher: 200, row written, nothing landed.
    case "none_landed":  return J({ ok: true, alert_id: "a1", dispatched: true,
                                    email_id: null, sent_sms: false, sent_discord: false, sent_ntfy: false });
    case "held":         return J({ ok: true, alert_id: "a2", dispatched: false, held: true });
    case "email_landed": return J({ ok: true, alert_id: "a3", dispatched: true,
                                    email_id: "prov-123", sent_sms: false, sent_discord: false, sent_ntfy: false });
    case "ntfy_only":    return J({ ok: true, alert_id: "a4", dispatched: true,
                                    email_id: null, sent_sms: false, sent_discord: false, sent_ntfy: true });
    case "http_429":     return new Response('{"code":42908,"error":"limit reached"}', { status: 429 });
    case "http_500":     return new Response("upstream boom", { status: 500 });
    case "throws":       throw new Error("connection reset");
    case "garbage_200":  return new Response("not json at all", { status: 200 });
  }
  return J({ ok: true });
};
const r = await raiseApexAlert({
  source: "mp414-proof", eventType: "proof", severity: "critical",
  subject: "proof", body: "proof",
  fetchImpl: stub as unknown as typeof fetch,
  sleepImpl: async () => {},
});
console.log(`${r.ok}|${r.receipt}|calls=${calls}`);
TS
  # Absolute file:// URL so the driver in /tmp resolves the REAL shipped module.
  local abs; abs="file://$(pwd)/$RAISE"
  perl -pi -e "s#RAISE_URL#\Q$abs\E#" /tmp/mp414-drv.ts 2>/dev/null \
    || sed -i '' "s|RAISE_URL|$abs|" /tmp/mp414-drv.ts
  # $2 = "nocreds" to prove the missing-credential branch.
  if [[ "${2:-}" == "nocreds" ]]; then
    env -u SUPABASE_URL -u SUPABASE_SERVICE_ROLE_KEY \
      deno run --quiet --allow-env /tmp/mp414-drv.ts "$1" 2>/dev/null
  else
    env SUPABASE_URL=https://x.test SUPABASE_SERVICE_ROLE_KEY=k \
      deno run --quiet --allow-env /tmp/mp414-drv.ts "$1" 2>/dev/null
  fi
}

echo "== G: the raiser can only say ok when a channel actually landed =="

R=$(run_case none_landed)
grade "200 with every channel false is NOT ok"            "${R%%|*}" "false"
case "$R" in *"NO channel landed"*) ok "…and the receipt says no channel landed";;
             *) bad "…receipt should name the no-channel case (got: $R)";; esac

R=$(run_case held)
grade "a queued/held alert is NOT a page"                 "${R%%|*}" "false"
case "$R" in *HELD*) ok "…and the receipt says HELD";; *) bad "…receipt should say HELD (got: $R)";; esac

R=$(run_case email_landed)
grade "email landing IS a delivery"                       "${R%%|*}" "true"
case "$R" in *"ok:email"*) ok "…and the receipt names the leg that carried it";;
             *) bad "…receipt should name email (got: $R)";; esac

R=$(run_case ntfy_only)
grade "ntfy landing alone IS a delivery"                  "${R%%|*}" "true"

echo "== G: refusals and faults are named, never laundered =="

R=$(run_case http_429)
grade "a 429 from the dispatcher is not ok"               "${R%%|*}" "false"
case "$R" in *42908*) ok "…and ntfy's own cause survives into the receipt";;
             *) bad "…429 body should reach the receipt (got: $R)";; esac
case "$R" in *"calls=1"*) ok "…and a 4xx is not retried (1 call)";;
             *) bad "…4xx must not retry (got: $R)";; esac

R=$(run_case http_500)
grade "a 5xx is not ok"                                   "${R%%|*}" "false"
case "$R" in *"calls=2"*) ok "…and a 5xx IS retried once (2 calls)";;
             *) bad "…5xx should retry (got: $R)";; esac

R=$(run_case throws)
grade "a transport throw is not ok"                       "${R%%|*}" "false"
case "$R" in *"error:"*) ok "…and it is labelled error: not http:";;
             *) bad "…transport fault should be error: (got: $R)";; esac

R=$(run_case garbage_200)
grade "an unparseable 200 is not ok"                      "${R%%|*}" "false"

echo "== G: a missing credential CLOSES, it does not fall through =="
R=$(run_case none_landed nocreds)
grade "no SUPABASE_URL/key is not ok"                     "${R%%|*}" "false"
case "$R" in *"no SUPABASE_URL"*) ok "…and it says which credential is absent";;
             *) bad "…should name the missing credential (got: $R)";; esac
case "$R" in *"calls=0"*) ok "…and it never reached the network";;
             *) bad "…must not call out without creds (got: $R)";; esac

echo "== G: the shared module cannot widen five other bundles =="
# MP-277's recorded trap: a raw grep matches this module's OWN comment, which
# explains that it deliberately does not import the SDK. Grade the comment-stripped
# source and only real import statements, never the word anywhere in the file.
if node --input-type=module -e "
import {stripComments} from './scripts/lib/strip-comments.mjs';
import fs from 'node:fs';
const src = stripComments(fs.readFileSync('$RAISE','utf8'));
const imports = [...src.matchAll(/(?:^|\n)\s*import\s[^;]*?from\s*[\"'\`]([^\"'\`]+)[\"'\`]/g)].map(m=>m[1]);
const sdk = imports.filter(x => /supabase-js/.test(x));
if (sdk.length) { console.error('imports SDK: '+sdk.join(',')); process.exit(1); }
// assert the gate is capable of failing: the same matcher must SEE a planted import.
const planted = 'import { createClient } from \"https://esm.sh/@supabase/supabase-js@2.45.0\";\n' + src;
const seen = [...planted.matchAll(/(?:^|\n)\s*import\s[^;]*?from\s*[\"'\`]([^\"'\`]+)[\"'\`]/g)].map(m=>m[1]);
if (!seen.some(x => /supabase-js/.test(x))) { console.error('matcher blind'); process.exit(2); }
" 2>/tmp/mp414-sdk.err; then
  ok "alert-raise.ts imports no supabase-js (matcher self-proven able to see one)"
else
  bad "alert-raise.ts SDK check: $(cat /tmp/mp414-sdk.err)"
fi

echo "== G: neither watchdog owns a bare ntfy push any more =="
for f in "$BRAIN" "$KEEP"; do
  # grade STRIPPED source so this harness does not repeat MP-277 (matching its
  # own prose) — the guard already strips, so reuse the guard as the oracle.
  if node -e "
import {stripComments} from './scripts/lib/strip-comments.mjs';
import fs from 'node:fs';
const s=stripComments(fs.readFileSync('$f','utf8'));
process.exit(/fetch\s*\(\s*NTFY_TOPIC/.test(s)?1:0);
" --input-type=module 2>/dev/null; then ok "$(basename "$(dirname "$f")") has no bare ntfy fetch"
  else bad "$(basename "$(dirname "$f")") still fetches NTFY_TOPIC directly"; fi
done

echo "== G: the repo guard agrees, and can still FAIL =="
if node "$GUARD" >/dev/null 2>&1; then ok "check:ntfy-receipt green (0 ungraded)"
else bad "check:ntfy-receipt red"; fi

echo
echo "gates: PASS=$PASS FAIL=$FAIL"
rm -f /tmp/mp414-drv.ts
[[ $FAIL -eq 0 ]] || exit 1
echo "ALL GATES PASS"
