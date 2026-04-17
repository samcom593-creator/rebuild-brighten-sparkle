import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { track } from "./track";

/**
 * Emits a `navigation.page_view` event whenever the route changes.
 * Mount once near the router root.
 */
export function useRouteTelemetry() {
  const location = useLocation();
  const lastPathRef = useRef<string | null>(null);

  useEffect(() => {
    const path = location.pathname + location.search;
    if (lastPathRef.current === path) return;
    lastPathRef.current = path;

    track("navigation.page_view", "navigation", {
      path: location.pathname,
      search: location.search || undefined,
      referrer: document.referrer || undefined,
    });
  }, [location.pathname, location.search]);
}

/** Component wrapper for places that prefer JSX-based mounting. */
export function RouteTelemetry() {
  useRouteTelemetry();
  return null;
}
