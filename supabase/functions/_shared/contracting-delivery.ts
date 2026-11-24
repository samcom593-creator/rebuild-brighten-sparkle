// Contracting intake delivery logic.
//
// Every database and network effect arrives through injected dependencies, so
// the dispatcher runs these functions against production and the vitest suite
// runs the SAME functions against stubs. Testing a reimplementation would prove
// nothing about the code that emails the support desk and posts to Discord.

import type { EthosIntake } from "./ethos.ts";
import {
  SIGNUP_HEADERS,
  SIGNUP_TAB,
  UPDATES_AGENCY_COLUMNS,
  UPDATES_HEADERS,
  UPDATES_TAB,
  buildUpdateRequestRow,
  columnLetter,
  evaluateSignupGate,
  isPopulatedUpdateRow,
  parseSheetBoolean,
  planSignupWrite,
  S,
  signupAgencyRange,
  trimOuter,
  verifyHeaderSignature,
  verifySignupReadBack,
  type Principal,
  type SignupApproval,
  type UpdateRequest,
} from "./ethos-contract.ts";
import { createSheetsClient, getAccessToken, type FetchLike } from "./google-sheets.ts";
import { nanpTenDigits } from "./nanp-phone.ts";

/**
 * Thrown when a provider gave a definite rejection, so no side effect exists.
 * Distinguished from an ambiguous transport failure, where the request may have
 * been received even though we never saw the response.
 */
export class ProviderRejectedError extends Error {
  readonly definite = true;
}

export type IntakeRow = EthosIntake & { id: string; status: string; agent_id?: string | null };

export type DeliveryState =
  | "accepted" | "delivered" | "manual_review" | "not_configured";

export type DeliveryOutcome = {
  state: DeliveryState;
  receipt: Record<string, unknown> | null;
  note: string | null;
};

export type DeliveryDeps = {
  readSetting(key: string): Promise<string | null>;
  loadIntake(intakeId: string): Promise<IntakeRow>;
  /** Returns the provider message id. Throws on any non-2xx. */
  sendEmail(payload: Record<string, unknown>, idempotencyKey: string): Promise<string>;
  fetchImpl: FetchLike;
  /** Raw GOOGLE_SERVICE_ACCOUNT_JSON, or null when the secret is unset. */
  googleCredential: string | null;
  now(): number;
  /**
   * Seam for the Google token exchange, same idea as fetchImpl. Defaults to the
   * real RS256 signing path; tests supply a stub because signing requires real
   * key material and this test is about the sheet, not about JWT signing.
   */
  getToken?(credential: string, now: number, fetchImpl: FetchLike): Promise<string>;
  /**
   * Evidence + leadership approval for this producer (contracting_ethos_approvals), or null.
   * Optional so legs that never touch Ethos need not supply it; absent means "no approval".
   */
  loadEthosApproval?(intake: IntakeRow): Promise<SignupApproval | null>;
};

/**
 * Escape a value for a Discord embed.
 *
 * An unescaped producer name containing backticks or underscores mangles the
 * post; one containing @everyone pings the whole server. The zero-width space
 * after @ defuses mentions even before allowed_mentions is applied.
 */
export function escapeDiscord(value: unknown): string {
  return String(value ?? "")
    .replace(/([\\`*_~|>])/g, "\\$1")
    .replace(/@/g, "@​")
    .slice(0, 256);
}

/**
 * Build the private support post.
 *
 * This is a dedicated, private contracting channel, so it carries the complete
 * linked profile — support staff cannot act without it. Every value is escaped
 * and allowed_mentions is emptied, so no crafted field can notify anyone.
 */
export function buildDiscordPayload(
  intake: IntakeRow,
  mentionUserId?: string | null,
): Record<string, unknown> {
  const safeMentionId = /^\d{16,22}$/.test(mentionUserId ?? "")
    ? mentionUserId
    : null;
  const safeEoUrl = /^https:\/\//i.test(intake.eo_certificate_url ?? "")
    ? String(intake.eo_certificate_url)
    : null;
  return {
    ...(safeMentionId ? { content: `<@${safeMentionId}>` } : {}),
    allowed_mentions: safeMentionId
      ? { parse: [], users: [safeMentionId] }
      : { parse: [] },
    embeds: [{
      title: "New contracting intake",
      color: 0x1d9bf0,
      fields: [
        { name: "First name", value: escapeDiscord(intake.first_name), inline: true },
        { name: "Last name", value: escapeDiscord(intake.last_name), inline: true },
        { name: "NPN", value: escapeDiscord(intake.npn), inline: true },
        { name: "Email", value: escapeDiscord(intake.email), inline: false },
        { name: "Phone", value: escapeDiscord(intake.phone_e164), inline: true },
        { name: "Status", value: escapeDiscord(intake.status), inline: true },
        ...(intake.comp_percentage != null ? [{ name: "Comp", value: `${escapeDiscord(intake.comp_percentage)}%`, inline: true }] : []),
        ...(intake.license_states?.length ? [{ name: "Licensed states", value: escapeDiscord(intake.license_states.join(", ")), inline: true }] : []),
        ...(safeEoUrl ? [{ name: "E&O", value: `[Certificate](${safeEoUrl})${intake.eo_expires_at ? ` · expires ${escapeDiscord(intake.eo_expires_at)}` : ""}`, inline: false }] : []),
        { name: "EFT", value: intake.eft_ready ? "Ready" : "Pending", inline: true },
        ...(intake.contracting_contact_name ? [{ name: "Contracting contact", value: escapeDiscord(intake.contracting_contact_name), inline: true }] : []),
      ],
      footer: { text: `Galaxy Intake ${intake.id}` },
    }],
  };
}

export async function deliverContractingEmail(
  _intakeId: string,
  _deps: DeliveryDeps,
): Promise<DeliveryOutcome> {
  return {
    state: "not_configured",
    receipt: null,
    note: "Contracting email/AgentLink delivery is disabled. Use the Ethos sheet and private contracting Discord.",
  };
}

export async function deliverContractingDiscord(
  intakeId: string,
  deps: DeliveryDeps,
): Promise<DeliveryOutcome> {
  // Bound to its OWN setting. There is deliberately no fallback to
  // discord_webhook_url or discord_webhook_url_recruiting: those point at the
  // deals and recruiting channels, and publishing a producer's contact details
  // into an unrelated channel is worse than not posting at all.
  const webhook = await deps.readSetting("discord_webhook_url_contracting");
  if (!webhook || !/^https:\/\/discord\.com\/api\/webhooks\//.test(webhook.trim())) {
    return {
      state: "not_configured",
      receipt: null,
      note: "No contracting-channel webhook is configured. Set system_settings.discord_webhook_url_contracting.",
    };
  }

  const intake = await deps.loadIntake(intakeId);
  // Discord mentions require the immutable numeric member ID. A display name
  // is deliberately never interpolated because it cannot create a reliable
  // ping and could resolve to the wrong person.
  const mentionUserId = await deps.readSetting("contracting_discord_mention_user_id");
  const response = await deps.fetchImpl(`${webhook.trim()}?wait=true`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(buildDiscordPayload(intake, mentionUserId)),
  });

  const body = await response.text();
  if (!response.ok) {
    // 4xx, including 429, means Discord parsed the request and refused it. No
    // message was created, so a clean retry is correct.
    //
    // 5xx is NOT the same. The request was transmitted and accepted for
    // processing; a gateway error or an internal fault can occur after the
    // message was created, so we genuinely do not know whether it exists.
    // Retrying that would risk a second post, so it is treated as ambiguous.
    if (response.status >= 400 && response.status < 500) {
      throw new ProviderRejectedError(`Discord returned ${response.status}: ${body.slice(0, 200)}`);
    }
    throw new Error(`Discord returned ${response.status}: ${body.slice(0, 200)}`);
  }

  let messageId: string | null = null;
  try {
    messageId = (JSON.parse(body)?.id as string) ?? null;
  } catch { // empty-catch-allow:provider-body-may-be-non-json
    // ?wait=true normally returns the message object; a 204 with no body is
    // still a real success and the HTTP status is the receipt.
  }

  // A Discord 200 means the message exists in the channel, so this leg can
  // honestly claim delivered — unlike email, where 2xx only means custody.
  return {
    state: "delivered",
    receipt: { provider: "discord", http_status: response.status, message_id: messageId },
    note: null,
  };
}

export async function deliverContractingWorkbook(
  _intakeId: string,
  deps: DeliveryDeps,
): Promise<DeliveryOutcome> {
  // Sam's updated workbook is an .xlsx file on a laptop. A file on one machine
  // cannot be a production sink, and claiming a spreadsheet updated because a
  // database row was written is exactly the fake success this feature exists to
  // prevent. The database is authoritative; staff use the admin CSV export.
  const destination = await deps.readSetting("contracting_workbook_destination");
  if (!destination) {
    return {
      state: "not_configured",
      receipt: null,
      note: "No hosted workbook destination is configured. The database is authoritative; use the admin export on /dashboard/contracting.",
    };
  }
  throw new Error(`Unsupported workbook destination: ${destination.slice(0, 40)}`);
}

type EthosSheetConfig = {
  sheet_id: string;
  tab?: string;
  /** "Update Agent" tab title on the MGN layout (Level 8 used UPDATES_TAB). */
  updates_tab?: string;
  /**
   * MP-304 (2026-11-23): "level8" is the original 19-column Level 8 Financial workbook. "mgn" is MGN IMO's
   * "Apex financial / Ethos" workbook (owner onboarding@mgnimo.com): New Agents A:H in MGN's column order
   * (first, last, mobile, email, NPN, direct upline's personal NPN, comp level, payment tier) and Update Agent
   * A:H with a checkbox in H. The upline NPN is the MANAGER's own — there is no sub-agency column.
   */
  layout?: "level8" | "mgn";
  principal_npn?: string;
  principal_mobile?: string;
  principal_email?: string;
  direct_upline_npn?: string;
};

export const MGN_NEW_AGENTS_HEADERS = [
  "Agent First Name", "Agent Last Name", "Unique Mobile Number", "Unique Email Address",
  "Personal NPN", "Direct Upline's Personal NPN", "Comp Level", "Payment Tier",
] as const;
export const MGN_UPDATE_AGENT_HEADERS = [
  "First Name (required)", "Last Name (required)", "Personal NPN (required)", "Direct Upline's Personal NPN (if changing)",
  "Comp Level (if changing)", "Payment Tier (if changing)", "PII Information (if changing)", "Terminate Agent",
] as const;
/** MGN's header cells carry line breaks ("Comp Level\n(if changing)"); compare on collapsed whitespace. */
const normHeader = (v: unknown) => trimOuter(v).replace(/\s+/g, " ");
export function verifyMgnHeader(expected: readonly string[], row: unknown[] | undefined): { ok: boolean; drift: string[] } {
  const drift: string[] = [];
  expected.forEach((h, i) => { if (normHeader(row?.[i]) !== h) drift.push(columnLetter(i)); });
  return { ok: drift.length === 0, drift };
}
const MGN = { FIRST: 0, LAST: 1, MOBILE: 2, EMAIL: 3, NPN: 4, UPLINE: 5, LEVEL: 6, TIER: 7 } as const;
const MGN_FIRST_DATA_ROW = 2;
function mgnRange(tab: string, row: number): string { return `${tab}!A${row}:H${row}`; }
function mgnPopulated(row: unknown[] | undefined, upTo = 7): boolean {
  if (!row) return false;
  for (let i = 0; i <= upTo; i++) if (trimOuter(row[i])) return true;
  return false;
}
function digits(v: unknown): string { return String(v ?? "").replace(/[^0-9]/g, ""); }
/**
 * Sam, 2026-11-23: MGN's sheet carries the comp as a PERCENT ("60%"), never an Ethos level. The Ethos vocabulary
 * stays internal (the gate and the Level 8 layout speak it); on the MGN layout the intake's own comp_percentage
 * wins, and a level is converted exactly (Level 12 = 60%, one level per 5 points) only when no percent exists.
 */
export function mgnCompPercent(level: unknown, compPct: unknown): string {
  const n = Number(compPct);
  if (Number.isFinite(n) && n > 0) return `${Number.isInteger(n) ? n : n.toFixed(1)}%`;
  const m = /^\s*Level\s+(\d{1,2})\s*$/i.exec(String(level ?? ""));
  if (m) return `${60 + (Number(m[1]) - 12) * 5}%`;
  return "60%";
}

/**
 * Ethos "Agent Portal Signup" leg — gated, append-once, A:L only.
 *
 * Order is the safety argument:
 *   1. The production write flag (system_settings.ethos_sheet_writes_enabled) must be 'true'.
 *      It ships OFF; until a human turns it on, staff use the gate-checked paste on
 *      /dashboard/contracting/ethos and this leg reports not_configured.
 *   2. A Google credential must exist.
 *   3. The tab is re-read in full (A:S) right before any write; header drift stops it.
 *   4. An NPN already on the sheet means the producer was submitted (by us or by hand): nothing
 *      is written again, the leg converges. An email/mobile under another NPN is a human call.
 *   5. The shared gate (ethos-contract.ts) must pass: verified NPN, license and unexpired E&O,
 *      explicit leadership approval of level / advance / upline / sub-agency / head. Nothing is
 *      defaulted — no principal-as-upline, no level inferred from an internal percentage.
 *   6. The target row is re-read and must still be empty; then A:L is written RAW and all twelve
 *      cells are read back. M:S belong to Ethos and are never written.
 */
export async function deliverEthosSheet(
  intakeId: string,
  deps: DeliveryDeps,
): Promise<DeliveryOutcome> {
  const rawConfig = await deps.readSetting("ethos_agents_sheet");
  if (!rawConfig) {
    return { state: "not_configured", receipt: null, note: "system_settings.ethos_agents_sheet is missing." };
  }
  const enabled = (await deps.readSetting("ethos_sheet_writes_enabled")) === "true";
  if (!enabled) {
    return {
      state: "not_configured",
      receipt: null,
      note: "Automated Ethos sheet writes are OFF (system_settings.ethos_sheet_writes_enabled). " +
        "Verify, approve and copy the gate-checked A:L row from /dashboard/contracting/ethos, then refresh from the sheet.",
    };
  }
  if (!deps.googleCredential) {
    return {
      state: "not_configured",
      receipt: null,
      note: "No Google service credential. Set the GOOGLE_SERVICE_ACCOUNT_JSON function secret and grant that service account Editor on the Agents sheet.",
    };
  }

  const config = JSON.parse(rawConfig) as EthosSheetConfig;
  const tab = config.tab || SIGNUP_TAB.title;
  const intake = await deps.loadIntake(intakeId);
  if (intake.status === "needs_review") {
    return { state: "manual_review", receipt: null, note: "Held: the submitted email is already on a different NPN." };
  }

  const exchange = deps.getToken
    ?? ((cred: string, now: number, f: FetchLike) => getAccessToken(JSON.parse(cred), now, f));
  const token = await exchange(deps.googleCredential, deps.now(), deps.fetchImpl);
  const sheets = createSheetsClient(config.sheet_id, token, deps.fetchImpl);

  if (config.layout === "mgn") {
    const approvalMgn = deps.loadEthosApproval ? await deps.loadEthosApproval(intake) : null;
    return await deliverMgnNewAgent(intake, approvalMgn, sheets, tab, deps);
  }

  const rows = await sheets.getRange(`${tab}!A:S`);
  const candidate = {
    first_name: intake.first_name,
    last_name: intake.last_name,
    npn: intake.npn,
    mobile: intake.phone_e164,
    email: intake.email,
  };
  const principal: Principal = {
    npn: config.principal_npn ?? config.direct_upline_npn ?? null,
    mobile: config.principal_mobile ?? null,
    email: config.principal_email ?? null,
  };

  // Already on the sheet (our earlier run, or a reviewed paste): converge, never append twice.
  const npnDigits = String(intake.npn ?? "").replace(/[^0-9]/g, "");
  const presentAt: number[] = [];
  for (let i = SIGNUP_TAB.firstDataRow - 1; i < rows.length; i++) {
    if (String(rows[i]?.[2] ?? "").replace(/[^0-9]/g, "") === npnDigits && npnDigits) presentAt.push(i + 1);
  }
  if (presentAt.length) {
    return {
      state: "delivered",
      receipt: { provider: "google_sheets", action: "already_present", rows: presentAt, written: false },
      note: `NPN already on the Ethos sheet (row ${presentAt.join(", ")}); nothing written. Carrier-owned columns are reconciled by the sheet sync.`,
    };
  }

  const approval = deps.loadEthosApproval ? await deps.loadEthosApproval(intake) : null;
  const gate = evaluateSignupGate(candidate, approval, { now: deps.now(), sheetRows: rows, principal });
  if (!gate.ready || !gate.payload) {
    return {
      state: "manual_review",
      receipt: null,
      note: `Held by the Ethos gate: ${gate.blockers.map((b) => b.code).join(", ") || "payload incomplete"}.`,
    };
  }

  const plan = planSignupWrite(rows, gate.payload);
  if (plan.action !== "append") {
    return {
      state: "manual_review",
      receipt: null,
      note: plan.action === "manual_review"
        ? `Held: ${plan.reason} (sheet row ${plan.rowNumbers.join(", ")}).`
        : `NPN appeared on the sheet during this run (row ${plan.rowNumbers.join(", ")}); nothing written.`,
    };
  }

  // The row must still be empty when we write it: a collaborator may have typed into it.
  const target = await sheets.getRange(`${tab}!A${plan.rowNumber}:S${plan.rowNumber}`);
  if ((target[0] ?? []).slice(0, 6).some((cell) => String(cell ?? "").trim() !== "")) {
    throw new Error(`Ethos target row ${plan.rowNumber} is no longer empty; refusing to overwrite a concurrent edit`);
  }

  const range = signupAgencyRange(tab, plan.rowNumber);
  const receipt = await sheets.updateRange(range, [gate.payload]);
  const written = await sheets.getRange(range);
  const check = verifySignupReadBack(written[0], gate.payload);
  if (!check.ok) throw new Error(`Ethos read-back mismatch on ${check.mismatches.join(", ")}`);

  return {
    state: "delivered",
    receipt: {
      provider: "google_sheets",
      action: "appended_a_to_l",
      updated_range: receipt,
      row: plan.rowNumber,
      columns: SIGNUP_HEADERS.slice(0, 12),
      read_back_verified: true,
      review_items: gate.review.map((r) => r.code),
    },
    note: "Written to the agency input block only (A:L). Being on the sheet is not Ethos approval; portal and reparenting are reconciled from the sheet sync.",
  };
}

/**
 * MGN "New Agents" (A:H). The gate is the SAME evaluateSignupGate (identity, approval, attested evidence); the
 * Level 8 sheet-collision scan is replaced by one over MGN's columns. Append-once by NPN; an email or mobile
 * already on the sheet under another NPN is a person's call. H:… beyond the eight columns is never touched.
 */
async function deliverMgnNewAgent(
  intake: IntakeRow,
  approval: SignupApproval | null,
  sheets: ReturnType<typeof createSheetsClient>,
  tab: string,
  deps: DeliveryDeps,
): Promise<DeliveryOutcome> {
  const rows = await sheets.getRange(`${tab}!A:H`);
  const hdr = verifyMgnHeader(MGN_NEW_AGENTS_HEADERS, rows[0]);
  if (!hdr.ok) {
    return { state: "manual_review", receipt: null, note: `Header drift on the MGN New Agents tab (${hdr.drift.join(", ")}); an admin reconciles the layout.` };
  }
  const npn = digits(intake.npn);
  const email = trimOuter(intake.email).toLowerCase();
  const mobile = nanpTenDigits(intake.phone_e164);
  const npnRows: number[] = []; const otherRows: number[] = []; let lastPopulated = MGN_FIRST_DATA_ROW - 1;
  for (let i = MGN_FIRST_DATA_ROW - 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    if (!mgnPopulated(r)) continue;
    lastPopulated = i + 1;
    const rowNpn = digits(r[MGN.NPN]);
    if (npn && rowNpn === npn) { npnRows.push(i + 1); continue; }
    if ((email && trimOuter(r[MGN.EMAIL]).toLowerCase() === email) || (mobile && nanpTenDigits(trimOuter(r[MGN.MOBILE])) === mobile)) otherRows.push(i + 1);
  }
  if (npnRows.length) {
    return { state: "delivered", receipt: { provider: "google_sheets", action: "already_present", rows: npnRows, written: false, layout: "mgn" }, note: `NPN already on the MGN New Agents tab (row ${npnRows.join(", ")}); nothing written.` };
  }
  if (otherRows.length) {
    return { state: "manual_review", receipt: null, note: `Held: this email or mobile is on the MGN sheet under a different NPN (row ${otherRows.join(", ")}).` };
  }
  const gate = evaluateSignupGate(
    { first_name: intake.first_name, last_name: intake.last_name, npn: intake.npn, mobile: intake.phone_e164, email: intake.email },
    approval,
    { now: deps.now(), sheetRows: null },
  );
  if (!gate.ready || !gate.payload) {
    return { state: "manual_review", receipt: null, note: `Held by the Ethos gate: ${gate.blockers.map((b) => b.code).join(", ") || "payload incomplete"}.` };
  }
  const p = gate.payload;
  const payload: (string | boolean)[] = [p[S.FIRST], p[S.LAST], p[S.MOBILE], p[S.EMAIL], p[S.NPN], p[S.UPLINE], mgnCompPercent(p[S.LEVEL], (intake as { comp_percentage?: unknown }).comp_percentage), p[S.ADVANCE]];
  const target = Math.max(MGN_FIRST_DATA_ROW, lastPopulated + 1);
  const fresh = await sheets.getRange(mgnRange(tab, target));
  if (mgnPopulated(fresh[0])) throw new Error(`MGN New Agents row ${target} is no longer empty; refusing to overwrite a concurrent edit`);
  const receipt = await sheets.updateRange(mgnRange(tab, target), [payload]);
  const written = (await sheets.getRange(mgnRange(tab, target)))[0] ?? [];
  const mismatches: string[] = [];
  payload.forEach((want, c) => {
    const got = written[c];
    const expectedMobile = c === MGN.MOBILE ? nanpTenDigits(trimOuter(want)) : null;
    const same = c === MGN.MOBILE ? expectedMobile !== null && nanpTenDigits(trimOuter(got)) === expectedMobile
      : c === MGN.EMAIL ? trimOuter(got).toLowerCase() === trimOuter(want).toLowerCase()
      : trimOuter(got) === trimOuter(want);
    if (!same) mismatches.push(MGN_NEW_AGENTS_HEADERS[c]);
  });
  if (mismatches.length) throw new Error(`MGN read-back mismatch on ${mismatches.join(", ")}`);
  return {
    state: "delivered",
    receipt: { provider: "google_sheets", action: "appended_a_to_h_mgn", updated_range: receipt, row: target, columns: [...MGN_NEW_AGENTS_HEADERS], read_back_verified: true, written: true, review_items: gate.review.map((r) => r.code), layout: "mgn" },
    note: "Written to MGN's New Agents tab (A:H). Being on the sheet is a request to MGN/Ethos, not their confirmation.",
  };
}

export async function deliverContractingDestination(
  destination: string,
  intakeId: string,
  deps: DeliveryDeps,
): Promise<DeliveryOutcome> {
  switch (destination) {
    case "contracting_email": return await deliverContractingEmail(intakeId, deps);
    case "contracting_discord": return await deliverContractingDiscord(intakeId, deps);
    case "contracting_workbook": return await deliverContractingWorkbook(intakeId, deps);
    case "ethos_sheet": return await deliverEthosSheet(intakeId, deps);
    default: throw new Error(`Unsupported contracting destination: ${destination || "none"}`);
  }
}

// ── Exactly-once across the provider/database gap ────────────────────────────
//
// A provider call and the database write that records it are two operations,
// and the gap between them is real. If Discord accepts the POST and the
// settlement write then fails, the outbox marks the event failed and the next
// cron tick posts the producer's details into the channel a SECOND time.
//
// Email does not have this problem: the Resend idempotency key is derived from
// the intake id, so Resend itself collapses a repeat. Ethos does not have it
// either, for a different reason — a retry re-reads the sheet, finds the NPN it
// just wrote, and takes the update branch instead of appending. Discord has no
// idempotency key and no readable state, so it is the one destination where a
// repeat genuinely duplicates.

export type RetrySafety =
  /** The provider collapses repeats itself (Resend idempotency key). */
  | "provider_idempotent"
  /** A repeat converges on the same end state (Ethos dedupes by NPN). */
  | "naturally_idempotent"
  /** A repeat produces a second real side effect. Never auto-retry blind. */
  | "not_idempotent";

export const DESTINATION_RETRY_SAFETY: Record<string, RetrySafety> = {
  contracting_email: "provider_idempotent",
  contracting_discord: "not_idempotent",
  ethos_sheet: "naturally_idempotent",
  contracting_workbook: "naturally_idempotent",
};

/**
 * The ONLY delivery states a generic failure handler may overwrite.
 *
 * Just the two un-settled ones. Everything else is excluded, and each exclusion
 * is load-bearing:
 *
 *   attempting / unknown_outcome — the markers that stop a duplicate post.
 *     Overwriting either with 'failed' makes the next tick read a clean retry.
 *   delivered / accepted — a real side effect already happened. The dispatcher
 *     updates the delivery row BEFORE the outbox row, so a failure in that
 *     second write would otherwise rewrite a settled 'delivered' back to
 *     'failed' and the next claim would POST again.
 *   manual_review / not_configured — terminal verdicts a machine cannot fix by
 *     trying harder.
 *   dead_letter — already given up on; reviving it silently is worse than
 *     leaving it for a person.
 */
export const FAILURE_OVERWRITABLE_STATES = ["queued", "failed"] as const;

/**
 * Read a system_settings value from a Supabase query result.
 *
 * THROWS on a query error rather than returning null. Returning null would make
 * a database outage indistinguishable from "no webhook configured", and
 * not_configured is a terminal verdict — one transient blip would permanently
 * mark the Discord destination unconfigured and nothing would ever retry it.
 */
export function readSettingFromResult(
  result: { data?: { value?: unknown } | null; error?: { message?: string } | null },
  key: string,
): string | null {
  if (result.error) {
    throw new Error(`Could not read system_settings.${key}: ${result.error.message ?? "query failed"}`);
  }
  const raw = result.data?.value;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

export type SettlementDeps = {
  /** Current state of this (intake, destination) delivery row. */
  currentState(): Promise<string>;
  /** Write-ahead marker, before a non-idempotent provider call. */
  markAttempting(): Promise<void>;
  /** Clear the marker after a definite rejection, so normal retry resumes. */
  clearAttempting(): Promise<void>;
  /** Record the settled verdict and receipt. */
  settle(outcome: DeliveryOutcome): Promise<void>;
  /** Park the row as unrecoverable-by-machine. */
  markUnknownOutcome(note: string): Promise<void>;
};

export type RunVerdict = {
  /** 'retry' is expressed by throwing; these two never auto-retry. */
  verdict: "delivered" | "manual_action_required";
  state: string;
  providerMessageId?: string;
};

/**
 * Run one destination with exactly-once protection across the settlement gap.
 */
export async function runContractingDelivery(
  destination: string,
  intakeId: string,
  deps: DeliveryDeps & SettlementDeps,
): Promise<RunVerdict> {
  const safety = DESTINATION_RETRY_SAFETY[destination] ?? "not_idempotent";
  const prior = await deps.currentState();

  // A previous run reached a non-idempotent provider and never got to record
  // the result. We cannot tell whether the message exists, and guessing wrong
  // in one direction posts a producer's details twice. Hand it to a person.
  if (prior === "attempting" && safety === "not_idempotent") {
    const note =
      "A previous attempt reached the provider but the result could not be recorded. " +
      "Check the channel before retrying; this will not resend automatically.";
    await deps.markUnknownOutcome(note);
    return { verdict: "manual_action_required", state: "unknown_outcome" };
  }

  // Already settled. Re-running would duplicate a side effect for no gain.
  if (prior === "delivered" || prior === "accepted" || prior === "unknown_outcome") {
    return {
      verdict: prior === "unknown_outcome" ? "manual_action_required" : "delivered",
      state: prior,
    };
  }

  if (safety === "not_idempotent") await deps.markAttempting();

  let outcome: DeliveryOutcome;
  try {
    outcome = await deliverContractingDestination(destination, intakeId, deps);
  } catch (error) {
    if (safety === "not_idempotent") {
      if ((error as ProviderRejectedError)?.definite) {
        // Discord answered and refused, so no message exists. Clear the marker
        // and let the normal retry path run; leaving it would create a false
        // manual review for a post that never happened.
        await deps.clearAttempting().catch((clearError) => {
          // The row stays 'attempting', so the next run escalates to a person
          // rather than reposting. Safe, but louder than it looks: say so.
          console.error("[contracting] could not clear the in-flight marker:", String(clearError));
        });
        throw error;
      }
      // AMBIGUOUS: we never saw a response, so the POST may have been received.
      // Throwing here is not safe. The dispatcher's failure path would mark the
      // row 'failed', the next tick would read 'failed' rather than
      // 'attempting', and it would post a second time — the marker would have
      // bought us nothing. Settle it here instead, in this run, and return a
      // verdict that never auto-retries.
      await deps
        .markUnknownOutcome(
          "The provider call did not complete cleanly, so we cannot tell whether it was received. " +
            "Check the channel; it will not be resent automatically.",
        )
        .catch((markError) => {
          // We still return manual_action_required, so this event is not
          // re-queued. The row keeps 'attempting', which the next run also
          // refuses to auto-retry — the duplicate is still prevented, but the
          // reason is now only in the log, so it must actually reach the log.
          console.error("[contracting] could not record unknown_outcome:", String(markError));
        });
      return { verdict: "manual_action_required", state: "unknown_outcome" };
    }
    throw error;
  }

  const providerActed = outcome.state === "delivered" || outcome.state === "accepted";

  try {
    await deps.settle(outcome);
  } catch (settleError) {
    if (!providerActed) throw settleError; // Nothing happened; a retry is safe.

    if (safety === "not_idempotent") {
      // The message exists but we could not record it. Do NOT throw: throwing
      // returns this event to the retry queue and posts it again.
      await deps
        .markUnknownOutcome(
          "The provider accepted this but the receipt could not be stored. " +
            "Verify in the channel; it will not be resent automatically.",
        )
        .catch((markError) => {
          // Worst case in this whole flow: the message exists, the receipt is
          // lost, and now the escalation write failed too. Returning
          // manual_action_required still keeps it out of the retry queue.
          console.error("[contracting] could not record unknown_outcome after a provider success:", String(markError));
        });
      return { verdict: "manual_action_required", state: "unknown_outcome" };
    }
    // Idempotent destinations converge on a retry, so let it retry.
    throw settleError;
  }

  if (outcome.state === "not_configured" || outcome.state === "manual_review") {
    return { verdict: "manual_action_required", state: outcome.state };
  }
  return {
    verdict: "delivered",
    state: outcome.state,
    providerMessageId: (outcome.receipt?.message_id as string) ?? undefined,
  };
}

// ── Ethos "Agent Updates" leg (MP-304) ────────────────────────────────────────────────────────
//
// One row per approved change: A:C identify the agent, D:H carry ONLY the changes. I is the sheet's own
// column and J:L belong to Ethos; neither is ever written. Unlike the signup leg this is NOT naturally
// idempotent — a second identical row is a second request — so the planned row number is recorded BEFORE
// the write, and a retry after an uncertain answer re-reads that exact row instead of appending again.

export type UpdateRow = {
  id: string;
  status: string;
  sheet_row: number | null;
  npn: string;
  first_name: string;
  last_name: string;
  change_upline_npn: string | null;
  change_comp_level: string | null;
  change_advance_tier: string | null;
  change_pii: string | null;
  termination_requested: boolean;
  termination_authorized_by: string | null;
  termination_authorized_at: string | null;
};

export type UpdateDeps = {
  readSetting(key: string): Promise<string | null>;
  loadUpdate(updateId: string): Promise<UpdateRow>;
  /** Called with the target row number right before the PUT, so a lost answer can be reconciled. */
  recordPlannedRow(rowNumber: number): Promise<void>;
  fetchImpl: FetchLike;
  googleCredential: string | null;
  now(): number;
  getToken?(credential: string, now: number, fetchImpl: FetchLike): Promise<string>;
};

export function updatesAgencyRange(tabTitle: string, rowNumber: number): string {
  return `${tabTitle}!A${rowNumber}:${columnLetter(UPDATES_AGENCY_COLUMNS - 1)}${rowNumber}`;
}

export function verifyUpdateReadBack(written: unknown[] | undefined, payload: (string | boolean)[]): { ok: boolean; mismatches: string[] } {
  const mismatches: string[] = [];
  for (let c = 0; c < UPDATES_AGENCY_COLUMNS; c++) {
    if (trimOuter(written?.[c]) !== trimOuter(payload[c])) mismatches.push(UPDATES_HEADERS[c]);
  }
  return { ok: mismatches.length === 0, mismatches };
}

export async function deliverEthosUpdate(updateId: string, deps: UpdateDeps): Promise<DeliveryOutcome> {
  const rawConfig = await deps.readSetting("ethos_agents_sheet");
  if (!rawConfig) return { state: "not_configured", receipt: null, note: "system_settings.ethos_agents_sheet is missing." };
  const enabled = (await deps.readSetting("ethos_sheet_writes_enabled")) === "true";
  if (!enabled) {
    return { state: "not_configured", receipt: null, note: "Automated Ethos sheet writes are OFF (system_settings.ethos_sheet_writes_enabled). The update stays queued." };
  }
  if (!deps.googleCredential) {
    return { state: "not_configured", receipt: null, note: "No Google service credential. Set the GOOGLE_SERVICE_ACCOUNT_JSON function secret and grant that service account Editor on the Agents sheet." };
  }
  const config = JSON.parse(rawConfig) as EthosSheetConfig;
  const tab = config.updates_tab || UPDATES_TAB.title;
  const u = await deps.loadUpdate(updateId);

  const req: UpdateRequest = {
    first_name: u.first_name, last_name: u.last_name, npn: u.npn,
    change_upline_npn: u.change_upline_npn, change_comp_level: u.change_comp_level, change_advance_tier: u.change_advance_tier,
    change_pii_correction: u.change_pii,
    termination: u.termination_requested ? { requested: true, authorized_by: u.termination_authorized_by, authorized_at: u.termination_authorized_at } : null,
  };
  const built = buildUpdateRequestRow(req);
  if (!built.row) {
    return { state: "manual_review", receipt: null, note: `Held by the Ethos update gate: ${built.blockers.map((b) => b.code).join(", ") || "row incomplete"}.` };
  }
  const payload = built.row;

  const exchange = deps.getToken ?? ((cred: string, now: number, f: FetchLike) => getAccessToken(JSON.parse(cred), now, f));
  const token = await exchange(deps.googleCredential, deps.now(), deps.fetchImpl);
  const sheets = createSheetsClient(config.sheet_id, token, deps.fetchImpl);

  if (config.layout === "mgn") {
    // MGN "Update Agent": header on row 1, A:G text, H a checkbox (boolean). Rows are pre-filled with FALSE in H,
    // so "populated" means A..G, never H.
    const mtab = config.updates_tab || "Update Agent";
    const mrows = await sheets.getRange(`${mtab}!A:H`);
    const mh = verifyMgnHeader(MGN_UPDATE_AGENT_HEADERS, mrows[0]);
    if (!mh.ok) return { state: "manual_review", receipt: null, note: `Header drift on the MGN Update Agent tab (${mh.drift.join(", ")}); an admin reconciles the layout.` };
    const mp: (string | boolean)[] = [payload[0], payload[1], payload[2], payload[3], payload[4] ? mgnCompPercent(payload[4], null) : "", payload[5], payload[6], u.termination_requested === true];
    const same = (got: unknown[] | undefined) => mp.every((want, c) => c === 7 ? parseSheetBoolean(got?.[c]) === want : trimOuter(got?.[c]) === trimOuter(want));
    if (u.sheet_row && (u.status === "attempting" || u.status === "unknown_outcome")) {
      const prior = mrows[u.sheet_row - 1] ?? [];
      if (same(prior)) return { state: "delivered", receipt: { provider: "google_sheets", action: "reconciled_prior_write", row: u.sheet_row, layout: "mgn", read_back_verified: true }, note: "A previous attempt had landed; reconciled from the sheet, nothing written again." };
      if (mgnPopulated(prior, 6)) return { state: "manual_review", receipt: null, note: `Row ${u.sheet_row} was planned for this update but holds different values; a person decides.` };
    }
    let mtarget = MGN_FIRST_DATA_ROW;
    for (let i = MGN_FIRST_DATA_ROW - 1; i < mrows.length; i++) if (mgnPopulated(mrows[i], 6)) mtarget = i + 2;
    const mfresh = await sheets.getRange(mgnRange(mtab, mtarget));
    if (mgnPopulated(mfresh[0], 6)) throw new Error(`MGN Update Agent row ${mtarget} is no longer empty; refusing to overwrite a concurrent edit`);
    await deps.recordPlannedRow(mtarget);
    const mreceipt = await sheets.updateRange(mgnRange(mtab, mtarget), [mp]);
    const mwritten = (await sheets.getRange(mgnRange(mtab, mtarget)))[0];
    if (!same(mwritten)) throw new Error("MGN Update Agent read-back mismatch");
    return {
      state: "delivered",
      receipt: { provider: "google_sheets", action: "appended_a_to_h_mgn", updated_range: mreceipt, row: mtarget, columns: [...MGN_UPDATE_AGENT_HEADERS], read_back_verified: true, review_items: built.review.map((r) => r.code), layout: "mgn" },
      note: "Written to MGN's Update Agent tab (A:H). Being on the sheet is a request to MGN/Ethos, not their confirmation.",
    };
  }

  const rows = await sheets.getRange(`${tab}!A:L`);
  const hdr = verifyHeaderSignature(UPDATES_HEADERS, rows[UPDATES_TAB.headerRow - 1]);
  if (!hdr.ok) {
    return { state: "manual_review", receipt: null, note: `Header drift on the Agent Updates tab (${hdr.drift.map((d) => d.column).join(", ")}); an admin reconciles the layout.` };
  }

  // A previous attempt recorded its row and never got to settle: the sheet is the verdict.
  if (u.sheet_row && (u.status === "attempting" || u.status === "unknown_outcome")) {
    const prior = rows[u.sheet_row - 1] ?? [];
    const check = verifyUpdateReadBack(prior, payload);
    if (check.ok) {
      return { state: "delivered", receipt: { provider: "google_sheets", action: "reconciled_prior_write", row: u.sheet_row, columns: UPDATES_HEADERS.slice(0, UPDATES_AGENCY_COLUMNS), read_back_verified: true }, note: "A previous attempt had landed; reconciled from the sheet, nothing written again." };
    }
    if (isPopulatedUpdateRow(prior)) {
      return { state: "manual_review", receipt: null, note: `Row ${u.sheet_row} was planned for this update but holds different values; a person decides.` };
    }
  }

  let target = UPDATES_TAB.firstDataRow;
  for (let i = UPDATES_TAB.firstDataRow - 1; i < rows.length; i++) if (isPopulatedUpdateRow(rows[i])) target = i + 2;
  const fresh = await sheets.getRange(updatesAgencyRange(tab, target));
  if (isPopulatedUpdateRow(fresh[0])) throw new Error(`Agent Updates row ${target} is no longer empty; refusing to overwrite a concurrent edit`);

  await deps.recordPlannedRow(target);
  const range = updatesAgencyRange(tab, target);
  const receipt = await sheets.updateRange(range, [payload]);
  const written = await sheets.getRange(range);
  const check = verifyUpdateReadBack(written[0], payload);
  if (!check.ok) throw new Error(`Agent Updates read-back mismatch on ${check.mismatches.join(", ")}`);
  return {
    state: "delivered",
    receipt: { provider: "google_sheets", action: "appended_a_to_h", updated_range: receipt, row: target, columns: UPDATES_HEADERS.slice(0, UPDATES_AGENCY_COLUMNS), read_back_verified: true, review_items: built.review.map((r) => r.code) },
    note: "Written to the Agent Updates agency block (A:H). Being on the sheet is a request to Ethos, not Ethos' confirmation.",
  };
}
