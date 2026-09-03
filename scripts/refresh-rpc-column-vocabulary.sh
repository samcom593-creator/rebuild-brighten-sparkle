#!/bin/bash
# Regenerate scripts/data/rpc-column-vocabulary.json from the LIVE Postgres catalog.
#
# scripts/check-enum-filter-literals.mjs grades string literals inside
# supabase.from("<table>").eq("<col>", "<literal>") chains. It cannot see the
# other half of the same class: a value that arrives from an RPC and is compared
# in JavaScript.
#
# MP-409 (2026-09-03) is that half. ScopedProductionScoreboard called
# discord_deal_feed_health() and decided which feeds were broken with
#     (feed.data ?? []).filter((f) => f.status !== "ok")
# while discord_deal_ingestion_health.status carries
#     CHECK (status = ANY (ARRAY['healthy','credential_blocked','channel_unavailable','error']))
# so "ok" is a state the database cannot store and every row was "blocked" by
# construction. Both live feeds happened to be credential_blocked, so the board
# looked right; the banner would have gone permanently amber on the very run
# that proved a fix worked. No compiler sees it — the RPC's return type is text
# and every one of those words is a valid text value.
#
# What this file records, and why it is only CANDIDATES:
# A returned column's accepted vocabulary is not simply "the base column's",
# because a set-returning function can also synthesise its own literals —
# calendar_window() emits 'birthday' and 'milestone' as status values that exist
# in no table. So the catalog records, per (function, returned column):
#   candidates    every public relation column of that name reachable from the
#                 function body (direct FROM/JOIN, plus the relations those views
#                 are built on, two levels out via pg_rewrite)
#   body_literals every quoted literal in the function's own definition
# and the guard refuses a literal only when NO candidate vocabulary and no body
# literal accepts it. That direction is deliberate: provenance from a body regex
# is a guess, so the guard is built to be unable to accuse a word that any
# plausible source would accept, and still catches a word no source will.
#
# The vocabularies themselves are NOT copied here. They are read from
# scripts/data/enum-catalog.json, so there is exactly one snapshot of what
# Postgres accepts and these two guards cannot drift apart.
#
# Run:  bash scripts/refresh-enum-catalog.sh && bash scripts/refresh-rpc-column-vocabulary.sh
set -euo pipefail

TOKEN_FILE="${HOME}/.config/apex-creds/bot-sql.token"
[ -r "$TOKEN_FILE" ] || { echo "no bot-sql token at $TOKEN_FILE" >&2; exit 1; }
export OUT="$(dirname "$0")/data/rpc-column-vocabulary.json"

bot_sql() {
  local q="$1" r
  for i in 0 3 6 12; do
    [ "$i" -gt 0 ] && sleep "$i"
    r=$(curl -sS -m 90 -X POST https://xrzweoneiieddzxogewk.supabase.co/functions/v1/bot-sql \
      -H "Authorization: Bearer $(cat "$TOKEN_FILE")" \
      -H "Content-Type: application/json" \
      --data-binary "$(python3 -c 'import json,sys; print(json.dumps({"query":sys.argv[1]}))' "$q")" 2>/dev/null)
    # Shape gate: must be a row ARRAY. A well-formed error object is still a
    # failure — parsing JSON is not the same as getting an answer.
    if echo "$r" | python3 -c '
import json,sys
d=json.load(sys.stdin)
rows = d if isinstance(d,list) else d.get("rows") if isinstance(d,dict) else None
assert isinstance(rows,list)
' >/dev/null 2>&1; then echo "$r"; return 0; fi
  done
  echo "bot_sql failed after 4 attempts: $r" >&2; return 1
}

read -r -d '' Q <<'SQL' || true
with func as (
  select p.proname,
         pg_get_functiondef(p.oid) as def,
         array(select an from unnest(p.proargnames, p.proargmodes) as u(an, am) where am = 't') as outcols
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f' and p.proretset
), f as (
  select * from func where cardinality(outcols) > 0
), rel as (
  select f.proname, lower(m[1]) as relname
  from f, regexp_matches(f.def, '(?:from|join)\s+(?:public\.)?([a-zA-Z_][a-zA-Z0-9_]*)', 'gi') m
), edges as (
  select distinct dep.relname as viewname, src.relname as basename
  from pg_depend d
  join pg_rewrite r on r.oid = d.objid
  join pg_class dep on dep.oid = r.ev_class
  join pg_class src on src.oid = d.refobjid
  join pg_namespace ns on ns.oid = src.relnamespace
  where d.classid = 'pg_rewrite'::regclass and ns.nspname = 'public'
    and src.relkind in ('r','p','v','m') and dep.oid <> src.oid
), expanded as (
  select proname, relname from rel
  union select r.proname, e.basename from rel r join edges e on e.viewname = r.relname
  union select r.proname, e2.basename from rel r join edges e on e.viewname = r.relname
                                                join edges e2 on e2.viewname = e.basename
), allcols as (
  -- EVERY returned column of every qualifying function, whether or not a public
  -- relation supplies it. This is the base the catalog is built on: a function
  -- that synthesises its output (calendar_window.kind) or reads a non-public
  -- schema (get_cron_jobs_with_status reads cron.job) has NO candidate relation,
  -- and inner-joining candidates deleted those pairs from the catalog entirely --
  -- which also removed them from the guard's `unprovable` set, so they were not
  -- ungraded-and-counted, they were invisible. See MP-410.
  select f.proname, col as colname
  from f cross join lateral unnest(f.outcols) as col
), cand as (
  select a.proname, a.colname, x.relname || '.' || a.colname as candidate
  from allcols a
  join expanded x on x.proname = a.proname
  join pg_class c on c.relname = x.relname
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  join pg_attribute at on at.attrelid = c.oid and at.attname = a.colname
       and at.attnum > 0 and not at.attisdropped
  where c.relkind in ('r','p','v','m')
), lits as (
  select f.proname, array_agg(distinct m[1]) as body_literals
  from f, regexp_matches(f.def, '''([a-zA-Z][a-zA-Z0-9_ -]{0,40})''', 'g') m
  group by 1
)
select a.proname, a.colname,
       coalesce(array_agg(distinct c.candidate) filter (where c.candidate is not null), '{}') as candidates,
       coalesce((select l.body_literals from lits l where l.proname = a.proname), '{}') as body_literals
from allcols a
left join cand c on c.proname = a.proname and c.colname = a.colname
group by 1, 2
order by 1, 2
SQL

read -r -d '' Q2 <<'SQL' || true
-- Public functions that CANNOT have a (function, column) pair, because they return
-- jsonb / a scalar / setof record with no named OUT columns. A guard that compares
-- <row>.<col> against a literal has nothing to key on for these, so they are
-- structurally uncoverable rather than a gap in the catalog. Recorded so the guard
-- can tell the two apart and print an honest denominator instead of a bare pass.
select distinct p.proname, pg_get_function_result(p.oid) as result
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f'
  and not (p.proretset and cardinality(array(
        select an from unnest(p.proargnames, p.proargmodes) as u(an, am) where am = 't')) > 0)
order by 1
SQL

bot_sql "$Q2" > /tmp/rpc-uncoverable.raw.json
bot_sql "$Q" > /tmp/rpc-column-vocabulary.raw.json
python3 <<'PY'
import json, os, datetime
raw = json.load(open("/tmp/rpc-column-vocabulary.raw.json"))
rows = raw if isinstance(raw, list) else raw["rows"]
cols = {}
for r in rows:
    cols[f'{r["proname"]}.{r["colname"]}'] = {
        "candidates": sorted(r["candidates"] or []),
        "body_literals": sorted(r["body_literals"] or []),
    }
unc_raw = json.load(open("/tmp/rpc-uncoverable.raw.json"))
unc_rows = unc_raw if isinstance(unc_raw, list) else unc_raw["rows"]
uncoverable = {r["proname"]: r["result"] for r in unc_rows}

cat = {
    "_generated_by": "scripts/refresh-rpc-column-vocabulary.sh (bot_sql -> pg_proc + pg_rewrite)",
    "_generated_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "_project_ref": "xrzweoneiieddzxogewk",
    "_why": (
        "check-enum-filter-literals.mjs grades literals inside supabase.from().eq() "
        "chains. This is the other half of the same class: a status word that arrives "
        "from an RPC and is compared in JavaScript, where the return type is text and "
        "every wrong word type-checks. Per (function, returned column) this records the "
        "relation columns of that name reachable from the function body and the literals "
        "the function synthesises itself. It deliberately records CANDIDATES rather than "
        "one resolved source: provenance from a body regex is a guess, so "
        "check-rpc-status-literals.mjs refuses a literal only when NO candidate "
        "vocabulary and no body literal accepts it."
    ),
    "_vocabulary_source": (
        "scripts/data/enum-catalog.json (check_vocab + column_enum + enums). Not copied "
        "here on purpose, so the two guards read one snapshot and cannot drift."
    ),
    "_uncoverable_why": (
        "Public functions with no named output columns (jsonb / scalar / setof record). "
        "A `<row>.<col> === \"lit\"` comparison has nothing to key on for these, so they "
        "are structurally uncoverable, not a catalog gap. check-rpc-status-literals.mjs "
        "prints the two populations separately so a pass states what it did NOT look at."
    ),
    "uncoverable": dict(sorted(uncoverable.items())),
    "columns": dict(sorted(cols.items())),
}
json.dump(cat, open(os.environ["OUT"], "w"), indent=1, sort_keys=False)
print(f'wrote {os.environ["OUT"]}: {len(cols)} (function, returned column) pairs, {len(uncoverable)} uncoverable function(s)')
PY
