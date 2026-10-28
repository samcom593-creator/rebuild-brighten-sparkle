import { useEffect, useState } from "react";

const PHONE_QUERY = "(max-width: 639px)";

/**
 * True below Tailwind's `sm` breakpoint. One hook decides whether a surface opens as a bottom
 * sheet / vaul drawer (phone) or a side sheet / dialog (sm+), so the two can never disagree.
 * Guarded for jsdom, where matchMedia is absent.
 */
export function useIsPhone(): boolean {
  const [phone, setPhone] = useState<boolean>(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(PHONE_QUERY).matches : false,
  );
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(PHONE_QUERY);
    const onChange = () => setPhone(mql.matches);
    mql.addEventListener("change", onChange);
    setPhone(mql.matches);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return phone;
}
