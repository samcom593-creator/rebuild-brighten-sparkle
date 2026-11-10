// WP3 forward-only cutoff (system_settings.wp3_recruit_sla_cutoff), shared by
// send-followup-emails and calendly-backfill. No imports.
//
// The value is Postgres timestamptz::text, e.g. "2026-11-10 21:21:26.375973+00".
// V8's Date.parse rejects the bare "+00" offset (it wants "+00:00"), so a naive
// parse returns NaN and every gate built on it would silently send nothing forever.

/** Epoch ms of the cutoff, or NaN when the value is missing or unreadable (callers then send nothing). */
export function parseWp3Cutoff(value: unknown): number {
  if (typeof value !== "string" || !value.trim()) return NaN;
  const iso = value.trim().replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
  return Date.parse(iso);
}
