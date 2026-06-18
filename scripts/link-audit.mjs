#!/usr/bin/env node
import fs from "node:fs";
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
const USER_DATA_DIR = process.env.USER_DATA_DIR || "/tmp/apex-link-audit-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const AUTH_TOKEN_FILE = process.env.AUTH_TOKEN_FILE || "";
const AUTH_STORAGE_KEY = process.env.AUTH_STORAGE_KEY || "sb-xrzweoneiieddzxogewk-auth-token";
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

const staticSeeds = [
  "/",
  "/apply",
  "/seminar",
  "/get-licensed",
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
  "/r/KJV01",
];

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
  const key = url.href;
  if (checkedLinks.has(key)) return checkedLinks.get(key);

  const result = resultRow({ sourcePage, href: key, text, method: "HEAD" });
  let { response, error } = await fetchWithTimeout(url, "HEAD");

  if (error || !response || [400, 403, 405, 429].includes(response.status)) {
    result.method = "GET";
    ({ response, error } = await fetchWithTimeout(url, "GET"));
  }

  if (response) result.status = response.status;
  if (error) result.error = error;

  if (result.error || result.status >= 400 || result.status === 0) {
    recordBroken(result);
  }

  checkedLinks.set(key, result);
  return result;
}

async function installAuth(context) {
  if (!AUTH_TOKEN_FILE || !fs.existsSync(AUTH_TOKEN_FILE)) return false;
  const authValue = fs.readFileSync(AUTH_TOKEN_FILE, "utf8").trim();
  if (!authValue) return false;
  await context.addInitScript(
    ({ origin, key, value }) => {
      if (location.origin === origin) localStorage.setItem(key, value);
    },
    { origin: baseUrl.origin, key: AUTH_STORAGE_KEY, value: authValue },
  );
  return true;
}

async function probeAuth(page) {
  const authProbe = new URL("/dashboard/today", baseUrl);
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

  for (const seed of [...staticSeeds, ...readStaticRoutes()]) addPage(seed);

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    executablePath: CHROME,
    headless: true,
    viewport: { width: 1440, height: 1100 },
    args: ["--profile-directory=Default", "--disable-gpu", "--no-sandbox"],
  });

  await installAuth(context);
  context.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
  context.setDefaultTimeout(10000);

  const page = await context.newPage();
  await probeAuth(page);

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
      if (url.origin === baseUrl.origin) addPage(url.href);
    }

    if (seenPages.size % 20 === 0) {
      console.log(
        `progress pages=${seenPages.size} queued=${queued.length} links=${checkedLinks.size} broken=${broken.length}`,
      );
    }
  }

  await context.close();
  const hardBroken = broken.filter((row) => !(row.method === "BROWSER" && row.text === "auth probe"));
  console.log(
    JSON.stringify(
      {
        out: OUT,
        pagesVisited: seenPages.size,
        linksChecked: checkedLinks.size,
        broken: broken.length,
        hardBroken: hardBroken.length,
        authProbeFailed,
      },
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
