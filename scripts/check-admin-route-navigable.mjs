#!/usr/bin/env node
/**
 * check-admin-route-navigable — owner-critical admin routes must be reachable
 * from the persistent navigation, not only by typing a URL.
 *
 * WHY THIS EXISTS (MP-WIB-ADMIN-NAV-ORPHANS, 2026-11-21). A Check #3 IA audit
 * found two live `requireAdmin` routes with ZERO path in the desktop sidebar or
 * the Cmd+K command palette:
 *   - /admin/agent-duplicates (App.tsx) — the identity-merge surface that
 *     apex-doctor Check #14 mails Sam the URL for every week; the dedupe task
 *     was driven by that email precisely because nothing in the app linked it.
 *   - /dashboard/strikes (App.tsx) — the agent-conduct surface Sam named a
 *     primary admin goal; reachable only via a conditional WelcomeToast CTA and
 *     the /dashboard/conduct redirect. Effectively URL-only.
 * A live route with no menu entry is a Check #3 "goal > 2 clicks" leak in its
 * terminal form — not two clicks, but infinitely many, because there is no
 * click path at all. The admin cannot discover a surface they are supposed to
 * use daily.
 *
 * WHY EVERY EXISTING GUARD IS BLIND TO IT.
 *   - check:sidebar-routes proves the REVERSE direction — every sidebar href
 *     resolves to a real <Route> so no click lands on NotFound. It is
 *     structurally incapable of noticing a route that NO href points at.
 *   - check:orphan-pages proves a page component is imported SOMEWHERE. A page
 *     rendered only by its <Route> is "imported" and still invisible in the menu.
 *   - the live-render / brand-static probes fetch public URLs; these are
 *     authenticated admin routes behind ProtectedRoute, never probed.
 * So "an owner-critical admin route is orphaned from all navigation" was a
 * genuinely unguarded invariant.
 *
 * WHAT IT ASSERTS (static, no browser, no network — gates in verify:core).
 * For each route in MUST_BE_NAVIGABLE:
 *   1. it MUST still be declared in App.tsx as a <Route path="...">. A pinned
 *      route that no longer exists is a STALE LIST entry — exit 1, actionable:
 *      remove it from this file. It is NEVER left red forever against a route
 *      nobody can act on (the route-shape lesson, MP-417: a guard red for a
 *      reason nobody can action is a guard everybody learns to skip).
 *   2. it MUST appear as an `href`/`to` for that exact path in the nav sources
 *      (agentCloudNavigation.ts or GlobalSidebar.tsx — the same two files
 *      check:sidebar-routes reads). A route present in App.tsx but absent from
 *      the nav is the ORPHAN defect — exit 1, actionable: add the nav item.
 *
 * COMMENTS ARE STRIPPED from every source (shared lib/strip-comments.mjs)
 * before matching, so a route NAMED in prose — including this guard's own
 * rationale and the MP comment that sits beside the two nav items it pins —
 * never counts as a <Route> declaration or as a live link (the MP-277
 * footnote-bug class: a guard that scans raw source matches its own comments).
 *
 * `--selftest` proves the pure verdict both directions with no fs.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "./lib/strip-comments.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The curated set of owner-critical admin surfaces that MUST have a persistent
// nav path. Add a route here to declare it owner-critical; this is the only way
// the orphan check grows. Keep it small and real — every entry must be a route
// that actually exists in App.tsx (direction 1 enforces that, so a rot shows up
// as a STALE finding you can act on, not a silent pass).
export const MUST_BE_NAVIGABLE = [
  {
    route: "/admin/agent-duplicates",
    why: "identity-merge surface apex-doctor Check #14 mails Sam weekly; dedupe is a recurring owner data-integrity task",
  },
  {
    route: "/dashboard/strikes",
    why: "agent-conduct surface Sam named a primary admin goal",
  },
];

const APP_TSX = "src/App.tsx";
const NAV_SOURCES = [
  "src/components/layout/agentCloudNavigation.ts",
  "src/components/layout/GlobalSidebar.tsx",
];

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A route is DECLARED when App.tsx has <Route path="<route>" ...>. Exact path,
// quote-agnostic. Comments must already be stripped by the caller.
export function routeDeclared(appStripped, route) {
  const re = new RegExp(`path\\s*=\\s*["'\`]${escapeRe(route)}["'\`]`);
  return re.test(appStripped);
}

// A route is LINKED when the nav source carries an href/to for that exact path,
// with or without a trailing ?query (nav items deep-link e.g. ...?tab=desk).
// Comments must already be stripped by the caller.
export function routeLinked(navStripped, route) {
  const re = new RegExp(
    `(?:href|to)\\s*[:=]\\s*["'\`]${escapeRe(route)}(?:\\?[^"'\`]*)?["'\`]`,
  );
  return re.test(navStripped);
}

// Pure verdict. appStripped / navStripped are comment-stripped sources.
// Returns { orphans, stale } — orphans are declared-but-unlinked (add nav item),
// stale are pinned-but-undeclared (remove from the list).
export function evaluate(appStripped, navStripped, mustList) {
  const orphans = [];
  const stale = [];
  for (const entry of mustList) {
    const declared = routeDeclared(appStripped, entry.route);
    if (!declared) {
      stale.push(entry);
      continue;
    }
    if (!routeLinked(navStripped, entry.route)) orphans.push(entry);
  }
  return { orphans, stale };
}

function selftest() {
  let pass = 0;
  let total = 0;
  const ok = (cond, label) => {
    total++;
    if (cond) pass++;
    else console.error(`  ✗ ${label}`);
  };

  const list = [{ route: "/admin/agent-duplicates", why: "x" }, { route: "/dashboard/strikes", why: "y" }];

  // Direction 0 — clean: both declared, both linked.
  const appOK = `<Route path="/admin/agent-duplicates" element={<X/>} /> <Route path="/dashboard/strikes" element={<Y/>} />`;
  const navOK = `{ href: "/admin/agent-duplicates" }, { href: "/dashboard/strikes" }`;
  let r = evaluate(appOK, navOK, list);
  ok(r.orphans.length === 0 && r.stale.length === 0, "clean tree: no orphans, no stale");

  // Direction 1 — ORPHAN: declared in App, missing from nav.
  const navMissingOne = `{ href: "/admin/agent-duplicates" }`; // strikes absent
  r = evaluate(appOK, navMissingOne, list);
  ok(r.orphans.length === 1 && r.orphans[0].route === "/dashboard/strikes", "orphan detected when a declared route has no nav href");
  ok(r.stale.length === 0, "orphan case does not also flag stale");

  // Direction 2 — STALE: pinned route no longer in App.tsx.
  const appMissingOne = `<Route path="/admin/agent-duplicates" element={<X/>} />`; // strikes route removed
  r = evaluate(appMissingOne, navOK, list);
  ok(r.stale.length === 1 && r.stale[0].route === "/dashboard/strikes", "stale detected when a pinned route is gone from App.tsx");
  ok(r.orphans.length === 0, "stale route is not double-counted as an orphan");

  // Footnote-bug robustness — a route named ONLY in a comment must not count as
  // declared or linked. Prove it end-to-end through the real stripComments.
  const appCommentOnly = stripComments(`// <Route path="/dashboard/strikes"> was retired\n<Route path="/admin/agent-duplicates" element={<X/>} />`);
  const navCommentOnly = stripComments(`// href: "/dashboard/strikes" used to live here\n{ href: "/admin/agent-duplicates" }`);
  r = evaluate(appCommentOnly, navCommentOnly, list);
  ok(r.stale.some((e) => e.route === "/dashboard/strikes"), "a route named only in an App.tsx comment is NOT declared");
  const r2 = evaluate(appOK, navCommentOnly, list);
  ok(r2.orphans.some((e) => e.route === "/dashboard/strikes"), "a route named only in a nav comment is NOT linked");

  // Query-suffix tolerance — a deep-linked href still counts as a live link.
  const navQuery = `{ href: "/admin/agent-duplicates" }, { href: "/dashboard/strikes?tab=open" }`;
  r = evaluate(appOK, navQuery, list);
  ok(r.orphans.length === 0, "an href with a ?query suffix still counts as navigable");

  console.log(`\ncheck:admin-route-navigable --selftest — ${pass}/${total} assertions pass (both directions).`);
  if (pass !== total) {
    console.error("SELFTEST FAILED — the admin-route-navigable verdict is wrong.");
    process.exit(1);
  }
  process.exit(0);
}

if (process.argv.includes("--selftest")) selftest();

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  let appStripped;
  let navStripped;
  try {
    appStripped = stripComments(fs.readFileSync(path.join(repoRoot, APP_TSX), "utf8"));
    navStripped = NAV_SOURCES.map((f) => stripComments(fs.readFileSync(path.join(repoRoot, f), "utf8"))).join("\n");
  } catch (e) {
    console.error(`check:admin-route-navigable — COULD NOT READ a source file: ${e.message}`);
    process.exit(2);
  }

  const { orphans, stale } = evaluate(appStripped, navStripped, MUST_BE_NAVIGABLE);

  if (stale.length) {
    console.error("check:admin-route-navigable — STALE LIST: a pinned route no longer exists in App.tsx:");
    for (const e of stale) console.error(`  🟡 ${e.route} — remove it from MUST_BE_NAVIGABLE in this guard (the route was retired).`);
    process.exit(1);
  }

  if (orphans.length) {
    console.error("check:admin-route-navigable — ORPHANED ADMIN SURFACE: a live owner-critical route has NO nav path:");
    for (const e of orphans) console.error(`  🔴 ${e.route} — ${e.why}. Add an href in src/components/layout/agentCloudNavigation.ts (or GlobalSidebar.tsx).`);
    console.error("  A route with no menu entry is a Check #3 IA leak: the admin can only reach it by typing the URL.");
    process.exit(1);
  }

  console.log(`check:admin-route-navigable — OK: all ${MUST_BE_NAVIGABLE.length} owner-critical admin routes are reachable from the nav.`);
  process.exit(0);
}
