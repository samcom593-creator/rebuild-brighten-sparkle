// Deploy trigger: fd413d9
// One-shot bootstrap: writes app.settings.service_role_key and
// app.settings.supabase_url GUCs from this function's own environment
// so plpgsql triggers (auto_nipr_verify, licensing_stage_nudge_sweep,
// apex_self_heal pg_net paths) can call back into edge functions.
//
// Called once after deploy; idempotent — running again just rewrites
// the same values. Returns the current (masked) settings on completion.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

function mask(s: string | null): string {
  if (!s) return "(empty)";
  if (s.length <= 12) return "***";
  return `${s.slice(0, 6)}…${s.slice(-4)} (${s.length} chars)`;
}

async function execSql(query: string) {
  const { error } = await supabase.rpc("exec_sql_admin", { query });
  if (error) throw new Error(error.message);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // ALTER DATABASE persists across reconnects; SET LOCAL would only affect one txn.
    // Quote-escape via single-quote doubling.
    const safeKey = SERVICE_ROLE.replace(/'/g, "''");
    const safeUrl = SUPABASE_URL.replace(/'/g, "''");
    const stmts = [
      `ALTER DATABASE postgres SET "app.settings.service_role_key" = '${safeKey}'`,
      `ALTER DATABASE postgres SET "app.settings.supabase_url" = '${safeUrl}'`,
      `SELECT pg_reload_conf()`,
    ];

    // We can't run ALTER DATABASE through PostgREST; fall through to bot-sql.
    const botToken = Deno.env.get("APEX_BOT_TOKEN");
    if (!botToken) {
      return new Response(JSON.stringify({
        error: "APEX_BOT_TOKEN not set; cannot ALTER DATABASE from this fn",
        hint: "Set APEX_BOT_TOKEN secret then re-invoke",
      }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    for (const sql of stmts) {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/bot-sql`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${botToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: sql }),
      });
      const data = await res.json();
      if (!data.ok) {
        return new Response(JSON.stringify({ error: `bot-sql failed on '${sql.slice(0, 60)}…': ${data.error}` }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      service_role_key: mask(SERVICE_ROLE),
      supabase_url: SUPABASE_URL,
      message: "GUCs set. pg_net triggers can now call back into edge functions.",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
// deploy trigger: 1776877132
