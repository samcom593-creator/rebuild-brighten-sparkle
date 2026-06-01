import { useState, useEffect } from "react";

// Single module-level listener shared by all subscribers.
// Prevents N components from each adding their own scroll handler.
const listeners = new Set<(y: number) => void>();
let initialized = false;

function ensureListener() {
  if (initialized) return;
  initialized = true;
  window.addEventListener(
    "scroll",
    () => {
      const y = window.scrollY;
      listeners.forEach((fn) => fn(y));
    },
    { passive: true },
  );
}

export function useScrollY(): number {
  const [y, setY] = useState(() => (typeof window !== "undefined" ? window.scrollY : 0));

  useEffect(() => {
    ensureListener();
    listeners.add(setY);
    return () => {
      listeners.delete(setY);
    };
  }, []);

  return y;
}
