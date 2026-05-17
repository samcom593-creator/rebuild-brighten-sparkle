import { useEffect } from "react";

/**
 * useTheme — forced dark mode (2026-05-17).
 *
 * Sam: "why do I click log in and I see some white page where I can't see
 * shit?". Light mode was breaking too many surfaces. Forcing dark mode
 * everywhere until light mode is properly audited and rebuilt.
 *
 * Stored `theme: 'light'` values are upgraded to `dark` on mount so users
 * who toggled in the past stop seeing white screens.
 */
type Theme = "light" | "dark" | "system";

export function useTheme() {
  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove("light");
    root.classList.add("dark");
    try {
      localStorage.setItem("theme", "dark");
    } catch {}
  }, []);

  // Keep the same API surface so existing call-sites don't break.
  const setTheme = (_t: Theme) => {
    // no-op — dark is locked
    const root = window.document.documentElement;
    root.classList.remove("light");
    root.classList.add("dark");
  };

  return { theme: "dark" as Theme, setTheme };
}
