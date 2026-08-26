/**
 * Slack signed-request verification for Supabase Edge Functions.
 *
 * Call verifySlackRequest before JSON/form parsing. The exact raw body is part
 * of Slack's signature base string and is returned for the handler to parse only
 * after authenticity and replay-window checks pass.
 */

const encoder = new TextEncoder();
const SLACK_SIGNATURE_VERSION = "v0";
export const DEFAULT_SLACK_REPLAY_WINDOW_SECONDS = 5 * 60;

export type SlackVerificationFailure =
  | "missing_secret"
  | "missing_timestamp"
  | "invalid_timestamp"
  | "stale_timestamp"
  | "missing_signature"
  | "invalid_signature_format"
  | "signature_mismatch";

export type SlackVerificationResult =
  | { ok: true; rawBody: string; timestamp: number }
  | { ok: false; rawBody: string; reason: SlackVerificationFailure };

type SlackVerifyOptions = {
  nowSeconds?: number;
  replayWindowSeconds?: number;
};

function hexToBytes(hex: string): ArrayBuffer | null {
  if (!/^[0-9a-f]{64}$/i.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes.buffer as ArrayBuffer;
}

async function verifyHmac(
  signingSecret: string,
  baseString: string,
  providedDigest: ArrayBuffer,
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );

  // Web Crypto performs the MAC comparison. Do not replace this with a normal
  // string equality check, which can leak timing information.
  return crypto.subtle.verify(
    "HMAC",
    key,
    providedDigest,
    encoder.encode(baseString),
  );
}

export async function verifySlackSignature(
  headers: Headers,
  rawBody: string,
  signingSecret: string,
  options: SlackVerifyOptions = {},
): Promise<SlackVerificationResult> {
  if (!signingSecret) return { ok: false, rawBody, reason: "missing_secret" };

  const timestampHeader = headers.get("x-slack-request-timestamp");
  if (!timestampHeader) {
    return { ok: false, rawBody, reason: "missing_timestamp" };
  }
  if (!/^\d+$/.test(timestampHeader)) {
    return { ok: false, rawBody, reason: "invalid_timestamp" };
  }

  const timestamp = Number(timestampHeader);
  if (!Number.isSafeInteger(timestamp)) {
    return { ok: false, rawBody, reason: "invalid_timestamp" };
  }

  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const replayWindowSeconds = options.replayWindowSeconds ??
    DEFAULT_SLACK_REPLAY_WINDOW_SECONDS;
  if (
    replayWindowSeconds < 0 ||
    Math.abs(nowSeconds - timestamp) > replayWindowSeconds
  ) {
    return { ok: false, rawBody, reason: "stale_timestamp" };
  }

  const signature = headers.get("x-slack-signature");
  if (!signature) return { ok: false, rawBody, reason: "missing_signature" };
  const expectedPrefix = `${SLACK_SIGNATURE_VERSION}=`;
  if (!signature.startsWith(expectedPrefix)) {
    return { ok: false, rawBody, reason: "invalid_signature_format" };
  }

  const digest = hexToBytes(signature.slice(expectedPrefix.length));
  if (!digest) {
    return { ok: false, rawBody, reason: "invalid_signature_format" };
  }

  const baseString = `${SLACK_SIGNATURE_VERSION}:${timestampHeader}:${rawBody}`;
  const matches = await verifyHmac(signingSecret, baseString, digest);
  if (!matches) return { ok: false, rawBody, reason: "signature_mismatch" };

  return { ok: true, rawBody, timestamp };
}

export async function verifySlackRequest(
  request: Request,
  signingSecret: string,
  options: SlackVerifyOptions = {},
): Promise<SlackVerificationResult> {
  const rawBody = await request.text();
  return verifySlackSignature(request.headers, rawBody, signingSecret, options);
}
