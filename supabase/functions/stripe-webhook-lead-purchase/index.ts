import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.25.0?target=deno";

// 2026-05-19: expanded to a full Stripe ingest pipeline.
// Handles: checkout.session.completed, payment_intent.succeeded, charge.refunded,
// charge.dispute.{created,updated,closed}, customer.subscription.{created,updated,deleted},
// invoice.payment_failed, invoice.payment_succeeded, payment_intent.payment_failed.
//
// Every event is logged to stripe_events_log (idempotent on event_id).
// Mentorship products auto-write mentorship_leads. Subs write stripe_subscription_events.
// Disputes write stripe_disputes + CRITICAL bot_alerts. Failed payments write
// stripe_failed_payments + dunning_watch picks them up. Refunds backfill lead_purchases
// with refunded_at / refund_amount_cents and fire bot_alerts.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
};

const MENTORSHIP_PRODUCTS: Record<string, { tier: string; tier_label: string; value_cents: number }> = {
  prod_UXlEPjc7OazR7x: { tier: "inner_circle",  tier_label: "APEX Inner Circle",   value_cents: 250000 },
  prod_UXlEsTAPbm1GPx: { tier: "one_on_one",    tier_label: "APEX 1:1",            value_cents: 500000 },
  prod_UXlEm6O0YZpaSO: { tier: "sales_academy", tier_label: "APEX Sales Academy",  value_cents:  99700 },
  prod_UXlEFTVsPsUrBE: { tier: "apex_fit",      tier_label: "APEX Fit",            value_cents:  49700 },
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

  // 1) ALWAYS log the event first (idempotent) so we never lose the raw payload.
  try {
    await supabase.from("stripe_events_log").upsert(
      {
        event_id: event.id,
        event_type: event.type,
        api_version: event.api_version || null,
        livemode: event.livemode ?? null,
        event_created: new Date((event.created || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
        handled: false,
        payload: event as any,
      },
      { onConflict: "event_id", ignoreDuplicates: true },
    );
  } catch (e) {
    console.error("stripe_events_log upsert failed", e);
  }

  // 1a) Replay guard. Stripe webhook delivery is at-least-once, and handler
  // failures now return 5xx (see below) so redeliveries are expected. If we
  // already handled this exact event_id, short-circuit — re-running handlers
  // for an event that already succeeded has no legitimate purpose and only
  // risks duplicate side-effects. First delivery of any event is unaffected
  // (no prior row => alreadyHandled stays false).
  let alreadyHandled = false;
  try {
    const { data: priorEvent } = await supabase
      .from("stripe_events_log")
      .select("handled")
      .eq("event_id", event.id)
      .maybeSingle();
    alreadyHandled = priorEvent?.handled === true;
  } catch (e) {
    console.error("stripe_events_log replay check failed", e);
  }
  if (alreadyHandled) {
    return new Response(
      JSON.stringify({ received: true, handled: true, note: "duplicate delivery — already handled", error: null }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  let handlerNote = "";
  let handlerError: string | null = null;

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "payment_intent.succeeded":
        handlerNote = await handlePaymentSuccess(supabase, event);
        break;
      case "charge.refunded":
        handlerNote = await handleChargeRefunded(supabase, event);
        break;
      case "charge.dispute.created":
      case "charge.dispute.updated":
      case "charge.dispute.closed":
        handlerNote = await handleDispute(supabase, event);
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
      case "customer.subscription.paused":
      case "customer.subscription.resumed":
        handlerNote = await handleSubscriptionEvent(supabase, event);
        break;
      case "invoice.payment_failed":
      case "payment_intent.payment_failed":
        handlerNote = await handlePaymentFailed(supabase, event);
        break;
      case "invoice.payment_succeeded":
        handlerNote = "logged (invoice.payment_succeeded — handled via checkout.session.completed/PI.succeeded)";
        break;
      default:
        handlerNote = `unhandled event type: ${event.type}`;
    }
  } catch (e: any) {
    handlerError = String(e?.message || e);
    console.error(`handler error for ${event.type} ${event.id}`, e);
  }

  try {
    await supabase
      .from("stripe_events_log")
      .update({
        handled: handlerError === null,
        handler_note: handlerNote || null,
        handler_error: handlerError,
      })
      .eq("event_id", event.id);
  } catch (e) {
    console.error("stripe_events_log update failed", e);
  }

  // A failed handler must NOT return 200 — Stripe treats 2xx as "delivered" and
  // never retries, so recovery used to depend on someone manually re-driving
  // stripe_events_log. Return 500 so Stripe redelivers on its own backoff.
  // Safe to retry because: (a) the replay guard above skips events already
  // handled, (b) stripe_events_log upserts on its event_id PK, (c) the
  // subscription + failed-payment inserts pre-check on event_id (see handlers).
  // Signature failures stay 400 (permanent — must never be retried).
  return new Response(
    JSON.stringify({ received: true, handled: handlerError === null, note: handlerNote, error: handlerError }),
    {
      status: handlerError === null ? 200 : 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
});

// ──────────────────────────────────────────────────────────────────────────────
// HANDLERS
// ──────────────────────────────────────────────────────────────────────────────

async function handlePaymentSuccess(supabase: any, event: Stripe.Event): Promise<string> {
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

  const customerEmail =
    session.customer_email ||
    session.customer_details?.email ||
    session.receipt_email ||
    null;
  const customerName = session.customer_details?.name || null;

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

  // Extract product info (mentorship classification)
  let productId: string | null = null;
  let priceId: string | null = null;
  try {
    // For checkout.session.completed we may need line_items to find product_id.
    // session.line_items is only present if expanded. Try metadata first.
    if (metadata.product_id) productId = metadata.product_id;
    if (metadata.price_id) priceId = metadata.price_id;
    // If still missing and we have a sub id, peek the sub's items via API.
    if (!productId && session.subscription) {
      const sk = Deno.env.get("STRIPE_SECRET_KEY")!;
      const resp = await fetch(`https://api.stripe.com/v1/subscriptions/${session.subscription}?expand[]=items.data.price.product`, {
        headers: { Authorization: `Bearer ${sk}` },
      });
      if (resp.ok) {
        const sub = await resp.json();
        const item = sub?.items?.data?.[0];
        productId = item?.price?.product?.id || item?.plan?.product || null;
        priceId = item?.price?.id || null;
      }
    }
  } catch (e) {
    console.error("product lookup failed", e);
  }

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
          product_id: productId,
          price_id: priceId,
          ...metadata,
        },
      },
      { onConflict: "stripe_charge_id" },
    );
  }

  // MENTORSHIP CAPTURE — auto-write a paid row when a mentorship product is bought.
  if (productId && MENTORSHIP_PRODUCTS[productId]) {
    const tierInfo = MENTORSHIP_PRODUCTS[productId];
    const nameParts = (customerName || "").trim().split(/\s+/);
    const firstName = nameParts.length > 0 ? nameParts[0] : null;
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : null;

    try {
      await supabase.from("mentorship_leads").upsert(
        {
          source: "stripe_payment_link",
          first_name: firstName,
          last_name: lastName,
          contact_email: customerEmail,
          tier_interest: tierInfo.tier,
          status: "paid",
          value_cents: amountCents,
          stripe_customer_id: typeof session.customer === "string" ? session.customer : null,
          stripe_session_id: session.id || null,
          stripe_product_id: productId,
          stripe_price_id: priceId,
          stripe_payment_intent: session.payment_intent || null,
          paid_at: new Date().toISOString(),
          last_touch_at: new Date().toISOString(),
          notes: `auto-captured from stripe_webhook on ${event.type}; ${tierInfo.tier_label}`,
        },
        { onConflict: "stripe_session_id" },
      );
    } catch (e) {
      console.error("mentorship_leads upsert failed", e);
    }
  }

  // ICA mark paid (existing path, unchanged)
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
      if (paidErr) console.error("mark_application_paid failed", paidErr);
      else if (paidResult && paidResult.length > 0) console.log("ICA marked paid", paidResult[0]);
    } catch (e) {
      console.error("mark_application_paid threw", e);
    }
  }

  await fireAlert(supabase, {
    source: "stripe_webhook_lead_purchase",
    event_type: "stripe_payment",
    severity: "info",
    subject: `Stripe $${(amountCents ?? 0) / 100} from ${customerName || customerEmail || "unknown"}`,
    body: JSON.stringify({
      email: customerEmail, name: customerName, amount_cents: amountCents,
      mode: session.mode, session_id: session.id,
      subscription_id: session.subscription, agent_id: agentId,
      sku: metadata.sku, product_id: productId, tier: productId ? MENTORSHIP_PRODUCTS[productId]?.tier : null,
    }),
  });

  return `paid ${amountCents} email=${customerEmail || "(none)"} product=${productId || "(none)"} agent=${agentId || "(none)"}`;
}

async function handleChargeRefunded(supabase: any, event: Stripe.Event): Promise<string> {
  const charge = event.data.object as any;
  const chargeId = charge.id;
  const paymentIntent = charge.payment_intent;
  const amountRefunded = charge.amount_refunded ?? 0;
  const amountTotal = charge.amount ?? 0;
  const isFullRefund = amountRefunded >= amountTotal;
  const reason = charge.refunds?.data?.[0]?.reason || null;

  const matchKey = paymentIntent || chargeId;

  await supabase
    .from("lead_purchases")
    .update({
      refunded_at: new Date().toISOString(),
      refund_amount_cents: amountRefunded,
      refund_reason: reason,
    })
    .eq("stripe_charge_id", matchKey);

  await fireAlert(supabase, {
    source: "stripe_webhook_lead_purchase",
    event_type: "stripe_refund",
    severity: isFullRefund ? "warn" : "info",
    subject: `Stripe REFUND $${amountRefunded / 100} (${isFullRefund ? "full" : "partial"}) — ${charge.billing_details?.email || charge.receipt_email || "unknown"}`,
    body: JSON.stringify({
      charge_id: chargeId, payment_intent: paymentIntent,
      amount_refunded: amountRefunded, amount_total: amountTotal,
      reason, customer: charge.customer, email: charge.billing_details?.email,
    }),
  });

  return `refunded ${amountRefunded} on ${chargeId} (full=${isFullRefund})`;
}

async function handleDispute(supabase: any, event: Stripe.Event): Promise<string> {
  const dispute = event.data.object as any;

  await supabase.from("stripe_disputes").upsert(
    {
      dispute_id: dispute.id,
      charge_id: dispute.charge,
      payment_intent: dispute.payment_intent || null,
      customer_id: dispute.customer || null,
      customer_email: dispute.evidence?.customer_email_address || null,
      amount_cents: dispute.amount,
      currency: dispute.currency,
      reason: dispute.reason,
      status: dispute.status,
      evidence_due_by: dispute.evidence_details?.due_by ? new Date(dispute.evidence_details.due_by * 1000).toISOString() : null,
      is_charge_refundable: dispute.is_charge_refundable ?? null,
      livemode: dispute.livemode ?? null,
      raw: dispute,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "dispute_id" },
  );

  // Flag the original charge as disputed
  if (dispute.charge) {
    await supabase
      .from("lead_purchases")
      .update({
        disputed_at: new Date().toISOString(),
        dispute_status: dispute.status,
        dispute_reason: dispute.reason,
      })
      .eq("stripe_charge_id", dispute.payment_intent || dispute.charge);
  }

  await fireAlert(supabase, {
    source: "stripe_webhook_lead_purchase",
    event_type: "stripe_dispute",
    severity: "critical",
    subject: `🚨 STRIPE DISPUTE ${dispute.status} — $${dispute.amount / 100} reason=${dispute.reason}`,
    body: JSON.stringify({
      dispute_id: dispute.id, charge_id: dispute.charge,
      amount: dispute.amount, reason: dispute.reason, status: dispute.status,
      evidence_due_by: dispute.evidence_details?.due_by,
      customer: dispute.customer,
    }),
  });

  return `dispute ${dispute.status} ${dispute.id} reason=${dispute.reason}`;
}

async function handleSubscriptionEvent(supabase: any, event: Stripe.Event): Promise<string> {
  const sub = event.data.object as any;

  // Idempotency pre-check. stripe_subscription_events has no unique index on
  // event_id (PK is the uuid `id`), so ON CONFLICT is unavailable here — an
  // upsert on event_id would raise 42P10. Pre-check instead so an at-least-once
  // redelivery cannot duplicate the row or re-fire the alert below.
  const { data: priorSubEvent } = await supabase
    .from("stripe_subscription_events")
    .select("id")
    .eq("event_id", event.id)
    .limit(1)
    .maybeSingle();
  if (priorSubEvent?.id) {
    return `sub ${event.type} ${sub.id} already recorded (idempotent replay)`;
  }

  const previous = (event.data as any).previous_attributes || {};
  const item = sub.items?.data?.[0];
  const productId = item?.price?.product || null;
  const priceId = item?.price?.id || null;
  const amountCents = item?.price?.unit_amount ?? null;
  let customerEmail: string | null = null;

  if (sub.customer) {
    try {
      const sk = Deno.env.get("STRIPE_SECRET_KEY")!;
      const resp = await fetch(`https://api.stripe.com/v1/customers/${sub.customer}`, {
        headers: { Authorization: `Bearer ${sk}` },
      });
      if (resp.ok) {
        const c = await resp.json();
        customerEmail = c.email || null;
      }
    } catch (e) {
      console.error("customer fetch failed", e);
    }
  }

  const { error: subInsertErr } = await supabase.from("stripe_subscription_events").insert({
    subscription_id: sub.id,
    customer_id: sub.customer || null,
    customer_email: customerEmail,
    product_id: productId,
    price_id: priceId,
    status: sub.status,
    previous_status: previous.status || null,
    current_period_end: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
    cancel_at: sub.cancel_at ? new Date(sub.cancel_at * 1000).toISOString() : null,
    canceled_at: sub.canceled_at ? new Date(sub.canceled_at * 1000).toISOString() : null,
    amount_cents: amountCents,
    event_type: event.type,
    event_id: event.id,
    event_created: new Date(((event.created as number) || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
    raw: sub,
  });
  // 23505 = the unique index landed after this deploy and a racing replay lost;
  // that means the row already exists, which is the outcome we wanted anyway.
  if (subInsertErr && subInsertErr.code !== "23505") {
    throw new Error(`stripe_subscription_events insert failed: ${subInsertErr.message}`);
  }
  if (subInsertErr) {
    return `sub ${event.type} ${sub.id} already recorded (concurrent replay)`;
  }

  const isCancelled = event.type === "customer.subscription.deleted" || sub.status === "canceled";
  const isPastDue = sub.status === "past_due" || sub.status === "unpaid";
  if (isCancelled || isPastDue) {
    await fireAlert(supabase, {
      source: "stripe_webhook_lead_purchase",
      event_type: isCancelled ? "stripe_sub_cancelled" : "stripe_sub_at_risk",
      severity: isCancelled ? "warn" : "warn",
      subject: `Stripe sub ${sub.status} — ${customerEmail || sub.customer} — $${(amountCents || 0) / 100}/mo`,
      body: JSON.stringify({
        subscription_id: sub.id, customer: sub.customer, email: customerEmail,
        status: sub.status, previous_status: previous.status,
        product_id: productId, price_id: priceId, amount_cents: amountCents,
      }),
    });
  }

  return `sub ${event.type} ${sub.id} status=${sub.status}`;
}

async function handlePaymentFailed(supabase: any, event: Stripe.Event): Promise<string> {
  const obj = event.data.object as any;
  const isInvoice = event.type === "invoice.payment_failed";

  // Idempotency pre-check — same reasoning as handleSubscriptionEvent:
  // stripe_failed_payments has no unique index on event_id (PK is the uuid
  // `id`), so ON CONFLICT is unavailable. Prod already carries one duplicate
  // pair from a redelivery 26s apart (evt_3Tb0erC3Khd8IPVm1fd8fnmY), so this
  // is a live defect, not a hypothetical one.
  const { data: priorFailed } = await supabase
    .from("stripe_failed_payments")
    .select("id")
    .eq("event_id", event.id)
    .limit(1)
    .maybeSingle();
  if (priorFailed?.id) {
    return `failed payment ${event.id} already recorded (idempotent replay)`;
  }

  // Stripe API ≥2024 moved invoice.subscription to invoice.parent.subscription_details.subscription
  const subId = isInvoice
    ? (obj.subscription || obj.parent?.subscription_details?.subscription || null)
    : null;

  const { error: failedInsertErr } = await supabase.from("stripe_failed_payments").insert({
    invoice_id: isInvoice ? obj.id : null,
    payment_intent: isInvoice ? obj.payment_intent : obj.id,
    customer_id: obj.customer || null,
    customer_email: obj.customer_email || obj.receipt_email || obj.billing_details?.email || null,
    subscription_id: subId,
    amount_due_cents: isInvoice ? obj.amount_due : obj.amount,
    attempt_count: isInvoice ? obj.attempt_count : 1,
    next_payment_attempt: isInvoice && obj.next_payment_attempt ? new Date(obj.next_payment_attempt * 1000).toISOString() : null,
    failure_code: obj.last_payment_error?.code || obj.failure_code || null,
    failure_message: obj.last_payment_error?.message || obj.failure_message || null,
    event_id: event.id,
    event_created: new Date(((event.created as number) || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
    raw: obj,
  });
  // 23505 = the unique index landed after this deploy and a racing replay lost;
  // that means the row already exists, which is the outcome we wanted anyway.
  if (failedInsertErr && failedInsertErr.code !== "23505") {
    throw new Error(`stripe_failed_payments insert failed: ${failedInsertErr.message}`);
  }
  if (failedInsertErr) {
    return `failed payment ${event.id} already recorded (concurrent replay)`;
  }

  const attemptCount = isInvoice ? (obj.attempt_count || 1) : 1;
  if (attemptCount >= 3) {
    await fireAlert(supabase, {
      source: "stripe_webhook_lead_purchase",
      event_type: "stripe_failed_payment",
      severity: "warn",
      subject: `Stripe payment failed (attempt ${attemptCount}) — ${obj.customer_email || obj.customer} — $${((isInvoice ? obj.amount_due : obj.amount) || 0) / 100}`,
      body: JSON.stringify({
        type: event.type, customer: obj.customer, email: obj.customer_email,
        subscription: obj.subscription, attempt_count: attemptCount,
        next_attempt: obj.next_payment_attempt, failure: obj.last_payment_error?.message,
      }),
    });
  }

  return `failed payment attempt=${attemptCount} customer=${obj.customer || "?"}`;
}

async function fireAlert(supabase: any, payload: any): Promise<void> {
  try {
    await supabase.from("bot_alerts").insert(payload);
  } catch (e) {
    console.error("bot_alerts insert failed", e);
  }
}
