/**
 * Notification preferences form state (F34).
 *
 * The Settings form seeds itself from hardcoded defaults and then upserts the
 * whole row. Before this module, Save was gated only on "still loading", so a
 * failed initial read left the defaults editable and one click wrote them over
 * whatever the server held. The gate below says when a save is informed:
 *
 *   record     a successful read returned the stored row
 *   new        a successful read returned no row (a confirmed new record)
 *   error      the read failed and nothing has ever loaded; saving is blocked
 *   loading    nothing has completed yet
 *   signed-out no user once auth has finished loading
 *
 * A failed refresh that follows a successful read keeps the last good read
 * (record or new): the form is still informed, and the caller shows it stale.
 */

export type NotificationState = {
  achievement_alert: boolean;
  deal_celebration: boolean;
  discord_enabled: boolean;
  morning_huddle: boolean;
  weekly_summary: boolean;
};

export type NotificationPrefsRead = "loading" | "signed-out" | "error" | "record" | "new";

export interface NotificationPrefsReadInput {
  hasUser: boolean;
  /** Auth still resolving the session: no user yet is not the same as signed out. */
  authLoading: boolean;
  /** TanStack v5: no result has ever loaded for this key. Votes loading ahead of isError. */
  isPending: boolean;
  isError: boolean;
  /** undefined = nothing loaded; null = completed read with no row; object = the stored row. */
  data: unknown;
}

export const NOTIFICATION_PREF_DEFAULTS: NotificationState = {
  achievement_alert: true,
  deal_celebration: true,
  discord_enabled: false,
  morning_huddle: true,
  weekly_summary: true,
};

export function notificationPrefsRead(input: NotificationPrefsReadInput): NotificationPrefsRead {
  if (!input.hasUser) return input.authLoading ? "loading" : "signed-out";
  // A result on hand always wins, even when a later refresh failed: the last
  // successful read is what the form was seeded from.
  if (input.data !== undefined) return input.data === null ? "new" : "record";
  // A read that has not completed is loading, whatever else the flags say.
  if (input.isPending) return "loading";
  if (input.isError) return "error";
  return "loading";
}

/** Saving is only informed after a completed read: the stored row, or a confirmed absence of one. */
export function canSaveNotificationPrefs(read: NotificationPrefsRead): boolean {
  return read === "record" || read === "new";
}

type NullableRow = Partial<Record<keyof NotificationState, boolean | null | undefined>>;

/** Seed the form from a stored row; a null column falls back to the form default for that key. */
export function notificationPrefsFromRow(row: NullableRow | null | undefined): NotificationState {
  const out: NotificationState = { ...NOTIFICATION_PREF_DEFAULTS };
  if (!row) return out;
  for (const key of Object.keys(out) as Array<keyof NotificationState>) {
    const value = row[key];
    if (typeof value === "boolean") out[key] = value;
  }
  return out;
}
