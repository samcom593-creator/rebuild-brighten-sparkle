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
