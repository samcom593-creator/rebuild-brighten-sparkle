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
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (/[\\/]node_modules[\\/](react|react-dom|react-router-dom|scheduler)[\\/]/.test(id)) return "vendor-react";
          if (id.includes("@supabase/supabase-js")) return "vendor-supabase";
          if (id.includes("recharts")) return "vendor-charts";
          if (id.includes("framer-motion")) return "vendor-motion";
          if (id.includes("date-fns")) return "vendor-dates";
          if (id.includes("@radix-ui/react-dialog") || id.includes("@radix-ui/react-popover") || id.includes("@radix-ui/react-select") || id.includes("@radix-ui/react-tabs")) return "ui";
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
