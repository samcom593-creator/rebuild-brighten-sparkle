// wave-19 (2026-06-04): supabase pulled out of module-scope static graph.
// flush() only runs >=5s after the first observed vital (LCP/CLS/INP). Lazy-
// loading the supabase chunk inside flush() removes this edge from the eager
// landing graph.

interface VitalEntry {
  name: string;
  value: number;
  rating?: "good" | "needs-improvement" | "poor";
}

const queue: VitalEntry[] = [];
let flushTimer: number | undefined;

async function flush() {
  if (queue.length === 0) return;
  const batch = queue.splice(0);
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    await supabase.from("analytics_events").insert(
      batch.map((v) => ({
        event_name: `web_vital.${v.name}`,
        event_category: "performance",
        properties: { value: v.value, rating: v.rating },
        url: typeof window !== "undefined" ? window.location.pathname : null,
        user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      }))
    );
  } catch {
    // swallow — vitals telemetry must not break the app
  }
}

function enqueue(entry: VitalEntry) {
  queue.push(entry);
  if (flushTimer) window.clearTimeout(flushTimer);
  flushTimer = window.setTimeout(() => void flush(), 5000);
}

export function initWebVitals() {
  if (typeof window === "undefined" || typeof PerformanceObserver === "undefined") return;

  // LCP
  try {
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1] as any;
      if (last) enqueue({ name: "LCP", value: last.startTime, rating: last.startTime < 2500 ? "good" : last.startTime < 4000 ? "needs-improvement" : "poor" });
    }).observe({ type: "largest-contentful-paint", buffered: true });
  } catch {}

  // CLS
  try {
    let cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as any[]) {
        if (!entry.hadRecentInput) cls += entry.value;
      }
      enqueue({ name: "CLS", value: cls, rating: cls < 0.1 ? "good" : cls < 0.25 ? "needs-improvement" : "poor" });
    }).observe({ type: "layout-shift", buffered: true });
  } catch {}

  // INP / FID via event timing
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as any[]) {
        if (entry.duration > 40) {
          enqueue({ name: "INP", value: entry.duration, rating: entry.duration < 200 ? "good" : entry.duration < 500 ? "needs-improvement" : "poor" });
        }
      }
    }).observe({ type: "event", buffered: true, durationThreshold: 40 } as any);
  } catch {}

  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flush();
  });
  window.addEventListener("pagehide", () => void flush());
}
