#!/bin/bash
# Regenerate scripts/data/enum-catalog.json from the LIVE Postgres catalog.
#
# scripts/check-enum-filter-literals.mjs has to answer "is this string literal a
# member of that column's enum?" from inside CI, where there is no database. It
# used to answer from a map of five (table, column) pairs hand-copied out of
# pg_enum on 2026-07-27, with a comment explaining that the map stayed small
# because a wrong entry would be worse than no entry. Both halves of that
# tradeoff were real: src/ writes enum literals against ten columns, so six were
# ungraded — and the entries it did carry were keyed by BARE type name, in a
# database that has TWO enums named app_role (public and recruit) whose member
# lists disagree. Generating the map removes both failure modes at once: the
# coverage is total by construction, and every type is schema-qualified, so an
# ordinary-looking edit can no longer point the guard at the wrong enum.
#
# Run:  bash scripts/refresh-enum-catalog.sh
# apex-doctor Check #29 re-queries pg_enum weekly and goes red when this drifts.
set -euo pipefail

TOKEN_FILE="${HOME}/.config/apex-creds/bot-sql.token"
[ -r "$TOKEN_FILE" ] || { echo "no bot-sql token at $TOKEN_FILE" >&2; exit 1; }
OUT="$(dirname "$0")/data/enum-catalog.json"

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

# Resolved through pg_attribute.atttypid, NOT by matching information_schema's
# udt_name against pg_type.typname. The typname join is what produced a confident
# FALSE finding against correct code on 2026-08-30: it matched both app_role
# types, graded public.user_roles.role against recruit.app_role's member list,
# and reported the perfectly valid literal "va" as invalid. atttypid is the one
# operand that cannot name two types.
COLS=$(bot_sql "SELECT c.relname || '.' || a.attname AS col, tn.nspname || '.' || t.typname AS enum_name, c.relkind AS kind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname='public' JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped JOIN pg_type t ON t.oid=a.atttypid AND t.typtype='e' JOIN pg_namespace tn ON tn.oid=t.typnamespace WHERE c.relkind IN ('r','v','m','p') ORDER BY 1")
MEMBERS=$(bot_sql "SELECT tn.nspname || '.' || t.typname AS enum_name, string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) AS members FROM pg_type t JOIN pg_namespace tn ON tn.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid WHERE t.typtype='e' GROUP BY 1 ORDER BY 1")

COLS="$COLS" MEMBERS="$MEMBERS" OUT="$OUT" python3 <<'PY'
import json, os, subprocess
cols = json.loads(os.environ["COLS"])["rows"]
members = json.loads(os.environ["MEMBERS"])["rows"]

enums = {r["enum_name"]: r["members"].split(",") for r in members}
column_enum, kinds = {}, {}
for r in cols:
    column_enum[r["col"]] = r["enum_name"]
    kinds[r["col"].split(".")[0]] = r["kind"]

# A column pointing at a type with no members means the two queries disagree
# about the database. Writing that out would make the guard grade literals
# against an empty allow-list and fail everything.
orphan = sorted(c for c, e in column_enum.items() if not enums.get(e))
assert not orphan, f"columns reference enum types absent from pg_enum: {orphan}"

dupes = {}
for q in enums:
    dupes.setdefault(q.split(".", 1)[1], []).append(q)
ambiguous = {k: sorted(v) for k, v in dupes.items() if len(v) > 1}

stamp = subprocess.run(["date", "-u", "+%Y-%m-%dT%H:%M:%SZ"], capture_output=True, text=True).stdout.strip()
cat = {
    "_generated_by": "scripts/refresh-enum-catalog.sh (bot_sql -> pg_enum + pg_attribute.atttypid)",
    "_generated_at": stamp,
    "_project_ref": "xrzweoneiieddzxogewk",
    "_why": (
        "A repo guard cannot query prod. This is a snapshot of every enum-typed column in "
        "the public schema and the exact member list Postgres will accept for it, so "
        "scripts/check-enum-filter-literals.mjs can decide whether a filter or write "
        "literal will survive PostgREST's coercion. Enum types are SCHEMA-QUALIFIED "
        "because this database has more than one type sharing a bare name. Views are "
        "included: a bad literal in a filter against a view column raises the same 22P02 "
        "as one against a table. apex-doctor Check #29 re-queries pg_enum weekly and goes "
        "red when this snapshot drifts from the live catalog."
    ),
    "_ambiguous_bare_names": ambiguous,
    "relation_kind": dict(sorted(kinds.items())),
    "enums": dict(sorted(enums.items())),
    "column_enum": dict(sorted(column_enum.items())),
}
with open(os.environ["OUT"], "w") as fh:
    json.dump(cat, fh, indent=1, sort_keys=False)
print(f"wrote {os.environ['OUT']}: {len(enums)} enum types, {len(column_enum)} enum-typed columns, "
      f"{len(ambiguous)} ambiguous bare name(s): {sorted(ambiguous) or 'none'}")
PY
