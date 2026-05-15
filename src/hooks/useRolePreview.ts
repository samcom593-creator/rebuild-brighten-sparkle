import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

export type RolePreview = "agent" | "manager" | "admin";

const PREVIEW_ROLES: RolePreview[] = ["agent", "manager", "admin"];

export function isRolePreview(value: string | null): value is RolePreview {
  return Boolean(value && PREVIEW_ROLES.includes(value as RolePreview));
}

export function useRolePreview() {
  const { isAdmin, isManager } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedPreview = searchParams.get("previewRole");
  const actualRole: RolePreview = isAdmin ? "admin" : isManager ? "manager" : "agent";
  const previewRole = isAdmin && isRolePreview(requestedPreview) ? requestedPreview : null;

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
    canPreviewRoles: isAdmin,
    setPreviewRole,
  };
}
