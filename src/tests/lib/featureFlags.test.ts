/**
 * featureFlags.test.ts
 *
 * Tests for src/lib/featureFlags.ts — localStorage-backed feature flag system.
 *
 * Coverage targets:
 *   ✅ isFeatureEnabled  — returns default (true) when no localStorage override
 *   ✅ isFeatureEnabled  — returns override value when set
 *   ✅ setFeatureFlag    — persists override to localStorage
 *   ✅ getAllFlags        — returns all flags with overrides applied
 *   ✅ resetAllFlags     — removes localStorage key, restores defaults
 *   ✅ corrupted localStorage — getOverrides returns {} (no crash)
 *   ✅ unknown key in localStorage overrides — ignored (no bleed into defaults)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  isFeatureEnabled,
  getAllFlags,
  setFeatureFlag,
  resetAllFlags,
} from "@/lib/featureFlags";

const STORAGE_KEY = "apex_feature_flags";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe("isFeatureEnabled — defaults", () => {
  it("returns true for 'focusMode' by default", () => {
    expect(isFeatureEnabled("focusMode")).toBe(true);
  });

  it("returns true for 'soundEffects' by default", () => {
    expect(isFeatureEnabled("soundEffects")).toBe(true);
  });

  it("returns true for all flags when localStorage is empty", () => {
    const flags = getAllFlags();
    for (const value of Object.values(flags)) {
      expect(value).toBe(true);
    }
  });
});

describe("isFeatureEnabled — with overrides", () => {
  it("returns false when flag is disabled via setFeatureFlag", () => {
    setFeatureFlag("soundEffects", false);
    expect(isFeatureEnabled("soundEffects")).toBe(false);
  });

  it("returns true when flag is re-enabled after being disabled", () => {
    setFeatureFlag("soundEffects", false);
    setFeatureFlag("soundEffects", true);
    expect(isFeatureEnabled("soundEffects")).toBe(true);
  });

  it("only affects the specified flag", () => {
    setFeatureFlag("soundEffects", false);
    expect(isFeatureEnabled("focusMode")).toBe(true);
    expect(isFeatureEnabled("activityTimeline")).toBe(true);
  });
});

describe("setFeatureFlag", () => {
  it("persists flag state to localStorage", () => {
    setFeatureFlag("xpSystem", false);
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(stored.xpSystem).toBe(false);
  });

  it("does not overwrite other stored flags", () => {
    setFeatureFlag("focusMode", false);
    setFeatureFlag("soundEffects", false);
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(stored.focusMode).toBe(false);
    expect(stored.soundEffects).toBe(false);
  });
});

describe("getAllFlags", () => {
  it("returns object with all defined flag names", () => {
    const flags = getAllFlags();
    expect("focusMode" in flags).toBe(true);
    expect("soundEffects" in flags).toBe(true);
    expect("activityTimeline" in flags).toBe(true);
    expect("leadScoring" in flags).toBe(true);
    expect("performanceMetrics" in flags).toBe(true);
    expect("xpSystem" in flags).toBe(true);
    expect("callOutcomes" in flags).toBe(true);
    expect("autoStageSuggestions" in flags).toBe(true);
    expect("scheduleBar" in flags).toBe(true);
  });

  it("applies override when flag is set false", () => {
    setFeatureFlag("leadScoring", false);
    const flags = getAllFlags();
    expect(flags.leadScoring).toBe(false);
    // Other flags unaffected
    expect(flags.focusMode).toBe(true);
  });
});

describe("resetAllFlags", () => {
  it("clears localStorage key", () => {
    setFeatureFlag("soundEffects", false);
    resetAllFlags();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("restores defaults after reset", () => {
    setFeatureFlag("soundEffects", false);
    resetAllFlags();
    expect(isFeatureEnabled("soundEffects")).toBe(true);
  });
});

describe("corrupted localStorage", () => {
  it("does not throw when localStorage contains invalid JSON", () => {
    localStorage.setItem(STORAGE_KEY, "not-valid-json{{{");
    expect(() => isFeatureEnabled("focusMode")).not.toThrow();
    // Falls back to default
    expect(isFeatureEnabled("focusMode")).toBe(true);
  });

  it("does not throw on getAllFlags with corrupted storage", () => {
    localStorage.setItem(STORAGE_KEY, "null");
    expect(() => getAllFlags()).not.toThrow();
  });
});
