#!/bin/bash
# Regenerate scripts/data/rpc-catalog.json from the LIVE Postgres catalog.
#
# scripts/check-rpc-args.mjs has to answer "does this .rpc() name a function that
# exists, and does it pass the argument names that function actually declares?"
# from inside CI, where there is no database, so the answer has to be a committed
# snapshot -- the same split as refresh-relation-catalog.sh.
#
# WHY THIS GUARD EXISTS (MP-349, 2026-08-31): PostgREST resolves an RPC by
# function name AND parameter names. Passing a key the function does not declare
# is PGRST202 "Could not find the function ... in the schema cache" -- and
# supabase-js RESOLVES with {error} instead of throwing, so a caller that does
# not read `error` fails silently, exactly like the .from() class MP-345 closed.
#
# tsc catches this ONLY on an un-cast call. Measured at HEAD: 113 of 146 src/
# call sites go through `(supabase as any).rpc` or `.rpc("name" as never)`, and a
# cast makes the check vanish. Proven on a scratch file -- a wrong arg name with
# no cast is error TS2561; the identical error behind a cast, and a call to a
# function that does not exist at all, both type-check clean.
#
# Run:  bash scripts/refresh-rpc-catalog.sh
# apex-doctor Check #42 re-queries pg_proc weekly and goes red on drift.
set -euo pipefail

TOKEN_FILE="${HOME}/.config/apex-creds/bot-sql.token"
[ -r "$TOKEN_FILE" ] || { echo "no bot-sql token at $TOKEN_FILE" >&2; exit 1; }
OUT="$(dirname "$0")/data/rpc-catalog.json"

Q="select p.proname as fn, pg_get_function_arguments(p.oid) as args from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind in ('f','p') order by 1, 2"
BODY=$(python3 -c 'import json,sys; print(json.dumps({"query": sys.stdin.read()}))' <<< "$Q")
RESP=$(curl -s --max-time 60 -X POST \
  "https://xrzweoneiieddzxogewk.supabase.co/functions/v1/bot-sql" \
  -H "Authorization: Bearer $(cat "$TOKEN_FILE")" \
  -H "Content-Type: application/json" -d "$BODY")

RESP="$RESP" python3 - "$OUT" <<'PY'
import json, os, re, sys
out = sys.argv[1]
d = json.loads(os.environ["RESP"])
if not d.get("ok"):
    print("bot-sql refused: %r" % d, file=sys.stderr); sys.exit(1)
rows = d["rows"]
# A catalog that silently comes back tiny is the 465 fake-success rows in a JSON
# file: the guard would keep exiting 0 while grading almost nothing.
if len(rows) < 300:
    print("refusing to write a %d-row catalog (expected >=300)" % len(rows), file=sys.stderr); sys.exit(1)

def parse(a):
    """(all_param_names, required_param_names) for one signature.

    OUT params are not supplied by a caller. A param with a DEFAULT is optional.
    An unnamed param cannot be addressed by name at all, so it is recorded as
    such rather than silently dropped -- see UNNAMED handling in the checker."""
    if not a.strip():
        return [], [], False
    parts, depth, cur = [], 0, ""
    for ch in a:
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append(cur); cur = ""; continue
        cur += ch
    parts.append(cur)
    allp, req, unnamed = [], [], False
    for p in parts:
        p = p.strip()
        if not p:
            continue
        has_default = " DEFAULT " in p.upper()
        toks = p.split()
        mode = "IN"
        if toks and toks[0].upper() in ("IN", "OUT", "INOUT", "VARIADIC"):
            mode, toks = toks[0].upper(), toks[1:]
        if mode == "OUT" or not toks:
            continue
        name = toks[0]
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name) or len(toks) == 1:
            unnamed = True     # positional-only: `text` with no parameter name
            continue
        allp.append(name)
        if not has_default:
            req.append(name)
    return sorted(allp), sorted(req), unnamed

fns = {}
for r in rows:
    allp, req, unnamed = parse(r["args"] or "")
    fns.setdefault(r["fn"], []).append({"all": allp, "required": req, "unnamed": unnamed, "raw": r["args"] or ""})

cat = {
    "_source": "pg_proc x pg_namespace (schema public, prokind f/p) via bot-sql",
    "_generated_by": "scripts/refresh-rpc-catalog.sh",
    "_note": "PostgREST resolves an RPC by name AND parameter names. A key the function does not declare is PGRST202, which supabase-js resolves with {error} rather than throwing.",
    "functions": {k: fns[k] for k in sorted(fns)},
}
json.dump(cat, open(out, "w"), indent=2)
open(out, "a").write("\n")
print("wrote %s (%d functions, %d signatures)" % (out, len(cat["functions"]), len(rows)))
PY
