/**
 * Client-side mirror of the contracting intake's five-field contract.
 *
 * The DATABASE is the authority: submit_contracting_intake() re-normalizes and
 * re-validates everything this file does, and its verdict is the one that
 * counts. This exists so a producer filling the form on a phone finds out about
 * a bad NPN before they tap Submit, not after a round trip.
 *
 * The two implementations must agree. src/tests/lib/contractingIntake.test.ts
 * drives the same cases proved against the live SQL functions, so a divergence
 * shows up as a test failure rather than as a producer whose submission the
 * form accepted and the server rejected.
 */

export const CONTRACTING_FIELDS = ["first_name", "last_name", "email", "phone", "npn"] as const;
export type ContractingField = (typeof CONTRACTING_FIELDS)[number];

export type ContractingIntakeInput = Record<ContractingField, string>;

export type NormalizedIntake = {
  first_name: string;
  last_name: string;
  email: string;
  phone_e164: string;
  npn: string;
};

/** Mirrors public.fn_normalize_contracting_email. */
export function normalizeEmail(raw: string): string | null {
  const trimmed = (raw ?? "").trim().toLowerCase();
  return trimmed === "" ? null : trimmed;
}

/** Mirrors public.fn_normalize_contracting_npn — digits only, no length opinion. */
export function normalizeNpn(raw: string): string | null {
  const digits = (raw ?? "").replace(/[^0-9]/g, "");
  return digits === "" ? null : digits;
}

/**
 * Mirrors public.fn_normalize_contracting_phone.
 *
 * Returns null rather than guessing on anything outside the North American
 * numbering plan. A wrong phone number on a contracting record costs a producer
 * their start, so an explicit "we could not read that" beats a plausible guess.
 */
export function normalizePhone(raw: string): string | null {
  const d = (raw ?? "").replace(/[^0-9]/g, "");
  if (d.length === 10 && /[2-9]/.test(d[0])) return `+1${d}`;
  if (d.length === 11 && d[0] === "1" && /[2-9]/.test(d[1])) return `+${d}`;
  return null;
}

export type FieldError = { field: ContractingField; message: string };

/**
 * Validate the whole form. Returns every problem at once rather than the first,
 * so the form can mark all bad fields in one pass instead of making someone
 * submit five times to discover five mistakes.
 */
/**
 * Both arms carry both keys (one always undefined) because this project's
 * tsconfig does not narrow a boolean discriminant, so `if (!r.ok) r.errors`
 * would not type-check against a strict two-arm union.
 */
export type IntakeValid = { ok: true; value: NormalizedIntake; errors?: undefined };
export type IntakeInvalid = { ok: false; value?: undefined; errors: FieldError[] };
export type IntakeResult = IntakeValid | IntakeInvalid;

export function validateIntake(input: Partial<ContractingIntakeInput>): IntakeResult {
  const errors: FieldError[] = [];

  const first = (input.first_name ?? "").trim();
  const last = (input.last_name ?? "").trim();
  const email = normalizeEmail(input.email ?? "");
  const phone = normalizePhone(input.phone ?? "");
  const npn = normalizeNpn(input.npn ?? "");

  if (!first) errors.push({ field: "first_name", message: "Enter your first name." });
  else if (first.length > 100) errors.push({ field: "first_name", message: "First name is too long." });

  if (!last) errors.push({ field: "last_name", message: "Enter your last name." });
  else if (last.length > 100) errors.push({ field: "last_name", message: "Last name is too long." });

  // Mirrors the column CHECK `email like '%_@_%.__%'`: something, an @,
  // something, a dot, and at least a two-character tail.
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email) || email.length > 254) {
    errors.push({ field: "email", message: "Enter a valid email address." });
  }

  if (!phone) {
    errors.push({ field: "phone", message: "Enter a 10-digit US mobile number." });
  }

  if (!npn) {
    errors.push({ field: "npn", message: "Enter your NPN." });
  } else if (!/^[0-9]{5,10}$/.test(npn)) {
    errors.push({ field: "npn", message: "An NPN is 5 to 10 digits." });
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      first_name: first,
      last_name: last,
      email: email as string,
      phone_e164: phone as string,
      npn: npn as string,
    },
  };
}

/** Server error codes, mapped to the field they belong to and plain wording. */
export const SERVER_ERROR_COPY: Record<string, FieldError> = {
  first_name_required: { field: "first_name", message: "Enter your first name." },
  last_name_required: { field: "last_name", message: "Enter your last name." },
  email_invalid: { field: "email", message: "Enter a valid email address." },
  phone_invalid: { field: "phone", message: "Enter a 10-digit US mobile number." },
  npn_invalid: { field: "npn", message: "An NPN is 5 to 10 digits." },
};

export type DeliveryState =
  | "queued"
  | "attempting"
  | "unknown_outcome"
  | "accepted"
  | "delivered"
  | "failed"
  | "dead_letter"
  | "manual_review"
  | "not_configured";

/**
 * How each destination reads to a human.
 *
 * 'queued' deliberately does not say "sent". Nothing has been sent at that
 * point — the row is in the outbox and the dispatcher has not run. Reporting a
 * send from an enqueue is the defect this whole feature is built to avoid.
 */
export const DELIVERY_COPY: Record<DeliveryState, { label: string; tone: "ok" | "pending" | "warn" | "muted" }> = {
  queued: { label: "Queued", tone: "pending" },
  attempting: { label: "In flight", tone: "pending" },
  // The provider may or may not have acted and we could not record which. It is
  // neither a success nor a failure, and it will never be retried automatically
  // — a person has to look at the channel.
  unknown_outcome: { label: "Unconfirmed · check manually", tone: "warn" },
  // ACCEPTED IS NOT DELIVERED. Resend taking custody of an email is not the
  // email arriving; bounces and suppressions all happen after that 2xx. The
  // wording says what we actually know.
  accepted: { label: "Accepted by provider", tone: "pending" },
  delivered: { label: "Delivered", tone: "ok" },
  failed: { label: "Retrying", tone: "warn" },
  dead_letter: { label: "Needs attention", tone: "warn" },
  manual_review: { label: "Held for review", tone: "warn" },
  not_configured: { label: "Not configured", tone: "muted" },
};

export const DESTINATION_COPY: Record<string, string> = {
  contracting_discord: "Discord · Contracting",
  ethos_sheet: "Contracting spreadsheet",
};
