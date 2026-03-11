import { useRef, useCallback } from "react";

/**
 * Debounced refetch hook to prevent realtime "refetch storms"
 * @param refetchFn - The refetch function to debounce
 * @param delay - Minimum ms between refetches (default: 1000ms)
 */
export function useDebouncedRefetch(refetchFn: () => void, delay = 1000) {
  const lastRefetchTime = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debouncedRefetch = useCallback(() => {
    const now = Date.now();
    const timeSinceLastRefetch = now - lastRefetchTime.current;

    // Clear any pending timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    // Add random jitter (0-200ms) to prevent thundering herd
    const jitter = Math.random() * 200;

    if (timeSinceLastRefetch >= delay) {
      // Enough time has passed, refetch with slight jitter to spread load
      timeoutRef.current = setTimeout(() => {
        lastRefetchTime.current = Date.now();
        refetchFn();
      }, jitter);
    } else {
      // Schedule refetch for later
      const remainingDelay = delay - timeSinceLastRefetch + jitter;
      timeoutRef.current = setTimeout(() => {
        lastRefetchTime.current = Date.now();
        refetchFn();
      }, remainingDelay);
    }
  }, [refetchFn, delay]);

  return debouncedRefetch;
}
