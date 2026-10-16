/**
 * accessRequirement.ts: plain-English description of what a gated route needs.
 *
 * Pure. ProtectedRoute feeds it the same props it gates on, so the sentence a
 * denied visitor reads cannot drift from the check that denied them. The
 * server (RLS, SECURITY INVOKER views, gated RPCs) stays the real boundary;
 * this only explains the client-side gate.
 */
const ROLE_LABELS: Record<string, string> = {
  admin: "admin",
  manager: "manager",
  agent: "agent",
  va_manager: "VA manager",
  va: "VA",
  recruiter: "recruiter",
};

export interface AccessRequirementInput {
  requireAdmin?: boolean;
  allowManagers?: boolean;
  allowPresenters?: boolean;
  allowRoles?: readonly string[] | null;
}

/** Ordered, de-duplicated labels of the account kinds that may open the route. */
export function accessRequirementRoles(input: AccessRequirementInput): string[] {
  if (!input.requireAdmin) return [];
  const labels: string[] = ["admin"];
  if (input.allowManagers) labels.push("manager");
  if (input.allowPresenters) labels.push("active presenter");
  for (const role of input.allowRoles ?? []) {
    const label = ROLE_LABELS[role] ?? role.replace(/_/g, " ");
    if (!labels.includes(label)) labels.push(label);
  }
  return labels;
}

function joinWithOr(labels: readonly string[]): string {
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}`;
}

/** "an admin account", "an admin or manager account", "an admin, manager or VA manager account". */
export function describeAccessRequirement(input: AccessRequirementInput): string {
  const labels = accessRequirementRoles(input);
  if (labels.length === 0) return "a signed-in account";
  return `an ${joinWithOr(labels)} account`;
}

/** Where a denied visitor can always go. VA managers keep their own portal as home. */
export function safeHomeHref(input: { isVaManager?: boolean }): "/va-team" | "/dashboard" {
  return input.isVaManager ? "/va-team" : "/dashboard";
}
