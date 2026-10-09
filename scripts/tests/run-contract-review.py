#!/usr/bin/env python3
"""Runs scripts/tests/contract-review.sql against the live database through bot-sql. The script ends in ROLLBACK, so
nothing persists. The migration under test is read from supabase/migrations and substituted at two markers, so the file
that ships is the file that is proven. `--mutate NAME` substitutes a deliberately broken copy at the FIRST marker only
(the re-run marker always gets the real file) to prove the named test can fail. Exit code 1 if any row is not PASS."""
import json, os, re, sys, urllib.request

home = os.path.expanduser("~")
url = open(f"{home}/.config/apex-creds/bot-sql.url").read().strip()
tok = open(f"{home}/.config/apex-creds/bot-sql.token").read().strip()
here = os.path.dirname(os.path.abspath(__file__))
mig_path = os.path.join(here, "..", "..", "supabase", "migrations", "20261009180000_contract_portal_tracker.sql")
migration = open(mig_path).read()
body = re.sub(r"(?im)^\s*(begin|commit);\s*$", "", migration)
assert "begin;" not in body.lower().replace("begin\n", "") or True

# name -> (text to find in the migration, text to put there). Each must match exactly once or the run aborts: a mutation
# that did not land would prove nothing.
MUTATIONS = {
    "no-cas-on-marks": ("if p_expected is not null and p_expected is distinct from v_was then", "if false then"),
    "marks-leak-across-carriers": ("where agent_id = v_canon and version = v_version and carrier_key = v_key;\n    insert", "where agent_id = v_canon and version = v_version;\n    insert"),
    "population-includes-ghosts": ("and not (a.agent_code like 'GHOST\\_%' and a.user_id is null)", ""),
    "population-includes-twins": ("and (a.canonical_agent_id is null or a.canonical_agent_id = a.id)", ""),
    "vas-can-write": ("or (public.has_role(v_uid, 'manager') and public.apex_can_read_agent(p_agent_id) and public.apex_can_read_agent(v_canon))) then", "or (public.has_role(v_uid, 'manager') or public.has_role(v_uid, 'va'))) then"),
    "unset-level-reads-zero": ("case when l.agent_id is null then null\n           else jsonb_build_object('pct'", "case when l.agent_id is null then jsonb_build_object('pct', 0)\n           else jsonb_build_object('pct'"),
    "no-cas-on-level": ("if (p_expected is not null and v_has and p_expected is distinct from v_cur)", "if (false and p_expected is not null and v_has and p_expected is distinct from v_cur)"),
    "audit-editable": ("raise exception 'contract_review_events is append-only' using errcode = '42501';", "return coalesce(new, old);"),
    "anon-can-read-roster": ("revoke all on function public.contract_review_roster() from public, anon;", "grant execute on function public.contract_review_roster() to public;"),
    "mark-lands-on-twin": ("values (v_canon, v_version, v_key, v_uid)\n      returning * into v_cur;", "values (p_agent_id, v_version, v_key, v_uid)\n      returning * into v_cur;"),
    "unmarked-means-late": ("'needs_review', count(*) filter (where r.marked_count < 4),", "'needs_review', count(*) filter (where r.marked_count < 0),"),
    "npn-conflict-ignored": ("    if found then\n      return jsonb_build_object('ok', false, 'conflict', 'npn_in_use'", "    if false then\n      return jsonb_build_object('ok', false, 'conflict', 'npn_in_use'"),
    "npn-loses-leading-zero": ("update public.agents set nipr_number = v_npn,", "update public.agents set nipr_number = ltrim(v_npn, '0'),"),
    "self-save-skips-require-all": ("v_agent, p_npn, p_first, p_last, p_email, p_state, 'self', true)", "v_agent, p_npn, p_first, p_last, p_email, p_state, 'self', false)"),
    "repeat-confirm-overwrites": ("  if p_confirmed and not v_was then", "  if p_confirmed then\n    delete from public.contract_review_marks where agent_id = v_canon and version = v_version and carrier_key = v_key;"),
    "roster-truncates": ("  with pop as (", "  with pop as ("),  # replaced below with a LIMIT mutation
}
MUTATIONS["roster-truncates"] = ("    where v_all or public.apex_can_read_agent(a.id)\n  ), r as (", "    where v_all or public.apex_can_read_agent(a.id)\n    order by a.id limit 1000\n  ), r as (")

def run(sql):
    req = urllib.request.Request(url, data=json.dumps({"query": sql}).encode(), headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
    try:
        r = json.loads(urllib.request.urlopen(req, timeout=300).read())
    except urllib.error.HTTPError as e:
        print("HTTP", e.code, e.read().decode()[:2500]); sys.exit(2)
    if not r.get("ok"):
        print("ERROR:", r.get("error")); sys.exit(2)
    return r["rows"]

mutate = None
if "--mutate" in sys.argv:
    mutate = sys.argv[sys.argv.index("--mutate") + 1]
    if mutate not in MUTATIONS:
        print("unknown mutation", mutate, "choices:", ", ".join(MUTATIONS)); sys.exit(2)

first = body
if mutate:
    old, new = MUTATIONS[mutate]
    if body.count(old) != 1:
        print(f"MUTATION DID NOT LAND ({body.count(old)} matches): {mutate}"); sys.exit(2)
    first = body.replace(old, new)

sql = open(os.path.join(here, "contract-review.sql")).read()
assert sql.count("-- @@MIGRATION_UNDER_TEST@@") == 1 and sql.count("-- @@MIGRATION_RERUN@@") == 1
sql = sql.replace("-- @@MIGRATION_UNDER_TEST@@", first).replace("-- @@MIGRATION_RERUN@@", body)
rows = run(sql)
bad = 0
for x in rows:
    ok = x["verdict"] == "PASS"; bad += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + x["test"] + ("" if ok else f"   got={x['outcome']!r} expected={x['expected']!r}"))
print(f"\n{len(rows)-bad}/{len(rows)} passed" + (f"   (mutation: {mutate})" if mutate else ""))
sys.exit(1 if bad else 0)
