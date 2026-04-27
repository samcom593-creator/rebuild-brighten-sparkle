// stripe-webhook-lead-purchase — handles checkout.session.completed for ALL 4 offers.
//
// Writes a row to public.offer_purchases (the unified ledger). The DB trigger
// then queues an email + SMS alert to Sam via bot_alerts.
//
// Back-compat: still updates lead_purchase_requests when a lead-tier session
// arrives so the existing /admin payment tracker keeps working.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.25.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, stripe-signature",
};

const SKU_NAME: Record<string, string> = {
  gold: "Gold Leads (Standard)",
  platinum: "Platinum Vet Leads",
  auto_dm: "Auto-DM Engine",
  social_growth: "Full Social Media Growth Suite",
  fitness_reset: "Fitness Reset Blueprint",
  kingofsales_course: "King of Sales Course",
  work_with_sam: "1:1 Work With Sam",
};

const SKU_MODE: Record<string, "subscription" | "payment"> = {
  gold: "subscription",
  platinum: "subscription",
  auto_dm: "subscription",
  social_growth: "subscription",
  fitness_reset: "payment",
  kingofsales_course: "payment",
  work_with_sam: "payment",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
    apiVersion: "2024-04-10",
    httpClient: Stripe.createFetchHttpClient(),
  });

  const sig = req.headers.get("stripe-signature");
  const rawBody = await req.text();

  // Try every known signing secret. Stripe rotates rarely, but during cutover
  // (a fresh webhook endpoint vs an old env var) we need to accept either.
  // The fallback whsec_ below was provisioned 2026-04-27 alongside the new
  // endpoint we_1TQktVC3Khd8IPVmGJSwaWGs and is the source of truth until
  // Sam moves it into STRIPE_WEBHOOK_SECRET.
  const candidates = [
    Deno.env.get("STRIPE_WEBHOOK_SECRET"),
    Deno.env.get("STRIPE_WEBHOOK_SECRET_2"),
    "whsec_7gZLSPjKZAoi3HaoanEnX5YlcApuoyRE",
  ].filter(Boolean) as string[];

  let event: Stripe.Event | null = null;
  let lastErr: any = null;
  for (const secret of candidates) {
    try {
      event = await stripe.webhooks.constructEventAsync(
        rawBody,
        sig!,
        secret,
        undefined,
        Stripe.createSubtleCryptoProvider(),
      );
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (!event) {
    return new Response(`Webhook signature failure: ${(lastErr as any)?.message ?? "no candidate secret matched"}`, {
      status: 400,
      headers: corsHeaders,
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Only act on terminal "money landed" events.
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const metadata = (session.metadata ?? {}) as Record<string, string>;
    const sku = metadata.sku || metadata.tier;
    const packageName = metadata.package_name || (sku ? SKU_NAME[sku] : "Unknown");
    const agentId = metadata.agent_id || null;
    const userId = metadata.user_id || null;

    // Resolve a stable purchaser email (Stripe puts it in customer_details on checkout sessions).
    const purchaserEmail =
      session.customer_details?.email ||
      session.customer_email ||
      "";
    const purchaserName = session.customer_details?.name || null;

    if (sku && SKU_NAME[sku]) {
      // 1. Write to the unified ledger (idempotent on stripe_session_id).
      const { error: upsertError } = await supabase
        .from("offer_purchases")
        .upsert(
          {
            user_id: userId,
            agent_id: agentId,
            purchaser_email: purchaserEmail,
            purchaser_name: purchaserName,
            sku,
            package_name: packageName,
            amount_cents: session.amount_total ?? 0,
            currency: session.currency ?? "usd",
            mode: SKU_MODE[sku] ?? "payment",
            stripe_session_id: session.id,
            stripe_payment_intent: (session.payment_intent as string) ?? null,
            stripe_subscription_id: (session.subscription as string) ?? null,
            stripe_customer_id: (session.customer as string) ?? null,
            status: "paid",
            metadata: { mode: session.mode, livemode: event.livemode },
          },
          { onConflict: "stripe_session_id" },
        );
      if (upsertError) console.error("offer_purchases upsert failed:", upsertError);
    }

    // 2. Back-compat: keep the old lead_purchase_requests in sync for lead SKUs.
    if (sku === "gold" || sku === "platinum") {
      const requestId = metadata.lead_purchase_request_id || metadata.lead_purchase_id;
      if (requestId) {
        await supabase
          .from("lead_purchase_requests")
          .update({
            status: "confirmed",
            confirmed_at: new Date().toISOString(),
            transaction_id: session.payment_intent || session.id,
            payment_method: "stripe",
            amount_paid: session.amount_total ? session.amount_total / 100 : null,
          })
          .eq("id", requestId);
      } else if (agentId) {
        await supabase.from("lead_purchase_requests").insert({
          agent_id: agentId,
          package_type: sku,
          amount_paid: session.amount_total ? session.amount_total / 100 : null,
          transaction_id: session.payment_intent || session.id,
          payment_method: "stripe",
          status: "confirmed",
          confirmed_at: new Date().toISOString(),
        });
      }
    }
  }

  // Mark refunds + cancellations on the ledger so admin views stay accurate.
  if (event.type === "charge.refunded") {
    const charge = event.data.object as Stripe.Charge;
    const pi = typeof charge.payment_intent === "string" ? charge.payment_intent : null;
    if (pi) {
      await supabase
        .from("offer_purchases")
        .update({ status: "refunded" })
        .eq("stripe_payment_intent", pi);
    }
  }

  if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object as Stripe.Subscription;
    await supabase
      .from("offer_purchases")
      .update({ status: "canceled" })
      .eq("stripe_subscription_id", sub.id);
  }

  return new Response(JSON.stringify({ received: true, type: event.type }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
