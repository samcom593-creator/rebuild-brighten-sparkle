import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import fs from "fs";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";
import {
  buildLandingCss,
  fmtBytes,
  LANDING_CSS_CEILING_GZ,
} from "./scripts/build-landing-css.mjs";

// wave-26 (2026-06-07): build-time sync invariant. Wave-25 found index.html's
// LCP preload + VideoObject JSON-LD still pointed at the OLD VSL for 2 days
// after HeroSection.tsx LazyYouTube videoId was swapped. Cold-landing browser
// was eagerly fetching ~25KB of an unused poster while the real LCP element
// got late-discovered via <img src> — projected +400-600ms mobile LCP. AND
// Google/Bing/AI-overview surfaced the wrong video. This plugin makes that
// class of bug fail the build instead of silently shipping.
function vslSyncCheckPlugin() {
  return {
    name: "apex-vsl-sync-check",
    buildStart() {
      const heroPath = path.resolve(__dirname, "src/components/landing/HeroSection.tsx");
      const indexPath = path.resolve(__dirname, "index.html");
      const hero = fs.readFileSync(heroPath, "utf8");
      const index = fs.readFileSync(indexPath, "utf8");

      const heroMatch = hero.match(/<LazyYouTube\s+videoId="([A-Za-z0-9_-]{8,15})"/);
      if (!heroMatch) {
        throw new Error(
          "[apex-vsl-sync-check] could not find <LazyYouTube videoId=\"...\"> in src/components/landing/HeroSection.tsx — has the hero VSL component been renamed? Update vite.config.ts vslSyncCheckPlugin regex."
        );
      }
      const heroId = heroMatch[1];

      // wave-35 (2026-06-08): surface #1 (preload) moved to a same-origin
      // path under public/img/hero-poster-<videoId>.jpg to kill the cross-
      // origin DNS+TCP+TLS handshake on the LCP element. Surface #2
      // (VideoObject thumbnailUrl) intentionally keeps i.ytimg.com because
      // Google/Bing/AI-overview prefer canonical YouTube CDN URLs for
      // VideoObject schema attribution — the two surfaces now check
      // different URL shapes, but both still rotate on a VSL swap.
      const checks: Array<{ label: string; pattern: RegExp }> = [
        { label: "<link rel=\"preload\"> self-hosted hero poster", pattern: /href="\/img\/hero-poster-([A-Za-z0-9_-]{8,15})\.jpg"/g },
        { label: "VideoObject thumbnailUrl", pattern: /"thumbnailUrl":"https:\/\/i\.ytimg\.com\/vi\/([A-Za-z0-9_-]{8,15})\/hqdefault\.jpg"/g },
        { label: "VideoObject contentUrl", pattern: /"contentUrl":"https:\/\/www\.youtube\.com\/watch\?v=([A-Za-z0-9_-]{8,15})"/g },
        { label: "VideoObject embedUrl", pattern: /"embedUrl":"https:\/\/www\.youtube-nocookie\.com\/embed\/([A-Za-z0-9_-]{8,15})"/g },
      ];

      const drift: string[] = [];
      for (const { label, pattern } of checks) {
        const ids = Array.from(index.matchAll(pattern), (m) => m[1]);
        if (ids.length === 0) {
          drift.push(`  - ${label}: no match found in index.html (expected ${heroId})`);
          continue;
        }
        for (const id of ids) {
          if (id !== heroId) {
            drift.push(`  - ${label}: index.html=${id} but HeroSection.tsx=${heroId}`);
          }
        }
      }

      // wave-27 (2026-06-07): BUMP_VERSION drift surface. The cache-bust
      // script at index.html:14 carries a versioned string used to evict
      // stale service workers + localStorage + Cache Storage on the first
      // visit after a deploy. After a VSL swap, BUMP_VERSION MUST change
      // or the new poster gets served to users whose SW is still pinned
      // to the old asset graph. Convention: BUMP_VERSION embeds the
      // current videoId so the bump fires automatically on any VSL swap.
      // Without this third guard, the wave-25 class of bug can still
      // re-emerge via "I updated the VSL but kept the old BUMP_VERSION."
      const bumpMatch = index.match(/var\s+BUMP_VERSION\s*=\s*"([^"]+)"/);
      if (!bumpMatch) {
        drift.push("  - BUMP_VERSION: could not locate `var BUMP_VERSION = \"...\"` in index.html cache-bust script");
      } else if (!bumpMatch[1].includes(heroId)) {
        drift.push(`  - BUMP_VERSION: "${bumpMatch[1]}" does not contain current videoId ${heroId} — caches will not evict on this swap`);
      }

      if (drift.length > 0) {
        throw new Error(
          `[apex-vsl-sync-check] index.html VSL references DRIFTED from HeroSection.tsx LazyYouTube videoId="${heroId}":\n${drift.join("\n")}\n\nFix: update the /img/hero-poster-<id>.jpg preload + every i.ytimg.com / youtube.com / youtube-nocookie.com URL in index.html to videoId ${heroId}; also commit a fresh public/img/hero-poster-${heroId}.jpg (curl https://i.ytimg.com/vi/${heroId}/hqdefault.jpg -o public/img/hero-poster-${heroId}.jpg); AND bump the BUMP_VERSION string in the cache-bust script at index.html:14 to include "${heroId}" (e.g. "2026-MM-DD-new-vsl-${heroId}"). The wave-25 regression (commit 2da7ddc7) is exactly what this guard prevents.`
        );
      }
    },
  };
}

// wave-54b (2026-06-10): build-time emit of public/landing.css from
// tailwind.config.landing.cjs + src/index.css via the shared buildLandingCss()
// lib. ADDITIVE — index.html still loads dist/assets/index-*.css (wave-54c
// owns the link swap). Purpose: validate the build pipeline works end-to-end
// (config exists, CLI invocation succeeds, output stays under the wave-54a
// 20 KB gz ceiling) BEFORE wave-54c makes landing.css the production cold-
// landing CSS. If wave-54b ships green for a build cycle without anyone
// noticing, wave-54c is purely a link swap on de-risked ground.
//
// Why buildStart not closeBundle: buildStart fires before any chunk emission,
// so a Tailwind config drift fails the build at the FIRST hook with a clear
// error message instead of surfacing 30 seconds later inside a Rollup error
// trace. The emit ALSO fires on `vite dev` so the dev server reflects the
// landing.css that prod will ship (~1.5-1.8s startup cost — acceptable).
function landingCssBuildPlugin() {
  return {
    name: "apex-landing-css-build",
    buildStart() {
      const out = path.resolve(__dirname, "public/landing.css");
      const { raw, gz, elapsed } = buildLandingCss(out);
      // eslint-disable-next-line no-console
      console.log(
        `[apex-landing-css-build] public/landing.css emitted: raw ${fmtBytes(raw)} / gz ${fmtBytes(gz)} in ${elapsed}ms (ceiling ${fmtBytes(LANDING_CSS_CEILING_GZ)} gz)`,
      );
      if (gz > LANDING_CSS_CEILING_GZ) {
        throw new Error(
          `[apex-landing-css-build] landing.css gzipped ${fmtBytes(gz)} exceeds ${fmtBytes(LANDING_CSS_CEILING_GZ)} ceiling — narrow tailwind config drifted. See scripts/check-landing-css-size.mjs triage steps.`,
        );
      }
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    vslSyncCheckPlugin(),
    landingCssBuildPlugin(),
    react(),
    mode === "development" && componentTagger(),
    VitePWA({
      registerType: "autoUpdate",
      // wave-45 (2026-06-09): live mobile Lighthouse for e1530c22 (HEAD) found
      // registerSW.js as the #3 cold-landing long task (112ms) on the main
      // thread — vite-plugin-pwa's default `injectRegister: 'auto'` injects
      // <script id="vite-plugin-pwa:register-sw" src="/registerSW.js"> into
      // <head>, which fetches + parses + executes during the LCP window.
      // Disabling the auto-injection and registering manually inside
      // src/main.tsx wrapped in requestIdleCallback moves the SW registration
      // OUT of the TBT/blocking window into idle time AFTER LCP+TTI.
      // SW autoUpdate behavior is preserved (workbox config still uses
      // skipWaiting + clientsClaim, and the controllerchange handler in
      // main.tsx still hard-reloads on update).
      injectRegister: false,
      includeAssets: ["favicon.ico", "apple-touch-icon.png", "masked-icon.svg"],
      manifest: {
        name: "APEX Financial - Daily Numbers",
        short_name: "APEX Numbers",
        description: "Track your daily production, see your ranking, and compete on the leaderboard.",
        theme_color: "#0a0f1a",
        background_color: "#0a0f1a",
        display: "standalone",
        orientation: "portrait",
        scope: "/",
        start_url: "/",
        icons: [
          {
            src: "/pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/~oauth/],
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        importScripts: ["/sw-push.js"],
        // Take over every tab on the new SW install, wipe stale caches.
        // Fixes: "page loads with an old bundle after deploy" + broken first load.
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          // Supabase REST: never cache mutations; cache SELECTs for 30s only.
          // 1-hour cache was showing stale numbers at startup.
          {
            urlPattern: ({ request, url }) => {
              if (!url.href.includes("supabase.co")) return false;
              return request.method === "GET";
            },
            handler: "NetworkFirst",
            options: {
              cacheName: "supabase-rest",
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 80, maxAgeSeconds: 30 },
            },
          },
          {
            urlPattern: ({ request, url }) =>
              url.href.includes("supabase.co") && request.method !== "GET",
            handler: "NetworkOnly",
          },
          // Static assets from our own origin.
          //
          // Was: StaleWhileRevalidate — that strategy serves the OLD cached
          // bundle on the FIRST visit after a deploy and only revalidates in
          // the background, meaning the NEW UI doesn't appear until the
          // SECOND page load. Sam reported "site looks unchanged after
          // deploy" — this was the cause.
          //
          // Now: NetworkFirst with a 3-second timeout. The browser will
          // try to fetch fresh code first; if the network is slow or
          // offline, it falls back to the precached version. Asset URLs
          // are content-hashed by Vite so we never serve a stale hash.
          //
          // For HTML navigation (the SPA shell), Workbox's default
          // navigation handler still uses the precached index.html; the
          // CSS/JS bundles linked from it are fetched fresh via this rule.
          {
            urlPattern: ({ sameOrigin, request }) =>
              sameOrigin && (request.destination === "script" || request.destination === "style"),
            handler: "NetworkFirst",
            options: {
              cacheName: "apex-assets",
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
        ],
      },
    }),
  ].filter(Boolean),
  build: {
    target: "esnext",
    minify: "esbuild",
    cssMinify: true,
    // Live mobile Lighthouse 2026-06-03 found LCP=6.0s on `/` driven by
    // eager modulepreload of vendor-charts (~104KB) + vendor-forms (zod+rhf)
    // + vendor-dates (date-fns). None of those are used by landing-eager
    // components — they are only referenced from lazy admin/form routes.
    // Vite's default modulepreload manifest includes every shared chunk,
    // so the browser downloads ~250KB of unused JS before first paint.
    // Filter them out of the entry HTML preload only; lazy chunks still
    // resolve their own deps when navigated to.
    modulePreload: {
      polyfill: true,
      resolveDependencies(_filename, deps, { hostType }) {
        if (hostType !== "html") return deps;
        return deps.filter((d) => !/vendor-(charts|forms|dates)/.test(d));
      },
    },
    rollupOptions: {
      output: {
        // wave-14 (2026-06-04): rolldown 1.0.0-rc.17's manualChunks function
        // return is silently ignored for tiny leaf-modules shared across
        // chunks (clsx, react-is, tiny-invariant). Its first-touch chunking
        // heuristic hoists them into vendor-charts via the recharts subgraph,
        // creating 6 `import { p } from './vendor-charts'` edges from eager
        // chunks (entry, vendor-react, vendor-radix, vendor-ui, vendor-icons,
        // vendor-query) that drag the full 396KB recharts chunk onto every
        // cold landing visit (Lighthouse: 83KB / 79% unused on /). Switching
        // to advancedChunks.groups — rolldown-native, pattern-based, and
        // authoritative — moves clsx + react-is + tiny-invariant into a
        // ~5-10KB vendor-utils chunk so vendor-charts becomes truly lazy.
        // All other groupings are ported 1:1 from the prior manualChunks fn.
        advancedChunks: {
          groups: [
            // wave-24 (2026-06-06): merge clsx + react-is + tiny-invariant into
            // vendor-react (was a separate 1.4KB vendor-utils chunk per wave-14).
            // They are React-tier utilities consumed by both eager landing
            // (entry chunk) and lazy chunks (vendor-charts, vendor-radix); the
            // wave-14 split prevented rolldown from hoisting them into
            // vendor-charts and dragging recharts onto cold landing. Promoting
            // them straight into vendor-react keeps vendor-charts lazy (its
            // edges now point at vendor-react, which is already cold-landing
            // eager) AND drops one modulepreload entry + one HTTP request from
            // the critical path. vendor-react grows ~1.4 KB raw / ~0.6 KB gz
            // (negligible vs its 162 KB raw footprint). React runtime + router
            // + scheduler + small shadcn helpers (cva + tailwind-merge are
            // widely consumed by shadcn variants and belong with React-tier
            // code, not pulled into vendor-charts).
            //
            // wave-36 (2026-06-08): add @radix-ui/react-slot to vendor-react.
            // src/components/ui/button.tsx is the ONLY landing-eager radix
            // consumer (verified via `grep -rE "from ['\"]@radix-ui" src/
            // components/landing src/components/ui/button.tsx src/components/
            // ui/glass-card.tsx src/components/ui/section-heading.tsx src/
            // components/ui/gradient-button.tsx src/components/ui/animated-
            // counter.tsx` returning only Button.tsx + Slot). With Slot in
            // vendor-radix, the 47 KB gz vendor-radix chunk gets pulled onto
            // cold landing via the Button → Slot edge. Promoting Slot into
            // vendor-react breaks that edge — vendor-radix becomes truly lazy
            // (only Testimonials, BenefitsSection, EarningsSection, etc. pull
            // it via lazy() chunks). vendor-react grows ~1 KB raw / ~0.5 KB gz
            // (the Slot module is tiny); cold-landing HTTP requests drop by
            // 1 chunk; cold-landing bytes drop by 47 KB gz. The vendor-radix
            // chunk hash will change, but its consumers are all already lazy.
            //
            // wave-39 (2026-06-08): split react-router-dom OUT of vendor-react
            // into its own vendor-router chunk. Live Lighthouse for wave-38
            // (5112a9e5, 17:38Z) surfaced 4 sequential long tasks on the same
            // vendor-react URL: 267ms + 145ms + 142ms + 113ms = ~670ms of
            // single-chunk evaluation blocking the main thread (TBT 88 → 483ms
            // because once vendor-radix was off-graph, vendor-react became the
            // dominant cost surface). react-router-dom (+ its @remix-run/router
            // dependency) is ~40 KB raw / ~12-15 KB gz of router code that the
            // browser can fetch + parse + compile in parallel with the react
            // runtime when it lives in a sibling chunk. Splitting expectations:
            // vendor-react ~165 → ~125 KB raw / 54 → ~42 KB gz; vendor-router
            // emerges at ~40 KB raw / ~13 KB gz. Long-task count expected to
            // drop from 4 hits on vendor-react to ~2 hits on vendor-react +
            // ~2 hits on vendor-router with each individual task significantly
            // shorter (browser parallelizes script eval across chunks). Higher
            // priority (110) ensures router modules win over the broader
            // vendor-react regex.
            {
              name: "vendor-router",
              priority: 110,
              test: "[\\\\/]node_modules[\\\\/](react-router-dom|react-router|@remix-run[\\\\/]router)[\\\\/]",
            },
            // wave-51 (2026-06-09): split react-dom OUT of vendor-react. Live mobile
            // Lighthouse for wave-50 commit 24a8914b measured vendor-react at 52 KB gz
            // / 156 KB raw — the dominant cold-landing transfer and the surface
            // driving the top 5 cold-landing long tasks: vendor-react 139ms + 83ms +
            // 83ms + 57ms + 55ms = 417ms of single-chunk eval blocking the main
            // thread (TBT 83ms post-wave-46, but vendor-react eval is still the
            // ceiling on further TBT reduction). react-dom is ~37 KB gz / ~115 KB raw
            // of DOM renderer code (createRoot + reconciler + event system); the
            // browser can fetch + parse + compile it in parallel with the react
            // runtime when it lives in a sibling chunk, and the browser yields
            // between sequential eval tasks so two 30-50ms tasks beat one 100ms+
            // monolithic eval. Splitting expectations: vendor-react ~156 → ~40-50 KB
            // raw / 52 → ~14-17 KB gz; vendor-react-dom emerges at ~110-115 KB raw /
            // ~35-37 KB gz. Long-task count expected to drop from 5 hits on vendor-
            // react to ~2-3 hits on vendor-react + ~2-3 hits on vendor-react-dom,
            // each individual task significantly shorter. Higher priority (105)
            // ensures react-dom modules win over the broader vendor-react regex
            // below. scheduler is kept in vendor-react because it's used by both
            // react (concurrent mode) and react-dom (renderer) — duplicating it
            // would bloat both chunks, and the small react-dom -> vendor-react edge
            // for scheduler doesn't force sequential fetch (modulepreload still
            // parallelizes the HTTP fetches; only eval order is constrained).
            {
              name: "vendor-react-dom",
              priority: 105,
              test: "[\\\\/]node_modules[\\\\/]react-dom[\\\\/]",
            },
            {
              name: "vendor-react",
              priority: 100,
              test: "[\\\\/]node_modules[\\\\/](react|scheduler|class-variance-authority|tailwind-merge|clsx|react-is|tiny-invariant|@radix-ui[\\\\/]react-slot)[\\\\/]",
            },
            {
              name: "vendor-supabase",
              priority: 80,
              test: "[\\\\/]node_modules[\\\\/]@supabase[\\\\/]supabase-js[\\\\/]",
            },
            {
              name: "vendor-query",
              priority: 80,
              test: "[\\\\/]node_modules[\\\\/]@tanstack[\\\\/]react-query[\\\\/]",
            },
            {
              name: "vendor-charts",
              priority: 70,
              test: "[\\\\/]node_modules[\\\\/](recharts|victory-vendor|d3-[^\\\\/]+)[\\\\/]",
            },
            // wave-22 (2026-06-06): split lucide-react into landing-eager subset
            // vs everything-else.
            // wave-46 (2026-06-09): live mobile Lighthouse for f35ef658 showed
            // vendor-icons 14KB gz STILL on cold-landing transfers (not in
            // modulepreload but pulled by lazy Suspense children during the
            // audit window). Audited every landing-reachable file (Index.tsx
            // eager + lazy Suspense children + Footer + StickyMobileCTA +
            // LiveStats + RecentHires + SupabaseHealthBanner): 48 unique icons.
            // Expanded vendor-icons-landing regex from 17 → 48 names so the
            // lazy-children Suspense fire resolves to vendor-icons-landing
            // (already preloaded) instead of pulling vendor-icons.
            // wave-48 (2026-06-09): live mobile Lighthouse for 3a03b0b9 STILL
            // showed vendor-icons 12.4KB gz on cold-landing transfers because
            // lucide-react v0.462 re-exports CheckCircle2, FileSignature, and
            // Home through SHIM files that themselves re-export from a
            // different underlying icon file (check-circle-2.js → circle-
            // check.js, file-signature.js → file-pen-line.js, home.js →
            // house.js). Rollup's manualChunks test runs against the resolved
            // module path, NOT the import specifier — so the 3 shim names
            // matched but the actual icon body landed in vendor-icons. Wave-48
            // adds the 3 resolved targets (circle-check, file-pen-line, house)
            // to the regex so the actual icon bodies live in vendor-icons-
            // landing alongside their shims. Net projected: vendor-icons drops
            // off cold-landing transfers entirely, TBT 140 → 100-130ms.
            // Defense: wave-49 should extend check-vendor-icons-landing-census
            // to follow lucide re-export shims so the next shim-renamed icon
            // fails the build at commit time.
            //   - eager: Navbar (menu,x,crown,search), HeroSection (arrow-
            //     right,shield,trending-up,users,sparkles,play), DealsTicker
            //     (none), LiveStatsCounterStrip (users,file-text,building-2),
            //     RecentHiresTicker (sparkles)
            //   - lazy Suspense kids: Testimonials (quote), BenefitsSection
            //     (dollar-sign,graduation-cap,calendar,target,trophy,zap,heart-
            //     handshake), EarningsSection (award,clock), CareerPathway
            //     (book-open,clipboard-check,file-check,file-signature→file-
            //     pen-line, smartphone,headphones,home→house,message-circle,
            //     user-plus,users-round,building-2,chevron-up), ApexLeadsSection
            //     (check), InstagramGrowthSection (instagram,cloud,repeat-2,
            //     mouse-pointer-click,bot,heart), RecruitFAQ (chevron-down),
            //     CTASection (check-circle-2→circle-check), Footer (mail,phone,
            //     map-pin), StickyMobileCTA (arrow-right)
            //   - lazy app-shell helpers: SupabaseHealthBanner (triangle-alert,
            //     refresh-cw,x), wave-22 carryover (compass)
            // If a new landing-reachable component imports an icon NOT in this
            // regex, vendor-icons 14KB will silently regress onto cold landing.
            // Defense: wave-47 pre-commit guard catches direct lucide imports
            // but doesn't follow re-export shims — wave-48 manually adds the
            // 3 known shims; wave-49 will automate shim resolution.
            {
              name: "vendor-icons-landing",
              priority: 75,
              test: "[\\\\/]node_modules[\\\\/]lucide-react[\\\\/]dist[\\\\/]esm[\\\\/]icons[\\\\/](arrow-right|award|book-open|bot|building-2|calendar|check|check-circle-2|chevron-down|chevron-up|circle-check|clipboard-check|clock|cloud|compass|crown|dollar-sign|file-check|file-pen-line|file-signature|file-text|graduation-cap|headphones|heart|heart-handshake|home|house|instagram|mail|map-pin|menu|message-circle|mouse-pointer-click|phone|play|quote|refresh-cw|repeat-2|search|shield|smartphone|sparkles|target|trending-up|triangle-alert|trophy|user-plus|users|users-round|x|zap)\\.js$",
            },
            {
              name: "vendor-icons",
              priority: 70,
              test: "[\\\\/]node_modules[\\\\/]lucide-react[\\\\/]",
            },
            {
              name: "vendor-forms",
              priority: 70,
              test: "[\\\\/]node_modules[\\\\/](react-hook-form|@hookform[\\\\/]resolvers|zod)[\\\\/]",
            },
            {
              name: "vendor-dates",
              priority: 70,
              test: "[\\\\/]node_modules[\\\\/]date-fns[\\\\/]",
            },
            {
              name: "vendor-radix",
              priority: 60,
              test: "[\\\\/]node_modules[\\\\/]@radix-ui[\\\\/]",
            },
            {
              name: "vendor-ui",
              priority: 60,
              test: "[\\\\/]node_modules[\\\\/](cmdk|sonner|vaul|embla-carousel-react)[\\\\/]",
            },
          ],
        },
      },
    },
  },
  optimizeDeps: {
    include: ["react", "react-dom", "@supabase/supabase-js"],
  },
  resolve: {
    dedupe: ["react", "react-dom", "react/jsx-runtime"],
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
