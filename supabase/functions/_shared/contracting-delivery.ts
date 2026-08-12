// Contracting intake delivery logic.
//
// Every database and network effect arrives through injected dependencies, so
// the dispatcher runs these functions against production and the vitest suite
// runs the SAME functions against stubs. Testing a reimplementation would prove
// nothing about the code that emails the support desk and posts to Discord.

import {
  aiRangeForRow,
  buildEthosAiRow,
  buildEthosComment,
  commentRangeForRow,
  matchEthosRow,
  rowNumberFromRange,
  verifyReadBack,
  type EthosConfig,
  type EthosIntake,
} from "./ethos.ts";
import { createSheetsClient, getAccessToken, type FetchLike } from "./google-sheets.ts";

/**
 * Thrown when a provider gave a definite rejection, so no side effect exists.
 * Distinguished from an ambiguous transport failure, where the request may have
 * been received even though we never saw the response.
 */
export class ProviderRejectedError extends Error {
  readonly definite = true;
}

export type IntakeRow = EthosIntake & { id: string; status: string };

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
};

/**
 * Read a URL out of a system_settings value.
 *
 * system_settings.value is TEXT, and this project stores some settings bare
 * ("agentlink@apex-financial.org") and others as JSON text
 * ('{"url": "https://...", "label": "..."}'). agentlink_master_invite is the
 * second kind, so a plain `typeof value === "string"` check treats the entire
 * JSON blob as the URL, fails the https test, and silently yields no link —
 * the AgentLink continuation would never appear for any producer.
 */
export function parseSettingUrl(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (value === "") return null;

  let candidate: unknown = value;
  if (value.startsWith("{") || value.startsWith('"')) {
    try {
      const parsed = JSON.parse(value);
      candidate = typeof parsed === "string" ? parsed : (parsed as { url?: unknown })?.url;
    } catch {
      // Not JSON after all; fall through and judge the raw string.
      candidate = value;
    }
  }
  return typeof candidate === "string" && /^https:\/\//i.test(candidate.trim())
    ? candidate.trim()
    : null;
}

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
 * This is a dedicated, private contracting channel, so it carries all five
 * intake fields — support staff cannot act without them. Every value is escaped
 * and allowed_mentions is emptied, so no crafted field can notify anyone.
 */
export function buildDiscordPayload(intake: IntakeRow): Record<string, unknown> {
  return {
    allowed_mentions: { parse: [] },
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
      ],
      footer: { text: `APEX Intake ${intake.id}` },
    }],
  };
}

export async function deliverContractingEmail(
  intakeId: string,
  deps: DeliveryDeps,
): Promise<DeliveryOutcome> {
  const intake = await deps.loadIntake(intakeId);
  const to = (await deps.readSetting("contracting_support_email"))
    ?? "agentlink@apex-financial.org";

  const lines = [
    `NPN: ${intake.npn}`,
    `Name: ${intake.first_name} ${intake.last_name}`,
    `Email: ${intake.email}`,
    `Phone: ${intake.phone_e164}`,
    `APEX Intake ID: ${intake.id}`,
  ];
  if (intake.status === "needs_review") {
    lines.push("", "HELD FOR REVIEW: the submitted email is already on a different NPN. Do not add this producer to Ethos until a person confirms who owns the address.");
  }

  // The idempotency key is derived from the intake, so a retry reuses Resend's
  // own idempotency and the support desk cannot receive a second copy of the
  // same producer.
  const messageId = await deps.sendEmail({
    to: [to],
    subject: `Contracting intake · ${intake.first_name} ${intake.last_name} · NPN ${intake.npn}`,
    text: lines.join("\n"),
  }, `contracting-intake-${intakeId}`);

  // ACCEPTED, not delivered. Resend has custody and gave us an id; nothing here
  // knows whether it reached a mailbox. Only a delivery webhook could say that,
  // and this project has none wired.
  return {
    state: "accepted",
    receipt: { provider: "resend", message_id: messageId, delivery_confirmed: false },
    note: null,
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
  const response = await deps.fetchImpl(`${webhook.trim()}?wait=true`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(buildDiscordPayload(intake)),
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

export async function deliverEthosSheet(
  intakeId: string,
  deps: DeliveryDeps,
): Promise<DeliveryOutcome> {
  const rawConfig = await deps.readSetting("ethos_agents_sheet");
  if (!rawConfig) {
    return { state: "not_configured", receipt: null, note: "system_settings.ethos_agents_sheet is missing." };
  }
  if (!deps.googleCredential) {
    return {
      state: "not_configured",
      receipt: null,
      note: "No Google service credential. Set the GOOGLE_SERVICE_ACCOUNT_JSON function secret and grant that service account Editor on the Agents sheet.",
    };
  }

  const config = JSON.parse(rawConfig) as EthosConfig;
  const intake = await deps.loadIntake(intakeId);

  // Belt and braces against the RPC's own hold: a row a human must adjudicate
  // never reaches the shared sheet, even if an event for it were enqueued.
  if (intake.status === "needs_review") {
    return {
      state: "manual_review",
      receipt: null,
      note: "Held: the submitted email is already on a different NPN.",
    };
  }

  const exchange = deps.getToken
    ?? ((cred: string, now: number, f: FetchLike) => getAccessToken(JSON.parse(cred), now, f));
  const token = await exchange(deps.googleCredential, deps.now(), deps.fetchImpl);
  const sheets = createSheetsClient(config.sheet_id, token, deps.fetchImpl);

  // Read ONLY A..I. The verified export proves the writable contract is A..I
  // plus Comments at S; J..R are other people's columns.
  const rows = await sheets.getRange(`${config.tab}!A:I`);
  const match = matchEthosRow(rows, intake);

  if (match.action === "manual_review") {
    return {
      state: "manual_review",
      receipt: null,
      note: `Held: ${match.reason}${match.rowNumber ? ` (sheet row ${match.rowNumber})` : ""}.`,
    };
  }

  const values = buildEthosAiRow(intake, config);
  const aiReceipt = match.action === "update"
    ? await sheets.updateRange(aiRangeForRow(config.tab, match.rowNumber), [values])
    : await sheets.appendRow(`${config.tab}!A:I`, values);

  // A 2xx means Google accepted the call, not that the right producer is in the
  // right row. Read it back before claiming anything.
  const written = await sheets.getRange(aiReceipt);
  const check = verifyReadBack(written[0] ?? [], intake);
  if (!check.ok) throw new Error(`Ethos read-back mismatch on ${check.mismatches.join(", ")}`);

  // Comments is a separate cell nine columns away, so a separate write, and it
  // runs only after the producer row is verified.
  const landedRow = rowNumberFromRange(aiReceipt);
  const commentReceipt = landedRow
    ? await sheets.updateRange(commentRangeForRow(config.tab, landedRow), [[buildEthosComment(config, intake.id)]])
    : null;

  return {
    state: "delivered",
    receipt: {
      provider: "google_sheets",
      updated_range: aiReceipt,
      comment_range: commentReceipt,
      action: match.action,
      read_back_verified: true,
    },
    note: null,
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
