/**
 * admin-sql — dashboard SQL terminal endpoint.
 *
 * Auth model:
 *   - Verifies the caller's Supabase JWT (Authorization: Bearer <jwt>).
 *   - Looks up `profiles.role` for that user. Allowed roles: admin, owner.
 *   - Sam's user_id (4491dc82-a056-4fb3-ab38-b132afffb700) is hard-allowed
 *     so the Control Terminal works even if his profile.role is unset.
 *   - Anyone else → 403.
 *
 * Execution: same shape as bot-sql/apex-exec — service_role client, then
 * direct postgres fallback. Returns { ok, rows, rowCount, error, duration_ms }.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SAM_USER_ID = "4491dc82-a056-4fb3-ab38-b132afffb700";

async function execViaPostgres(query: string): Promise<{ rows: unknown[]; rowCount: number | null }> {
  const { Client } = await import("https://deno.land/x/postgres@v0.19.3/mod.ts");
  const dbUrl = Deno.env.get("SUPABASE_DB_URL");
  if (!dbUrl) throw new Error("SUPABASE_DB_URL not available in this runtime");
  const client = new Client(dbUrl);
  await client.connect();
  try {
    const result = await client.queryObject(query);
    return { rows: result.rows, rowCount: result.rowCount ?? null };
  } finally {
    await client.end();
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  // 1. Verify the caller's JWT
  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) {
    return new Response(JSON.stringify({ ok: false, error: "missing auth" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: userRes, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userRes?.user) {
    return new Response(JSON.stringify({ ok: false, error: "invalid jwt" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const userId = userRes.user.id;

  // 2. Authorize — Sam always allowed; otherwise check role
  let allowed = userId === SAM_USER_ID;
  if (!allowed) {
    const admin = createClient(supabaseUrl, serviceKey);
    const { data: prof } = await admin.from("profiles").select("role").eq("user_id", userId).maybeSingle();
    const role = (prof as any)?.role ?? "";
    allowed = role === "admin" || role === "owner";
  }
  if (!allowed) {
    return new Response(JSON.stringify({ ok: false, error: "admin only" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 3. Run the query
  const t0 = Date.now();
  let body: { query?: string };
  try { body = await req.json(); } catch { body = {}; }
  const query = (body.query ?? "").trim();
  if (!query) {
    return new Response(JSON.stringify({ ok: false, error: "empty query" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { rows, rowCount } = await execViaPostgres(query);
    return new Response(JSON.stringify({
      ok: true, rows, rowCount: rowCount ?? rows.length,
      duration_ms: Date.now() - t0,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({
      ok: false, error: e?.message ?? String(e),
      duration_ms: Date.now() - t0,
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
