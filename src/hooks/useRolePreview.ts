import { isSamEmail } from "@/lib/samOnly";
import { useSearchParams } from "react-router-dom";
import { useAuth, type AccountMode } from "@/hooks/useAuth";

// MP-332: preview covers every account mode, not just agent/manager/admin, so
// Sam can open the Agency Owner / Pure Recruiter / VA homes as himself.
export type RolePreview = AccountMode;

const PREVIEW_ROLES: RolePreview[] = ["agent", "manager", "agency_owner", "recruiter", "va", "va_manager", "admin"];

export function isRolePreview(value: string | null): value is RolePreview {
  return Boolean(value && PREVIEW_ROLES.includes(value as RolePreview));
}

export function useRolePreview() {
  const { user, effectiveMode } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedPreview = searchParams.get("previewRole");
  // The person's real mode comes from useAuth (admin wins, then the admin-set
  // account_mode, then roles). Before MP-332 this was a 3-way ternary that
  // silently routed recruiters and agency owners to the agent home.
  const actualRole: RolePreview = effectiveMode;

  const isSam = isSamEmail(user?.email);
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
