export interface LandingLiveStats {
  active_agents: number | null;
  applications_30d: number | null;
  carriers_partnered: number | null;
}

/** Missing counts stay unknown. A verified zero is a valid count. */
export function parseLandingLiveStats(value: unknown): LandingLiveStats {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Agency numbers are unavailable.");
  }
  const row = value as Record<string, unknown>;
  const count = (input: unknown): number | null =>
    typeof input === "number" && Number.isSafeInteger(input) && input >= 0 ? input : null;
  const stats = {
    active_agents: count(row.active_agents),
    applications_30d: count(row.applications_30d),
    carriers_partnered: count(row.carriers_partnered),
  };
  if (Object.values(stats).every((item) => item === null)) {
    throw new Error("Agency numbers are unavailable.");
  }
  return stats;
}
