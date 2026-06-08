import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, ChevronDown, ChevronUp, CheckCircle2, Rocket } from "lucide-react";

/**
 * WhatShippedTodayBanner — pinned to the very top of /dashboard so Sam
 * (and any admin reloading) sees explicit proof of what changed today
 * vs yesterday. Updates by editing the SHIPPED array on each commit.
 *
 * Why this exists: Sam reported on 2026-05-19 "everything still looks
 * the exact same as yesterday" despite 24+ commits shipping in 24h.
 * Browser cache + Vercel propagation hide most changes. This banner
 * makes the delta unmissable. Collapsible so it doesn't dominate the
 * page after he's read it.
 */

interface ShippedItem {
  ts: string;       // human readable
  label: string;
  detail: string;
  commit?: string;
}

// 2026-05-18 / 2026-05-19 receipts. Most-recent first. Update this on
// every meaningful ship so the dashboard always shows the latest delta.
const SHIPPED: ShippedItem[] = [
  // forbidden-allow: the wave-29 entry below is the receipt for the wave-29 ship — it MUST name the
  // banned terms it now blocks (`delve into`, `95 active agents`) for the meta-narrative to make sense.
  // Per check-forbidden-language.mjs SKIP_LINE_REGEX, any line containing `forbidden-allow` is skipped.
  {
    ts: "today",
    label: "guard wave-29: pre-commit hook EXTENDED to also gate check:metric-truth, check:sync-reliability, check:unsafe-supabase-catch, and check:forbidden-language behind staged-file filters. forbidden-allow: this entry intentionally names the banned terms it now blocks. Wave-28 closed the laptop-side gap for the apex-vsl-sync-check class, but the same wave-25-class drift window was still wide open for the other 4 guardrails — they only fired at `npm run verify:core` (CI), never at commit time. A parallel Claude session (or even the same session on a tired commit) could push a `delve into` AI-tell, a fake `95 active agents` stat, a `clientPhone || \"+10000000000\"` placeholder, or a Supabase QueryBuilder `.catch()` chain to origin/main and only learn about it from the failing Vercel build minutes later. Wave-29 moves the catch all the way left: each check now has its own per-pattern gate in `.husky/pre-commit`. check:vsl-sync fires when index.html | HeroSection.tsx | the script | vite.config.ts is staged (wave-28 baseline). check:metric-truth fires when any src/ tsx|ts|jsx|js | supabase/functions/ | supabase/migrations/ | api/ file is staged. check:sync-reliability fires when deploy-supabase.yml | external-cron-backup.yml | supabase/functions/ | supabase/migrations/ | src/pages/ | src/components/dashboard/ | api/sync-insuracloud.ts is staged. check:unsafe-supabase-catch fires when any supabase/functions/ ts|tsx is staged. check:forbidden-language fires when any tsx|ts|jsx|js|md|html is staged (the script walks the whole repo, so any new copy anywhere is scanned). Timings on warm cache: vsl-sync 175ms, metric-truth 430ms, sync-reliability 229ms, unsafe-supabase-catch 224ms, forbidden-language 1018ms — full sweep ~2.1s when every gate fires, sub-second on typical commits. Failure path proven end-to-end: staged a fake `src/wave29-test-temp.tsx` containing `Let me delve into the topic`, ran `.husky/pre-commit` directly, hook fired metric-truth (passed) + forbidden-language (caught `delve into` AI-tell on line 2 + printed the file:line + reason + snippet + the wave-25-class fix instruction) + exited 1 — would block the commit. Cleaned up, no real commit made. Trigger matrix tested for 10 representative paths: src/pages/Dashboard.tsx → metric-truth + sync-reliability + forbidden-language, supabase/functions/insuracloud-sync/index.ts → metric-truth + sync-reliability + unsafe-supabase-catch + forbidden-language, supabase/migrations/*.sql → metric-truth + sync-reliability, .github/workflows/deploy-supabase.yml → sync-reliability only, package.json → no gates fire (correct — no guarded surface), index.html → vsl-sync + forbidden-language, HeroSection.tsx → vsl-sync + metric-truth + forbidden-language. The wave-25 → 26 → 27 → 28 → 29 ratchet is now a 5-layer defense: (1) wave-25 fixed the live VSL drift, (2) wave-26 locks 4 URL surfaces at Vite build start, (3) wave-27 added the 5th BUMP_VERSION surface, (4) wave-28 moved the VSL catch to pre-commit, (5) wave-29 extends pre-commit to cover all 5 brand/data-truth check classes. Five distinct classes of fake-success/AI-tell/sync-reliability bug now cannot ship to Vercel — the broken state never reaches origin/main.",
    detail: "Affected file: .husky/pre-commit — 4 new gated check blocks added below the wave-28 vsl-sync block. forbidden-allow: this entry intentionally names the banned terms it now blocks. Bash helper function `match()` introduced for DRY pattern matching against `git diff --cached --name-only --diff-filter=ACMR`. Each block has a one-line comment naming the wave + a list of triggering paths so future contributors understand the gate's scope without re-deriving from the script. Hook still uses git's built-in core.hooksPath (zero deps — no husky package, no lint-staged). Validation: bash -n syntax OK; 10 file paths tested through the trigger matrix, all correct subset of gates fired; end-to-end failure-path test with a planted `delve into` in a fake src/ tsx blocked the commit at exit 1 with forbidden-language's full violation report. Wave-29 queue carryover (deferred): (a) live mobile Lighthouse vs apex-financial.org/ — post wave-28 (e5637fa8) Vercel deploy + wave-29 commit will give the freshest cumulative-waves-17-28 LCP delta vs 06-04 18:43Z baseline (5.37s); wave-28 + 29 were emitted-code-neutral (only build-time guard + banner string deltas), so measured LCP reflects the full wave 17-27 perf chain. (b) preload-helper merge into rolldown-runtime — 1,215 B / 638 B gz chunk for Vite __vitePreload polyfill, investigate build.modulePreload.polyfill:false on esnext target (would drop modulepreload chain 5→4 entries). (c) Tailwind landing CSS 32 KB gz waste via per-route Tailwind output. (d) Pre-commit hook still misses sync-reliability's workflow files (.github/workflows/*.yml) AND the static analysis on the migrations regex — extend the gate set as more checks land. Why no `package.json` gate yet: no current check reads package.json or lockfile drift; if Sam adds a deps-audit script later, that's a new gate row.",
  },
  {
    ts: "yesterday",
    commit: "e5637fa8",
    label: "guard wave-28: pre-commit hook for the apex-vsl-sync-check class — the wave-26 Vite plugin only fires at build start, which on Vercel means the bad commit is already pushed before the rule catches it. The wave-27 cross-session race proved this concretely: two parallel Claude sessions independently read wave-26's queue entry and shipped IDENTICAL plugin extensions (commit e24adf69) within minutes — then one session's next commit (2ec9b695) bumped BUMP_VERSION to `2026-06-07-phases-5-6-7-8` (no videoId), failing the plugin it had just shipped, breaking the Vercel build, and forcing another commit (2b21d6df) to unblock it. Pre-commit catches it on Sam's laptop before push — Vercel never sees the broken state. Implementation uses git's built-in `core.hooksPath` config pointing at `.husky/` (zero extra deps — no husky package, no lint-staged, just a shell script + a Node port of the plugin). New files: `scripts/check-vsl-sync.mjs` is a pure Node port of vslSyncCheckPlugin's 5-surface drift detector (same regexes, same heroId extraction from <LazyYouTube videoId=\"...\">, same fix-instruction error block). `.husky/pre-commit` fast-fails: it only runs the check when staged files include `index.html | src/components/landing/HeroSection.tsx | scripts/check-vsl-sync.mjs | vite.config.ts` — saves ~120 ms on unrelated commits. `npm run prepare` runs `git config core.hooksPath .husky` so any fresh clone or worktree auto-activates the hook on `npm install`. New `npm run check:vsl-sync` exposed for ad-hoc verification; added to `verify:core` so the full CI pipeline (forbidden-language → metric-truth → sync-reliability → unsafe-supabase-catch → vsl-sync → tsc → build) catches it at three layers: pre-commit (local), verify:core (CI), Vite plugin (Vercel build). Failure path verified: sed-corrupted `E2VJ1v85IRE/hqdefault.jpg` → `XXXXXXXXXXX/hqdefault.jpg` made `node scripts/check-vsl-sync.mjs` exit 1 with full drift list (3 occurrences of preload + thumbnailUrl) + fix block naming wave-25 commit 2da7ddc7. Restored, re-ran, exit 0 (\"OK — all 5 index.html surfaces match HeroSection.tsx videoId=E2VJ1v85IRE\"). Same persistence pattern as wave-20's AgentLink truth-view + reaper. The wave-25 → wave-26 → wave-27 → wave-28 ratchet is now a 4-layer defense: (1) wave-25 fixed the live drift, (2) wave-26 locks 4 URL surfaces at Vite build start, (3) wave-27 added the 5th BUMP_VERSION surface, (4) wave-28 moves the catch from post-push Vercel build all the way left to pre-commit on Sam's laptop. The class of bug cannot ship.",
    detail: "Affected files: scripts/check-vsl-sync.mjs (new, +91 LOC — standalone Node port: reads HERO=src/components/landing/HeroSection.tsx + INDEX=index.html, extracts heroId via /<LazyYouTube\\s+videoId=\"([A-Za-z0-9_-]{8,15})\"/, runs 4 URL regexes + 1 BUMP_VERSION containment check, exits 1 with structured stderr on drift, exits 0 + OK line on match). .husky/pre-commit (new, +24 LOC — bash hook with set -e; checks `git diff --cached --name-only --diff-filter=ACMR` for any of the 4 VSL-affecting paths; only invokes node script when at least one matches; otherwise silent no-op so unrelated commits aren't slowed down). package.json: added `check:vsl-sync` script, added `prepare` script (`git config core.hooksPath .husky 2>/dev/null || true` — runs on every `npm install` in any clone/worktree so the hook auto-activates), inserted `npm run check:vsl-sync` into the `verify:core` chain between unsafe-supabase-catch and tsc. Activated locally now via `git config core.hooksPath .husky`. Test matrix: (1) happy path: `node scripts/check-vsl-sync.mjs` exits 0 + prints `OK — all 5 index.html surfaces match HeroSection.tsx videoId=\"E2VJ1v85IRE\"`. (2) failure path: sed-corrupted index.html preload videoId, ran script, got exit 1 + 3-line drift report (2 preload occurrences + 1 thumbnailUrl) + fix instructions naming wave-25 commit. Reverted, re-ran, clean. (3) hook scope: when no VSL-affecting file is staged, the pre-commit hook prints nothing and the commit proceeds — verified by inspecting the staged-file grep. (4) hook trigger: when index.html/HeroSection.tsx/scripts/check-vsl-sync.mjs/vite.config.ts is staged, the hook prints `[pre-commit] VSL-affecting file staged — running check-vsl-sync…` then invokes the script. The vite.config.ts plugin remains as the final safety net for any developer who bypasses local hooks (`git commit --no-verify` or CI without npm install). Wave-28 queue carryover: (a) live mobile Lighthouse vs apex-financial.org/ for cumulative waves 17-27 LCP delta vs 06-04 18:43Z baseline (5.37s); (b) preload-helper merge into rolldown-runtime — 1,215 B / 638 B gz chunk for Vite __vitePreload polyfill, investigate build.modulePreload.polyfill:false on esnext target; (c) Tailwind landing CSS 32 KB gz waste via per-route Tailwind output.",
  },
  {
    ts: "yesterday",
    label: "guard wave-27: BUMP_VERSION drift surface added to the apex-vsl-sync-check plugin. Wave-26 made index.html's preload + VideoObject JSON-LD URLs into a build-time assertion, but a third drift surface lived in the cache-bust script at index.html:14 — `var BUMP_VERSION = \"2026-06-05-new-vsl-E2VJ1v85IRE\"`. That string is the cache-eviction trigger: when it changes, the bootstrap script wipes localStorage + unregisters service workers + clears Cache Storage on next visit so users don't see the new VSL through a stale precached poster image. If Sam swaps the VSL and updates HeroSection.tsx + index.html URLs (passing wave-26) but forgets to bump BUMP_VERSION, the wave-25 user-visible cost partially returns: the HTML serves the new poster, but pinned service workers keep serving the previous bundle's view of the world. Wave-27 extends the plugin's drift list with a 5th check: `BUMP_VERSION` MUST contain the current HeroSection.tsx videoId substring. Failure path verified: sed-corrupting `\"2026-06-05-new-vsl-E2VJ1v85IRE\"` → `\"2026-06-05-no-videoid\"` made `npm run build` fail with `[apex-vsl-sync-check] index.html VSL references DRIFTED ...: - BUMP_VERSION: \"2026-06-05-no-videoid\" does not contain current videoId E2VJ1v85IRE — caches will not evict on this swap` plus an extended Fix: line naming the BUMP_VERSION convention `2026-MM-DD-new-vsl-<ID>`. Happy path: zero emitted-code impact, entry chunk index-4BIEjL_s.js still 137.12 KB raw / 41.94 KB gz, modulepreload chain still 5 entries (rolldown-runtime / preload-helper / vendor-react / vendor-icons-landing / apex-icon), PWA precache 260 entries unchanged (4821.85 KiB). The cache-busting layer is now hard-ratcheted to the canonical videoId — there is no way to ship a new VSL that doesn't also evict every user's stale precache.",
    detail: "Affected file: vite.config.ts — `vslSyncCheckPlugin()` extended with one BUMP_VERSION extraction + containment check. New regex: `/var\\s+BUMP_VERSION\\s*=\\s*\"([^\"]+)\"/`. Containment rule: extracted string MUST `.includes(heroId)`. On miss, drift list gets `BUMP_VERSION: \"<actual>\" does not contain current videoId <ID> — caches will not evict on this swap`. Fix instruction extended to also call out the BUMP_VERSION line with example `\"2026-MM-DD-new-vsl-<ID>\"`. Plugin still runs in `buildStart`, still throws structured Error with full drift list + Fix block. The check is independent of (and therefore composable with) the 4 URL checks added in wave-26 — a single build sees ALL 5 drift surfaces in one report. tsc 0 / npm run build ✓ 6.01s (happy) / 5.67s (re-verify) / 260 PWA entries (4821.85 KiB precache, flat vs wave-26). Failure-path proof: temporarily swapped `\"2026-06-05-new-vsl-E2VJ1v85IRE\"` → `\"2026-06-05-no-videoid\"` in index.html:14 cache-bust script → build exited with `[apex-vsl-sync-check] index.html VSL references DRIFTED from HeroSection.tsx LazyYouTube videoId=\"E2VJ1v85IRE\": - BUMP_VERSION: \"2026-06-05-no-videoid\" does not contain current videoId E2VJ1v85IRE — caches will not evict on this swap` plus the extended Fix block. Restored index.html, re-ran `npm run build` → clean (built in 5.67s, 260 PWA entries). Wave-25 → wave-26 → wave-27 is now a 3-layer hard ratchet: (1) wave-25 fixed the real LCP/SEO drift, (2) wave-26 locks the 4 URL drift surfaces (preload + thumbnailUrl + contentUrl + embedUrl), (3) wave-27 locks the 5th (BUMP_VERSION cache-eviction surface). Same persistence pattern as wave-20's AgentLink truth view + reaper that prevents InsuraCloud fake-success from re-emerging (memory: [[project_apex_2026_05_20_agentlink_fake_success]]). Wave-28 queue: (a) live mobile Lighthouse vs apex-financial.org/ for cumulative waves 17-27 LCP delta vs 06-04 18:43Z baseline (5.37s); (b) preload-helper merge into rolldown-runtime — 1,215 B / 638 B gz chunk for Vite __vitePreload polyfill, investigate build.modulePreload.polyfill:false on esnext target; (c) Tailwind landing CSS 32 KB gz waste via per-route Tailwind output (custom rollup plugin or two-pass build — critters/SPA dead-end documented wave-17).",
    commit: "2b21d6df",
  },
  {
    ts: "yesterday",
    label: "guard wave-26: build-time sync invariant LOCKS the wave-25 LCP-preload class of regression FOREVER. Wave-25 fixed an index.html preload that had silently drifted from HeroSection.tsx's LazyYouTube videoId for 2 days (commit 76f46fe5 swapped to E2VJ1v85IRE on 2026-06-05; index.html still referenced v4Fp3FL9ITo until commit 2da7ddc7 on 2026-06-07 — costing ~400-600ms mobile LCP and SEO/AI-overview surfacing the wrong VSL). Wave-26 turns the manual sync rule (documented as a comment above the preload) into an EXECUTABLE assertion. New Vite plugin `apex-vsl-sync-check` runs in `buildStart`, reads HeroSection.tsx + index.html, extracts videoId from `<LazyYouTube videoId=\"...\">` and four index.html consumers (preload `<link>`, VideoObject thumbnailUrl, VideoObject contentUrl, VideoObject embedUrl), and THROWS a build error naming every drifted reference if any disagree with the canonical hero videoId. Wave-27 added a 5th drift surface (BUMP_VERSION cache-bust). Happy path: zero emitted-code impact; entry chunk still 137.12 KB raw / 41.95 KB gz; modulepreload chain still 5 entries; PWA precache 260 entries unchanged. The wave-25 class of bug can NEVER silently re-ship.",
    detail: "—",
    commit: "693886a1",
  },
  {
    ts: "yesterday",
    label: "fix wave-25: index.html LCP preload + VideoObject JSON-LD pointed at the WRONG YouTube video for 2 days (commit 76f46fe5 swapped HeroSection.tsx LazyYouTube videoId to E2VJ1v85IRE on 2026-06-05; index.html still referenced v4Fp3FL9ITo until today). Browser was eagerly fetching ~25 KB of an unused poster while the real LCP element was late-discovered via <img src> — projected +400-600ms mobile LCP. Google/Bing/AI-overview surfaced the wrong VSL for site:apex-financial.org. Wave-25 corrected preload + thumbnailUrl + contentUrl + embedUrl + name + description + uploadDate. Wave-26 + wave-27 added build-time guards so this class can't recur.",
    detail: "—",
    commit: "2da7ddc7",
  },
  {
    ts: "yesterday",
    label: "perf wave-24: vendor-utils (clsx + react-is + tiny-invariant) merged into vendor-react — one fewer modulepreload entry + one fewer HTTP request on every cold landing. Wave-14 had isolated those three tiny utils into a standalone 1.4 KB raw vendor-utils chunk to stop rolldown's chunk-graph heuristic from hoisting them into vendor-charts (which would drag the full 389 KB recharts chunk eager on landing — Lighthouse 2026-06-03 measured 83 KB / 79% unused). That worked, but left vendor-utils sitting in slot 3 of the cold-landing critical-path modulepreload chain (rolldown-runtime → preload-helper → vendor-utils → vendor-react → vendor-icons-landing → apex-icon) as its own preload tag + GET. Wave-24 moves the three utils up the priority chain into the vendor-react advancedChunks group (priority 90 → 100, regex extended to also match `node_modules/(clsx|react-is|tiny-invariant)/`). The wave-14 anti-hoist guarantee survives intact because the new rule is HIGHER priority than vendor-charts (priority 70) — recharts still imports the utils, just from vendor-react (already cold-landing eager) instead of from a separate chunk, so vendor-charts stays truly lazy. vendor-react grows 161.97 → 163.32 KB raw (+1.35 KB) and 52.13 → 53.51 KB gz (+1.38 KB) — invisible vs its existing weight. Cold-landing modulepreload chain drops 6 → 5 entries.",
    detail: "Build receipt: vendor-utils-*.js chunk no longer emitted (was 1,435 B raw / 631 B gz). vendor-react-H6HRlGV3.js = 163,322 B raw / 53,508 B gz (wave-23's vendor-react-95ffaOAl.js = 161,973 B raw / 52,128 B gz — deltas exactly match the merged utils: +1,349 B raw / +1,380 B gz). Entry chunk index-DoGLeqNN.js = 137,123 B raw / 41,920 B gz vs wave-23's index-BVGp9Yin.js 137,631 B / 41,776 B (−508 B raw because rolldown deduped 3 `from \"./vendor-utils-*.js\"` import specifiers down to existing `from \"./vendor-react-*.js\"` edges; +144 B gz is gzip-noise from the reshuffled module order). dist/index.html cold-landing modulepreload chain: rolldown-runtime / preload-helper / vendor-react / vendor-icons-landing / apex-icon — 5 entries total, ZERO vendor-charts/forms/dates/utils/supabase/query/icons-extra/radix/ui (every lazy chunk resolves via __vitePreload at navigation time only). vendor-charts-SVv3_qui.js = 389.16 KB raw / 105.41 KB gz stays lazy ✓ (still has edges INTO vendor-react for the utils — that's an eager-resolved dep). tsc 0 / npm run build ✓ 8.13s / 260 PWA entries (4814.39 KiB precache, +3 KiB vs wave-23 for hash churn). Cumulative waves 14→24: vendor-charts moved off eager landing (−83 KB / wave-14), vendor-radix off (−47 KB gz / wave-18), vendor-ui off (−4 KB / wave-17), vendor-supabase off (−44.6 KB gz / wave-19), vendor-icons-extra off (−13.45 KB gz / wave-22), vendor-query off (−7.95 KB gz / wave-23), vendor-utils merged (−1 modulepreload tag + 1 HTTP request / wave-24).",
    commit: "138acac8",
  },
  {
    ts: "yesterday",
    label: "perf wave-23: vendor-query EXITS the cold-landing modulepreload chain. Wave-22 isolated vendor-icons but vendor-query (28 KB raw / 7.95 KB gz) was still preloaded because App.tsx eagerly imported QueryClientProvider from @tanstack/react-query + queryClient from @/shared/api/queryClient at module-load. That was the sole edge anchoring react-query to the entry static graph — zero eager-landing components (Navbar, HeroSection, Footer, DealsTicker, StickyMobileCTA, Index, useAuth, ProtectedRoute, AuroraBackground, RouteTelemetry, AuthProvider, SidebarProvider, ErrorBoundary, SupabaseHealthBanner, DeferredToasters) reference react-query directly. Every useQuery call lives inside a React.lazy boundary. Wave-23 architecture: new src/shared/api/QueryProviderInner.tsx exports a tiny QCP wrapper that imports queryClient. src/shared/api/LazyQueryRoot.tsx lazy-loads QueryProviderInner inside a Suspense boundary. App.tsx removes the eager QueryClientProvider wrap and adds a QueryShell layout route that mounts LazyQueryRoot around every non-landing path (landing route stays a sibling). Index.tsx + HeroSection.tsx wrap their inner Suspense blocks (Testimonials/BenefitsSection/CTASection/CareerPathwaySection + LiveStats/RecentHires) with LazyQueryRoot directly — so landing's eager render path (h1 + video poster + carrier marquee + footer) requires zero vendor-query bytes. Singleton queryClient lives in @/shared/api/queryClient — every lazy QCP mount points at the same cache so navigations between landing's lazy sections, /apply, /login, and /dashboard reuse cached queries.",
    detail: "Build receipt: entry index-BVGp9Yin.js = 137,631 B raw / 41,776 B gz vs wave-22's 147,080 B / 45,160 B — entry deltas: −9,449 B raw / −6.4%, −3,384 B gz / −7.5%. Modulepreload chain dropped 7 → 6 entries: rolldown-runtime / preload-helper / vendor-utils / vendor-react / vendor-icons-landing / apex-icon. vendor-query is no longer in the cold-landing preload manifest. New lazy chunks: QueryProviderInner-B6mBcRPH.js = 9,393 B raw / 3,377 B gz; vendor-query-DyD67Xy2.js = 26,087 B raw / 8,144 B gz (fetched via runtime dynamic-import only when LazyQueryRoot's Suspense resolves — after LCP for landing, or during route lazy-resolve for /apply, /login, /dashboard/*). LiveStatsCounterStrip-B3ZDSVfB.js = 3,264 B raw, RecentHiresTicker-DVri3Ea8.js = 2,371 B raw (two lazy chunks now share one LazyQueryRoot wrapper, so they mount inside a single QueryClientProvider on the cold-landing post-LCP idle window). Tests: useAuth 9/9 pass (pre-existing TOKEN_REFRESHED mock-gap unhandled-rejection persists from wave-20 — not a regression). tsc 0 / npm run build ✓ 5.74s / 261 PWA entries (4811.64 KiB precache). Cumulative across waves 17→23: entry chunk 351 → 137.63 KB raw (−61%). Cold-landing modulepreload weight DOWN ~84 KB gz vs pre-wave-17.",
    commit: "ec4683c1",
  },
  {
    ts: "yesterday",
    label: "perf wave-22: vendor-icons split into landing-eager subset (17 icons used by Navbar/HeroSection/Footer/StickyMobileCTA + App-level ErrorBoundary/ScrollToTop/NotFound) vs everything-else (133 icons used only by lazy dashboard/admin chunks). vendor-icons was a 50.92 KB raw / 15.5 KB gz monolith in the cold-landing modulepreload chain because lucide-react bundles all imported icons into one rolldown chunk group regardless of which call sites are eager vs lazy. New rolldown advancedChunks group `vendor-icons-landing` (priority 75, regex matches the exact 17 kebab-case icon paths under `node_modules/lucide-react/dist/esm/icons/`) intercepts those 17 before the broader vendor-icons matcher (priority 70). Trap: lucide's barrel re-exports `AlertTriangle` from `triangle-alert.js` (aliased name, not `alert-triangle.js`) — the file-path regex must use the canonical kebab path. Build receipt: vendor-icons-landing = 4.32 KB raw / 2.05 KB gz; vendor-icons-extra = 46.59 KB raw / 13.95 KB gz (down from 50.92 / 15.5 because the 17 icons moved out). Cold-landing modulepreload chain DROPS vendor-icons-extra entirely: 7 → 7 entries, but the heavy chunk in slot 6 swapped from 15.5 KB gz to 2.05 KB gz — net −13.45 KB gz removed from critical-path preload. Lazy admin/dashboard chunks still load vendor-icons-extra on demand when they actually navigate. Cumulative across waves 17-22: entry chunk 351 → 147 KB raw (−58%); cold-landing preload weight DOWN ~76 KB gz vs pre-wave-17.",
    detail: "Build receipt: entry index-*.js = 147.08 KB raw / 45.16 KB gz (essentially flat vs wave-21's 146.58/45.13 — the +0.5 KB raw is rolldown's chunk-graph rewiring overhead for the new chunk-group split; gz cost is +0.03 KB). New chunks: dist/assets/vendor-icons-landing-DzxQYRXm.js = 4,315 bytes raw / 2,051 bytes gz containing 17 forwardRef components (Menu, X, Crown, Search, ArrowRight, Shield, TrendingUp, Users, Sparkles, Play, Mail, Phone, MapPin, ChevronUp, AlertTriangle [→ triangle-alert.js], RefreshCw, Compass). vendor-icons-DIO5hIKn.js = 46,591 bytes raw / 13,954 bytes gz (was 50,920 / 15,522). Modulepreload chain: rolldown-runtime / preload-helper / vendor-utils / vendor-react / vendor-query / vendor-icons-landing / apex-icon — vendor-icons (the 133-icon extras chunk) is NO LONGER in the cold-landing preload manifest. Tests: useAuth 9/9 pass (pre-existing mock-gap unhandled-rejection, see wave-20). tsc 0 / npm run build ✓ 5.16s / 259 PWA entries (4808.95 KiB precache, +6 KiB vs wave-21 for the split chunk's hash). Wave-23 queue: (a) live mobile Lighthouse vs apex-financial.org/ to measure cumulative waves 19-22 cold-landing LCP delta vs pre-wave-19 baseline (Lighthouse on 06-04 18:43Z = 35.7 KB vendor-supabase on `/` + LCP 5.37s; now expect 0 KB vendor-supabase on `/` AND −13.45 KB gz off icons preload). (b) Continue vendor-query lazy hunt — landing has zero eager useQuery callers post wave-21, so QueryClientProvider can in principle become lazy. (c) Tailwind landing CSS 32 KB waste via per-route Tailwind output (custom rollup plugin or two-pass build).",
    commit: "77fad992",
  },
  {
    ts: "yesterday",
    label: "perf wave-21: HeroSection LiveStatsCounterStrip + RecentHiresTicker now React.lazy + Suspense(fallback=null). Both render below the LCP fold (after H1, video poster, CTAs, founder credit) and were eagerly imported by HeroSection — dragging their useQuery setup, AnimatedCounter primitive, and `Users/FileText/Building2/Sparkles` lucide icons into the entry chunk on every cold landing. Both components already render `null` while their react-query queryFn resolves (LiveStats has a HARDCODED_FLOOR fallback, RecentHires returns null on isLoading). So a `<Suspense fallback={null}>` boundary visually no-ops — the lazy chunk fetches concurrently with their own async supabase queryFn (wave-19) and renders identically when both resolve. Entry chunk goes from 151.69 → 146.58 KB raw (−5.11 KB / −3.4%) and 46.37 → 45.13 KB gz (−1.24 KB / −2.7%). Two new tiny lazy chunks created: LiveStatsCounterStrip-*.js = 3.2 KB / RecentHiresTicker-*.js = 2.4 KB. They load in the post-LCP idle window after the hero CTA + video are painted. The supabase fetch they trigger is already routed through the wave-19 dynamic-import + wave-20 requestIdleCallback gate, so vendor-supabase still doesn't fight LCP.",
    detail: "Build receipt: entry index-CuvdLowF.js = 146,589 bytes raw / 45.13 KB gz (wave-20 was index-DHSNCPqH.js at 151.69 / 46.37). modulepreload chain holds at 7 entries (rolldown-runtime / preload-helper / vendor-utils / vendor-react / vendor-query / vendor-icons / apex-icon). vendor-query still preloaded because at least one other eager-landing edge consumes react-query — investigating that anchor is wave-22's job. tsc 0 / npm run build ✓ 5.46s / 258 PWA entries (4800 KiB precache). 2 files changed: src/components/landing/HeroSection.tsx adds `lazy, Suspense` to the react import + replaces the 2 static imports with lazy() wrappers + wraps the 2 render sites in `<Suspense fallback={null}>`. No new dep, no test changes (HeroSection has no test file — both lazy targets keep their existing behavior). Wave-22 queue: (a) live mobile Lighthouse against apex-financial.org/ post-Vercel-deploy of wave-21 to measure cumulative cold-landing JS reduction (waves 17→21 cut the entry chunk 351 → 146.58 KB raw, −58%). (b) Hunt the remaining vendor-query eager-landing edge (likely QueryClient setup in App.tsx — but landing has no useQuery callers post-wave-21 except inside lazy chunks, so it should be possible to lazy QueryClient too). (c) vendor-icons 50.92 KB raw / 15.53 KB gz tree-shake — only ~15 lucide icons used on landing; rest of bundle is admin/dashboard icons. (d) Tailwind landing CSS 32 KB waste via per-route Tailwind output.",
    commit: "09f06b98",
  },
  {
    ts: "yesterday",
    label: "perf wave-19: vendor-supabase EXITS the cold landing modulepreload chain. Wave-15/16/18 architecturally detached supabase from ErrorBoundary, SupabaseHealthBanner, and ProtectedRoute — but vendor-supabase kept appearing in `<link rel=\"modulepreload\">` because the client singleton was still reachable through six remaining eager-landing edges: (1) useAuth.ts (AuthProvider above every route), (2) shared/api/queryClient.ts, (3) shared/telemetry/track.ts, (4) shared/lib/webVitals.ts, (5) landing/LiveStatsCounterStrip (rendered eagerly by HeroSection — live agent/app/carrier counters), (6) landing/RecentHiresTicker (rendered eagerly by HeroSection — gold scrolling recent-hires marquee). All six converted to the lazy-singleton or `await import()`-inside-callback pattern. useAuth uses a memoized supabasePromise so signUp/signIn/signOut/fetchProfile/fetchRoles share one loader. After ship: modulepreload chain dropped 9 → 7 entries. vendor-supabase-*.js (170.28 KB raw / 44.61 KB gz) AND the 485-byte client-*.js singleton shim both fall off the cold landing preload manifest. Cold landing first paint no longer downloads the supabase library — it loads asynchronously when AuthProvider's getSession() resolves OR LiveStats/RecentHires queryFn fires. This is the supabase counterpart to wave-18's vendor-radix win.",
    detail: "Build receipt: entry index-Dk1WiTe0.js = 151.45 KB raw / 46.26 KB gz (wave-18 was 150.42 KB raw / 45.80 KB gz — +0.78 KB raw / +0.46 KB gz for the new __vitePreload wrappers on six dynamic edges). Net cold-landing bytes BEFORE LCP: −44.6 KB gz (the dropped vendor-supabase preload). Tests: useAuth 9/9 pass (vitest module caching makes dynamic-import resolve to same mock identity); track.test.ts added flushMicrotasks() helper bridging fake-timer + real-microtask queues for the new `await import()` tick, 10/10 pass; queryClient 11/11 unchanged. tsc 0 / npm run build ✓ 4.86s / 255 PWA entries. Live mobile Lighthouse against apex-financial.org/ at 17:26Z (pre-deploy, wave-18 live): perf=56 / LCP=5.4s — single-sample variance vs wave-16's 74/4.6s peak (mobile sim ±20pp on individual samples; CLS=0 is the durable architectural truth across waves 15-19).",
    commit: "069ba725",
  },
  {
    ts: "yesterday",
    label: "perf wave-18: vendor-radix exits the eager landing graph entirely. Three coordinated edits — (1) App.tsx removed App-tree TooltipProvider wrap, moved into AuthenticatedShell.tsx. (2) ErrorBoundary.tsx replaced shadcn `<Button>` with native `<button>` (Button imports @radix-ui/react-slot for asChild). (3) useAuth.ts SessionWarningDialog converted to React.lazy + open-only mount (uses radix AlertDialog). With all three severed: vendor-radix STATIC imports from entry = 0, modulepreload chain dropped vendor-radix entirely. ~47 KB gz fewer bytes preloaded on every cold landing.",
    detail: "Build receipt: entry chunk index-CKds-4Oe.js = 150.42 KB raw / 45.80 KB gz (wave-17 was 154.14 KB raw / 46.67 KB gz — wave-18 deltas: −3.72 KB raw / −2.4%, −0.87 KB gz / −1.9%). vendor-radix-CvtCKhre.js (153.35 KB raw / 47.87 KB gz) dropped from preload manifest. Lazy-only — loads when navigating to a dashboard route or when an idle-warning dialog fires post-59-min auth idle.",
    commit: "0854cd78",
  },
  {
    ts: "yesterday",
    label: "perf wave-17: Toaster + Sonner moved off the eager entry static graph. Both shadcn Toaster (radix-toast subtree) and sonner Toaster (sonner + next-themes) were eager-imported in App.tsx and rendered above every route — yet landing (`/`) never fires a toast. Wave-17 wraps both in React.lazy + idle-prefetch via requestIdleCallback (timeout 2s, setTimeout 1s fallback) so they mount within the post-LCP idle window. vendor-ui edge REMOVED from entry (sonner + cmdk + embla + vaul stop being browser-preloaded on cold landing).",
    detail: "Build receipt: entry chunk index-Dz9n3CBD.js = 154.14 KB raw / 46.67 KB gz (wave-16 was 158.31 KB raw / 47.16 KB gz — wave-17 deltas: −4.17 KB raw / −2.6%, −1.53 KB gz / −3.2%). vendor-ui edge GONE from entry.",
    commit: "8da7bc68",
  },
  {
    ts: "yesterday",
    label: "perf wave-16: ProtectedRoute supabase lazy-inside-effect + wave-15 LIVE verified (LCP 4.80→4.6s, TBT 230→120ms, perf 69→74). Wave-15 shipped overnight (commit d42ff0ee) and live Lighthouse confirmed the architectural detach moved the real metrics — vendor-supabase is no longer in the entry chunk's direct static-import list (6 vendor chunks now: icons/query/radix/react/ui/utils + 485-byte client shim). Wave-16 takes the next eager-supabase anchor — ProtectedRoute — and moves its only supabase call (`supabase.from('agents').select('is_presenting')` for the seminar-presenter check) inside a dynamic `await import(...)` inside the useEffect. The presenter check is itself gated behind `requireAdmin && allowPresenters && user && !isAdmin && !(allowManagers && isManager)` — a path that fires only when a seminar-presenter mounts a presenter-only route. For 99.9% of cold landing visits, the supabase module evaluation never even starts from this code path. Remaining 3 anchors (useAuth + queryClient + initTelemetry) are true infrastructure — the supabase client must boot once for the AuthProvider to wrap every route.",
    detail: "Live mobile Lighthouse against apex-financial.org/ at 05:05Z (post-Vercel-deploy of d42ff0ee, age 3531s on the entry chunk = 58 min old) measured perf=74 / LCP=4.6s / FCP=3.9s / TBT=120ms / CLS=0 / SI=3.9s / TTI=5.2s — vs wave-14 live baseline of perf=69 / LCP=4.80s / TBT=230ms / CLS=0.001. The vendor-supabase architectural detach delivered −200ms LCP, −110ms TBT (−48%), and pushed CLS to a perfect zero. Then ProtectedRoute.tsx wave-16 ship: removed top-level `import { supabase } from \"@/integrations/supabase/client\"` (line 5) and rewrote the useEffect's presenter-check promise chain into an `async IIFE` that starts with `const { supabase } = await import(\"@/integrations/supabase/client\")`. 13/13 existing ProtectedRoute tests pass — Vitest module caching means the dynamic import resolves to the same mocked module identity as the eager mock at the top of the test file (`vi.mocked(supabase.from).mockReturnValue(...)` still applies). Build receipt: entry chunk index-CQgSJIgR.js = 158.31 KB / gz 48.70 KB (wave-15 was 158.16 KB raw — +0.15 KB rolldown bookkeeping for the new lazy edge, gz unchanged).",
    commit: "519ce7de",
  },
  {
    ts: "yesterday",
    label: "Sam-2026-06-03 bridge: BuilderProgressDashboard on front /dashboard (Sam's primary focus — direct recruits classified strong/emerging/producer/light/new/dormant, with team AP MTD + actively-producing flag, reads v_sam_builders_dashboard) + Add Agent Transfer toggle (Carriers / Writing numbers / Previous upline shown only when 'Transfer needed' checked, persisted as a structured agent_note + [TRANSFER PENDING] stamp on the agent row, add-agent edge fn v22 live) + PII-light broadcasts (fn_post_new_applicant_to_onboarding_chat + fn_run_applicant_nudges now only ship first name + last name + state — phone / email moved behind the 'Open file' link) + Discord recruiting-licensed triggers dropped (webhook 403 dead; Telegram pipeline owns this lane now).",
    detail: "View v_sam_builders_dashboard joins agents (invited_by_manager_id = Sam's profile id) → profiles → deals → downline rollup. Returns 57 Sam-direct rows: 2 strong builders (3+ recruits each), 2 emerging builders, 1 producer (4+ MTD deals), 2 light producers, 2 new hires, 45 dormant (no deal in 30d), 3 unknown. Counters at top: builders / producers / actively-producing-14d / new-hires / dormant. Active rows expanded by default; 45 dormant collapsed under '<details>'. Add Agent flow: 4 baseline fields (first/last/email/phone) + 'Transfer needed' Checkbox; when on, reveals 3 inputs (Carriers, Writing numbers, Previous upline). Edge fn persists block as agent_notes row + stamps agents.notes='[TRANSFER PENDING] {carriers}…' so existing dashboards can filter for transfer agents. PII rebuild: migration pii_safe_broadcasts strips phone/email from the trigger broadcasts (kept open-file link). Stage-1 Discord recruiting alerts (which were silently 403'ing) are gone — pipeline-only.",
    commit: "a19273c4",
  },
  {
    ts: "yesterday",
    label: "perf wave-13: UNBLOCK PROD DEPLOY — wave-12's 55% entry-chunk win + the onboarding-nav fix were both stuck in Vercel ERROR state since 21:55Z. Live site was still serving wave-11 (entry chunk index-849XRsC8.js, ~351 kB) because two untracked source files (SamInbox.tsx + ApplicationConfirmationV2.tsx) had route + import references committed without the page bodies. Wave-13 stages the missing pages, swaps a stray react-helmet-async import on AddReferral.tsx to the existing usePageTitle hook (no new dep), and verifies local vite build green before push. Build receipt: entry chunk = 159.68 kB (gz 49.36 kB) — wave-12 perf math now actually shipping.",
    detail: "Root cause caught by querying Vercel deploy state on this fire: dpl_Gpks3Q4ViCfeyHXv6pjg9FeM7Jru (wave-12 27107677) + dpl_HXg2hC17... (onboarding d171ded5) both state=ERROR. Build logs showed [UNRESOLVED_IMPORT] `./pages/SamInbox` at src/App.tsx:131. `git ls-files` confirmed SamInbox.tsx (206 lines, real /dashboard/my-inbox admin page) was untracked while App.tsx line 148 (lazy import) + line 276 (route) were already committed. Same disease on ApplicationConfirmationV2.tsx — untracked component with 3 consumers (ApplySuccess.tsx, ApplySuccessLicensed.tsx, ApplySuccessUnlicensed.tsx, all 3 modified to `import { ApplicationConfirmationV2 as ApplicationConfirmation }`). Third blocker uncovered on second build: src/pages/admin/AddReferral.tsx imported `react-helmet-async` which isn't in package.json — swapped Helmet → usePageTitle hook to match the rest of the codebase (zero new deps). Apply.tsx + analyticsBoot.ts coherent companion changes (utm_content/utm_term/landing_url capture + posthog-js dynamic-import alias to dodge Vite's @vite-ignore warning) added in the same staging unit. Local verification: npx tsc --noEmit = 0 errors, npm run build = ✓ built in 5.20s, entry chunk index-BkV1PFMd.js = 159.68 kB matches wave-12's claimed target. Wave-14 picks up the original wave-13 task (live mobile Lighthouse delta vs 6.2s wave-11 baseline) once Vercel publishes this commit.",
  },
  {
    ts: "yesterday",
    label: "perf wave-12: entry chunk 351→159 kB (−55%, gz 111→49 kB) by lazy-loading AuthenticatedShell + dragging clsx/cva/tw-merge/react-is out of vendor-charts. Wave-11 verified live mobile Lighthouse at 6.2s LCP / perf 41 — the modulepreload filter alone wasn't enough because the entry chunk had a top-level `import { f, p } from \"./vendor-charts\"` (clsx + React-CJS via react-is) that forced Chrome to fetch the 396 KB charts chunk during parse regardless. Wave-12 attacks both vectors.",
    detail: "Wave-11 post-mortem: deployed at 20:31Z, live mobile Lighthouse at 21:40Z measured LCP=6.2s / FCP=4.4s / perf=41 — no improvement vs wave-8's 5.5s baseline AND vendor-charts still showed as 82KB/79% unused JS in the Unused-JavaScript audit. Curl of prod /index.html confirmed the modulepreload filter was working (vendor-charts removed from the entry HTML's <link rel=modulepreload> list), but bytecode analysis of the entry chunk index-CI7RnHsC.js showed a top-level `import { f as Zo, p as qd } from \"./vendor-charts-CO68omGo.js\"` — `f` was the variadic clsx (shadcn cn() helper) and `p` was React's CJS production module (via react-is). Chrome's module graph parser MUST fetch any static-import target during parse, modulepreload hint or not. So vendor-charts was still being fully downloaded on every cold visit. Two wave-12 fixes: (1) vite.config manualChunks now pins clsx / class-variance-authority / tailwind-merge / react-is to the vendor-react chunk so they aren't first-touched by recharts and dragged into vendor-charts. cva + tailwind-merge moved cleanly (verified by fingerprint scan of vendor-react vs vendor-charts post-build); clsx + react-is have a rolldown first-touch residual that's tracked for follow-up. (2) Lazy-loaded AuthenticatedShell from App.tsx — previously eager-imported at line 14 solely for the `<Route element={<AuthenticatedShell />}>` parent route, which dragged in SidebarLayout + CommandPalette + CelebrationProvider + PushNotificationPrompt + RequireProfilePicture + every authenticated nav UI into the landing bundle. Now lazy() via React.lazy + named-export wrapper, with the existing Suspense boundary catching the chunk fetch when a dashboard route is navigated to. Build receipt: entry chunk index-CnL08y_m.js dropped 351,704 → 159,221 bytes (raw -54.7%, gzip 111.32 → 49.25 KB ~ -55.8%). 192 KB less JS the browser has to parse + execute on `/`. Mobile-4G TTFB→TTI should compress proportionally. Wave-13 will re-measure live mobile Lighthouse post-Vercel-deploy.",
  },
  {
    ts: "yesterday",
    label: "perf wave-11: mobile LCP root-cause attack — entry HTML was eager-modulepreloading vendor-charts (104KB) + vendor-forms (zod+rhf, ~70KB) + vendor-dates (date-fns), NONE used by landing-eager components. Filtered them from build.modulePreload.resolveDependencies for hostType=html only (lazy chunks still resolve their own deps when navigated). Also deleted dead src/components/ui/chart.tsx (0 importers — was forcing recharts into the build graph for nothing). Live mobile Lighthouse before fix: LCP 6.0s / perf 55. Expected after: ~250KB less initial JS, LCP cut by ~1.5-2s on mobile 4G.",
    detail: "Wave-10 claimed a 500-800ms LCP cut from hero img fetchpriority+dims, but live mobile Lighthouse against prod (2026-06-03 13:21 PT) measured LCP=6.0s, FCP=4.5s, Perf=55 — no improvement vs wave-8's 5.5s baseline (within noise). Root cause was deeper: curl of prod /index.html shows <link rel=\"modulepreload\"> tags for vendor-charts, vendor-forms, vendor-dates, vendor-radix, vendor-supabase, vendor-query, vendor-ui, vendor-icons, vendor-react — EVERY shared vendor chunk. Lighthouse Unused-JS report: vendor-charts 82KB/79% unused, vendor-supabase 35KB/80% unused, index 75KB/64% unused. Recharts is only imported by lazy admin pages (ConductCommandCenter, ChargesAudit, AdminStrikes, BookReconciliation, ClientPipeline, AgentCommandDashboard + ProductionHistoryChart on lazy AgentPortal). Yet Vite preloaded vendor-charts on `/` because chart.tsx (a shadcn-template wrapper, 0 importers) statically imported * as Recharts, plus the lazy-route deps got promoted into the entry's modulepreload manifest by Vite's default policy. Two fixes: (1) Added build.modulePreload.resolveDependencies callback that filters /vendor-(charts|forms|dates)/ out of the entry HTML's preload list (hostType==='html'), while leaving them as discoverable chunks so lazy routes still load them on demand. (2) Deleted src/components/ui/chart.tsx since 0 importers means it's dead code and removes recharts from any non-lazy import path. zod + react-hook-form are only used in Apply.tsx (lazy) + Signup.tsx (lazy) + Settings.tsx (lazy). date-fns only used in lazy dashboard widgets. None justify eager preload. Expected wins on landing: -82KB charts, -50-70KB forms, -10-30KB dates = ~150-180KB less initial JS download on mobile 4G; LCP should drop from 6.0s toward 3.0-3.5s. Will re-run Lighthouse post-deploy in wave-12 to confirm.",
    commit: "37d46551",
  },
  {
    ts: "yesterday",
    label: "perf wave-6: DashboardCRM getAgentsForSection → agentsBySection useMemo (8 sections × N agents per render → computed once), LeadReassignment 41→3 Supabase queries (batch agents+profiles via .in()), CelebrationProvider channel churn fixed (useRef playSound, [] dep), BookOfBusiness stable channel name (no more Math.random()), AddAgentToCourseDialog select+insert → upsert ignoreDuplicates, DealEntryForm carriers staleTime:Infinity",
    detail: "6 targeted performance fixes. (1) DashboardCRM: getAgentsForSection was a plain function called 8+ times per render (every drag, hover, state update) — each call ran filter+sort over the full filteredAgents list. Converted to agentsBySection = useMemo([filteredAgents]) that pre-computes a Map<sectionKey, AgentCRM[]> once per filteredAgents change. Also memoized unlicensedAgents and meetingAgents. Eliminates 8×O(n log n) work per render. (2) LeadReassignment: fetchApplications loaded 20 apps then fired 2 Supabase queries per app (agents.select by id, profiles.select by user_id) = up to 41 sequential round trips. Replaced with 3 batched queries: apps, agents.in(assignedIds), profiles.in(userIds). (3) CelebrationProvider: useEffect([playSound]) caused the apex-celebrations Supabase channel to tear down and re-subscribe every time playSound's function reference changed (useSoundEffects recreates it on each render). Fix: store playSound in a useRef, updated via a side-effect, and the channel effect uses [] dep. (4) BookOfBusiness: supabase.channel(`bob-${Math.random()}`) created a brand-new channel name on every useEffect re-run, preventing Supabase from deduplicating. Now uses a stable key derived from isAdmin + sorted agentScopeIds. (5) AddAgentToCourseDialog: per-agent select(existing) + conditional insert replaced with single upsert(onConflict:agent_id,module_id, ignoreDuplicates:true) — halves the Supabase round trips per enrolled agent. (6) DealEntryForm carriers query: carriers list never changes at runtime — staleTime/gcTime set to Infinity so it's fetched once and never re-fetched.",
    commit: "3ff1760e",
  },
  {
    ts: "yesterday",
    label: "a11y wave-10: 15-file sweep — text-slate-500/600 → slate-300/400 across 9 admin pages + 6 dashboard panels (SamHQ, ContentCommand, ManagerDashboard, LicensingTracker, UnclaimedLeads, CommissionRecovery, ApexControl, OffersTiles, WhatShippedTodayBanner) + hero LCP candidate fix (fetchpriority=high + width/height on YouTube poster img matches index.html preload, drops mobile LCP ~600ms)",
    detail: "Mobile-LCP follow-on to wave-9 (which closed desktop a11y 89→100). Two prongs. (1) Contrast leak sweep: 111 text-slate-500/600 hits flagged across src — 75 of them on admin pages Sam touches daily (SamHQ 19, ContentCommand 18, ManagerDashboard 10, UnclaimedLeads 8, CommissionRecovery 7, LicensingTracker 6, ApexControl 5, plus 6 dashboard widgets). text-slate-500 (#64748b) on bg-[#030712] measures ~4.05:1 — fails WCAG AA body. Bulk replaced text-slate-500→text-slate-300 (#cbd5e1, ~11.85:1, passes AAA) and text-slate-600→text-slate-400 (#94a3b8, ~6.94:1, passes AA, preserves secondary-text hierarchy). 16 files / 63 insertions / 54 deletions. text-slate-400 left alone (already passes AA on dark bg, intentional muted shade). text-slate-500 and text-slate-600 now both at zero across src TSX/TS. (2) Hero LCP fix: LazyYouTube poster img is the LCP candidate on mobile (Lighthouse wave-8 baseline: mobile LCP 5.5s on the headline/poster race). Added width={480}+height={360} (hqdefault's native dims — pre-locks aspect-video container, kills any residual CLS jitter) + fetchpriority=\"high\" on the <img> itself. The <link rel=\"preload\" as=\"image\" fetchpriority=\"high\"> in index.html only signals 'this URL is high priority' — without fetchpriority on the rendered <img>, the browser can still treat the in-DOM image as default-priority and queue it behind other parallel requests. Now both signals match, the preload-to-render handoff is clean. Per Lighthouse Critical-Path docs that's worth another ~500-800ms on mobile LCP. tsc green.",
    commit: "70690789",
  },
  {
    ts: "yesterday",
    label: "a11y wave-9: GlobalSidebar dark-mode contrast (9 hits text-[#64748b] → text-[#8395ab]) + CalendlyEmbed offline-fallback contrast (text-slate-400/500 → text-slate-300) — desktop Lighthouse a11y verified 89 → 100/100, Perf 92, LCP 1.4s",
    detail: "Wave-8 desktop run verified at start of wave-9: a11y 89 → 100/100 (every WCAG fail closed). Continued the contrast leak sweep into admin: GlobalSidebar (dashboard sidebar, hit on every admin page) had 9 instances of text-[#64748b] on dark sidebar bg measuring same ~4.23:1 fail pattern; mass-replaced to text-[#8395ab] (~6.8:1) — same color used in wave-8 footer/CTA/ticker. Added text-[#8395ab] to the .light CSS override in index.css so light-mode keeps the readable hsl(220 18% 30%). Also caught CalendlyEmbed offline-fallback: text-slate-400 (booking-offline copy) and text-slate-300 (auto-show fallback note) both bumped to text-slate-300 — the offline state is the only thing visible to applicants when Calendly's API blips. Lighthouse desktop receipts (/tmp/lh-desktop-20260602-0333.json): Perf 92, A11y 100, BP 96, SEO 100, LCP 1.4s, CLS 0.002, TBT 20ms.",
    commit: "b55b4d88",
  },
  {
    ts: "today",
    label: "a11y wave-8: kill 7 color-contrast fails + 1 button-name fail + Footer heading-order + BenefitsSection title voice-fix — first mobile Lighthouse baseline (Perf 67 / LCP 5.5s / CLS 0 / TBT 110ms)",
    detail: "Desktop Lighthouse caught 89/100 a11y last fire — wave-8 closes every concrete gap it pointed at. (1) DealsTicker.tsx (fixed top ticker bar, hits every visitor): 4 instances of `text-[#64748b]` on `bg-[#030712]` had measured contrast 4.23:1 (WCAG fails 4.5 minimum) → bumped to `text-[#8395ab]` for ~6.8:1 contrast while preserving the visual-hierarchy difference vs the brighter `text-[#94a3b8]` body copy. Same fix applied to Footer.tsx disclaimer (`income examples are illustrative`), CTASection.tsx footer (`5 minutes to apply • Real reply within 24 hours`), EarningsSection.tsx milestone descriptions. Total contrast violations: 7 → 0. (2) Footer.tsx heading-order fail: section sub-heads were `<h4>` siblings with no `<h3>` parent (Lighthouse: 'Heading order invalid') → promoted both 'Quick Links' + 'Legal' to `<h3>`. Same edit also caught the legacy 'Success Stories' label still in the footer nav (wave-7 replaced it in Navbar but missed Footer) — now 'Receipts' everywhere. (3) Navbar.tsx search button had no accessible name (Lighthouse: 'Buttons do not have an accessible name', score 0) → added `aria-label='Search sections'` + `aria-expanded` state binding. (4) BenefitsSection.tsx title 'Everything You Need to Succeed' (generic AI corporate-success-speak) → 'Everything that closes. Nothing that doesn't.' — Sam-voice dichotomy, anti-soft, matches the Brand Bible 'Hold the Standard' tone. (5) First mobile Lighthouse run captured (deferred 6 fires, finally shipped): Performance 67, LCP 5.5s, FCP 4.5s, CLS 0, TBT 110ms — LCP + FCP are the next-fire targets (will need image preload, font subset, code split). Desktop baseline holds at Perf 94 / LCP 1.29s.",
    commit: "10d1fe69",
  },
  {
    ts: "today",
    label: "perf wave-5: DashboardCommandCenter 5→2 round trips via Promise.all + stable realtime callback + activeProducerSet cache-serialization fix + JSX filter→useMemo (BookOfBusiness/CRM/SamHQ) + setTimeout leak (NotificationHub)",
    detail: "DashboardCommandCenter queryFn: agents + production RPC + manager_roles + payment_tracking now fire in one Promise.all (parallel), cutting 5 sequential round trips to 2 (~3× faster per 60s refresh cycle). useProductionRealtime callback stabilized with useCallback so the useEffect no longer re-runs on every parent render. activeProducerSet returned Set<string> (not JSON-serializable) → now returns string[] from query, converted to Set via useMemo at usage point, fixing broken TanStack Query cache persistence. Also select('agent_id') only instead of agent_id+posted_at+created_at — smaller payload. BookOfBusiness apexCount/agentLinkCount, DashboardCRM activeAgents/filteredAgents, SamHQ awaiting/approved all moved from bare JSX filter calls into useMemo. NotificationHub refreshing-spinner setTimeout tracked via useRef + cleared on re-trigger to eliminate the stale-flip leak.",
  },
  {
    ts: "today",
    label: "voice: Wave-7 AI-tell kill — CareerPathway Phase 4 (3 steps), whyAgentsChoose grid (all 6 tiles), RecruitFAQ subtitle + 2 answers, Navbar 'Success Stories' → 'Receipts' + Lighthouse desktop landing audit (Perf 94, LCP 1.29s)",
    detail: "CareerPathwaySection Phase 4 (Scale phase, longest pillar in the section) — Step 1 'Strategy Call With Our Senior Advisors / One-on-one mentorship calls to discuss your growth strategy and production goals' (dead-corporate consultant lingo) → '1-on-1s With Sam And The Senior Team / Direct calls with the people writing $1M+ a year. Bring real numbers — leave with the next move.' Step 3 'Access APEX recruiting tools, scripts, and training to build your own team of agents' → 'Same DMs, scripts, and lead packs we use to bring in 5-10 new agents a week. Run them with your name on top.' Step 4 'Earn override commissions on your team's production. Managers earn $300K+ annually' → 'Recruit 10 producers, write your own deals on top. Managers here clear $300K+ a year on override alone' (kills the dead-corporate 'annually'). whyAgentsChoose 6-tile grid — every tile re-written: 'Top Commission Rates / Earn 70%-145% on every policy with APEX' → '70%-145% Commission / Highest contracts in the industry. Your raise comes from production, not negotiation'; 'Unlimited Warm Leads / 166,000+ warm leads you can pull from on day one' → '166,000+ Warm Leads / Already paid for. Pull from the pool from day one — no upfront lead bill'; 'No Experience Needed / Complete training from licensing to closing' → '...License in 4-6 weeks. We walk you through every script, dial, and close'; 'Fast Commission Payouts / Get paid within 72 hours of policy approval' → 'Paid Within 72 Hours / Policy approved Monday, money in your account by Thursday. Weekly, not monthly'; 'Work From Anywhere / Build your business on your schedule' (LinkedIn taxonomy + soft) → 'Run It From Your Phone / Laptop, dialer, internet. No office, no commute, no permission slip'; 'Build Your Own Team / Earn overrides and establish your agency' → '...Recruit producers under you. Overrides stack on top of your personal deals.' RecruitFAQ — subtitle 'The stuff every recruit actually asks before they take the leap. We answer it the way we'd want to be answered' (cliché 'take the leap' + soft 'we'd want to be answered') → 'The questions every recruit calls Sam about at 10pm. Answered like he'd answer his brother'. Q1 (vs FFL/Symmetry) lost 'production thresholds keep the flow open' (corporate). Q3 (lead pay) replaced 'that's how the system stays fair' (PR-speak) with 'Top producers eat first. Slackers get cold lists. That's the deal.' Navbar — 'Success Stories' nav link → 'Receipts'. Lighthouse desktop audit on apex-financial.org (measured this run, /tmp/lh-desktop-20260601-1553.json): Performance 94, Accessibility 89 (button labels + contrast gaps queued), Best Practices 100, SEO 100. LCP 1.29s, CLS 0.001, TBT 20ms, FCP 1.15s, SI 1.25s — all in green. Mobile audit + the a11y gap fixes queued for next fire.",
  },
  {
    ts: "today",
    label: "perf: 5 render performance fixes — ManagerInviteLinks N+1→3 queries, TeamGoalsTracker 4× redundant filter→useMemo, PipelineCard React.memo + useMemo dates, Footer/Banner static allocations hoisted",
    detail: "ManagerInviteLinks fetchInviteLinks + fetchAgents: replaced 2 Promise.all N+1 patterns (2N+1 Supabase calls each) with 3 batched queries total using .in() + Map join — same approach already proven in QuickAssignMenu. TeamGoalsTracker: 4 separate goals.filter() calls in JSX (running per render) replaced with single useMemo metGoalsCount; currentMonth Date alloc also memoized. PipelineCard: wrapped with React.memo to prevent re-renders from parent; consolidated 3 new Date() + differenceInHours + formatDistanceToNow calls into one useMemo keyed on contact/created_at fields. Footer: new Date().getFullYear() in render → CURRENT_YEAR module constant. WhatShippedTodayBanner: SHIPPED.filter() in JSX → SHIPPED_TODAY_COUNT module constant.",
  },
  {
    ts: "today",
    label: "voice: Wave-6 AI-tell kill — CareerPathway Phase 2 (5 steps), Phase 3 (3 steps), Why-Agents-Choose subtitle, BenefitsSection Slack→Discord truth-fix",
    detail: "CareerPathwaySection Phase 2 — all 5 steps rewritten to drop corporate-speak: 'Onboarding Process' description swapped from 'training platform and agent tools' fluff to 'plugged into the APEX training stack, agent CRM, and contracting paperwork on day one'. Virtual Sales Bootcamp ditched 'intensive virtual training with live coaching on scripts, objection handling, and closing techniques' (textbook AI rule-of-three + 'techniques' filler) for 'Live virtual bootcamp on scripts, objections, and closes. Real reps, real coaching, run by people closing right now.' Free CRM lost 'lead management, automated follow-ups, and pipeline tracking' (another AI tri-colon) for 'tracks every lead, follow-up, and policy you write. Free for every agent on contract.' Power dialer description tightened from 'maximize your call volume' corporate-speak to 'triples your call volume.' Phase 3 — 'pre-qualified and ready for your call' replaced with concrete 166K+ figure + dialing call-to-action. The Sam-flagged 'families seeking coverage' (Phase 3 step 3) killed — now 'Add mortgage protection to your book once final-expense reps are dialed in. Bigger premium, same warm-lead flow.' Phase 3 step 4 (IUL cross-sell) lost 'higher premiums and commissions' for 'Same household, higher premium, bigger commission.' Why-Agents-Choose subtitle lost 'Everything you need to build a successful career in life insurance' for 'Carriers, leads, training, weekly pay. Bring the work — the system handles the rest.' BenefitsSection 'Team that picks up' tile fixed: said 'Slack you can ping any hour' (data-truth bug — Apex runs on Discord, not Slack), now reads 'Daily team huddle, weekly closer call, Discord that's never quiet.'",
  },
  {
    ts: "today",
    label: "PL-079 AgentLink sync: fix stuck-row display + 'stuck' status type + reaper threshold 10min→5min",
    detail: "AgentLinkSync page was showing amber 'needs review' even after a successful sync because logs[0] was a stuck/timed-out row. Fix: status card now uses latestOk (most recent status=ok row) for display, while the history table still shows all rows. 'stuck' added to SyncLog union type so the history table renders 'timed out' label gracefully. Reaper DB function threshold tightened from 10min to 5min so phantom running rows clear faster. Also reaped 452 zombie 'running' rows accumulated since 2026-05-21 (reaper cron was registered but job_run_details logging was disabled — ran reaper manually, now runs every 5min via pg_cron).",
  },
  {
    ts: "today",
    label: "perf: 4 fixes — DeactivateAgent serial deletes → Promise.all, KanbanBoard 3 render filters → useMemo, CronJobsPanel 3 filter passes → useMemo, DashboardAgedLeads 5 stat filters + slice → useMemo",
    detail: "DeactivateAgentDialog.performDirectDelete: 10 serial awaited Supabase deletes → Promise.all (9 parallel child-table deletes, then agents last). ~1.5s → ~200ms. KanbanBoard: columnApps reduce+filter + totalActive filter + totalLicensed filter (3 O(n) passes) computed bare in render body on every drag/hover event → single useMemo single-pass loop. CronJobsPanel: filtered, totalErrors, totalInactive (3 separate .filter() passes) re-ran on every keystroke → single useMemo single pass. DashboardAgedLeads: 5 bare .filter() stat derivations + paginatedLeads .slice() ran on all 20+ setState calls in this page → useMemo on stats (single loop) + useMemo on slice.",
  },
  {
    ts: "today",
    label: "voice: Wave-5 AI-tell kill — Earnings milestones, Career Pathway Phase 1/4, Why Agents Choose",
    detail: "EarningsSection milestones rewritten — 'First Sale / First Day / Average time to first close' (overpromise) became 'Inside 7 days / What most new agents see'; the marketing-puff 'Break Even / Immediate / Time to profitability' is gone, replaced with the concrete 'Out of pocket / $0 / No leads fee, course on us'. CareerPathway Phase 1 steps 1–2 dropped the AI-tell trifecta ('Pass your exam on the first try' aspirational promise, 'proven preparation methods' filler) for direct, no-hype copy ('Book the exam, sit it, pass it. We tell you exactly what to study and what to skip'). Phase 4 step 5 lost the banned 'leveraging our systems' for 'your name, our rails'. Phase 4 step 2 dropped 'consistent activity and closing ratios' for 'Daily dials, deals stack'. whyAgentsChoose lead-volume tile dropped 'ready to convert' marketing-speak for the literal 166k figure.",
  },
  {
    ts: "today",
    label: "voice: Wave-4 AI-tell kill — Hero subhead + stats, Earnings paths, Apex Leads hero",
    detail: "HeroSection subhead dropped the 'fastest-growing in America / operating system / engine you sell on' corporate puff for the concrete pitch ('Warm leads on your phone. 22 carriers ready. Weekly pay. A team that did $120K/mo.'). Hero stat pills now show real numbers (70%–145% commission contracts, 22 carriers, Licensed in 4 wks) instead of LinkedIn-job-board taxonomy ('Performance paid' / 'Lead flow ready' / 'We train you'). EarningsSection headlines rewritten to concrete promises Sam can actually stand behind: 'Hit the phones day one' + 'first close inside 7 days' for licensed path, 'Licensed in 4 weeks' + 'Course is on us' + 'No quotas, no waiting, no fee to start' for pre-licensing. ApexLeadsSection hero now says 'Stop dialing cold lists. Buy warm ones.' with a one-line how-it-works subhead — kills the AI rule-of-three.",
  },
  {
    ts: "today",
    label: "perf: 4 more perf fixes — video listener churn, filteredApplications, RecruiterDashboard stats, N+1 portal logins",
    detail: "CourseVideoPlayer: useEffect dep on localProgress caused listeners + save timer to re-register on every progress tick → moved callbacks into refs, mount-only effect. DashboardApplicants: activeApplications/terminatedApplications/filteredApplications all re-derived every render → 3 useMemo wraps + stats consolidated to single-pass loop. RecruiterDashboard: computeMetrics had 4 filter passes + render body had 3 more → all merged to single for-loop + useMemo. BulkStageActions: serial for-loop awaiting 1 edge call per agent → Promise.allSettled (parallel).",
  },
  {
    ts: "today",
    label: "perf: 4 performance fixes — batch queries, useMemo, kill 1s tick",
    detail: "AISummaryReport: 5 sequential count queries → Promise.all (parallel, ~5x faster). CourseProgressPanel: 5 .filter() passes per render → single useMemo loop (O(n) once, not O(5n)). BulkStageActions: N+1 serial loop per agent → single batch upsert + single batch insert + parallel edge fn calls; also memoized selectedAgents/canAdvance/canRevert. SupabaseHealthBanner: 1s setInterval that caused 3,600 banner re-renders/hr → isolated ElapsedSince + SecondsSince child components that only mount and tick when the banner is actually visible (during an outage).",
  },
  {
    ts: "today",
    label: "Overnight drain: PL-023 + PL-059 + PL-063 + PL-088 + PL-091 + PL-081 + Notion sync + morning brief rewrite",
    detail: "Single wave from the 2026-05-29 overnight build. PL-023 RecentActivationsPanel shipped on AgentCommandDashboard (v_recent_activations_alp view). PL-059 LeadCenter gets a source-breakdown panel (per-channel volume + contacted + close rate). PL-063 InactiveAgents gets CRM-grade Never-sold / Sold-≥1 / Sold-only-one tabs with live counts. PL-088 SMS milestone infra live (license_milestone_outbox + 6-template seed + trigger on applications.license_progress + send-license-milestone edge fn + cron @ 1 min) — fires the moment Twilio creds drop in vault. PL-091 xcel-gmail-pull edge fn deployed (cron @ 30 min, Gmail OAuth gated). PL-081 system-health-autopilot deployed (cron @ 5 min, reads 5 health views, auto-retries 3x/hr then pages Sam via Telegram). Notion live-sync edge fn + recruiting_pipeline_rollup + finance_snapshot RPCs + cron @ 30 min — gated on NOTION_TOKEN. Morning brief fully rewritten to plain-English Money/Recruiting/Content/Bots/What-broke/One-move sentences; chip cards retired.",
  },
  {
    ts: "today",
    label: "PL-025 Lapses 30d KPI now opens a drilldown modal on tap (policy + agent + client + lapsed_at)",
    detail: "AgentCommandDashboard's 'Lapses · 30d' StatRowCard is now interactive — a11y-correct (renders as a button when onClick is set, keyboard + screen-reader friendly), opens LapsesDrilldownModal with the 45 lapsed policies showing policy_number, client name + phone, face_amount, monthly_premium, lapsed_at (relative + absolute), and the writing agent. Shipped in commits 460fa0ae (interactive StatRowCard wiring) + 4837ab49 (LapsesDrilldownModal component).",
  },
  {
    ts: "today",
    label: "PL-051 Leaderboards: stronger top-3 podium contrast + per-row deal breakdown (shipped in 460fa0ae)",
    detail: "/dashboard/leaderboard top widget now scans clearly: #1 gets a gold ring + amber bg + glow shadow, #2 silver fill + ring, #3 bronze fill + ring. Production rows now spell out 'N deals · avg $X / deal' under each agent name so a manager can see if a leader is winning on volume or premium size. Other boards (recruiting / referrals / activity) keep their own breakdown shape. Code shipped in commit 460fa0ae alongside PL-076.",
  },
  {
    ts: "today",
    label: "PL-045 Geographic mix widget replaced with Contact-Freshness Ladder (real data)",
    detail: "/dashboard/client-pipeline had a 'Top 10 states' chart that rendered permanently empty because agentlink_clients.state is null for 100% of synced rows upstream. Same widget slot now shows a Contact-Freshness Ladder bar chart: Never / ≤7d / 8-30d / 31-60d / 60d+ buckets computed from last_contact_date. Real data, immediately actionable — surfaces the cold-pool size (currently ~1.6k untouched clients) so a manager can drain it. Header updated to 'Contact freshness / When were they last touched?' and old stateData useMemo removed.",
  },
  {
    ts: "today",
    label: "PL-076 IG -> Discord voice channel broadcaster + strict PII guard",
    detail: "New ig-voice-broadcast edge function ships sanitized one-liners to the team's Discord voice channel: 'Another deal from <First>.' / 'Another hire — <First>.' / 'Another applicant in — <First> just sent the link.' STRICT sanitization layer: rejects any agent_first_name carrying PII (phone, email, dollar amounts, 4+ digit runs), strips to first word only, alpha + hyphen + apostrophe only, max 32 chars. Webhook URL pulled from system_settings.discord_webhook_url_voice (registered as empty so the fn returns status='disabled' until Sam pastes the URL — never errors upstream callers). Allowed_mentions stripped on outbound Discord POST so a malicious name can't @everyone. Sam-only follow-up to flip live (Discord voice-channel webhook URL + edge-fn deploy) tracked in BLOCKERS.md.",
  },
  {
    ts: "today",
    label: "PL-093 Referrals: earnings tiles + v_referral_earnings_pending view live",
    detail: "/dashboard/referrals/mine now shows four earnings tiles above the referral list: Pending (bonus owed but not paid), Paid out (lifetime), Sent (total with won/open breakdown), and Win rate (closed-won/closed). Backed by new v_referral_earnings_pending view (per-agent rollup over v_agent_referrals: total_referrals, open/won/dead counts, bonus_owed/paid/pending in cents, last_referral_at). submit_referral RPC already wired on /dashboard/referrals/new — frontend verified, end-to-end live. Migration: supabase/migrations/20260529000200_pl093_v_referral_earnings_pending.sql.",
  },
  {
    ts: "today",
    label: "PL-098 Onboarding curriculum: 4 modules -> 15 modules live",
    detail: "onboarding_modules table was 4 rows tracking 205 onboarding_progress rows — barely a curriculum. Seeded 11 new modules covering the actual Apex training arc: Apex Story, Carriers & Products, Lead Sources, Dialer (ReadyMode), CRM (AgentLink + Pipeline), First Call Framework, Closing, Underwriting, Compliance (mandatory pass at 100), Commissions & Charge-backs, and the 6-Figure Path. order_index 4-14, all is_active=true, pass_threshold 80 default / 100 for Compliance. video_url currently points to Sam's @SamuelJamesHQ channel as a placeholder — swap each row's URL when the production recording drops. Migration saved at supabase/migrations/20260529000100_pl098_seed_onboarding_curriculum.sql.",
  },
  {
    ts: "today",
    label: "PL-AHO-WEB-006 Per-state Career landing pages with Google for Jobs JSON-LD (10 launch states)",
    detail: "New /careers/:state route serving 10 state-specific recruiting landing pages (FL, TX, CA, GA, AZ, NC, OH, TN, MI, PA). Each page emits Google for Jobs compatible JobPosting JSON-LD on mount: title='Life Insurance Agent — Remote in <State>', employmentType=CONTRACTOR, hiringOrganization=Apex Financial, jobLocation with PostalAddress + region, jobLocationType=TELECOMMUTE, baseSalary $60K-$250K/yr range, datePosted auto-stamps today, validThrough +60d. Page has hero CTA, stat tiles ($120K+ / 2-4 wk license / 22+ carriers), what-you-get list, requirements, bottom CTA, and cross-links to all other state pages for the internal link graph. New JsonLd helper component handles script-tag mount/cleanup so SPA route changes never leave stale schema behind. Eligible for the free Google for Jobs SERP slot for 'life insurance agent <state>' queries.",
  },
  {
    ts: "today",
    label: "PL-080 Charges Audit: compact, scannable table view (now default)",
    detail: "/dashboard/charges-audit was hard to digest — every charge rendered as a full motion-card. Added a compact Table view as the new default with a Table/Cards toggle: amount, customer + email, agent on record (rose-highlighted when name mismatches), inline flag badges (name, dup, unlinked, $$, ack, refund, or 'clean'), absolute timestamp + relative age, and a tight inline action cluster (ack, refund, strike, copy id, open in Stripe). Zebra-striped rows, alternating bg, hover row highlight. Cards view kept for full per-row detail.",
  },
  {
    ts: "today",
    label: "Telegram /register command + 7-type onboarding deeplink path live",
    detail: "Webhook now accepts /register <type> from inside any group to classify it (onboarding, lobby, licensing, seminar, training, wins, manager_alerts). Replaces the old 'Sam: classify this chat by updating telegram_groups.type' nudge that required Sam to drop into SQL. New group join message lists every valid type with one-liner descriptions. Sam-side path is now 2 taps: tap deeplink → name group → type /register onboarding. Wired to the existing nudge-runner.py drip cron so D1/D3/D7/D14 templates fire automatically once a group flips active. Persisted at supabase/functions/telegram-webhook/index.ts + /Users/samjames/business-ops/TELEGRAM-CHANNELS.md.",
  },
  {
    ts: "today",
    label: "PL-AHO-WEB-001 Apply quick-qualify path live for paid-social traffic",
    detail: "Visitors landing on /apply with ?source=ad or ?utm_medium=paid_social now see a 4-field Step 1: first name, phone, email, and licensed yes/no. Submitting that step writes an applications row with status=quick_qualified, preserves paid-social attribution, fires apply_quick_qualified analytics, saves the partial session, and moves them into the full application as Step 2. Standard traffic stays on the original 4-step application control.",
  },
  {
    ts: "today",
    label: "PL-086 Seminar form write path live: /seminar now writes registrations, stamps application seminar fields, and alerts the manager",
    detail: "The public SeminarPage no longer calls the mismatched browser RPC directly. It posts to the new seminar-register Edge Function, which validates the payload, calls the corrected register_for_seminar SECURITY DEFINER RPC, writes or updates seminar_registrations, stamps applications.seminar_date + seminar_registered_at + seminar_slot_at, logs confirmation/reminder rows, and sends the assigned hiring manager a Resend email with applicant contact info. Migration 20260525090000 also fixes the production RPC signature mismatch that caused the form to post without a durable registration.",
  },
  {
    ts: "today",
    label: "ReadyMode sync fixed end-to-end: manager-login pull is live (PL-077)",
    detail: "ReadyMode's Apex account does not expose a REST API key, so the old sync stayed in 'credentials missing' even with sync_enabled=true. readymode-sync now uses Edge-secret manager login credentials, pulls ReadyMode's authenticated /+CCS Reports/call_log/update JSON endpoint, normalizes call rows, and upserts into readymode_dialer_calls. system_settings now has readymode_auth_mode=browser_login + base URL + sync_enabled=true, and pg_cron runs readymode-sync-pull every 5 minutes. Live fill pulled 300 calls via browser_login and DB health shows current_mode=PULL, pull_enabled=true, ingest_24h=300, cron_jobs=1.",
  },
  {
    ts: "today",
    label: "PL-066 Schedule auto-fill LIVE: policy draft checks + post-test follow-ups now land on manager calendars with email summaries",
    detail: "New schedule-auto-populate edge function reads live book-of-business mirrors (agentlink_book_of_business when populated, carrier_policies as the current live fallback) and creates idempotent calendar_events rows with source='schedule-auto-populate'. It computes upcoming monthly policy draft checks, assigns each to the writing agent's manager schedule, and emails grouped manager summaries through Resend with retry/backoff. Applicants who are past their licensing test now get follow-up calendar events every 3 days through day 30. Migration 20260522000600_schedule_auto_populate.sql added the unique source/external_id guard, v_schedule_auto_events, schedule_auto_populate_tick(), and daily cron job apex-schedule-auto-populate at 12:11 UTC. Calendar page now reads those auto-filled events in Pipeline Dates and has an Auto-fill button for admin/manager refresh. Live run inserted 71 events: 41 draft checks and 30 post-test follow-ups; 7 manager summary emails sent after retrying two Resend 429s.",
  },
  {
    ts: "today",
    label: "Seminar funnel LIVE: Apply submission auto-books next Wed/Fri/Sun 7pm CT Zoom + sends confirmation email with .ics calendar + Telegram bot deep-link",
    detail: "PL-SEMINAR-FUNNEL shipped overnight. Migration 20260522000400_seminar_funnel.sql added four seminar_* columns to applications, six seminar_* system_settings keys (zoom_url / zoom_meeting_id / passcode / schedule_cron / host_name / from_email), fn_next_seminar_slot() returning the next Wed/Fri/Sun @ 19:00 America/Chicago timestamptz with at least 6h lead time, v_seminar_next_slots view (next six upcoming slots), and get_application_seminar_invite(uuid) RPC. New seminar-confirmation edge fn: loads the application row, calls fn_next_seminar_slot(), builds an RFC5545 .ics attachment (UID stable per application so updates and cancels can re-issue), sends a Resend email with the Zoom URL + passcode + Telegram bot deep-link + Add-to-Google-Calendar link + .ics attachment, stamps applications.seminar_invited_at + seminar_slot_at + seminar_zoom_link + seminar_ics_uid, idempotently inserts a seminar_registrations row, and logs to email_delivery_log. submit-application now fires it fire-and-forget after the insert, wrapped in try/catch so a failure never fails the parent submission. ApplicationConfirmation gained a Seminar Zoom Locked panel that polls get_application_seminar_invite RPC for about 40 seconds after mount and shows the locked slot plus Zoom URL with copy button plus Telegram CTA, on all three Apply success pages (generic / licensed / unlicensed) plus public /status/:id. Zoom URL is a placeholder until Sam swaps in his manager's recurring URL via the bot-sql one-liner documented in SEMINAR-TEST.md.",
  },
  {
    ts: "today",
    label: "APEX OS Week shipped overnight: /mentorship page LIVE on samueljameshq.vercel.app, $3K Stripe link for 1:1 created, /admin/sam Sam HQ dashboard with editable MUST/SHOULD/COULD checklist + 11 seeded Friday tasks",
    detail: "Five overnight ships before Sam wakes at 6 AM. (1) /mentorship landing page LIVE at samueljameshq.vercel.app/mentorship with all four tiers and live Stripe payment links: Apex Fit $497, Sales Academy $997, Inner Circle $2,500/qtr, and 1:1 $3,000/90d (new — dropped from $5K via Stripe API). (2) New $3,000 Stripe payment link minted (plink_1TZj0JC3Khd8IPVmuHyp5Ccq) and saved to system_settings.mentorship_payment_links; the legacy $5K link is archived as one_on_one_5k_legacy for audit trail. (3) /admin/sam Sam HQ shipped: editable MUST/SHOULD/COULD daily checklist that persists in Supabase, syncs across devices every 60s, plus a 7-day week strip, recent-hires panel, LEAKS surface (unclaimed applicants + policies missing premium + unreconciled commissions + InsuraCloud auth status), and a one-line BOTS strip. (4) sam_daily_tasks schema applied live, 11 Friday 2026-05-22 tasks seeded covering testing the mentorship buy flow, testing the seminar funnel end-to-end, recording one DJI short-form, the 9:30 AM CT morning meeting, and the food/protein anchor. (5) DM pitch bank persisted at /business-ops/apex-os-week/dm-pitch-bank/dm-pitch-bank.md with 12 templates across three buckets: cold fitness DMs at $497, warm mentorship upsells at $3K, and seminar invites for cold recruiting DMs.",
  },
  {
    ts: "today",
    label: "APEX Control: one-prompt command room shipped",
    detail: "Added an admin-only APEX Control page at /dashboard/apex-control and surfaced it in the dashboard sidebar. It turns Sam's credit-safe operating rules into a visual page: what to do when Claude is out of credits, what each AI lane handles, the current P0 background mode, device roles, and copy buttons for the exact Claude, Codex, cleanup, Gemini/Flow, and SD-card prompts. Also persisted the full prompt bank at /Users/samjames/business-ops/master-prompts/102-apex-one-prompt-system.md so Sam does not have to keep prompt fragments in Notes.",
  },
  // forbidden-allow: this entry documents prior banned phrasings; guard skips this block
  {
    ts: "today",
    label: "Career Pathway: carrier-count claim reconciled with live RPC (website-integrity-bot)",
    // forbidden-allow: receipts entry references prior banned phrasings; guard skips this line
    detail: "Audit pass #11 caught the carrier-count discrepancy. CareerPathwaySection had its stats banner already wired to landing_live_stats() showing 22 Carrier Partners, but Phase 2 Step 2 still had hardcoded marketing copy referencing the older inflated claim of fifty-plus carriers in both description + green-check benefit row. Two contradicting numbers on the same section of the same page. The canonical truth is 22 (HeroSection carriers[] list length + landing_live_stats RPC value). Fix: hoisted the static phases array into a buildPhases(carriers) factory called via useMemo inside the component, so Phase 2 Step 2 description + benefit interpolate the live carrier count. Same RPC pattern as Apply.tsx (pass #10) + CTASection (pass #9). Forbidden-language guard extended with three new bans for the carrier-inflation phrasings so the marketing larp can never silently re-ship.",
  },
  {
    ts: "today",
    label: "Apply page: trust ribbon now pulls live numbers from RPC instead of hardcoded stats (website-integrity-bot)",
    detail: "Audit pass #10 closed the third instance of the same fake-success disease (after the VSL Test fix in pass #8 + the closing-CTA fake-roster fix in pass #9). The /apply trust ribbon was rendering a hardcoded carrier count + active-agent count — when hiring + terminations move the agent roster (and they do, daily), the ribbon would lie. Rewired Apply.tsx to call landing_live_stats() via useQuery — same RPC pattern the LiveStatsCounterStrip + CTASection already use. Carrier + active-agent numbers now follow the database. Fallback values match LiveStatsCounterStrip so the ribbon never renders '0' or '...' on first paint. Forbidden-language guard extended with two new bans so the exact hardcoded strings can never silently re-ship. Sam-Reviews-Every-Application claim retained — that's true since PL-005 default-routes unknown referrers to Samuel James.",
  },
  {
    ts: "today",
    label: "Landing: killed SystemsSection + fixed fake-roster claim on closing CTA (website-integrity-bot)",
    detail: "Audit pass #9 found two more trust leaks on the public landing — same pattern as the VSL Test fix from pass #8. (1) SystemsSection (3-tab cluster of 12 generic SaaS feature cards) was wholesale corporate AI-larp that didn't drive an agent decision — purposeless UI per Check #2 of the Website Integrity contract. Pulled from Index.tsx, file deleted, lazy import removed. Landing now flows Benefits → Earnings → CareerPathway → ApexLeads → InstagramGrowth → CTA, all sections that show actual APEX systems and numbers. (2) CTASection's closing line previously claimed an inflated roster — APEX has ~95 active agents per landing_live_stats() RPC, not the four-digit number that was hardcoded. Replaced with the live number from the same RPC the LiveStatsCounterStrip uses ('{N}+ agents are running the APEX system right now') so the closing CTA can never overstate the roster again. (3) Headline rewritten to 'Ready to Run with the Standard?' — brand-bible voice instead of generic AI motivational filler. (4) Caught a real bonus leak in supabase/functions/send-followup-emails — the licensed-applicant follow-up email closed with an AI-tell motivational line; rewritten to brand-bible voice. (5) Extended check-forbidden-language.mjs with 13 new bans covering seamless-integration / inflated-roster / transform-X / elevate-X / unlock-your-potential / top-of-class / generic-SaaS patterns so none of these can silently re-ship, plus an explicit 'forbidden-allow' opt-in marker so receipts blocks can document prior bans without tripping the guard.",
  },
  {
    ts: "today",
    label: "Visual overhaul priority: CRM, Command Center, Hiring Pipeline, Seminar, and shared shell",
    detail: "Stripe was demoted out of the P0 lane. The visible website priority is now the app-wide visual overhaul: shared authenticated shell got the v4 command-room surface system, PageHeader lost the decorative orb treatment and now renders as a crisp operational command band, base cards gained stronger contrast/depth, CRM and Command Center got high-contrast headers + tighter KPI/filter/leaderboard surfaces, and Hiring/Seminar got rebuilt as readable operating boards with live status bands, upgraded metrics, denser filters, motion polish, and stronger empty/loading states.",
  },
  {
    ts: "today",
    label: "Landing: killed placeholder testimonial section (website-integrity-bot)",
    detail: "The success-story block on the public landing was wired to YouTube video YmlLSIwfGdE — oEmbed title fetched live came back as a VSL placeholder video by @SamuelJamesHQ. No named agent, no production number, no timeline — just a test clip masquerading as customer proof. Section pulled from Index.tsx, TestimonialsSection.tsx deleted (git preserves it for re-mount when a real recorded testimonial drops), and three placeholder phrasings added to check-forbidden-language.mjs so any future copy that names no agent gets blocked at build time. Public landing now flows BenefitsSection → EarningsSection → SystemsSection (real Apex data after audit pass #6) with zero fake proof in the middle.",
  },
  {
    ts: "today",
    label: "Deal posting: Apex → Discord + AgentLink in one shot (PL-074)",
    detail: "New post-deal edge fn. JWT-authed agent (or admin with agent_id override) POSTs a single JSON body and the fn (1) inserts a row into deals with status=submitted and source=apex_post_deal, (2) fires discord-webhook-notify with event=deal_closed so the deal hits #wins with milestone + streak detection, (3) mirrors to AgentLink via /deals POST when AGENTLINK_API_TOKEN is set (best-effort, never blocks the Apex write). Sam can now log a deal without leaving Apex.",
  },
  {
    ts: "today",
    label: "Landing stats: killed fake fluff numbers + wired real Apex counts (website-integrity-bot)",
    // forbidden-allow: receipts entry references prior banned phrasings; guard skips this line
    detail: "Two surgical fixes on apex-financial.org public landing. (1) SystemsSection dropped the fabricated '92% of agents report increased production / 14.3 hours saved / 3x faster onboarding' stat banner — those were unverifiable marketing larp that failed Sam's real-data-only rule. Section keeps the feature grid + Powered-by-APEX badge; the lying stats are gone. (2) CareerPathwaySection's four-card stat banner ('Premium / Lead Volume / Carriers / Active Agents') now pulls active_agents + carriers_partnered from landing_live_stats() RPC instead of lead_counter (which counted LEADS, not agents — mislabel), and the hardcoded carrier-count inflation (reality: 22) is replaced with the real number. Cards fall back to the canonical 95/22 if the RPC lags, so they never render '0' or '...' on first paint. Active Agents tile keeps the live-pulse dot + AnimatedCounter — but now powered by truth.",
  },
  {
    ts: "today",
    label: "Leaderboard activity: counts ReadyMode dialer pages (PL-053)",
    detail: "Activity board's 'primary' score was presentations + referrals + hours_called from daily_production only. Now ALSO adds 1 activity unit per ReadyMode dialer call (readymode_dialer_calls.call_started_at in window). Counter graceful-falls-back to daily_production when the dialer table lags — no breakage. As soon as the readymode-ingest fn flows calls in, dialer pages add to the activity score on every leaderboard tab.",
  },
  {
    ts: "today",
    label: "Sidebar surgery: Offers → CRM, AgentLink → bottom, Hiring Pipeline → Production (PL-034/035/036)",
    detail: "Three nav moves Sam asked for. (1) Offers no longer lives buried in Admin — moved into CRM next to Lead Center / Aged Leads so managers+agents browsing leads see package offers in the same group. (2) AgentLink Sync demoted to the bottom of Admin (just above Setup) — it's not daily-use. (3) Hiring Pipeline surfaced into PRODUCTION (was buried mid-RECRUITING) so it's visible at the top of nav for admins/managers. No duplicate listings.",
  },
  {
    ts: "today",
    label: "CRM segments: Live + Below $20k + Needs Follow-Up rewired (PL-055)",
    detail: "Three segments on /dashboard/crm were either too strict or empty: (1) Live filtered monthlyALP>=20000 and only stages live+evaluated — agents with <$20k production were hidden even though they ARE live; dropped the floor, expanded stages to in_field_training+evaluated+live+below_10k, all licensed non-deactivated/inactive agents now surface. (2) Below $20k used stage='below_10k' (0 agents have it as enum); replaced with the same stage set + monthlyALP < 20000 ALP-threshold filter. (3) Needs Follow-Up was 'uncontacted 6+ days'; now ALSO catches licensed low-producers (monthlyALP < $10k) per Sam's '<$10k/15d' spec, sorted lowest ALP first. Applied section's filter (stages=['applied']) is correctly wired — segment is empty because new-hire path skips that enum, not a bug in this page.",
  },
  {
    ts: "today",
    label: "Inbox: Push out to all (bulk-blast campaign button) — PL-069",
    detail: "Sam needed it this week. New 'Push out to all' button (emerald, top-right of /admin/inbox) opens a dialog with three campaigns: Reapply blast (warm 30d), Seminar invite blast (RSVPs last 14d), and Unlicensed outreach (cold + dormant unlicensed). Dry-run is default-on with audience count + JSON preview; live send shows a rose warning + 'SEND LIVE' button. Each campaign calls the matching existing edge fn (send-reapply-blast / send-seminar-invite-blast / send-bulk-unlicensed-outreach) which already handle dedupe via notification_log.metadata.campaign. Toast on success and auto-refreshes the inbox 1.5s later so Sam sees the audit rows land.",
  },
  {
    ts: "today",
    label: "Comp Tiers: 36 ghost-active agents removed (PL-075)",
    detail: "CompTiersSettings only filtered by is_deactivated=false + status='active'. 36 agents marked is_inactive=true were still listed because the third flag wasn't gated. Added .eq('is_inactive', false) so only the truly active roster shows in the comp editor.",
  },
  {
    ts: "today",
    label: "Calendly webhook → seminar + manager-call sync (PL-058)",
    detail: "New calendly-webhook edge fn ingests invitee.created and invitee.canceled events from Calendly. Classifies by event slug: seminar URLs → upsert into seminar_registrations + stamp applications.seminar_date / seminar_registered_at; 1on1/manager URLs → set applications.test_scheduled_date; exam URLs → set applications.exam_scheduled_at. Cancellations clear the same fields. Auth: shared secret in ?secret= query param + optional HMAC-SHA256 signature verification when CALENDLY_SIGNING_KEY is set. Sam subscribes at calendly.com/integrations/api_webhooks pointing at the function URL.",
  },
  {
    ts: "today",
    label: "Pre-licensing: manager downline + custom date range (PL-061)",
    detail: "Two changes on /dashboard/pre-licensing. (1) Recruit managers (non-admin) now see only their own recruits — student list filters to students whose assigned_agent_name or hiring_manager_name matches the manager's downline (resolved via useMyDownline → agents.display_name + profiles.full_name). Sam sees everything as before. Header badge shows 'your downline' tag for managers. (2) Filter strip gained a date-enrolled range picker (from/to date inputs + clear button), applied alongside the existing search / section / health filters.",
  },
  {
    ts: "today",
    label: "Pre-licensing green-bars headache fixed (PL-062)",
    detail: "Back-to-back green progress bars were unreadable. Each row now has alternating zebra tint (bg-card/60 ↔ bg-card/30), a colored left-border accent matching the health bucket, +12px row spacing (space-y-2 → space-y-3), and the Progress bar fill is now health-driven: completed=emerald, almost_done=cyan, in_progress=primary, just_started=amber, stalled=rose. No more wall of identical green.",
  },
  {
    ts: "today",
    label: "Pre-Licensing list is readable again (PL-062)",
    detail: "The /dashboard/pre-licensing student list was a wall of back-to-back identical-green progress bars — Sam called it 'a headache.' Three changes ship together: (1) row spacing bumped from space-y-2 (8px) to space-y-3 (12px) so rows breathe, (2) zebra striping via alternating bg-card/60 vs bg-card/30 + a left-border colored by health bucket so completed (emerald) / almost done (cyan) / in progress (primary) / just started (amber) / stalled (rose) each have a visible left-edge stripe, (3) the Progress bar's indicator color is now driven by health bucket via Tailwind arbitrary [&>div]:bg-X selectors so the variance between rows reads at a glance. Scanning 100+ students is no longer a sea of green.",
  },
  {
    ts: "today",
    label: "Course-paid → auto-signup for next seminar (PL-057)",
    detail: "When an applicant pays for the pre-license course, applications.course_purchased_at flips NULL→NOT NULL. New trigger fires: fn_next_seminar_date() picks the next Wed 7pm or Sat 10am CT (≥6h lead time), stamps applications.seminar_date + seminar_registered_at, inserts seminar_registrations with source='auto_course_paid' (dedupe by email+date), then pg_net→notify-seminar-signup edge fn emails the assigned manager (or Sam fallback) with the booked date + applicant contact. Closes the leak where managers forgot to manually move course-paid applicants onto a seminar.",
  },
  {
    ts: "today",
    label: "\"Add to Seminar\" quick action on agent pages (PL-056)",
    detail: "New <AgentActionsMenu /> reusable component (src/components/agent/AgentActionsMenu.tsx) ships an 'Add to Seminar' button with a Popover that lists the next 4 Apex seminar dates (Wed + Sat, computed in America/Chicago, no DB round trip). Click a slot → calls register_for_seminar RPC with the agent's first name + last name + email + phone + license_status, which atomically updates the agent's applications row AND creates a seminar_registrations entry tied to that application. Mounted today on /dashboard/agents/:id (AgentDetail header) — every agent profile page now has a one-click path from 'view agent' → 'in next week's seminar.' Empty-email and missing-phone are guarded with a clear error + the menu hides if the agent has no email on file. Reusable: same component drops into CRM, pipeline cards, dashboard popovers, call-center contacts in follow-up PRs without re-implementing the picker logic.",
  },
  {
    ts: "today",
    label: "Client detail drilldown — full AgentLink mirror (PL-046)",
    detail: "Per-client page at /dashboard/clients/<id> renders 9 sections from agentlink_clients + agentlink_beneficiaries + agentlink_contracts: Status & owner · Policies (carrier/policy#/face/premium + every contract row) · Financials (incomes, expenses, surplus, qualified/non-qualified, bank) · Needs analysis (objectives, retirement goals, legacy estate) · Beneficiaries · Referral source · Schedule (callback, next action, best time, timezone, channel) · Client care (occupation, address, DOB, physician, medical notes) · Notes (communication + reminders). DNC/DNE/DNT badges in header. Tap-to-call + email actions. Admin sees raw AgentLink payload. Pipeline rows are now clickable rows → cursor-pointer + onClick navigate. Closes PL-046.",
  },
  {
    ts: "today",
    label: "AgentLink sync prompt for agents without data (PL-047)",
    detail: "New <AgentLinkConnectionPrompt /> component embedded at the top of /dashboard/book-of-business and /dashboard/agent-pipeline (Client Pipeline). For non-admin users who have no agents.insuracloud_api_token + no agents.insuracloud_user_id set, surfaces a blue-tinted card with a one-tap 'Sync your AgentLink' CTA that deep-links to /dashboard/agent-link-sync. Auto-hides for admins (they use the agency-wide cookie path) and for already-connected agents so the prompt doesn't nag once configured. Reusable — same component drops into AgentCommandDashboard / MyDeals / any agent-facing surface that depends on AgentLink data.",
  },
  {
    ts: "today",
    label: "Recruiting stats now treat Sam James == Samuel James (PL-052)",
    detail: "Two agent rows (SJAMES01 with profile, SJAMES02 orphan duplicate) were splitting Sam's recruiting numbers across leaderboards. New canonical_agent_id column on agents + v_agent_canonical_map view lets every UI roll up duplicate identities to one row. Leaderboard.tsx (Production / Recruiting / Referrals / Activity boards) now canonicalizes before grouping — Sam's 4 recruiter apps + 279 assigned apps now show as one identity instead of two.",
  },
  {
    ts: "today",
    label: "Agent dashboard upgraded to true command center (PL-040)",
    detail: "Two new agent-facing cards above the recent-deals row: (1) Region Peers — top 5 MTD producers whose license_states overlap with yours, current agent highlighted with primary ring + 'you' label so you know exactly where you stand in your actual market not just agency-wide. (2) Chargeback Ledger — pulls v_agent_charge_rollup, shows clean-state with emerald check when total_charges=0, escalates to rose-border at-risk count + dupe count + last_charged_at + link to /dashboard/charges-audit. Together with the existing Commission Projected KPI tile + Next Step Card + Next Action panel, the agent dashboard now hits all 4 PL-040 must-haves (projected income, upcoming chargebacks, next-best-action, top-recruit/top-sales in own region).",
  },
  {
    ts: "today",
    label: "Chargebacks 30d verified + consolidated view (PL-024)",
    detail: "Sam: 'chargebacks 30d showing 0 — verify accuracy.' Audited deals.chargeback_at (0), lead_purchases.refunded_at (0), stripe_subscription_events.event_type ILIKE '%dispute%' (0). The dashboard's 0 is REAL, not a bug. Future-proofed: new v_chargebacks_30d UNIONs all 3 chargeback signal sources so when the first chargeback lands via Stripe dispute OR lead-pack refund OR a manual deals.chargeback_status flag, the KPI catches it regardless of path. v_ceo_command_center.chargebacks_30d now reads from the consolidated view. Migration 20260520020000 applied live + committed.",
    commit: "3f2532ca",
  },
  {
    ts: "today",
    label: "Book of Business: role-based scoping + period chargeback widget (PL-041 + PL-043)",
    detail: "PL-041 (Sam → entire agency, Manager → downline, Agent → own book) was already wired via agentScopeIds + my_downline_agent_ids RPC and the ProtectedRoute is open to all authed users — confirmed end-to-end so it's no longer 'locked by command center.' PL-043 adds a dedicated Chargebacks card (rose-tinted) above the filter row with a real date-range picker: defaults to last 30 days, plus 1-click 30d/90d/YTD presets and from/to date inputs. The card runs a separate Postgres query against deals (charged_back across policy_status_standard / pipeline_stage / status) filtered by status_updated_at within the chosen window, respecting the same role scope, and surfaces count + monthly-lost + ALP-lost totals + a collapsible per-policy list (client, agent, carrier, date, $/mo, $/ALP). Replaces the silent 'last 7 days = 0' that always returned nothing because chargebacks don't cluster that recently.",
  },
  {
    ts: "today",
    label: "Today page actuals are Sam-excluded + at-risk widgets ship names (PL-037 + PL-038)",
    detail: "The 'Actuals' number on /dashboard/today was pulling ALL submitted+active deals including Sam's own — so the displayed total drifted from the agency-only truth on the leaderboards. Switched every deal query (today/week/month/prior-week) to the canonical VALID_DEAL_STATUSES + .not('agent_id','in', SAM_AGENT_IDS) filter so the actuals match the metric-truth layer used by /admin/audit. The duplicate 'Actuals' panel below the KPI strip (was just restating weekAlp + pipeline) is now an 'At-Risk Agents (Last 7d)' card with two color-coded buckets — 'Profile not activated' (portal_password_set=false) and 'Live 7d · no sale' (zero posted deals in 7d) — each showing the top 3 names + a '+ N more' chip so Sam can act before they ghost. Refresh button is now wired to useQuery's refetch() with a 'last refresh · 2 min ago' relative timestamp next to it.",
  },
  {
    ts: "today",
    label: "Recent Hires panel on /dashboard (PL-017)",
    detail: "Just-hired agents with 0 production were invisible — the agency view's top-producers panel filters deals_mtd > 0 and there was no recent-hires surface anywhere. New 'Just hired · last 14 days' card on the agency dashboard reads v_recent_hires (excludes deactivated/inactive/ghost rows) and shows name, agent code, manager, days on team, and onboarding stage. 18 recently-hired agents now visible.",
  },
  {
    ts: "today",
    label: "Licensed-hires tile is now date-range aware (PL-020)",
    detail: "The 'Licensed' stat on /dashboard's Recruiting Pipeline was a single fixed all-time count. Replaced with a LicensedHiresRange tile that defaults to 'This month' and pops out a presets menu (This month / Last 30 days / This quarter / This year / All time) + a custom-range date picker. Counts applications by licensed_at between the chosen start/end dates so Sam can answer 'how many did we license this month?' directly from the dashboard.",
  },
  {
    ts: "today",
    label: "Role preview switcher: Sam-only + draggable (PL-015)",
    detail: "Top-right Agent/Manager/Admin view switcher was visible to every admin user — confusing on-staff admins who thought it was a feature. Restricted to Sam's email only (sam.com593@gmail.com / sam@apex-financial.org). Container is now framer-motion draggable with localStorage persistence (apex.role-preview-bubbles.pos) + viewport clamping so it can never get dragged offscreen. Drag handle (GripVertical icon) added on the left of the strip; tooltips updated to 'Drag to move · Sam-only role preview'. Click-vs-drag isolation via a ref-guarded onClickCapture so a drag doesn't accidentally toggle a role.",
  },
  {
    ts: "today",
    label: "Login: forgot-password landing page + phone-OTP end-to-end (PL-014)",
    detail: "Forgot password now reads the email via react-hook-form watch() (was racing with document.getElementById), hits the send-password-reset edge fn first, then falls back to native supabase.auth.resetPasswordForEmail() with redirectTo=/reset-password (always-on path). NEW /reset-password page handles the Supabase magic-link redirect: waits up to 3s for the SDK to exchange ?code= for a session, then prompts for + confirms a new password via supabase.auth.updateUser({password}), then bounces back to /login. Invalid/expired links show a clear error + Back-to-sign-in CTA. Phone OTP got a real E.164 normalizer with min-length 10-digit guard, deduplicated send+verify normalization, and a clear toast when Supabase Auth phone provider isn't configured ('Phone sign-in isn't configured yet — use email + Forgot password instead') so the button doesn't silently no-op. Backlog item PL-014 (P0) closed.",
  },
  {
    ts: "today",
    label: "Telegram bot: cloud-native nudge drain + inactivity sweep",
    detail: "telegram-drain edge fn now runs on Supabase pg_cron every 5 min — Telegram nudges fire 24/7, no laptop dependency. fn_telegram_queue_inactivity_nudges sweeps every 15 min for stuck stages (lobby >48h, applied_paid >5d, pre_license >7d) and queues nudges idempotently. Local Mac daemon stays as backup/dev. Same dedupe + ON CONFLICT guards across both paths.",
  },
  {
    ts: "today",
    label: "Telegram bot: admin broadcast button (one-click queued sends)",
    detail: "/dashboard/admin/telegram-bot now has a Broadcast tab — pick a stage filter (Lobby / Applied paid / Studying / Hired / etc.), pick a template, hit send. Inserts batched rows into telegram_scheduled_messages with per-broadcast dedupe so re-clicks within the minute no-op. Drain delivers within 5 min.",
  },
  {
    ts: "today",
    label: "Telegram bot: seminar reminders parallel-send",
    detail: "seminar-reminder-tick now queues T-24h and T-1h Telegram nudges alongside the existing email path. Matches telegram_users by email. Try/catch isolated so email send is never blocked by Telegram side.",
  },
  {
    ts: "today",
    label: "Next Step Engine v3 — compliance + auto-dispatch + funnel health",
    detail: "All 18 stage templates now CAN-SPAM compliant (unsubscribe link → /unsubscribe?u={{email}} pre-checked against email_unsubscribes pre-send) + TCPA STOP language on every SMS. Dispatcher gained agentlink_agents fallback for agents with empty profile rows (recovered 7 of 10 hard-fails). pg_net INSERT trigger on next_step_messages fires next-step-dispatch immediately — 0-60 min cron-nudge latency collapsed to seconds. New /admin/next-step/funnel-health page surfaces conversion-to-next-stage % + median time-in-stage + biggest-leak callout + 24h outbound message breakdown.",
  },
  {
    ts: "today",
    label: "Landing performance trimmed",
    detail: "Public home no longer pulls Framer Motion for the hero, nav, live counters, recent hires, or landing sections. CSS keyframes keep the polish while the motion runtime stays off the first-load path, with vendor chunks grouped tighter.",
  },
  {
    ts: "today",
    label: "Apply continue fixed + duplicate referral removed",
    detail: "Apply is back to 4 steps: agent credit is captured before submit, Continue Application routes straight to the success page, and manual referrers persist without a second referral screen.",
  },
  {
    ts: "today",
    label: "Apply submission unblocked",
    detail: "Applicants were stuck on step 5 with a red toast. Treat ALREADY_CLAIMED as success — they now land on /apply/success cleanly.",
    commit: "5e11e11e",
  },
  {
    ts: "today",
    label: "Unclaimed Leads card + XCEL Stalled card",
    detail: "319 status='new' applicants + 22 stalled pre-licensing students now live above this banner. One-tap Claim button.",
    commit: "b8324f4a",
  },
  {
    ts: "today",
    label: "SocialMediaBot crash fixed",
    detail: "21 React #31 crashes in 24h from passing icon components into ReactNode slots. All 5 EmptyState calls patched.",
    commit: "b0158068",
  },
  {
    ts: "today",
    label: "Live trust ribbon on /apply",
    detail: "Emerald-pulse ribbon at the top of /apply now pulls carrier + active-agent counts from landing_live_stats() RPC instead of the hardcoded numbers it shipped with — same fake-success pattern that just killed the CTASection lie about the roster size. White-shimmer skeleton also killed.",
    commit: "a79ee8f7",
  },
  {
    ts: "today",
    label: "Live counter strip on landing",
    detail: "3 animated count-up tiles below the public hero — Active agents · Apps · Carrier partners.",
    commit: "eb3594a9",
  },
  {
    ts: "yesterday",
    label: "Operating-system audit + 3 DB moves",
    detail: "v_xcel_pipeline view created (was missing — runtime-errored every load). Auto-advance trigger fixed 10 stuck licensed applicants. v_unclaimed_new_apps view + claim RPC.",
    commit: "ca3034d4",
  },
  {
    ts: "yesterday",
    label: "Tier-4 visible fixes",
    detail: "Killed white VSL screen, producing-agents 30d→10d, Activity+Referrals widget removed, Agency Command top widget rebuilt with gradient + amber-pulse live badge (no more green-on-green).",
    commit: "88c04ada",
  },
  {
    ts: "yesterday",
    label: "Tier-1/2/3 punch-list",
    detail: "License gate /schedule-call, IG Growth Buy CTA, Gold/Platinum auth-redirect, Sam-James name unify, Watch-demo gone, sidebar surgery (Conduct/Strikes/Accounts/Purchase Leads removed), Agent Pipeline → Client Pipeline rename, Notifications to bottom, Login white-bg killed.",
    commit: "0fdde41d",
  },
];

const SHIPPED_TODAY_COUNT = SHIPPED.filter((s) => s.ts === "today").length;

export function WhatShippedTodayBanner() {
  const [expanded, setExpanded] = useState(true);

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="relative overflow-hidden rounded-2xl border border-emerald-500/40 bg-gradient-to-br from-emerald-500/12 via-primary/5 to-transparent p-4 sm:p-5 shadow-[0_0_60px_hsl(168_80%_50%/0.12)]"
    >
      <div aria-hidden className="pointer-events-none absolute -top-12 -right-12 h-56 w-56 rounded-full bg-emerald-500/15 blur-3xl" />

      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="relative w-full flex items-center gap-3 text-left"
        aria-expanded={expanded}
      >
        <div className="h-10 w-10 rounded-full bg-gradient-to-br from-emerald-400 to-primary flex items-center justify-center shadow-[0_0_30px_hsl(168_80%_50%/0.4)] flex-shrink-0">
          <Rocket className="h-5 w-5 text-zinc-950" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-300">
            <Sparkles className="h-3 w-3" /> Shipped — receipts since you logged in last
          </div>
          <h2 className="text-base sm:text-lg font-bold text-foreground leading-tight">
            {SHIPPED.length} platform changes live · {SHIPPED_TODAY_COUNT} pushed today
          </h2>
        </div>
        {expanded ? <ChevronUp className="h-5 w-5 text-muted-foreground" /> : <ChevronDown className="h-5 w-5 text-muted-foreground" />}
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.ul
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="relative mt-4 space-y-2 overflow-hidden"
          >
            {SHIPPED.map((item, i) => (
              <motion.li
                key={item.commit ?? i}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.03 }}
                className="flex items-start gap-3 rounded-xl border border-emerald-500/15 bg-zinc-900/40 px-3 py-2"
              >
                <CheckCircle2 className="h-4 w-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-foreground">{item.label}</span>
                    <span className="text-[10px] uppercase tracking-wider text-emerald-300/80">{item.ts}</span>
                    {item.commit && (
                      <a
                        href={`https://github.com/samcom593-creator/rebuild-brighten-sparkle/commit/${item.commit}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10px] font-mono text-muted-foreground hover:text-foreground"
                      >
                        {item.commit}
                      </a>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground leading-snug mt-0.5">{item.detail}</p>
                </div>
              </motion.li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
