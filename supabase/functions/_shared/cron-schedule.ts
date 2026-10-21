// PL-WIB-HEALTH-SLOT (2026-10-21). When may system-health-check re-fire an
// automation whose cron is on?
//
// It used to re-fire anything whose last automation_runs row was more than 26h
// old. A fixed bar does not know the schedule. apex-manager-daily-digest runs
// "0 13 * * 1-6" (no Sunday), so Saturday 13:00 + 26h = Sunday 15:00, and the
// health check would have sent all five managers (cc info@kingofsales.net) a
// digest every Sunday that the schedule leaves out on purpose. A health check
// that adds runs to a schedule is a second schedule.
//
// The verdict now reads the cron's own schedule: re-fire only when the most
// recent scheduled slot is at least GRACE old and has no run at or after it.
// Anything it cannot read (schedule, timezone) never fires: a state the check
// cannot grade is not an outage.
//
// pg_cron evaluates schedules in cron.timezone. This parser works in UTC, so
// the caller must refuse any other timezone instead of guessing.

const FIELDS: [number, number][] = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 7], // day of week, 0 and 7 are Sunday
];

type Parsed = { sets: Set<number>[]; domStar: boolean; dowStar: boolean };

function parseField(src: string, [lo, hi]: [number, number]): Set<number> | null {
  const out = new Set<number>();
  for (const part of src.split(",")) {
    const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
    if (!m) return null;
    let a = lo, b = hi;
    if (m[1] !== "*") {
      a = Number(m[2]);
      b = m[3] !== undefined ? Number(m[3]) : (m[4] !== undefined ? hi : a);
    }
    const step = m[4] !== undefined ? Number(m[4]) : 1;
    if (a < lo || b > hi || a > b || step < 1) return null;
    for (let v = a; v <= b; v += step) out.add(v);
  }
  return out.size ? out : null;
}

export function parseCron(schedule: string): Parsed | null {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) return null; // "@daily", "30 seconds", 6-field forms: not graded
  const sets: Set<number>[] = [];
  for (let i = 0; i < 5; i++) {
    const s = parseField(parts[i], FIELDS[i]);
    if (!s) return null;
    sets.push(s);
  }
  if (sets[4].has(7)) sets[4].add(0);
  return { sets, domStar: parts[2] === "*", dowStar: parts[4] === "*" };
}

function matches(p: Parsed, d: Date): boolean {
  const [min, hour, dom, mon, dow] = p.sets;
  if (!min.has(d.getUTCMinutes()) || !hour.has(d.getUTCHours()) || !mon.has(d.getUTCMonth() + 1)) return false;
  const domOk = dom.has(d.getUTCDate());
  const dowOk = dow.has(d.getUTCDay());
  // Vixie cron: when both day fields are restricted, either one matching is enough.
  if (!p.domStar && !p.dowStar) return domOk || dowOk;
  return domOk && dowOk;
}

/** The latest scheduled instant at or before `now` (UTC), or null if none in 35 days or unparseable. */
export function lastScheduledFire(schedule: string, now: Date): Date | null {
  const p = parseCron(schedule);
  if (!p) return null;
  const t = new Date(now.getTime());
  t.setUTCSeconds(0, 0);
  for (let i = 0; i < 35 * 1440; i++) {
    if (matches(p, t)) return new Date(t.getTime());
    t.setTime(t.getTime() - 60_000);
  }
  return null;
}

export const UTC_ZONES = new Set(["GMT", "UTC", "Etc/UTC", "Etc/GMT", "Z"]);
export const GRACE_MIN = 120;
export const TOLERANCE_MIN = 10;

export type SlotVerdict =
  | { fire: false; kind: "off" | "ungraded" | "in_grace" | "ran"; slot: Date | null; reason: string }
  | { fire: true; kind: "missed"; slot: Date; reason: string };

export function slotVerdict(args: {
  active: boolean;
  schedule: string | null;
  timezone: string | null;
  lastRunAt: Date | null;
  now: Date;
}): SlotVerdict {
  const { active, schedule, timezone, lastRunAt, now } = args;
  if (!active) return { fire: false, kind: "off", slot: null, reason: "schedule off" };
  if (!timezone || !UTC_ZONES.has(timezone)) {
    return { fire: false, kind: "ungraded", slot: null, reason: `cron.timezone ${timezone ?? "unreadable"} is not UTC; not graded` };
  }
  const slot = schedule ? lastScheduledFire(schedule, now) : null;
  if (!slot) return { fire: false, kind: "ungraded", slot: null, reason: `schedule '${schedule ?? ""}' not parseable; not graded` };
  if (lastRunAt && lastRunAt.getTime() >= slot.getTime() - TOLERANCE_MIN * 60_000) {
    return { fire: false, kind: "ran", slot, reason: `ran for the ${slot.toISOString()} slot` };
  }
  if (now.getTime() - slot.getTime() < GRACE_MIN * 60_000) {
    return { fire: false, kind: "in_grace", slot, reason: `${slot.toISOString()} slot is under ${GRACE_MIN}m old` };
  }
  return { fire: true, kind: "missed", slot, reason: `no run for the ${slot.toISOString()} slot` };
}

/** Stable per slot, so the check can see it already re-fired this slot and never storms. */
export function restartMarker(name: string, slot: Date): string {
  return `Auto-restarted ${name} for missed ${slot.toISOString()} slot`;
}
