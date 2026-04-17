import { createHandler } from "../_shared/handler.ts";
import { jsonResponse } from "../_shared/cors.ts";
import { parseBody, v } from "../_shared/validate.ts";

const BodySchema = v.object({
  to: v.string({ required: true, min: 7, max: 32 }),
  message: v.string({ max: 4096 }),
  templateName: v.string({ max: 128 }),
  templateParams: v.any(),
});

Deno.serve(
  createHandler(
    {
      functionName: "send-whatsapp",
      // External provider — protect against floods
      rateLimit: { maxRequests: 60, windowSeconds: 60 },
    },
    async (req) => {
      const WHATSAPP_TOKEN = Deno.env.get("META_WHATSAPP_TOKEN");
      const PHONE_NUMBER_ID = Deno.env.get("META_WHATSAPP_PHONE_ID");

      const { to, message, templateName, templateParams } = await parseBody(req, BodySchema);

      // Fall back to SMS if WhatsApp not configured
      if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

        const smsRes = await fetch(`${supabaseUrl}/functions/v1/send-sms-auto-detect`, {
          method: "POST",
          headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ to, message }),
        });

        const smsResult = await smsRes.json();
        return jsonResponse({ fallback: "sms", ...smsResult });
      }

      // Clean phone number
      const phone = to.replace(/\D/g, "").replace(/^1/, "");
      const fullPhone = `1${phone}`;

      const body = templateName
        ? {
            messaging_product: "whatsapp",
            to: fullPhone,
            type: "template",
            template: {
              name: templateName,
              language: { code: "en_US" },
              components: templateParams || [],
            },
          }
        : {
            messaging_product: "whatsapp",
            to: fullPhone,
            type: "text",
            text: { body: message },
          };

      const response = await fetch(
        `https://graph.facebook.com/v18.0/${encodeURIComponent(PHONE_NUMBER_ID)}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${WHATSAPP_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        }
      );

      const result = await response.json();
      return jsonResponse(result, response.ok ? 200 : response.status);
    }
  )
);
