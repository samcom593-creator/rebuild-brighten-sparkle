// create-lead-checkout — single Stripe Checkout entry point for ALL 7 offers.
// Mode (subscription vs one-time payment) is per-SKU; full table is below.
//
// Optional body params:
//   agent_id          — manager purchasing on behalf of an agent on their team
//
// Price IDs come from env first, then fall back to the constants so the
// Stripe-driven provisioning script can drop fresh IDs in without a redeploy.

import Stripe from "https://esm.sh/stripe@18.5.0";
import { createHandler } from "../_shared/handler.ts";
import { jsonResponse, errorResponse } from "../_shared/cors.ts";

type Sku =
  | "gold"
  | "platinum"
  | "auto_dm"
  | "social_growth"
  | "fitness_reset"
  | "kingofsales_course"
  | "work_with_sam";

interface OfferDef {
  priceEnv: string;
  priceFallback: string;
  mode: "subscription" | "payment";
  packageName: string;
}

// Live Stripe (acct_1TKTj3C3Khd8IPVm). 7 SKUs across 5 categories:
//   leads:        gold ($250/wk sub), platinum ($500/wk sub)
//   social:       auto_dm ($250/mo sub), social_growth ($500/mo sub)
//   fitness:      fitness_reset ($97 one-time)
//   course:       kingofsales_course ($497 one-time)
//   high_ticket:  work_with_sam ($5,000 one-time, Sam personally vets)
// STRIPE_PRICE_* env vars override the fallbacks if set.
const OFFERS: Record<Sku, OfferDef> = {
  gold: {
    priceEnv: "STRIPE_PRICE_GOLD",
    priceFallback: "price_1TKmDqC3Khd8IPVmNDSHuNu7", // $250/wk
    mode: "subscription",
    packageName: "Gold Leads (Standard)",
  },
  platinum: {
    priceEnv: "STRIPE_PRICE_PLATINUM",
    priceFallback: "price_1TKmLhC3Khd8IPVmoAMmtBuM", // $500/wk
    mode: "subscription",
    packageName: "Platinum Vet Leads",
  },
  auto_dm: {
    priceEnv: "STRIPE_PRICE_AUTO_DM",
    priceFallback: "price_1TQkuQC3Khd8IPVmp8orL6ZF", // $250/mo
    mode: "subscription",
    packageName: "Auto-DM Engine",
  },
  social_growth: {
    priceEnv: "STRIPE_PRICE_SOCIAL_GROWTH",
    priceFallback: "price_1TQkuRC3Khd8IPVmA4ewp2Kc", // $500/mo
    mode: "subscription",
    packageName: "Full Social Media Growth Suite",
  },
  fitness_reset: {
    priceEnv: "STRIPE_PRICE_FITNESS_RESET",
    priceFallback: "price_1TQlfnC3Khd8IPVmbCUj02rt", // $97 one-time
    mode: "payment",
    packageName: "Fitness Reset Blueprint",
  },
  kingofsales_course: {
    priceEnv: "STRIPE_PRICE_KOS_COURSE",
    priceFallback: "price_1TQlfoC3Khd8IPVmF8xRkzki", // $497 one-time
    mode: "payment",
    packageName: "King of Sales Course",
  },
  work_with_sam: {
    priceEnv: "STRIPE_PRICE_WORK_WITH_SAM",
    priceFallback: "price_1TQlfpC3Khd8IPVmj6ZAH05l", // $5,000 one-time
    mode: "payment",
    packageName: "1:1 Work With Sam",
  },
};

const SKUS = Object.keys(OFFERS) as Sku[];

Deno.serve(
  createHandler(
    {
      functionName: "create-lead-checkout",
      requireAuth: true,
      rateLimit: { maxRequests: 10, windowSeconds: 60 },
    },
    async (req, { auth }) => {
      let raw: any = {};
      try { raw = await req.json(); } catch { /* empty body OK */ }

      const sku = (raw.sku ?? raw.tier) as Sku | undefined;
      if (!sku || !SKUS.includes(sku)) {
        return errorResponse(`sku must be one of: ${SKUS.join(", ")}`, 400, "BAD_SKU");
      }
      const agentId = typeof raw.agent_id === "string" && raw.agent_id ? raw.agent_id : null;

      const offer = OFFERS[sku];
      const priceId = Deno.env.get(offer.priceEnv) || offer.priceFallback;
      if (!priceId) {
        return errorResponse(
          `Stripe price not configured for ${sku}. Set ${offer.priceEnv}.`,
          500,
          "PRICE_NOT_CONFIGURED",
        );
      }

      const email = auth!.email;
      if (!email) return errorResponse("User has no email on record", 400, "NO_EMAIL");

      const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
        apiVersion: "2025-08-27.basil",
      });

      const customers = await stripe.customers.list({ email, limit: 1 });
      const customerId = customers.data[0]?.id;

      const origin = req.headers.get("origin") || "https://rebuild-brighten-sparkle.lovable.app";

      const baseMetadata = {
        user_id: auth!.userId,
        sku,
        tier: sku, // legacy alias for the existing webhook
        package_name: offer.packageName,
        agent_id: agentId ?? "",
      };

      // Sam wants every payment method enabled. Stripe filters to ones valid
      // for the chosen mode + region (e.g. Klarna/Afterpay for one-time only).
      const subscriptionMethods = ["card", "us_bank_account", "link", "cashapp"];
      const oneTimeMethods = [
        "card",
        "us_bank_account",
        "link",
        "cashapp",
        "afterpay_clearpay",
        "klarna",
        "amazon_pay",
      ];

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        customer_email: customerId ? undefined : email,
        line_items: [{ price: priceId, quantity: 1 }],
        mode: offer.mode,
        payment_method_types: offer.mode === "subscription" ? subscriptionMethods : oneTimeMethods,
        success_url: `${origin}/purchase-leads?success=true&sku=${sku}`,
        cancel_url: `${origin}/purchase-leads?canceled=true&sku=${sku}`,
        metadata: baseMetadata,
        // Only attach mode-specific data blocks. Stripe rejects payment_intent_data
        // on subscription mode and subscription_data on payment mode.
        ...(offer.mode === "subscription"
          ? { subscription_data: { metadata: baseMetadata } }
          : { payment_intent_data: { metadata: baseMetadata } }),
      });

      return jsonResponse({ url: session.url, sku, mode: offer.mode });
    },
  ),
);
