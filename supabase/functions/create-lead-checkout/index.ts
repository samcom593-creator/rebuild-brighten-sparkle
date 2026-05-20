import Stripe from "https://esm.sh/stripe@18.5.0";
import { createHandler } from "../_shared/handler.ts";
import { jsonResponse, errorResponse } from "../_shared/cors.ts";
import { parseBody, v } from "../_shared/validate.ts";

// Sam 2026-04-27: extended from 2 → 7 SKUs (full catalog from
// sam_full_offer_catalog.md). `mode` is subscription for recurring SKUs,
// payment for one-time. Body accepts `tier` (legacy) or `sku` (new).
type SkuConfig = { priceId: string; mode: "subscription" | "payment"; expectedAmountCents?: number; leadPackageType?: "standard" | "premium" };
const SKU_MAP: Record<string, SkuConfig> = {
  gold:               { priceId: "price_1TKmDqC3Khd8IPVmNDSHuNu7", mode: "subscription", expectedAmountCents: 25_000, leadPackageType: "standard" },
  platinum:           { priceId: "price_1TKmLhC3Khd8IPVmoAMmtBuM", mode: "subscription", expectedAmountCents: 50_000, leadPackageType: "premium" },
  auto_dm:            { priceId: "price_1TQkuQC3Khd8IPVmp8orL6ZF", mode: "subscription" },
  social_growth:      { priceId: "price_1TQkuRC3Khd8IPVmA4ewp2Kc", mode: "subscription" },
  fitness_reset:      { priceId: "price_1TQlfnC3Khd8IPVmbCUj02rt", mode: "payment"      },
  kingofsales_course: { priceId: "price_1TQlfoC3Khd8IPVmF8xRkzki", mode: "payment"      },
  work_with_sam:      { priceId: "price_1TQlfpC3Khd8IPVmj6ZAH05l", mode: "payment"      },
};

const TIERS = ["gold", "platinum", "auto_dm", "social_growth", "fitness_reset", "kingofsales_course", "work_with_sam"] as const;
const BodySchema = v.object({ tier: v.enum(TIERS).optional(), sku: v.enum(TIERS).optional() });

Deno.serve(
  createHandler(
    {
      functionName: "create-lead-checkout",
      requireAuth: true,
      // 10 checkout sessions per user per minute is plenty
      rateLimit: { maxRequests: 10, windowSeconds: 60 },
    },
    async (req, { auth }) => {
      const body = await parseBody(req, BodySchema);
      const tier = body.tier ?? body.sku;
      if (!tier) return errorResponse("missing tier/sku in body", 400, "MISSING_TIER");
      const config = SKU_MAP[tier];
      if (!config) return errorResponse(`unknown tier: ${tier}`, 400, "UNKNOWN_TIER");

      const email = auth!.email;
      if (!email) return errorResponse("User has no email on record", 400, "NO_EMAIL");

      const leadPackageType = config.leadPackageType ?? null;
      let agentId: string | null = null;
      let requestId: string | null = null;

      if (leadPackageType) {
        const { data: agent, error: agentError } = await auth!.serviceClient
          .from("agents")
          .select("id")
          .eq("user_id", auth!.userId)
          .maybeSingle();

        if (agentError) return errorResponse(agentError.message, 500, "AGENT_LOOKUP_FAILED");
        if (!agent?.id) {
          return errorResponse("No agent profile is linked to this login. Ask Sam to connect your account before buying leads.", 400, "NO_AGENT_PROFILE");
        }

        agentId = agent.id;
        const { data: requestRow, error: requestError } = await auth!.serviceClient
          .from("lead_purchase_requests")
          .insert({
            agent_id: agentId,
            package_type: leadPackageType,
            payment_method: "stripe",
            status: "pending",
            notes: `Checkout started for ${tier}${config.expectedAmountCents ? ` ($${config.expectedAmountCents / 100})` : ""}`,
          })
          .select("id")
          .single();

        if (requestError) return errorResponse(requestError.message, 500, "LEAD_REQUEST_CREATE_FAILED");
        requestId = requestRow.id;
      }

      const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");
      if (!stripeSecret) return errorResponse("Stripe secret key is not configured", 500, "STRIPE_SECRET_MISSING");

      const stripe = new Stripe(stripeSecret, {
        apiVersion: "2025-08-27.basil",
      });

      // CFO Bot 2026-05-20 — ALWAYS upsert the Stripe customer upfront.
      // Without this, passing only `customer_email` lets Stripe mint a brand
      // new Stripe customer every time the user reaches the hosted checkout
      // page. Bowman 4×, Wendell 3×, Isaac 3×, Christopher 2×, Xaviar 2×,
      // Castellanos 2×, bowmangrey 3 customers in 2 min 44s on 2026-05-04
      // all came from this race. Looking up by email + creating-if-missing
      // collapses the human to a single customer_id so subsequent idempotency
      // (and human-readable reconciliation) actually works.
      const customers = await stripe.customers.list({ email, limit: 1 });
      let customerId = customers.data[0]?.id;
      if (!customerId) {
        const created = await stripe.customers.create({
          email,
          metadata: { user_id: auth!.userId, created_by: "create-lead-checkout" },
        });
        customerId = created.id;
      }

      // CFO Bot 2026-05-20 — idempotency gate. Before opening a new Checkout
      // Session, refuse if this customer already has an active/past_due/trialing
      // sub (subscription mode) or any successful one-time charge (payment mode)
      // for the same Stripe price. Stops the Wendell/Creese/Christopher/Bowman/
      // Isaac duplicate-sub bleed at the source.
      {
        if (config.mode === "subscription") {
          const existingSubs = await stripe.subscriptions.list({
            customer: customerId,
            price: config.priceId,
            status: "all",
            limit: 10,
          });
          const live = existingSubs.data.find((s: Stripe.Subscription) =>
            ["active", "trialing", "past_due", "unpaid"].includes(s.status)
          );
          if (live) {
            return errorResponse(
              `You already have an active subscription to ${tier}. Manage or cancel it from your Stripe billing portal — opening a new checkout would create a duplicate charge.`,
              409,
              "DUPLICATE_SUBSCRIPTION",
              { existing_subscription_id: live.id, status: live.status, current_period_end: live.current_period_end }
            );
          }
        } else if (config.mode === "payment" && config.expectedAmountCents) {
          // For one-time payments, refuse if a successful charge for the same
          // amount has happened in the last 24h (cheap dedup heuristic — a real
          // repurchase a day later is fine, a double-click is not).
          const recentCharges = await stripe.charges.list({
            customer: customerId,
            limit: 20,
            created: { gte: Math.floor(Date.now() / 1000) - 24 * 60 * 60 },
          });
          const dupCharge = recentCharges.data.find(
            (c: Stripe.Charge) => c.status === "succeeded" && c.amount === config.expectedAmountCents && !c.refunded
          );
          if (dupCharge) {
            return errorResponse(
              `You already purchased ${tier} in the last 24 hours. Check your email for the receipt. If you intended to buy a second copy, please reach out to support.`,
              409,
              "DUPLICATE_PAYMENT",
              { existing_charge_id: dupCharge.id, amount_cents: dupCharge.amount, charged_at: dupCharge.created }
            );
          }
        }
      }

      const origin = req.headers.get("origin") || "https://apex-financial.org";
      const successPath = config.mode === "subscription" ? "/purchase-leads" : "/dashboard";

      // CFO Bot 2026-05-20 — Stripe idempotency-key on session create.
      // 2 rapid clicks within the same 10-minute window collapse to the same
      // Checkout Session (Stripe replays the response). Belt-and-suspenders
      // against the dup-customer race even if checkout completes mid-click.
      const idemBucket = Math.floor(Date.now() / (10 * 60 * 1000));
      const idempotencyKey = `clc:${auth!.userId}:${tier}:${idemBucket}`;

      const session = await stripe.checkout.sessions.create(
        {
          customer: customerId,
          line_items: [{ price: config.priceId, quantity: 1 }],
          mode: config.mode,
          allow_promotion_codes: true,
          success_url: `${origin}${successPath}?success=true&sku=${tier}`,
          cancel_url: `${origin}${successPath}?canceled=true&sku=${tier}`,
          metadata: {
            user_id: auth!.userId,
            tier,
            sku: tier,
            agent_id: agentId ?? "",
            package_type: leadPackageType ?? "",
            lead_purchase_request_id: requestId ?? "",
            expected_amount_cents: config.expectedAmountCents ? String(config.expectedAmountCents) : "",
          },
        },
        { idempotencyKey }
      );

      if (requestId) {
        await auth!.serviceClient
          .from("lead_purchase_requests")
          .update({ transaction_id: session.id })
          .eq("id", requestId);
      }

      return jsonResponse({ url: session.url, requestId });
    }
  )
);
