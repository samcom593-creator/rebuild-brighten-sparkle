// Shared by calendly-webhook and calendly-backfill (WP3, 2026-11-10). Both write the
// same interview_events row (upsert on calendly_event_uri), so two private copies of
// these rules let the 15-minute backfill silently overwrite what the webhook decided.
// No imports: this file must never pull an SDK copy into either bundle.

/**
 * Route classification. Returns a track for every event; "other" is a real, storable
 * track, never a reason to drop the booking. Allowed values mirror the
 * interview_events_call_track_check constraint.
 */
export function classifyCalendlyEvent(name: string | null, slug: string | null): string {
  const nameLc = (name ?? "").toLowerCase().trim();
  const txt = `${name ?? ""} ${slug ?? ""}`.toLowerCase().trim();
  if (txt.includes("seminar")) return "seminar";
  if (txt.includes("exam") || txt.includes("test")) return "exam";
  // "Licensing Call" contains neither "licensed" nor "unlicensed", so it used to fall
  // through to "other" (the client final-expense track). It is the unlicensed lane's
  // own call; check it before the licensed rules.
  if (txt.includes("licensing")) return "licensing";
  // The renamed "Manager Call" (slug licensed-prospect-call-clone-1) is for existing
  // agents (MP-309). Its slug contains "licensed", which filed agent calls on the
  // licensed-recruit track. Judge it by its name.
  if (nameLc.includes("manager call")) return "other";
  // "unlicensed" CONTAINS "licensed"; this check must run first (fixed 2026-08-01).
  if (txt.includes("unlicensed")) return "leader";
  if (txt.includes("licensed")) return "licensed";
  if (txt.includes("leader")) return "leader";
  if (txt.includes("interview") || txt.includes("1on1") || txt.includes("prospect") || txt.includes("manager")) {
    return "leader";
  }
  return "other";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The application id our own booking links carry as Calendly utm_content. Returns a
 * lower-cased uuid or null. The caller must still confirm the application exists.
 */
export function utmApplicationId(tracking: unknown): string | null {
  if (!tracking || typeof tracking !== "object") return null;
  const raw = (tracking as Record<string, unknown>).utm_content;
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  return UUID_RE.test(v) ? v.toLowerCase() : null;
}

/** True when a Calendly invitee carries a no-show mark (invitee.no_show is an object or null). */
export function inviteeIsNoShow(invitee: unknown): boolean {
  if (!invitee || typeof invitee !== "object") return false;
  const ns = (invitee as Record<string, unknown>).no_show;
  return !!ns && typeof ns === "object";
}
