/**
 * Personal invitation lifecycle — the client mirror of the server's rules in
 * supabase/migrations/20261006140000_invitation_lifecycle.sql.
 *
 * The SERVER is the authority: fn_invitation_status() decides the state,
 * fn_invite_authorize() decides who may offer which terms, and
 * invitation_claim() enforces expiry / revocation / supersession / recipient /
 * single use at accept time. This module exists so the UI can explain those
 * decisions before the round trip and render the same vocabulary; it never
 * grants anything the server would refuse.
 *
 * Public recruiting links (/r/<slug>) are a different system and are not
 * modelled here — nothing in this file can expire them.
 */

export type InvitationStatus = "pending" | "accepted" | "expired" | "revoked" | "superseded";

export const INVITATION_STATUSES: readonly InvitationStatus[] = [
  "pending",
  "accepted",
  "expired",
  "revoked",
  "superseded",
] as const;

export const INVITATION_STATUS_LABEL: Record<InvitationStatus, string> = {
  pending: "Pending",
  accepted: "Accepted",
  expired: "Expired",
  revoked: "Revoked",
  superseded: "Superseded",
};

export interface InvitationStatusInput {
  used_at?: string | null;
  superseded_by?: string | null;
  is_active?: boolean | null;
  revoked_at?: string | null;
  expires_at?: string | null;
}

/**
 * Same precedence as public.fn_invitation_status(): accepted wins over a later
 * revoke, superseded is reported as itself rather than as the revoke that
 * accompanies it, and a missing expiry counts as expired (unknown never
 * becomes "still usable").
 */
export function deriveInvitationStatus(row: InvitationStatusInput, now: Date = new Date()): InvitationStatus {
  if (row.used_at) return "accepted";
  if (row.superseded_by) return "superseded";
  if (row.is_active !== true || row.revoked_at) return "revoked";
  const expires = row.expires_at ? Date.parse(row.expires_at) : Number.NaN;
  if (!Number.isFinite(expires) || expires <= now.getTime()) return "expired";
  return "pending";
}

export function isTerminalStatus(status: InvitationStatus): boolean {
  return status !== "pending";
}

export interface InvitationActions {
  copy: boolean;
  share: boolean;
  revoke: boolean;
  regenerate: boolean;
}

/** What an authorized manager may do with an invitation in each state. */
export function invitationActions(status: InvitationStatus): InvitationActions {
  switch (status) {
    case "pending":
      return { copy: true, share: true, revoke: true, regenerate: true };
    case "expired":
    case "revoked":
      // A dead link is never copied back out; it can only be reissued.
      return { copy: false, share: false, revoke: false, regenerate: true };
    case "accepted":
    case "superseded":
    default:
      return { copy: false, share: false, revoke: false, regenerate: false };
  }
}

/** Server error codes a recipient can see on /hire/:token and /join/:token. */
export type AcceptanceErrorCode =
  | "invite_invalid"
  | "invite_already_used"
  | "invite_expired"
  | "invite_revoked"
  | "invite_superseded"
  | "invite_in_progress"
  | "recipient_mismatch"
  | "email_mismatch"
  | "identity_conflict";

/** Codes that mean the link itself is dead — render the invalid screen, no form. */
export const DEAD_LINK_CODES: ReadonlySet<string> = new Set([
  "invite_invalid",
  "invalid_or_used",
  "invite_already_used",
  "invite_expired",
  "invite_revoked",
  "invite_superseded",
]);

export function deadLinkMessage(code: string): string {
  switch (code) {
    case "invite_already_used":
      return "This link has already been used.";
    case "invite_expired":
      return "This link has expired.";
    case "invite_revoked":
      return "This link was revoked.";
    case "invite_superseded":
      return "This link was replaced by a newer one.";
    default:
      return "This link isn't valid.";
  }
}

/** Recipient-facing copy for refusals that keep the form open. */
export function acceptanceRefusalMessage(code: string, emailHint?: string | null): string {
  switch (code) {
    case "recipient_mismatch":
      return `This invitation was sent to ${emailHint ?? "a different email"}. Use that address, or ask whoever invited you for a new link.`;
    case "invite_in_progress":
      return "This invitation is already being activated. Wait a minute, then try again.";
    case "email_mismatch":
      return `You already have an account under ${emailHint ?? "a different email"}. Sign in with that address, or ask your manager to correct the email on file — this link can't change it.`;
    case "identity_conflict":
      return "This email, phone, or NPN is already on file for another account. Sign in with that account, or ask your manager to merge the records before using this link.";
    default:
      return `Couldn't activate: ${code}`;
  }
}

// ─── Offer terms ─────────────────────────────────────────────────────────────

export type InviteKind = "hire" | "join";

/** Roles a non-admin may put on an invitation (fn_invite_authorize). */
export const NON_ADMIN_ROLES: ReadonlySet<string> = new Set([
  "agent",
  "hired_unlicensed",
  "hired_licensed",
  "manager_candidate",
  "referral_prospect",
]);

export interface CarrierExceptionDraft {
  carrier_id: string;
  pct: number | null;
  note?: string | null;
}

export interface OfferTermsDraft {
  kind: InviteKind;
  target_role: string;
  target_manager_id: string | null;
  recipient_email: string | null;
  offered_comp_pct: number | null;
  carrier_exceptions: CarrierExceptionDraft[];
}

/** The caller's authority, as returned by invitation_mint_options(). */
export interface OfferAuthority {
  is_admin: boolean;
  is_manager: boolean;
  /** The caller's OWN resolved comp level; null when unknown. */
  cap_pct: number | null;
  /** Approved comp values the caller may pick from. */
  comp_levels: number[];
  /** Upline ids the caller may place a recruit under. */
  upline_ids: string[];
  /** Carrier ids that exist and are active. */
  carrier_ids: string[];
}

export interface TermsIssue {
  field: "target_role" | "target_manager_id" | "recipient_email" | "offered_comp_pct" | "carrier_exceptions";
  message: string;
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const round2 = (n: number) => Math.round(n * 100) / 100;

function pctIssue(
  pct: number,
  auth: OfferAuthority,
  what: string,
): string | null {
  if (!Number.isFinite(pct) || pct < 50 || pct > 200) return `${what} must be between 50% and 200%.`;
  if (auth.is_admin) return null;
  if (!auth.is_manager) return `Only a manager or admin can offer ${what.toLowerCase()}.`;
  if (!auth.comp_levels.some((level) => round2(level) === round2(pct))) return `${pct}% is not an approved comp level.`;
  if (pct > 100) return `${what} above 100% needs an admin.`;
  if (auth.cap_pct == null) return "Your own comp level is not set, so a cap cannot be applied.";
  if (pct > auth.cap_pct) return `${what} cannot be above your own level.`;
  return null;
}

/**
 * Pre-flight mirror of fn_invite_authorize(). An empty list means the server
 * is expected to accept; the server remains the authority either way.
 */
export function validateOfferTerms(draft: OfferTermsDraft, auth: OfferAuthority): TermsIssue[] {
  const issues: TermsIssue[] = [];

  if (!auth.is_admin && !NON_ADMIN_ROLES.has(draft.target_role)) {
    issues.push({ field: "target_role", message: "Only an admin can invite someone into that role." });
  }

  if (!draft.target_manager_id) {
    issues.push({ field: "target_manager_id", message: "Choose an upline." });
  } else if (!auth.upline_ids.includes(draft.target_manager_id)) {
    issues.push({ field: "target_manager_id", message: "That upline is not one you can place a recruit under." });
  }

  if (draft.recipient_email != null && draft.recipient_email.trim() !== "") {
    if (!EMAIL_SHAPE.test(draft.recipient_email.trim())) {
      issues.push({ field: "recipient_email", message: "Enter a valid email address." });
    }
  }

  const hasTerms = draft.offered_comp_pct != null || draft.carrier_exceptions.length > 0;
  if (draft.kind === "join" && hasTerms) {
    issues.push({ field: "offered_comp_pct", message: "A prospect join link cannot carry comp terms." });
  }

  if (draft.offered_comp_pct != null) {
    const problem = pctIssue(draft.offered_comp_pct, auth, "Offered comp");
    if (problem) issues.push({ field: "offered_comp_pct", message: problem });
  }

  const seen = new Set<string>();
  for (const ex of draft.carrier_exceptions) {
    if (!ex.carrier_id || !auth.carrier_ids.includes(ex.carrier_id)) {
      issues.push({ field: "carrier_exceptions", message: "Choose a carrier for every exception." });
      continue;
    }
    if (seen.has(ex.carrier_id)) {
      issues.push({ field: "carrier_exceptions", message: "A carrier is listed twice." });
      continue;
    }
    seen.add(ex.carrier_id);
    if (ex.pct == null) {
      issues.push({ field: "carrier_exceptions", message: "Choose a percentage for every carrier exception." });
      continue;
    }
    const problem = pctIssue(ex.pct, auth, "A carrier exception");
    if (problem) issues.push({ field: "carrier_exceptions", message: problem });
  }

  return issues;
}

/** Agency keys the server derives from the upline (fn_agent_subagency). */
export type AgencyKey = "primary" | "vantage";

export function agencyLabel(key: string | null | undefined, primaryName: string): string {
  if (key === "vantage") return "Vantage Financial";
  if (key === "primary") return primaryName;
  return "Unknown";
}

export function formatRole(role: string | null | undefined): string {
  if (!role) return "Agent";
  switch (role) {
    case "hired_unlicensed":
      return "Agent · unlicensed";
    case "hired_licensed":
      return "Agent · licensed";
    case "hired_manager":
      return "Manager";
    case "agency_owner":
      return "Agency owner";
    case "staff":
      return "Staff";
    case "referral_prospect":
      return "Prospect";
    default:
      return role.replace(/_/g, " ");
  }
}

/** Mask an address the way the server does for hints: j***@domain.com. */
export function maskEmail(email: string | null | undefined): string {
  const value = (email ?? "").trim().toLowerCase();
  const at = value.indexOf("@");
  if (at <= 1) return "***";
  return `${value[0]}***${value.slice(at)}`;
}

/**
 * A mailto: draft for the operator's own mail client. Opening it is NOT a
 * delivery — callers record it as "shared", never "sent".
 */
export function invitationMailto(input: {
  recipientEmail: string;
  recipientName?: string | null;
  url: string;
  expiresAt?: string | null;
  orgName: string;
}): string {
  const first = (input.recipientName ?? "").trim().split(/\s+/)[0] || "there";
  const expiry = input.expiresAt ? ` It expires ${new Date(input.expiresAt).toLocaleDateString()}.` : "";
  const subject = `Your invitation to ${input.orgName}`;
  const body = `Hi ${first},\n\nHere is your personal link to join ${input.orgName}:\n${input.url}\n\nIt works once and only for this email address.${expiry}`;
  return `mailto:${encodeURIComponent(input.recipientEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
