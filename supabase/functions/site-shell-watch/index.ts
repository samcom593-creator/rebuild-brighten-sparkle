// site-shell-watch (MP-304, 2026-08-19)
//
// An OFF-LAPTOP watcher for apex-financial.org's shell + asset graph, fired by
// pg_cron every 10 minutes.
//
// WHY THIS EXISTS, MEASURED. MP-296 shipped apex-site-health-probe.sh on a 600s
// launchd StartInterval. MP-303 read its log and found the coverage it had been
// silently assuming was not there: 85 rows against 127 ticks expected over
// 21.0h = 66.9% of intervals observed, 7.42h with no probe at all, longest
// blind window 176 minutes. The cause is not a closed lid -- caffeinate held
// PreventUserIdleSystemSleep across the entire window -- it is Deep Idle with
// DarkWake (535 of them on battery at 12-14%), which a StartInterval job cannot
// tick through. Worse than the raw percentage: EVERY blind minute measured fell
// between 09:00 and 19:00 Phoenix, i.e. inside business hours, and 34% of the
// last 103 pushes to main land in those same hours. The holes are where the
// deploys are.
//
// WHY pg_cron AND NOT GITHUB ACTIONS. Both candidates were on record; the
// decision is measured, not preferred. Over 7 days, cron.job_run_details for
// jobid 22 shows 671 consecutive intervals at mean 900.0s, p90 900.2s, max
// 900.7s, and 672 of 672 runs succeeded -- sub-second drift, zero misses, 100%
// coverage. MP-280 measured GitHub's scheduled runners on this account at p90
// 40.8 min and max 108 min against a header promising 10 min. A watcher whose
// worst gap is 108 minutes is not a fix for a watcher whose worst gap is 176.
//
// THE SUBORDINATION RULE -- the reason this can exist without becoming the next
// drift. Two watchers answering one question is exactly how curl's --max-time
// drifted from fn_agentlink_reap_stuck into 36 false pages a day. So this one is
// deliberately NOT a peer:
//
//   1. It asserts a STRICT SUBSET of apex-site-health.sh: the shell returns 200,
//      and every /assets/*.js|css that the served index.html itself declares
//      resolves 200 with the right content-type. Nothing deeper. The data layer
//      (MP-300) and the write path (MP-302) stay with the laptop probe, which is
//      the authority on them.
//   2. It may only ESCALATE. A clean run here is recorded as NOTE and means
//      "the floor held" -- it is NOT an all-clear about anything the laptop
//      probe checks, and the doctor message says so in those words. Absence of
//      a red from a shallow watcher is not health; that confusion is what let
//      the Stripe pipeline sit dark for 56.8 days behind a view that returned
//      zero rows.
//   3. Its ASSET SET is recorded on every row so the two watchers can be
//      compared instead of trusted. apex-doctor Check #28c compares the two logs
//      on rows that observed the SAME entry bundle -- same build, so the
//      declared set must be identical -- and reports any divergence as drift.
//      Instrument the disagreement; do not promise it cannot happen.
//
// GATES, each one paid for by a previous wave:
//   CONFIRM  -- a CRIT is re-probed after 20s before it can page. MP-291
//               measured 119 of 183 wifi paging episodes (65%) as single ticks
//               that were healthy again a minute later.
//   DE-STORM -- one page per EPISODE, never per probe. 1,680 of 2,779
//               bot_alerts rows were one repeated event.
//   UNKNOWN  -- if the site fails AND the control host fails, this runtime's
//               egress is the suspect, not the site. Recorded, never paged,
//               and it never closes an open episode.
//
// ASCII-ONLY ntfy Title. MP-274: header values are ByteStrings and Deno THROWS
// while constructing the Request on any codepoint above 0xFF, so an emoji title
// kills the push before a byte reaches the network and the throw looks like an
// ordinary false. No emoji here, ever.

// MP-307: TWO CHANNELS, AND THE PRIMARY IS STILL THE ONE THAT MATTERS.
// Measured, not assumed: pg_cron jobid 79 fired this watcher at 13:20, 13:30,
// 13:40, 13:50, 14:00 and 14:10 on 2026-08-19 (cron.job_run_details, 6 of 6
// "succeeded"). The site was confirmed down from 13:30. Of the TWO autonomous
// fires that reached the paging gate, ntfy refused BOTH with HTTP 429. The only
// page that ever left the building is the 13:47:31 row -- and there is no 13:47
// cron fire, because that one was invoked BY HAND by the session that was
// already staring at the outage. So this watcher, whose entire purpose is the
// case where no session is watching, delivered 0 of 2 autonomous pages on its
// first and only real test.
//
// MP-306 added a 3-attempt in-process ladder and said in its own comment that
// it reduces the mute window without closing it: ntfy.sh's free tier limits by
// VISITOR, and this runtime's visitor is Supabase's shared egress, so the bucket
// can be empty for reasons that have nothing to do with Apex and stay empty
// longer than any backoff worth running inside a cron tick. Retrying harder on
// one rate-limited channel is not redundancy.
//
// So the ladder now crosses CHANNELS, not just attempts: ntfy first, and only
// if ntfy refuses, the Discord webhook in system_settings.discord_webhook_url --
// a different vendor, a different limiter, a different quota.
//
// THE TRAP THIS OPENS, and the reason Check #28d exists. A fallback that works
// makes the primary's failure invisible: every page still lands, `paged` still
// reads true, and nothing anywhere says that the channel which actually reaches
// Sam's pocket has gone dark. That is the fake-success disease wearing a helpful
// costume. Two rules keep it honest:
//   1. `paged_via` records WHICH channel landed and its provider-issued message
//      id -- a receipt, never a bare boolean (MP-273: sent_sms_id held 'sent'
//      314 times and a provider id zero times).
//   2. Discord is never promoted. It is a fallback, it is labelled as one in the
//      message body, and apex-doctor Check #28d grades the PRIMARY channel's
//      health separately from whether delivery happened at all.
// Discord is NOT claimed to reach Sam's phone; ntfy is the channel MP-291
// measured landing there 207 times in 42 days. Discord is a second exit, not a
// second pocket.

const BASE = Deno.env.get("SHELL_WATCH_BASE") ?? "https://apex-financial.org";
const CONTROL = Deno.env.get("SHELL_WATCH_CONTROL") ?? "https://vercel.com";
const NTFY = Deno.env.get("SHELL_WATCH_NTFY") ??
  "https://ntfy.sh/sams-agent-yrkv9kbqp9e987nb";
// Read live from system_settings so a rotated webhook cannot leave a silently
// dead fallback behind (2026-08-07: a token rotation that missed one consumer
// would have made apex-doctor report a page of CRITICALs about a healthy DB).
// Env override exists so the proof harness can point this at a throwaway sink.
const DISCORD_ENV = Deno.env.get("SHELL_WATCH_DISCORD") ?? "";
const MIN_JS_BYTES = Number(Deno.env.get("SHELL_WATCH_MIN_JS_BYTES") ?? "128");
const CONFIRM_DELAY_MS = Number(Deno.env.get("SHELL_WATCH_CONFIRM_MS") ?? "20000");
const FETCH_TIMEOUT_MS = 25000;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type Probe = {
  verdict: "NOTE" | "CRIT" | "UNKNOWN";
  reason: string;
  assets: string[];
  entryHash: string | null;
  jsCount: number;
  cssCount: number;
};

async function get(url: string): Promise<
  { ok: boolean; status: number; ctype: string; bytes: number; body: string; err: string }
> {
  // The fetch error is KEPT, never discarded behind a bare catch that returns a
  // falsy default -- MP-290's `|| echo ""` made a check blame a function for the
  // network. Three attempts, because one transient CDN blip must not become a
  // verdict.
  let last = { ok: false, status: 0, ctype: "", bytes: 0, body: "", err: "no attempt" };
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, attempt * 2000));
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ac.signal, redirect: "follow" });
      const body = await res.text();
      last = {
        ok: res.status === 200,
        status: res.status,
        ctype: res.headers.get("content-type") ?? "",
        bytes: new TextEncoder().encode(body).length,
        body,
        err: "",
      };
      if (last.ok) return last;
    } catch (e) {
      last = { ok: false, status: 0, ctype: "", bytes: 0, body: "", err: String(e) };
    } finally {
      clearTimeout(t);
    }
  }
  return last;
}

// Anchored on the ATTRIBUTE (src="/href="), never the tag name. <script src>,
// <link rel=modulepreload href> and <link rel=stylesheet href> all load real
// bytes; MP-297 shipped a check that saw 1 of 6 because it anchored on
// <script src= and every modulepreload chunk was invisible while the entry
// bundle hard-imports them. Byte-identical to apex-site-health.sh:221 -- this is
// the shared assertion, so it is written the same way in both.
const ASSET_RE = /(?:src|href)="(\/assets\/[A-Za-z0-9_.@-]+\.(?:js|css))"/g;

async function probe(): Promise<Probe> {
  const shell = await get(BASE + "/");
  if (!shell.ok) {
    const control = await get(CONTROL);
    if (!control.ok) {
      return {
        verdict: "UNKNOWN",
        reason:
          `neither ${BASE} (HTTP ${shell.status}${shell.err ? " " + shell.err : ""}) nor the control host ` +
          `${CONTROL} (HTTP ${control.status}) answered from this edge runtime - egress is the suspect, not the site`,
        assets: [], entryHash: null, jsCount: 0, cssCount: 0,
      };
    }
    return {
      verdict: "CRIT",
      reason:
        `${BASE}/ returned HTTP ${shell.status}${shell.err ? " (" + shell.err + ")" : ""} while the control host ${CONTROL} answered 200`,
      assets: [], entryHash: null, jsCount: 0, cssCount: 0,
    };
  }
  if (!/text\/html/i.test(shell.ctype)) {
    return {
      verdict: "CRIT",
      reason: `${BASE}/ returned 200 with content-type '${shell.ctype || "unknown"}', not HTML`,
      assets: [], entryHash: null, jsCount: 0, cssCount: 0,
    };
  }

  const assets = [...new Set([...shell.body.matchAll(ASSET_RE)].map((m) => m[1]))].sort();
  const js = assets.filter((a) => a.endsWith(".js"));
  const css = assets.filter((a) => a.endsWith(".css"));
  const entryHash = js.find((a) => /^\/assets\/index-/.test(a)) ?? null;

  if (js.length === 0) {
    return {
      verdict: "CRIT",
      reason:
        `${BASE}/ served a 200 shell (${shell.bytes}B) that references NO /assets/*.js module - every route still returns 200, which is why nothing else would notice`,
      assets, entryHash, jsCount: 0, cssCount: css.length,
    };
  }

  const broken: string[] = [];
  const wrongType: string[] = [];
  const thin: string[] = [];
  for (const a of assets) {
    const r = await get(BASE + a);
    if (!r.ok) { broken.push(`${a}(HTTP ${r.status}${r.err ? " " + r.err : ""})`); continue; }
    if (a.endsWith(".js")) {
      // CONTENT-TYPE IS LOAD-BEARING. Measured 2026-08-18: a garbage path under
      // this site's rewrite returns 200 text/html carrying the 12KB SPA shell.
      // If /assets/* ever stopped being excluded from that rewrite, every asset
      // would 200 with a body far above any byte floor - a total white screen
      // that a size check reports as healthy.
      if (!/javascript|ecmascript/i.test(r.ctype)) wrongType.push(`${a}(200 as '${r.ctype || "unknown"}')`);
      else if (r.bytes < MIN_JS_BYTES) thin.push(`${a}(${r.bytes}B)`);
    } else {
      if (!/text\/css/i.test(r.ctype)) wrongType.push(`${a}(200 as '${r.ctype || "unknown"}')`);
    }
  }

  const parts: string[] = [];
  if (wrongType.length) {
    parts.push(`WRONG CONTENT-TYPE:${wrongType.join(" ")} - a 200 carrying the HTML shell instead of the module is a white screen every status-code monitor reads as healthy`);
  }
  if (broken.length) {
    parts.push(`WHITE SCREEN - index.html returns 200 but the assets it names do not resolve:${broken.join(" ")}`);
  }
  if (thin.length) {
    parts.push(`TRUNCATED BUNDLE (200 but under ${MIN_JS_BYTES}B):${thin.join(" ")}`);
  }

  if (parts.length) {
    return {
      verdict: "CRIT", reason: parts.join(" | "),
      assets, entryHash, jsCount: js.length, cssCount: css.length,
    };
  }
  return {
    verdict: "NOTE",
    reason: `shell 200 + ${js.length} js / ${css.length} css assets resolved with correct content-type`,
    assets, entryHash, jsCount: js.length, cssCount: css.length,
  };
}

async function sql(path: string, init: RequestInit): Promise<Response> {
  return await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}


// ---------------------------------------------------------------------------
// PAGE CHANNELS (MP-307)
//
// Each returns a RECEIPT string on success, never a bare boolean. ntfy and
// Discord both hand back a provider-issued message id; a status code alone
// cannot tell "the sink accepted and stored this" from "something in front of
// the sink answered 200".
// ---------------------------------------------------------------------------
type ChannelResult = { receipt: string | null; error: string | null };

async function pushNtfy(body: string): Promise<ChannelResult> {
  const res = await fetch(NTFY, {
    method: "POST",
    signal: AbortSignal.timeout(10000),
    headers: {
      // ASCII ONLY - see MP-274 in the header.
      Title: "APEX site DOWN (off-laptop watcher)",
      Priority: "5",
      Tags: "rotating_light",
    },
    body,
  });
  if (!res.ok) {
    // Record the BODY, not just the status. ntfy answers a refusal with a JSON
    // `code` naming WHICH limit was hit; "ntfy HTTP 429" alone sends the next
    // reader to tune a cadence when the real cause may be a daily quota that no
    // cadence change can fix. Both 2026-08-19 refusals were logged before this
    // capture existed, which is exactly why neither can be diagnosed today.
    const detail = await res.text().catch(() => "");
    return { receipt: null, error: `ntfy HTTP ${res.status}${detail ? " " + detail.slice(0, 200) : ""}` };
  }
  // Not `.catch(() => null)`: swallowing the parse would hand back a receipt
  // with no id in it, which is the bare boolean this wave exists to stop
  // dressing up as proof. If the id cannot be read, the receipt says so and
  // carries the body that was returned instead.
  let raw = "", id: string | null = null;
  try { raw = await res.text(); id = JSON.parse(raw)?.id ?? null; } catch { id = null; }
  return { receipt: `ntfy:${id ?? "unparsed<" + raw.slice(0, 60) + ">"}`, error: null };
}

async function pushDiscord(body: string): Promise<ChannelResult> {
  let url = DISCORD_ENV;
  if (!url) {
    const r = await sql("system_settings?select=value&key=eq.discord_webhook_url", { method: "GET" });
    if (r.ok) {
      let rows: { value?: string | { url?: string } }[] | null = null;
      try { rows = await r.json(); } catch { rows = null; }
      const v = rows?.[0]?.value;
      url = typeof v === "string" ? v : (v?.url ?? "");
    }
  }
  // An unresolvable fallback is an ERROR on the record, never a silent skip.
  // A channel that is quietly absent looks identical to a channel that worked.
  if (!url) return { receipt: null, error: "discord: no webhook (system_settings.discord_webhook_url empty/unreadable)" };

  // ?wait=true makes Discord return the created message instead of a bare 204,
  // so the receipt is the message's own id rather than our inference from a
  // status code.
  const res = await fetch(`${url}?wait=true`, {
    method: "POST",
    signal: AbortSignal.timeout(10000),
    headers: { "Content-Type": "application/json", "User-Agent": "apex-site-shell-watch/1.0" },
    body: JSON.stringify({
      username: "APEX site watcher",
      content:
        "**APEX site DOWN (off-laptop watcher)**\n" +
        "_Delivered here because ntfy refused the page. This is the FALLBACK channel._\n\n" +
        body.slice(0, 1600),
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return { receipt: null, error: `discord HTTP ${res.status}${detail ? " " + detail.slice(0, 200) : ""}` };
  }
  let raw = "", id: string | null = null;
  try { raw = await res.text(); id = JSON.parse(raw)?.id ?? null; } catch { id = null; }
  return { receipt: `discord:${id ?? "unparsed<" + raw.slice(0, 60) + ">"}`, error: null };
}

Deno.serve(async (req) => {
  // AUTH. Called by pg_cron with the apex_bot_token, same as jobid 22. A
  // service-role bearer is also accepted so the check harness can drive the
  // deployed function without minting a second credential.
  const auth = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  let allowed = auth.length > 0 && auth === SERVICE_KEY;
  if (!allowed && auth.length > 0) {
    const r = await sql("system_settings?key=eq.apex_bot_token&select=value", { method: "GET" });
    if (r.ok) {
      const rows = await r.json();
      const tok = rows?.[0]?.value;
      if (typeof tok === "string" && tok.length > 0 && tok === auth) allowed = true;
    }
  }
  if (!allowed) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { "Content-Type": "application/json" },
    });
  }

  const t0 = Date.now();
  let p = await probe();
  let confirmed: boolean | null = null;

  // GATE 1: CONFIRM.
  if (p.verdict === "CRIT") {
    await new Promise((r) => setTimeout(r, CONFIRM_DELAY_MS));
    const p2 = await probe();
    confirmed = p2.verdict === "CRIT";
    if (confirmed) p = p2;
  }

  const effective = p.verdict === "CRIT" && confirmed === false ? "CRIT_UNCONFIRMED" : p.verdict;

  // GATE 3 first: UNKNOWN never pages and never closes an open episode. Read the
  // carried state from the last row that actually MEASURED something - MP-303's
  // third defect was reading episode_open off a row that carried no such field,
  // so a genuinely open outage reported as none.
  const prevRes = await sql(
    "site_shell_watch?select=episode_open,episode_paged&verdict=in.(NOTE,CRIT,CRIT_UNCONFIRMED)&order=ts.desc&limit=1",
    { method: "GET" },
  );
  let episodeOpen = false, episodePaged = false;
  if (prevRes.ok) {
    const rows = await prevRes.json();
    if (rows?.[0]) {
      episodeOpen = rows[0].episode_open === true;
      episodePaged = rows[0].episode_paged === true;
    }
  }

  let paged = false, pageError: string | null = null, pagedVia: string | null = null;
  if (effective === "CRIT") {
    if (!episodeOpen) { episodeOpen = true; episodePaged = false; }
    // GATE 2: DE-STORM.
    if (!episodePaged) {
      const body =
        `apex-financial.org shell/asset floor FAILED from Supabase pg_cron (off-laptop).\n\n${p.reason}\n\n` +
        `This watcher checks the shell + asset graph ONLY. The data layer and application write path are checked by the laptop probe and are NOT covered by this page.`;

      // CHANNEL LADDER (MP-307). ntfy first and always: it is the channel
      // MP-291 measured actually landing on Sam's phone. Discord runs ONLY
      // after ntfy has exhausted its attempts, so a working fallback can never
      // quietly become the primary.
      const errs: string[] = [];
      for (let attempt = 1; attempt <= 3 && !paged; attempt++) {
        try {
          const r = await pushNtfy(body);
          if (r.receipt) { paged = true; pagedVia = r.receipt; }
          else if (r.error) errs.push(`${r.error} (attempt ${attempt}/3)`);
        } catch (e) {
          errs.push(`${String(e).slice(0, 200)} (attempt ${attempt}/3)`);
        }
        // Backoff only BETWEEN attempts, never after the last one.
        if (!paged && attempt < 3) await new Promise((r) => setTimeout(r, attempt * 2500));
      }

      if (!paged) {
        for (let attempt = 1; attempt <= 2 && !paged; attempt++) {
          try {
            const r = await pushDiscord(body);
            if (r.receipt) { paged = true; pagedVia = r.receipt; }
            else if (r.error) errs.push(`${r.error} (attempt ${attempt}/2)`);
          } catch (e) {
            errs.push(`discord: ${String(e).slice(0, 200)} (attempt ${attempt}/2)`);
          }
          if (!paged && attempt < 2) await new Promise((r) => setTimeout(r, 2000));
        }
      }

      // The ntfy failures are kept on the row EVEN WHEN Discord saved the page.
      // Dropping them on success is precisely how a dead primary channel hides:
      // delivery happened, so nothing looks wrong, and the one channel that
      // reaches a pocket is dark with no record of it. Check #28d reads these.
      pageError = errs.length ? errs.join(" | ") : null;
      // A failed push is a FAILURE, not a page. episode_paged stays false so the
      // next tick retries instead of booking an alert nobody received.
      if (paged) episodePaged = true;
    }
  } else if (effective === "NOTE") {
    episodeOpen = false; episodePaged = false;
  }
  // CRIT_UNCONFIRMED and UNKNOWN deliberately carry the previous state forward.

  const row = {
    verdict: effective,
    reason: p.reason,
    entry_hash: p.entryHash,
    assets: p.assets,
    js_count: p.jsCount,
    css_count: p.cssCount,
    elapsed_ms: Date.now() - t0,
    confirmed,
    episode_open: episodeOpen,
    episode_paged: episodePaged,
    paged,
    page_error: pageError,
    paged_via: pagedVia,
  };
  const ins = await sql("site_shell_watch", {
    method: "POST",
    body: JSON.stringify(row),
    headers: { Prefer: "return=minimal" },
  });

  return new Response(
    JSON.stringify({ ...row, logged: ins.ok, log_error: ins.ok ? null : await ins.text() }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
