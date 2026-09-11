// wave-19 (2026-06-04): supabase pulled out of module-scope static graph.
// flush() only runs >=5s after the first observed vital (LCP/CLS/INP). Lazy-
// loading the supabase chunk inside flush() removes this edge from the eager
// landing graph.

interface VitalEntry {
  name: string;
  value: number;
  rating?: "good" | "needs-improvement" | "poor";
  /**
   * MP-513: the page this vital was OBSERVED on, captured in enqueue(). A web
   * vital is a per-page measurement, so the page must be read when the entry is
   * made, not when the batch drains up to 5s later -- by then the user may be on
   * another route and the metric is filed against a page that never produced it.
   */
  url: string | null;
}

interface LayoutShiftEntry extends PerformanceEntry {
  readonly hadRecentInput: boolean;
  readonly value: number;
}

interface EventTimingEntry extends PerformanceEntry {
  readonly duration: number;
}

interface EventTimingObserverInit extends PerformanceObserverInit {
  durationThreshold: number;
}

// One row per vital per page is enough to diagnose user experience. Event
// Timing emits one entry for every interaction; pushing every entry produced
// 28,875 web_vital.INP rows in 24 hours (94% of all analytics writes) from only
// ~95 browsing sessions. Keep the worst value observed until the batch flushes,
// then ignore later entries for that vital on this page.
const pending = new Map<string, VitalEntry>();
const reported = new Set<string>();
let flushTimer: number | undefined;
let initialized = false;

function telemetrySessionId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const key = "apex.telemetry.session";
    const existing = window.sessionStorage.getItem(key);
    if (existing) return existing;
    const created = crypto.randomUUID();
    window.sessionStorage.setItem(key, created);
    return created;
  } catch { // empty-catch-allow:telemetry-fire-and-forget
    return null;
  }
}

async function flush() {
  if (flushTimer !== undefined) window.clearTimeout(flushTimer);
  flushTimer = undefined;
  if (pending.size === 0) return;
  const batch = Array.from(pending.values());
  pending.clear();
  for (const vital of batch) reported.add(vital.name);
  const sessionId = telemetrySessionId();
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    await supabase.from("analytics_events").insert(
      batch.map((v) => ({
        event_name: `web_vital.${v.name}`,
        event_category: "performance",
        properties: { value: v.value, rating: v.rating },
        url: v.url,
        user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
        session_id: sessionId,
      }))
    );
  } catch { // empty-catch-allow:telemetry-fire-and-forget
    // swallow — vitals telemetry must not break the app
  }
}

function enqueue(entry: Omit<VitalEntry, "url">) {
  if (reported.has(entry.name)) return;
  const stamped: VitalEntry = {
    ...entry,
    url: typeof window !== "undefined" ? window.location.pathname : null,
  };
  const existing = pending.get(stamped.name);
  if (!existing || stamped.value >= existing.value) pending.set(stamped.name, stamped);
  // Fixed window, not a debounce: continuous interaction must not keep an
  // ever-growing batch alive forever. Map cardinality is capped by vital name.
  if (flushTimer === undefined) flushTimer = window.setTimeout(() => void flush(), 5000);
}

export function initWebVitals() {
  if (initialized || typeof window === "undefined" || typeof PerformanceObserver === "undefined") return;
  initialized = true;

  // LCP
  try {
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1];
      if (last) enqueue({ name: "LCP", value: last.startTime, rating: last.startTime < 2500 ? "good" : last.startTime < 4000 ? "needs-improvement" : "poor" });
    }).observe({ type: "largest-contentful-paint", buffered: true });
  } catch { // empty-catch-allow:telemetry-fire-and-forget
  }

  // CLS
  try {
    let cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as LayoutShiftEntry[]) {
        if (!entry.hadRecentInput) cls += entry.value;
      }
      enqueue({ name: "CLS", value: cls, rating: cls < 0.1 ? "good" : cls < 0.25 ? "needs-improvement" : "poor" });
    }).observe({ type: "layout-shift", buffered: true });
  } catch { // empty-catch-allow:telemetry-fire-and-forget
  }

  // INP / FID via event timing
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as EventTimingEntry[]) {
        if (entry.duration > 40) {
          enqueue({ name: "INP", value: entry.duration, rating: entry.duration < 200 ? "good" : entry.duration < 500 ? "needs-improvement" : "poor" });
        }
      }
    }).observe({ type: "event", buffered: true, durationThreshold: 40 } as EventTimingObserverInit);
  } catch { // empty-catch-allow:telemetry-fire-and-forget
  }

  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flush();
  });
  window.addEventListener("pagehide", () => void flush());
}
