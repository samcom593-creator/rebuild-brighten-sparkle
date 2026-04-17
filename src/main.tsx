import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initWebVitals } from "./shared/lib/webVitals";

initWebVitals();

// PWA update: flag availability but NEVER reload mid-session
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.ready.then(registration => {
    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      newWorker?.addEventListener('statechange', () => {
        if (newWorker.state === 'activated' && navigator.serviceWorker.controller) {
          console.log('[PWA] Update available — will apply on next full page load.');
        }
      });
    });
  });
}

createRoot(document.getElementById("root")!).render(<App />);
