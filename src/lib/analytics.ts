/**
 * Universal analytics shim. Fans events out to GA4 + PostHog + Meta Pixel
 * if they're configured via env. If a vendor is missing its env var, that
 * fan-out is a no-op — calls never throw, the rest still fire.
 *
 * Wiring lives in:
 *   - index.html (GA4 + Meta Pixel script tags, env-driven via VITE_*)
 *   - src/main.tsx (PostHog init, env-driven)
 *
 * Env vars (set in Vercel → Project Settings → Environment Variables):
 *   VITE_GA4_MEASUREMENT_ID    — e.g. G-XXXXXXXXXX
 *   VITE_POSTHOG_KEY           — e.g. phc_xxxxxxxxxxxxxxxx
 *   VITE_POSTHOG_HOST          — e.g. https://us.i.posthog.com (optional, default: us.i.posthog.com)
 *   VITE_META_PIXEL_ID         — Meta pixel id, digits only
 *
 * If none are set, analytics is dark — every call still returns cleanly.
 */

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    fbq?: ((...args: unknown[]) => void) & { callMethod?: unknown };
    dataLayer?: unknown[];
    posthog?: {
      capture: (event: string, props?: Record<string, unknown>) => void;
      identify: (id: string, props?: Record<string, unknown>) => void;
      reset: () => void;
      isFeatureEnabled?: (flag: string) => boolean | undefined;
      getFeatureFlag?: (flag: string) => string | boolean | undefined;
    };
  }
}

// Map AgencyHub event names to Meta Pixel standard events where it makes sense.
const META_EVENT_MAP: Record<string, string> = {
  page_view: "PageView",
  apply_start: "Lead",          // top-of-funnel
  apply_submitted: "CompleteRegistration",
  hero_cta_click: "InitiateCheckout", // closest semantic to "ready to apply"
};

export function track(event: string, props: Record<string, unknown> = {}): void {
  if (typeof window === "undefined") return;
  // GA4 — gtag is loaded from index.html if VITE_GA4_MEASUREMENT_ID is set
  try { window.gtag?.("event", event, props); } catch { /* swallow */ } // empty-catch-allow:telemetry-fire-and-forget
  // PostHog — loaded from main.tsx if VITE_POSTHOG_KEY is set
  try { window.posthog?.capture(event, props); } catch { /* swallow */ } // empty-catch-allow:telemetry-fire-and-forget
  // Meta Pixel — only fires for mapped standard events
  try {
    const metaEvent = META_EVENT_MAP[event];
    if (metaEvent && window.fbq) {
      window.fbq("track", metaEvent, scrubMetaProps(props));
    }
  } catch { /* swallow */ } // empty-catch-allow:telemetry-fire-and-forget
}

export function identify(distinctId: string, props: Record<string, unknown> = {}): void {
  if (typeof window === "undefined") return;
  try { window.posthog?.identify(distinctId, props); } catch { /* swallow */ } // empty-catch-allow:telemetry-fire-and-forget
  try { window.gtag?.("set", { user_id: distinctId }); } catch { /* swallow */ } // empty-catch-allow:telemetry-fire-and-forget
}

export function pageView(path: string, extra: Record<string, unknown> = {}): void {
  const u = typeof window !== "undefined" ? new URL(window.location.href) : null;
  const props = {
    path,
    referrer: typeof document !== "undefined" ? document.referrer || null : null,
    utm_source: u?.searchParams.get("utm_source") || null,
    utm_medium: u?.searchParams.get("utm_medium") || null,
    utm_campaign: u?.searchParams.get("utm_campaign") || null,
    ...extra,
  };
  track("page_view", props);
}

/** Meta forbids PII in advanced match unless explicitly hashed. Drop anything risky. */
function scrubMetaProps(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (/email|phone|first.?name|last.?name|address/i.test(k)) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Helper for variant assignment from PostHog feature flags (e.g., hero copy
 * test). Returns null if PostHog isn't loaded; caller should treat null as
 * "use the control".
 */
export function getVariant(flag: string): string | null {
  try {
    const v = window.posthog?.getFeatureFlag?.(flag);
    if (typeof v === "string") return v;
    if (v === true) return "true";
    if (v === false) return "false";
    return null;
  } catch {
    return null;
  }
}
