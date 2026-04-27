// create-lead-checkout — single Stripe Checkout entry point for ALL 4 offers.
// Every SKU is a recurring monthly subscription.
//
// SKUs (legacy "tier" alias kept for back-compat with the old PurchaseLeads page):
//   gold              — $250/month (Gold Leads)
//   platinum          — $500/month (Platinum Vet Leads)
//   auto_dm           — $250/month (Auto-DM Engine)
//   social_growth     — $500/month (Full Social Media Growth Suite)
//
// Optional body params:
//   agent_id          — manager purchasing on behalf of an agent on their team
//
// Price IDs come from env first, then fall back to the constants so the
// Stripe-driven provisioning script can drop fresh IDs in without a redeploy.

import Stripe from "https://esm.sh/stripe@18.5.0";
import { createHandler } from "../_shared/handler.ts";
import { jsonResponse, errorResponse } from "../_shared/cors.ts";

type Sku = "gold" | "platinum" | "auto_dm" | "social_growth";

interface OfferDef {
  priceEnv: string;
  priceFallback: string;
  packageName: string;
}

// All four offers are recurring monthly subscriptions on Sam's live Stripe account
// (acct_1TKTj3C3Khd8IPVm). Price IDs were provisioned 2026-04-27 by
// /tmp/stripe-driver/provision.mjs and are committed here as defaults so the
// flow works without any env-var setup. STRIPE_PRICE_* env vars override.
const OFFERS: Record<Sku, OfferDef> = {
  gold: {
    priceEnv: "STRIPE_PRICE_GOLD",
    priceFallback: "price_1TQkuOC3Khd8IPVmYoVGohFF", // $250/mo
    packageName: "Gold Leads (Standard)",
  },
  platinum: {
    priceEnv: "STRIPE_PRICE_PLATINUM",
    priceFallback: "price_1TQktTC3Khd8IPVmcZlMGdAC", // $500/mo
    packageName: "Platinum Vet Leads",
  },
  auto_dm: {
    priceEnv: "STRIPE_PRICE_AUTO_DM",
    priceFallback: "price_1TQkuQC3Khd8IPVmp8orL6ZF", // $250/mo
    packageName: "Auto-DM Engine",
  },
  social_growth: {
    priceEnv: "STRIPE_PRICE_SOCIAL_GROWTH",
    priceFallback: "price_1TQkuRC3Khd8IPVmA4ewp2Kc", // $500/mo
    packageName: "Full Social Media Growth Suite",
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

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        customer_email: customerId ? undefined : email,
        line_items: [{ price: priceId, quantity: 1 }],
        mode: "subscription",
        success_url: `${origin}/purchase-leads?success=true&sku=${sku}`,
        cancel_url: `${origin}/purchase-leads?canceled=true&sku=${sku}`,
        metadata: {
          user_id: auth!.userId,
          sku,
          tier: sku, // legacy alias for the existing webhook
          package_name: offer.packageName,
          agent_id: agentId ?? "",
        },
        // Subscription metadata propagates to the subscription object too,
        // so cancellation events still resolve back to the right purchaser.
        subscription_data: {
          metadata: {
            user_id: auth!.userId,
            sku,
            package_name: offer.packageName,
            agent_id: agentId ?? "",
          },
        },
      });

      return jsonResponse({ url: session.url, sku, mode: "subscription" });
    },
  ),
);
