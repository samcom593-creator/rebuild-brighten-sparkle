import { useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useDebouncedRefetch } from "./useDebouncedRefetch";

/**
 * Centralized realtime hook for daily_production updates.
 * Uses a singleton pattern - only ONE channel for the entire app.
 * All components share this channel and get debounced updates.
 */

let sharedChannel: ReturnType<typeof supabase.channel> | null = null;
let subscriberCount = 0;

const PRODUCTION_UPDATE_EVENT = "production-realtime-update";

export function useProductionRealtime(onUpdate: () => void, delay = 800) {
  const debouncedCallback = useDebouncedRefetch(onUpdate, delay);

  const handleUpdate = useCallback(() => {
    debouncedCallback();
  }, [debouncedCallback]);

  useEffect(() => {
    subscriberCount++;

    // Create shared channel if it doesn't exist
    if (!sharedChannel) {
      sharedChannel = supabase
        .channel("production-global-shared")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "daily_production" },
          () => {
            // Broadcast to all subscribers via custom event
            window.dispatchEvent(new CustomEvent(PRODUCTION_UPDATE_EVENT));
          }
        )
        .subscribe();
    }

    // Listen for broadcast updates
    window.addEventListener(PRODUCTION_UPDATE_EVENT, handleUpdate);

    return () => {
      subscriberCount--;
      window.removeEventListener(PRODUCTION_UPDATE_EVENT, handleUpdate);

      // Only remove channel when no subscribers remain
      if (subscriberCount === 0 && sharedChannel) {
        supabase.removeChannel(sharedChannel);
        sharedChannel = null;
      }
    };
  }, [handleUpdate]);
}
