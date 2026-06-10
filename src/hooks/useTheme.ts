import { useEffect, useState } from "react";

/**
 * useTheme — 2026-06-10 reverted: dark default again.
 *
 * History:
 *   - 2026-05-17: locked to dark (light tokens were broken).
 *   - 2026-06-10 morning: re-enabled light as default per Sam's preference.
 *   - 2026-06-10 evening: Sam gave up on light. "Honestly give up on the
 *     white. It's just too [much]." Flipped default back to dark.
 *     Toggle still works for anyone who wants light, but ships dark.
 */
type Theme = "light" | "dark";

const STORAGE_KEY = "apex:theme:v2";

function readStored(): Theme {
  if (typeof window === "undefined" || !window.localStorage) return "dark";
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => readStored());

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(theme);
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* private mode etc */
    }
  }, [theme]);

  const setTheme = (next: Theme | "system") => {
    if (next === "system") {
      const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
      setThemeState(prefersDark ? "dark" : "light");
    } else {
      setThemeState(next);
    }
  };

  return { theme, setTheme };
}
