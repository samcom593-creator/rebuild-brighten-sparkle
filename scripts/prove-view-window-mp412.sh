#!/bin/bash
# MP-412 guard proofs. Each mutation is asserted to have LANDED before its
# verdict is believed — a sed that silently matches nothing "passes" every test.
cd /Users/samjames/projects/rebuild-brighten-sparkle
G="node scripts/check-view-window-vs-threshold.mjs"
MIG=supabase/migrations
PASS=0; FAIL=0
ck(){ if [ "$2" = "$3" ]; then echo "  PASS $1 ($3)"; PASS=$((PASS+1)); else echo "  FAIL $1 expected=$3 got=$2"; FAIL=$((FAIL+1)); fi; }

echo "BASELINE (shipped tree)"
out=$($G 2>&1); rc=$?
ck "baseline green" "$rc" "0"
ck "grades the real subject" "$(echo "$out" | grep -c 'graded: public.automation_health.recent')" "1"

echo
echo "M1 — restore the PRE-MP-412 definition (24h window, 2d bar)"
cat > $MIG/zz_mp412_m1_TEMP.sql <<'SQL'
CREATE OR REPLACE VIEW public.automation_health AS
WITH recent AS (
  SELECT job_name, max(triggered_at) AS last_run,
    count(*) FILTER (WHERE status='success') AS success_count_24h,
    count(*) FILTER (WHERE status='error') AS error_count_24h
  FROM automation_run_log WHERE triggered_at > (now() - '24:00:00'::interval) GROUP BY job_name)
SELECT job_name, last_run, success_count_24h, error_count_24h,
  CASE WHEN last_run < (now() - '2 days'::interval) THEN 'stale'
       WHEN error_count_24h>0 THEN 'flaky' ELSE 'healthy' END AS health_status
FROM recent;
SQL
ck "M1 LANDED (temp migration is the newest def)" "$(grep -c "24:00:00" $MIG/zz_mp412_m1_TEMP.sql)" "1"
out=$($G 2>&1); rc=$?
ck "M1 goes RED" "$rc" "1"
ck "M1 names automation_health" "$(echo "$out" | grep -c 'public.automation_health.*CTE recent')" "1"
ck "M1 prints both operands" "$(echo "$out" | grep -cE "row window : now\(\) - '24:00:00'")" "1"
rm -f $MIG/zz_mp412_m1_TEMP.sql

echo
echo "M2 — the bystander it falsely accused on its first run must stay green"
ck "M2 v_telegram_dashboard NOT flagged" "$($G 2>&1 | grep -c 'v_telegram_dashboard')" "0"
ck "M2 tree still green" "$($G >/dev/null 2>&1; echo $?)" "0"

echo
echo "M3 — sibling-subquery shape (the false-positive shape) is structurally out of scope"
cat > $MIG/zz_mp412_m3_TEMP.sql <<'SQL'
CREATE OR REPLACE VIEW public.mp412_sibling_TEMP AS
SELECT
  (SELECT count(*) FROM t WHERE seen_at > now() - interval '24 hours') AS dau,
  (SELECT count(*) FROM t WHERE seen_at < now() - interval '7 days') AS idle;
SQL
ck "M3 LANDED" "$(grep -c "7 days" $MIG/zz_mp412_m3_TEMP.sql)" "1"
ck "M3 stays green (no shared row window)" "$($G >/dev/null 2>&1; echo $?)" "0"
rm -f $MIG/zz_mp412_m3_TEMP.sql

echo
echo "M4 — a real derived violation in a DIFFERENT view is caught (not scoreboard-shaped)"
cat > $MIG/zz_mp412_m4_TEMP.sql <<'SQL'
CREATE OR REPLACE VIEW public.mp412_other_TEMP AS
WITH w AS (
  SELECT id, max(pinged_at) AS last_ping FROM probes
  WHERE pinged_at > now() - interval '6 hours' GROUP BY id)
SELECT id, CASE WHEN last_ping < now() - interval '3 days' THEN 'stale' ELSE 'ok' END
FROM w;
SQL
ck "M4 LANDED" "$(grep -c "6 hours" $MIG/zz_mp412_m4_TEMP.sql)" "1"
out=$($G 2>&1); rc=$?
ck "M4 goes RED" "$rc" "1"
ck "M4 names the OTHER view in the VIOLATION block" "$(echo "$out" | grep -c 'mp412_other_TEMP.*CTE w, column last_ping')" "1"
rm -f $MIG/zz_mp412_m4_TEMP.sql

echo
echo "M5 — calendar unit is UNPROVABLE, printed, never failed"
cat > $MIG/zz_mp412_m5_TEMP.sql <<'SQL'
CREATE OR REPLACE VIEW public.mp412_months_TEMP AS
WITH w AS (
  SELECT id, max(t) AS last_t FROM x WHERE t > now() - interval '2 months' GROUP BY id)
SELECT id, CASE WHEN last_t < now() - interval '3 days' THEN 'stale' ELSE 'ok' END FROM w;
SQL
ck "M5 LANDED" "$(grep -c "2 months" $MIG/zz_mp412_m5_TEMP.sql)" "1"
out=$($G 2>&1); rc=$?
ck "M5 stays green" "$rc" "0"
ck "M5 reported unprovable, not silently dropped" "$(echo "$out" | grep -c 'unprovable: public.mp412_months_TEMP')" "1"
rm -f $MIG/zz_mp412_m5_TEMP.sql

echo
echo "RESTORED — tree back to shipped state"
ck "restore green" "$($G >/dev/null 2>&1; echo $?)" "0"
ck "no temp migrations left" "$(ls $MIG | grep -c zz_mp412)" "0"
echo; echo "TOTAL: $PASS passed, $FAIL failed"; [ "$FAIL" = "0" ]
