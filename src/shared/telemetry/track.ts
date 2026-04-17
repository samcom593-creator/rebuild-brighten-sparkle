import { supabase } from "@/integrations/supabase/client";

/**
 * Centralized analytics emitter.
 * - Buffers events client-side and flushes in batches (every 5s, on hide, or when queue >= 20).
 * - Auto-attaches session + user context.
 * - Failures are swallowed; telemetry must never break product flows.
 */

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

let queue: QueuedEvent[] = [];
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

async function flush() {
  if (queue.length === 0) return;
  const batch = queue.splice(0);
  const sessionId = getSessionId();
  const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : null;

  try {
    await supabase.from("analytics_events").insert(
      batch.map((evt) => ({
        event_name: evt.event_name,
        event_category: evt.event_category,
        properties: (evt.properties ?? {}) as any,
        url: evt.url ?? (typeof window !== "undefined" ? window.location.pathname : null),
        user_id: evt.user_id ?? currentUserId,
        session_id: sessionId,
        user_agent: userAgent,
      }))
    );
  } catch {
    // swallow — telemetry must not throw
  }
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
  queue.push({ event_name: eventName, event_category: category, properties });
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
    if (document.visibilityState === "hidden") void flush();
  });
  window.addEventListener("pagehide", () => void flush());
}
