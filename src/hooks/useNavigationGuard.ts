import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

/**
 * Navigation guard hook to clean up stuck overlays and prevent clicks-not-working issues.
 * 
 * Runs cleanup on:
 * 1. Route changes
 * 2. Window focus / visibility changes
 * 3. Watchdog interval when pointer-events are stuck
 */
export function useNavigationGuard() {
  const location = useLocation();
  const prevPathRef = useRef(location.pathname);

  const cleanup = () => {
    // 1. Remove pointer-events locks
    document.body.style.pointerEvents = "";
    document.documentElement.style.pointerEvents = "";
    
    // 2. Remove aria-hidden from main content (Radix sometimes leaves this)
    document.querySelectorAll("[aria-hidden='true']").forEach((el) => {
      if (el.tagName === "DIV" && el.getAttribute("data-radix-portal") === null) {
        el.removeAttribute("aria-hidden");
      }
    });

    // 3. Remove stray overflow:hidden from body
    if (document.body.style.overflow === "hidden") {
      document.body.style.overflow = "";
    }

    // 4. Remove any orphaned Radix overlay backdrops
    document.querySelectorAll("[data-radix-dialog-overlay]").forEach((el) => {
      const hasOpenDialog = document.querySelector("[data-state='open'][role='dialog']");
      if (!hasOpenDialog) {
        el.remove();
      }
    });
  };

  // Route change cleanup
  useEffect(() => {
    if (prevPathRef.current === location.pathname) return;
    prevPathRef.current = location.pathname;

    cleanup();
    const timeoutId = setTimeout(cleanup, 100);
    return () => clearTimeout(timeoutId);
  }, [location.pathname]);

  // Window focus / visibility cleanup
  useEffect(() => {
    const onFocus = () => cleanup();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") cleanup();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  // Watchdog: detect stuck pointer-events and auto-fix
  useEffect(() => {
    const watchdog = setInterval(() => {
      const bodyPE = document.body.style.pointerEvents;
      const htmlPE = document.documentElement.style.pointerEvents;
      if (bodyPE === "none" || htmlPE === "none") {
        // Check if there's actually an open dialog — if not, it's stuck
        const hasOpenDialog = document.querySelector("[data-state='open'][role='dialog']");
        if (!hasOpenDialog) {
          cleanup();
        }
      }
    }, 2000);

    return () => clearInterval(watchdog);
  }, []);
}
