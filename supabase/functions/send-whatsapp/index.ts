import { createHandler } from "../_shared/handler.ts";
import { jsonResponse } from "../_shared/cors.ts";
import { parseBody, v } from "../_shared/validate.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const BodySchema = v.object({
  to: v.string({ required: true, min: 7, max: 32 }),
  message: v.string({ max: 4096 }),
  templateName: v.string({ max: 128 }),
  templateParams: v.any(),
});

// Look up Meta secrets from env first (the standard path), then from
// system_settings (so Sam can store the token via bot-sql without needing
// access to the edge-function secrets UI). Cached across invocations in
// the module scope so we only hit the DB once per cold-start.
let cachedToken: string | null | undefined;
let cachedPhoneId: string | null | undefined;

async function resolveMetaSecrets(): Promise<{ token: string | null; phoneId: string | null }> {
  if (cachedToken !== undefined && cachedPhoneId !== undefined) {
    return { token: cachedToken, phoneId: cachedPhoneId };
  }
  cachedToken  = Deno.env.get("META_WHATSAPP_TOKEN")    ?? null;
  cachedPhoneId = Deno.env.get("META_WHATSAPP_PHONE_ID") ?? null;

  if (!cachedToken || !cachedPhoneId) {
    try {
      const sb = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
        { auth: { persistSession: false } });
      const { data } = await sb.from("system_settings").select("key,value")
        .in("key", ["meta_whatsapp_token","meta_whatsapp_phone_id"]);
      for (const row of data ?? []) {
        if (row.key === "meta_whatsapp_token" && !cachedToken && row.value) cachedToken = row.value;
        if (row.key === "meta_whatsapp_phone_id" && !cachedPhoneId && row.value) cachedPhoneId = row.value;
      }
    } catch (_) { /* settings read failed; stick with env-only */ }
  }
  return { token: cachedToken, phoneId: cachedPhoneId };
}

Deno.serve(
  createHandler(
    {
      functionName: "send-whatsapp",
      // External provider — protect against floods
      rateLimit: { maxRequests: 60, windowSeconds: 60 },
    },
    async (req) => {
      const { token: WHATSAPP_TOKEN, phoneId: PHONE_NUMBER_ID } = await resolveMetaSecrets();

      const { to, message, templateName, templateParams } = await parseBody(req, BodySchema);

      // Fall back to SMS if WhatsApp not configured
      if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

        const smsRes = await fetch(`${supabaseUrl}/functions/v1/send-sms-auto-detect`, {
          method: "POST",
          headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ phone: to, message }),  // downstream expects `phone`
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
