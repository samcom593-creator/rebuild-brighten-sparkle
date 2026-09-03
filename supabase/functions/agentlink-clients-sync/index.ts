// agentlink-clients-sync — refresh the agentlink_clients mirror from AgentLink's
// /api/pipeline/clients. The mirror went dark 2026-06-16 (nothing wrote it) while
// the deals sync stayed fresh, so the Client Pipeline page rendered 65-day-old
// data. This fn is the clients leg, deliberately SEPARATE from
// agentlink-cookie-sync so it can never contend with or break the money pipe.
//
// Scope truth: /api/pipeline/clients returns ONLY the session-cookie owner's
// clients (verified live: 874 rows, all ownerUserId=211 = Samuel James), unlike
// /api/deals which returns the whole downline book. So this refreshes Sam's
// slice; other producers' mirror rows are left untouched (their sessions would
// be needed to judge them — same attribution rule as the outbox).
//
// Never deletes. Upserts on insuracloud_pipeline_client_id (unique). updated_at
// is stamped at sync time — it is the freshness signal the UI badge reads.
// Logs to agentlink_clients_sync_log, NOT agentlink_sync_log: the doctor gates
// grade the deals log's semantics and must not see foreign rows (MP-279/283).
//
// supabase-js pinned 2.90.1 — 2.45/2.50 died at boot via esm.sh transitive deps.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const BASE = "https://agentlink.insuracloud.ai";
const PERSISTENT_BOT_TOKEN = Deno.env.get("BOT_SQL_PERSISTENT_TOKEN")?.trim() ?? "";

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function resolveBotTokens(sb: ReturnType<typeof createClient>): Promise<string[]> {
  const tokens: string[] = [];
  if (PERSISTENT_BOT_TOKEN.length > 16) tokens.push(PERSISTENT_BOT_TOKEN);
  const env = Deno.env.get("APEX_BOT_TOKEN");
  if (env && env.length > 16) tokens.push(env);
  const { data } = await sb.from("system_settings").select("value").eq("key", "apex_bot_token").maybeSingle();
  const setting = (data as { value?: string } | null)?.value;
  if (setting && setting.length > 16) tokens.push(setting);
  return tokens;
}

async function authorize(req: Request, sb: ReturnType<typeof createClient>) {
  const authHeader = req.headers.get("Authorization") ?? "";
  const presented = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!presented) return { ok: false as const, status: 401, error: "Unauthorized" };
  const validTokens = await resolveBotTokens(sb);
  if (validTokens.includes(presented)) return { ok: true as const };
  const { data: userData } = await sb.auth.getUser(presented);
  const userId = userData?.user?.id;
  if (!userId) return { ok: false as const, status: 401, error: "Unauthorized" };
  const { data: isAdmin } = await sb.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (!isAdmin) return { ok: false as const, status: 403, error: "Admin required" };
  return { ok: true as const };
}

const day = (v: unknown) => (typeof v === "string" && v.length >= 10 ? v.slice(0, 10) : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  const auth = await authorize(req, sb);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const { data: logRow } = await sb
    .from("agentlink_clients_sync_log")
    .insert({ status: "running" })
    .select("id")
    .maybeSingle();
  const logId = (logRow as { id?: string } | null)?.id;
  const finish = async (patch: Record<string, unknown>) => {
    if (logId) await sb.from("agentlink_clients_sync_log").update({ finished_at: new Date().toISOString(), ...patch }).eq("id", logId);
  };

  try {
    const { data: ck } = await sb.from("system_settings").select("value").eq("key", "agent_link_session_cookie").maybeSingle();
    // MP-400: same storage-format hazard as agentlink-cookie-sync — a writer
    // stored to_jsonb(cookie::text) into a TEXT column, so the value arrived
    // wrapped in literal double quotes and this function sent them verbatim as
    // the Cookie header. A Cookie header never legitimately starts with a quote.
    let cookie = String((ck as { value?: string } | null)?.value ?? "").trim();
    if (cookie.length > 1 && cookie.startsWith('"') && cookie.endsWith('"')) {
      // empty-catch-allow:not-json-means-not-quoted-so-the-raw-value-is-already-correct
      try { const p = JSON.parse(cookie); if (typeof p === "string") cookie = p.trim(); } catch { /* keep raw */ }
    }
    if (cookie.length < 20) {
      await finish({ status: "error", error: "no session cookie in system_settings" });
      return json({ ok: false, error: "no session cookie" }, 500);
    }

    const res = await fetch(`${BASE}/api/pipeline/clients`, {
      headers: {
        Cookie: cookie,
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; APEX-sync/1.0)",
        "X-Requested-With": "XMLHttpRequest",
      },
    });
    const text = await res.text();

    // Fake-success guards, in the order they have burned us before: a login
    // page is HTML with status 200; an auth bounce is 401/403; a gateway blip
    // is non-JSON. None of those may write a single row (the 465-row lesson).
    if (res.status === 401 || res.status === 403) {
      await finish({ status: "auth_failed", upstream_status: res.status });
      return json({ ok: false, error: `upstream auth ${res.status}` }, 502);
    }
    let clients: unknown;
    try { clients = JSON.parse(text); } catch { clients = null; }
    if (!res.ok || !Array.isArray(clients) || text.trimStart().startsWith("<")) {
      await finish({ status: "error", upstream_status: res.status, error: `non-JSON or non-array upstream (${res.status})` });
      return json({ ok: false, error: `bad upstream response ${res.status}` }, 502);
    }
    if (clients.length === 0 || typeof (clients[0] as Record<string, unknown>)?.id !== "number") {
      await finish({ status: "error", upstream_status: res.status, clients_seen: clients.length, error: "empty or shape-mismatched payload — refusing to write" });
      return json({ ok: false, error: "payload shape mismatch" }, 502);
    }

    const { data: agents } = await sb.from("agents").select("id, insuracloud_user_id").not("insuracloud_user_id", "is", null);
    const agentByAlId = new Map<number, string>();
    for (const a of (agents ?? []) as Array<{ id: string; insuracloud_user_id: number }>) {
      agentByAlId.set(Number(a.insuracloud_user_id), a.id);
    }

    const nowIso = new Date().toISOString();
    const rows = (clients as Array<Record<string, unknown>>).map((c) => {
      const row: Record<string, unknown> = {
        insuracloud_pipeline_client_id: c.id,
        first_name: s(c.firstName),
        last_name: s(c.lastName),
        phone: s(c.phone),
        email: s(c.email),
        state: s(c.state),
        city: s(c.city),
        date_of_birth: day(c.dateOfBirth),
        pipeline_stage: s(c.stage),
        stage_changed_at: s(c.stageChangedAt),
        last_contact_date: s(c.lastContactDate),
        next_action_date: s(c.nextActionDate),
        callback_date: day(c.callbackDate),
        callback_time: s(c.callbackTime),
        do_not_call: c.doNotCall === true,
        hostile_language_detected: c.hostileLanguageDetected === true,
        client_health_score: num(c.clientHealthScore),
        pitch_carrier: s(c.pitchCarrier),
        pitch_price: num(c.pitchPrice),
        product_sold: s(c.productSold),
        face_amount: num(c.faceAmount),
        policy_number: s(c.policyNumber),
        policy_start_date: day(c.policyStartDate),
        mortgage_payment: num(c.mortgagePayment),
        rent_payment: num(c.rentPayment),
        updated_at: nowIso,
      };
      const owner = typeof c.ownerUserId === "number" ? agentByAlId.get(c.ownerUserId) : undefined;
      if (owner) row.agent_id = owner;
      return row;
    });

    let upserted = 0;
    const errors: string[] = [];
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error } = await sb.from("agentlink_clients").upsert(chunk, { onConflict: "insuracloud_pipeline_client_id" });
      if (error) errors.push(`chunk ${i}: ${error.message}`);
      else upserted += chunk.length;
    }

    const status = errors.length === 0 ? "ok" : upserted > 0 ? "partial" : "error";
    await finish({ status, upstream_status: res.status, clients_seen: rows.length, clients_upserted: upserted, error: errors.length ? errors.join("; ").slice(0, 900) : null });
    return json({ ok: errors.length === 0, seen: rows.length, upserted, errors });
  } catch (e) {
    await finish({ status: "error", error: String(e).slice(0, 900) });
    return json({ ok: false, error: String(e).slice(0, 300) }, 500);
  }
});
