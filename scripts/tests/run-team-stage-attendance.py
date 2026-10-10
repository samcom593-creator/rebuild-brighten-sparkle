#!/usr/bin/env python3
"""Runs scripts/tests/team-stage-attendance.sql against the live database through bot-sql (it ends in ROLLBACK).
The migration under test is read from supabase/migrations and substituted at three markers (the second and third prove a re-run resets
nothing). `--mutate NAME` substitutes a deliberately broken copy at EVERY marker to prove the named tests can fail: the re-runs use
`create or replace`, so a mutation applied only once would be silently repaired by the next marker and prove nothing. Every mutation must
land exactly once in the migration text or the run aborts."""
import json, os, re, sys, urllib.request
home = os.path.expanduser("~")
url = open(f"{home}/.config/apex-creds/bot-sql.url").read().strip()
tok = open(f"{home}/.config/apex-creds/bot-sql.token").read().strip()
here = os.path.dirname(os.path.abspath(__file__))
migration = open(os.path.join(here, "..", "..", "supabase", "migrations", "20261009200000_team_stage_workdays_attendance.sql")).read()
body = re.sub(r"(?im)^\s*(begin|commit);\s*$", "", migration)

M = {
    "stage-unknown-accepted": ("if p_stage is null or p_stage not in ('online_training', 'training', 'released_in_field') then\n    raise exception 'unknown stage'", "if false then\n    raise exception 'unknown stage'"),
    "stage-no-cas": ("if (p_expected is not null and p_expected is distinct from v_cur) or (p_expected is null and p_expect_unset and v_has) then\n    return jsonb_build_object('ok', false, 'conflict', true, 'stage', v_cur);", "if false then\n    return jsonb_build_object('ok', false, 'conflict', true, 'stage', v_cur);"),
    "ghost-gets-stage": ("  if new.agent_code like 'GHOST\\_%' and new.user_id is null then return new; end if;     -- sync-only placeholder seats are not people\n", ""),
    "mapping-guesses-field-training": ("a.onboarding_stage::text in ('live', 'evaluated', 'below_10k'))\n  on conflict", "a.onboarding_stage::text in ('live', 'evaluated', 'below_10k', 'in_field_training'))\n  on conflict"),
    "commitment-allows-past": ("  if v_eff < v_today then raise exception 'A work commitment takes effect today or later, never in the past' using errcode = '22023'; end if;\n", ""),
    "unset-equals-empty": ("'schedule_set', cur.weekdays is not null,", "'schedule_set', coalesce(cardinality(cur.weekdays), 0) > 0,"),
    "expected-ignores-weekday": ("when v_dow between 1 and 5 and v_dow = any (b.wd) then 'yes' else 'no' end as expected", "when true then 'yes' else 'no' end as expected"),
    "unknown-reads-as-no": ("case when not b.sched_set then 'unknown' when", "case when not b.sched_set then 'no' when"),
    "future-attendance-allowed": ("  if p_date is null or p_date > v_today then raise exception 'Attendance can be taken for today or an earlier day' using errcode = '22023'; end if;\n  if p_date < v_today - 400 then raise exception 'That date is too far back' using errcode = '22023'; end if;\n  v_canon", "  v_canon"),
    "bulk-overwrites": ("v_r := public.fn_workday_apply(v_canon, p_date, p_status, 'unmarked', null, v_uid);", "v_r := public.fn_workday_apply(v_canon, p_date, p_status, null, null, v_uid);"),
    "snapshot-dropped": ("p_uid, v_stage, v_sched, v_wd, nullif(btrim(coalesce(p_note, '')), ''))\n      on conflict", "p_uid, null, null, null, nullif(btrim(coalesce(p_note, '')), ''))\n      on conflict"),
    "vas-can-mark": ("raise exception 'Not authorized for this agent' using errcode = '42501';\n  end if;\n  if not exists (select 1 from public.fn_team_population() p where p.agent_id = v_canon) then\n    raise exception 'That person is not an active agent on the team' using errcode = 'P0002';\n  end if;\n  perform pg_advisory_xact_lock(hashtextextended(v_canon::text || ':att:' || p_date::text, 9));\n  return public.fn_workday_apply(v_canon, p_date, p_status, p_expected, p_note, v_uid);", "null;\n  end if;\n  perform pg_advisory_xact_lock(hashtextextended(v_canon::text || ':att:' || p_date::text, 9));\n  return public.fn_workday_apply(v_canon, p_date, p_status, p_expected, p_note, v_uid);"),
    "started-later-included": ("       and coalesce(a.start_date, (a.created_at at time zone 'America/Phoenix')::date) <= v_date\n", ""),
    "clear-keeps-row": ("delete from public.agent_attendance where agent_id = p_agent and attendance_date = p_date and attendance_type = 'workday';", "update public.agent_attendance set status = 'unmarked' where agent_id = p_agent and attendance_date = p_date and attendance_type = 'workday';"),
    "attendance-events-editable": ("create trigger trg_agent_attendance_events_append_only before update or delete on public.agent_attendance_events\n  for each row execute function public.fn_append_only_guard();", ""),
    "people-read-unscoped": ("   where v_all or public.apex_can_read_agent(a.id);\n\n  return jsonb_build_object('ok', true, 'as_of', v_today", "   where true;\n\n  return jsonb_build_object('ok', true, 'as_of', v_today"),
}
mutate = sys.argv[sys.argv.index("--mutate") + 1] if "--mutate" in sys.argv else None
if mutate and mutate not in M:
    print("unknown mutation", mutate, "choices:", ", ".join(M)); sys.exit(2)
first = body
if mutate:
    old, new = M[mutate]
    if body.count(old) != 1:
        print(f"MUTATION DID NOT LAND ({body.count(old)} matches): {mutate}"); sys.exit(2)
    first = body.replace(old, new)
sql = open(os.path.join(here, "team-stage-attendance.sql")).read()
for mk in ("-- @@MIGRATION_UNDER_TEST@@", "-- @@MIGRATION_RERUN@@", "-- @@MIGRATION_RERUN2@@"):
    assert sql.count(mk) == 1, mk
sql = sql.replace("-- @@MIGRATION_UNDER_TEST@@", first).replace("-- @@MIGRATION_RERUN@@", first).replace("-- @@MIGRATION_RERUN2@@", first)
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
