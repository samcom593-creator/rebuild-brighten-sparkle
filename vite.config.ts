import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    VitePWA({
      registerType: "autoUpdate",
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
            // Highest priority: small shared utils that rolldown otherwise
            // hoists into vendor-charts. Splitting them out is the entire
            // point of wave-14.
            {
              name: "vendor-utils",
              priority: 100,
              test: "[\\\\/]node_modules[\\\\/](clsx|react-is|tiny-invariant)[\\\\/]",
            },
            // React runtime + router + scheduler + small shadcn helpers
            // (cva + tailwind-merge are widely consumed by shadcn variants
            // and belong with React-tier code, not pulled into vendor-charts).
            {
              name: "vendor-react",
              priority: 90,
              test: "[\\\\/]node_modules[\\\\/](react|react-dom|react-router-dom|scheduler|class-variance-authority|tailwind-merge)[\\\\/]",
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
            // vs everything-else. Landing-eager components (Navbar, HeroSection,
            // Footer, StickyMobileCTA) statically import 13 icons. vendor-icons
            // currently bundles all 150 app-wide icons into 50.92KB raw / 15.5KB
            // gz that's in the cold-landing modulepreload chain. Isolating the
            // 13 landing icons into vendor-icons-landing (~4.5KB raw / ~1.5KB gz
            // est) means cold-landing preload drops the other 137 icons. Lazy
            // dashboard/admin chunks still load full vendor-icons-extra on
            // demand. Icon files live at lucide-react/dist/esm/icons/<name>.js
            // (Vite tree-shakes the barrel — final module IDs are per-icon).
            {
              name: "vendor-icons-landing",
              priority: 75,
              test: "[\\\\/]node_modules[\\\\/]lucide-react[\\\\/]dist[\\\\/]esm[\\\\/]icons[\\\\/](menu|x|crown|search|arrow-right|shield|trending-up|users|sparkles|play|mail|phone|map-pin)\\.js$",
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
