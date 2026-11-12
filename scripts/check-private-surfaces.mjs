#!/usr/bin/env node
// check:private-surfaces (SEC-PRIVATE-SURFACES, 2026-11-11)
//
// Sam's DMs, iMessages and camera library are SAM ONLY. On 2026-11-11 the manager role had an "Instagram"
// nav tab (modes: ["manager"]) and a route with allowManagers, which is how his DMs ended up on someone
// else's screen. This check fails the commit if any private page:
//   * has a nav entry without `samOnly: true`, or with a `modes:` list (modes hand the tab to a role), or
//   * has a route that lets a role through (allowManagers / allowPresenters / allowedRoles / extraRoles).
// The database is the authority (public.is_sam(), audited by fn_private_surface_audit() every 15 min);
// this keeps the UI from advertising a door the DB has closed, and from re-opening one by accident.
//
//   node scripts/check-private-surfaces.mjs            # check the repo
//   node scripts/check-private-surfaces.mjs --selftest # prove each rule fires on a mutated copy
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const NAV = "src/components/layout/agentCloudNavigation.ts";
const APP = "src/App.tsx";

// Every page that shows Sam's private data. Adding a private page = add it here (and to
// public.private_surface_registry for its tables).
export const PRIVATE_PATHS = [
  "/dashboard/inbox/instagram", // Instagram DMs
  "/dashboard/money-inbox", // iMessage + DM conversations
  "/dashboard/launch-board", // camera roll / media library clips
  "/dashboard/admin/social-media-bot", // the owner's unpublished posts, approval queue and inbound (MP-302)
  "/dashboard/system-health", // subscriptions, costs and integration accounts (MP-302)
];
const ROLE_OPENERS = /\b(allowManagers|allowPresenters|allowedRoles|extraRoles|allowRoles)\b/;

export function audit(navSrc, appSrc) {
  const failures = [];
  for (const path of PRIVATE_PATHS) {
    const esc = path.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    const navLines = navSrc.split("\n").filter((l) => new RegExp(`href:\\s*["'\`]${esc}["'\`]`).test(l));
    for (const line of navLines) {
      if (!/samOnly:\s*true/.test(line)) failures.push(`${NAV}: nav entry for ${path} is missing samOnly: true -> ${line.trim()}`);
      if (/\bmodes\s*:/.test(line)) failures.push(`${NAV}: nav entry for ${path} hands the tab to roles via modes -> ${line.trim()}`);
    }
    const routeLines = appSrc.split("\n").filter((l) => new RegExp(`path=["'\`]${esc}["'\`]`).test(l));
    if (routeLines.length === 0) failures.push(`${APP}: no <Route> found for private path ${path} (renamed? update PRIVATE_PATHS)`);
    for (const line of routeLines) {
      const m = line.match(ROLE_OPENERS);
      if (m) failures.push(`${APP}: route ${path} lets a role through (${m[1]}) -> ${line.trim()}`);
    }
  }
  return failures;
}

function selftest(navSrc, appSrc) {
  const cases = [
    ["GOOD passes", navSrc, appSrc, 0],
    ["manager tab via modes", navSrc.replace(/(href: "\/dashboard\/inbox\/instagram",[^\n]*?)samOnly: true/, '$1modes: ["manager"]'), appSrc, 2],
    ["samOnly dropped on Launch Board", navSrc.replace(/(href: "\/dashboard\/launch-board",[^\n]*?), samOnly: true/, "$1"), appSrc, 1],
    ["route allowManagers", navSrc, appSrc.replace('path="/dashboard/inbox/instagram" element={<ProtectedRoute requireAdmin>', 'path="/dashboard/inbox/instagram" element={<ProtectedRoute requireAdmin allowManagers>'), 1],
    ["private route deleted", navSrc, appSrc.replace(/[^\n]*path="\/dashboard\/money-inbox"[^\n]*\n/, ""), 1],
  ];
  let bad = 0;
  for (const [name, nav, app, want] of cases) {
    // a mutation that did not land proves nothing: assert the copy actually changed
    if (want > 0 && nav === navSrc && app === appSrc) {
      console.log(`  x selftest "${name}": mutation did not apply`);
      bad++;
      continue;
    }
    const got = audit(nav, app).length;
    const ok = want === 0 ? got === 0 : got >= want;
    console.log(`  ${ok ? "ok" : "x "} selftest "${name}" (${got} failures, want ${want === 0 ? 0 : ">=" + want})`);
    if (!ok) bad++;
  }
  return bad;
}

const navSrc = readFileSync(join(ROOT, NAV), "utf8");
const appSrc = readFileSync(join(ROOT, APP), "utf8");
if (process.argv.includes("--selftest")) {
  const bad = selftest(navSrc, appSrc);
  if (bad) {
    console.error(`check:private-surfaces --selftest FAILED (${bad})`);
    process.exit(1);
  }
  console.log("check:private-surfaces --selftest OK (each rule fires on its mutation)");
} else {
  const failures = audit(navSrc, appSrc);
  if (failures.length) {
    console.error("check:private-surfaces FAILED - Sam's private pages must be Sam-only:");
    for (const f of failures) console.error("  - " + f);
    process.exit(1);
  }
  console.log(`check:private-surfaces OK - ${PRIVATE_PATHS.length} private pages are samOnly in nav and role-closed in routes`);
}
