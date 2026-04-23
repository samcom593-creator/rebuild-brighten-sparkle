#!/usr/bin/env python3
"""
apex — local Siri-style APEX command runner.
Parses natural-language commands, writes directly to Supabase via the
bot-sql endpoint (no edge function deploy required), speaks back the
confirmation via macOS `say`.

Usage:
  apex "schedule call with Joe tomorrow 2pm"
  apex "remind me to call Kim in 30 minutes"
  apex "what's today's numbers"
  apex "note to self NJ licensing delayed"
  apex                                    # prompts for voice/text input
"""
import json, re, subprocess, sys, os, urllib.request, urllib.error
from datetime import datetime, timedelta, timezone

# Local timezone (US Central). Used so when Postgres stores timestamptz it
# lands at the wall-clock time Sam expects.
LOCAL_TZ = timezone(timedelta(hours=-5))  # CDT — shift to -6 for CST standard time

BOT_SQL_URL   = "https://msydzhzolwourcdmqxvn.supabase.co/functions/v1/bot-sql"
BOT_SQL_TOKEN = "9e7445930bcb4c7ccca0121478bf3bdd88d4e6cf238c00d7a58293e7170e9392"
QUIET         = os.environ.get("APEX_QUIET") == "1"

def speak(text: str):
    print(text)
    if QUIET: return
    try: subprocess.Popen(["say", text]).wait(timeout=15)
    except Exception: pass

def run_sql(query: str) -> dict:
    payload = json.dumps({"query": query}).encode()
    req = urllib.request.Request(BOT_SQL_URL, data=payload, method="POST",
        headers={"Authorization": f"Bearer {BOT_SQL_TOKEN}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return {"ok": False, "error": f"HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:200]}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}

def pgsql(s: str) -> str:
    """Escape single quotes for Postgres."""
    return (s or "").replace("'", "''")

def parse_when(s: str):
    """Return (datetime | None, human readable string)."""
    raw = (s or "").lower().strip()
    if not raw: return None, None
    now = datetime.now()
    # N minutes / hours (with or without leading "in")
    m = re.search(r"(\d+)\s*(minute|min)s?\b", raw)
    if m: return now + timedelta(minutes=int(m.group(1))), raw
    m = re.search(r"(\d+)\s*(hour|hr)s?\b", raw)
    if m: return now + timedelta(hours=int(m.group(1))), raw

    # Time HH[:MM] am/pm — but only if the match looks like a real clock time
    tm = re.search(r"\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b", raw) \
      or re.search(r"\b(\d{1,2}):(\d{2})\b", raw)
    hour, minute = 9, 0
    if tm:
        hour = int(tm.group(1))
        minute = int(tm.group(2) or 0) if tm.group(2) else 0
        ampm = tm.group(3) if tm.lastindex and tm.lastindex >= 3 else None
        if ampm == "pm" and hour < 12: hour += 12
        if ampm == "am" and hour == 12: hour = 0
        if hour > 23: return None, raw   # guard

    base = now.replace(hour=0, minute=0, second=0, microsecond=0)
    days = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"]
    if "tomorrow" in raw: base += timedelta(days=1)
    elif "today" in raw:  pass
    else:
        for i, d in enumerate(days):
            if d in raw:
                cur = now.weekday()
                delta = (i - cur) % 7
                if delta == 0: delta = 7
                base += timedelta(days=delta)
                break
    if tm: base = base.replace(hour=hour, minute=minute)
    else:  return None, raw
    return base, raw

def parse_intent(cmd: str) -> dict:
    c = cmd.strip()
    cl = c.lower()

    # All words that might introduce a when-clause
    when_kw = "(?:at|on|for|this|next|tomorrow|today|in|monday|tuesday|wednesday|thursday|friday|saturday|sunday)"

    # schedule — capture the when-keyword too so parse_when sees "tomorrow"/"friday"/etc
    m = re.match(rf"(?:schedule|book|set up|add|create)\s+(?:a\s+)?(?:call|meeting|chat|appointment|time|slot)\s+(?:with\s+)?([^,]+?)(?:\s+({when_kw}\s+.+|{when_kw}))?$", cl)
    if m:
        who, whenraw = (m.group(1) or "").strip(), (m.group(2) or "").strip()
        when, _ = parse_when(whenraw) if whenraw else (None, None)
        return {"kind": "schedule", "title": f"Call with {who.title() or 'TBD'}",
                "who": who, "when": when}

    # reminder
    m = re.match(rf"(?:remind me|reminder)\s+(?:to\s+)?(.+?)(?:\s+({when_kw}\s+.+|{when_kw}))?$", cl)
    if m:
        what = m.group(1).strip()
        whenraw = (m.group(2) or "").strip()
        when, _ = parse_when(whenraw) if whenraw else (None, None)
        return {"kind": "reminder", "title": what, "when": when}

    # note
    if re.match(r"^(note|note to self|remember|write down)[:\s,]", cl):
        body = re.sub(r"^(note( to self)?|remember|write down)[:\s,]+", "", c, flags=re.I)
        return {"kind": "note", "body": body.strip()}

    # status
    if re.search(r"status|how are|what'?s (up|new|today|the numbers)|today'?s numbers|how many deals|numbers today", cl):
        return {"kind": "status"}

    return {"kind": "unknown", "raw": c}

def to_tz_iso(dt: datetime) -> str:
    """Attach local TZ if naive so Postgres stores the wall-clock time correctly."""
    if dt.tzinfo is None: dt = dt.replace(tzinfo=LOCAL_TZ)
    return dt.isoformat()

def action_schedule(intent: dict) -> str:
    when = intent.get("when") or (datetime.now() + timedelta(hours=1))
    ends = when + timedelta(minutes=30)
    title = intent["title"]
    sql = f"""
    INSERT INTO public.calendar_events (title, starts_at, ends_at, source, raw_command, status)
    VALUES ('{pgsql(title)}', '{to_tz_iso(when)}', '{to_tz_iso(ends)}', 'siri',
            '{pgsql(intent.get("raw","apex cli"))}', 'scheduled')
    RETURNING id
    """
    r = run_sql(sql)
    if not r.get("ok"): return f"Failed to schedule: {r.get('error','?')[:100]}"
    pretty = when.strftime("%a %b %-d at %-I:%M %p")
    return f"Scheduled {title} for {pretty} Central time."

def action_reminder(intent: dict) -> str:
    when = intent.get("when") or (datetime.now() + timedelta(minutes=30))
    ends = when + timedelta(minutes=5)
    title = f"Reminder: {intent['title']}"
    sql = f"""
    INSERT INTO public.calendar_events (title, starts_at, ends_at, source, status)
    VALUES ('{pgsql(title)}', '{to_tz_iso(when)}', '{to_tz_iso(ends)}', 'siri', 'reminder')
    """
    run_sql(sql)
    return f"I'll remind you at {when.strftime('%-I:%M %p')} to {intent['title']}."

def action_note(intent: dict) -> str:
    body = intent["body"]
    sql = f"""INSERT INTO public.notifications (title, body, type, priority)
              VALUES ('APEX note', '{pgsql(body)}', 'note', 'low')"""
    run_sql(sql)
    return "Saved."

def action_status(_intent: dict) -> str:
    today = datetime.now().strftime("%Y-%m-%d")
    month_start = datetime.now().replace(day=1).strftime("%Y-%m-%d")
    sql = f"""
    SELECT
      (SELECT COUNT(*)::int FROM public.deals WHERE effective_date::date = '{today}') AS today_deals,
      (SELECT ROUND(COALESCE(SUM(annual_premium),0)::numeric, 0)::int FROM public.deals
        WHERE effective_date::date >= '{month_start}' AND status IN ('active','submitted')) AS mtd_alp,
      (SELECT COUNT(*)::int FROM public.deals WHERE status='active' AND effective_date::date >= '{month_start}') AS active_deals_mtd,
      (SELECT COUNT(*)::int FROM public.applications WHERE status IN ('new','no_pickup','reviewing')) AS open_apps
    """
    r = run_sql(sql)
    if not r.get("ok") or not r.get("rows"): return "Couldn't fetch numbers right now."
    row = r["rows"][0]
    return (f"Today: {row['today_deals']} deals. "
            f"This month: {row['active_deals_mtd']} active, ${row['mtd_alp']:,} ALP. "
            f"Open applications: {row['open_apps']}.")

def action_unknown(intent: dict) -> str:
    sql = f"""INSERT INTO public.notifications (title, body, type, priority)
              VALUES ('Siri — needs parsing', '{pgsql(intent['raw'])}', 'note', 'normal')"""
    run_sql(sql)
    return f"I saved \"{intent['raw'][:60]}\" to your inbox. I don't know how to do that yet."

def main():
    if len(sys.argv) >= 2:
        command = " ".join(sys.argv[1:])
    else:
        # Use AppleScript to prompt for dictation (or just a typed dialog)
        try:
            out = subprocess.check_output([
                "osascript", "-e",
                'text returned of (display dialog "APEX command:" default answer "" buttons {"Cancel","Go"} default button "Go")'
            ], text=True).strip()
            command = out
        except Exception:
            print("Usage: apex <command>  (or run without args for a dialog prompt)")
            sys.exit(1)

    if not command:
        print("No command.")
        sys.exit(1)

    intent = parse_intent(command)
    intent["raw"] = command
    kind = intent["kind"]

    try:
        if   kind == "schedule": msg = action_schedule(intent)
        elif kind == "reminder": msg = action_reminder(intent)
        elif kind == "note":     msg = action_note(intent)
        elif kind == "status":   msg = action_status(intent)
        else:                    msg = action_unknown(intent)
    except Exception as e:
        msg = f"Error: {e}"

    speak(msg)

if __name__ == "__main__":
    main()
