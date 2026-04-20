// Mirror agents backfill — matches local agents/carriers to InsuraCloud IDs.
// Strategy: pull /team-analytics + /carriers from InsuraCloud, then match
// by email (agents) and lowercase name (carriers). Admin-only.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
};

const INSURACLOUD_BASE = Deno.env.get("INSURACLOUD_BASE_URL") || "https://agentlink.replit.app";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

async function fetchIC(path: string, token: string) {
  const res = await fetch(`${INSURACLOUD_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, "x-api-key": token, Accept: "application/json" },
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`InsuraCloud ${path} ${res.status}: ${text.slice(0, 300)}`);
  return data;
}

const norm = (s?: string | null) => (s ?? "").trim().toLowerCase();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Require admin auth (verify_jwt on by default)
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Missing Authorization" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userResult } = await userClient.auth.getUser();
  const user = userResult?.user;
  if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
  const { data: roleRow } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  const isAdmin = (roleRow ?? []).some((r: any) => r.role === "admin");
  if (!isAdmin) return new Response(JSON.stringify({ error: "Admin only" }), { status: 403, headers: corsHeaders });

  const token = Deno.env.get("INSURACLOUD_API_TOKEN");
  if (!token) {
    return new Response(JSON.stringify({ error: "INSURACLOUD_API_TOKEN not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let agents_matched = 0, agents_unmatched = 0;
  let carriers_matched = 0, carriers_unmatched = 0;
  const details: any = { agent_misses: [], carrier_misses: [] };

  try {
    // ==== AGENTS ====
    let icAgents: any[] = [];
    try {
      const teamRes = await fetchIC("/team-analytics", token);
      icAgents = teamRes?.team ?? teamRes?.agents ?? teamRes?.users ?? teamRes?.data ?? [];
      if (!Array.isArray(icAgents)) icAgents = [];
    } catch (e: any) {
      details.team_analytics_error = e.message;
    }

    if (icAgents.length > 0) {
      const byEmail = new Map<string, any>();
      for (const a of icAgents) {
        const email = norm(a.email ?? a.user_email ?? a.username);
        if (email) byEmail.set(email, a);
      }

      const { data: localAgents } = await supabase
        .from("agents")
        .select("id, insuracloud_user_id, profiles:profile_id(email)")
        .eq("is_deactivated", false)
        .is("insuracloud_user_id", null);

      for (const la of localAgents ?? []) {
        const email = norm((la.profiles as any)?.email);
        const match = email ? byEmail.get(email) : null;
        const icId = match?.user_id ?? match?.id;
        if (icId) {
          await supabase.from("agents").update({ insuracloud_user_id: icId }).eq("id", la.id);
          agents_matched++;
        } else {
          agents_unmatched++;
          details.agent_misses.push({ agent_id: la.id, email });
        }
      }
    }

    // ==== CARRIERS ====
    let icCarriers: any[] = [];
    try {
      const carriersRes = await fetchIC("/carriers", token);
      icCarriers = carriersRes?.carriers ?? carriersRes?.data ?? carriersRes ?? [];
      if (!Array.isArray(icCarriers)) icCarriers = [];
    } catch (e: any) {
      details.carriers_error = e.message;
    }

    if (icCarriers.length > 0) {
      const byName = new Map<string, any>();
      for (const c of icCarriers) byName.set(norm(c.name ?? c.carrier_name), c);

      const { data: localCarriers } = await supabase
        .from("carriers")
        .select("id, name, insuracloud_carrier_id")
        .is("insuracloud_carrier_id", null);

      for (const lc of localCarriers ?? []) {
        const match = byName.get(norm(lc.name));
        const icId = match?.id ?? match?.carrier_id;
        if (icId) {
          await supabase.from("carriers").update({ insuracloud_carrier_id: icId }).eq("id", lc.id);
          carriers_matched++;
        } else {
          carriers_unmatched++;
          details.carrier_misses.push({ carrier_id: lc.id, name: lc.name });
        }
      }
    }

    await supabase.from("insuracloud_backfill_log").insert({
      ran_by: user.id,
      agents_matched,
      agents_unmatched,
      carriers_matched,
      carriers_unmatched,
      details,
    });

    return new Response(JSON.stringify({
      ok: true, agents_matched, agents_unmatched, carriers_matched, carriers_unmatched, details,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("[mirror-agents-backfill] error", e);
    return new Response(JSON.stringify({ error: e?.message ?? "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
