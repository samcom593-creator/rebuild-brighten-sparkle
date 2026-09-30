// One graded way for an edge function to RAISE an alert, instead of each one
// hand-rolling a single-channel push to Sam's phone.
//
// WHY THIS EXISTS. Two watchdogs (cron-inbound-brain-health,
// instagram-token-keepalive) each owned a bare `await fetch(NTFY_TOPIC, ...)`
// inside a try/catch. `fetch()` rejects only on a TRANSPORT failure, so an HTTP
// 429 resolves, the catch never fires, nothing is logged, and the function
// returns 200. For cron-inbound-brain-health that push is, by its own comment,
// "the one alert this watchdog ever sends" — so the whole daemon evaporated on a
// refusal it could not see.
//
// AND THE REFUSAL IS NOT HYPOTHETICAL. Measured 2026-09-30T23:43Z:
//   edge   -> ntfy  : http:429 code=42908 "daily message quota reached"
//   pg_net -> ntfy  : state=refused status=429 code=42908  (0 messages in ntfy's log)
//   laptop -> ntfy  : 200, same topic, same minute
// ntfy binds 42908 to the VISITOR IP, and both Supabase legs share that egress,
// so ntfy refuses EVERY cloud-origin push while the laptop is fine. apex-doctor
// Check #21 has documented this recurring condition since 2026-09-14.
//
// WHY NOT THE pg_net RELAY. manychat-webhook's relay comment says "the database
// egresses from an IP ntfy accepts". That was measured and is FALSE today — the
// relay is refused with the same 42908. Wiring it in as a fallback would have
// shipped a second copy of the same failure wearing the word "redundancy".
//
// WHAT THIS DOES INSTEAD. apex-alert-dispatch already owns the delivery ladder:
// it always includes Discord and ntfy, adds email/SMS by severity, grades every
// leg, and stamps sent_at only when a channel actually landed. Its email leg is
// PROVEN to escape Supabase while ntfy refuses — a real provider message id at
// 2026-09-30T21:12:13Z, two hours before the ntfy refusals above. So a watchdog
// should raise an alert and let the one component built for delivery deliver it,
// rather than inventing its own channel. Fewer legs, not more.
//
// This module imports NO supabase-js on purpose. ntfy-post.ts is imported by five
// functions and pulling an SDK into a shared module changes every one of their
// bundles; MP-273's boot-death was exactly an esm.sh transitive resolving
// differently than the pin implied. Raw fetch has no such blast radius.
//
// Guarded by scripts/check-ntfy-receipt.mjs: a caller that goes back to a bare
// ntfy fetch fails the commit.

export interface RaiseResult {
  /** True ONLY when the dispatcher confirms at least one channel landed. */
  ok: boolean;
  /** "ok:<channels>" | "http:<status> <body>" | "error:<transport>". Never bare. */
  receipt: string;
  /** bot_alerts row id, so the durable record can be found from a log line. */
  alertId: string | null;
  /** Which legs the dispatcher reported landing. */
  landed: { email: boolean; sms: boolean; discord: boolean; ntfy: boolean };
}

export interface RaiseOptions {
  source: string;
  eventType: string;
  /** "critical" dispatches immediately; "warn"/"info" are queued by design. */
  severity: "critical" | "celebrate" | "warn" | "info";
  subject: string;
  body: string;
  /** Short line for the phone/SMS leg. Falls back to subject. */
  smsBody?: string;
  actionLink?: string;
  channels?: string[];
  timeoutMs?: number;
  /** Transport failures and 5xx only. Default 1 retry (2 attempts). */
  retries?: number;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
}

const NONE = { email: false, sms: false, discord: false, ntfy: false };

export async function raiseApexAlert(opts: RaiseOptions): Promise<RaiseResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleepImpl ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const maxRetries = opts.retries ?? 1;

  const base = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  // A missing credential must CLOSE loudly, never fall through to a silent
  // no-op that the caller reads as a delivered page.
  if (!base || !key) {
    return { ok: false, receipt: "error:no SUPABASE_URL/SERVICE_ROLE_KEY in env", alertId: null, landed: { ...NONE } };
  }

  const payload = JSON.stringify({
    source: opts.source,
    event_type: opts.eventType,
    severity: opts.severity,
    subject: opts.subject,
    body: opts.body,
    sms_body: opts.smsBody ?? opts.subject,
    action_link: opts.actionLink ?? null,
    ...(opts.channels ? { channels: opts.channels } : {}),
  });

  let last: RaiseResult = { ok: false, receipt: "error:never attempted", alertId: null, landed: { ...NONE } };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await doFetch(`${base}/functions/v1/apex-alert-dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: payload,
        signal: AbortSignal.timeout(timeoutMs),
      });

      // Read the body before deciding anything: a 200 from the dispatcher does
      // NOT mean a channel landed (a queued warn/info returns dispatched:false),
      // and a refusal names its cause only in the body.
      const raw = await res.text().catch(() => "");
      if (!res.ok) {
        last = { ok: false, receipt: `http:${res.status} ${raw.slice(0, 200)}`, alertId: null, landed: { ...NONE } };
        if (res.status < 500) return last;   // a 4xx will not change on retry
      } else {
        let j: Record<string, unknown> = {};
        try { j = JSON.parse(raw); } catch { /* keep raw in the receipt below */ }
        const landed = {
          email: Boolean((j as any)?.email_id),
          sms: Boolean((j as any)?.sent_sms),
          discord: Boolean((j as any)?.sent_discord),
          ntfy: Boolean((j as any)?.sent_ntfy),
        };
        const names = Object.entries(landed).filter(([, v]) => v).map(([k]) => k);
        const alertId = (j as any)?.alert_id ? String((j as any).alert_id) : null;
        if (names.length > 0) {
          return { ok: true, receipt: `ok:${names.join("+")}`, alertId, landed };
        }
        // Recorded but undelivered, or deliberately held. Either way it is NOT a
        // page, and saying so is the whole point of this module.
        const held = (j as any)?.held === true || (j as any)?.dispatched === false;
        last = {
          ok: false,
          receipt: held
            ? `http:200 recorded but HELD (severity=${opts.severity} is queued, not dispatched) alert_id=${alertId}`
            : `http:200 recorded but NO channel landed: ${raw.slice(0, 200)}`,
          alertId,
          landed,
        };
        return last;   // the dispatcher answered; retrying cannot change its verdict
      }
    } catch (e: any) {
      last = { ok: false, receipt: `error:${e?.message ?? String(e)}`, alertId: null, landed: { ...NONE } };
    }
    if (attempt < maxRetries) await sleep(500 * (attempt + 1));
  }
  return last;
}
