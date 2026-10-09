#!/usr/bin/env python3
"""Runs scripts/tests/team-contracting.sql against the live database through bot-sql. The script ends in ROLLBACK, so
nothing persists. Exit code 1 if any row is not PASS."""
import json, os, sys, urllib.request
home = os.path.expanduser("~")
url = open(f"{home}/.config/apex-creds/bot-sql.url").read().strip()
tok = open(f"{home}/.config/apex-creds/bot-sql.token").read().strip()
files = ["team-contracting.sql", "team-contracting-scale.sql"] if "--scale" in sys.argv else ["team-contracting.sql"]
rows = []
for f in files:
    sql = open(os.path.join(os.path.dirname(__file__), f)).read()
    req = urllib.request.Request(url, data=json.dumps({"query": sql}).encode(), headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
    try:
        r = json.loads(urllib.request.urlopen(req, timeout=300).read())
    except urllib.error.HTTPError as e:
        print("HTTP", e.code, f, e.read().decode()[:1500]); sys.exit(2)
    if not r.get("ok"):
        print("ERROR:", f, r.get("error")); sys.exit(2)
    rows += r["rows"]
bad = 0
for x in rows:
    ok = x["verdict"] == "PASS"; bad += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + x["test"] + ("" if ok else f"   got={x['outcome']!r} expected={x['expected']!r}"))
print(f"\n{len(rows)-bad}/{len(rows)} passed")
sys.exit(1 if bad else 0)
