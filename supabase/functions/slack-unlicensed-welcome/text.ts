// Pure helpers for slack-unlicensed-welcome (no Deno.serve) so they can be tested.

export const LICENSING_COURSE_URL = "https://partners.xcelsolutions.com/afe";
export const GET_LICENSED_URL = "https://apex-financial.org/get-licensed#licensing-video";
export const PORTAL_URL = "https://apex-financial.org/dashboard";

// WP7 (2026-11-10): cohort-neutral. #unlicensed is about to become a default
// channel (Sam action N3), so licensed hires land here too. Receipts go to the
// portal, never the channel: nothing read the channel, and a purchase receipt is
// personal order data in a public room.
export function welcomeText(userId: string): string {
  return [
    `Welcome <@${userId}>.`,
    "",
    "*Not licensed yet? This is your room* until you are.",
    `*1. Start the pre-licensing course:* ${LICENSING_COURSE_URL}`,
    `*2. Bought it? Upload your course receipt in your Galaxy portal (${PORTAL_URL}).* That is how we verify it and unlock your licensing call. Please don't post receipts here: they carry personal order details.`,
    `*3. Watch the six-minute walkthrough of the whole path (course → exam → license):* ${GET_LICENSED_URL}`,
    "",
    "*Already licensed?* Head to #general and book your onboarding call from your portal.",
    "",
    "Stuck on anything? Ask here. Someone from the team will answer.",
  ].join("\n");
}

// Key-sorted JSON. Postgres jsonb stores keys in its own order (shortest first),
// so a plain JSON.stringify of the stored row never equals the fresh summary and
// the "on change" test would fire every tick. Caught on the first live rows.
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}
