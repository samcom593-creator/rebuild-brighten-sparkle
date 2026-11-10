// One source for the Slack community invite: system_settings.slack_community_invite_url.
//
// WP7 (2026-11-10): the invite was hardcoded in 7 senders. Rotating it (or a
// leak forcing a rotation) would have stranded every one of them on a dead
// link with nothing noticing. They now read the setting.
//
// Deliberately NO supabase-js import: a second SDK copy in a bundle is the
// MP-273 boot-death class. Plain fetch to PostgREST with the service key.
// Never throws: any failure returns the fallback, which is the live invite as
// of 2026-11-10 (verified in a real browser: "Join Apex Financial on Slack").

export const SLACK_INVITE_FALLBACK =
  "https://join.slack.com/t/apex-financial-co/shared_invite/zt-47rdeq1fr-ETmj8yGBgRcoYVkwfc3DBQ";

export function isSlackInviteUrl(value: unknown): value is string {
  return typeof value === "string" && /^https:\/\/join\.slack\.com\/t\/[A-Za-z0-9-]+\/shared_invite\/\S+$/.test(value.trim());
}

export async function readSlackInviteUrl(timeoutMs = 3000): Promise<string> {
  const url = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !key) return SLACK_INVITE_FALLBACK;
  try {
    const res = await fetch(
      `${url}/rest/v1/system_settings?key=eq.slack_community_invite_url&select=value&limit=1`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(timeoutMs) },
    );
    if (!res.ok) return SLACK_INVITE_FALLBACK;
    const rows = await res.json() as Array<{ value?: string }>;
    const value = rows?.[0]?.value?.trim();
    return isSlackInviteUrl(value) ? value : SLACK_INVITE_FALLBACK;
  } catch { // empty-catch-allow:slack-invite-read-falls-back
    return SLACK_INVITE_FALLBACK;
  }
}
