import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

/**
 * Navigation guard hook to clean up stuck overlays and prevent clicks-not-working issues.
 * 
 * On every route change:
 * 1. Removes pointer-events locks from body/html
 * 2. Removes stray aria-hidden attributes
 * 3. Clears any Radix portal overlays that weren't cleaned up
 */
export function useNavigationGuard() {
  const location = useLocation();
  const prevPathRef = useRef(location.pathname);

  useEffect(() => {
    // Only run on actual route changes
    if (prevPathRef.current === location.pathname) {
      return;
    }
    prevPathRef.current = location.pathname;

    // Cleanup function to restore interactivity
    const cleanup = () => {
      // 1. Remove pointer-events locks
      document.body.style.pointerEvents = "";
      document.documentElement.style.pointerEvents = "";
      
      // 2. Remove aria-hidden from main content (Radix sometimes leaves this)
      document.querySelectorAll("[aria-hidden='true']").forEach((el) => {
        // Only remove if it's not a legitimate hidden element
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
        // Check if there's an open dialog - if not, remove the overlay
        const hasOpenDialog = document.querySelector("[data-state='open'][role='dialog']");
        if (!hasOpenDialog) {
          el.remove();
        }
      });
    };

    // Run cleanup immediately on route change
    cleanup();

    // Also run after a short delay to catch late-mounting overlays
    const timeoutId = setTimeout(cleanup, 100);

    return () => clearTimeout(timeoutId);
  }, [location.pathname]);
}
