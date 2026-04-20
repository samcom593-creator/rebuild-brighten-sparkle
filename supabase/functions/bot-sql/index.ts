/**
 * bot-sql — authenticated SQL execution endpoint for the external Claude bot.
 *
 * Security model:
 *   - POST only (OPTIONS pre-flight allowed for CORS).
 *   - Bearer token must match APEX_BOT_TOKEN env secret OR the value in
 *     system_settings.apex_bot_token. Missing/wrong token → 401.
 *   - Rate-limit: 60 requests/min per token via in-memory sliding window.
 *
 * Execution:
 *   - Uses the Supabase service_role client (bypasses RLS).
 *   - Tries supabase.rpc('execute_sql', { q }) first — if that RPC doesn't
 *     exist, falls back to a direct Postgres connection via
 *     Deno's postgres driver using SUPABASE_DB_URL.
 *
 * Response: { rows, rowCount, error, duration_ms }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ─── In-memory rate limit (60 req/min/token) ───────────────────────────────
const rateBuckets = new Map<string, number[]>();
function allow(token: string): boolean {
  const now = Date.now();
  const bucket = (rateBuckets.get(token) ?? []).filter(t => now - t < 60_000);
  if (bucket.length >= 60) {
    rateBuckets.set(token, bucket);
    return false;
  }
  bucket.push(now);
  rateBuckets.set(token, bucket);
  return true;
}

// ─── Token resolution (env → system_settings) ──────────────────────────────
async function resolveBotToken(sb: ReturnType<typeof createClient>): Promise<string | null> {
  const env = Deno.env.get("APEX_BOT_TOKEN");
  if (env && env.length > 16) return env;
  const { data } = await sb.from("system_settings").select("value").eq("key", "apex_bot_token").maybeSingle();
  const v = (data as { value?: string })?.value;
  return v && v.length > 16 ? v : null;
}

// ─── Direct Postgres execution (for DDL / arbitrary queries) ───────────────
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

// ─── Main handler ──────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  // ─── Auth ──
  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "";
  const presented  = authHeader.replace(/^Bearer\s+/i, "").trim();
  const expected   = await resolveBotToken(sb);

  if (!expected) {
    return new Response(JSON.stringify({
      error: "Bot token not configured",
      hint:  "Set APEX_BOT_TOKEN secret in Supabase, or INSERT into system_settings (key='apex_bot_token')",
    }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  if (!presented || presented !== expected) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ─── Rate limit ──
  if (!allow(presented)) {
    return new Response(JSON.stringify({ error: "Rate limit exceeded (60/min)" }), {
      status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ─── Payload ──
  let query: string | undefined;
  try {
    const body = await req.json();
    query = typeof body?.query === "string" ? body.query.trim() : undefined;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!query) {
    return new Response(JSON.stringify({ error: "Missing 'query' string in body" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ─── Execute ──
  const started = Date.now();
  try {
    const { rows, rowCount } = await execViaPostgres(query);
    return new Response(JSON.stringify({
      ok: true,
      rows,
      rowCount,
      duration_ms: Date.now() - started,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({
      ok: false,
      error: String(err),
      duration_ms: Date.now() - started,
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
