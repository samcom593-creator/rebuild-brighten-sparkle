// Time and number formatting for the IG desk. Ages are computed from UTC instants the RPC
// already measured; only DISPLAY is America/Phoenix (the 2026-08-07 dashboard WoW class of bug
// was two timezones mixed inside one operand).
const PHOENIX = "America/Phoenix";

function ms(from: string | number | Date | null | undefined): number | null {
  if (from == null) return null;
  const t = new Date(from).getTime();
  return Number.isFinite(t) ? t : null;
}

/** '4m' / '7h' / '4d' from an instant; '' when unknown. Never 'ago' here, rows read '4d'. */
export function shortAge(from: string | number | Date | null | undefined, now: number = Date.now()): string {
  const t = ms(from);
  if (t == null) return "";
  const diff = Math.max(0, now - t);
  const m = Math.round(diff / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

/** '4m ago' for the header caption only. */
export function shortAgo(from: string | number | Date | null | undefined, now: number = Date.now()): string {
  const a = shortAge(from, now);
  return a ? `${a} ago` : "never";
}

/** 'in 4h' / 'in 2d' for a future instant; '' when past or unknown. */
export function shortUntil(to: string | number | Date | null | undefined, now: number = Date.now()): string {
  const t = ms(to);
  if (t == null || t <= now) return "";
  return `in ${shortAge(now - (t - now), now)}`;
}

/** '6:40pm' in Phoenix. */
export function phoenixTime(at: string | number | Date | null | undefined): string {
  const t = ms(at);
  if (t == null) return "";
  return new Date(t)
    .toLocaleTimeString("en-US", { timeZone: PHOENIX, hour: "numeric", minute: "2-digit" })
    .replace(" ", "")
    .toLowerCase();
}

/** 'tue 3:30pm' in Phoenix. */
export function phoenixDayTime(at: string | number | Date | null | undefined): string {
  const t = ms(at);
  if (t == null) return "";
  const day = new Date(t).toLocaleDateString("en-US", { timeZone: PHOENIX, weekday: "short" }).toLowerCase();
  return `${day} ${phoenixTime(t)}`;
}

/** Integer percent as '24%', or '–' when the denominator is zero (never '0%' for no data). */
export function pctOf(n: number | null | undefined, d: number | null | undefined): string {
  if (!d) return "–";
  return `${Math.round((100 * (n ?? 0)) / d)}%`;
}

export function fmtInt(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString("en-US");
}

/** The next 9:00am Phoenix, as an ISO instant. */
export function tomorrowNinePhoenix(now: number = Date.now()): string {
  // Phoenix never observes DST: UTC-7 all year, so the offset is a constant.
  const PHX_OFFSET_MS = 7 * 3_600_000;
  const local = new Date(now - PHX_OFFSET_MS);
  const next = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1, 9, 0, 0) + PHX_OFFSET_MS;
  return new Date(next).toISOString();
}
