// resend-suppression-sync: copy Resend's suppression verdicts into
// public.email_suppressions so _shared/email.ts#sendEmail can skip them.
//
// PL-WIB-RESEND-SUPPRESSION (2026-10-21). Why it exists: see
// _shared/suppression.ts. Runs hourly from pg_cron (apex-resend-suppression-sync)
// over the last 48h of sends; POST {"hours": 720} backfills a month.
//
// Per recipient, the LATEST send in the window decides: "suppressed" upserts a
// row (last_seen_at = that send), delivered/opened/clicked deletes it. Anything
// else leaves the row alone.
//
// Callers: pg_cron with the apex_bot_token bearer, or the service role key.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { presentsServiceKey, safeEqual } from "../_shared/send-floor.ts";
import { type ResendEmailRow, verdictFromRows } from "../_shared/suppression.ts";

const MAX_HOURS = 720;
const MAX_PAGES = 120;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function pullResend(key: string, cutoffIso: string): Promise<ResendEmailRow[]> {
  // Resend lists newest first; created_at is "YYYY-MM-DD HH:MM:SS.ffffff+00".
  const cutoff = cutoffIso.slice(0, 19).replace("T", " ");
  const out: ResendEmailRow[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url: string = "https://api.resend.com/emails?limit=100" + (after ? `&after=${after}` : "");
    let body: { data?: ResendEmailRow[]; has_more?: boolean } | null = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20000) });
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      if (!res.ok) throw new Error(`resend ${res.status}: ${(await res.text()).slice(0, 160)}`);
      body = await res.json();
      break;
    }
    if (!body || !Array.isArray(body.data)) throw new Error("resend unreadable after 4 attempts");
    const rows: ResendEmailRow[] = body.data;
    for (const r of rows) if (String(r.created_at ?? "").slice(0, 19) >= cutoff) out.push(r);
    const last: ResendEmailRow | undefined = rows[rows.length - 1];
    if (!rows.length || !body.has_more || String(last?.created_at ?? "").slice(0, 19) < cutoff) return out;
    after = String(last?.id ?? "");
    await new Promise((r) => setTimeout(r, 550)); // Resend allows 2 req/s
  }
  throw new Error("pagination did not terminate");
}

Deno.serve(async (req) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const botToken = (Deno.env.get("APEX_BOT_TOKEN") ?? "").trim();
  const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
  if (!supabaseUrl || !serviceKey || !resendKey) return json({ ok: false, error: "server_not_configured" }, 503);

  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const isBot = botToken !== "" && bearer !== "" && safeEqual(bearer, botToken);
  if (!isBot && !presentsServiceKey(req.headers, serviceKey)) return json({ ok: false, error: "unauthorized" }, 401);

  let hours = 48;
  try {
    const b = await req.json();
    if (Number.isFinite(b?.hours)) hours = Math.min(MAX_HOURS, Math.max(1, Math.floor(b.hours)));
  } catch {
    hours = 48; // no body (pg_cron sends {}), keep the default window
  }

  const cutoff = new Date(Date.now() - hours * 3600_000).toISOString();
  let rows: ResendEmailRow[];
  try {
    rows = await pullResend(resendKey, cutoff);
  } catch (e) {
    return json({ ok: false, error: `resend_unreadable: ${String((e as Error)?.message ?? e).slice(0, 200)}` }, 502);
  }

  const { suppressed, cleared } = verdictFromRows(rows);
  const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const upserts = [...suppressed].map(([email, v]) => ({
    email,
    last_event: v.last_event,
    resend_email_id: v.resend_email_id,
    last_seen_at: v.seen_at, // Resend's "YYYY-MM-DD HH:MM:SS.ffffff+00" is a valid timestamptz literal
    synced_at: new Date().toISOString(),
  }));
  if (upserts.length) {
    const { error } = await sb.from("email_suppressions").upsert(upserts, { onConflict: "email" });
    if (error) return json({ ok: false, error: `upsert_failed: ${error.message}`, scanned: rows.length }, 500);
  }
  let deleted = 0;
  if (cleared.size) {
    const { data, error } = await sb.from("email_suppressions").delete().in("email", [...cleared]).select("email");
    if (error) return json({ ok: false, error: `clear_failed: ${error.message}`, scanned: rows.length }, 500);
    deleted = data?.length ?? 0;
  }

  return json({ ok: true, hours, scanned: rows.length, suppressed: upserts.length, cleared: deleted });
});
