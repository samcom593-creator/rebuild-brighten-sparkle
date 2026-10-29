"""Rules first. Private content is excluded before drafting, independent of sender."""
import re, json, hashlib, pathlib, urllib.request
HAIKU_AVAILABLE = True
TOPICS = [
 ('join_team', r'join.{0,25}(team|apex)|work (with|for) you|hiring|recruit'),
 ('income', r'make (more )?money|extra (money|income)|income|side hustle|earn money'),
 ('car_rental', r'rent.{0,25}(car|vehicle)|car.{0,25}rent|turo|rental car'),
 ('next_steps', r'next step|get started|ready to start|sign (me )?up|onboard'),
 ('team_info', r'team|apex|more info|information|interested|opportunity|insurance|how.{0,15}work'),
 ('licensing', r'licens|state exam|\bnpn\b|prelicens|xcel'),
 ('booking', r'interview|book|schedule|appointment|call me|zoom'),
 ('payment', r'\$\s?\d|payment|\bpay\b|paid|zelle|venmo|cash ?app|invoice|commission'),
]
PRIVATE = re.compile(r'\b(sex|sexy|sexual|nudes?|naked|horny|orgasm|cuddle|cuddling|sext|sexting|babe|baby|sweetheart|boyfriend|girlfriend|hookup)\b|make love|sleep with you|kiss (you|me)|miss (you|your)|love you|in love|turn me on|come to bed|send.{0,12}pics|romantic|dating you', re.I)
AMBIGUOUS = re.compile(r'\b(date|bed|bedroom|relationship|intimate|beautiful|gorgeous|cute|darling|honey|tonight|personal|pregnant|pregnancy|divorce)\b|❤️|😘|😍', re.I)

def classify(text, home=None):
    global HAIKU_AVAILABLE
    topics = [name for name, rx in TOPICS if re.search(rx,text,re.I)]
    if PRIVATE.search(text): return {'topics': topics or ['other'], 'priority': 1 if any(x in topics for x in ['join_team','income','car_rental','next_steps']) else 2 if topics else 3, 'private': True, 'privacy_reason': 'Sexual, romantic or intimate language', 'engine': 'rules'}
    result = {'topics': topics or ['other'], 'priority': 1 if any(x in topics for x in ['join_team','income','car_rental','next_steps']) else 2 if topics else 3, 'private': False, 'privacy_reason': None, 'engine': 'rules'}
    if not home or (topics and not AMBIGUOUS.search(text)): return result
    root=pathlib.Path(home); cache=root/'business-ops/money-inbox/classification-cache'; cache.mkdir(exist_ok=True)
    digest=hashlib.sha256(('v2:'+text).encode()).hexdigest(); path=cache/digest
    if path.exists(): return json.loads(path.read_text())
    keypath=root/'.config/apex-creds/anthropic.token'
    try:
        if not HAIKU_AVAILABLE: raise RuntimeError("classifier unavailable")
        service=(root/'.config/apex-creds/supabase-service.key').read_text().strip()
        url=(root/'.config/apex-creds/supabase.url').read_text().strip().rstrip('/')
        req=urllib.request.Request(url+'/functions/v1/money-inbox-classify',data=json.dumps({'text':text[-16000:]}).encode(),headers={'Authorization':'Bearer '+service,'apikey':service,'Content-Type':'application/json'})
        with urllib.request.urlopen(req,timeout=25) as response: raw=json.load(response)
        valid={x[0] for x in TOPICS}|{'other'}; ts=[x for x in raw['topics'] if x in valid]
        if not isinstance(raw['private'],bool) or not ts: raise ValueError('invalid classification')
        result.update(topics=ts,priority=1 if set(ts)&{'join_team','income','car_rental','next_steps'} else 2 if ts!=['other'] else 3,private=raw['private'],privacy_reason=raw.get('privacy_reason') if raw['private'] else None,engine='haiku')
        path.write_text(json.dumps(result)); path.chmod(0o600)
    except Exception as error:
        if getattr(error,"code",None) in (401,403,429,503): HAIKU_AVAILABLE=False
        if AMBIGUOUS.search(text): result.update(private=True,privacy_reason='Intimate context needs private review; classifier unavailable',engine='quarantine')
    return result
