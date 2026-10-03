// instagram-token-dead.ts — one verdict for "the Instagram Graph token is dead",
// shared by send-instagram-dm (sees the 190 on a real send), cron-inbound-brain-health
// (probes /me every 5 min) and instagram-token-keepalive (weekly refresh).
//
// 2026-10-01 14:37Z: Meta invalidated the token ("user changed their password or
// Facebook changed the session"). 305 DMs failed over two days, every "Apex"
// commenter got nothing, and no page went out: the keepalive only grades days-left
// (55 remained) and the brain-health probe only asks whether the responder answers.
// A dead token with 55 days on the clock was invisible to both. This helper pages
// once per 6h window through the real alert ladder and carries the reconnect link,
// so the page says how to fix it instead of only that it broke.
import { raiseApexAlert } from "./alert-raise.ts";

// deno-lint-ignore no-explicit-any
type Sb = any;

export const TOKEN_DEAD_EVENT = "instagram_token_dead";
export const TOKEN_DEAD_PAGE_WINDOW_HOURS = 6;

/** Meta's OAuthException 190 family: invalidated, expired, or revoked token. */
export function isTokenDeadError(err: { code?: number; message?: string } | null | undefined): boolean {
  if (!err) return false;
  if (err.code === 190) return true;
  return /access token|session has been invalidated|token (has )?expired/i.test(err.message ?? "");
}

/** Live probe. Returns { dead:false } on a 200 from /me; the Meta error otherwise. */
export async function probeInstagramToken(token: string | null): Promise<{ dead: boolean; error: string | null; username: string | null }> {
  if (!token) return { dead: true, error: "no token stored", username: null };
  try {
    const r = await fetch(`https://graph.instagram.com/v21.0/me?fields=id,username&access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(10000) });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j?.id) return { dead: false, error: null, username: j.username ?? null };
    const e = j?.error ?? {};
    // Only the token family is a verdict; a 5xx from Meta is "could not look", not dead.
    if (isTokenDeadError(e)) return { dead: true, error: e.message ?? `HTTP ${r.status}`, username: null };
    return { dead: false, error: `unverified: ${e.message ?? `HTTP ${r.status}`}`, username: null };
  } catch (e) {
    return { dead: false, error: `unverified: ${e instanceof Error ? e.message : String(e)}`, username: null };
  }
}

/** The one-tap reconnect link, from instagram-auth's own env (never hand-built here). */
export async function reconnectLink(): Promise<string | null> {
  const base = Deno.env.get("SUPABASE_URL") ?? "https://xrzweoneiieddzxogewk.supabase.co";
  try {
    const r = await fetch(`${base}/functions/v1/instagram-auth?link=1&format=json`, { signal: AbortSignal.timeout(8000) });
    const j = await r.json().catch(() => ({}));
    return typeof j?.link === "string" ? j.link : null;
  } catch { return null; }
}

/**
 * Page Sam that the token is dead, at most once per 6h. Dedupe reads bot_alerts
 * for the same event_type, so three functions sharing this never triple-page.
 * Returns what happened so the caller can put it in its own response body.
 */
export async function pageTokenDead(sb: Sb, source: string, errorText: string): Promise<{ paged: boolean; receipt: string }> {
  const since = new Date(Date.now() - TOKEN_DEAD_PAGE_WINDOW_HOURS * 3600 * 1000).toISOString();
  const { data: recent, error: qErr } = await sb.from("bot_alerts").select("id").eq("event_type", TOKEN_DEAD_EVENT).gte("created_at", since).limit(1);
  // If the dedupe read itself fails, page anyway: a lost page costs more than a repeat.
  if (!qErr && recent?.length) return { paged: false, receipt: `deduped: ${TOKEN_DEAD_EVENT} already raised within ${TOKEN_DEAD_PAGE_WINDOW_HOURS}h` };
  const link = await reconnectLink();
  const raised = await raiseApexAlert({
    source,
    eventType: TOKEN_DEAD_EVENT,
    severity: "critical",
    subject: "Instagram DMs are DOWN — token dead, tap to reconnect",
    body: `Meta rejected the Instagram token (${errorText}). Every DM and comment reply from the assistant is failing until you reconnect. Tap, then Allow: ${link ?? "(link unavailable — open instagram-auth?link=1)"} — replies that failed while it was down are replayed automatically the moment the new token lands.`,
    smsBody: "IG DMs DOWN: token dead. Tap the reconnect link in email/Discord.".slice(0, 90),
    actionLink: link ?? undefined,
  });
  return { paged: raised.ok, receipt: raised.receipt };
}
