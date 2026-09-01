#!/bin/bash
# Regenerate scripts/data/landing-truth-snapshot.json from the LIVE database.
#
# WHY (MP-370, 2026-09-01): check-landing-truth-floor.mjs guarded public
# fallbacks against HAND-TYPED ceilings. Ceilings only ever moved UP, because
# the instruction on them was "ratchet the ceiling up when truth grows". Truth
# does not only grow. applications_30d was 131 when the ceiling was set to 150;
# by 2026-09-01 it was 35, and the LiveStatsCounterStrip floor of 131 passed
# every CI run while rendering nearly four times the real number under a label
# reading "Live".
#
# A constant cannot survive a falling operand. So the ceiling is now derived
# from a measurement, this file takes the measurement, and apex-doctor re-asks
# the database directly so the snapshot itself cannot rot unnoticed.
#
# Run:  bash scripts/refresh-landing-truth.sh
set -euo pipefail
TOKEN_FILE="${HOME}/.config/apex-creds/bot-sql.token"
URL_FILE="${HOME}/.config/apex-creds/bot-sql.url"
[[ -r "$TOKEN_FILE" && -r "$URL_FILE" ]] || { echo "bot-sql credentials unreadable" >&2; exit 3; }
OUT="$(cd "$(dirname "$0")/.." && pwd)/scripts/data/landing-truth-snapshot.json"

RESP=$(curl -sS --max-time 60 -X POST "$(cat "$URL_FILE")" \
  -H "Authorization: Bearer $(cat "$TOKEN_FILE")" -H "Content-Type: application/json" \
  -d '{"query":"select public.landing_live_stats() as s"}')

python3 - "$RESP" "$OUT" <<'PY'
import json, sys, datetime
resp, out = sys.argv[1], sys.argv[2]
d = json.loads(resp)
if not d.get("ok") or not d.get("rows"):
    sys.exit(f"bot-sql did not return landing_live_stats: {resp[:300]}")
s = d["rows"][0]["s"]
keys = ["active_agents", "applications_30d", "carriers_partnered", "applications_total", "hires_recent"]
snap = {k: s[k] for k in keys if k in s}
missing = [k for k in keys if k not in s]
if missing:
    sys.exit(f"landing_live_stats() no longer returns {missing} — update this script and the guard together")
json.dump({
    "measured_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "source": "public.landing_live_stats()",
    "truth": snap,
}, open(out, "w"), indent=2)
print(f"wrote {out}: {snap}")
PY
