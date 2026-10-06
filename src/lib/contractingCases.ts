/**
 * Contracting carrier cases — one case per (agent, carrier).
 *
 * The lifecycle map below is the SAME table the SQL view
 * v_contracting_carrier_cases implements (supabase/migrations/
 * 20261006100000_contracting_carrier_cases.sql, between the
 * `lifecycle-map:start` / `lifecycle-map:end` markers).
 * src/tests/lib/contractingCases.test.ts parses that block and fails if the two
 * disagree, so the page and the database can never label a status differently.
 *
 * Rules carried by the map:
 *   - "active" in AgentLink is the carrier contracting system's own approval and
 *     is the ONLY upstream status that reads as Verified Ready to Write. It is
 *     always shown with its source ("AgentLink sync") and the sync time.
 *   - "submitted" is not approval. Carrier Review / Approved exist only as a
 *     staff-recorded carrier stage on a submitted case.
 *   - Any status not in the map is "Unknown (needs review)" and waits on staff.
 *     It is never approved and never silently dropped.
 */

export const LIFECYCLES = [
  "not_started",
  "setup_documents",
  "ready_to_submit",
  "submitted",
  "carrier_review",
  "approved",
  "verified_ready_to_write",
  "additional_requirements",
  "declined",
  "closed",
  "unknown",
] as const;
export type ContractingLifecycle = (typeof LIFECYCLES)[number];

export const LIFECYCLE_LABELS: Record<ContractingLifecycle, string> = {
  not_started: "Not Started",
  setup_documents: "Setup / Documents",
  ready_to_submit: "Ready to Submit",
  submitted: "Submitted",
  carrier_review: "Carrier Review",
  approved: "Approved",
  verified_ready_to_write: "Verified Ready to Write",
  additional_requirements: "Additional Requirements",
  declined: "Declined",
  closed: "Closed",
  unknown: "Unknown (needs review)",
};

export const BLOCKERS = [
  "login_access",
  "wrong_agency",
  "missing_documents",
  "missing_comp_upline",
  "release_required",
  "existing_carrier_relationship",
  "upline_approval",
  "carrier_issue",
] as const;
export type BlockerType = (typeof BLOCKERS)[number];

export const BLOCKER_LABELS: Record<BlockerType, string> = {
  login_access: "Login / access",
  wrong_agency: "Wrong agency",
  missing_documents: "Missing documents",
  missing_comp_upline: "Missing comp / upline",
  release_required: "Release required",
  existing_carrier_relationship: "Existing carrier relationship",
  upline_approval: "Upline approval",
  carrier_issue: "Carrier issue",
};

export const WAITING_ON = ["agent", "staff", "carrier", "upline"] as const;
export type WaitingOn = (typeof WAITING_ON)[number];

export const WAITING_ON_LABELS: Record<WaitingOn, string> = {
  agent: "Agent",
  staff: "Staff",
  carrier: "Carrier",
  upline: "Upline",
};

export interface StatusMapping {
  lifecycle: ContractingLifecycle;
  blocker: BlockerType | null;
  waitingOn: WaitingOn | null;
}

/** AgentLink carrier status -> lifecycle / derived blocker / waiting-on party. */
export const AGENTLINK_STATUS_MAP: Readonly<Record<string, StatusMapping>> = {
  active: { lifecycle: "verified_ready_to_write", blocker: null, waitingOn: null },
  submitted: { lifecycle: "submitted", blocker: null, waitingOn: "carrier" },
  ready_to_contract: { lifecycle: "ready_to_submit", blocker: null, waitingOn: "staff" },
  requested: { lifecycle: "not_started", blocker: "upline_approval", waitingOn: "upline" },
  pending_upline_assignment: { lifecycle: "setup_documents", blocker: "missing_comp_upline", waitingOn: "upline" },
  incomplete_profile: { lifecycle: "setup_documents", blocker: "missing_documents", waitingOn: "agent" },
  issue: { lifecycle: "additional_requirements", blocker: "carrier_issue", waitingOn: "staff" },
  jail: { lifecycle: "additional_requirements", blocker: "carrier_issue", waitingOn: "staff" },
  rejected: { lifecycle: "declined", blocker: null, waitingOn: null },
};

export const UNKNOWN_STATUS_MAPPING: StatusMapping = { lifecycle: "unknown", blocker: null, waitingOn: "staff" };

/** Maps a raw AgentLink status. Unmapped or blank statuses are Unknown, never approved. */
export function mapAgentLinkStatus(status: string | null | undefined): StatusMapping {
  const key = (status ?? "").trim().toLowerCase();
  if (!key) return UNKNOWN_STATUS_MAPPING;
  return Object.prototype.hasOwnProperty.call(AGENTLINK_STATUS_MAP, key)
    ? AGENTLINK_STATUS_MAP[key]
    : UNKNOWN_STATUS_MAPPING;
}

/** AgentLink's own word for a status, readable. */
export function agentLinkStatusLabel(status: string | null | undefined): string {
  const key = (status ?? "").trim();
  if (!key) return "No status";
  return key.replace(/_/g, " ");
}

export function lifecycleLabel(lifecycle: string | null | undefined): string {
  return (LIFECYCLES as readonly string[]).includes(lifecycle ?? "")
    ? LIFECYCLE_LABELS[lifecycle as ContractingLifecycle]
    : LIFECYCLE_LABELS.unknown;
}

export function blockerLabel(blocker: string | null | undefined): string | null {
  if (!blocker) return null;
  return (BLOCKERS as readonly string[]).includes(blocker) ? BLOCKER_LABELS[blocker as BlockerType] : blocker.replace(/_/g, " ");
}

export function waitingOnLabel(party: string | null | undefined): string | null {
  if (!party) return null;
  return (WAITING_ON as readonly string[]).includes(party) ? WAITING_ON_LABELS[party as WaitingOn] : party;
}

export const PRESUBMIT_LABELS: Record<string, string> = {
  identity: "Identity linked by email/name only",
  npn: "No NPN on file",
  npn_mismatch: "NPN differs from AgentLink",
  agency: "Agency approval not confirmed",
  hierarchy: "No upline in AgentLink",
  comp: "No comp level for this carrier",
};

/** One row of v_contracting_carrier_cases, as returned by contracting_carrier_cases(). */
export interface CarrierCaseRow {
  agent_id: string;
  agent_name: string | null;
  agent_user_id: string | null;
  manager_id: string | null;
  manager_name: string | null;
  license_status: string | null;
  npn: string | null;
  al_user_id: number | null;
  match_basis: "agentlink_id" | "email" | "name" | string;
  agency_approval: string | null;
  upline_al_id: number | null;
  upline_name: string | null;
  carrier_name: string;
  carrier_level: string | null;
  al_status: string | null;
  al_synced_at: string | null;
  al_lifecycle: string;
  lifecycle: string;
  blocker: string | null;
  blocker_source: "agentlink" | "staff" | null;
  waiting_on: string | null;
  /** Staff-set waiting-on party; null means "derived from AgentLink". */
  waiting_on_override: string | null;
  /** Staff-set blocker ('none' = explicitly no blocker); null means "derived from AgentLink". */
  blocker_override: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  owner_source: "assigned" | "manager" | "unassigned" | string;
  next_action: string | null;
  follow_up_on: string | null;
  note: string | null;
  carrier_stage: "carrier_review" | "approved" | null;
  carrier_stage_at: string | null;
  closed_at: string | null;
  closed_reason: string | null;
  verified_at: string | null;
  verification_source: string | null;
  verified_by: string | null;
  evidence_ref: string | null;
  manual_verification_conflict: boolean;
  state_since: string | null;
  state_since_is_lower_bound: boolean | null;
  days_in_state: number | null;
  presubmit_missing: string[] | null;
  tracking_updated_at: string | null;
  q_agent_action: boolean;
  q_staff_action: boolean;
  q_support: boolean;
  q_carrier_review: boolean;
  q_follow_up_due: boolean;
  q_ready_to_submit: boolean;
  q_verified: boolean;
}

export type QueueColumn =
  | "q_agent_action"
  | "q_staff_action"
  | "q_support"
  | "q_carrier_review"
  | "q_follow_up_due"
  | "q_ready_to_submit"
  | "q_verified";

export interface CaseQueue {
  key: string;
  label: string;
  column: QueueColumn;
  hint: string;
}

/** Queue membership is decided by the database (q_* columns); this only names them. */
export const CASE_QUEUES: readonly CaseQueue[] = [
  { key: "agent_action", label: "Agent Action", column: "q_agent_action", hint: "Waiting on the agent" },
  { key: "staff_action", label: "Staff Action", column: "q_staff_action", hint: "Waiting on staff or the upline" },
  { key: "support", label: "Support", column: "q_support", hint: "Access, agency, release or carrier issues, and unknown statuses" },
  { key: "carrier_review", label: "Carrier Review", column: "q_carrier_review", hint: "Submitted, with the carrier" },
  { key: "follow_up_due", label: "Follow-Up Due", column: "q_follow_up_due", hint: "Follow-up date today or earlier (Phoenix)" },
  { key: "ready_to_submit", label: "Ready to Submit", column: "q_ready_to_submit", hint: "Set up and ready to send to the carrier" },
  { key: "verified", label: "Verified Ready to Write", column: "q_verified", hint: "Active in AgentLink or verified by staff with evidence" },
];

export interface QueueCount {
  cases: number;
  people: number;
}

/** Cases AND distinct people per queue. Queues overlap; never sum them. */
export function summarizeQueues(rows: readonly CarrierCaseRow[]): Record<string, QueueCount> {
  const out: Record<string, QueueCount> = {};
  for (const q of CASE_QUEUES) {
    const members = rows.filter((r) => r[q.column] === true);
    out[q.key] = { cases: members.length, people: new Set(members.map((r) => r.agent_id)).size };
  }
  return out;
}

export function distinctPeople(rows: readonly CarrierCaseRow[]): number {
  return new Set(rows.map((r) => r.agent_id)).size;
}

/** "3d", "≥ 3d" when the state was already in place when first observed, or null when unknown. */
export function daysInStateLabel(row: Pick<CarrierCaseRow, "days_in_state" | "state_since_is_lower_bound">): string | null {
  if (row.days_in_state == null) return null;
  return `${row.state_since_is_lower_bound ? "≥ " : ""}${row.days_in_state}d`;
}

function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Phoenix" });
}

/** Source + date for a verified case. Null when the case is not verified. */
export function verificationLabel(row: Pick<CarrierCaseRow, "lifecycle" | "verification_source" | "verified_at" | "al_status">): string | null {
  if (row.lifecycle !== "verified_ready_to_write") return null;
  const when = shortDate(row.verified_at);
  if (row.al_status === "active") return `AgentLink sync${when ? ` · synced ${when}` : ""}`;
  const source = row.verification_source?.trim();
  if (!source) return null;
  return `Verified by staff · ${source}${when ? ` · ${when}` : ""}`;
}

export interface ReadyToWriteSummary {
  verified: CarrierCaseRow[];
  /** lifecycle -> number of carriers in it, for every carrier NOT verified ready to write. */
  others: Array<{ lifecycle: ContractingLifecycle | "unknown"; label: string; count: number }>;
}

export function readyToWriteSummary(rows: readonly CarrierCaseRow[]): ReadyToWriteSummary {
  const verified = rows
    .filter((r) => r.lifecycle === "verified_ready_to_write")
    .sort((a, b) => a.carrier_name.localeCompare(b.carrier_name));
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (r.lifecycle === "verified_ready_to_write") continue;
    const key = (LIFECYCLES as readonly string[]).includes(r.lifecycle) ? r.lifecycle : "unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const others = LIFECYCLES.filter((l) => counts.has(l)).map((l) => ({
    lifecycle: l,
    label: LIFECYCLE_LABELS[l],
    count: counts.get(l) ?? 0,
  }));
  return { verified, others };
}

/**
 * True when the server refused the read on authorization grounds (42501).
 * That is the server's decision about who may see an agent's carriers, not a
 * load failure, so the profile card renders nothing instead of an error.
 */
export function isAccessRefusal(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "42501";
}
