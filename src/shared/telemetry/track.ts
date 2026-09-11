// wave-19 (2026-06-04): supabase pulled out of module-scope static graph.
// track() is a fire-and-queue fast path; flush() runs only after >=5s
// (FLUSH_INTERVAL_MS) or 20 queued events or visibility-change. Lazy-loading
// the supabase chunk at flush-time removes this edge from the eager landing
// graph, which dropped vendor-supabase out of cold modulepreload.

/**
 * Centralized analytics emitter.
 * - Buffers events client-side and flushes in batches (every 5s, on hide, or when queue >= 20).
 * - Auto-attaches session + user context.
 * - Failures are swallowed; telemetry must never break product flows.
 */

import { beaconAnalyticsRows } from "./beacon";

type EventCategory = "navigation" | "auth" | "interaction" | "performance" | "error" | "system";

interface QueuedEvent {
  event_name: string;
  event_category: EventCategory;
  properties?: Record<string, unknown>;
  url?: string | null;
  user_id?: string | null;
}

const SESSION_KEY = "apex.telemetry.session";
const FLUSH_INTERVAL_MS = 5000;
const MAX_BATCH = 20;

const queue: QueuedEvent[] = [];
let flushTimer: number | undefined;
let currentUserId: string | null = null;

function getSessionId(): string {
  if (typeof window === "undefined") return "ssr";
  let id = sessionStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

function scheduleFlush() {
  if (flushTimer) window.clearTimeout(flushTimer);
  flushTimer = window.setTimeout(flush, FLUSH_INTERVAL_MS);
}

function buildRows(batch: QueuedEvent[]) {
  const sessionId = getSessionId();
  const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : null;
  return batch.map((evt) => ({
    event_name: evt.event_name,
    event_category: evt.event_category,
    properties: (evt.properties ?? {}) as any,
    url: evt.url ?? null,
    user_id: evt.user_id ?? currentUserId,
    session_id: sessionId,
    user_agent: userAgent,
  }));
}

async function flush() {
  if (queue.length === 0) return;
  const batch = queue.splice(0);

  try {
    const { supabase } = await import("@/integrations/supabase/client");
    await supabase.from("analytics_events").insert(buildRows(batch));
  } catch { // empty-catch-allow:telemetry-fire-and-forget
    // swallow — telemetry must not throw
  }
}

/**
 * MP-514: the flush used when the document is going away.
 *
 * flush() above is unusable here. It awaits a dynamic import before it touches
 * the network, and a continuation scheduled after the document is discarded
 * never runs — measured in Chromium across two exit fixtures, warm chunk and
 * cold chunk alike (see beacon.ts). Every terminal batch was lost in full.
 *
 * The queue is only emptied once the request is actually issued. If the beacon
 * cannot be sent we hand the events back to flush() rather than dropping them:
 * on a tab-switch hide the page survives and the async path still works, and a
 * queue silently discarded is a worse failure than a queue written late.
 */
function flushTerminal() {
  if (queue.length === 0) return;
  if (beaconAnalyticsRows(buildRows(queue))) {
    queue.splice(0);
    if (flushTimer) window.clearTimeout(flushTimer);
    flushTimer = undefined;
    return;
  }
  void flush();
}

/** Update the active user id (called by AuthProvider on session changes). */
export function setTelemetryUser(userId: string | null) {
  currentUserId = userId;
}

/** Emit a custom event. Safe to call anywhere, including SSR (no-op). */
export function track(
  eventName: string,
  category: EventCategory = "interaction",
  properties?: Record<string, unknown>
) {
  if (typeof window === "undefined") return;
  // MP-513: the page is captured HERE, when the event happens -- not in flush().
  // flush() is debounced (scheduleFlush clears and restarts the 5s timer on every
  // event) and drains after navigation, so reading window.location at drain time
  // stamped each row with wherever the user had got to by then. Measured on the
  // one event class that records its own path: 9,532 of 36,048 page_views (26.44%)
  // carried a url contradicting their own properties.path.
  queue.push({
    event_name: eventName,
    event_category: category,
    properties,
    url: window.location.pathname,
  });
  if (queue.length >= MAX_BATCH) {
    void flush();
  } else {
    scheduleFlush();
  }
}

/** Initialize global flush triggers. Call once at app boot. */
export function initTelemetry() {
  if (typeof window === "undefined") return;
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushTerminal();
  });
  window.addEventListener("pagehide", () => flushTerminal());
}
