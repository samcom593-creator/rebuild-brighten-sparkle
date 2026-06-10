import { useEffect, useState } from "react";

/**
 * useTheme — 2026-06-10: re-enabled light theme as DEFAULT.
 *
 * History:
 *   - 2026-05-17: locked to dark because legacy light tokens were broken
 *     (apex.navy/teal etc had no light values, so surfaces went white-on-white).
 *   - 2026-06-10: Sam said "I always would like the light version more than
 *     the dark." apex-tokens.css now ships BOTH themes with parity, so the
 *     toggle is safe to re-enable. Default = light (Sam's preference).
 *
 * Behavior:
 *   - Reads `theme` from localStorage; falls back to "light".
 *   - Applies the class on documentElement.
 *   - setTheme persists the choice + flips the class immediately.
 */
type Theme = "light" | "dark";

const STORAGE_KEY = "apex:theme:v2";

function readStored(): Theme {
  if (typeof window === "undefined" || !window.localStorage) return "light";
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === "dark" ? "dark" : "light";
  } catch {
    return "light";
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
