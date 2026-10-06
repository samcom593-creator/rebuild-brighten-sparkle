import { describe, expect, it } from "vitest";

import {
  DEAD_LINK_CODES,
  INVITATION_STATUSES,
  acceptanceRefusalMessage,
  agencyLabel,
  deadLinkMessage,
  deriveInvitationStatus,
  invitationActions,
  invitationMailto,
  isTerminalStatus,
  maskEmail,
  validateOfferTerms,
  type OfferAuthority,
  type OfferTermsDraft,
} from "@/lib/invitationState";

const NOW = new Date("2026-10-06T12:00:00Z");
const FUTURE = "2026-10-13T12:00:00Z";
const PAST = "2026-10-01T12:00:00Z";

describe("deriveInvitationStatus (mirror of fn_invitation_status)", () => {
  it("reports each of the five states", () => {
    expect(deriveInvitationStatus({ is_active: true, expires_at: FUTURE }, NOW)).toBe("pending");
    expect(deriveInvitationStatus({ is_active: true, expires_at: FUTURE, used_at: PAST }, NOW)).toBe("accepted");
    expect(deriveInvitationStatus({ is_active: true, expires_at: PAST }, NOW)).toBe("expired");
    expect(deriveInvitationStatus({ is_active: false, expires_at: FUTURE }, NOW)).toBe("revoked");
    expect(deriveInvitationStatus({ is_active: false, expires_at: FUTURE, superseded_by: "x" }, NOW)).toBe("superseded");
  });

  it("keeps an accepted invitation accepted even after a later revoke", () => {
    expect(deriveInvitationStatus({ is_active: false, revoked_at: PAST, used_at: PAST, expires_at: PAST }, NOW)).toBe("accepted");
  });

  it("reports superseded rather than the revoke that accompanies it", () => {
    expect(deriveInvitationStatus({ is_active: false, revoked_at: PAST, superseded_by: "new", expires_at: FUTURE }, NOW)).toBe("superseded");
  });

  it("treats a missing or unparseable expiry as expired, never as usable", () => {
    expect(deriveInvitationStatus({ is_active: true, expires_at: null }, NOW)).toBe("expired");
    expect(deriveInvitationStatus({ is_active: true, expires_at: "not a date" }, NOW)).toBe("expired");
  });

  it("treats an unknown is_active as revoked (unknown never becomes pending)", () => {
    expect(deriveInvitationStatus({ is_active: null, expires_at: FUTURE }, NOW)).toBe("revoked");
  });

  it("expires exactly at the expiry instant", () => {
    expect(deriveInvitationStatus({ is_active: true, expires_at: NOW.toISOString() }, NOW)).toBe("expired");
  });
});

describe("invitationActions", () => {
  it("allows copy/share/revoke/regenerate only while pending", () => {
    expect(invitationActions("pending")).toEqual({ copy: true, share: true, revoke: true, regenerate: true });
  });
  it("never hands a dead link back out; expired and revoked can only be reissued", () => {
    for (const s of ["expired", "revoked"] as const) {
      expect(invitationActions(s)).toEqual({ copy: false, share: false, revoke: false, regenerate: true });
    }
  });
  it("leaves accepted and superseded invitations read-only", () => {
    for (const s of ["accepted", "superseded"] as const) {
      expect(invitationActions(s)).toEqual({ copy: false, share: false, revoke: false, regenerate: false });
    }
  });
  it("marks every non-pending state terminal", () => {
    expect(INVITATION_STATUSES.filter(isTerminalStatus)).toEqual(["accepted", "expired", "revoked", "superseded"]);
  });
});

const UPLINE_SELF = "11111111-1111-4111-8111-111111111111";
const UPLINE_DOWN = "22222222-2222-4222-8222-222222222222";
const UPLINE_OTHER = "33333333-3333-4333-8333-333333333333";
const ETHOS = "44444444-4444-4444-8444-444444444444";
const AMAM = "55555555-5555-4555-8555-555555555555";

const LEVELS = [60, 75, 80, 85, 105, 125];

const admin: OfferAuthority = {
  is_admin: true, is_manager: false, cap_pct: 200, comp_levels: LEVELS,
  upline_ids: [UPLINE_SELF, UPLINE_DOWN, UPLINE_OTHER], carrier_ids: [ETHOS, AMAM],
};
const manager: OfferAuthority = {
  is_admin: false, is_manager: true, cap_pct: 85, comp_levels: LEVELS,
  upline_ids: [UPLINE_SELF, UPLINE_DOWN], carrier_ids: [ETHOS, AMAM],
};
const agent: OfferAuthority = {
  is_admin: false, is_manager: false, cap_pct: 70, comp_levels: LEVELS,
  upline_ids: [UPLINE_SELF], carrier_ids: [ETHOS, AMAM],
};
const managerNoCap: OfferAuthority = { ...manager, cap_pct: null };

const draft = (over: Partial<OfferTermsDraft> = {}): OfferTermsDraft => ({
  kind: "hire",
  target_role: "hired_licensed",
  target_manager_id: UPLINE_DOWN,
  recipient_email: "recruit@example.com",
  offered_comp_pct: null,
  carrier_exceptions: [],
  ...over,
});

const fields = (issues: ReturnType<typeof validateOfferTerms>) => issues.map((i) => i.field);

describe("validateOfferTerms (mirror of fn_invite_authorize)", () => {
  it("accepts a manager offering an approved level at or below their own cap under their downline", () => {
    expect(validateOfferTerms(draft({ offered_comp_pct: 80 }), manager)).toEqual([]);
    expect(validateOfferTerms(draft({ offered_comp_pct: 85 }), manager)).toEqual([]);
  });

  it("refuses a manager an unapproved level, a level above their cap, and anything above 100", () => {
    expect(fields(validateOfferTerms(draft({ offered_comp_pct: 90 }), manager))).toEqual(["offered_comp_pct"]);
    expect(validateOfferTerms(draft({ offered_comp_pct: 90 }), manager)[0].message).toMatch(/not an approved/);
    expect(validateOfferTerms(draft({ offered_comp_pct: 105 }), manager)[0].message).toMatch(/above 100% needs an admin/);
    const capped: OfferAuthority = { ...manager, cap_pct: 75 };
    expect(validateOfferTerms(draft({ offered_comp_pct: 80 }), capped)[0].message).toMatch(/above your own level/);
  });

  it("refuses a manager with no resolved level any comp offer", () => {
    expect(validateOfferTerms(draft({ offered_comp_pct: 60 }), managerNoCap)[0].message).toMatch(/not set/);
    expect(validateOfferTerms(draft({ offered_comp_pct: null }), managerNoCap)).toEqual([]);
  });

  it("refuses a plain agent any comp offer but lets them invite under themselves", () => {
    expect(validateOfferTerms(draft({ offered_comp_pct: 60, target_manager_id: UPLINE_SELF }), agent)[0].message)
      .toMatch(/Only a manager or admin/);
    expect(validateOfferTerms(draft({ target_manager_id: UPLINE_SELF }), agent)).toEqual([]);
  });

  it("refuses an upline outside the caller's tree and a missing upline", () => {
    expect(fields(validateOfferTerms(draft({ target_manager_id: UPLINE_OTHER }), manager))).toEqual(["target_manager_id"]);
    expect(fields(validateOfferTerms(draft({ target_manager_id: null }), manager))).toEqual(["target_manager_id"]);
  });

  it("refuses manager-shaped roles to non-admins and allows them to admins", () => {
    for (const role of ["hired_manager", "manager", "agency_owner", "staff"]) {
      expect(fields(validateOfferTerms(draft({ target_role: role }), manager))).toEqual(["target_role"]);
      expect(validateOfferTerms(draft({ target_role: role }), admin)).toEqual([]);
    }
  });

  it("lets an admin offer any level from 50 to 200 and nothing outside it", () => {
    expect(validateOfferTerms(draft({ offered_comp_pct: 125 }), admin)).toEqual([]);
    expect(validateOfferTerms(draft({ offered_comp_pct: 110 }), admin)).toEqual([]);
    expect(fields(validateOfferTerms(draft({ offered_comp_pct: 49 }), admin))).toEqual(["offered_comp_pct"]);
    expect(fields(validateOfferTerms(draft({ offered_comp_pct: 201 }), admin))).toEqual(["offered_comp_pct"]);
    expect(fields(validateOfferTerms(draft({ offered_comp_pct: Number.NaN }), admin))).toEqual(["offered_comp_pct"]);
  });

  it("validates carrier exceptions: known carrier, no duplicates, same comp rules", () => {
    expect(validateOfferTerms(draft({ offered_comp_pct: 80, carrier_exceptions: [{ carrier_id: ETHOS, pct: 75 }] }), manager)).toEqual([]);
    expect(fields(validateOfferTerms(draft({ carrier_exceptions: [{ carrier_id: "nope", pct: 75 }] }), manager))).toEqual(["carrier_exceptions"]);
    expect(validateOfferTerms(draft({ carrier_exceptions: [{ carrier_id: ETHOS, pct: 75 }, { carrier_id: ETHOS, pct: 60 }] }), manager)[0].message)
      .toMatch(/listed twice/);
    expect(validateOfferTerms(draft({ carrier_exceptions: [{ carrier_id: AMAM, pct: 105 }] }), manager)[0].message)
      .toMatch(/needs an admin/);
    expect(validateOfferTerms(draft({ carrier_exceptions: [{ carrier_id: AMAM, pct: null }] }), manager)[0].message)
      .toMatch(/Choose a percentage/);
    expect(validateOfferTerms(draft({ target_manager_id: UPLINE_SELF, carrier_exceptions: [{ carrier_id: AMAM, pct: 60 }] }), agent)[0].message)
      .toMatch(/Only a manager or admin/);
  });

  it("refuses comp terms on a prospect join link", () => {
    expect(validateOfferTerms(draft({ kind: "join", target_role: "referral_prospect", offered_comp_pct: 60 }), admin)
      .some((i) => /join link cannot carry comp/.test(i.message))).toBe(true);
    expect(validateOfferTerms(draft({ kind: "join", target_role: "referral_prospect" }), manager)).toEqual([]);
  });

  it("rejects a malformed recipient email and accepts none at all", () => {
    expect(fields(validateOfferTerms(draft({ recipient_email: "not-an-email" }), manager))).toEqual(["recipient_email"]);
    expect(validateOfferTerms(draft({ recipient_email: null }), manager)).toEqual([]);
  });
});

describe("recipient-facing copy", () => {
  it("routes every dead-link code to the no-form screen", () => {
    for (const code of ["invite_invalid", "invite_already_used", "invite_expired", "invite_revoked", "invite_superseded"]) {
      expect(DEAD_LINK_CODES.has(code)).toBe(true);
    }
    expect(DEAD_LINK_CODES.has("recipient_mismatch")).toBe(false);
    expect(DEAD_LINK_CODES.has("invite_in_progress")).toBe(false);
    expect(deadLinkMessage("invite_superseded")).toMatch(/replaced/);
    expect(deadLinkMessage("anything-else")).toMatch(/isn't valid/);
  });

  it("names the masked recipient on a mismatch and never the full address", () => {
    const msg = acceptanceRefusalMessage("recipient_mismatch", maskEmail("jane.doe@example.com"));
    expect(msg).toContain("j***@example.com");
    expect(msg).not.toContain("jane.doe");
  });

  it("masks emails the way the server hint does", () => {
    expect(maskEmail("Jane@Example.com")).toBe("j***@example.com");
    expect(maskEmail("a@b.co")).toBe("***");
    expect(maskEmail(null)).toBe("***");
  });

  it("labels agencies from the server-derived key, unknown stays unknown", () => {
    expect(agencyLabel("primary", "Org")).toBe("Org");
    expect(agencyLabel("vantage", "Org")).toBe("Vantage Financial");
    expect(agencyLabel(null, "Org")).toBe("Unknown");
  });

  it("builds a mailto draft for the operator's own mail client (a share, not a send)", () => {
    const href = invitationMailto({
      recipientEmail: "recruit@example.com",
      recipientName: "Pat Recruit",
      url: "https://example.test/hire/abc",
      expiresAt: FUTURE,
      orgName: "Org",
    });
    expect(href.startsWith("mailto:recruit%40example.com?")).toBe(true);
    expect(decodeURIComponent(href)).toContain("https://example.test/hire/abc");
    expect(decodeURIComponent(href)).toContain("Hi Pat");
  });
});
