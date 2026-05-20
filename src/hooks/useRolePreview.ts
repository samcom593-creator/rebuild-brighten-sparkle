import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

export type RolePreview = "agent" | "manager" | "admin";

const PREVIEW_ROLES: RolePreview[] = ["agent", "manager", "admin"];

export function isRolePreview(value: string | null): value is RolePreview {
  return Boolean(value && PREVIEW_ROLES.includes(value as RolePreview));
}

// PL-015: the role-preview bubbles are a dev/internal-only tool. Showing them
// to every admin was confusing — agents on staff with admin grants saw the
// switcher and thought it was a feature. Restrict to Sam (the only operator
// who actually previews flows). Identification by email keeps the gate
// declarative + portable (no hard-coded user_id in source).
const SAM_EMAILS = new Set<string>([
  "sam.com593@gmail.com",
  "sam@apex-financial.org",
]);

export function useRolePreview() {
  const { user, isAdmin, isManager } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedPreview = searchParams.get("previewRole");
  const actualRole: RolePreview = isAdmin ? "admin" : isManager ? "manager" : "agent";

  const isSam = !!(user?.email && SAM_EMAILS.has(user.email.toLowerCase()));
  const previewRole = isSam && isRolePreview(requestedPreview) ? requestedPreview : null;

  const setPreviewRole = (role: RolePreview | null) => {
    const next = new URLSearchParams(searchParams);
    if (role) next.set("previewRole", role);
    else next.delete("previewRole");
    setSearchParams(next, { replace: true });
  };

  return {
    actualRole,
    effectiveRole: previewRole ?? actualRole,
    isPreviewing: Boolean(previewRole),
    previewRole,
    canPreviewRoles: isSam,
    setPreviewRole,
  };
}
