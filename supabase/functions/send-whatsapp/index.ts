const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const WHATSAPP_TOKEN = Deno.env.get("META_WHATSAPP_TOKEN");
    const PHONE_NUMBER_ID = Deno.env.get("META_WHATSAPP_PHONE_ID");

    if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
      // Fall back to SMS if WhatsApp not configured
      const { to, message } = await req.json();
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

      const smsRes = await fetch(`${supabaseUrl}/functions/v1/send-sms-auto-detect`, {
        method: "POST",
        headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ to, message }),
      });

      const smsResult = await smsRes.json();
      return new Response(JSON.stringify({ fallback: "sms", ...smsResult }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { to, message, templateName, templateParams } = await req.json();

    // Clean phone number
    const phone = to.replace(/\D/g, "").replace(/^1/, "");
    const fullPhone = `1${phone}`;

    let body: any;

    if (templateName) {
      body = {
        messaging_product: "whatsapp",
        to: fullPhone,
        type: "template",
        template: {
          name: templateName,
          language: { code: "en_US" },
          components: templateParams || [],
        },
      };
    } else {
      body = {
        messaging_product: "whatsapp",
        to: fullPhone,
        type: "text",
        text: { body: message },
      };
    }

    const response = await fetch(
      `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
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
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
