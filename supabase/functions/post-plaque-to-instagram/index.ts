// Queue an agent-owned plaque to be posted to that agent's personal Instagram.
// Writes to public.plaque_ig_post_queue; a Mac-side worker picks up rows where
// status='pending' and posts via the agent's stored IG token / cookie.
//
// AUTOPOSTER POLICY ENFORCEMENT (2026-04-28): mirrors src/config/autoposterPolicy.ts.
// Edge functions can't import from src/, so the IG-blocked-handles list is duplicated here.
// Update both files together when the policy changes.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Hard-deny IG handles — see autoposter_policy.md §1
const IG_BLOCKED_HANDLES = [
  "theprincejamez",
  "the_prince_james",
  "the.prince.james",
  "theprincejames",
];

function assertIgHandleAllowed(handle: string): void {
  const normalized = handle.replace(/^@/, "").toLowerCase();
  for (const blocked of IG_BLOCKED_HANDLES) {
    if (normalized === blocked) {
      throw new Error(`autoposterPolicy: BLOCKED IG handle "@${handle}" — see autoposter_policy.md`);
    }
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(url, svc, { auth: { persistSession: false } });

    const body = await req.json().catch(() => ({}));
    const plaqueId: string | undefined = body.plaque_id;
    if (!plaqueId) return json({ error: "plaque_id required" }, 400);

    const { data: plaque, error: pErr } = await supabase
      .from("plaque_awards")
      .select("id, agent_id, milestone_type, image_png_url, image_svg_url, badge_label, amount, milestone_date")
      .eq("id", plaqueId)
      .maybeSingle();
    if (pErr) throw pErr;
    if (!plaque) return json({ error: "plaque not found" }, 404);
    if (!plaque.agent_id) return json({ error: "plaque has no agent_id" }, 400);

    const imageUrl = plaque.image_png_url ?? plaque.image_svg_url;
    if (!imageUrl) return json({ error: "plaque image not rendered yet" }, 409);

    // Pull agent IG handle so the worker knows the target account
    const { data: agent } = await supabase
      .from("agents")
      .select("id, user_id, instagram_handle, profile:profiles(full_name, instagram_handle)")
      .eq("id", plaque.agent_id)
      .maybeSingle();

    const ig =
      (agent as any)?.instagram_handle ||
      (agent as any)?.profile?.instagram_handle ||
      null;
    if (!ig) return json({ error: "agent has no IG handle on file" }, 412);

    // POLICY GATE: never post to a hard-blocked handle (Sam's personal IG).
    // Belt-and-suspenders — Sam's agent_id should never reach here anyway
    // because zero-deals rule prevents him generating plaques.
    try {
      assertIgHandleAllowed(String(ig));
    } catch (policyErr: any) {
      console.error("[autoposter-policy] blocked", policyErr?.message);
      return json({ error: policyErr?.message ?? "blocked by autoposter policy" }, 403);
    }

    // Idempotent enqueue
    const { error: qErr } = await supabase
      .from("plaque_ig_post_queue")
      .upsert(
        {
          plaque_id: plaque.id,
          agent_id: plaque.agent_id,
          ig_handle: String(ig).replace(/^@/, ""),
          image_url: imageUrl,
          caption: buildCaption(plaque),
          status: "pending",
        },
        { onConflict: "plaque_id,agent_id" }
      );
    if (qErr) throw qErr;

    return json({ queued: true, ig_handle: ig, plaque_id: plaque.id });
  } catch (e: any) {
    return json({ error: e?.message ?? "unknown" }, 500);
  }
});

function buildCaption(p: any): string {
  const amt = p.amount ? `$${Number(p.amount).toLocaleString()}` : "";
  const date = p.milestone_date ? new Date(p.milestone_date).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
  return `${p.badge_label ?? "APEX win"} ${amt ? "· " + amt : ""} ${date ? "· " + date : ""}\n\n#APEXFinancialEmpire #IUL #insurance #closer`.trim();
}

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}
