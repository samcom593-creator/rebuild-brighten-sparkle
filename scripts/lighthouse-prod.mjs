#!/usr/bin/env node
/**
 * lighthouse-prod — pull a mobile Lighthouse audit of apex-financial.org
 * and assert minimum scores. Fails (exit 1) when any category drops below
 * the budget below — wire into CI to lock in the gains.
 *
 * Usage:
 *   node scripts/lighthouse-prod.mjs                  # default budgets
 *   PERF_MIN=85 LCP_MAX=3000 node scripts/lighthouse-prod.mjs
 *
 * Requires Node 18+ (no extra install — uses npx --yes lighthouse).
 */
import { execSync } from "node:child_process";
import { readFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const URL_ = process.env.URL || "https://apex-financial.org/";

// Budgets (override with env vars). Tightened 2026-05-18 round 3 baseline:
//   Perf 68 / A11y 89 / BP 96 / SEO 100 / FCP 3.8s / LCP 5.7s / CLS 0
// Budget sits 5pp below measured so noise doesn't false-alarm, but any
// real regression breaks the build.
const BUDGETS = {
  performance:    Number(process.env.PERF_MIN ?? 63),
  accessibility:  Number(process.env.A11Y_MIN ?? 85),
  "best-practices": Number(process.env.BP_MIN ?? 90),
  seo:            Number(process.env.SEO_MIN ?? 95),
  lcpMs:          Number(process.env.LCP_MAX ?? 6500),
  fcpMs:          Number(process.env.FCP_MAX ?? 4500),
  cls:            Number(process.env.CLS_MAX ?? 0.05),
};

const work = join(tmpdir(), `apex-lh-${Date.now()}`);
mkdirSync(work, { recursive: true });
const json = join(work, "audit.json");

console.log(`▸ Running Lighthouse mobile against ${URL_}…`);
try {
  execSync(
    `npx --yes lighthouse ${URL_} --quiet --chrome-flags="--headless=new --no-sandbox" --form-factor=mobile --throttling-method=simulate --output=json --output-path=${json} --only-categories=performance,accessibility,best-practices,seo`,
    { stdio: "inherit" }
  );
} catch (e) {
  console.error("Lighthouse failed to run.");
  process.exit(2);
}

const data = JSON.parse(readFileSync(json, "utf-8"));
const c = data.categories || {};
const a = data.audits || {};

const score = (k) => Math.round(((c[k]?.score) ?? 0) * 100);
const ms = (k) => a[k]?.numericValue ?? null;

const result = {
  performance:    score("performance"),
  accessibility:  score("accessibility"),
  "best-practices": score("best-practices"),
  seo:            score("seo"),
  fcp:            ms("first-contentful-paint"),
  lcp:            ms("largest-contentful-paint"),
  cls:            a["cumulative-layout-shift"]?.numericValue ?? null,
  tbt:            ms("total-blocking-time"),
  tti:            ms("interactive"),
};

console.log();
console.log("=== LIGHTHOUSE MOBILE RESULT ===");
for (const [k, v] of Object.entries(result)) {
  console.log(`  ${k.padEnd(16)}  ${v}${typeof v === "number" && k !== "cls" && !["performance","accessibility","best-practices","seo"].includes(k) ? "ms" : ""}`);
}
console.log();

const fails = [];
if (result.performance    < BUDGETS.performance)    fails.push(`Perf ${result.performance} < ${BUDGETS.performance}`);
if (result.accessibility  < BUDGETS.accessibility)  fails.push(`A11y ${result.accessibility} < ${BUDGETS.accessibility}`);
if (result["best-practices"] < BUDGETS["best-practices"]) fails.push(`BP ${result["best-practices"]} < ${BUDGETS["best-practices"]}`);
if (result.seo            < BUDGETS.seo)            fails.push(`SEO ${result.seo} < ${BUDGETS.seo}`);
if (result.lcp != null && result.lcp > BUDGETS.lcpMs) fails.push(`LCP ${Math.round(result.lcp)}ms > ${BUDGETS.lcpMs}ms`);
if (result.fcp != null && result.fcp > BUDGETS.fcpMs) fails.push(`FCP ${Math.round(result.fcp)}ms > ${BUDGETS.fcpMs}ms`);
if (result.cls != null && result.cls > BUDGETS.cls)   fails.push(`CLS ${result.cls.toFixed(3)} > ${BUDGETS.cls}`);

try { rmSync(work, { recursive: true, force: true }); } catch {}

if (fails.length) {
  console.error("❌ Lighthouse budget BUSTED:");
  fails.forEach((f) => console.error("  • " + f));
  process.exit(1);
}
console.log("✅ Lighthouse budgets passed.");
