// wave-19 (2026-06-04): supabase pulled out of module-scope static graph.
// flush() only runs >=5s after the first observed vital (LCP/CLS/INP). Lazy-
// loading the supabase chunk inside flush() removes this edge from the eager
// landing graph.

import { beaconAnalyticsRows } from "@/shared/telemetry/beacon";

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

/**
 * MP-540: the instant this page first became hidden, in `performance.now()`
 * time — Infinity while it has never been hidden.
 *
 * LCP is reported against navigation start, so a tab opened in the BACKGROUND
 * (cmd-click, session restore, a link opened "in new tab") does not paint until
 * the user finally looks at it, and the browser then reports a perfectly honest
 * LCP of however long that took. Measured on this instance over the 1,261 LCP
 * rows written since the dedupe deployed: 74 (5.9%) exceed 60s and the largest
 * is 50,596s — 14 hours. No page paints in 14 hours; that number is a
 * measurement of when Sam's visitor came back to the tab.
 *
 * It is not inert. 162 of those rows are rated "poor", and 74 of the 162
 * (45.7%) are poor ONLY because of this — so the obvious next build, the
 * Check #8 speed gate this bot's charter has always named, would have paged
 * about pages that are fine. Fix the operand before anything grades it.
 *
 * The rule is the web-vitals library's: discard any entry observed at or after
 * the first hide. A background tab is hidden from t=0, so firstHiddenTime is 0
 * and every one of its entries is correctly discarded.
 */
let firstHiddenTime = Infinity;

function markHidden(at: number) {
  if (at < firstHiddenTime) firstHiddenTime = at;
}

/**
 * True when an entry was observed after the page had already been hidden, so
 * its timing describes the user's attention rather than the page's speed.
 *
 * A missing startTime coerces to 0, which is the conservative direction: under
 * a firstHiddenTime of 0 (loaded in the background) it discards, rather than
 * admitting an untimed entry from a page that was never looked at.
 */
function observedWhileHidden(entry: { startTime?: number }) {
  return (entry.startTime ?? 0) >= firstHiddenTime;
}

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

function buildRows(batch: VitalEntry[]) {
  const sessionId = telemetrySessionId();
  return batch.map((v) => ({
    event_name: `web_vital.${v.name}`,
    event_category: "performance",
    properties: { value: v.value, rating: v.rating },
    url: v.url,
    user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
    session_id: sessionId,
  }));
}

async function flush() {
  if (flushTimer !== undefined) window.clearTimeout(flushTimer);
  flushTimer = undefined;
  if (pending.size === 0) return;
  const batch = Array.from(pending.values());
  pending.clear();
  for (const vital of batch) reported.add(vital.name);
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    await supabase.from("analytics_events").insert(buildRows(batch));
  } catch { // empty-catch-allow:telemetry-fire-and-forget
    // swallow — vitals telemetry must not break the app
  }
}

/**
 * MP-514: the flush used when the document is going away. See beacon.ts — a
 * network call placed after `await` in a pagehide handler is never issued at
 * all, so every terminal vitals batch was lost. LCP in particular is usually
 * still in `pending` when a bounce visitor leaves, which is exactly the
 * session whose load performance is worth knowing about.
 *
 * `pending` is only cleared once the request is issued; otherwise the entries
 * are handed back to flush(), which still works on a tab-switch hide.
 */
function flushTerminal() {
  if (pending.size === 0) return;
  const batch = Array.from(pending.values());
  if (beaconAnalyticsRows(buildRows(batch))) {
    pending.clear();
    for (const vital of batch) reported.add(vital.name);
    if (flushTimer !== undefined) window.clearTimeout(flushTimer);
    flushTimer = undefined;
    return;
  }
  void flush();
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
  // A page that is ALREADY hidden when this runs was loaded in the background:
  // firstHiddenTime 0 discards every one of its entries, which is the whole
  // point. Read here rather than at module scope so the value describes this
  // page load and not whenever the chunk happened to be imported.
  firstHiddenTime = document.visibilityState === "hidden" ? 0 : Infinity;

  // LCP
  try {
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1];
      if (last && !observedWhileHidden(last)) enqueue({ name: "LCP", value: last.startTime, rating: last.startTime < 2500 ? "good" : last.startTime < 4000 ? "needs-improvement" : "poor" });
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
        // DELIBERATELY NOT guarded on firstHiddenTime, unlike LCP above. Two of
        // this instance's 596 live INP rows are inflated by a backgrounded
        // frame, and the guard that would remove them also discards every
        // interaction a visitor makes after their first tab-switch — which is
        // ordinary behaviour, not a defect, and a far larger population than
        // the two rows. LCP is reported once against navigation start, so
        // discarding it post-hide costs nothing; INP accumulates over the whole
        // visit. Buying a 0.34% cleanup with an unmeasured share of real
        // interactions is the trade this repo keeps calling a fix.
        if (entry.duration > 40) {
          enqueue({ name: "INP", value: entry.duration, rating: entry.duration < 200 ? "good" : entry.duration < 500 ? "needs-improvement" : "poor" });
        }
      }
    }).observe({ type: "event", buffered: true, durationThreshold: 40 } as EventTimingObserverInit);
  } catch { // empty-catch-allow:telemetry-fire-and-forget
  }

  // MP-525 moved this from `window` to `document`: visibilitychange is dispatched
  // AT the Document and reaches a window-scoped listener only by BUBBLING.
  // MP-528 MEASURED the flag MP-525 called unobservable from this repo's test env
  // -- real Chrome 151, page genuinely hidden, both positive controls green:
  // event.bubbles is TRUE and a window listener DOES receive it. So the pre-MP-525
  // window form was NOT losing tab-switch terminal batches; nothing was recovered
  // by the move. The document form is kept because it is correct under BOTH values
  // of a flag this code should not have to assume, and matches the six other
  // visibilitychange registrations in src/. Re-measure any time:
  //   node scripts/measure-visibilitychange-bubbles.mjs   (exit 1 = it stopped bubbling)
  // pagehide is different and deliberately left on window: it is fired AT the Window.
  // The hide instant must be recorded BEFORE the batch drains: buffered
  // observers replay entries after the fact, and an entry that arrives once the
  // page is hidden has to be judged against a firstHiddenTime that already
  // knows about this hide.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      markHidden(performance.now());
      flushTerminal();
    }
  });
  window.addEventListener("pagehide", () => {
    markHidden(performance.now());
    flushTerminal();
  });
}
