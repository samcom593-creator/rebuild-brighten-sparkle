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
    // pg_cron reaches this fn through run_automation_job, which signs with the
    // service-role key; operators dry-run by hand with APEX_BOT_TOKEN. Either
    // bearer is accepted (6b41fe36 restructured this; auth was never the 16:10
    // fault — see the persistence note below).
    const okBot = Boolean(botToken) && token === botToken;
    const okService = Boolean(SERVICE_KEY) && token === SERVICE_KEY;
    if (!okBot && !okService) return json({ error: "unauthorized" }, 401);
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
  let persistFailures = 0;
  for (const r of (rows ?? []) as any[]) {
    const phone = String(r.to_phone ?? "").replace(/\D/g, "");
    const body = String(r.rendered_body ?? "").trim();
    if (phone.length < 10 || !body) {
      if (!dryRun) {
        const { error: pe } = await sb.from("license_milestone_outbox").update({ status: "skipped", last_error: phone.length < 10 ? "phone_too_short" : "empty_body" }).eq("id", r.id);
        if (pe) { persistFailures++; results.push({ id: r.id, outcome: "skipped", persisted: false, persist_error: pe.message.slice(0, 160) }); continue; }
      }
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
    // license_milestone_outbox_status_check admits ONLY pending|sent|failed|skipped.
    // The first cut wrote "skipped_no_carrier": the UPDATE violated the CHECK, the
    // error was discarded, and the 16:10 tick answered {processed:3} with zero rows
    // changed — fake success inside the fn whose one job is to refuse it. The
    // distinction lives in last_error; the status stays inside the contract.
    else if (outcome === "skipped") { patch.status = "skipped"; patch.last_error = "no carrier on file"; }
    else { patch.last_error = err || "gateway failed"; if ((r.send_attempts ?? 0) + 1 >= MAX_ATTEMPTS) patch.status = "failed"; }
    const { error: persistErr } = await sb.from("license_milestone_outbox").update(patch).eq("id", r.id);
    if (persistErr) { persistFailures++; results.push({ id: r.id, outcome, persisted: false, persist_error: persistErr.message.slice(0, 160) }); continue; }
    results.push({ id: r.id, outcome, persisted: true, error: err || undefined });
  }
  // A row the gateway answered but the table refused is NOT processed. Non-2xx
  // so pg_net/automation_run_log record the failure instead of a green tick.
  return json(
    { ok: persistFailures === 0, dry_run: dryRun, processed: results.length - persistFailures, persist_failures: persistFailures, results },
    persistFailures === 0 ? 200 : 500,
  );
});
