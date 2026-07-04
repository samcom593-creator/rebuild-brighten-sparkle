import fs from "node:fs";
import path from "node:path";

// Persistence-mandate guard — MP-235-class internal-nav reload trap detector.
//
// Ports the wave-15 handoff instruction from active-work.md verbatim:
//   > "MP-235 tap-tap-tap regression watchlist should add MyLandingPage.tsx L216
//   >  to CI grep (`<a href=\"/(dashboard|agent|admin)` inside src/pages) to
//   >  prevent silent re-regression."
//
// Background: MP-235 (commits c05f17d9 + 3a747c54, 2026-07-02) killed 5 instances
// of `<a href="/internal-route">` and `window.location.href = "/internal-route"`
// full-page reload traps inside the SPA — WelcomeToast, ApplicantSelfReport,
// InstagramInbox, MyLandingPage, and the setTimeout('/login') hack in Auth.
// Two weeks later, wave-15 (commit 32502726) caught MyLandingPage.tsx L216
// silently re-introduced the same `<a href="/dashboard/profile">` reload trap
// that MP-235 had already killed on that exact surface.
//
// Full-page reloads inside a react-router SPA:
//   1. Blow away in-memory React state (unsaved forms, active useQueries).
//   2. Force a full JS bundle re-download (~800ms cold on 4G, kills FID).
//   3. Break Supabase auth session continuity (re-init of useAuth).
//   4. Trigger a fresh login redirect if any route-guard is mid-check.
//
// This guard scans every src/pages/**, src/components/**, src/hooks/**,
// src/lib/**, src/layouts/** for `<a\s+[^>]*href=["']/<internal-route>`
// patterns and the JS twin `window.location.href = "/internal-route"` /
// `location.assign("/internal-route")` / `location.replace("/internal-route")`.
//
// Internal routes are anything served by react-router (defined in src/App.tsx).
// External absolute URLs (https://…) and mailto:/tel:/#anchor are ignored.
// Bare "/" root redirect is allowed (post-logout common pattern).
//
// Opt-out marker per line: `internal-nav-href-allow:<reason>` on the same
// line or the line directly above the hit. Legitimate cases:
//   - Password recovery / SIGNED_OUT auth-state-change (full reload IS the
//     correct pattern — cache invalidation of user context is the goal).
//   - External deploy-trigger redirects that intentionally leave the SPA.
//   - Test fixtures that assert the reload pattern itself.

const repoRoot = path.resolve(import.meta.dirname, "..");

// Every top-level internal route prefix served by react-router. Sourced from
// src/App.tsx's <Route path> declarations. Grows as new admin/agent surfaces
// ship. Missing a prefix here means new pages get silently exempted from the
// guard — audit and extend when App.tsx grows a new top-level route.
const INTERNAL_ROUTE_PREFIXES = [
  "dashboard",
  "admin",
  "agent",
  "apply",
  "login",
  "signup",
  "status",
  "onboarding",
  "welcome",
  "inbox",
  "leaderboard",
  "leads",
  "producers",
  "manager",
  "content",
  "sam-todo",
  "producer-trends",
  "licensed-inbox",
  "next-step",
  "success",
  "profile",
  "settings",
  "scripts",
  "help",
  "handbook",
  "seminar",
  "get-licensed",
  "get-leads",
  "dialer",
  "purchase-leads",
  "deals",
  "onboard",
  "pipeline",
  "crm",
  "contentwheel",
  "call-center",
  "plaque",
  "producer",
  "awards",
  "unlicensed-overview",
  "callcenter",
  "system-health",
  "commissions",
  "trainings",
  "myjourney",
  "recruit",
  "recruiter",
  "recruits",
  "referrals",
  "career-pathway",
  "careers",
  "state-career",
];

// Directories walked for the check. Landing surfaces are pages Sam ships
// under react-router; components/hooks/layouts share the reload-trap disease
// class equally (wave-15's MyLandingPage.tsx lived under src/pages/).
const TRACKED_DIRS = [
  "src/pages",
  "src/components",
  "src/hooks",
  "src/lib",
  "src/layouts",
];

// Files exempt from the guard. Each exclusion is a hole — add with a reason.
const EXCLUDE_FILES = new Set([
  // WhatShippedTodayBanner.tsx quotes commit messages describing patterns
  // MP-235 killed. When we kill an `<a href="/dashboard">` reload trap the
  // banner mentions the pattern in past tense. Excluding keeps the shipped
  // log readable without breaking the guard.
  "src/components/dashboard/WhatShippedTodayBanner.tsx",
]);

const OPT_OUT_MARKER = /internal-nav-href-allow:/;

const routeUnion = INTERNAL_ROUTE_PREFIXES.map((r) => r.replace(/-/g, "\\-")).join("|");
const HREF_PATTERN = new RegExp(
  `<a\\s+[^>]*href=["']/(?:${routeUnion})(?:[/?#"'\\s]|$)`,
  "i",
);
const LOCATION_PATTERN = new RegExp(
  `(?:window\\.)?location\\.(?:href\\s*=|assign\\s*\\(|replace\\s*\\()\\s*["\`']/(?:${routeUnion})(?:[/?#"\`']|$)`,
  "i",
);

const violations = [];

function walk(rel) {
  const abs = path.join(repoRoot, rel);
  if (!fs.existsSync(abs)) return [];
  const stat = fs.statSync(abs);
  if (stat.isFile()) return [rel];
  const out = [];
  for (const entry of fs.readdirSync(abs)) {
    const sub = path.join(rel, entry);
    out.push(...walk(sub));
  }
  return out;
}

function isCommentLine(line) {
  const trimmed = line.trim();
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("/*")
  );
}

const files = TRACKED_DIRS
  .flatMap(walk)
  .filter((p) => /\.(tsx?|jsx?)$/.test(p))
  .filter((p) => !/\.(test|spec)\.(tsx?|jsx?)$/.test(p))
  .filter((p) => !EXCLUDE_FILES.has(p));

for (const rel of files) {
  const abs = path.join(repoRoot, rel);
  const lines = fs.readFileSync(abs, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isCommentLine(line)) continue;
    const prev = i > 0 ? lines[i - 1] : "";
    const hasOptOut = OPT_OUT_MARKER.test(line) || OPT_OUT_MARKER.test(prev);
    if (hasOptOut) continue;

    if (HREF_PATTERN.test(line)) {
      const match = line.match(HREF_PATTERN);
      violations.push(
        `${rel}:${i + 1}: <a href="${match?.[0].replace(/^.*href=["']/, "").replace(/["'].*$/, "")}"> is a full-page reload inside the SPA — swap to <Link to="…"> from react-router-dom.`,
      );
    }
    if (LOCATION_PATTERN.test(line)) {
      const match = line.match(LOCATION_PATTERN);
      violations.push(
        `${rel}:${i + 1}: ${match?.[0]} is a full-page reload inside the SPA — swap to useNavigate() from react-router-dom, or add \`internal-nav-href-allow:<reason>\` on this line if the reload is intentional (auth state change etc).`,
      );
    }
  }
}

if (violations.length > 0) {
  console.error(
    "check:internal-nav-hrefs — SPA internal-nav shipped as full-page reload:",
  );
  for (const v of violations) console.error("  " + v);
  console.error("");
  console.error(
    "Why this exists: MP-235 (2026-07-02 c05f17d9 + 3a747c54) killed 5 instances",
  );
  console.error(
    "of `<a href=\"/internal\">` and `window.location.href = \"/internal\"` reload",
  );
  console.error(
    "traps inside the SPA. Two weeks later wave-15 (32502726) caught a silent",
  );
  console.error(
    "re-introduction on MyLandingPage.tsx L216 — nothing was watching. This guard",
  );
  console.error(
    "closes the drift window at commit time. Fix: import { Link } / useNavigate",
  );
  console.error(
    "from 'react-router-dom' and swap. Legitimate reload cases (password recovery,",
  );
  console.error(
    "auth-state-change) add `internal-nav-href-allow:<reason>` on the same line or",
  );
  console.error("the line directly above.");
  process.exit(1);
}

console.log(
  `check:internal-nav-hrefs OK — ${files.length} files scanned, 0 SPA-internal reload traps.`,
);
