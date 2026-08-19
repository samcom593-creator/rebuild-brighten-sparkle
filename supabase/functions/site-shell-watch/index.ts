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

const BASE = Deno.env.get("SHELL_WATCH_BASE") ?? "https://apex-financial.org";
const CONTROL = Deno.env.get("SHELL_WATCH_CONTROL") ?? "https://vercel.com";
const NTFY = Deno.env.get("SHELL_WATCH_NTFY") ??
  "https://ntfy.sh/sams-agent-yrkv9kbqp9e987nb";
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

  let paged = false, pageError: string | null = null;
  if (effective === "CRIT") {
    if (!episodeOpen) { episodeOpen = true; episodePaged = false; }
    // GATE 2: DE-STORM.
    if (!episodePaged) {
      // MP-306: RETRY LADDER. On the first genuine production outage
      // (2026-08-19 13:30 + 13:40Z) BOTH autonomous fires were refused by ntfy
      // with HTTP 429 and the page did not leave the building. The
      // retry-on-next-tick design was honest but cost 10 minutes per refusal,
      // and the site was dark for 20 of them with this watcher mute. Same fix
      // as the 2026-07-19 bot_sql hardening that killed this class for 22
      // inline curls: retry in-process with backoff before giving up.
      //
      // This REDUCES the mute window. It does not close it, and must never be
      // described as if it did -- a bucket that is empty stays empty for
      // seconds, and ntfy.sh's per-visitor limit is shared with every other
      // tenant on Supabase's egress, so a refusal can outlast the ladder. The
      // next-tick retry is still the backstop; page_error is still the receipt.
      for (let attempt = 1; attempt <= 3 && !paged; attempt++) {
        try {
          const res = await fetch(NTFY, {
            method: "POST",
            signal: AbortSignal.timeout(10000),
            headers: {
              // ASCII ONLY - see MP-274 in the header.
              Title: "APEX site DOWN (off-laptop watcher)",
              Priority: "5",
              Tags: "rotating_light",
            },
            body:
              `apex-financial.org shell/asset floor FAILED from Supabase pg_cron (off-laptop).\n\n${p.reason}\n\n` +
              `This watcher checks the shell + asset graph ONLY. The data layer and application write path are checked by the laptop probe and are NOT covered by this page.`,
          });
          paged = res.ok;
          if (!res.ok) {
            // Record the BODY, not just the status. ntfy answers a refusal with
            // a JSON `code` naming WHICH limit was hit; "ntfy HTTP 429" alone
            // sends the next reader to tune a cadence when the real cause may
            // be a daily quota that no cadence change can fix. A verdict that
            // is right for a reason it misstates is the MP-304 lesson.
            const detail = await res.text().catch(() => "");
            pageError = `ntfy HTTP ${res.status} (attempt ${attempt}/3)` +
              (detail ? ` ${detail.slice(0, 200)}` : "");
          }
        } catch (e) {
          pageError = `${String(e).slice(0, 200)} (attempt ${attempt}/3)`;
        }
        // Backoff only BETWEEN attempts, never after the last one.
        if (!paged && attempt < 3) {
          await new Promise((r) => setTimeout(r, attempt * 2500));
        }
      }
      // A failed push is a FAILURE, not a page. episode_paged stays false so the
      // next tick retries instead of booking an alert nobody received.
      if (paged) { episodePaged = true; pageError = null; }
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
