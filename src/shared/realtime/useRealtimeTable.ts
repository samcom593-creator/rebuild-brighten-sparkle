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
}

/**
 * Standardized Postgres-changes subscription.
 * - One channel per (table, filter, suffix)
 * - Auto-unsubscribes on unmount or dependency change
 * - `onChange` is captured in a ref so callers don't need to memoize
 */
export function useRealtimeTable<T = any>(
  options: UseRealtimeTableOptions,
  onChange: (payload: { eventType: ChangeEvent; new: T | null; old: T | null }) => void
) {
  const { table, event = "*", filter, enabled = true, channelSuffix = "default" } = options;
  const handlerRef = useRef(onChange);
  handlerRef.current = onChange;

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
          handlerRef.current({
            eventType: payload.eventType as ChangeEvent,
            new: (payload.new as T) ?? null,
            old: (payload.old as T) ?? null,
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [table, event, filter, enabled, channelSuffix]);
}
