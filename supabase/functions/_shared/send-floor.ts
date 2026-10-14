// PL-WIB-COURSE-ENROLL-FLOOR (2026-10-09). The verdict for requireSendAuth's
// "staff_or_agent" floor, kept free of Deno.env so its test runs under
// check:deno-tests, which grants --allow-read only.
//
// 'agent' is deliberately NOT a staff role: handle_new_user gives it to every
// signup, and signup is open. The agents ROW is what separates a real agent
// from a stranger.

export const STAFF_ROLES = new Set(["admin", "super_admin", "manager", "va_manager", "va", "recruiter"]);

/**
 * Pure verdict for the "staff_or_agent" floor, so it is testable without a
 * database. A failed read is 503: refusing on a read error would lock real
 * agents out silently, and admitting on one would fail open.
 */
export function staffOrAgentVerdict(
  roles: Array<{ role: unknown }> | null,
  rolesError: unknown,
  agentRows: Array<unknown> | null,
  agentError: unknown,
): { ok: boolean; status: number; error?: string } {
  if (rolesError) return { ok: false, status: 503, error: "sender auth unavailable" };
  if ((roles ?? []).some((r) => STAFF_ROLES.has(String(r.role)))) return { ok: true, status: 200 };
  if (agentError) return { ok: false, status: 503, error: "sender auth unavailable" };
  if ((agentRows ?? []).length > 0) return { ok: true, status: 200 };
  return { ok: false, status: 403, error: "forbidden: requires staff or an agent record" };
}

/**
 * Pure verdict for the "staff" floor (PL-WIB-STAFF-PAGE-SENDERS). Staff roles
 * only: no agents-row fallback, because these senders sit on pages no agent
 * can reach (/dashboard/recruiting, /admin/unlicensed-all), and an agents row
 * would admit every agent to a button they never see. A failed roles read is
 * 503, same reasoning as staffOrAgentVerdict.
 */
export function staffVerdict(
  roles: Array<{ role: unknown }> | null,
  rolesError: unknown,
): { ok: boolean; status: number; error?: string } {
  if (rolesError) return { ok: false, status: 503, error: "sender auth unavailable" };
  if ((roles ?? []).some((r) => STAFF_ROLES.has(String(r.role)))) return { ok: true, status: 200 };
  return { ok: false, status: 403, error: "forbidden: requires a staff role" };
}

/**
 * Does this request present the service key? (PL-WIB-SERVICE-KEY-APIKEY,
 * 2026-10-14.) Two shapes carry it, and both are the same secret:
 *   - `Authorization: Bearer <key>`: pg_net triggers, raw fetch callers, and
 *     supabase-js up to 2.110.0.
 *   - `apikey: <key>` with NO Authorization header: supabase-js 2.111.0 and
 *     later (npm 2026-07-28) send an sb_secret_ key this way from
 *     functions.invoke(). Measured: 2.110.0 sends both, 2.111.0..2.117.3 send
 *     only apikey. A function importing `@supabase/supabase-js@2` unpinned
 *     (add-agent, backfill-plaque-images) is bundled with the newer behaviour,
 *     so a gate that read Authorization alone refused it with 401.
 * An empty service key never matches, so a missing env var cannot fail open.
 */
export function presentsServiceKey(headers: Headers, serviceKey: string): boolean {
  if (!serviceKey) return false;
  const bearer = (headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (bearer && safeEqual(bearer, serviceKey)) return true;
  const apikey = (headers.get("apikey") ?? "").trim();
  return apikey !== "" && safeEqual(apikey, serviceKey);
}

/** Length-independent constant-time string compare. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
