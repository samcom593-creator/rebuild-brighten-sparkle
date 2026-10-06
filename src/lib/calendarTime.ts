/**
 * Calendar time formatting — pure, zone-explicit, DST-correct.
 *
 * Every appointment instant is a UTC timestamp (timestamptz). What changes per
 * surface is the ZONE it is read in:
 *   - the event's own zone (interview_events.event_tz / calendar_events.metadata.event_tz),
 *     the wall time the booking was made in;
 *   - the viewer's zone (the browser's resolved IANA zone);
 *   - the business zone, America/Phoenix, used only for day buckets and "today".
 *
 * Nothing here uses a fixed UTC offset. America/Phoenix has no DST, but
 * America/New_York, America/Chicago etc. do, and a fixed "-05:00" is wrong for
 * half the year. All conversions go through Intl with an IANA zone.
 */

export const BUSINESS_TZ = "America/Phoenix";

/** Zones offered in pickers. Any valid IANA zone is still accepted. */
export const COMMON_ZONES: { value: string; label: string }[] = [
  { value: "America/Phoenix", label: "Arizona (Phoenix, no DST)" },
  { value: "America/Los_Angeles", label: "Pacific (Los Angeles)" },
  { value: "America/Denver", label: "Mountain (Denver)" },
  { value: "America/Chicago", label: "Central (Chicago)" },
  { value: "America/New_York", label: "Eastern (New York)" },
  { value: "Pacific/Honolulu", label: "Hawaii (Honolulu)" },
  { value: "America/Anchorage", label: "Alaska (Anchorage)" },
  { value: "Asia/Manila", label: "Philippines (Manila)" },
];

export function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The browser's IANA zone, or the business zone when it cannot be resolved. */
export function viewerTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidTimeZone(tz) ? tz : BUSINESS_TZ;
  } catch {
    return BUSINESS_TZ;
  }
}

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function partsInZone(instant: Date, tz: string): Parts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const out: Record<string, number> = {};
  for (const p of fmt.formatToParts(instant)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return {
    year: out.year, month: out.month, day: out.day,
    hour: out.hour === 24 ? 0 : out.hour, minute: out.minute, second: out.second,
  };
}

/** Offset of `tz` from UTC at `instant`, in minutes (e.g. -300 for EST). */
export function zoneOffsetMinutes(instant: Date, tz: string): number {
  const p = partsInZone(instant, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const truncated = Math.floor(instant.getTime() / 1000) * 1000;
  return Math.round((asUtc - truncated) / 60000);
}

/** "YYYY-MM-DD" of an instant as seen in `tz`. */
export function dateKeyInZone(iso: string | Date, tz: string): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const p = partsInZone(d, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** "HH:mm" (24h) of an instant as seen in `tz` — for <input type="time">. */
export function timeValueInZone(iso: string | Date, tz: string): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const p = partsInZone(d, tz);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/**
 * Convert a wall-clock date + time in `tz` to the UTC instant (ISO string).
 *
 * DST edges, resolved deterministically:
 *   - a wall time that does not exist (spring-forward gap, e.g. 02:30 on the
 *     second Sunday of March in New York) moves FORWARD by the gap (03:30);
 *   - a wall time that exists twice (fall-back overlap, e.g. 01:30 on the first
 *     Sunday of November) resolves to the EARLIER instant (daylight time).
 */
export function zonedWallTimeToUtc(dateKey: string, time: string, tz: string): string {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  const tm = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!dm || !tm) throw new Error(`invalid date/time: ${dateKey} ${time}`);
  if (!isValidTimeZone(tz)) throw new Error(`invalid time zone: ${tz}`);
  const [y, mo, d] = [Number(dm[1]), Number(dm[2]), Number(dm[3])];
  const [h, mi] = [Number(tm[1]), Number(tm[2])];
  const wallAsUtc = Date.UTC(y, mo - 1, d, h, mi, 0);

  // Candidate instants using the zone's offset just before and just after the
  // wall time; at most two distinct offsets apply around any DST transition.
  const offsets = new Set<number>([
    zoneOffsetMinutes(new Date(wallAsUtc - 36 * 3600_000), tz),
    zoneOffsetMinutes(new Date(wallAsUtc + 36 * 3600_000), tz),
    zoneOffsetMinutes(new Date(wallAsUtc), tz),
  ]);
  const matches: number[] = [];
  for (const off of offsets) {
    const candidate = wallAsUtc - off * 60000;
    const p = partsInZone(new Date(candidate), tz);
    if (p.year === y && p.month === mo && p.day === d && p.hour === h && p.minute === mi) {
      matches.push(candidate);
    }
  }
  if (matches.length > 0) return new Date(Math.min(...matches)).toISOString();

  // Nonexistent wall time (gap): use the offset in force BEFORE the gap, which
  // lands the same distance past the transition — i.e. shifted forward.
  const before = zoneOffsetMinutes(new Date(wallAsUtc - 36 * 3600_000), tz);
  return new Date(wallAsUtc - before * 60000).toISOString();
}

/** Short zone label at an instant: "EDT", "EST", "MST", or "GMT+8" where no abbreviation exists. */
export function zoneAbbreviation(iso: string | Date, tz: string): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" })
    .formatToParts(d)
    .find((p) => p.type === "timeZoneName");
  return part?.value ?? tz;
}

/** "9:00 AM" in `tz`. */
export function formatClock(iso: string | Date, tz: string): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(d);
}

/** "Thu, Nov 5" in `tz`. */
export function formatDay(iso: string | Date, tz: string): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(d);
}

export type EventTimeLabel = {
  /** Time in the event's own zone, e.g. "10:00 AM EST". */
  eventLabel: string;
  /** The zone the event label used. */
  eventZone: string;
  /** True when the event carries no stored zone and the label fell back to the business zone. */
  zoneUnknown: boolean;
  /** Same instant in the viewer's zone, e.g. "8:00 AM MST" — null when identical to eventLabel. */
  viewerLabel: string | null;
  /** True when the viewer's calendar day differs from the event zone's day. */
  viewerDayDiffers: boolean;
  /** Day of the instant in the viewer's zone, "Thu, Nov 5" — set only when it differs. */
  viewerDay: string | null;
};

/**
 * The label every calendar row renders: the event's own wall time with its
 * zone, plus the viewer's local time when that reads differently.
 */
export function describeEventTime(iso: string, eventTz: string | null | undefined, viewerTz: string): EventTimeLabel {
  const zoneUnknown = !isValidTimeZone(eventTz);
  const eventZone = zoneUnknown ? BUSINESS_TZ : (eventTz as string);
  const eventLabel = `${formatClock(iso, eventZone)} ${zoneAbbreviation(iso, eventZone)}`;
  const viewerZone = isValidTimeZone(viewerTz) ? viewerTz : BUSINESS_TZ;
  const viewerText = `${formatClock(iso, viewerZone)} ${zoneAbbreviation(iso, viewerZone)}`;
  const sameOffset = zoneOffsetMinutes(new Date(iso), eventZone) === zoneOffsetMinutes(new Date(iso), viewerZone);
  const viewerDayDiffers = dateKeyInZone(iso, eventZone) !== dateKeyInZone(iso, viewerZone);
  return {
    eventLabel,
    eventZone,
    zoneUnknown,
    viewerLabel: sameOffset ? null : viewerText,
    viewerDayDiffers,
    viewerDay: viewerDayDiffers ? formatDay(iso, viewerZone) : null,
  };
}

/** Human label for an IANA zone from COMMON_ZONES, else the IANA name itself. */
export function zoneDisplayName(tz: string | null | undefined): string {
  if (!tz) return "Zone not recorded";
  return COMMON_ZONES.find((z) => z.value === tz)?.label ?? tz;
}
