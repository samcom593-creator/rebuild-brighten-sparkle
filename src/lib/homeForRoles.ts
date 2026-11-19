// Where a signed-in person belongs, by role. Mirrors the routing a password
// sign-in gets in Login.tsx, so a sign-in LINK lands the same person in the
// same place.
//
// Why it exists (2026-11-18): the "Email me a sign-in link" button mints a
// token whose destination is the generic "portal", and MagicLogin sent every
// "portal" link to /agent-portal. The owner, an admin, signed in by link and
// landed in the agent portal instead of his dashboard.
export function homeForRoles(roles: readonly (string | null | undefined)[], fallback = "agent-portal"): string {
  const has = (r: string) => roles.includes(r);
  if (has("va_manager")) return "va-team";
  if (has("admin") || has("manager")) return "dashboard";
  if (has("va")) return "admin/recovery-queue";
  return fallback;
}
