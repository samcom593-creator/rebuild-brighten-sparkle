#!/bin/bash
# Regenerate scripts/data/unique-index-catalog.json from the LIVE Postgres catalog.
#
# The ratchet in scripts/check-maybesingle-nonunique.mjs has to answer "can this
# equality filter match more than one row?" from inside CI, where there is no
# database. So it reads a snapshot instead. A snapshot that nobody can regenerate
# is a snapshot that rots into a lie, which is why this script exists and why
# apex-doctor Check #23 re-queries pg_index weekly and goes red on drift.
#
# Run:  bash scripts/refresh-unique-index-catalog.sh
set -euo pipefail

TOKEN_FILE="${HOME}/.config/apex-creds/bot-sql.token"
[ -r "$TOKEN_FILE" ] || { echo "no bot-sql token at $TOKEN_FILE" >&2; exit 1; }
OUT="$(dirname "$0")/data/unique-index-catalog.json"

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

UNIQ=$(bot_sql "SELECT c.relname AS tbl, (i.indpred IS NOT NULL) AS is_partial, array_to_string(ARRAY(SELECT a.attname FROM unnest(i.indkey) k JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k),',') AS cols FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE i.indisunique AND n.nspname='public' AND c.relkind IN ('r','p') ORDER BY 1,3")
RELS=$(bot_sql "SELECT c.relname AS rel, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','v','m','p') ORDER BY 1")

UNIQ="$UNIQ" RELS="$RELS" OUT="$OUT" python3 <<'PY'
import json, os, subprocess
uniq = json.loads(os.environ["UNIQ"])["rows"]
rels = json.loads(os.environ["RELS"])["rows"]
full, partial = {}, {}
for r in uniq:
    cols = [c for c in (r.get("cols") or "").split(",") if c]
    if not cols:
        continue
    (partial if str(r.get("is_partial")).lower() == "true" else full).setdefault(r["tbl"], []).append(cols)
stamp = subprocess.run(["date", "-u", "+%Y-%m-%dT%H:%M:%SZ"], capture_output=True, text=True).stdout.strip()
cat = {
    "_generated_by": "scripts/refresh-unique-index-catalog.sh (bot_sql -> pg_index)",
    "_generated_at": stamp,
    "_project_ref": "xrzweoneiieddzxogewk",
    "_why": (
        "A repo guard cannot query prod. This is a snapshot of which (table, column-set) "
        "combinations Postgres actually enforces as unique, so "
        "scripts/check-maybesingle-nonunique.mjs can decide whether an equality filter can "
        "match more than one row. Partial unique indexes are recorded SEPARATELY and "
        "deliberately NOT treated as uniqueness: they only constrain rows matching their "
        "predicate, so an equality filter can still match one in-predicate row and one out. "
        "apex-doctor Check #23 re-queries pg_index weekly and goes red when this snapshot "
        "drifts from the live catalog."
    ),
    "relation_kind": {r["rel"]: r["relkind"] for r in rels},
    "full_unique": {k: sorted(v) for k, v in sorted(full.items())},
    "partial_unique_NOT_a_guarantee": {k: sorted(v) for k, v in sorted(partial.items())},
}
with open(os.environ["OUT"], "w") as fh:
    json.dump(cat, fh, indent=1, sort_keys=False)
print(f"wrote {os.environ['OUT']}: {len(cat['full_unique'])} tables with full-unique indexes, "
      f"{len(cat['partial_unique_NOT_a_guarantee'])} with partial-only (excluded)")
PY
