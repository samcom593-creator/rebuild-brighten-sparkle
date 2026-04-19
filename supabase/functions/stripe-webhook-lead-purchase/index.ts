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
    const agentId = metadata.agent_id;
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
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
