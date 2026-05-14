import Stripe from "https://esm.sh/stripe@18.5.0";
import { createHandler } from "../_shared/handler.ts";
import { jsonResponse, errorResponse } from "../_shared/cors.ts";
import { parseBody, v } from "../_shared/validate.ts";

// Sam 2026-04-27: extended from 2 → 7 SKUs (full catalog from
// sam_full_offer_catalog.md). `mode` is subscription for recurring SKUs,
// payment for one-time. Body accepts `tier` (legacy) or `sku` (new).
type SkuConfig = { priceId: string; mode: "subscription" | "payment" };
const SKU_MAP: Record<string, SkuConfig> = {
  gold:               { priceId: "price_1TKmDqC3Khd8IPVmNDSHuNu7", mode: "subscription" },
  platinum:           { priceId: "price_1TKmLhC3Khd8IPVmoAMmtBuM", mode: "subscription" },
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

      const leadPackageType = tier === "gold" ? "standard" : tier === "platinum" ? "premium" : null;
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
            notes: `Checkout started for ${tier}`,
          })
          .select("id")
          .single();

        if (requestError) return errorResponse(requestError.message, 500, "LEAD_REQUEST_CREATE_FAILED");
        requestId = requestRow.id;
      }

      const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
        apiVersion: "2025-08-27.basil",
      });

      const customers = await stripe.customers.list({ email, limit: 1 });
      const customerId = customers.data[0]?.id;

      const origin = req.headers.get("origin") || "https://apex-financial.org";
      const successPath = config.mode === "subscription" ? "/purchase-leads" : "/dashboard";

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        customer_email: customerId ? undefined : email,
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
        },
      });

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
