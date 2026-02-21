/**
 * Client-side feature flag system.
 * Defaults are all ON (preserving existing behavior).
 * Admin can override via localStorage key `apex_feature_flags`.
 */

export type FeatureFlagName =
  | "focusMode"
  | "soundEffects"
  | "activityTimeline"
  | "leadScoring"
  | "performanceMetrics"
  | "xpSystem"
  | "callOutcomes"
  | "autoStageSuggestions"
  | "scheduleBar";

const DEFAULT_FLAGS: Record<FeatureFlagName, boolean> = {
  focusMode: true,
  soundEffects: true,
  activityTimeline: true,
  leadScoring: true,
  performanceMetrics: true,
  xpSystem: true,
  callOutcomes: true,
  autoStageSuggestions: true,
  scheduleBar: true,
};

const STORAGE_KEY = "apex_feature_flags";

export const FEATURE_FLAG_LABELS: Record<FeatureFlagName, string> = {
  focusMode: "Focus Mode",
  soundEffects: "Sound Effects",
  activityTimeline: "Activity Timeline",
  leadScoring: "Lead Scoring",
  performanceMetrics: "Performance Metrics",
  xpSystem: "XP / Gamification System",
  callOutcomes: "Call Outcome Tracking",
  autoStageSuggestions: "Auto-Stage Suggestions",
  scheduleBar: "Global Schedule Bar",
};

function getOverrides(): Partial<Record<FeatureFlagName, boolean>> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return {};
}

export function isFeatureEnabled(flag: FeatureFlagName): boolean {
  const overrides = getOverrides();
  return overrides[flag] ?? DEFAULT_FLAGS[flag] ?? true;
}

export function getAllFlags(): Record<FeatureFlagName, boolean> {
  const overrides = getOverrides();
  const result = { ...DEFAULT_FLAGS };
  for (const key of Object.keys(overrides) as FeatureFlagName[]) {
    if (key in result) {
      result[key] = overrides[key]!;
    }
  }
  return result;
}

export function setFeatureFlag(flag: FeatureFlagName, enabled: boolean): void {
  const overrides = getOverrides();
  overrides[flag] = enabled;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
}

export function resetAllFlags(): void {
  localStorage.removeItem(STORAGE_KEY);
}
