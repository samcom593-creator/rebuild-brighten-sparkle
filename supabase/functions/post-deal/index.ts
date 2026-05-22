// post-deal — PL-074
//
// One endpoint to log a deal in three places at once:
//   1. Apex DB (deals table) — source of truth for the agent's pipeline.
//   2. Discord (via existing discord-webhook-notify fn, event=deal_closed)
//      with milestone + streak detection already baked in.
//   3. AgentLink mirror — best-effort POST to the AgentLink API when a
//      token is present. Logged as a warning on failure (never blocks).
//
// Auth: caller must be authenticated. The agent_id is resolved from the
// caller's JWT (their agents.user_id row). Admins can override by passing
// `agent_id` in the body.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AGENTLINK_TOKEN = Deno.env.get("AGENTLINK_API_TOKEN") ?? "";
const AGENTLINK_BASE = Deno.env.get("AGENTLINK_API_BASE") ?? "https://agentlink.insuracloud.ai/api/v1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);

  // Authn — pull caller from JWT
  const authz = req.headers.get("authorization") ?? "";
  if (!authz.startsWith("Bearer ")) return json({ ok: false, error: "unauthorized" }, 401);
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: userRes, error: userErr } = await sb.auth.getUser(authz.replace("Bearer ", ""));
  if (userErr || !userRes?.user) return json({ ok: false, error: "invalid token" }, 401);
  const userId = userRes.user.id;

  // Body
  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "bad json" }, 400); }
  const {
    agent_id: bodyAgentId,
    annual_premium,
    product_sold,
    client_first_name,
    client_last_name,
    posted_at,
    status = "submitted",
    source = "apex_post_deal",
    notes,
  } = body ?? {};
  if (!annual_premium || Number(annual_premium) <= 0)
    return json({ ok: false, error: "annual_premium required and > 0" }, 400);

  // Resolve agent_id: explicit override (admin) or current user's agent row
  let agentId: string | null = bodyAgentId ?? null;
  if (!agentId) {
    const { data: agentRow } = await sb.from("agents").select("id").eq("user_id", userId).maybeSingle();
    agentId = agentRow?.id ?? null;
  } else {
    // If overriding, require admin
    const { data: roles } = await sb.from("user_roles").select("role").eq("user_id", userId);
    const isAdmin = (roles ?? []).some((r: any) => r.role === "admin");
    if (!isAdmin) return json({ ok: false, error: "agent_id override requires admin" }, 403);
  }
  if (!agentId) return json({ ok: false, error: "no agent row for caller" }, 400);

  // 1) Insert into deals
  const { data: deal, error: insErr } = await sb.from("deals").insert({
    agent_id: agentId,
    annual_premium: Number(annual_premium),
    product_sold: product_sold ?? null,
    client_first_name: client_first_name ?? null,
    client_last_name: client_last_name ?? null,
    status,
    source,
    notes: notes ?? null,
    posted_at: posted_at ?? new Date().toISOString(),
  }).select("id, agent_id, annual_premium, posted_at").single();
  if (insErr || !deal) return json({ ok: false, error: insErr?.message ?? "insert failed" }, 500);

  // 2) Discord broadcast — non-blocking, log on failure
  let discordOk = false;
  try {
    const { data: agentInfo } = await sb
      .from("agents")
      .select("display_name, photo_url, profile:profiles(full_name, instagram_handle, avatar_url)")
      .eq("id", agentId)
      .maybeSingle();
    const agentName =
      (agentInfo as any)?.profile?.full_name
      ?? (agentInfo as any)?.display_name
      ?? "an Apex agent";
    const instagram = (agentInfo as any)?.profile?.instagram_handle ?? null;
    // PL-AVATAR fix: Sam's complaint — "people post deals and don't get their picture inside their chat".
    // Discord embed needs the agent thumbnail URL. Prefer agents.photo_url, fall back to profiles.avatar_url.
    const photo_url =
      (agentInfo as any)?.photo_url
      ?? (agentInfo as any)?.profile?.avatar_url
      ?? null;

    const r = await fetch(`${SUPABASE_URL}/functions/v1/discord-webhook-notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({
        event_type: "deal_closed",
        agent_name: agentName,
        details: {
          agent_id: agentId,
          agent_name: agentName,
          aop: Number(annual_premium),
          product_type: product_sold ?? "Life",
          instagram,
          photo_url,
        },
      }),
    });
    discordOk = r.ok;
    if (!r.ok) console.error("discord fire non-ok", r.status, await r.text());
  } catch (e) {
    console.error("discord fire error", e);
  }

  // 3) AgentLink mirror — best-effort, skip if no token
  let agentlinkOk = false;
  let agentlinkSkipped = false;
  if (!AGENTLINK_TOKEN) {
    agentlinkSkipped = true;
  } else {
    try {
      const r = await fetch(`${AGENTLINK_BASE}/deals`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": AGENTLINK_TOKEN,
        },
        body: JSON.stringify({
          source_id: deal.id,
          annual_premium: Number(annual_premium),
          product: product_sold ?? null,
          client_first_name: client_first_name ?? null,
          client_last_name: client_last_name ?? null,
          posted_at: deal.posted_at,
          notes: notes ?? null,
        }),
      });
      agentlinkOk = r.ok;
      if (!r.ok) console.warn("agentlink mirror non-ok", r.status, (await r.text()).slice(0, 200));
    } catch (e) {
      console.warn("agentlink mirror error", e);
    }
  }

  return json({
    ok: true,
    deal,
    discord: discordOk,
    agentlink: agentlinkSkipped ? "skipped_no_token" : agentlinkOk ? "ok" : "failed",
  });
});
