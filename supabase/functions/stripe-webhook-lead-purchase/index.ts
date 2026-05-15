import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.25.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!stripeSecret || !webhookSecret) {
    return new Response("Stripe webhook is not configured", { status: 500, headers: corsHeaders });
  }

  const stripe = new Stripe(stripeSecret, {
    apiVersion: "2024-04-10",
    httpClient: Stripe.createFetchHttpClient(),
  });

  const sig = req.headers.get("stripe-signature");
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
    const amountCents = session.amount_total ?? session.amount_received ?? session.amount ?? null;

    if (requestId) {
      await supabase
        .from("lead_purchase_requests")
        .update({
          status: "confirmed",
          confirmed_at: new Date().toISOString(),
          transaction_id: session.payment_intent || session.id,
          payment_method: "stripe",
          amount_paid: amountCents ? amountCents / 100 : null,
        })
        .eq("id", requestId);
    } else if (agentId) {
      await supabase.from("lead_purchase_requests").insert({
        agent_id: agentId,
        package_type: packageType,
        amount_paid: amountCents ? amountCents / 100 : null,
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
      session.receipt_email ||
      null;
    const customerName =
      session.customer_details?.name ||
      null;

    if (!agentId && customerEmail) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("id, user_id")
        .eq("email", customerEmail)
        .maybeSingle();
      if (profile?.user_id) {
        const { data: agent } = await supabase
          .from("agents")
          .select("id")
          .eq("user_id", profile.user_id)
          .maybeSingle();
        if (agent?.id) agentId = agent.id;
      } else if (profile?.id) {
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
    if (chargeKey && amountCents !== null) {
      await supabase.from("lead_purchases").upsert(
        {
          stripe_charge_id: chargeKey,
          amount_cents: amountCents,
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

    // If this looks like an ICA payment from an applicant (no lead-purchase
    // metadata, has a customer email), try to mark the matching application
    // paid. The RPC is idempotent — repeat calls are safe.
    if (!requestId && customerEmail) {
      try {
        const { data: paidResult, error: paidErr } = await supabase.rpc(
          "mark_application_paid",
          {
            p_email: customerEmail,
            p_amount_cents: amountCents,
            p_stripe_customer_id: typeof session.customer === "string" ? session.customer : null,
            p_stripe_checkout_session_id: session.id,
            p_paid_at: new Date().toISOString(),
          },
        );
        if (paidErr) {
          console.error("mark_application_paid failed", paidErr);
        } else if (paidResult && paidResult.length > 0) {
          console.log("ICA marked paid", paidResult[0]);
        }
      } catch (e) {
        console.error("mark_application_paid threw", e);
      }
    }

    // Fire Sam-facing alert (non-blocking) so every paid checkout pings him
    // even when no agent was matched. The bot_alerts trigger fans this out
    // to the dispatcher (email + ntfy + ProfitReveal).
    try {
      await supabase.from("bot_alerts").insert({
        source: "stripe_webhook_lead_purchase",
        event_type: "stripe_payment",
        severity: "info",
        subject: `Stripe $${(amountCents ?? 0) / 100} from ${customerName || customerEmail || "unknown"}`,
        body: JSON.stringify({
          email: customerEmail,
          name: customerName,
          amount_cents: amountCents,
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
