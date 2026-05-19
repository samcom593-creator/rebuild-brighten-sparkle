// ═══════════════════════════════════════════════════════════════════════════
// readymode-ingest — Supabase edge function (Deno)
//
// Webhook receiver for ReadyMode (and ReadyMode-compatible) call dispositions.
// Verifies a shared secret, normalizes the payload, calls fn_readymode_ingest()
// which upserts into readymode_dialer_calls + runs the matcher.
//
// ReadyMode config (one-time, inside ReadyMode admin → Integrations → Webhooks):
//   URL:    https://xrzweoneiieddzxogewk.supabase.co/functions/v1/readymode-ingest?secret=<readymode_webhook_secret>
//   Method: POST
//   Trigger: on call disposition (every call result)
//   Body:   ReadyMode default JSON OR custom field map (see README)
//
// Curl smoke test:
//   curl -X POST "https://xrzweoneiieddzxogewk.supabase.co/functions/v1/readymode-ingest?secret=$SECRET" \
//     -H 'Content-Type: application/json' \
//     -d '{"call_id":"test-1","disposition":"Connected","phone":"5125551212","agent_email":"agent@apex.com","duration":42,"call_start":"2026-05-19T15:00:00Z","recording_url":"https://example.com/r/1.mp3"}'
// ═══════════════════════════════════════════════════════════════════════════

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supa = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type ReadyModePayload = Record<string, any>;

function normalize(body: ReadyModePayload): ReadyModePayload {
  // ReadyMode + most dialers vary their field names. Map common aliases.
  const pick = (...keys: string[]) =>
    keys.map((k) => body[k]).find((v) => v !== undefined && v !== null);

  return {
    external_call_id: String(
      pick("external_call_id", "call_id", "callId", "CallID", "id", "uniqueid") ??
        crypto.randomUUID(),
    ),
    agent_raw: pick(
      "agent_raw",
      "agent_email",
      "agentEmail",
      "agent",
      "username",
      "rep_email",
      "user",
    ) ?? null,
    campaign_name: pick("campaign_name", "campaign", "campaignName", "list_name") ?? null,
    lead_phone: pick("lead_phone", "phone", "phone_number", "Phone1", "PhoneNumber", "to") ?? null,
    lead_first_name: pick("lead_first_name", "first_name", "FirstName", "fname") ?? null,
    lead_last_name: pick("lead_last_name", "last_name", "LastName", "lname") ?? null,
    lead_email: pick("lead_email", "email", "Email") ?? null,
    disposition: pick(
      "disposition",
      "call_result",
      "result",
      "Disposition",
      "outcome",
    ) ?? null,
    disposition_at: pick("disposition_at", "result_at", "dispositionTime") ?? null,
    call_started_at: pick("call_started_at", "call_start", "start_time", "CallStart", "starttime") ?? null,
    call_ended_at: pick("call_ended_at", "call_end", "end_time", "CallEnd", "endtime") ?? null,
    duration_seconds: pick("duration_seconds", "duration", "Duration", "talk_time") ?? null,
    recording_url: pick(
      "recording_url",
      "recording",
      "RecordingURL",
      "recording_path",
      "audio_url",
    ) ?? null,
    notes: pick("notes", "comment", "comments", "Note") ?? null,
  };
}

async function getWebhookSecret(): Promise<string | null> {
  const { data, error } = await supa
    .from("system_settings")
    .select("value")
    .eq("key", "readymode_webhook_secret")
    .maybeSingle();
  if (error || !data) return null;
  return data.value ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "GET") {
    // Health check / discovery
    return new Response(
      JSON.stringify({ ok: true, service: "readymode-ingest", method: "POST", version: "1.0.0" }),
      { headers: { "content-type": "application/json" } },
    );
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // Secret check: accept ?secret= query OR X-ReadyMode-Secret header
  const url = new URL(req.url);
  const providedSecret =
    url.searchParams.get("secret") ?? req.headers.get("x-readymode-secret");
  const expectedSecret = await getWebhookSecret();
  if (!expectedSecret) {
    return new Response(JSON.stringify({ ok: false, error: "webhook_secret_unset" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }
  if (!providedSecret || providedSecret !== expectedSecret) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  // Parse + normalize body
  let raw: ReadyModePayload;
  try {
    const text = await req.text();
    if (req.headers.get("content-type")?.includes("form")) {
      raw = Object.fromEntries(new URLSearchParams(text));
    } else {
      raw = text ? JSON.parse(text) : {};
    }
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: `bad_body: ${(e as Error).message}` }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }

  const payload = normalize(raw);
  (payload as any)._raw = raw; // preserve original

  // Call the RPC
  const { data, error } = await supa.rpc("fn_readymode_ingest", { p_payload: payload });
  if (error) {
    return new Response(
      JSON.stringify({ ok: false, error: error.message, payload }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }

  return new Response(JSON.stringify(data ?? { ok: true }), {
    headers: { "content-type": "application/json" },
  });
});
