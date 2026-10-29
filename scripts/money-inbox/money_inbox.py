#!/usr/bin/env python3
"""money_inbox.py — MP-309. Sam's iMessage money scanner + approve-to-send daemon.

scan [N]   rank money-making threads from ~/Library/Messages/chat.db (read-only), print table
sync       upsert ranked threads into Supabase money_inbox_threads (service role) + draft replies
send       send every status='approved' row via Messages.app, verify in chat.db, record receipt
run        sync + send (launchd tick)
selftest   send one line to Sam's own number and prove the chat.db receipt path

Honesty rules: a row is 'sent' only when chat.db shows the outbound message (rowid in send_receipt).
No receipt within RECEIPT_WAIT_S => 'failed' + ntfy. Nothing is marked sent on an exit code.
"""
import os, re, sys, json, time, glob, sqlite3, subprocess, datetime as dt, urllib.request, urllib.parse
import csv, fcntl
from classify import classify

HOME = os.path.expanduser("~")
CHAT_DB = f"{HOME}/Library/Messages/chat.db"
CREDS = f"{HOME}/.config/apex-creds"
BASE = f"{HOME}/business-ops/money-inbox"
SAM_HANDLES = {"+14697676068", "sam.com593@gmail.com"}
NTFY = os.environ.get("MONEY_INBOX_ALERT_URL", "")
MAC_EPOCH = 978307200
LOOKBACK_DAYS = 120
TOP_N = 60
DRAFT_TOP = 40
RECEIPT_WAIT_S = 25
TABLE = "money_inbox_threads"

NODE = f"{HOME}/.local/node/bin/node"
def q(db, sql, params=()):
    """Read-only query through the FDA-granted node binary (launchd python has no Full Disk Access)."""
    import base64
    r = subprocess.run([NODE, "--experimental-sqlite", f"{BASE}/chatdb.mjs", db, sql, json.dumps(list(params))], capture_output=True, text=True, timeout=120, stdin=subprocess.DEVNULL)
    if r.returncode != 0: raise RuntimeError(f"chatdb {db}: {r.stderr.strip()[:300]}")
    rows = json.loads(r.stdout or "[]")
    for row in rows:
        for k, v in row.items():
            if isinstance(v, dict) and "b64" in v: row[k] = base64.b64decode(v["b64"])
    return rows

def cred(n):
    p = f"{CREDS}/{n}"
    return open(p).read().strip() if os.path.exists(p) else ""

def log(msg):
    line = f"{dt.datetime.now().isoformat(timespec='seconds')} {msg}"
    print(line, flush=True)
    with open(f"{BASE}/heartbeat.txt", "a") as f: f.write(line + "\n")

def ledger(obj):
    obj["ts"] = dt.datetime.now(dt.timezone.utc).isoformat()
    with open(f"{BASE}/ledger/{dt.date.today()}.jsonl", "a") as f: f.write(json.dumps(obj) + "\n")

def mac_ts(d):
    if not d: return None
    return dt.datetime.fromtimestamp((d / 1e9 if abs(d) > 100_000_000_000 else d) + MAC_EPOCH, dt.timezone.utc)

def decode_attr(blob):
    """Extract the NSString payload from a typedstream attributedBody (macOS 13+ stores text here)."""
    if not blob: return None
    i = blob.find(b"NSString")
    if i < 0: return None
    i = blob.find(b"+", i)
    if i < 0: return None
    i += 1
    ln = blob[i]; i += 1
    if ln == 0x81: ln = int.from_bytes(blob[i:i+2], "little"); i += 2
    elif ln == 0x82: ln = int.from_bytes(blob[i:i+4], "little"); i += 4
    return blob[i:i+ln].decode("utf-8", "ignore")

# ---- money signals -------------------------------------------------------
SIGNALS = [
    ("payment",     5, r"\$\s?\d|zelle|venmo|cash ?app|apple ?pay|paypal|\bwire\b|deposit|invoice|\bowe\b|\bpay(ment|ing|out)?\b|\bpaid\b|commission|residual|advance|chargeback|refund"),
    ("client",      4, r"\bpolic(y|ies)\b|premium|\bquote\b|application|approved|issued|underwrit|beneficiar|coverage|insur|\biul\b|whole life|term life|final expense|annuity|mortgage protection|\bclient\b|\bsold\b|submit|carrier|ethos|aflac|americo|mutual of omaha|\bcoverage\b"),
    ("recruit",     3, r"licens|\bexam\b|\bnpn\b|onboard|contract|\bhire|hiring|interview|join(ing)? (the )?team|recruit|training|\bzoom\b|sign ?up|get started|ready to start|prelicens|xcel|state exam"),
    ("mentorship",  4, r"mentor|coach|inner circle|academy|\bcourse\b|\b1[: ]?on[: ]?1\b|bootcamp|\bprogram\b"),
    ("lead",        3, r"\blead(s)?\b|refer|interested|looking for|\binfo\b|pricing|how much|\bprice\b|\bcost\b|\brate(s)?\b"),
    ("partnership", 3, r"collab|partner|sponsor|podcast|speak(ing|er)|brand deal|promo|affiliate|\bjv\b|\bevent\b|booth"),
    ("intent",      2, r"call me|can we talk|let.?s talk|when (are|can) you|free (today|tomorrow|tonight)|\bbook\b|schedule|appointment|meeting|follow ?up|checking in|you available"),
]
SIGNALS = [(c, w, re.compile(rx, re.I)) for c, w, rx in SIGNALS]
NOISE_SENDER = re.compile(r"^(\d{3,6}|\+1(800|833|844|855|866|877|888)\d{7})$")
NOISE_TEXT = re.compile(r"verification code|your code is|one-time|unsubscribe|reply stop|txt stop|text stop|delivery|order #|tracking|doordash|uber|amazon|\botp\b|appointment reminder|has been delivered|no-reply|do not reply", re.I)

def load_contacts():
    names = {}
    for db in glob.glob(f"{HOME}/Library/Application Support/AddressBook/**/AddressBook-v22.abcddb", recursive=True):
        try:
            for r in q(db, "select p.ZFULLNUMBER num, r.ZFIRSTNAME fn, r.ZLASTNAME ln, r.ZORGANIZATION org from ZABCDPHONENUMBER p join ZABCDRECORD r on r.Z_PK=p.ZOWNER"):
                key = re.sub(r"\D", "", r["num"] or "")[-10:]
                nm = " ".join(x for x in (r["fn"], r["ln"]) if x) or (r["org"] or "")
                if key and nm: names.setdefault(key, nm)
            for r in q(db, "select e.ZADDRESS em, r.ZFIRSTNAME fn, r.ZLASTNAME ln, r.ZORGANIZATION org from ZABCDEMAILADDRESS e join ZABCDRECORD r on r.Z_PK=e.ZOWNER"):
                nm = " ".join(x for x in (r["fn"], r["ln"]) if x) or (r["org"] or "")
                if r["em"] and nm: names.setdefault(r["em"].lower(), nm)
        except Exception as e:
            log(f"contacts: {db}: {e}")
    return names

def contact_name(handle, names):
    if not handle: return None
    if "@" in handle: return names.get(handle.lower())
    return names.get(re.sub(r"\D", "", handle)[-10:])

def scan(top_n=TOP_N):
    names = load_contacts()
    since_s = int(time.time() - LOOKBACK_DAYS * 86400)
    rows = [(r["guid"], r["ident"], r["dname"], r["style"], r["ts"], r["me"], r["text"], r["attr"], r["hid"]) for r in q(CHAT_DB, """
        select c.guid guid, c.chat_identifier ident, c.display_name dname, c.style style,
               (case when abs(m.date)>100000000000 then m.date/1000000000.0 else m.date end + 978307200) ts, m.is_from_me me, m.text text, m.attributedBody attr, h.id hid
        from message m
        join chat_message_join cmj on cmj.message_id = m.ROWID
        join chat c on c.ROWID = cmj.chat_id
        left join handle h on h.ROWID = m.handle_id
        where (case when abs(m.date)>100000000000 then m.date/1000000000.0 else m.date end + 978307200) > ? and m.item_type = 0
        order by ts asc""", (since_s,))]
    threads = {}
    now = dt.datetime.now(dt.timezone.utc)
    for guid, ident, dname, style, ts_s, from_me, text, attr, hid in rows:
        txt = text or decode_attr(attr) or ""
        txt = txt.replace("￼", "").strip()
        if not txt: continue
        t = threads.setdefault(guid, {"chat_guid": guid, "chat_identifier": ident, "display_name": dname or None,
                                      "is_group": style == 43, "msgs": [], "handles": set()})
        if hid: t["handles"].add(hid)
        t["msgs"].append((dt.datetime.fromtimestamp(ts_s, dt.timezone.utc), bool(from_me), txt))
    out = []
    flagged = []
    for t in threads.values():
        ident = t["chat_identifier"] or ""
        if ident in SAM_HANDLES or NOISE_SENDER.match(ident): continue
        msgs = t["msgs"]
        inbound = [m for m in msgs if not m[1]]
        outbound = [m for m in msgs if m[1]]
        if not inbound: continue
        noise = sum(1 for m in inbound if NOISE_TEXT.search(m[2]))
        if noise / len(inbound) > 0.6: continue
        score, hits = 0.0, {}
        for ts, me, txt in msgs:
            age = (now - ts).days
            decay = 1.0 if age <= 7 else 0.6 if age <= 30 else 0.3
            for cat, w, rx in SIGNALS:
                if rx.search(txt):
                    score += w * decay * (1.2 if not me else 1.0)
                    hits[cat] = hits.get(cat, 0) + 1
        classification = classify("\n".join(m[2] for m in msgs), HOME)
        if classification['private']:
            flagged.append({'handle': ident, 'last_date': msgs[-1][0].isoformat(), 'reason': classification['privacy_reason']})
        if score < 3 and classification['topics'] == ['other'] and not classification['private']: continue
        last_in = inbound[-1][0]; last_out = outbound[-1][0] if outbound else None
        awaiting = (last_out is None) or (last_in > last_out)
        wait_h = (now - last_in).total_seconds() / 3600 if awaiting else 0
        if awaiting: score += 6 if wait_h < 72 else 3
        if (now - last_in).total_seconds() < 48 * 3600: score += 4
        if outbound: score += 3
        if t["is_group"]: score *= 0.7
        cats = sorted(((v, k) for k, v in hits.items() if k != "intent"), reverse=True)
        category = cats[0][1] if cats else "intent"
        reasons = [f"{k}×{v}" for v, k in cats[:3]]
        if hits.get("intent"): reasons.append(f"intent×{hits['intent']}")
        if awaiting: reasons.append(f"awaiting reply {int(wait_h)}h")
        handle = ident if not t["is_group"] else (sorted(t["handles"])[0] if t["handles"] else None)
        name = t["display_name"] or contact_name(handle, names)
        if t["is_group"] and not t["display_name"] and t["handles"]:
            name = ", ".join(filter(None, (contact_name(h, names) or h for h in sorted(t["handles"])[:3])))
        excerpt = [{"t": ts.isoformat(), "from": "me" if me else "them", "text": txt[:600]} for ts, me, txt in msgs[-8:]]
        out.append({
            "chat_guid": t["chat_guid"], "chat_identifier": ident, "handle": handle, "display_name": name,
            "source": "imessage", "topics": classification['topics'], "priority": classification['priority'],
            "private": classification['private'], "privacy_reason": classification['privacy_reason'],
            "classified_at": now.isoformat(), "send_supported": not t['is_group'],
            "is_group": t["is_group"], "category": category, "money_score": round(score, 1), "money_reasons": reasons,
            "awaiting_reply": awaiting, "last_inbound_at": last_in.isoformat(), "last_inbound_text": inbound[-1][2][:600],
            "last_outbound_at": last_out.isoformat() if last_out else None, "excerpt": excerpt,
        })
    backup_flagged(flagged)
    out.sort(key=lambda r: r["last_inbound_at"], reverse=True)
    for i, r in enumerate(out, 1): r["rank"] = i
    return out if top_n is None else out[:top_n]

# ---- supabase ------------------------------------------------------------
def sb(method, path, body=None, prefer=None):
    url = cred("supabase.url").rstrip("/") + "/rest/v1/" + path
    key = cred("supabase-service.key")
    hdr = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    if prefer: hdr["Prefer"] = prefer
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, headers=hdr, method=method)
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read().decode()
        return json.loads(raw) if raw else None

def draft_reply(row):
    suggestions = {
        'join_team': 'What experience do you have so far, and when are you free for a quick call?',
        'income': 'What income goal are you working toward, and how much time can you put into it?',
        'car_rental': 'What dates do you need the car, and where will you be picking it up?',
        'next_steps': 'Where are you in the process right now? I’ll help you with the next step.',
        'licensing': 'What state are you getting licensed in, and have you started the course yet?',
        'booking': 'What day and time work best for a quick call?',
        'payment': 'Which payment is this about? Send me the details so I can check.',
        'team_info': 'What would you like to know about the team?',
    }
    topic = next((t for t in row.get('topics', []) if t in suggestions), None)
    return (suggestions.get(topic), 'rules')

def sync():
    scanned = scan(None)
    source_status("imessage", max((r["last_inbound_at"] for r in scanned), default=None), "Mac Messages ingest; live approval listener sends from your number.")
    scanned += social_scan()
    existing = {r["chat_guid"]: r for r in sb("GET", f"{TABLE}?select=chat_guid,status,last_inbound_at,draft_reply,in_scan,muted,rank,money_score,awaiting_reply,classified_at,private,source&limit=2000")}
    seen = set(); inserted = updated = redrafted = 0
    for row in scanned:
        seen.add(row["chat_guid"])
        ex = existing.get(row["chat_guid"])
        if ex and ex.get("muted") and not row["private"]:
            if ex.get("in_scan"): sb("PATCH", f"{TABLE}?chat_guid=eq.{urllib.parse.quote(row['chat_guid'])}", {"in_scan": False, "rank": None}, prefer="return=minimal")
            continue
        body = {k: v for k, v in row.items()}
        body["in_scan"] = True
        if ex is None:
            body["status"] = "pending"
            sb("POST", TABLE, body, prefer="return=minimal"); inserted += 1
        else:
            new_inbound = not ex.get("last_inbound_at") or dt.datetime.fromisoformat(ex["last_inbound_at"].replace("Z","+00:00")) < dt.datetime.fromisoformat(row["last_inbound_at"].replace("Z","+00:00"))
            unchanged = (ex.get("classified_at") and ex.get("private") == row["private"] and not os.environ.get("MONEY_REPAIR") and not new_inbound and ex.get("in_scan") and ex.get("rank") == row["rank"]
                         and ex.get("awaiting_reply") == row["awaiting_reply"]
                         and abs(float(ex.get("money_score") or 0) - row["money_score"]) < 0.05)
            if unchanged:
                continue  # leave the row alone so Sam's Approve never collides with a no-op rewrite
            if new_inbound and ex["status"] in ("sent", "skipped", "failed", "pending"):
                body["status"] = "pending"; body["draft_reply"] = None; body["final_reply"] = None; redrafted += 1
            sb("PATCH", f"{TABLE}?chat_guid=eq.{urllib.parse.quote(row['chat_guid'])}&status=eq.{ex['status']}", body, prefer="return=minimal"); updated += 1
    for guid, ex in existing.items():
        if guid not in seen and ex.get("in_scan"):
            sb("PATCH", f"{TABLE}?chat_guid=eq.{urllib.parse.quote(guid)}", {"in_scan": False, "rank": None}, prefer="return=minimal")
    # drafts
    need = sb("GET", f"{TABLE}?select=chat_guid,display_name,handle,category,money_reasons,excerpt,rank,topics&status=eq.pending&draft_reply=is.null&in_scan=is.true&muted=is.false&private=eq.false&source=eq.imessage&rank=lte.{DRAFT_TOP}&order=rank")
    drafted = 0
    for row in ([] if os.environ.get("MONEY_NO_DRAFT") else need[:8]):  # bounded per tick
        reply, engine = draft_reply(row)
        if reply:
            sb("PATCH", f"{TABLE}?chat_guid=eq.{urllib.parse.quote(row['chat_guid'])}", {"draft_reply": reply, "draft_engine": engine}, prefer="return=minimal"); drafted += 1
    log(f"sync: scanned={len(scanned)} inserted={inserted} updated={updated} redrafted={redrafted} drafted={drafted} need_draft={len(need)}")
    ledger({"action": "sync", "scanned": len(scanned), "inserted": inserted, "updated": updated, "redrafted": redrafted, "drafted": drafted})

# ---- sending -------------------------------------------------------------
def chat_receipt(chat_guid, text, since_unix):
    rows = q(CHAT_DB, """select m.ROWID rowid, m.text text, m.attributedBody attr, (case when abs(m.date)>100000000000 then m.date/1000000000.0 else m.date end + 978307200) ts, m.is_from_me me, m.error err, m.date_delivered delivered, m.is_sent is_sent from message m
        join chat_message_join j on j.message_id=m.ROWID join chat ch on ch.ROWID=j.chat_id
        where ch.guid=? and (case when abs(m.date)>100000000000 then m.date/1000000000.0 else m.date end + 978307200) > ? order by m.date desc limit 20""", (chat_guid, int(since_unix - 5)))
    norm = lambda s: re.sub(r"\s+", " ", (s or "")).strip()
    for r in rows:
        body = norm(r["text"] or decode_attr(r["attr"]))
        if body == norm(text) and (r["me"] or chat_guid.endswith(tuple(SAM_HANDLES))):
            return r["rowid"], dt.datetime.fromtimestamp(r["ts"], dt.timezone.utc).isoformat(), r["err"], mac_ts(r["delivered"]).isoformat() if r["delivered"] else None
    return None, None, None, None

def send_one(chat_guid, text, handle=None):
    esc = text.replace("\\", "\\\\").replace('"', '\\"')
    started = time.time()
    r = subprocess.run(["osascript", "-e", f'tell application "Messages" to send "{esc}" to chat id "{chat_guid}"'], capture_output=True, text=True, timeout=60, stdin=subprocess.DEVNULL)
    if r.returncode != 0 and "-1728" in (r.stderr or "") and handle:
        # Messages.app does not know this chat guid: address the participant directly on the iMessage account
        r = subprocess.run(["osascript", "-e", f'tell application "Messages" to send "{esc}" to participant "{handle}" of (first account whose service type is iMessage)'], capture_output=True, text=True, timeout=60, stdin=subprocess.DEVNULL)
    last_receipt = None
    deadline = time.time() + RECEIPT_WAIT_S
    while time.time() < deadline:
        rowid, ts, err, delivered = chat_receipt(chat_guid, text, started)
        if rowid:
            last_receipt = (True, f"chat.db#{rowid}@{ts}" + (f" error={err}" if err else ""), None if not err else f"messages error code {err}", delivered)
            if delivered or err: return last_receipt
        time.sleep(0.2)
    if last_receipt: return last_receipt
    return (False, None, f"no chat.db receipt in {RECEIPT_WAIT_S}s; osascript rc={r.returncode} {r.stderr.strip()[:200]}", None)

def ntfy(title, msg, prio="high"):
    if not NTFY: return
    try:
        req = urllib.request.Request(NTFY, data=msg.encode(), headers={"Title": title.encode("ascii", "ignore").decode(), "Priority": prio}, method="POST")
        urllib.request.urlopen(req, timeout=10).read()
    except Exception as e:
        log(f"ntfy failed: {e}")

def send():
    rows = sb("GET", f"{TABLE}?select=chat_guid,display_name,handle,draft_reply,final_reply,approved_at&status=eq.approved&private=eq.false&source=eq.imessage&send_supported=eq.true&order=approved_at")
    for row in rows:
        text = (row.get("final_reply") or row.get("draft_reply") or "").strip()
        guid = row["chat_guid"]; who = row.get("display_name") or row.get("handle")
        q = f"{TABLE}?chat_guid=eq.{urllib.parse.quote(guid)}"
        if not text:
            sb("PATCH", q, {"status": "failed", "send_error": "empty reply"}, prefer="return=minimal"); continue
        claimed = sb("PATCH", q + "&status=eq.approved&private=eq.false", {"status": "sending", "send_started_at": dt.datetime.now(dt.timezone.utc).isoformat()}, prefer="return=representation")
        if not claimed: continue
        ok, receipt, err, delivered = send_one(guid, text, row.get("handle"))
        if ok and not err:
            sb("PATCH", q, {"status": "sent", "sent_at": dt.datetime.now(dt.timezone.utc).isoformat(), "send_receipt": receipt, "send_error": None, "delivered_at": delivered, "delivery_latency_ms": (dt.datetime.fromisoformat(delivered)-dt.datetime.fromisoformat(row["approved_at"].replace("Z","+00:00"))).total_seconds()*1000 if delivered else None}, prefer="return=minimal")
            log(f"sent -> {who}: {receipt}"); ledger({"action": "sent", "to": who, "chat_guid": guid, "receipt": receipt, "chars": len(text)})
        else:
            sb("PATCH", q, {"status": "failed", "send_error": err or "unknown", "send_receipt": receipt}, prefer="return=minimal")
            log(f"FAILED -> {who}: {err}"); ledger({"action": "send_failed", "to": who, "chat_guid": guid, "error": err})
            ntfy("Money Inbox: send failed", f"To {who}: {err}\nIf macOS asked 'bash wants to control Messages', click Allow once, then re-approve on the site.")

def selftest():
    guid = "any;-;+14697676068"
    txt = f"money-inbox selftest {dt.datetime.now().strftime('%H:%M:%S')}"
    ok, receipt, err, delivered = send_one(guid, txt)
    print(json.dumps({"ok": ok and not err, "receipt": receipt, "error": err}))
    sys.exit(0 if ok and not err else 1)

def backup_flagged(flagged):
    path=f"{HOME}/business-ops/session-state/private-flagged.csv"
    existing={}
    if os.path.exists(path):
        with open(path) as f:
            for r in csv.DictReader(f): existing[r['handle']]=r
    for row in flagged: existing[row['handle']]=row
    tmp=path+'.tmp'
    with open(tmp,'w') as f:
        writer=csv.DictWriter(f,fieldnames=['handle','last_date','reason']); writer.writeheader(); writer.writerows(existing.values())
    os.chmod(tmp,0o600); os.replace(tmp,path)

def source_status(source, latest, reason):
    fresh=bool(latest and (dt.datetime.now(dt.timezone.utc)-dt.datetime.fromisoformat(latest.replace('Z','+00:00'))).total_seconds()<7*86400)
    sb('POST','money_inbox_sources?on_conflict=source',{'source':source,'connected':fresh,'reason':reason if fresh else 'Not connected: no verified inbound in the last 7 days. '+reason,'last_ingested_at':latest,'checked_at':dt.datetime.now(dt.timezone.utc).isoformat()},prefer='resolution=merge-duplicates,return=minimal')

def social_scan():
    # Preserve original received/published timestamps; never replace them with sync time.
    messages=sb('GET','inbox_messages?select=id,source,external_id,sender_handle,sender_name,body,direction,received_at,replied_at,auto_replied&order=received_at.desc&limit=5000')
    groups={}; latest={}; result=[]; flagged=[]
    for m in messages:
        if m['source']=='youtube': continue # canonical comments below, avoids duplicate manychat copies
        key=(m['source'],m.get('external_id') or m['id'])
        groups.setdefault(key,[]).append(m)
        if m['direction']=='inbound' and m['received_at']: latest[m['source']]=max(latest.get(m['source'],'') or '',m['received_at'])
    for (source,ident),msgs in groups.items():
        msgs.sort(key=lambda m:m['received_at'] or '')
        inbound=[m for m in msgs if m['direction']=='inbound' and m['received_at']]
        if not inbound: continue
        last=inbound[-1]; cls=classify('\n'.join(m['body'] or '' for m in msgs),HOME)
        if cls['private']: flagged.append({'handle':source+':'+(last.get('sender_handle') or ident),'last_date':last['received_at'],'reason':cls['privacy_reason']})
        if cls['topics']==['other'] and not cls['private']: continue
        result.append({'chat_guid':f'{source}:{ident}','chat_identifier':ident,'handle':last.get('sender_handle') or ident,'display_name':last.get('sender_name'),'source':source,'topics':cls['topics'],'priority':cls['priority'],'private':cls['private'],'privacy_reason':cls['privacy_reason'],'classified_at':dt.datetime.now(dt.timezone.utc).isoformat(),'send_supported':False,'category':cls['topics'][0],'money_score':4-cls['priority'],'money_reasons':[],'rank':None,'awaiting_reply':msgs[-1]['direction']=='inbound' and not last.get('replied_at') and not last.get('auto_replied'),'last_inbound_at':last['received_at'],'last_inbound_text':last['body'],'excerpt':[{'t':m['received_at'],'from':'me' if m['direction']=='outbound' else 'them','text':m['body']} for m in msgs[-8:]],'source_url':'/dashboard/inbox/instagram' if source=='instagram' else 'https://www.tiktok.com/inbox' if source=='tiktok' else None})
    comments=sb('GET','youtube_comment_events?select=comment_id,video_id,author_channel_id,author_name,text,published_at,replied_at,intent&order=published_at.desc&limit=1000')
    for m in comments:
        if not m['published_at']: continue
        latest['youtube']=max(latest.get('youtube','') or '',m['published_at'])
        cls=classify(m['text'] or '',HOME)
        if cls['private']: flagged.append({'handle':'youtube:'+str(m['author_channel_id']),'last_date':m['published_at'],'reason':cls['privacy_reason']})
        if cls['topics']==['other'] and not cls['private']: continue
        result.append({'chat_guid':'youtube:'+m['comment_id'],'handle':m['author_channel_id'],'display_name':m['author_name'],'source':'youtube','topics':cls['topics'],'priority':cls['priority'],'private':cls['private'],'privacy_reason':cls['privacy_reason'],'classified_at':dt.datetime.now(dt.timezone.utc).isoformat(),'send_supported':False,'category':cls['topics'][0],'money_score':4-cls['priority'],'money_reasons':[],'rank':None,'awaiting_reply':not m['replied_at'] and m['intent']!='already_answered','last_inbound_at':m['published_at'],'last_inbound_text':m['text'],'excerpt':[{'t':m['published_at'],'from':'them','text':m['text']}],'source_url':'https://www.youtube.com/watch?v='+m['video_id']+'&lc='+m['comment_id']})
    backup_flagged(flagged)
    for source in set(latest)|{'instagram','tiktok','youtube'}:
        source_status(source,latest.get(source),'Inbound mirror verified. Reply in source; approve-to-send is not connected for this channel.')
    return result


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "scan"
    if cmd in ('sync','run'):
        sync_lock=open(f"{BASE}/sync.lock","w")
        try: fcntl.flock(sync_lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError: sys.exit(0)
    if cmd == "scan":
        n = int(sys.argv[2]) if len(sys.argv) > 2 else 30
        for r in scan(n):
            print(f"{r['rank']:>2} {r['money_score']:>5} {('⏳' if r['awaiting_reply'] else '  ')} {(r['display_name'] or r['handle'] or '?')[:26]:<26} {r['category']:<11} {', '.join(r['money_reasons'])[:48]:<48} | {r['last_inbound_text'][:70]!r}")
    elif cmd == "json":
        print(json.dumps(scan(int(sys.argv[2]) if len(sys.argv) > 2 else 30), indent=1))
    elif cmd == "sync": sync()
    elif cmd == "send":
        lock = open(f"{BASE}/sender.lock", "w")
        try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: sys.exit(0)
        send()
    elif cmd == "run": sync()
    elif cmd == "selftest": selftest()
    else: print(__doc__)
