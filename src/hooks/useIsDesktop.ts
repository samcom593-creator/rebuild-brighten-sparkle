import { useState, useEffect } from "react";

const DESKTOP_BREAKPOINT = 1024; // Matches Tailwind lg

export function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      return window.innerWidth >= DESKTOP_BREAKPOINT;
    }
    return true;
  });

  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT}px)`);
    const onChange = (e: MediaQueryListEvent | MediaQueryList) => {
      setIsDesktop(e.matches);
    };
    
    // Set initial value
    setIsDesktop(mql.matches);
    
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isDesktop;
}
