// next-step-dispatch ladder: which rungs run for one reminder, and what counts as a
// delivery. Pure (no env, no SDK), so it is tested directly by ladder.test.ts and index.ts
// runs exactly this control flow.
//
// WP4 (2026-11-10 onboarding audit). A carrier email-to-text "SMS" used to end the ladder:
// send-sms-auto-detect answered outcome "sent", sendSms returned "gateway:<carrier>", the
// caller set delivered = true and the email rung never ran. Over 90 days 488 of 726
// reminders (193 people) went out as gateway SMS only, with no email.
//
// MP-ONBOARD-ANCHOR-PKG1 (2026-11-12), message_map F1/F2. A Telegram enqueue still ended the
// ladder and stamped the parent "sent": 11 of 15 ladder Telegram messages then failed
// (template_missing) and nobody got the reminder. A queue insert is not a delivery. Rule now:
//   - ONLY a provider receipt is a delivery: a Resend message id from the email rung, or a
//     Twilio message SID ("twilio:<sid>");
//   - a Telegram enqueue and a "gateway:" SMS are best effort: recorded, never terminal,
//     and the email rung always runs after them (and after any rung that failed or skipped);
//   - the result says what the email rung did and keeps its raw error, so index.ts can tell
//     a transient provider error (retry) from a permanent one (fail) without parsing strings.

export type EmailRung = "sent" | "failed" | "no_email" | "skipped_terminal";

export interface LadderChannels {
  /** null when the person has no linked Telegram chat (or opted out). Resolves when queued. */
  telegram: (() => Promise<unknown>) | null;
  /** null when no usable phone. Resolves to a receipt, throws when nothing was sent. */
  sms: (() => Promise<string>) | null;
  /** null when no email on file. Resolves to the provider message id. */
  email: (() => Promise<string>) | null;
}

export interface LadderResult {
  /** the rung that produced a VERIFIED delivery (provider receipt), or null */
  terminal: "sms" | "email" | null;
  smsReceipt: string | null;
  /** a gateway SMS was accepted; not proof of delivery */
  smsBestEffort: boolean;
  /** a Telegram message was queued; not proof of delivery */
  telegramQueued: boolean;
  emailId: string | null;
  emailRung: EmailRung;
  /** the email rung's own error, unparsed (index.ts classifies transient vs permanent) */
  emailError: unknown;
  /** a verified receipt exists */
  anySent: boolean;
  /** something went out on a best-effort channel, but nothing verifiable */
  bestEffortOnly: boolean;
  errors: string[];
}

/** Only a provider message SID proves a text was handed to a carrier network for this person. */
export function isTerminalSmsReceipt(receipt: string | null | undefined): boolean {
  return typeof receipt === "string" && /^twilio:[A-Za-z0-9]{8,}$/.test(receipt);
}

export async function runLadder(ch: LadderChannels): Promise<LadderResult> {
  const r: LadderResult = {
    terminal: null, smsReceipt: null, smsBestEffort: false, telegramQueued: false, emailId: null,
    emailRung: "no_email", emailError: null, anySent: false, bestEffortOnly: false, errors: [],
  };

  if (ch.telegram) {
    try {
      await ch.telegram();
      r.telegramQueued = true;
    } catch (e) {
      r.errors.push(`telegram: ${(e as Error)?.message ?? e}`);
    }
  }

  if (ch.sms) {
    try {
      const receipt = await ch.sms();
      r.smsReceipt = receipt;
      if (isTerminalSmsReceipt(receipt)) r.terminal = "sms";
      else r.smsBestEffort = true;
    } catch (e) {
      r.errors.push(`sms: ${(e as Error)?.message ?? e}`);
    }
  }

  if (r.terminal) {
    r.emailRung = "skipped_terminal";
  } else if (ch.email) {
    try {
      r.emailId = await ch.email();
      r.emailRung = "sent";
      r.terminal = "email";
    } catch (e) {
      r.emailRung = "failed";
      r.emailError = e;
      r.errors.push(`email: ${(e as Error)?.message ?? e}`);
    }
  }

  r.anySent = r.terminal !== null;
  r.bestEffortOnly = !r.anySent && (r.telegramQueued || r.smsBestEffort);
  return r;
}
