#!/bin/bash
# MP-362: exercise apex-doctor Check #43's real bash against injected operands.
BLK=/tmp/c43.block
run() { # $1=fixture json (or __EMPTY__/__CREDS__)
  ( set +e
    log(){ :; }; ok(){ echo "OK: $*"; }; warn(){ echo "WARN: $*"; }
    critical(){ echo "CRIT: $*"; }; crit(){ echo "CRIT: $*"; }
    if [ "$1" = "__CREDS__" ]; then BOT_SQL_URL_FILE=/nonexistent; BOT_SQL_TOKEN_FILE=/nonexistent
    else BOT_SQL_URL_FILE=/etc/hosts; BOT_SQL_TOKEN_FILE=/etc/hosts; fi
    FIX="$1"; bot_sql(){ [ "$FIX" = "__EMPTY__" ] && { echo ""; return 1; }; echo "$FIX"; }
    source "$BLK" ) 2>&1 | tail -1
}
J(){ jq -nc --argjson u "$1" --argjson o "$2" --argjson w "$3" --arg s "$4" --arg i "$5" \
  '{rows:[{unresolved:$u,orphans:$o,wired:$w,steps:$s,orphan_ids:$i}]}'; }
P=0; F=0
t(){ local name="$1" exp="$2" got="$3"
  if [[ "$got" == *"$exp"* ]]; then echo "PASS  $name :: $got"; P=$((P+1));
  else echo "FAIL  $name :: expected '$exp' got '$got'"; F=$((F+1)); fi; }
t "B1 clean"            "OK: auth provisioning clean"          "$(run "$(J 0 0 2 '' '')")"
t "B2 unwired"          "CRIT: the signup triggers no longer"  "$(run "$(J 0 0 1 '' '')")"
t "B3 orphan outranks"  "CRIT: 3 signed-up auth user"          "$(run "$(J 5 3 2 'profiles:XX000' 'aaa, bbb')")"
t "B4 unresolved only"  "CRIT: 5 unresolved row"               "$(run "$(J 5 0 2 'profiles:XX000' '')")"
t "B5 parse failure"    "WARN: could not read auth provisioning" "$(run '{"error":"nope"}')"
t "B6 empty body"       "WARN: could not read auth provisioning" "$(run __EMPTY__)"
t "B7 garbled operand"  "WARN: auth provisioning operands came back unreadable" "$(run '{"rows":[{"unresolved":"x","orphans":0,"wired":2}]}')"
t "B8 no creds"         "WARN: bot-sql credentials missing"     "$(run __CREDS__)"
echo "---- $P passed, $F failed"
[ $F -eq 0 ]
