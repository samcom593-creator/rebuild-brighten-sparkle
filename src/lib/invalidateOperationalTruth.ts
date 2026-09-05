import type { QueryClient } from "@tanstack/react-query";

/**
 * Refresh every surface that represents the same live operating facts.
 *
 * Deal and hire mutations used to refresh only their local list. That left the
 * home scoreboard, team totals, recruiting counts, and leaderboards stale until
 * their multi-minute polling interval elapsed. Keep the fan-out in one place so
 * a new dashboard cannot silently miss the mutation receipt.
 */
export const OPERATIONAL_TRUTH_QUERY_KEYS = [
  "apex-home-dashboard",
  "scoped-production-scoreboard",
  "crm-today-production",
  "imo-by-agency",
  "leaderboard",
  "production",
  "production-metrics",
  "producer-pulse",
  "admin-operations-command-center",
  "manager-team-view",
  "team-overview",
  "builder-operating-dashboard",
  "recruiting-quick-view",
  "onboarding-pipeline",
  "applications",
  "interviews",
  "deals",
  "deals-count",
  "news-feed",
] as const;

export interface InvalidateOperationalTruthOptions {
  /**
   * MP-436 — whether to echo a local "production-realtime-update" window event.
   *
   * TRUE (default) is for MUTATION call sites: the writer refreshes every other
   * surface in the tab immediately instead of waiting for the Postgres packet.
   *
   * FALSE is MANDATORY for anything invoked BY that event — `useProductionRealtime`
   * listens for it, so a broadcasting listener closes a ring that re-drives
   * itself every debounce period on zero row changes. Live 2026-08-27 -> 2026-09-05,
   * this rang `apex_admin_home_dashboard`, `scoped_production_scoreboard` and
   * `imo_by_agency_period` at ~45/min for as long as a dashboard tab was open.
   * Enforced by scripts/check-realtime-feedback-loop.mjs.
   */
  broadcast?: boolean;
}

export function invalidateOperationalTruth(
  queryClient: QueryClient,
  options: InvalidateOperationalTruthOptions = {},
): void {
  const { broadcast = true } = options;
  for (const key of OPERATIONAL_TRUTH_QUERY_KEYS) {
    // MP-431: reuse an in-flight fetch instead of aborting it — the database
    // keeps executing an abandoned statement to completion.
    void queryClient.invalidateQueries({ queryKey: [key] }, { cancelRefetch: false });
  }

  // Same-tab mutations do not produce a Postgres realtime packet quickly
  // enough to make the interaction feel instant. This local receipt refreshes
  // subscribers now; the durable database event remains the cross-device path.
  if (broadcast && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("production-realtime-update"));
  }
}
