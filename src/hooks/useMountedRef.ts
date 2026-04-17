import { useEffect, useRef } from "react";

/**
 * Returns a ref that is true while the component is mounted.
 * Use to guard setState calls after async work to prevent
 * React warnings + memory leaks that lead to navigation freezes.
 *
 * Example:
 *   const mounted = useMountedRef();
 *   const data = await supabase.from(...).select();
 *   if (!mounted.current) return;
 *   setState(data);
 */
export function useMountedRef() {
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  return mountedRef;
}
