// instagram-pause.ts — one verdict for "every automated action on Instagram is paused".
//
// Sam, 2026-11-04: "pause all automations on Instagram as a whole. All automated
// messaging on Instagram as a whole. I'm not taking any risks with Instagram."
// Meta had been refusing the bot's link sends since 2026-09-28 and stamped a fresh
// refusal at 2026-11-03T11:59Z (system_settings.instagram_links_blocked_at). The
// automated lanes move to ManyChat, Meta's own partner surface.
//
// The verdict is one row: system_settings.instagram_automation_paused_at holds the
// ISO timestamp of the pause; an absent or empty row means not paused. Every function
// that can write to Instagram asks this helper FIRST, before it reads a token or
// builds a Graph request, so a paused run never touches graph.instagram.com:
//   send-instagram-dm            DMs, private replies, public comment replies
//   instagram-comments-backfill  public replies under older comments (+ DMs via the sender)
//   instagram-dm-nudge           follow-up DMs (the recovery emails are not Instagram and still run)
//   instagram-dm-replay          held-row replay after a token refresh
//   ig-trial-reel-publish        media publishing
//   manychat-webhook             the brain: still classifies, logs and pages Sam, but
//                                hands the Instagram transport nothing to send
// Inbound is untouched: instagram-webhook keeps logging instagram_events and
// inbox_messages, the token keepalive keeps the credential alive, and the licensed
// lead page still reaches Sam's phone. He answers by hand. The one send that may pass
// the sender while paused is a reply a signed-in human typed on the desk.
//
// Fail CLOSED. If the setting cannot be read, the caller is told "paused, unverified"
// and sends nothing. A missed reply during a database blip is visible in the logs;
// an automated send during a pause Sam asked for is the thing this file exists to
// prevent. Resume = business-ops/scripts/instagram-pause.sh resume (deletes the row).

// deno-lint-ignore no-explicit-any
type Sb = any;

export const INSTAGRAM_PAUSE_KEY = "instagram_automation_paused_at";
export const INSTAGRAM_PAUSE_REASON_KEY = "instagram_automation_paused_reason";

export interface InstagramPauseVerdict {
  paused: boolean;
  /** The ISO timestamp Sam paused at, when the row is readable. */
  since: string | null;
  reason: string | null;
  /** false = the setting could not be read and the verdict is the fail-closed default. */
  verified: boolean;
}

function unquote(v: unknown): string {
  return typeof v === "string" ? v.trim().replace(/^"|"$/g, "").trim() : "";
}

/** Reads the pause flag. Never throws; an unreadable flag reads as paused + unverified. */
export async function instagramPaused(sb: Sb): Promise<InstagramPauseVerdict> {
  try {
    const { data, error } = await sb.from("system_settings").select("key,value")
      .in("key", [INSTAGRAM_PAUSE_KEY, INSTAGRAM_PAUSE_REASON_KEY]);
    if (error) {
      console.error("[instagram-pause] flag unreadable, failing closed:", error.message);
      return { paused: true, since: null, reason: `unverified: ${error.message}`, verified: false };
    }
    const rows = (data ?? []) as Array<{ key: string; value: unknown }>;
    const since = unquote(rows.find((r) => r.key === INSTAGRAM_PAUSE_KEY)?.value);
    const reason = unquote(rows.find((r) => r.key === INSTAGRAM_PAUSE_REASON_KEY)?.value);
    return { paused: since.length > 0, since: since || null, reason: reason || null, verified: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[instagram-pause] flag read threw, failing closed:", msg);
    return { paused: true, since: null, reason: `unverified: ${msg}`, verified: false };
  }
}

export interface PauseRefusal {
  kind: "dm" | "private_reply" | "public_reply" | "dm_brain" | "comment_brain" | "nudge" | "replay" | "backfill" | "publish";
  external_id?: string | null;
  comment_id?: string | null;
  message?: string | null;
  caller?: string | null;
  meta?: Record<string, unknown>;
}

/** The receipt: what the pause refused, so Sam can see what would have gone out. Best-effort. */
export async function recordPauseRefusal(sb: Sb, r: PauseRefusal): Promise<void> {
  try {
    const { error } = await sb.from("instagram_pause_refusals").insert({
      kind: r.kind,
      external_id: r.external_id ?? null,
      comment_id: r.comment_id ?? null,
      message: r.message ? String(r.message).slice(0, 2000) : null,
      caller: r.caller ?? null,
      meta: r.meta ?? {},
    });
    if (error) console.error("[instagram-pause] refusal receipt not written:", error.message);
  } catch (e) {
    console.error("[instagram-pause] refusal receipt threw:", e instanceof Error ? e.message : String(e));
  }
}

/** The uniform "nothing sent" reply: ok:false so every caller's `j.ok` test reads it as not sent. */
export function pausedResponse(v: InstagramPauseVerdict, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({
    ok: false, paused: true, since: v.since, reason: v.reason, verified: v.verified,
    error: "instagram_automation_paused", retryable: false, ...extra,
  }), { status: 200, headers: { ...headers, "Content-Type": "application/json" } });
}
