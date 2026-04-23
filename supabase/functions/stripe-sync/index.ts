/**
 * stripe-sync — pulls recent Stripe charges/payment_intents and writes them
 * to public.lead_payment_tracking + public.lead_purchases (NEW).
 *
 * Uses the secret key stored in public.system_settings.stripe_secret_key
 * (populated by admin via SQL or /dashboard/setup).
 *
 * Runs on a cron via net.http_post, or can be triggered on-demand.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type StripeCharge = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  customer: string | null;
  description: string | null;
  created: number;
  billing_details?: { email?: string; name?: string };
  metadata?: Record<string, string>;
};

async function stripeGet<T = any>(key: string, path: string): Promise<T> {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Stripe ${res.status}: ${body.slice(0, 200)}`);
  return JSON.parse(body) as T;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  try {
    const { data: settingRow } = await sb.from("system_settings")
      .select("value").eq("key", "stripe_secret_key").maybeSingle();
    const key = (settingRow as any)?.value;
    if (!key) {
      return new Response(JSON.stringify({ error: "stripe_secret_key not configured" }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Last 100 successful charges
    const charges = await stripeGet<{ data: StripeCharge[] }>(key,
      "/charges?limit=100");

    const rows = charges.data
      .filter(c => c.status === "succeeded")
      .map(c => ({
        stripe_charge_id: c.id,
        amount_cents:     c.amount,
        currency:         c.currency,
        customer_id:      c.customer,
        customer_email:   c.billing_details?.email ?? null,
        customer_name:    c.billing_details?.name ?? null,
        description:      c.description,
        agent_id_ref:     c.metadata?.agent_id ?? null,   // if you set metadata={agent_id: ...}
        charged_at:       new Date(c.created * 1000).toISOString(),
        metadata:         c.metadata ?? {},
      }));

    if (rows.length > 0) {
      await sb.from("lead_purchases" as any).upsert(rows, { onConflict: "stripe_charge_id" });
    }

    // Count total + total revenue
    const total_cents = rows.reduce((s, r) => s + (r.amount_cents || 0), 0);

    return new Response(JSON.stringify({
      ok: true,
      synced: rows.length,
      total_usd: (total_cents / 100).toFixed(2),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? "stripe sync failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
