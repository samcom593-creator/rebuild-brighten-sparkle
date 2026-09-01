import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

type ChangeEvent = "INSERT" | "UPDATE" | "DELETE" | "*";

interface UseRealtimeTableOptions {
  /** Table name in the public schema */
  table: string;
  /** Event(s) to listen for. Default: "*" */
  event?: ChangeEvent;
  /** Optional Postgres filter, e.g. `"agent_id=eq.${id}"` */
  filter?: string;
  /** Whether the subscription should be active. Default: true */
  enabled?: boolean;
  /** Stable channel suffix (helps avoid collisions when multiple components watch the same table) */
  channelSuffix?: string;
  /**
   * Trailing-debounce window in ms. A burst of row events inside the window
   * results in exactly ONE `onChange` call, carrying the LAST payload.
   *
   * WHY THIS EXISTS (2026-08-31, MP-361). Every row event called `onChange`
   * synchronously. `deals` is written in bursts — measured at 11 rows in a
   * single second over the last 48h — and ImoByAgency's handler invalidates
   * four react-query keys, from a component that mounts at three render sites.
   * The result was measured in the edge logs: 27 identical
   * `GET /v_imo_by_agency` requests inside ONE second. That view costs ~1.9s
   * per read, so a burst queues past the 8s statement timeout and PostgREST
   * returns 500 (`error=57014`) — 195 of 269 reads of that view failed in 24h.
   *
   * The damage is not confined to the admin surface that causes it. While the
   * database is jammed, unrelated requests time out too, which is how
   * apex-financial.org's PUBLIC data layer 500s: landing_live_stats and
   * landing_recent_applicants were collateral in exactly these windows. Error
   * minutes carry LOW throughput (46-515 requests) while the busiest minute
   * measured (4,606 requests) had zero errors — this is starvation from burst
   * concurrency, not load.
   *
   * Opt-in rather than a default, because a caller that reads `payload.new`
   * per row would silently lose events. Only set it where the handler ignores
   * the payload.
   */
  coalesceMs?: number;
}

/**
 * Standardized Postgres-changes subscription.
 * - One channel per (table, filter, suffix)
 * - Auto-unsubscribes on unmount or dependency change
 * - `onChange` is captured in a ref so callers don't need to memoize
 * - Optionally coalesces bursts via `coalesceMs` (see that option)
 */
export function useRealtimeTable<T = any>(
  options: UseRealtimeTableOptions,
  onChange: (payload: { eventType: ChangeEvent; new: T | null; old: T | null }) => void
) {
  const { table, event = "*", filter, enabled = true, channelSuffix = "default", coalesceMs = 0 } = options;
  const handlerRef = useRef(onChange);
  handlerRef.current = onChange;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const channelName = `rt:${table}:${channelSuffix}:${filter ?? "all"}`;
    const channel: RealtimeChannel = supabase
      .channel(channelName)
      .on(
        "postgres_changes" as any,
        {
          event,
          schema: "public",
          table,
          ...(filter ? { filter } : {}),
        },
        (payload: any) => {
          const deliver = () => {
            handlerRef.current({
              eventType: payload.eventType as ChangeEvent,
              new: (payload.new as T) ?? null,
              old: (payload.old as T) ?? null,
            });
          };
          if (coalesceMs <= 0) {
            deliver();
            return;
          }
          // Trailing edge: the burst fires once, after it has stopped. A
          // leading-edge call would still let the first event of every burst
          // stampede, which is the case being fixed.
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => {
            timerRef.current = null;
            deliver();
          }, coalesceMs);
        }
      )
      .subscribe();

    return () => {
      // Drop any pending coalesced delivery: firing it after unmount would
      // invalidate queries for a screen nobody is looking at, which is the
      // same wasted round-trip this option exists to prevent.
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      supabase.removeChannel(channel);
    };
  }, [table, event, filter, enabled, channelSuffix, coalesceMs]);
}
