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

  // Poll for updates when the tab regains focus — covers long-open PWAs.
  navigator.serviceWorker.ready.then(reg => {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") reg.update().catch(() => {});
    });
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
  });
}

createRoot(document.getElementById("root")!).render(<App />);
