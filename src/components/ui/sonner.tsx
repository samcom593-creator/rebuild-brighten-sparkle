import { useEffect, useState } from "react";
import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

/**
 * useDocumentTheme — 2026-08-23 light/dark wave.
 *
 * This file used to read `useTheme()` from "next-themes". No <ThemeProvider>
 * is mounted anywhere in this app (verified: zero matches for `ThemeProvider`
 * across src/), and next-themes falls back to a stub context when the provider
 * is absent, so `theme` was permanently `undefined`. The destructuring default
 * therefore always won and Sonner was handed `theme="system"` — meaning every
 * toast followed the OPERATING SYSTEM's colour preference while the app
 * followed `apex:theme:v2` (which defaults to dark). On a light-mode laptop,
 * dark-mode APEX rendered light toast chrome.
 *
 * The obvious fix — import the real `@/hooks/useTheme` — is wrong here. That
 * hook is per-instance `useState` seeded from localStorage, not a shared
 * store, so when TopBar toggles the theme this component's copy would keep the
 * old value and the toasts would stay on the previous theme until remount.
 *
 * The class on <html> is what the CSS itself keys off, so it is the only
 * source that cannot disagree with what the user is actually looking at.
 * Observing it keeps Sonner correct no matter who writes the class.
 */
function useDocumentTheme(): "light" | "dark" {
  // Mirrors the cascade exactly: index.css puts the light palette on bare
  // `:root` and layers the dark palette under `.dark`, so the presence of the
  // `dark` class — not the absence of a `light` one — is what decides which
  // palette is painted. Testing for `dark` therefore also resolves the
  // class-less transient to light, which is what the CSS would render.
  const read = (): "light" | "dark" =>
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark")
      ? "dark"
      : "light";

  const [theme, setTheme] = useState<"light" | "dark">(read);

  useEffect(() => {
    const root = document.documentElement;
    // Re-read on mount: the class may have been written between the initial
    // render and this effect.
    setTheme(read());
    const observer = new MutationObserver(() => setTheme(read()));
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return theme;
}

const Toaster = ({ ...props }: ToasterProps) => {
  const theme = useDocumentTheme();

  return (
    <Sonner
      theme={theme}
      // Sonner mounts a fixed-position container that can span the screen.
      // Keep the container non-interactive so it never blocks app clicks;
      // individual toast cards opt back in via `pointer-events-auto`.
      className="toaster group pointer-events-none"
      toastOptions={{
        classNames: {
          toast:
            "group toast pointer-events-auto group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
