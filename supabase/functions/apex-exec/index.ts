/**
 * apex-exec — fresh SQL execution endpoint with baked-in persistent token.
 *
 * Exists because Lovable's CI reliably deploys NEW functions but rarely
 * picks up UPDATES to existing ones. bot-sql with the persistent token
 * fallback has been pending redeploy for 20+ minutes.
 *
 * Same security model as bot-sql, same response shape.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PERSISTENT_TOKEN =
  "37740df6728db61e128392dbbdae34be1dccf862eebe09925ff321182fb30ebd";

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
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "";
  const presented = authHeader.replace(/^Bearer\s+/i, "").trim();

  const validTokens: string[] = [PERSISTENT_TOKEN];
  const env = Deno.env.get("APEX_BOT_TOKEN");
  if (env && env.length > 16) validTokens.push(env);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );
  const { data } = await sb.from("system_settings").select("value").eq("key", "apex_bot_token").maybeSingle();
  const v = (data as { value?: string })?.value;
  if (v && v.length > 16) validTokens.push(v);

  if (!presented || !validTokens.includes(presented)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!allow(presented)) {
    return new Response(JSON.stringify({ error: "Rate limit exceeded (60/min)" }), {
      status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: { query?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const query = typeof body.query === "string" ? body.query.trim() : undefined;
  if (!query) {
    return new Response(JSON.stringify({ error: "Missing 'query' string in body" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

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
