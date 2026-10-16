/**
 * F34: notification preferences can only be saved after a completed read.
 * A failed initial read must never leave the defaults saveable; a confirmed
 * no-row read must still let a new user save.
 */
import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_PREF_DEFAULTS,
  canSaveNotificationPrefs,
  notificationPrefsFromRow,
  notificationPrefsRead,
} from "@/lib/notificationPrefsState";

const base = { hasUser: true, authLoading: false, isPending: false, isError: false, data: undefined as unknown };

describe("notificationPrefsRead", () => {
  it("is loading while auth has no user yet, and signed-out once auth has settled without one", () => {
    expect(notificationPrefsRead({ ...base, hasUser: false, authLoading: true, isPending: true })).toBe("loading");
    expect(notificationPrefsRead({ ...base, hasUser: false, authLoading: false, isPending: true })).toBe("signed-out");
  });

  it("is loading until the first read completes", () => {
    expect(notificationPrefsRead({ ...base, isPending: true })).toBe("loading");
    expect(notificationPrefsRead(base)).toBe("loading");
  });

  it("votes loading on isPending ahead of the error flag: a read that has not completed is not a failed one", () => {
    expect(notificationPrefsRead({ ...base, isPending: true, isError: true })).toBe("loading");
  });

  it("is error when the first read failed and nothing has loaded", () => {
    expect(notificationPrefsRead({ ...base, isError: true })).toBe("error");
  });

  it("is new for a completed read with no row, and record for a stored row", () => {
    expect(notificationPrefsRead({ ...base, data: null })).toBe("new");
    expect(notificationPrefsRead({ ...base, data: { morning_huddle: false } })).toBe("record");
  });

  it("keeps the last successful read when a later refresh fails", () => {
    expect(notificationPrefsRead({ ...base, isError: true, data: { morning_huddle: false } })).toBe("record");
    expect(notificationPrefsRead({ ...base, isError: true, data: null })).toBe("new");
  });
});

describe("canSaveNotificationPrefs", () => {
  it("allows a save only after a stored row or a confirmed new record", () => {
    expect(canSaveNotificationPrefs("record")).toBe(true);
    expect(canSaveNotificationPrefs("new")).toBe(true);
    expect(canSaveNotificationPrefs("error")).toBe(false);
    expect(canSaveNotificationPrefs("loading")).toBe(false);
    expect(canSaveNotificationPrefs("signed-out")).toBe(false);
  });

  it("blocks the exact F34 case: the initial read failed, so the defaults are not saveable", () => {
    const read = notificationPrefsRead({ ...base, isError: true, isPending: false, data: undefined });
    expect(canSaveNotificationPrefs(read)).toBe(false);
  });
});

describe("notificationPrefsFromRow", () => {
  it("returns the defaults for no row", () => {
    expect(notificationPrefsFromRow(null)).toEqual(NOTIFICATION_PREF_DEFAULTS);
    expect(notificationPrefsFromRow(undefined)).toEqual(NOTIFICATION_PREF_DEFAULTS);
  });

  it("takes stored booleans and falls back per key on null", () => {
    const seeded = notificationPrefsFromRow({ morning_huddle: false, weekly_summary: null, discord_enabled: true });
    expect(seeded.morning_huddle).toBe(false);
    expect(seeded.weekly_summary).toBe(NOTIFICATION_PREF_DEFAULTS.weekly_summary);
    expect(seeded.discord_enabled).toBe(true);
    expect(seeded.achievement_alert).toBe(NOTIFICATION_PREF_DEFAULTS.achievement_alert);
  });

  it("does not mutate the shared defaults", () => {
    const before = { ...NOTIFICATION_PREF_DEFAULTS };
    notificationPrefsFromRow({ morning_huddle: false });
    expect(NOTIFICATION_PREF_DEFAULTS).toEqual(before);
  });
});
