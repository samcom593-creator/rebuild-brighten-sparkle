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
          // Static assets from our own origin — stale-while-revalidate so
          // the page paints fast but every response triggers a background
          // refresh on next navigation.
          {
            urlPattern: ({ sameOrigin, request }) =>
              sameOrigin && (request.destination === "script" || request.destination === "style"),
            handler: "StaleWhileRevalidate",
            options: { cacheName: "apex-assets" },
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
        manualChunks: {
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          "vendor-supabase": ["@supabase/supabase-js"],
          "vendor-charts": ["recharts"],
          "vendor-motion": ["framer-motion"],
          "vendor-dates": ["date-fns", "date-fns-tz"],
          ui: ["@radix-ui/react-dialog", "@radix-ui/react-popover", "@radix-ui/react-select", "@radix-ui/react-tabs"],
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
