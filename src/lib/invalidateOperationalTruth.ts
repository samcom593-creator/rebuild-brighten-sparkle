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

export function invalidateOperationalTruth(queryClient: QueryClient): void {
  for (const key of OPERATIONAL_TRUTH_QUERY_KEYS) {
    // MP-431: reuse an in-flight fetch instead of aborting it — the database
    // keeps executing an abandoned statement to completion.
    void queryClient.invalidateQueries({ queryKey: [key], cancelRefetch: false });
  }

  // Same-tab mutations do not produce a Postgres realtime packet quickly
  // enough to make the interaction feel instant. This local receipt refreshes
  // subscribers now; the durable database event remains the cross-device path.
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("production-realtime-update"));
  }
}
