// owner-daily-overview (MP-302, 2026-11-12)
//
// One message a day to the owner, in place of the per-person notices now switched off by
// system_settings.owner_email_mute. Facts come from public.owner_daily_overview(); this file
// decides when to send and records that it did.
//
// Callers:
//   pg_cron 'owner-daily-overview-tick', hourly at :05 (APEX bot token bearer). Sends only when the
//     Phoenix hour equals system_settings.owner_overview_time_az and nothing has been sent
//     for that Phoenix date, so a changed time takes effect the same day and a repeat tick
//     is a no-op.
//   The owner, from the System page: {"preview": true} returns the rendered message and
//     sends nothing; {"force": true} sends now. Any other signed-in user is refused.
//
// The send date is written BEFORE the send is attempted and rolled back on failure, so two
// overlapping ticks cannot both send.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { gateResend } from "../_shared/resend-gate.ts";
import { requireSendAuth } from "../_shared/require-send-auth.ts";
import { safeEqual } from "../_shared/send-floor.ts";
import { BRAND_FROM } from "../_shared/email.ts";
import { isSendHour, phoenixDay, renderOverview, type OverviewData } from "./render.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const OWNER_UID = "71826bba-5577-4810-a226-1f6f2ad5288a";
const BOT_TOKEN = Deno.env.get("APEX_BOT_TOKEN") ?? "";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Three callers, nothing else. The cron presents the APEX bot token (it is not a JWT, which is
  // why verify_jwt is off); an internal caller presents the service key; a person must be the
  // owner. Found by calling the deployed function: without the bot-token branch every hourly
  // tick was a 401 and the overview would never have sent.
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const isBot = BOT_TOKEN !== "" && bearer !== "" && safeEqual(bearer, BOT_TOKEN);
  if (!isBot) {
    const sendAuth = await requireSendAuth(req);
    if (!sendAuth.ok) return json({ error: sendAuth.error }, sendAuth.status);
    if (sendAuth.caller !== "service" && sendAuth.caller !== `user:${OWNER_UID}`) return json({ error: "owner only" }, 403);
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  let body: { preview?: boolean; force?: boolean; day?: string } = {};
  try { body = await req.json(); } catch { body = {}; }

  const { data: rows, error: settingsError } = await supabase
    .from("system_settings")
    .select("key, value")
    .in("key", ["owner_overview_enabled", "owner_overview_time_az", "owner_overview_to", "owner_overview_last_sent"]);
  if (settingsError) return json({ error: `settings: ${settingsError.message}` }, 500);
  const setting = (key: string) => rows?.find((r) => r.key === key)?.value ?? "";

  const now = new Date();
  const today = phoenixDay(now);
  const scheduled = !body.preview && !body.force;
  if (scheduled) {
    if (setting("owner_overview_enabled") !== "true") return json({ sent: false, reason: "disabled" });
    if (!isSendHour(setting("owner_overview_time_az") || "07:00", now)) return json({ sent: false, reason: "not the send hour" });
    if (setting("owner_overview_last_sent") === today) return json({ sent: false, reason: "already sent today" });
  }

  const { data, error } = await supabase.rpc("owner_daily_overview", { p_day: body.day ?? null });
  if (error || !data) return json({ error: `overview: ${error?.message ?? "no data"}` }, 500);
  const rendered = renderOverview(data as OverviewData);

  if (body.preview) return json({ preview: true, subject: rendered.subject, html: rendered.html, sections: rendered.sections.map((s) => s.title) });

  const to = setting("owner_overview_to") || "info@kingofsales.net";
  const previous = setting("owner_overview_last_sent");
  if (scheduled) {
    // Claim today before sending. The filter on the previous value makes the claim atomic:
    // a second tick finds the row already changed and updates nothing.
    const { data: claimed, error: claimError } = await supabase
      .from("system_settings")
      .update({ value: today, updated_at: now.toISOString() })
      .eq("key", "owner_overview_last_sent")
      .eq("value", previous)
      .select("key");
    if (claimError) return json({ error: `claim: ${claimError.message}` }, 500);
    if (!claimed || claimed.length === 0) return json({ sent: false, reason: "another run already claimed today" });
  }

  const resend = gateResend(new Resend(Deno.env.get("RESEND_API_KEY") ?? ""));
  const result = await resend.emails.send({ from: BRAND_FROM, to: [to], subject: rendered.subject, html: rendered.html, text: rendered.text });
  const id = (result as { data?: { id?: string } | null })?.data?.id ?? null;
  const sendError = (result as { error?: { message?: string } | null })?.error ?? null;

  const { error: logError } = await supabase.from("email_delivery_log").insert({
    template: "owner-daily-overview",
    recipient_email: to,
    subject: rendered.subject,
    provider: "resend",
    provider_message_id: id,
    status: sendError || !id ? "error" : "sent",
    error: sendError?.message ?? (id ? null : "no message id returned"),
    sent_at: now.toISOString(),
  });
  if (logError) console.error("owner-daily-overview: delivery log insert failed:", logError.message);

  if (sendError || !id) {
    // Not sent: give the day back so the next tick inside this hour, or a manual send, can retry.
    if (scheduled) {
      const { error: releaseError } = await supabase.from("system_settings").update({ value: previous }).eq("key", "owner_overview_last_sent").eq("value", today);
      if (releaseError) console.error("owner-daily-overview: could not release the day:", releaseError.message);
    }
    return json({ sent: false, error: sendError?.message ?? "no message id returned" }, 502);
  }
  return json({ sent: true, id, to, subject: rendered.subject, sections: rendered.sections.map((s) => s.title) });
});
