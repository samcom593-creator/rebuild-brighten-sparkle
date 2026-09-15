// One graded ntfy poster for every edge function that pushes to Sam's phone.
//
// THE DEFECT THIS EXISTS TO KILL. `fetch()` rejects only on a TRANSPORT failure.
// An HTTP 429, 401 or 500 is a perfectly ordinary resolved Response, so this:
//
//     await fetch(NTFY_URL, { method: "POST", headers, body }).catch(() => {});
//
// treats a refused push as a delivered one. Four edge functions shipped exactly
// that shape (generate-monthly-awards, consume-invite-token, xcel-gmail-pull,
// postmark-approval-monitor) and a fifth, apex-alert-dispatch, kept the status
// but threw the body away.
//
// WHY THE BODY IS THE WHOLE POINT. On 2026-09-14 apex-doctor Check #21 went
// CRITICAL with the receipt `http:429` and the sentence "Sam's primary phone push
// is not delivering". The status alone sends the next reader to tune a cadence.
// The BODY said:
//
//     {"code":42908,"error":"limit reached: daily message quota reached"}
//
// ntfy binds 42908 to the VISITOR IP, so it was the shared anonymous Supabase
// egress allowance — not Apex's own volume, and no cadence change could fix it.
// Pushes from the laptop to the same topic in the same minute returned 200. That
// diagnosis took 26 days precisely because the body naming it was discarded; the
// only two ntfy 429s ever recorded (site_shell_watch, 2026-08-19, during the real
// Vercel outage) are undiagnosable today for the same reason.
//
// site-shell-watch already captures the body and says why in its own comment.
// This module is that proven behaviour, factored out so the other callers stop
// each inventing their own silence. Guarded by scripts/check-ntfy-receipt.mjs.

import { headerSafe } from "./header-safe.ts";

export interface NtfyResult {
  /** True ONLY for a 2xx. A refusal is never dressed as a send. */
  ok: boolean;
  /** "ok" | "http:<status> <cause>" | "error:<transport>". Never bare. */
  receipt: string;
  /** ntfy's own numeric error code when it returned one (e.g. 42908). */
  code: number | null;
  /** HTTP status when a response was received at all, else null. */
  status: number | null;
}

export interface NtfyOptions {
  title: string;
  body: string;
  /** ntfy accepts 1-5 or min/low/default/high/urgent. */
  priority?: string;
  tags?: string;
  click?: string;
  attach?: string;
  timeoutMs?: number;
  /**
   * Retries apply to TRANSPORT failures and 5xx only. A 429 is deliberately NOT
   * retried: the quota is per-visitor-IP and per-day, so a retry cannot succeed
   * and only spends the caller's time. Default 1 retry (2 attempts total) —
   * postNtfy previously had none at all, unlike the 3x backoff apex-doctor and
   * bot_sql use.
   */
  retries?: number;
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests so a retry path does not actually sleep. */
  sleepImpl?: (ms: number) => Promise<void>;
}

/** ntfy answers a refusal with JSON carrying `code` and `error`. Pull the cause
 *  out when it is there; fall back to the raw text when it is not, because an
 *  unparsed body is still infinitely more diagnostic than a bare status. */
export function describeNtfyRefusal(status: number, rawBody: string): { receipt: string; code: number | null } {
  const text = (rawBody ?? "").trim();
  let code: number | null = null;
  let detail = text;
  if (text) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object") {
        if (typeof parsed.code === "number") code = parsed.code;
        if (typeof parsed.error === "string" && parsed.error) {
          detail = code === null ? parsed.error : `code=${code} ${parsed.error}`;
        }
      }
    } catch {
      // Not JSON. Keep the raw text — see the fallback note above.
    }
  }
  const suffix = detail ? ` ${detail.slice(0, 200)}` : "";
  return { receipt: `http:${status}${suffix}`, code };
}

export async function postNtfyGraded(url: string, opts: NtfyOptions): Promise<NtfyResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleepImpl ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const maxRetries = opts.retries ?? 1;

  // Title/Click are HTTP headers, so they are ByteStrings: an emoji subject
  // throws while the Request is being CONSTRUCTED, before any status exists.
  const headers: Record<string, string> = {
    Title: headerSafe(String(opts.title ?? "APEX alert").slice(0, 200)),
    Priority: opts.priority ?? "4",
  };
  if (opts.tags) headers.Tags = headerSafe(opts.tags);
  if (opts.click) headers.Click = headerSafe(opts.click);
  if (opts.attach) headers.Attach = headerSafe(opts.attach);

  let last: NtfyResult = { ok: false, receipt: "error:never attempted", code: null, status: null };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await doFetch(url, {
        method: "POST",
        headers,
        body: String(opts.body ?? "").slice(0, 4000),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return { ok: true, receipt: "ok", code: null, status: res.status };

      // THE LINE THE WHOLE MODULE IS FOR. Read the body before discarding the
      // response, and never let a non-2xx return ok.
      const rawBody = await res.text().catch(() => "");
      const { receipt, code } = describeNtfyRefusal(res.status, rawBody);
      last = { ok: false, receipt, code, status: res.status };

      // A quota or auth refusal is terminal for this attempt window.
      if (res.status < 500) return last;
    } catch (e: any) {
      last = { ok: false, receipt: `error:${e?.message ?? String(e)}`, code: null, status: null };
    }
    if (attempt < maxRetries) await sleep(500 * (attempt + 1));
  }
  return last;
}
