// MP-534: verify on a LIVE AUTHENTICATED session that MP-533's roster prime
// actually makes the ~740 "<name> · $X Deal Win" headlines on /dashboard/admin/sam
// render fake. MP-533 shipped the mask with 56 tests + 4 mutations and explicitly
// did NOT claim this leg.
//
// Two controls, because the failure mode here is a VACUOUS pass:
//   C1 authenticated  — a login redirect makes "no real names in demo" trivially true.
//   C2 panel rendered — if the drafts panel shows zero real names in the PLAIN
//                       render, then finding zero in the demo render proves nothing.
// The name set is DERIVED from live prod (social_bot_drafts titles), never hardcoded:
// a hardcoded list is how a probe quietly stops measuring as data moves.
//
// NOTE for anyone mutating this to check it still works: demo mode has TWO
// independent enablers -- the `apex.demoMode` localStorage flag AND the
// `?demo=1` query param. Removing only one leaves demo mode ON, so the mutation
// lands in the file and changes nothing, and the probe reports CLEAN for a
// reason that has nothing to do with the mask. Kill both, or prove nothing.
//
// Exit codes: 0 CLEAN, 1 LEAK, 2 UNPROVEN (a control failed -- never a pass),
// 3 name set unusable, 4 session could not be minted.
import { chromium } from 'playwright';
import fs from 'fs';

const SURL = fs.readFileSync(process.env.HOME + '/.config/apex-creds/supabase.url','utf8').trim();
const SKEY = fs.readFileSync(process.env.HOME + '/.config/apex-creds/supabase-service.key','utf8').trim();
const ANON = fs.readFileSync(process.env.HOME + '/.config/apex-creds/supabase.anon','utf8').trim();
const BURL = fs.readFileSync(process.env.HOME + '/.config/apex-creds/bot-sql.url','utf8').trim();
const BTOK = fs.readFileSync(process.env.HOME + '/.config/apex-creds/bot-sql.token','utf8').trim();
const EMAIL = 'sam.com593@gmail.com';
const REF = new URL(SURL).hostname.split('.')[0];
const SITE = 'https://apex-financial.org';

async function sql(query) {
  const r = await fetch(BURL, { method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${BTOK}`}, body:JSON.stringify({query}) });
  const t = await r.text();
  if (!r.ok) throw new Error(`bot-sql ${r.status} ${t.slice(0,200)}`);
  return JSON.parse(t).rows;
}

// ── derive the real name set from live data ───────────────────────────────────
const titles = await sql(`select title from social_bot_drafts where title like '%Deal Win%' order by draft_date desc limit 800`);
const REAL = [...new Set(titles.map(r => String(r.title).split('·')[0].trim()).filter(n => n && n.length > 2))];
if (REAL.length < 5) { console.error(`name set too small (${REAL.length}) — refusing to grade against it`); process.exit(3); }
console.log(`name set derived from live prod: ${REAL.length} distinct people across ${titles.length} titles`);

// ── mint a session; generate_link returns the hashed token and sends NO email ──
const gl = await fetch(`${SURL}/auth/v1/admin/generate_link`, {
  method:'POST', headers:{ apikey:SKEY, Authorization:`Bearer ${SKEY}`, 'Content-Type':'application/json' },
  body: JSON.stringify({ type:'magiclink', email: EMAIL }),
});
const glj = await gl.json();
const tokenHash = glj.hashed_token || glj.properties?.hashed_token;
if (!gl.ok || !tokenHash) { console.error('generate_link failed', gl.status, JSON.stringify(glj).slice(0,200)); process.exit(4); }
const vr = await fetch(`${SURL}/auth/v1/verify`, {
  method:'POST', headers:{ apikey:ANON, 'Content-Type':'application/json' },
  body: JSON.stringify({ type:'magiclink', token_hash: tokenHash }),
});
const session = await vr.json();
if (!vr.ok || !session.access_token) { console.error('verify failed', vr.status, JSON.stringify(session).slice(0,200)); process.exit(4); }
console.log(`session minted for ${EMAIL}`);

const storageKey = `sb-${REF}-auth-token`;
const storageVal = JSON.stringify({
  access_token: session.access_token, refresh_token: session.refresh_token,
  expires_at: Math.floor(Date.now()/1000) + (session.expires_in ?? 3600),
  expires_in: session.expires_in ?? 3600, token_type:'bearer', user: session.user,
});

const ROUTES = process.argv.slice(2).length ? process.argv.slice(2) : ['/dashboard/admin/sam'];
const browser = await chromium.launch();

async function render(route, demo) {
  const ctx = await browser.newContext({ viewport:{width:1440,height:900} });
  await ctx.addInitScript(([k,v,d]) => {
    localStorage.setItem(k, v);
    if (d) localStorage.setItem('apex.demoMode','1'); else localStorage.removeItem('apex.demoMode');
  }, [storageKey, storageVal, demo]);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e).slice(0,160)));
  const resp = await page.goto(SITE + route + (demo ? '?demo=1' : ''), { waitUntil:'networkidle', timeout:60000 })
    .catch(e => { errs.push('goto:'+e.message.slice(0,100)); return null; });
  await page.waitForTimeout(6000);
  const out = await page.evaluate(() => ({
    text: document.body.innerText,
    href: location.href,
    rootKids: document.getElementById('root')?.children.length ?? 0,
  }));
  await ctx.close();
  return { ...out, status: resp?.status() ?? 0, errs };
}

let anyFail = false, anyUnproven = false;

for (const route of ROUTES) {
  console.log(`\n═══ ${route} ═══`);
  const plain = await render(route, false);
  const demo  = await render(route, true);

  // C1 — authenticated?
  const authed = !/\/auth|\/login/.test(plain.href) && plain.rootKids > 0 && plain.text.length > 400;
  console.log(`  C1 auth    : landed=${plain.href.replace(SITE,'')} rootKids=${plain.rootKids} textLen=${plain.text.length} -> ${authed?'AUTHENTICATED':'NOT AUTHENTICATED'}`);
  if (!authed) { console.log(`  VERDICT: UNPROVEN — control C1 failed.`); anyUnproven = true; continue; }

  // C2 — did the panel carrying the headlines actually render?
  const plainHits = REAL.filter(n => plain.text.includes(n));
  console.log(`  C2 panel   : ${plainHits.length}/${REAL.length} real names visible WITHOUT demo -> ${plainHits.length?'RENDERED':'NOT RENDERED'}`);
  if (plainHits.length) console.log(`               e.g. ${plainHits.slice(0,6).join(', ')}`);
  if (!plainHits.length) {
    console.log(`  VERDICT: UNPROVEN — no real names on the unmasked page, so a clean demo render proves nothing here.`);
    anyUnproven = true; continue;
  }

  // banner copy tells us the LIVE prime state — the thing MP-533 could not verify
  const bannerPrimed = /every number and name on screen is fake/i.test(demo.text);
  const bannerPartial = /Names written inside sentences may still be real/i.test(demo.text);
  console.log(`  banner     : ${bannerPrimed?'PRIMED (full claim)':bannerPartial?'PARTIAL (honest fallback)':'ABSENT'}`);

  const survivors = plainHits.filter(n => demo.text.includes(n));
  console.log(`  survivors  : ${survivors.length}/${plainHits.length}${survivors.length?' -> '+survivors.slice(0,8).join(', '):''}`);
  if (demo.errs.length) console.log(`  pageerrors : ${demo.errs.slice(0,3).join(' | ')}`);

  const leaks = [];
  if (!bannerPrimed && !bannerPartial) leaks.push('banner absent under ?demo=1');
  if (survivors.length) leaks.push(`${survivors.length} real name(s) survive`);
  if (bannerPrimed && survivors.length) leaks.push('banner claims FULL coverage while names survive — the banner is lying');
  console.log(leaks.length ? `  VERDICT: LEAK — ${leaks.join('; ')}` : `  VERDICT: CLEAN (${plainHits.length} real names masked)`);
  if (leaks.length) anyFail = true;
}

await browser.close();
if (anyFail) process.exit(1);
if (anyUnproven) process.exit(2);   // UNPROVEN is never dressed as a pass
process.exit(0);
