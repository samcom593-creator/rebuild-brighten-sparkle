// Discord webhook delivery with an honest notion of "dead".
//
// WP7 (2026-11-10): Discord answers a deleted webhook with 404 + JSON code
// 10015 ("Unknown Webhook") and a revoked token with 401 + code 50027
// ("Invalid Webhook Token"). Neither can come back by retrying. The old loop
// retried every non-429 failure 4 times, and the outbox retried the event 5
// more, so one event against a dead webhook cost up to 20 Discord calls and
// ended as a dead letter that read like an outage. A dead webhook is now a
// typed, terminal result the caller can record as such.
//
// Pure module (no Deno.serve, no Supabase client) so the deno test can drive it.

export const DEAD_WEBHOOK_CODES: Readonly<Record<number, number>> = {
  404: 10015, // Unknown Webhook
  401: 50027, // Invalid Webhook Token
};

export class WebhookDeadError extends Error {
  readonly terminal = "webhook_dead" as const;
  constructor(readonly httpStatus: number, readonly discordCode: number) {
    super(`Discord webhook is dead (HTTP ${httpStatus}, code ${discordCode})`);
    this.name = "WebhookDeadError";
  }
}

export type SendDeps = {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function discordCode(bodyText: string): number | null {
  try {
    const code = JSON.parse(bodyText)?.code;
    return typeof code === "number" ? code : null;
  } catch { // empty-catch-allow:discord-error-body-may-be-non-json
    return null;
  }
}

export async function sendToDiscord(
  webhookUrl: string,
  payload: Record<string, unknown>,
  deps: SendDeps = {},
): Promise<{ httpStatus: number; messageId: string | null }> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const backoff = [0, 800, 2000, 5000];
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await sleep(backoff[attempt]);
    const target = new URL(webhookUrl);
    target.searchParams.set("wait", "true");
    const res = await fetchImpl(target.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.status === 429) {
      const body = await res.json().catch(() => ({}));
      const wait = ((body as { retry_after?: number }).retry_after ?? 2) * 1000;
      await sleep(wait);
      continue;
    }
    if (res.ok || res.status === 204) {
      const body = await res.text();
      let messageId: string | null = null;
      try {
        messageId = String(JSON.parse(body)?.id ?? "") || null;
      } catch { // empty-catch-allow:discord-204-has-no-json-body
        // Discord may return 204 without a response body.
      }
      return { httpStatus: res.status, messageId };
    }
    const text = await res.text().catch(() => "");
    const expected = DEAD_WEBHOOK_CODES[res.status];
    if (expected !== undefined && discordCode(text) === expected) {
      // Terminal. No retry can resurrect a deleted or revoked webhook.
      throw new WebhookDeadError(res.status, expected);
    }
    if (attempt === 3) throw new Error(`Discord ${res.status}: ${text}`);
  }
  throw new Error("Discord retry loop exhausted");
}
