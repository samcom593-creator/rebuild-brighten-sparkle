#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function loadPlaywright() {
  try {
    return require("playwright");
  } catch {
    return require("/tmp/apex-link-audit-playwright/node_modules/playwright");
  }
}

const { chromium } = loadPlaywright();

const BASE = process.env.BASE || "https://apex-financial.org";
const OUT =
  process.env.OUT ||
  `/Users/samjames/business-ops/website-integrity-bot/ledger/link-audit-${new Date().toISOString().slice(0, 10)}.jsonl`;
const ownsUserDataDir = !process.env.USER_DATA_DIR;
const USER_DATA_DIR = process.env.USER_DATA_DIR || path.join(os.tmpdir(), `apex-link-audit-chrome-${process.pid}`);
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const AUTH_TOKEN_FILE = process.env.AUTH_TOKEN_FILE || "";
const AUTH_STORAGE_KEY = process.env.AUTH_STORAGE_KEY || "sb-xrzweoneiieddzxogewk-auth-token";
// 2026-09-04 (MP-413): every lifetime run of this audit degraded to public-only
// and recorded "no logged-in auth state supplied" -- 3/3 runs over 15 days, so
// the 12 authenticated seeds and every static route in App.tsx had ZERO link
// coverage. The session-minting mechanism it needed already existed in
// ~/business-ops/scripts/apex-see-page.mjs. Minting is now in-process and ON by
// default so the audit cannot quietly become a public-page audit again.
// NO_AUTH_MINT=1 opts out (offline runs); AUTH_TOKEN_FILE still wins if supplied.
const NO_AUTH_MINT = process.env.NO_AUTH_MINT === "1";
const SUPABASE_URL = process.env.SUPABASE_URL || "https://xrzweoneiieddzxogewk.supabase.co";
const ADMIN_EMAIL = process.env.APEX_ADMIN_EMAIL || "sam.com593@gmail.com";
const CRED_DIR = process.env.APEX_CRED_DIR || path.join(os.homedir(), ".config/apex-creds");
const MAX_PAGES = Number(process.env.MAX_PAGES || 260);
// 2026-09-04 (MP-414): the audit fired 98 requests at truepeoplesearch.com in
// 10.4s (49 distinct /results?phoneno= links on /dashboard/whales, each a HEAD
// then a GET) and got Sam's office IP rate-limited on a people-search service
// his recruiters use from that same IP. It then recorded the 429/403 it had
// just caused as the host's own policy. An auditor must not be the largest
// source of the traffic it is measuring. Same-origin links are exempt: that is
// the subject of the audit, and it is Sam's own infrastructure.
const EXTERNAL_HOST_MAX = Number(process.env.EXTERNAL_HOST_MAX || 5);
const EXTERNAL_HOST_MIN_INTERVAL_MS = Number(process.env.EXTERNAL_HOST_MIN_INTERVAL_MS || 1000);
const NAV_TIMEOUT_MS = Number(process.env.NAV_TIMEOUT_MS || 30000);
const CHECK_TIMEOUT_MS = Number(process.env.CHECK_TIMEOUT_MS || 12000);
const PAGE_SETTLE_MS = Number(process.env.PAGE_SETTLE_MS || 800);

const baseUrl = new URL(BASE);
const repoRoot = path.resolve(import.meta.dirname, "..");
const seenPages = new Set();
const queued = [];
const checkedLinks = new Map();
const broken = [];
// Per external host: how many distinct URLs we have spent, when we last spoke
// to it, and how many we deliberately did not check. skipped is PUBLISHED in
// the summary -- a silent cap reads as "everything was checked" when it wasn't.
const hostSpend = new Map();
const hostLastAt = new Map();
const hostSkipped = new Map();
let authProbeFailed = false;
let verifyContext = null;
let verifyContextFailed = null;
let authSource = "none";
let authReason = "";

const publicSeeds = [
  "/",
  "/apply",
  "/seminar",
  "/get-licensed",
  "/schedule-call",
  "/join",
  "/links",
  "/leads",
  "/contact",
  "/privacy",
  "/terms",
  "/disclosures",
  "/data-deletion",
];

const authenticatedSeeds = [
  "/dashboard",
  "/dashboard/today",
  "/dashboard/command",
  "/dashboard/applicants",
  "/dashboard/crm",
  "/dashboard/call-center",
  "/dashboard/inbound-leads",
  "/dashboard/interviews",
  "/admin/email-gaps",
  "/admin/agent-duplicates",
  "/admin/recruiting-inbox",
  "/r/SJAMES01",
];
const publicSeedPaths = new Set(publicSeeds);

function recordBroken(row) {
  broken.push(row);
  fs.appendFileSync(OUT, `${JSON.stringify(row)}\n`);
}

function normalizeUrl(raw, sourceUrl) {
  if (!raw) return null;
  const value = String(raw).trim();
  if (!value || value === "#" || value.startsWith("javascript:")) return null;
  try {
    return new URL(value, sourceUrl);
  } catch {
    return null;
  }
}

function addPage(value) {
  const url = normalizeUrl(value, baseUrl.href);
  if (!url || url.origin !== baseUrl.origin) return;
  const key = url.pathname + url.search;
  if (seenPages.has(key) || queued.includes(key)) return;
  queued.push(key);
}

function readStaticRoutes() {
  const appPath = path.join(repoRoot, "src/App.tsx");
  if (!fs.existsSync(appPath)) return [];
  const source = fs.readFileSync(appPath, "utf8");
  return [...source.matchAll(/<Route\s+path="([^":*][^"]*)"/g)]
    .map((match) => match[1])
    .filter((route) => route.startsWith("/") && !route.includes(":") && !route.includes("*"));
}

function resultRow({ sourcePage, href, text, method }) {
  return {
    ts: new Date().toISOString(),
    sourcePage,
    href,
    text: (text || "").replace(/\s+/g, " ").trim().slice(0, 180),
    status: 0,
    method,
    error: null,
  };
}

// Serialise per host with a floor on the gap between requests. Only external
// hosts are throttled; same-origin is the audit's subject, not a third party.
async function hostGate(url) {
  if (url.origin === baseUrl.origin) return;
  const host = url.host;
  const last = hostLastAt.get(host) || 0;
  const wait = last + EXTERNAL_HOST_MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  hostLastAt.set(host, Date.now());
}

async function fetchWithTimeout(url, method) {
  await hostGate(url);
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), CHECK_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method,
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "user-agent": "APEX link audit/2026-06-18" },
    });
    return { response, error: null };
  } catch (err) {
    return {
      response: null,
      error: err?.name === "AbortError" ? "timeout" : String(err?.message || err),
    };
  } finally {
    clearTimeout(timeout);
  }
}

// Re-checks a URL in the REAL browser this audit already drives. Node's fetch
// is refused by WAF-fronted hosts on client fingerprint, NOT on user-agent
// string -- measured 2026-09-04 against newbridgelife.com: node fetch is 403
// with the audit UA AND with a Chrome UA, while real Chrome is 200. So a node
// 401/403/429 says nothing about whether a visitor can reach the link, and the
// audit must ask the client that actually models one before it says anything.
// The verification context is HEADED and separate from the (headless) crawl.
// MEASURED 2026-09-04 against newbridgelife.com, same Chrome binary, same host,
// one variable: headless=true -> 403, headless=false -> 200. A headless browser
// is refused by these WAFs exactly like node fetch is, so verifying in the
// crawl's own headless context would have returned "unverified" for every host
// this leg exists to adjudicate -- a verification step that cannot verify.
// Created lazily, so a run with no external refusals never opens a window, and
// reused, so the per-host budget still bounds the footprint. On a machine with
// no display the launch fails and the verdict degrades to unverified with the
// reason attached; it never silently becomes a pass or a fail.
async function getVerifyContext() {
  if (verifyContext !== null) return verifyContext;
  if (verifyContextFailed) return null;
  try {
    verifyContext = await chromium.launchPersistentContext(`${USER_DATA_DIR}-verify`, {
      executablePath: CHROME,
      headless: false,
      viewport: { width: 1280, height: 900 },
      args: ["--disable-gpu", "--no-sandbox"],
    });
    return verifyContext;
  } catch (err) {
    verifyContextFailed = String(err?.message || err).slice(0, 160);
    return null;
  }
}

async function verifyInBrowser(url) {
  const ctx = await getVerifyContext();
  if (!ctx) return { ok: null, reason: `no headed browser available (${verifyContextFailed || "unavailable"})` };
  let verifyPage = null;
  try {
    await hostGate(url);
    verifyPage = await ctx.newPage();
    const response = await verifyPage.goto(url.href, {
      waitUntil: "domcontentloaded",
      timeout: CHECK_TIMEOUT_MS,
    });
    const status = response?.status() ?? 0;
    // 401/403/429 from a REAL browser is still only "this client, from this IP,
    // was refused" -- it is not evidence about the link. Proven the hard way:
    // this fix's own first live run classified 5 truepeoplesearch links
    // external-broken on a browser 403, when the homepage had served 200
    // minutes earlier and the refusal was the rate-limit THIS AUDIT caused.
    // Shipping that would have made the audit exit non-zero forever over its
    // own network position -- the permanently-red guard, rebuilt inside its own
    // cure. A refusal is UNVERIFIED. A 404/410/5xx or a failed navigation is
    // evidence about the link itself, and still counts as broken.
    if ([401, 403, 429].includes(status)) {
      return { ok: null, status, reason: `browser was refused with ${status} (client/IP refusal, not a verdict on the link)` };
    }
    return { ok: status > 0 && status < 400, status, reason: null };
  } catch (err) {
    return { ok: null, reason: String(err?.message || err).slice(0, 200) };
  } finally {
    if (verifyPage) await verifyPage.close().catch(() => null);
  }
}

async function checkHttp(url, sourcePage, text) {
  const requestUrl = new URL(url);
  requestUrl.hash = "";
  const key = requestUrl.href;
  if (checkedLinks.has(key)) return checkedLinks.get(key);

  const isInternal = requestUrl.origin === baseUrl.origin;

  // Per-host budget. Bounds this audit's footprint on somebody else's server.
  // Recorded under its own name so a capped run cannot be read as a full one.
  if (!isInternal) {
    const spent = hostSpend.get(requestUrl.host) || 0;
    if (spent >= EXTERNAL_HOST_MAX) {
      hostSkipped.set(requestUrl.host, (hostSkipped.get(requestUrl.host) || 0) + 1);
      const skippedRow = { ...resultRow({ sourcePage, href: key, text, method: "SKIPPED" }), classification: "external-skipped" };
      checkedLinks.set(key, skippedRow);
      return skippedRow;
    }
    hostSpend.set(requestUrl.host, spent + 1);
  }

  const result = resultRow({ sourcePage, href: key, text, method: "HEAD" });
  let { response, error } = await fetchWithTimeout(requestUrl, "HEAD");

  if (error || !response || [400, 403, 405, 429].includes(response.status)) {
    result.method = "GET";
    ({ response, error } = await fetchWithTimeout(requestUrl, "GET"));
  }
  if (error) {
    ({ response, error } = await fetchWithTimeout(requestUrl, "GET"));
  }

  if (response) result.status = response.status;
  if (error) result.error = error;

  if (result.error || result.status >= 400 || result.status === 0) {
    if (isInternal) {
      result.classification = "internal-broken";
    } else {
      // MP-413 bucketed every external 401/403/429 as "external-blocked" and
      // asserted the host was refusing automation. FALSIFIED 2026-09-04: both
      // hosts it named on that evidence serve 200 to a real browser, and the
      // 49-link truepeoplesearch burst had rate-limited this IP itself. The
      // bucket was unfalsifiable -- a genuinely dead third-party link produced
      // the identical row and the identical excuse, so a real break could never
      // surface. The browser is now the authority, and when it cannot answer
      // the verdict is UNVERIFIED rather than a claim about the host.
      const verdict = await verifyInBrowser(requestUrl);
      result.browserStatus = verdict.status ?? null;
      if (verdict.ok === true) {
        result.classification = "external-ok-in-browser";
      } else if (verdict.ok === false) {
        result.classification = "external-broken";
      } else {
        result.classification = "external-unverified";
        result.browserReason = verdict.reason;
      }
    }
    recordBroken(result);
  }

  checkedLinks.set(key, result);
  return result;
}

function readCred(name) {
  const file = path.join(CRED_DIR, name);
  if (!fs.existsSync(file)) return "";
  return fs.readFileSync(file, "utf8").trim();
}

// Mints a real admin session the same way apex-see-page.mjs does (proven path).
// gotrue stopped honoring email_otp verify for admin-generated magiclinks on
// 2026-08-22 (403 otp_expired even when fresh); token_hash verify still works,
// so token_hash is tried first and email_otp is only the fallback.
async function mintAdminSession() {
  const serviceKey = readCred("supabase-service.key");
  const anonKey = readCred("supabase.anon");
  if (!serviceKey || !anonKey) return { session: null, reason: "supabase service/anon key not present on this machine" };
  try {
    const gen = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
      method: "POST",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "magiclink", email: ADMIN_EMAIL }),
    }).then((r) => r.json());
    const hashed = gen.hashed_token || gen.properties?.hashed_token;
    const otp = gen.email_otp || gen.properties?.email_otp;
    let sess = hashed
      ? await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
          method: "POST",
          headers: { apikey: anonKey, "Content-Type": "application/json" },
          body: JSON.stringify({ type: "magiclink", token_hash: hashed }),
        }).then((r) => r.json())
      : {};
    if (!sess.access_token && otp) {
      sess = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
        method: "POST",
        headers: { apikey: anonKey, "Content-Type": "application/json" },
        body: JSON.stringify({ type: "magiclink", email: ADMIN_EMAIL, token: otp }),
      }).then((r) => r.json());
    }
    if (!sess.access_token) return { session: null, reason: `session mint returned no access_token: ${JSON.stringify(sess).slice(0, 160)}` };
    return {
      session: {
        access_token: sess.access_token,
        refresh_token: sess.refresh_token,
        expires_at: sess.expires_at,
        expires_in: sess.expires_in,
        token_type: "bearer",
        user: sess.user,
      },
      reason: null,
    };
  } catch (err) {
    return { session: null, reason: `session mint threw: ${String(err?.message || err).slice(0, 160)}` };
  }
}

async function installAuth(context) {
  let authValue = "";
  if (AUTH_TOKEN_FILE && fs.existsSync(AUTH_TOKEN_FILE)) {
    authValue = fs.readFileSync(AUTH_TOKEN_FILE, "utf8").trim();
    if (authValue) authSource = "AUTH_TOKEN_FILE";
  }
  if (!authValue && !NO_AUTH_MINT) {
    const { session, reason } = await mintAdminSession();
    if (session) {
      authValue = JSON.stringify(session);
      authSource = `minted:${session.user?.email || ADMIN_EMAIL}`;
    } else {
      authReason = reason;
    }
  }
  if (!authValue) {
    if (!authReason) authReason = NO_AUTH_MINT ? "NO_AUTH_MINT=1 and no AUTH_TOKEN_FILE supplied" : "no auth token available";
    return false;
  }
  await context.addInitScript(
    ({ origin, key, value }) => {
      if (location.origin === origin) localStorage.setItem(key, value);
    },
    { origin: baseUrl.origin, key: AUTH_STORAGE_KEY, value: authValue },
  );
  return true;
}

async function probeAuth(page, authInstalled) {
  const authProbe = new URL("/dashboard/today", baseUrl);
  if (!authInstalled) {
    authProbeFailed = true;
    recordBroken({
      ...resultRow({
        sourcePage: authProbe.href,
        href: authProbe.href,
        text: "auth probe",
        method: "BROWSER",
      }),
      error: `no logged-in auth state supplied; authenticated routes were not crawled (${authReason || "reason not recorded"})`,
    });
    return;
  }
  await page.goto(authProbe.href, { waitUntil: "domcontentloaded" }).catch(() => null);
  await page.waitForTimeout(2500);
  const probeUrl = page.url();
  const probeText = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
  authProbeFailed =
    /\/login\b/.test(probeUrl) || /sign in|login|continue with/i.test(probeText.slice(0, 1200));
  if (authProbeFailed) {
    recordBroken({
      ...resultRow({
        sourcePage: authProbe.href,
        href: authProbe.href,
        text: "auth probe",
        method: "BROWSER",
      }),
      error: AUTH_TOKEN_FILE ? "auth token did not produce a logged-in admin session" : "no logged-in auth state supplied",
    });
  }
}

async function collectAnchors(page) {
  return page.$$eval("a[href]", (nodes) =>
    nodes.map((anchor) => ({
      href: anchor.getAttribute("href") || "",
      text: anchor.textContent || anchor.getAttribute("aria-label") || anchor.getAttribute("title") || "",
    })),
  );
}

async function main() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, "");

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    executablePath: CHROME,
    headless: true,
    viewport: { width: 1440, height: 1100 },
    args: ["--profile-directory=Default", "--disable-gpu", "--no-sandbox"],
  });

  // NOT `verifyContext = context`: the crawl context is headless, and a headless
  // browser is refused by these WAFs exactly like node fetch is (measured: same
  // host, headless 403 / headed 200). Assigning it here made getVerifyContext()
  // short-circuit on its first line, so the headed verifier was dead code and
  // every external refusal came back "unverified" while the code read as fixed.
  const authInstalled = await installAuth(context);
  // SEEDS=/a,/b restricts the crawl to named routes. Lets a fix be re-proven
  // against the one page that failed without re-crawling 260 and without
  // re-burdening every third party the full run touches.
  const seedOverride = (process.env.SEEDS || "").split(",").map((v) => v.trim()).filter(Boolean);
  for (const seed of seedOverride.length
    ? seedOverride
    : authInstalled
      ? [...publicSeeds, ...authenticatedSeeds, ...readStaticRoutes()]
      : publicSeeds) addPage(seed);
  context.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
  context.setDefaultTimeout(10000);

  const page = await context.newPage();
  await probeAuth(page, authInstalled);

  while (queued.length && seenPages.size < MAX_PAGES) {
    const route = queued.shift();
    if (!route || seenPages.has(route)) continue;
    seenPages.add(route);
    const pageUrl = new URL(route, baseUrl);

    let anchors = [];
    try {
      await page.goto(pageUrl.href, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(PAGE_SETTLE_MS);
      anchors = await collectAnchors(page);
    } catch (err) {
      recordBroken({
        ...resultRow({
          sourcePage: pageUrl.href,
          href: pageUrl.href,
          text: "page navigation",
          method: "BROWSER",
        }),
        error: String(err?.message || err).slice(0, 300),
      });
      continue;
    }

    for (const anchor of anchors) {
      const url = normalizeUrl(anchor.href, pageUrl.href);
      if (!url || !["http:", "https:"].includes(url.protocol)) continue;
      await checkHttp(url, pageUrl.href, anchor.text);
      if (url.origin === baseUrl.origin && (authInstalled || publicSeedPaths.has(url.pathname))) addPage(url.href);
    }

    if (seenPages.size % 20 === 0) {
      console.log(
        `progress pages=${seenPages.size} queued=${queued.length} links=${checkedLinks.size} broken=${broken.length}`,
      );
    }
  }

  await context.close();
  if (verifyContext) await verifyContext.close().catch(() => null);
  if (ownsUserDataDir) {
    fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
    fs.rmSync(`${USER_DATA_DIR}-verify`, { recursive: true, force: true });
  }
  // What fails the run: the site's own broken links, plus third-party links a
  // REAL BROWSER could not load. external-unverified never fails the run (the
  // audit could not reach a verdict, and an unknown must not masquerade as
  // either answer) and it is never silent either -- it is counted below.
  const hardBroken = broken.filter(
    (row) =>
      !(row.method === "BROWSER" && row.text === "auth probe") &&
      (row.classification === "internal-broken" || row.classification === "external-broken"),
  );
  const externalOkInBrowser = broken.filter((row) => row.classification === "external-ok-in-browser");
  const externalUnverified = broken.filter((row) => row.classification === "external-unverified");
  const externalSkipped = [...hostSkipped.values()].reduce((sum, n) => sum + n, 0);

  // The OUT file used to contain broken rows and nothing else, so an empty file
  // meant either "crawled everything, all links fine" or "crawled nothing at
  // all" -- indistinguishable, and the second reads as health. This row is
  // written on every run, clean or not, so coverage is always on the record.
  const summary = {
    ts: new Date().toISOString(),
    type: "summary",
    base: BASE,
    pagesVisited: seenPages.size,
    linksChecked: checkedLinks.size,
    broken: broken.length,
    hardBroken: hardBroken.length,
    // A node-fetch failure that a real browser then loaded fine. These are the
    // rows MP-413 called "external-blocked" and excused; they are the audit's
    // own client being refused, not the site's problem and not the host's policy.
    externalOkInBrowser: externalOkInBrowser.length,
    externalUnverified: externalUnverified.length,
    // Never checked at all, because this run had already spent its budget at
    // that host. Published so a capped run is not read as a complete one.
    externalSkipped,
    externalHostMax: EXTERNAL_HOST_MAX,
    externalHostsThrottled: [...hostSkipped.entries()].map(([host, n]) => `${host}:${n}`).sort(),
    // A crawl that stopped at MAX_PAGES did NOT cover the site. Recorded so a
    // clean result is never read as "the whole surface is clean".
    maxPages: MAX_PAGES,
    capReached: seenPages.size >= MAX_PAGES,
    pagesQueuedAtStop: queued.length,
    authenticated: !authProbeFailed,
    authSource,
    authReason: authReason || null,
    seedScope: authProbeFailed ? "public-only" : "public+authenticated",
  };
  fs.appendFileSync(OUT, `${JSON.stringify(summary)}\n`);

  console.log(
    JSON.stringify(
      { out: OUT, ...summary },
      null,
      2,
    ),
  );
  if (hardBroken.length > 0) process.exitCode = 2;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
