// license-milestone-sms-drain — MP-341 (2026-08-29)
//
// trg_license_milestone_emit queues a templated SMS into license_milestone_outbox
// on every licensing-stage change (it never fired once before 2026-08-27 because
// the trigger threw on an uncast enum; fixed in 20260828030000). The queue had NO
// consumer. This drains it through send-sms-auto-detect (the email-to-carrier
// gateway) and records the gateway's own `outcome` (MP-270 contract):
//   sent    -> status 'sent', sent_at
//   skipped -> status 'skipped_no_carrier' (nothing was sent; never dressed as sent)
//   failed  -> send_attempts+1, last_error; retried up to 3 times, then 'failed'
// Body: { "dry_run": true } lists what would send and writes nothing.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MAX_ATTEMPTS = 3;
const BATCH = 20;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

Deno.serve(async (req) => {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token || token !== SERVICE_KEY) {
    // bot-sql token is also accepted so an operator can dry-run by hand
    const botToken = Deno.env.get("APEX_BOT_TOKEN") ?? "";
    if (!botToken || token !== botToken) return json({ error: "unauthorized" }, 401);
  }
  let dryRun = false;
  try { dryRun = Boolean((await req.json())?.dry_run); } catch { /* empty-catch-allow:no-body-means-live-run */ }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: rows, error } = await sb
    .from("license_milestone_outbox")
    .select("id, application_id, to_phone, rendered_body, send_attempts, status")
    .eq("status", "pending")
    .lt("send_attempts", MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(BATCH);
  if (error) return json({ ok: false, error: error.message }, 500);

  const results: Array<Record<string, unknown>> = [];
  for (const r of (rows ?? []) as any[]) {
    const phone = String(r.to_phone ?? "").replace(/\D/g, "");
    const body = String(r.rendered_body ?? "").trim();
    if (phone.length < 10 || !body) {
      if (!dryRun) await sb.from("license_milestone_outbox").update({ status: "skipped", last_error: phone.length < 10 ? "phone_too_short" : "empty_body" }).eq("id", r.id);
      results.push({ id: r.id, outcome: "skipped", reason: phone.length < 10 ? "phone_too_short" : "empty_body" });
      continue;
    }
    if (dryRun) { results.push({ id: r.id, outcome: "would_send", phone_last4: phone.slice(-4), chars: body.length }); continue; }
    let outcome = "failed"; let err = "";
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/send-sms-auto-detect`, {
        method: "POST",
        headers: { authorization: `Bearer ${SERVICE_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ phone, message: body.slice(0, 160) }),
      });
      const j = await resp.json().catch(() => ({} as any));
      outcome = String(j?.outcome ?? (resp.ok && j?.success === true ? "sent" : "failed"));
      if (outcome !== "sent" && outcome !== "skipped") err = `HTTP ${resp.status} ${String(j?.error ?? "").slice(0, 160)}`;
    } catch (e) { err = String((e as Error)?.message ?? e).slice(0, 200); }

    const patch: Record<string, unknown> = { send_attempts: (r.send_attempts ?? 0) + 1 };
    if (outcome === "sent") { patch.status = "sent"; patch.sent_at = new Date().toISOString(); patch.last_error = null; }
    else if (outcome === "skipped") { patch.status = "skipped_no_carrier"; patch.last_error = "no carrier on file"; }
    else { patch.last_error = err || "gateway failed"; if ((r.send_attempts ?? 0) + 1 >= MAX_ATTEMPTS) patch.status = "failed"; }
    await sb.from("license_milestone_outbox").update(patch).eq("id", r.id);
    results.push({ id: r.id, outcome, error: err || undefined });
  }
  return json({ ok: true, dry_run: dryRun, processed: results.length, results });
});
