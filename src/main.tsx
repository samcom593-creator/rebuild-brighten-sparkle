import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Force PWA update when new version available
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.ready.then(registration => {
    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      newWorker?.addEventListener('statechange', () => {
        if (newWorker.state === 'activated' && navigator.serviceWorker.controller) {
          // New version activated - reload to get fresh code
          window.location.reload();
        }
      });
    });
  });
}

createRoot(document.getElementById("root")!).render(<App />);
