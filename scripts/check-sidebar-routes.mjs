import fs from "node:fs";
import path from "node:path";

// Persistence-mandate guard — sidebar-to-router drift detector.
//
// GlobalSidebar.tsx ships every href a user can click in the app shell.
// App.tsx ships every <Route path="..."> the router will actually match.
// When the two drift — a sidebar href without a corresponding Route —
// the user clicks it and lands on NotFound. This has burned Sam's
// dashboard before (renamed a route, forgot the sidebar entry).
//
// This guard reads GlobalSidebar.tsx, extracts every `href: "/..."`
// literal, and verifies each one has an exact match in App.tsx's
// <Route path="..."> declarations. Parameterized routes (`/foo/:id`)
// match a sidebar href of `/foo/anything` iff the literal segments
// align. External hrefs (mailto:, tel:, https://…) are skipped.
//
// Exit 0 clean, 1 with a listing of every sidebar href that has no
// matching Route.

const repoRoot = path.resolve(import.meta.dirname, "..");
const SIDEBAR = "src/components/layout/GlobalSidebar.tsx";
const APP_TSX = "src/App.tsx";

const sidebarAbs = path.join(repoRoot, SIDEBAR);
const appAbs = path.join(repoRoot, APP_TSX);
for (const [label, p] of [
  ["GlobalSidebar", sidebarAbs],
  ["App.tsx", appAbs],
]) {
  if (!fs.existsSync(p)) {
    console.error(`check:sidebar-routes — ${label} not found at ${p}.`);
    process.exit(1);
  }
}

const sidebarSrc = fs.readFileSync(sidebarAbs, "utf8");
const appSrc = fs.readFileSync(appAbs, "utf8");

// Extract every literal `href: "/..."` value from the sidebar. Only
// internal paths (leading /) are checked; external URLs are skipped.
const HREF_PATTERN = /href\s*:\s*["']([^"']+)["']/g;
const sidebarHrefs = new Set();
let hm;
while ((hm = HREF_PATTERN.exec(sidebarSrc)) !== null) {
  const href = hm[1];
  if (!href.startsWith("/")) continue; // mailto:, tel:, https://, #anchors
  // Strip query strings + hash — routing key off the pathname.
  const clean = href.split("?")[0].split("#")[0];
  sidebarHrefs.add(clean);
}

// Extract every <Route path="..."> in App.tsx.
const ROUTE_PATTERN = /<Route\s+[^>]*path=["']([^"']+)["']/g;
const routes = [];
let rm;
while ((rm = ROUTE_PATTERN.exec(appSrc)) !== null) {
  routes.push(rm[1]);
}

// Compile each route pattern into a matcher. `:param` -> [^/]+.
// Trailing `/*` -> `.*`. Bare `*` -> `.*`.
const routeMatchers = routes.map((pat) => {
  if (pat === "*") return { pat, re: /^.*$/ };
  const escaped = pat
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\\\*/g, ".*")
    .replace(/:[A-Za-z0-9_]+/g, "[^/]+");
  return { pat, re: new RegExp("^" + escaped + "$") };
});

function isRouted(href) {
  for (const { re } of routeMatchers) {
    if (re.test(href)) return true;
  }
  return false;
}

const missing = [];
for (const href of sidebarHrefs) {
  if (!isRouted(href)) missing.push(href);
}

if (missing.length > 0) {
  console.error(
    "check:sidebar-routes — sidebar hrefs with no matching <Route> in App.tsx:",
  );
  for (const href of missing) console.error("  " + href);
  console.error("");
  console.error(
    "Why this exists: a sidebar link without a router entry lands the user on",
  );
  console.error(
    "NotFound the moment they click. This drift ships silently — the sidebar",
  );
  console.error(
    "compiles fine, App.tsx compiles fine, but the app is broken end-to-end.",
  );
  console.error(
    "Fix: add a <Route path=\"...\" element={<Page />} /> in src/App.tsx for",
  );
  console.error(
    "each href listed above, or remove the dead entry from GlobalSidebar.tsx.",
  );
  process.exit(1);
}

console.log(
  `check:sidebar-routes OK — ${sidebarHrefs.size} sidebar hrefs, ${routes.length} routes, 0 mismatched.`,
);
