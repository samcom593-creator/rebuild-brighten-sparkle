// Normalize raw db enum slugs (agent.status, agent.license_status,
// application.pipeline_stage, etc.) into user-facing Title Case labels.
//
// Same class of leak wave-9/11/13/14 fixed piecemeal on LicensedInbox,
// AdminProducerTrends, SamTodo, and AgentProfileDrawer. Extracted here in
// wave-18 (2026-07-06) as part of the raw-db-slug-leak class-of-fix so every
// surface that renders an enum can route through one canonical formatter.
//
// Behavior:
//   - `null` or empty → `fallback`.
//   - Known key (lowercase) → mapped label.
//   - Otherwise: snake_case / kebab-case / space-separated → Title Case.

const KNOWN_LABELS: Record<string, string> = {
  active: "Active",
  inactive: "Inactive",
  terminated: "Terminated",
  pending: "Pending",
  licensed: "Licensed",
  unlicensed: "Unlicensed",
  contract_sent: "Contract Sent",
  contract_signed: "Contract Signed",
  hired: "Hired",
  applied: "Applied",
  interviewed: "Interviewed",
  onboarding: "Onboarding",
  in_review: "In Review",
  approved: "Approved",
  rejected: "Rejected",
  live: "Live",
};

export function formatEnumLabel(
  raw: string | null | undefined,
  fallback: string = "—"
): string {
  if (!raw) return fallback;
  const key = raw.toLowerCase();
  if (KNOWN_LABELS[key]) return KNOWN_LABELS[key];
  return raw
    .split(/[_\s-]+/)
    .map((s) => (s.length ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s))
    .join(" ");
}
