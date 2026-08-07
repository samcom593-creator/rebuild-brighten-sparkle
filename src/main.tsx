import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initWebVitals } from "./shared/lib/webVitals";
import { installRippleOrigin, installRevealObserver } from "./lib/gameFx";
import { bootAnalytics } from "./lib/analyticsBoot";
import { captureAttribution } from "./lib/attribution";
import { installChunkRecovery } from "./lib/chunkRecovery";

// FIRST thing on boot, before React mounts and before the router can swallow
// the query string. A visitor landing on /?utm_source=google&gclid=... then
// clicking through to /apply loses every param on that client-side route
// change — which is why 776 of 783 applications recorded utm_source = NULL.
// This persists the landing signals so the submit path can still read them.
captureAttribution();
installChunkRecovery();

initWebVitals();
installRippleOrigin();
installRevealObserver();
bootAnalytics();

// ── PWA: autoUpdate + clientsClaim means new SW takes over IMMEDIATELY
// on deploy. We still hard-reload ONCE when the controller changes so
// the user sees the newest bundle without a stale paint.
//
// wave-45 (2026-06-09): registration deferred to requestIdleCallback after
// `load` so the SW install does NOT block the LCP/TBT window on cold mobile
// landings. vite.config.ts sets `injectRegister: false` to kill the eager
// /registerSW.js <script> tag that vite-plugin-pwa otherwise injects into
// <head>. Live mobile Lighthouse on e1530c22 saw registerSW.js as a 112ms
// long task on the main thread — by the time idle fires, LCP is paid and
// the SW install runs in dead time. Subsequent visits remain instant
// because the precached shell + content-hashed bundles are already cached.
if ("serviceWorker" in navigator) {
  const register = () =>
    // empty-catch-allow:sw-register — service worker registration is opportunistic; failure just means no offline shell.
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});

  const scheduleRegister = () => {
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
    };
    if (typeof w.requestIdleCallback === "function") {
      w.requestIdleCallback(register, { timeout: 5000 });
    } else {
      setTimeout(register, 2000);
    }
  };

  if (document.readyState === "complete") {
    scheduleRegister();
  } else {
    window.addEventListener("load", scheduleRegister, { once: true });
  }

  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });

  // Check for a new shell after install, when the tab becomes visible, and
  // periodically during long sessions. Route changes deliberately do not
  // trigger an update request: that made every in-app navigation compete
  // with another service-worker fetch.
  navigator.serviceWorker.ready.then(reg => {
    // empty-catch-allow:sw-update-poll — update polling is best-effort; transient failures self-heal on next tick.
    const tryUpdate = () => reg.update().catch(() => {});
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") tryUpdate();
    });
    setInterval(tryUpdate, 15 * 60 * 1000);
    tryUpdate();
  });
}

createRoot(document.getElementById("root")!).render(<App />);
