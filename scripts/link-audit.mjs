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
const NAV_TIMEOUT_MS = Number(process.env.NAV_TIMEOUT_MS || 30000);
const CHECK_TIMEOUT_MS = Number(process.env.CHECK_TIMEOUT_MS || 12000);
const PAGE_SETTLE_MS = Number(process.env.PAGE_SETTLE_MS || 800);

const baseUrl = new URL(BASE);
const repoRoot = path.resolve(import.meta.dirname, "..");
const seenPages = new Set();
const queued = [];
const checkedLinks = new Map();
const broken = [];
let authProbeFailed = false;
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

async function fetchWithTimeout(url, method) {
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

async function checkHttp(url, sourcePage, text) {
  const requestUrl = new URL(url);
  requestUrl.hash = "";
  const key = requestUrl.href;
  if (checkedLinks.has(key)) return checkedLinks.get(key);

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
    // Three-valued, not pass/fail. The first authenticated crawl (2026-09-04)
    // returned 50 "broken" links: 49 truepeoplesearch.com + 1 newbridgelife.com,
    // every one a 403 to an automated request from two third-party hosts that
    // bot-block. Both 403 to a real browser user-agent too, so this is their
    // edge refusing automation, not a dead link a visitor would hit. Counting
    // them as breakage makes the audit exit non-zero on a healthy site forever,
    // and a signal that is always red is one nobody reads. They are recorded
    // and counted under their own name instead of being laundered into either
    // verdict — an internal 403 is still hard breakage.
    const isInternal = requestUrl.origin === baseUrl.origin;
    result.classification = isInternal
      ? "internal-broken"
      : [401, 403, 429].includes(result.status)
        ? "external-blocked"
        : "external-broken";
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

  const authInstalled = await installAuth(context);
  for (const seed of authInstalled
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
  if (ownsUserDataDir) fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
  const hardBroken = broken.filter(
    (row) => !(row.method === "BROWSER" && row.text === "auth probe") && row.classification !== "external-blocked",
  );
  const externalBlocked = broken.filter((row) => row.classification === "external-blocked");

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
    externalBlocked: externalBlocked.length,
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
