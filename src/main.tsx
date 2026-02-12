import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// PWA update: only reload on next navigation, never mid-session
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.ready.then(registration => {
    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      newWorker?.addEventListener('statechange', () => {
        if (newWorker.state === 'activated' && navigator.serviceWorker.controller) {
          // Don't reload mid-session — flag it and reload on next user navigation
          sessionStorage.setItem('pwa-update-pending', '1');
        }
      });
    });
  });

  // Apply pending update on next page visibility change (tab switch back)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && sessionStorage.getItem('pwa-update-pending')) {
      sessionStorage.removeItem('pwa-update-pending');
      window.location.reload();
    }
  });
}

createRoot(document.getElementById("root")!).render(<App />);
