// next-step-dispatch ladder: which rungs run for one reminder, and what counts
// as the end of the ladder. Pure (no env, no SDK), so it is tested directly by
// ladder.test.ts and index.ts runs exactly this control flow.
//
// WP4 (2026-11-10 onboarding audit). A carrier email-to-text "SMS" used to end
// the ladder: send-sms-auto-detect answered outcome "sent", sendSms returned
// "gateway:<carrier>", the caller set delivered = true and the email rung never
// ran. "Sent" there only means Resend accepted a mail addressed to a carrier
// gateway. Resend over 30 days: 190 gateway mails, 18 delivered, 142 bounced,
// 30 suppressed. Over 90 days 488 of 726 reminders (193 people) went out as
// gateway SMS only, with no email. Rule now:
//   - a provider message SID ("twilio:<sid>") is a delivery and ends the ladder;
//   - a "gateway:" receipt is best effort: it is recorded, and the email rung
//     still runs for the same reminder;
//   - a Telegram enqueue ends the ladder as before (7 linked chats, real users).
// The result says what the email rung did, so the parent row can record it and
// apex-doctor #45 can tell "email rung never ran" (a regression) from "no email
// on file" or "email failed".

export type EmailRung = "sent" | "failed" | "no_email" | "skipped_terminal";

export interface LadderChannels {
  /** null when the person has no linked Telegram chat (or opted out) */
  telegram: (() => Promise<void>) | null;
  /** null when no usable phone. Resolves to a receipt, throws when nothing was sent. */
  sms: (() => Promise<string>) | null;
  /** null when no email on file. Resolves to the provider message id. */
  email: (() => Promise<string>) | null;
}

export interface LadderResult {
  /** the rung that ended the ladder with a real delivery, or null */
  terminal: "telegram" | "sms" | "email" | null;
  smsReceipt: string | null;
  /** a gateway SMS was accepted; not proof of delivery */
  smsBestEffort: boolean;
  emailId: string | null;
  emailRung: EmailRung;
  /** anything at all went out (terminal or best-effort SMS) */
  anySent: boolean;
  errors: string[];
}

/** Only a provider message SID proves a text was handed to a carrier network for this person. */
export function isTerminalSmsReceipt(receipt: string | null | undefined): boolean {
  return typeof receipt === "string" && /^twilio:[A-Za-z0-9]{8,}$/.test(receipt);
}

export async function runLadder(ch: LadderChannels): Promise<LadderResult> {
  const r: LadderResult = {
    terminal: null, smsReceipt: null, smsBestEffort: false, emailId: null,
    emailRung: "no_email", anySent: false, errors: [],
  };

  if (ch.telegram) {
    try {
      await ch.telegram();
      r.terminal = "telegram";
    } catch (e) {
      r.errors.push(`telegram: ${(e as Error)?.message ?? e}`);
    }
  }

  if (!r.terminal && ch.sms) {
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
      r.errors.push(`email: ${(e as Error)?.message ?? e}`);
    }
  }

  r.anySent = r.terminal !== null || r.smsBestEffort;
  return r;
}
