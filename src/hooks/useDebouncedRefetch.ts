import { useRef, useCallback } from "react";

/**
 * Debounced refetch hook to prevent realtime "refetch storms"
 * @param refetchFn - The refetch function to debounce
 * @param delay - Minimum ms between refetches (default: 1000ms)
 */
export function useDebouncedRefetch(refetchFn: () => void, delay = 1000) {
  const lastRefetchTime = useRef(0);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const debouncedRefetch = useCallback(() => {
    const now = Date.now();
    const timeSinceLastRefetch = now - lastRefetchTime.current;

    // Clear any pending timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    if (timeSinceLastRefetch >= delay) {
      // Enough time has passed, refetch immediately
      lastRefetchTime.current = now;
      refetchFn();
    } else {
      // Schedule refetch for later
      const remainingDelay = delay - timeSinceLastRefetch;
      timeoutRef.current = setTimeout(() => {
        lastRefetchTime.current = Date.now();
        refetchFn();
      }, remainingDelay);
    }
  }, [refetchFn, delay]);

  return debouncedRefetch;
}
