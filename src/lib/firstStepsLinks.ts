/**
 * The first-steps links a manager sends a new hire from My Team (2026-11-26, Sam: "make it easy for me to send
 * over links such as the Discord link or anything like that").
 *
 * Pure: the text is built here so it can be tested; src/hooks/useFirstStepLinks.ts reads the three settings
 * and src/components/team/TeamList.tsx (SendLinksMenu) texts, emails or copies the result.
 */

/**
 * The course link the hired first-steps email sends (supabase/functions/send-agent-onboarding-email/reminders.ts,
 * FIELD_COURSE_URL). Repeated here by hand because the edge function cannot be imported into the app bundle.
 */
export const FIELD_COURSE_URL = "https://galaxyfinancial.org/dashboard/training/sales-course";

/** The system_settings keys the other three links live under: the same keys the onboarding email reads. */
export const FIRST_STEP_LINK_KEYS = {
  discord: "discord_invite_url",
  slack: "slack_community_invite_url",
  call: "onboarding_call_scheduling_url",
} as const;

export interface FirstStepLinks {
  /** Each is "" when the setting is not set, and the text then leaves that line out. */
  slack: string;
  discord: string;
  call: string;
}

/** The three links from system_settings rows, trimmed; a key that is not set reads "". */
export function firstStepLinksFromSettings(rows: ReadonlyArray<{ key: string | null; value: unknown }>): FirstStepLinks {
  const map = new Map(rows.map((r) => [r.key ?? "", String(r.value ?? "").trim()] as const));
  return {
    slack: map.get(FIRST_STEP_LINK_KEYS.slack) ?? "",
    discord: map.get(FIRST_STEP_LINK_KEYS.discord) ?? "",
    call: map.get(FIRST_STEP_LINK_KEYS.call) ?? "",
  };
}

/** The first word of a name, or "" when no name is on file. */
export function firstNameOf(fullName: string | null | undefined): string {
  return (fullName ?? "").trim().split(/\s+/).filter(Boolean)[0] ?? "";
}

/** The lines the text will carry, in order, by name, so the menu can say what is included. */
export function firstStepsLinkLines(links: Partial<FirstStepLinks> | null | undefined): Array<{ key: "training" | "slack" | "discord" | "call"; label: string; url: string }> {
  const lines: Array<{ key: "training" | "slack" | "discord" | "call"; label: string; url: string }> = [
    { key: "training", label: "Training videos", url: FIELD_COURSE_URL },
    { key: "slack", label: "Slack", url: (links?.slack ?? "").trim() },
    { key: "discord", label: "Discord", url: (links?.discord ?? "").trim() },
    { key: "call", label: "Book your call with Sam", url: (links?.call ?? "").trim() },
  ];
  return lines.filter((l) => l.url);
}

/**
 * The plain-text message: a greeting, one line per link that is set, and a sign-off. No markdown, so it reads
 * the same in a text, a DM or an email body. A link that is not set is left out rather than printed blank.
 */
export function buildFirstStepsText(firstName: string | null | undefined, links: Partial<FirstStepLinks> | null | undefined): string {
  const name = (firstName ?? "").trim();
  const greeting = name ? `Hey ${name}, your first steps at Galaxy:` : "Hey there, your first steps at Galaxy:";
  const body = firstStepsLinkLines(links).map((l) => `${l.label}: ${l.url}`);
  return [greeting, ...body, "Reply here if anything is stuck. Sam"].join("\n");
}
