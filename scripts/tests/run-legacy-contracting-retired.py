#!/usr/bin/env python3
"""Runs scripts/tests/legacy-contracting-retired.sql against the live database through bot-sql (it ends in ROLLBACK).
The migration under test is read from supabase/migrations and substituted at two markers. `--mutate NAME` puts a deliberately
broken version at the FIRST marker to prove the named tests can fail; each mutation must land exactly once."""
import json, os, re, sys, urllib.request
home = os.path.expanduser("~")
url = open(f"{home}/.config/apex-creds/bot-sql.url").read().strip()
tok = open(f"{home}/.config/apex-creds/bot-sql.token").read().strip()
here = os.path.dirname(os.path.abspath(__file__))
migration = open(os.path.join(here, "..", "..", "supabase", "migrations", "20261009190000_retire_legacy_contracting_pipeline.sql")).read()
body = re.sub(r"(?im)^\s*(begin|commit);\s*$", "", migration)

# name -> SQL appended AFTER the migration at the first marker: it puts the old behavior back.
MUTATIONS = {
    "pipeline-back-on": "alter table public.contracting_intakes enable trigger trg_ensure_contracting_legs;",
    "slack-back-on": "alter table public.contracting_intakes enable trigger trg_queue_contracting_slack;",
    "slack-npn-back-on": "alter table public.contracting_intakes enable trigger trg_queue_contracting_slack_npn_added;",
    "cron-back-on": "do $$ begin perform cron.alter_job((select jobid from cron.job where jobname = 'aflac-checkoff-reminder'), active := true); end $$;",
    "enrich-disabled-too": "alter table public.contracting_intakes disable trigger contracting_intakes_enrich_profile;",
    "history-deleted": "delete from public.contracting_intake_deliveries where state = 'not_configured';",
}
mutate = sys.argv[sys.argv.index("--mutate") + 1] if "--mutate" in sys.argv else None
if mutate and mutate not in MUTATIONS:
    print("unknown mutation", mutate, "choices:", ", ".join(MUTATIONS)); sys.exit(2)
sql = open(os.path.join(here, "legacy-contracting-retired.sql")).read()
assert sql.count("-- @@MIGRATION_UNDER_TEST@@") == 1 and sql.count("-- @@MIGRATION_RERUN@@") == 1
first = body + ("\n" + MUTATIONS[mutate] + "\n" if mutate else "")
sql = sql.replace("-- @@MIGRATION_UNDER_TEST@@", first).replace("-- @@MIGRATION_RERUN@@", body)
req = urllib.request.Request(url, data=json.dumps({"query": sql}).encode(), headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
try:
    r = json.loads(urllib.request.urlopen(req, timeout=300).read())
except urllib.error.HTTPError as e:
    print("HTTP", e.code, e.read().decode()[:2500]); sys.exit(2)
if not r.get("ok"):
    print("ERROR:", r.get("error")); sys.exit(2)
bad = 0
for x in r["rows"]:
    ok = x["verdict"] == "PASS"; bad += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + x["test"] + ("" if ok else f"   got={x['outcome']!r} expected={x['expected']!r}"))
print(f"\n{len(r['rows'])-bad}/{len(r['rows'])} passed" + (f"   (mutation: {mutate})" if mutate else ""))
sys.exit(1 if bad else 0)
