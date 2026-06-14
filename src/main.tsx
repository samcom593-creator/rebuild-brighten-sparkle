import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initWebVitals } from "./shared/lib/webVitals";
import { installRippleOrigin, installRevealObserver } from "./lib/gameFx";
import { bootAnalytics } from "./lib/analyticsBoot";

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

  // 2026-06-15 v7.11 · AGGRESSIVE SW UPDATE POLLING
  // Sam screenshot showed v7.7 bundle still active hours after v7.8-v7.11
  // shipped. Old SW poll was 60 MINUTES which left long-open tabs stuck on
  // stale bundles. Bumped to 60 SECONDS so any update lands within a
  // minute of being deployed. Also forces update on history.pushState
  // (every route change) so SPA navigation can't slip past the check.
  navigator.serviceWorker.ready.then(reg => {
    const tryUpdate = () => reg.update().catch(() => {});
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") tryUpdate();
    });
    // 60-second poll (was 60-minute) for aggressive update detection
    setInterval(tryUpdate, 60 * 1000);
    // Also force update on every SPA navigation
    const origPushState = window.history.pushState;
    window.history.pushState = function(...args) {
      tryUpdate();
      return origPushState.apply(window.history, args as any);
    };
    window.addEventListener("popstate", tryUpdate);
    // And once at first paint, in case the SW just got installed
    tryUpdate();
  });
}

createRoot(document.getElementById("root")!).render(<App />);
