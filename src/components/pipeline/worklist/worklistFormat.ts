import type { StaffMember } from "./useRecruitingWorklist";

/** Display helpers for the recruiting worklist. Times are always shown with an explicit zone. */

const VIEWER_ZONE = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch (error) {
    // empty-catch-allow: Intl unavailable; UTC is the explicit, labelled fallback
    void error;
    return "UTC";
  }
})();

export function viewerTimeZone(): string {
  return VIEWER_ZONE;
}

export function formatWhen(value: string | null | undefined, timeZone = VIEWER_ZONE): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Unreadable date";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  }).format(d);
}

export function formatDay(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Unreadable date";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(d);
}

/** "3h ago" / "in 2d" relative to now; exact time belongs in the title attribute. */
export function formatRelative(value: string | null | undefined, now = Date.now()): string {
  if (!value) return "—";
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) return "Unreadable date";
  const diff = ms - now;
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60_000);
  const label = mins < 60 ? `${mins}m` : mins < 60 * 48 ? `${Math.round(mins / 60)}h` : `${Math.round(mins / 1440)}d`;
  if (mins < 1) return "now";
  return diff < 0 ? `${label} ago` : `in ${label}`;
}

/** Plain-English span for people who don't read "18d": "3 hours", "2 days", "3 weeks". */
export function plainSpan(ms: number): string {
  const mins = Math.max(1, Math.round(Math.max(0, ms) / 60_000));
  if (mins < 60) return `${mins} ${mins === 1 ? "minute" : "minutes"}`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days} ${days === 1 ? "day" : "days"}`;
  const weeks = Math.round(days / 7);
  if (weeks < 9) return `${weeks} weeks`;
  const months = Math.round(days / 30);
  return `${months} months`;
}

/** "today", "yesterday", "3 days ago" for a past moment. Future or unreadable values say so. */
export function formatSince(value: string | null | undefined, now = Date.now()): string {
  if (!value) return "never";
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) return "on an unreadable date";
  const elapsed = Math.max(0, now - ms);
  if (elapsed < 60 * 60_000) return "just now";
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  if (ms >= startOfToday.getTime()) return "today";
  if (ms >= startOfToday.getTime() - 24 * 60 * 60_000) return "yesterday";
  return `${plainSpan(elapsed)} ago`;
}

/** "3:00 PM MST": the time with its zone, in the viewer's zone. */
export function formatTimeWithZone(value: string | null | undefined, timeZone = VIEWER_ZONE): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Unreadable date";
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone, timeZoneName: "short" }).format(d);
}

/** A due time as people say it: "3:00 PM" today, "Tomorrow 10:00 AM", "Thu 10:00 AM", "Nov 12". */
export function formatDueShort(value: string | null | undefined, now = Date.now()): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Unreadable date";
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const dayMs = 24 * 60 * 60_000;
  const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(d);
  const offset = Math.floor((d.getTime() - startOfToday.getTime()) / dayMs);
  if (offset === 0) return time;
  if (offset === 1) return `Tomorrow ${time}`;
  if (offset > 1 && offset < 7) return `${new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(d)} ${time}`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(d);
}

/** The person's current local time, only when a verified zone is stored. */
export function personLocalTime(timeZone: string | null | undefined, now = new Date()): string | null {
  if (!timeZone) return null;
  try {
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone, timeZoneName: "short" }).format(now);
  } catch (error) {
    // empty-catch-allow: an invalid stored zone renders as unverified rather than a wrong time
    void error;
    return null;
  }
}

/** ISO -> value for <input type="datetime-local"> in the viewer's zone. */
export function isoToLocalInput(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A system-suggested next action reads as a suggestion, not a shout: "CALL WITHIN 60 MIN" -> "Suggested: call within 60 min". */
export function formatNextAction(action: string, setByPerson: boolean): string {
  if (setByPerson) return action;
  const words = action.replace(/_/g, " ").trim().toLowerCase().replace(/\b(sms|npn|nipr)\b/g, (m) => m.toUpperCase());
  return `Suggested: ${words}`;
}

export function humanizeKey(value: string | null | undefined): string {
  if (!value) return "—";
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export const VERIFIED_ZONE_OPTIONS = [
  { value: "America/New_York", label: "Eastern" },
  { value: "America/Chicago", label: "Central" },
  { value: "America/Denver", label: "Mountain" },
  { value: "America/Phoenix", label: "Arizona" },
  { value: "America/Los_Angeles", label: "Pacific" },
  { value: "America/Anchorage", label: "Alaska" },
  { value: "Pacific/Honolulu", label: "Hawaii" },
] as const;

/** The accountable owner's name. Never invents a name; says when it cannot know. */
export function ownerName(ownerId: string | null, staff: StaffMember[], staffAvailable: boolean): string {
  if (!ownerId) return "Unassigned";
  const hit = staff.find((s) => s.user_id === ownerId);
  if (hit) return hit.display_name;
  return staffAvailable ? "No longer staff" : "Assigned (name unavailable)";
}
