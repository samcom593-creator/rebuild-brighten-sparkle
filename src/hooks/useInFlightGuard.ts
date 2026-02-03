import { useRef, useCallback } from "react";

/**
 * Guards against multiple simultaneous refetch requests.
 * Only allows one refetch at a time, queues a trailing refetch if requested during in-flight.
 */
export function useInFlightGuard<T>(
  refetchFn: () => Promise<T>
): () => Promise<T | void> {
  const isInFlightRef = useRef(false);
  const pendingRefetchRef = useRef(false);

  const guardedRefetch = useCallback(async (): Promise<T | void> => {
    // If already refetching, mark that we need another refetch when done
    if (isInFlightRef.current) {
      pendingRefetchRef.current = true;
      return;
    }

    isInFlightRef.current = true;

    try {
      const result = await refetchFn();
      return result;
    } finally {
      isInFlightRef.current = false;

      // If a refetch was requested while we were in-flight, do one more
      if (pendingRefetchRef.current) {
        pendingRefetchRef.current = false;
        // Use setTimeout to avoid synchronous recursion
        setTimeout(() => guardedRefetch(), 0);
      }
    }
  }, [refetchFn]);

  return guardedRefetch;
}
