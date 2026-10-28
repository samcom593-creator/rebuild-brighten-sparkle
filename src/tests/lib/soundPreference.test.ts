import { afterEach, describe, expect, it, vi } from "vitest";

import { isSoundEnabled, setSoundEnabled, subscribeSoundPreference } from "@/lib/soundPreference";

describe("sound preference", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("is on until somebody turns it off", () => {
    expect(isSoundEnabled()).toBe(true);
    localStorage.setItem("apex_sound_enabled", "false");
    expect(isSoundEnabled()).toBe(false);
  });

  it("persists a change and tells subscribers once, until they unsubscribe", () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeSoundPreference(onChange);
    setSoundEnabled(false);
    expect(localStorage.getItem("apex_sound_enabled")).toBe("false");
    expect(isSoundEnabled()).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(1);
    unsubscribe();
    setSoundEnabled(true);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(isSoundEnabled()).toBe(true);
  });

  it("a change made in another tab reaches this one", () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeSoundPreference(onChange);
    window.dispatchEvent(new StorageEvent("storage", { key: "apex_sound_enabled", newValue: "false" }));
    window.dispatchEvent(new StorageEvent("storage", { key: "apex:theme:v2", newValue: "light" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
