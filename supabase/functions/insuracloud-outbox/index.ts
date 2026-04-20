// InsuraCloud outbox processor
// Pushes deals to InsuraCloud /policies endpoint and marks them as synced.
// Modes:
//   - { deal_id: "..." }  → process one deal (called from trigger)
//   - { sweep: true }      → process all unsynced deals (called from cron)
//
// Failure modes are saved to deals.insuracloud_sync_error so admins can
// fix the underlying mapping and the cron sweeper will retry automatically.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id, idempotency-key",
};

const INSURACLOUD_BASE = Deno.env.get("INSURACLOUD_BASE_URL") || "https://agentlink.insuracloud.ai";
const SWEEP_BATCH_SIZE = 25;

interface OutboxRequest {
  deal_id?: string;
  sweep?: boolean;
}

type DealRow = {
  id: string;
  agent_id: string;
  carrier_id: string | null;
  client_first_name: string;
  client_last_name: string;
  client_phone: string;
  client_dob: string;
  product_sold: string;
  policy_number: string;
  monthly_premium: number;
  annual_premium: number;
  face_amount: number;
  effective_date: string;
  policy_expiration_date: string | null;
  status: string;
  notes: string | null;
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const defaultToken = Deno.env.get("INSURACLOUD_API_TOKEN");

async function pushOne(deal: DealRow): Promise<{ ok: boolean; error?: string; insuracloud_id?: number | string }> {
  // Resolve agent → InsuraCloud user id + token
  const { data: agent } = await supabase
    .from("agents")
    .select("insuracloud_api_token, insuracloud_user_id, profile_id, profiles:profile_id(email, full_name)")
    .eq("id", deal.agent_id)
    .maybeSingle();

  if (!agent) return { ok: false, error: "Agent record not found" };

  const token = agent.insuracloud_api_token || defaultToken;
  if (!token) return { ok: false, error: "No InsuraCloud API token configured (agent or default)" };

  // Resolve carrier
  let insuracloudCarrierId: number | null = null;
  if (deal.carrier_id) {
    const { data: carrier } = await supabase
      .from("carriers")
      .select("name, insuracloud_carrier_id")
      .eq("id", deal.carrier_id)
      .maybeSingle();
    if (!carrier) return { ok: false, error: "Carrier record not found" };
    insuracloudCarrierId = carrier.insuracloud_carrier_id;
    if (insuracloudCarrierId === null) {
      return { ok: false, error: `Carrier "${carrier.name}" has no insuracloud_carrier_id mapping` };
    }
  } else {
    return { ok: false, error: "Deal has no carrier" };
  }

  // Build payload for InsuraCloud's POST /api/deals endpoint. Numbers must
  // be actual numbers (the schema rejects stringified decimals).
  const dealPayload = {
    carrierId: insuracloudCarrierId,
    clientFirstName: deal.client_first_name,
    clientLastName: deal.client_last_name,
    clientPhoneNumber: deal.client_phone,
    clientDateOfBirth: deal.client_dob,
    productSold: deal.product_sold,
    policyNumber: deal.policy_number,
    monthlyPremium: Number(deal.monthly_premium),
    annualPremium: Number(deal.annual_premium),
    faceAmount: Number(deal.face_amount),
    effectiveDate: deal.effective_date,
    externalId: deal.id,
    externalSource: "apex-financial",
    notes: deal.notes ?? undefined,
  };

  // InsuraCloud has no stateless API-key POST path for deals — the public
  // /api/v1/book-of-business endpoint is read-only, and /api/deals requires
  // an authenticated session + CSRF token. We treat the stored token as
  // either:
  //   • an al_* API key (used as a Bearer, tried first for future-proofing), or
  //   • a connect.sid session cookie value, in which case we fetch a CSRF
  //     token against that session and POST /api/deals with both.
  const isApiKey = token.startsWith("al_");

  try {
    if (isApiKey) {
      // Best-effort api-key attempt — returns 403 today because of CSRF, but
      // leaves the door open if InsuraCloud ships a stateless endpoint later.
      const res = await fetch(`${INSURACLOUD_BASE}/api/v1/book-of-business`, {
        method: "POST",
        headers: {
          "x-api-key": token,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ deals: [dealPayload] }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        return { ok: true, insuracloud_id: data?.deals?.[0]?.id };
      }
      const text = await res.text();
      return { ok: false, error: `InsuraCloud api-key ${res.status}: ${text.slice(0, 300)}` };
    }

    // Session-cookie flow: grab a CSRF token on the same session, then POST.
    const csrfRes = await fetch(`${INSURACLOUD_BASE}/api/csrf-token`, {
      headers: { Cookie: `connect.sid=${token}` },
    });
    if (!csrfRes.ok) {
      return { ok: false, error: `csrf-token fetch ${csrfRes.status}` };
    }
    const { csrfToken } = await csrfRes.json() as { csrfToken: string };

    const res = await fetch(`${INSURACLOUD_BASE}/api/deals`, {
      method: "POST",
      headers: {
        Cookie: `connect.sid=${token}`,
        "X-CSRF-Token": csrfToken,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(dealPayload),
    });

    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }

    if (!res.ok) {
      return { ok: false, error: `InsuraCloud ${res.status}: ${text.slice(0, 400)}` };
    }

    return { ok: true, insuracloud_id: data?.id ?? data?.policy_id };
  } catch (e: any) {
    return { ok: false, error: `Network error: ${e?.message ?? String(e)}` };
  }
}

async function processDeal(dealId: string): Promise<{ deal_id: string; ok: boolean; error?: string }> {
  const { data: deal, error } = await supabase
    .from("deals")
    .select(
      "id, agent_id, carrier_id, client_first_name, client_last_name, client_phone, client_dob, product_sold, policy_number, monthly_premium, annual_premium, face_amount, effective_date, policy_expiration_date, status, notes, synced_to_insuracloud_at",
    )
    .eq("id", dealId)
    .maybeSingle();

  if (error || !deal) {
    return { deal_id: dealId, ok: false, error: error?.message ?? "Deal not found" };
  }
  if (deal.synced_to_insuracloud_at) {
    return { deal_id: dealId, ok: true };
  }
  if (deal.status === "draft") {
    return { deal_id: dealId, ok: true };
  }

  const result = await pushOne(deal as DealRow);

  if (result.ok) {
    await supabase
      .from("deals")
      .update({
        synced_to_insuracloud_at: new Date().toISOString(),
        insuracloud_sync_error: null,
      })
      .eq("id", deal.id);
  } else {
    await supabase
      .from("deals")
      .update({ insuracloud_sync_error: result.error?.slice(0, 500) ?? "Unknown error" })
      .eq("id", deal.id);
  }

  return { deal_id: deal.id, ok: result.ok, error: result.error };
}

async function sweepUnsynced(): Promise<{ processed: number; succeeded: number; failed: number }> {
  const { data: deals } = await supabase
    .from("deals")
    .select("id")
    .is("synced_to_insuracloud_at", null)
    .neq("status", "draft")
    .order("created_at", { ascending: true })
    .limit(SWEEP_BATCH_SIZE);

  const ids = (deals ?? []).map((d) => d.id);
  let succeeded = 0, failed = 0;

  for (const id of ids) {
    const r = await processDeal(id);
    if (r.ok) succeeded++; else failed++;
  }

  return { processed: ids.length, succeeded, failed };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let body: OutboxRequest = {};
  try { body = await req.json(); } catch { /* empty body OK */ }

  try {
    if (body.sweep) {
      const result = await sweepUnsynced();
      return new Response(JSON.stringify({ mode: "sweep", ...result }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!body.deal_id) {
      return new Response(JSON.stringify({ error: "deal_id or sweep:true is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await processDeal(body.deal_id);
    return new Response(JSON.stringify(result), {
      status: result.ok ? 200 : 422,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[insuracloud-outbox] fatal", e);
    return new Response(JSON.stringify({ error: e?.message ?? "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
