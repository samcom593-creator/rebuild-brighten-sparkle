import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initWebVitals } from "./shared/lib/webVitals";

initWebVitals();

// ── PWA: autoUpdate + clientsClaim means new SW takes over IMMEDIATELY
// on deploy. We still hard-reload ONCE when the controller changes so
// the user sees the newest bundle without a stale paint.
if ("serviceWorker" in navigator) {
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
