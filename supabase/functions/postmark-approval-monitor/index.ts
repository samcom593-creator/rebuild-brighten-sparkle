// MP-260 (2026-07-22): Postmark approval poller.
// Fires an external-domain probe send. When Postmark stops returning
// ErrorCode 412 (pending-approval), flips reissue_40d_paused → false so
// the 40-day reissue campaign starts draining automatically, records the
// approval timestamp, and pings Sam via ntfy. Idempotent — once approved,
// subsequent runs no-op.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const NTFY_URL = "https://ntfy.sh/sams-agent-yrkv9kbqp9e987nb";
const PROBE_FROM = "Samuel James <info@kingofsales.net>";
const PROBE_TO = "sam.com593@gmail.com";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(supabaseUrl, serviceKey);

  const { data: settings } = await supabase
    .from("system_settings")
    .select("key, value")
    .in("key", ["postmark_api_key", "postmark_approved_at", "reissue_40d_paused"]);

  const rows = (settings ?? []) as Array<{ key: string; value: unknown }>;
  const get = (k: string) => rows.find((r) => r.key === k)?.value as string | undefined;
  const postmarkKey = String(get("postmark_api_key") ?? "").trim();
  const approvedAt = get("postmark_approved_at");

  if (!postmarkKey) {
    return json({ ok: false, reason: "no postmark_api_key in system_settings" }, 500);
  }

  if (approvedAt) {
    return json({ ok: true, already_approved_at: approvedAt, action: "noop" });
  }

  const probe = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      "X-Postmark-Server-Token": postmarkKey,
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      From: PROBE_FROM,
      To: PROBE_TO,
      Subject: "APEX: Postmark external approval probe",
      HtmlBody: "<p>Postmark now accepts external sends. Reissue campaign unpaused.</p>",
      TextBody: "Postmark now accepts external sends. Reissue campaign unpaused.",
      MessageStream: "outbound",
    }),
  });

  const bodyText = await probe.text();
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(bodyText); } catch (_e) { /* ignore */ }

  if (probe.status === 200 && parsed.MessageID) {
    const nowIso = new Date().toISOString();
    await supabase.from("system_settings").upsert([
      { key: "postmark_approved_at", value: nowIso },
      { key: "reissue_40d_paused", value: "false" },
    ], { onConflict: "key" });

    const messageId = String(parsed.MessageID);
    try {
      await fetch(NTFY_URL, {
        method: "POST",
        headers: {
          "Title": "APEX: Postmark APPROVED — 40-day reissue firing",
          "Priority": "high",
          "Tags": "envelope,rocket",
        },
        body: `Postmark unlocked external sends at ${nowIso}. ` +
              `Reissue campaign kill-switch flipped false — outreach-sender will drain 203 pending rows on the next 5-min cron tick. ` +
              `Probe MessageID: ${messageId}`,
      });
    } catch (_e) { /* ntfy is best-effort */ }

    return json({ ok: true, action: "approved", approved_at: nowIso, probe_message_id: messageId });
  }

  const errorCode = parsed.ErrorCode ?? null;
  const message = parsed.Message ?? bodyText.slice(0, 200);

  return json({
    ok: true,
    action: "still_pending",
    http_status: probe.status,
    postmark_error_code: errorCode,
    postmark_message: message,
  });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
