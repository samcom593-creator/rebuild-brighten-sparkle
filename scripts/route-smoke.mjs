#!/usr/bin/env node
// route-smoke.mjs — CI smoke test of critical public routes.
//
// Catches the bug class from 2026-04-29:
//   - /agent-signup defined in code but missing from App.tsx → SPA renders
//     the "404 NOT FOUND" inner component while the HTTP returns 200.
//   - /leads /get-leads /dialer crash (React error #306, missing default export)
//     and ErrorBoundary fallback shows a generic apology screen.
//
// Pure fetch — no Playwright dep. It verifies each route is registered in the
// local React Router source, then pulls the deployed route and looks for:
//   - non-2xx HTTP
//   - "404 · NOT FOUND" / "Page not found" markers when present in HTML
//   - ErrorBoundary fallback markers when present in HTML
//
// The source check is essential: Vercel's SPA rewrite serves index.html with a
// 200 for unknown paths, so HTTP status alone cannot prove a route exists.
//
// Usage:
//   BASE=https://apex-financial.org node scripts/route-smoke.mjs
//   BASE=http://localhost:8080      node scripts/route-smoke.mjs
//
// Exit non-zero on any failure so CI / post-build gates can block.

import fs from "node:fs";

const BASE = process.env.BASE || "https://apex-financial.org";
const appSource = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const registeredRoutes = new Set(
  [...appSource.matchAll(/<Route\s+path=["']([^"']+)["']/g)].map((match) => match[1]),
);

const PUBLIC_ROUTES = [
  "/", "/apply", "/get-licensed", "/start-contracting", "/unlicensed-overview",
  "/resources/licensing", "/training", "/login", "/reset-password", "/signup",
  "/agent-signup", "/agent-login", "/magic-login",
  "/schedule-call", "/join", "/links", "/seminar",
  "/leads", "/get-leads", "/dialer", "/install",
  "/contact", "/privacy", "/privacy-policy", "/terms", "/terms-of-service", "/disclosures",
  "/data-deletion", "/delete-my-data", "/hall-of-fame",
  "/storefront", "/storefront?paid=1",
  "/apply/success", "/apply/success/licensed", "/apply/success/unlicensed",
  "/pending-approval", "/apex-daily-numbers",
];

// SPA shells return 200 even on missing routes. The render-side 404
// component for this app uses a distinctive header. Match conservatively
// so a copy-paste rewrite doesn't accidentally pass.
const VISUAL_404_RE = /404\s*[·\-•]\s*NOT FOUND|Page not found|That path doesn[''']t exist/i;
const ERROR_BOUNDARY_RE = /Something went wrong\s*<.*Try again|We hit a snag/i;

let failed = 0;
const results = [];

for (const path of PUBLIC_ROUTES) {
  const url = BASE + path;
  const routePath = path.split("?")[0];
  const registered = registeredRoutes.has(routePath);
  let httpStatus = 0;
  let bodyPreview = "";
  let netError = null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    const r = await fetch(url, { redirect: "manual", signal: ctrl.signal });
    clearTimeout(t);
    httpStatus = r.status;
    if (httpStatus < 300) {
      const txt = await r.text();
      bodyPreview = txt.slice(0, 8000);
    }
  } catch (e) {
    netError = e.message?.slice(0, 80) || String(e).slice(0, 80);
  }

  const visual404 = VISUAL_404_RE.test(bodyPreview);
  const errBoundary = ERROR_BOUNDARY_RE.test(bodyPreview);
  // /storefront is fine — it has its own "Payment received" copy that doesn't trip 404 regex
  const ok = registered && !netError && httpStatus >= 200 && httpStatus < 400 && !visual404 && !errBoundary;

  if (!ok) failed++;

  let note = "";
  if (!registered) note = "route not registered in src/App.tsx";
  else if (netError) note = `net: ${netError}`;
  else if (httpStatus >= 400) note = `HTTP ${httpStatus}`;
  else if (visual404) note = "visual 404 in body (route not registered in App.tsx)";
  else if (errBoundary) note = "ErrorBoundary fallback (runtime crash)";
  results.push({ path, httpStatus, ok, note });
}

console.log("\nROUTE SMOKE — " + BASE);
console.log("PATH                                       HTTP   STATUS   NOTES");
for (const r of results) {
  const flag = r.ok ? "✓ OK    " : "✗ FAIL  ";
  console.log(`${(r.path).padEnd(43)}${String(r.httpStatus).padEnd(7)}${flag} ${r.note}`);
}
console.log(failed === 0
  ? `\n✓ all ${results.length} routes healthy`
  : `\n✗ ${failed}/${results.length} routes failed`);

process.exit(failed === 0 ? 0 : 1);
