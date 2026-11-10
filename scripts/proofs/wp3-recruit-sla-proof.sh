#!/usr/bin/env bash
# WP3 recruit SLA proof runner. Sends "begin; [migration]; proof" to bot-sql; the proof's
# DO block always RAISES its result, so the transaction is rolled back and nothing
# commits or sends. Exit 0 only on verdict PASS.
#   --with-migration FILE   apply FILE inside the same rolled-back transaction first
#                           (pre-apply dry run); omit it once the migration is live.
#   --selftest              plant a failure (drop the role guard inside the tx) and
#                           require the harness to report FAIL, so a PASS means something.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PROOF="$HERE/wp3-recruit-sla-proof.sql"
URL_FILE="$HOME/.config/apex-creds/bot-sql.url"
TOK_FILE="$HOME/.config/apex-creds/bot-sql.token"
MIG=""
SELFTEST=0
while [ $# -gt 0 ]; do
  case "$1" in
    --with-migration) MIG="$2"; shift 2 ;;
    --selftest) SELFTEST=1; shift ;;
    *) echo "unknown arg $1" >&2; exit 2 ;;
  esac
done
[ -r "$URL_FILE" ] && [ -r "$TOK_FILE" ] || { echo "UNKNOWN: bot-sql creds unreadable" >&2; exit 3; }

SQL="begin;"
if [ -n "$MIG" ]; then SQL="$SQL
$(cat "$MIG")"; fi
if [ "$SELFTEST" = 1 ]; then
  # Planted violation = the pre-WP3 state: no role guard AND anon EXECUTE. (Re-granting
  # anon alone is still refused by the guard, so it would prove nothing.)
  PLANT='create or replace function public.cc_dispose_interview(p_id uuid, p_outcome text, p_notes text default null, p_followup_due_at timestamptz default null)
returns public.interview_events language plpgsql security definer set search_path to public as $plant$
declare v_row public.interview_events;
begin
  update public.interview_events set outcome = p_outcome where id = p_id returning * into v_row;
  if v_row.id is null then raise exception $m$interview_events row % not found$m$, p_id; end if;
  return v_row;
end $plant$;
grant execute on function public.cc_dispose_interview(uuid, text, text, timestamptz) to anon;'
  SQL="$SQL
$PLANT"
fi
SQL="$SQL
$(cat "$PROOF")"

OUT="$(python3 -c 'import json,sys; print(json.dumps({"query": sys.stdin.read()}))' <<<"$SQL" \
  | curl -s -m 120 -X POST "$(cat "$URL_FILE")" -H "Authorization: Bearer $(cat "$TOK_FILE")" \
         -H "Content-Type: application/json" --data-binary @-)"
RESULT="$(python3 -c '
import json, sys
raw = sys.stdin.read()
try:
    d = json.loads(raw)
except Exception:
    print("UNREADABLE " + raw[:300]); sys.exit(0)
err = d.get("error") or ""
if "WP3RESULT " not in err:
    print("NO_RESULT " + (err or raw)[:600]); sys.exit(0)
print(err.split("WP3RESULT ", 1)[1])
' <<<"$OUT")"
echo "$RESULT"
VERDICT="$(python3 -c '
import json, sys
s = sys.stdin.read().strip()
try:
    print(json.loads(s).get("verdict", "UNKNOWN"))
except Exception:
    print("UNKNOWN")
' <<<"$RESULT")"
if [ "$SELFTEST" = 1 ]; then
  if [ "$VERDICT" = "FAIL" ] && grep -q "cc_dispose_anon" <<<"$RESULT"; then
    echo "SELFTEST OK: planted anon grant was caught"; exit 0
  fi
  echo "SELFTEST BROKEN: planted violation not caught (verdict=$VERDICT)"; exit 1
fi
[ "$VERDICT" = "PASS" ] && { echo "PASS"; exit 0; }
echo "VERDICT=$VERDICT"; exit 1
