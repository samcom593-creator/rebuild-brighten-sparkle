import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.25.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
    apiVersion: "2024-04-10",
    httpClient: Stripe.createFetchHttpClient(),
  });

  const sig = req.headers.get("stripe-signature");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody, sig!, webhookSecret!, undefined, Stripe.createSubtleCryptoProvider(),
    );
  } catch (err: any) {
    return new Response(`Webhook signature failure: ${err.message}`, { status: 400, headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  if (event.type === "checkout.session.completed" || event.type === "payment_intent.succeeded") {
    const session = event.data.object as any;
    const metadata = session.metadata || {};
    const requestId = metadata.lead_purchase_request_id || metadata.lead_purchase_id;
    let agentId = metadata.agent_id;
    const packageType = metadata.package_type || "front_page";

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
        package_type: packageType,
        amount_paid: session.amount_total ? session.amount_total / 100 : null,
        transaction_id: session.payment_intent || session.id,
        payment_method: "stripe",
        status: "confirmed",
        confirmed_at: new Date().toISOString(),
      });
    }

    // Public Stripe Payment Links don't carry agent_id metadata. Resolve the
    // payer to an APEX agent via customer email so the post-pay flow still
    // records the charge + alerts Sam. Fix shipped 2026-04-27 after Sam
    // reported a $250 payment that never landed in the DB.
    const customerEmail =
      session.customer_email ||
      session.customer_details?.email ||
      null;
    const customerName =
      session.customer_details?.name ||
      null;

    if (!agentId && customerEmail) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("id")
        .eq("email", customerEmail)
        .maybeSingle();
      if (profile?.id) {
        const { data: agent } = await supabase
          .from("agents")
          .select("id")
          .eq("profile_id", profile.id)
          .maybeSingle();
        if (agent?.id) agentId = agent.id;
      }
    }

    // Always upsert into lead_purchases (canonical charge ledger). Idempotent
    // on stripe_charge_id so retried webhooks don't double-insert.
    const chargeKey = session.payment_intent || session.id;
    if (chargeKey) {
      await supabase.from("lead_purchases").upsert(
        {
          stripe_charge_id: chargeKey,
          amount_cents: session.amount_total ?? null,
          currency: session.currency || "usd",
          customer_id: session.customer || null,
          customer_email: customerEmail,
          customer_name: customerName,
          description: metadata.sku || metadata.package_type || "stripe payment link",
          agent_id: agentId || null,
          charged_at: new Date(((session.created as number) || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
          metadata: {
            session_id: session.id,
            subscription_id: session.subscription || null,
            mode: session.mode || null,
            payment_link: session.payment_link || null,
            ...metadata,
          },
        },
        { onConflict: "stripe_charge_id" },
      );
    }

    // Fire Sam-facing alert (non-blocking) so every paid checkout pings him
    // even when no agent was matched. The bot_alerts trigger fans this out
    // to the dispatcher (email + ntfy + ProfitReveal).
    try {
      await supabase.from("bot_alerts").insert({
        source: "stripe_webhook_lead_purchase",
        event_type: "stripe_payment",
        severity: "info",
        subject: `💸 $${(session.amount_total ?? 0) / 100} from ${customerName || customerEmail || "unknown"}`,
        body: JSON.stringify({
          email: customerEmail,
          name: customerName,
          amount_cents: session.amount_total,
          mode: session.mode,
          session_id: session.id,
          subscription_id: session.subscription,
          agent_id: agentId,
          sku: metadata.sku,
        }),
      });
    } catch (e) {
      console.error("bot_alerts insert failed", e);
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
