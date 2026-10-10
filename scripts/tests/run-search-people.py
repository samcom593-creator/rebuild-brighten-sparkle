#!/usr/bin/env python3
"""Runs scripts/tests/search-people.sql against the live database through bot-sql (it ends in ROLLBACK). Exit 1 on any FAIL."""
import json, os, sys, urllib.request
home = os.path.expanduser("~")
url = open(f"{home}/.config/apex-creds/bot-sql.url").read().strip(); tok = open(f"{home}/.config/apex-creds/bot-sql.token").read().strip()
sql = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "search-people.sql")).read()
req = urllib.request.Request(url, data=json.dumps({"query": sql}).encode(), headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
try: r = json.loads(urllib.request.urlopen(req, timeout=300).read())
except urllib.error.HTTPError as e: print("HTTP", e.code, e.read().decode()[:2000]); sys.exit(2)
if not r.get("ok"): print("ERROR:", r.get("error")); sys.exit(2)
bad = 0
for x in r["rows"]:
    ok = x["verdict"] == "PASS"; bad += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + x["test"] + ("" if ok else f"   got={x['outcome']!r} expected={x['expected']!r}"))
print(f"\n{len(r['rows'])-bad}/{len(r['rows'])} passed"); sys.exit(1 if bad else 0)
