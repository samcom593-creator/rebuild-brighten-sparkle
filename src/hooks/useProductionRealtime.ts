import { useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useDebouncedRefetch } from "./useDebouncedRefetch";

/**
 * Centralized realtime hook for truth-critical dashboard updates.
 * Uses a singleton pattern so dashboard surfaces refresh together when
 * native deals, external production, applications, or agents change.
 */

let sharedChannel: ReturnType<typeof supabase.channel> | null = null;
let subscriberCount = 0;

const PRODUCTION_UPDATE_EVENT = "production-realtime-update";

/**
 * MP-388 — row changes are coalesced BEFORE they become a window event.
 *
 * MEASURED 2026-09-01: every agentlink sync UPDATEs ~1,068 `deals` rows over
 * ~2 minutes (pg_stat_user_tables: 229,200 updates on a 1,817-row table).
 * Each row is a postgres_changes event; the per-subscriber 800ms throttle
 * below turned that into ~150 refetches of apex_admin_home_dashboard,
 * scoped_production_scoreboard AND imo_by_agency_period per sync — 137 home
 * calls in one 10-minute window at 4,452ms mean, 187 statement timeouts in
 * 24h. The timeouts burn statement_timeout (8s) of IO, the instance stalls,
 * and pg_cron drops whole ticks (106 fires / 26 jobs in 24h, every one inside
 * a dashboard session).
 *
 * The fix is a quiet-period debounce with a ceiling: a single deal post
 * refreshes QUIET_MS after it lands; a bulk sync refreshes at most once per
 * MAX_WAIT_MS while it runs and once more when it ends. The 5-minute poll
 * this hook replaced was 10x slower than the ceiling, so nothing Sam sees is
 * later than it used to be.
 */
export const REALTIME_COALESCE_QUIET_MS = 2_000;
export const REALTIME_COALESCE_MAX_WAIT_MS = 30_000;

let coalesceTimer: ReturnType<typeof setTimeout> | null = null;
let burstStartedAt: number | null = null;

function flushCoalesced() {
  coalesceTimer = null;
  burstStartedAt = null;
  window.dispatchEvent(new CustomEvent(PRODUCTION_UPDATE_EVENT));
}

function onRowChange() {
  const now = Date.now();
  if (burstStartedAt === null) burstStartedAt = now;
  if (coalesceTimer) clearTimeout(coalesceTimer);
  const untilCeiling = REALTIME_COALESCE_MAX_WAIT_MS - (now - burstStartedAt);
  coalesceTimer = setTimeout(
    flushCoalesced,
    Math.max(0, Math.min(REALTIME_COALESCE_QUIET_MS, untilCeiling)),
  );
}

function clearCoalesced() {
  if (coalesceTimer) clearTimeout(coalesceTimer);
  coalesceTimer = null;
  burstStartedAt = null;
}

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
          onRowChange
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "deals" },
          onRowChange
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "applications" },
          onRowChange
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "production_external_deals" },
          onRowChange
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "production_external_daily_snapshots" },
          onRowChange
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "agents" },
          onRowChange
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
        // Nobody is listening — a pending flush would refetch for no screen.
        clearCoalesced();
      }
    };
  }, [handleUpdate]);
}
