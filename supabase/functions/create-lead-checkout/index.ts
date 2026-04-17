import Stripe from "https://esm.sh/stripe@18.5.0";
import { createHandler } from "../_shared/handler.ts";
import { jsonResponse, errorResponse } from "../_shared/cors.ts";
import { parseBody, v } from "../_shared/validate.ts";

const PRICE_MAP: Record<string, string> = {
  gold: "price_1TKmDqC3Khd8IPVmNDSHuNu7",
  platinum: "price_1TKmLhC3Khd8IPVmoAMmtBuM",
};

const TIERS = ["gold", "platinum"] as const;
const BodySchema = v.object({ tier: v.enum(TIERS) });

Deno.serve(
  createHandler(
    {
      functionName: "create-lead-checkout",
      requireAuth: true,
      // 10 checkout sessions per user per minute is plenty
      rateLimit: { maxRequests: 10, windowSeconds: 60 },
    },
    async (req, { auth }) => {
      const { tier } = await parseBody(req, BodySchema);
      const priceId = PRICE_MAP[tier];

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
        success_url: `${origin}/purchase-leads?success=true`,
        cancel_url: `${origin}/purchase-leads?canceled=true`,
        metadata: { user_id: auth!.userId, tier },
      });

      return jsonResponse({ url: session.url });
    }
  )
);
