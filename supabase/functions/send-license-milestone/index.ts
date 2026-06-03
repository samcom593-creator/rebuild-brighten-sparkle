// send-license-milestone — drains license_milestone_outbox and
// delivers each pending row via Twilio SMS. Gated on Twilio env
// vars being present; if creds are missing the fn returns 503 so
// the caller (cron) can back off rather than burning rows.
//
// Triggers:
//   - pg_cron every 1 min: POST {} to drain queue
//   - manual replay: POST {id: "..."} to re-attempt a single row
//   - dry-run: POST {dry_run: true} to render-and-log without sending
//
// PL-088 · 2026-05-29

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TWILIO_SID   = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
const TWILIO_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
const TWILIO_FROM  = Deno.env.get("TWILIO_MESSAGING_SID") ?? Deno.env.get("TWILIO_FROM") ?? "";
const MAX_PER_RUN  = 50;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

type Row = {
  id: string;
  application_id: string;
  to_phone: string;
  template_key: string;
  rendered_body: string;
  send_attempts: number;
};

function normalizePhone(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^0-9]/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  if (digits.length === 10) return "+1" + digits;
  return null;
}

async function sendOne(row: Row): Promise<{ ok: true } | { ok: false; error: string }> {
  const to = normalizePhone(row.to_phone);
  if (!to) return { ok: false, error: "phone_unformattable" };
  const params = new URLSearchParams({ To: to, Body: row.rendered_body });
  if (TWILIO_FROM.startsWith("MG")) params.append("MessagingServiceSid", TWILIO_FROM);
  else params.append("From", TWILIO_FROM);
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`;
  const auth = btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`);
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: `twilio_${res.status}: ${text.slice(0, 240)}` };
  }
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM) {
    return new Response(
      JSON.stringify({ error: "twilio_creds_missing", pending: null }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  let body: { id?: string; dry_run?: boolean } = {};
  try { body = await req.json(); } catch {}

  let query = supabase
    .from("license_milestone_outbox")
    .select("id, application_id, to_phone, template_key, rendered_body, send_attempts")
    .eq("status", "pending")
    .lt("send_attempts", 5)
    .order("created_at", { ascending: true })
    .limit(MAX_PER_RUN);
  if (body.id) query = query.eq("id", body.id);

  const { data, error } = await query;
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const rows = (data as Row[] | null) ?? [];
  const summary = { processed: rows.length, sent: 0, failed: 0, skipped: 0, dry_run: !!body.dry_run };

  for (const row of rows) {
    if (body.dry_run) {
      summary.skipped += 1;
      continue;
    }
    const r = await sendOne(row);
    if (r.ok) {
      await supabase.from("license_milestone_outbox")
        .update({ status: "sent", sent_at: new Date().toISOString(), send_attempts: row.send_attempts + 1 })
        .eq("id", row.id);
      summary.sent += 1;
    } else {
      const newAttempts = row.send_attempts + 1;
      await supabase.from("license_milestone_outbox")
        .update({
          status: newAttempts >= 5 ? "failed" : "pending",
          last_error: r.error,
          send_attempts: newAttempts,
        })
        .eq("id", row.id);
      summary.failed += 1;
    }
  }

  return new Response(JSON.stringify(summary), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
