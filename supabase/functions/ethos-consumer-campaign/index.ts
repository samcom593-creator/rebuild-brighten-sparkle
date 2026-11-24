import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireSendAuth } from "../_shared/require-send-auth.ts";
import { sendEmail } from "../_shared/email.ts";
import { consumerCoverageMessage, dispatchConsumerClaims, ETHOS_CONSUMER_CAMPAIGN_KEY, type ConsumerClaim } from "../_shared/ethos-consumer-campaign.ts";

const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization,x-client-info,apikey,content-type", "Content-Type": "application/json" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
  const auth = await requireSendAuth(req);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  try {
    const body = await req.json();
    const action = String(body.action ?? "preview");
    if (!["preview", "queue", "dispatch", "receipts", "settings", "save_scope", "deactivate_scope", "set_enabled"].includes(action)) return json({ ok: false, error: "Unknown action" }, 400);
    const campaignKey = String(body.campaign_key ?? ETHOS_CONSUMER_CAMPAIGN_KEY);
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: campaign, error: campaignError } = await db.from("ethos_consumer_campaigns").select("campaign_key,owner_user_id,sends_enabled,approved_at,template_version").eq("campaign_key", campaignKey).maybeSingle();
    if (campaignError) return json({ ok: false, error: "Campaign configuration could not be read. Nothing sent." }, 503);
    if (!campaign) return json({ ok: false, error: "Owner campaign is not configured. Nothing sent." }, 409);
    if (auth.caller !== "service" && auth.caller !== `user:${campaign.owner_user_id}`) return json({ ok: false, error: "Only the verified campaign owner can access this audience." }, 403);

    const actor = auth.caller?.startsWith("user:") ? auth.caller.slice(5) : campaign.owner_user_id;
    if (action === "settings") {
      const { data, error } = await db.from("ethos_consumer_license_scope").select("state,license_status,license_evidence_ref,license_verified_at,license_expires_at,ethos_eligible,ethos_evidence_ref,ethos_verified_at").eq("owner_user_id", campaign.owner_user_id).order("state");
      if (error) throw error;
      return json({ ok: true, campaign, scope: data ?? [] });
    }
    if (action === "save_scope" || action === "deactivate_scope") {
      if (action === "save_scope" && body.evidence_reviewed !== true) return json({ ok: false, error: "Record evidence only after checking the named sources." }, 409);
      const { data, error } = await db.rpc("set_ethos_consumer_scope", { p_campaign_key: campaignKey, p_actor: actor, p_state: String(body.state ?? ""),
        p_active: action === "save_scope", p_license_evidence_ref: body.license_evidence_ref ?? null, p_license_expires_at: body.license_expires_at ?? null, p_ethos_evidence_ref: body.ethos_evidence_ref ?? null });
      if (error) return json({ ok: false, error: error.message }, 409);
      return json({ ok: true, scope: data, sent: 0 });
    }
    if (action === "set_enabled") {
      if (typeof body.enabled !== "boolean") return json({ ok: false, error: "Specify whether sending is enabled." }, 400);
      const { data, error } = await db.rpc("set_ethos_consumer_campaign_enabled", { p_campaign_key: campaignKey, p_actor: actor, p_enabled: body.enabled });
      if (error) return json({ ok: false, error: error.message }, 409);
      return json({ ok: true, campaign: data, sent: 0 });
    }

    if (action === "receipts") {
      const { data, error } = await db.from("ethos_consumer_deliveries").select("id,lead_id,state,status,provider_id,reason,queued_at,attempted_at,settled_at").eq("campaign_key", campaignKey).order("queued_at", { ascending: false }).limit(100);
      if (error) throw error;
      return json({ ok: true, receipts: data ?? [] });
    }
    if (action === "dispatch") {
      if (body.confirm_campaign !== campaignKey) return json({ ok: false, error: "Confirm the exact campaign after reviewing its audience and message." }, 409);
      if (!Array.isArray(body.delivery_ids) || body.delivery_ids.length < 1 || body.delivery_ids.length > 25) return json({ ok: false, error: "Use the exact delivery IDs returned by the reviewed queue operation." }, 409);
      const { data, error } = await db.rpc("claim_ethos_consumer_deliveries", { p_campaign_key: campaignKey, p_delivery_ids: body.delivery_ids, p_limit: Math.max(1, Math.min(25, Number(body.limit) || 25)) });
      if (error) return json({ ok: false, error: error.message, sent: 0 }, 409);
      const receipts = await dispatchConsumerClaims((data ?? []) as ConsumerClaim[], {
        send: sendEmail,
        pause: async () => { await new Promise((resolve) => setTimeout(resolve, 600)); },
        settle: async (r) => {
          const { error: settleError } = await db.rpc("settle_ethos_consumer_delivery", { p_id: r.deliveryId, p_claim_id: r.claimId, p_status: r.status, p_provider_id: r.providerId, p_reason: r.reason });
          if (settleError) throw settleError;
        },
      });
      return json({ ok: receipts.every((r) => r.receiptSaved), receipts, provider_accepted: receipts.filter((r) => r.status === "provider_accepted").length, delivered: null });
    }
    const batchId = String(body.source_batch_id ?? "").trim();
    if (!batchId || batchId.length > 160) return json({ ok: false, error: "An exact imported consumer batch is required." }, 400);
    if (action === "queue") {
      if (!Array.isArray(body.selections) || body.selections.length < 1 || body.selections.length > 25) return json({ ok: false, error: "Select 1–25 recipients from the current preview." }, 400);
      const { data, error } = await db.rpc("queue_ethos_consumer_deliveries", { p_campaign_key: campaignKey, p_source_batch_id: batchId, p_selections: body.selections, p_actor: actor });
      if (error) return json({ ok: false, error: error.message }, 409);
      return json({ ok: true, ...data, sent: 0 });
    }
    const { data, error } = await db.rpc("preview_ethos_consumer_campaign", { p_campaign_key: campaignKey, p_source_batch_id: batchId });
    if (error) return json({ ok: false, error: error.message, sent: 0 }, 503);
    return json({ ok: true, ...data, campaign, message: consumerCoverageMessage(null), sent: 0 });
  } catch {
    return json({ ok: false, error: "Campaign operation could not be completed. Check receipts before retrying a dispatch." }, 500);
  }
});
