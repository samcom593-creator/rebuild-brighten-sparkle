/**
 * Per-viewer Calendar preferences (view + filters), kept in localStorage.
 *
 * A convenience, not state: storage can be absent, full or throwing (private
 * mode, blocked site data), so every read/write is wrapped and the page falls
 * back to defaults. Keyed per user so two people sharing a browser keep their
 * own layout.
 */
export const CALENDAR_VIEWS = ["agenda", "day", "week", "month"] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

export type CalendarPrefs = {
  view: CalendarView;
  kinds: string[];
  showCanceled: boolean;
};

export const DEFAULT_CALENDAR_PREFS: CalendarPrefs = { view: "agenda", kinds: [], showCanceled: false };

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function calendarPrefsKey(userId: string | null | undefined): string {
  return `calendar.prefs.v1:${userId ?? "anon"}`;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function sanitizeCalendarPrefs(raw: unknown, knownKinds?: readonly string[]): CalendarPrefs {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const view = CALENDAR_VIEWS.includes(src.view as CalendarView) ? (src.view as CalendarView) : DEFAULT_CALENDAR_PREFS.view;
  const kinds = Array.isArray(src.kinds)
    ? Array.from(new Set(src.kinds.filter((k): k is string => typeof k === "string" && (!knownKinds || knownKinds.includes(k)))))
    : [];
  const showCanceled = typeof src.showCanceled === "boolean" ? src.showCanceled : DEFAULT_CALENDAR_PREFS.showCanceled;
  return { view, kinds, showCanceled };
}

export function loadCalendarPrefs(
  userId: string | null | undefined,
  knownKinds?: readonly string[],
  storage: StorageLike | null = defaultStorage(),
): CalendarPrefs {
  if (!storage) return { ...DEFAULT_CALENDAR_PREFS };
  try {
    const text = storage.getItem(calendarPrefsKey(userId));
    if (!text) return { ...DEFAULT_CALENDAR_PREFS };
    return sanitizeCalendarPrefs(JSON.parse(text), knownKinds);
  } catch {
    return { ...DEFAULT_CALENDAR_PREFS };
  }
}

/** Returns false when the preference could not be stored (the page still works). */
export function saveCalendarPrefs(
  userId: string | null | undefined,
  prefs: CalendarPrefs,
  storage: StorageLike | null = defaultStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(calendarPrefsKey(userId), JSON.stringify(sanitizeCalendarPrefs(prefs)));
    return true;
  } catch {
    return false;
  }
}
