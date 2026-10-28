// policyStatusGroup — one vocabulary for "is this policy active, pending, lapsing, inactive, or do we
// not know" (Sam, 2026-10-28, Book of Business filters). Mirrors v_book_flip_worklist.status_group, which
// groups the carrier statuses the same way, so the Book of Business chips and Book Flips agree:
//   active   = Active | Approved (plus In Force / Issued / Paid from the native vocabulary)
//   pending  = In Review | Issued, Not Paid | Pending | submitted
//   lapsing  = Lapse Pending | Lapsed
//   inactive = Cancelled | Declined | Not Taken | Withdrawn (plus Charged Back)
//   unknown  = Unknown, blank, or a source marker that is not a policy status (reported_external)
export type StatusGroupKey = "active" | "pending" | "lapsing" | "inactive" | "unknown";

export const STATUS_GROUP_CHIPS: { key: StatusGroupKey; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "pending", label: "Pending" },
  { key: "lapsing", label: "Lapsing" },
  { key: "inactive", label: "Inactive" },
  { key: "unknown", label: "Status unknown" },
];

const GROUP: Record<string, StatusGroupKey> = {
  active: "active", approved: "active", inforce: "active", in_force: "active", issued: "active", paid: "active",
  in_review: "pending", issued_not_paid: "pending", pending: "pending", submitted: "pending", postponed: "pending",
  lapse_pending: "lapsing", lapsed: "lapsing",
  cancelled: "inactive", canceled: "inactive", declined: "inactive", not_taken: "inactive", withdrawn: "inactive",
  charged_back: "inactive", chargeback: "inactive", dead: "inactive", terminated: "inactive",
};

export function policyStatusGroup(status: string | null | undefined): StatusGroupKey {
  const key = (status ?? "").trim().toLowerCase().replace(/[\s,-]+/g, "_");
  return GROUP[key] ?? "unknown";
}

/** The literal status values each group holds, as the book writes them (ilike, so either casing matches). */
export const STATUS_GROUP_LITERALS: Readonly<Record<Exclude<StatusGroupKey, "unknown">, readonly string[]>> = {
  active: ["Active", "Approved", "In Force", "in_force", "Issued", "Paid"],
  pending: ["In Review", "in_review", "Issued, Not Paid", "issued_not_paid", "Pending", "submitted", "Postponed"],
  lapsing: ["Lapse Pending", "lapse_pending", "Lapsed"],
  inactive: ["Cancelled", "Canceled", "Declined", "Not Taken", "not_taken", "Withdrawn", "Charged Back", "charged_back", "Dead", "Terminated"],
};

const quote = (v: string) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/**
 * PostgREST `or=` filter for one group on v_production_unified.status, so a chip filters the server page
 * and the exact count, like the status tiles. "unknown" is a null status or none of the claimed literals,
 * which is how 969 Unknown rows, the submitted/reported markers and blanks all land in one place.
 */
export function statusGroupFilter(group: StatusGroupKey): string {
  if (group === "unknown") {
    const claimed = Object.values(STATUS_GROUP_LITERALS).flat().map((v) => `status.not.ilike.${quote(v)}`).join(",");
    return `status.is.null,and(${claimed})`;
  }
  return STATUS_GROUP_LITERALS[group].map((v) => `status.ilike.${quote(v)}`).join(",");
}

/** The group named in the URL, or null for anything that is not a known group. */
export function parseStatusGroup(value: string | null): StatusGroupKey | null {
  return value && STATUS_GROUP_CHIPS.some((c) => c.key === value) ? (value as StatusGroupKey) : null;
}
