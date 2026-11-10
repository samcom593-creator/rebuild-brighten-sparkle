#!/bin/bash
# Branch proof for apex-doctor drop-in #44 (WP3). Feeds fixture guard rows through the
# real drop-in (WP3_DROPIN_FIXTURE skips the network) and asserts each verdict, so a
# PASS means every branch is reachable and unreadable never reads green.
# bash 3.2 compatible. Exit 0 only when every case lands.
DROPIN="${1:-$HOME/business-ops/scripts/apex-doctor.d/44-recruit-sla.sh}"
[ -x "$DROPIN" ] || { echo "drop-in not found: $DROPIN"; exit 2; }
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

base='"lic_untouched_post":0,"lic_untouched_backlog":0,"new_untouched":0,"new_untouched_post":0,"queue_total":0,"guc_fns":0,"guc_crons":0,"anon_definer_unchecked":24,"manual_log_age_s":3600,"calls_14d":4,"outcomes_14d":4,"digest_receipt_age_s":3600,"pages_failed_7d":0,"pages_7d":1,"post_cutoff_no_owner":0,"cutoff_age_s":200000'
row() { printf '{"ok":true,"rows":[{%s}]}' "$1" > "$TMP/f.json"; }
pass=0; fail=0
check() { # name, expected emoji, extra env assignment (optional)
  if [ -n "$3" ]; then out=$(env WP3_DROPIN_FIXTURE="$TMP/f.json" "$3" /bin/bash "$DROPIN"); else out=$(WP3_DROPIN_FIXTURE="$TMP/f.json" /bin/bash "$DROPIN"); fi
  case "$out" in
    "$2"*) echo "ok   $1"; pass=$((pass+1)) ;;
    *) echo "FAIL $1 -> $out"; fail=$((fail+1)) ;;
  esac
}
row "$base";                                              check "all clean is OK" "🟢"
row "$(echo "$base" | sed 's/"lic_untouched_post":0/"lic_untouched_post":1/')"; check "post-go-live licensed untouched 24bh is CRITICAL" "🔴"
row "$(echo "$base" | sed 's/"guc_fns":0/"guc_fns":1/')"; check "a GUC reader is CRITICAL" "🔴"
row "$(echo "$base" | sed 's/"anon_definer_unchecked":24/"anon_definer_unchecked":25/')"; check "anon-definer growth (count fallback) is CRITICAL" "🔴"
row "$base"; check "anon-definer growth (exact diff) is CRITICAL" "🔴" 'WP3_DROPIN_ANON_JSON={"verdict":"CRITICAL","added":["new_fn()"],"removed":[]}'
row "$(echo "$base" | sed 's/"post_cutoff_no_owner":0/"post_cutoff_no_owner":2/')"; check "owner-less post-go-live app is CRITICAL" "🔴"
row "$(echo "$base" | sed 's/"new_untouched":0/"new_untouched":3/; s/"manual_log_age_s":3600/"manual_log_age_s":500000/')"; check "no human contact in 48h while recruits wait is WARN" "🟡"
row "$(echo "$base" | sed 's/"outcomes_14d":4/"outcomes_14d":1/')"; check "outcome coverage under 50% is WARN" "🟡"
row "$(echo "$base" | sed 's/"digest_receipt_age_s":3600/"digest_receipt_age_s":null/')"; check "no digest receipt after 26h is WARN" "🟡"
row "$(echo "$base" | sed 's/"digest_receipt_age_s":3600/"digest_receipt_age_s":null/; s/"cutoff_age_s":200000/"cutoff_age_s":3600/')"; check "first digest not yet due is not a WARN" "🟢"
row "$(echo "$base" | sed 's/"lic_untouched_backlog":0/"lic_untouched_backlog":2/')"; check "pre-go-live licensed backlog is WARN, never CRITICAL" "🟡"
row "$(echo "$base" | sed 's/"guc_fns":0,//')"; check "a missing operand is UNKNOWN" "⚪"
row "$(echo "$base" | sed 's/"queue_total":0/"queue_total":null/')"; check "a null operand is UNKNOWN" "⚪"
row "$(echo "$base" | sed 's/"cutoff_age_s":200000/"cutoff_age_s":null/')"; check "a missing cutoff is UNKNOWN" "⚪"
printf 'not json' > "$TMP/f.json"; check "a garbled reply is UNKNOWN" "⚪"
printf '{"ok":true,"rows":[]}' > "$TMP/f.json"; check "an empty reply is UNKNOWN" "⚪"
echo "branches: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
