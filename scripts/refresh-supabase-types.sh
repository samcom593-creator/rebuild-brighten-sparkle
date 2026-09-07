#!/bin/bash
# Regenerate src/integrations/supabase/types.ts from the LIVE database.
#
# WHY THIS EXISTS (2026-09-07, MP-464)
#   For five consecutive bot fires the ledger carried this as an unclaimed root
#   cause, in these words: "types.ts is hand-maintained because the Supabase
#   Management PAT 401s in BOTH credential stores, so there is no regeneration
#   path and every edit drifts both ways." apex-doctor Check #63 states the same
#   thing as fact in its own header, and check-supabase-relation-types.mjs rests
#   its BASELINE=0 on the opposite assumption -- that types.ts IS regenerated
#   from the live catalog, so "absent from types.ts" means "absent from prod".
#
#   The premise was false. The search order had stopped at "PAT files on disk"
#   and never asked the authenticated Supabase connector already live in the
#   session. It regenerated all 4.69 MB on the first try. That is the same error
#   as reading "no Stripe API key on this machine" off a directory listing while
#   system_settings held a live sk_live_ key: a directory listing is not the
#   search order.
#
#   Measured drift at that moment, prod vs the committed types.ts, all ONE
#   direction (types.ts behind, never ahead -- 0 phantoms of any kind):
#     48 relations (25 tables + 23 views), 9 columns across 6 relations,
#     67 RPC functions. Enum values were identical both ways.
#
# WHAT THE THREE TOKEN STORES ACTUALLY RETURN
#   Re-measure rather than inherit; 401 and 403 are NOT the same answer.
#     supabase-pat.token              -> 401 Unauthorized  (dead credential)
#     supabase-pat.token.dead.2026...  -> 401 Unauthorized  (dead, and named so)
#     call-lab-deploy.token            -> 403 privileges    (AUTHENTICATES, but
#       the account lacks rights for this endpoint). A 403 is a live token. It
#       is not a path to types, but it is not evidence of a dead credential
#       either, and reporting it as "both stores 401" hid a third store.
#
# THIS SCRIPT NEVER FAKES SUCCESS
#   It writes types.ts only after the response parses as the real artifact. On
#   any failure it prints the measured status per store and exits non-zero with
#   the connector fallback spelled out, because a refresh script that leaves a
#   truncated or error-bodied types.ts behind is worse than one that refuses.
#
# Run:  bash scripts/refresh-supabase-types.sh
set -euo pipefail

REF="${SUPABASE_PROJECT_REF:-xrzweoneiieddzxogewk}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$REPO_ROOT/src/integrations/supabase/types.ts"
CREDS="$HOME/.config/apex-creds"
TMP="$(mktemp -t supabase-types)"
trap 'rm -f "$TMP"' EXIT

# Every candidate store, not just the two the ledger remembered.
CANDIDATES=(
  "$CREDS/supabase-pat.token"
  "$CREDS/call-lab-deploy.token"
)

echo "refresh-supabase-types: project $REF"
WON=""
for store in "${CANDIDATES[@]}"; do
  [[ -r "$store" ]] || { echo "  $(basename "$store") : absent"; continue; }
  tok="$(tr -d '\r\n' < "$store")"
  code="$(curl -s -o "$TMP" -w '%{http_code}' -m 120 \
    -H "Authorization: Bearer $tok" \
    "https://api.supabase.com/v1/projects/$REF/types/typescript" || echo 000)"
  # A 200 is necessary and not sufficient -- prove the BODY is the artifact.
  if [[ "$code" == "200" ]] && grep -q '"types"' "$TMP"; then
    echo "  $(basename "$store") : HTTP 200, body carries the artifact"
    WON="$store"; break
  fi
  echo "  $(basename "$store") : HTTP $code — $(head -c 90 "$TMP" 2>/dev/null)"
done

if [[ -z "$WON" ]]; then
  cat <<'FALLBACK' >&2

No token store could reach the types endpoint. This is NOT "there is no
regeneration path" -- that sentence cost five fires. The working path is:

  In a Claude session with the Supabase connector authenticated, call
  generate_typescript_types with project_id=xrzweoneiieddzxogewk. It returns
  {"types": "..."} as JSON. Decode the "types" value (json.loads, NOT a naive
  backslash replace -- the payload has no real newlines, 131,669 escaped ones)
  and write it to src/integrations/supabase/types.ts.

Then prove it before committing, in this order:
  node scripts/check-tsc-error-count.mjs        # read ITS verdict line, not $?
  node scripts/check-types-column-drift.mjs
  node scripts/check-supabase-relation-types.mjs

FALLBACK
  exit 1
fi

python3 - "$TMP" "$OUT" <<'PY'
import json, sys
raw = open(sys.argv[1]).read()
ts = json.loads(raw)["types"]
# Refuse a body that parsed but is not plausibly the artifact, rather than
# truncating types.ts and letting tsc report the damage later.
if "export type Database" not in ts or len(ts) < 1_000_000:
    sys.exit("refusing to write: response parsed but does not look like types.ts "
             "(%d chars, Database marker %s)" % (len(ts), "present" if "export type Database" in ts else "ABSENT"))
open(sys.argv[2], "w").write(ts)
print("wrote %s (%d chars)" % (sys.argv[2], len(ts)))
PY

echo
echo "types.ts refreshed. Now prove it — read each script's own verdict line:"
echo "  node scripts/check-tsc-error-count.mjs"
echo "  node scripts/check-types-column-drift.mjs"
echo "  node scripts/check-supabase-relation-types.mjs"
