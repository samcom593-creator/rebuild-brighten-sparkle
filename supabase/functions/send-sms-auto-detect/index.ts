import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import { Resend } from "https://esm.sh/resend@2.0.0";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ADMIN_EMAIL = "sam@apex-financial.org";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CARRIER_GATEWAYS: Record<string, string> = {
  att: "txt.att.net",
  verizon: "vtext.com",
  tmobile: "tmomail.net",
  sprint: "messaging.sprintpcs.com",
  uscellular: "email.uscc.net",
  cricket: "sms.cricketwireless.net",
  metro: "mymetropcs.com",
  boost: "sms.myboostmobile.com",
};

const CARRIER_PRIORITY: Record<string, number> = {
  att: 100,
  verizon: 95,
  tmobile: 90,
  sprint: 80,
  uscellular: 70,
  cricket: 60,
  metro: 50,
  boost: 40,
};

const CARRIER_KEYS = Object.keys(CARRIER_GATEWAYS);

function cleanPhone(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function logNotification(supabase: any, data: any) {
  try {
    await supabase.from("notification_log").insert(data);
  } catch (e) {
    console.error("Log failed:", e);
  }
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { phone, message, applicationId, agedLeadId } = await req.json();

    if (!phone || !message) {
      return new Response(
        JSON.stringify({ error: "phone and message are required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const cleaned = cleanPhone(phone);
    if (cleaned.length !== 10) {
      return new Response(
        JSON.stringify({ error: "Invalid phone number — must be 10 digits" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });
    const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

    const results: { carrier: string; success: boolean; error?: string }[] = [];
    let successCount = 0;
    const carrierSuccesses: string[] = [];
    const carrierFailures: string[] = [];

    for (const carrier of CARRIER_KEYS) {
      const gateway = CARRIER_GATEWAYS[carrier];
      const smsEmail = `${cleaned}@${gateway}`;

      try {
        const { error: sendError } = await resend.emails.send({
          from: "Apex Financial <notifications@apex-financial.org>",
          to: [smsEmail],
          subject: "",
          text: message.substring(0, 160),
        });

        const success = !sendError;
        results.push({ carrier, success, error: sendError?.message });

        if (success) {
          successCount++;
          carrierSuccesses.push(carrier);
        } else {
          carrierFailures.push(carrier);
        }

        await logNotification(supabase, {
          recipient_phone: phone,
          channel: "sms-auto",
          title: "SMS Auto-Detect",
          message: message.substring(0, 160),
          status: success ? "sent" : "failed",
          error_message: sendError?.message || null,
          metadata: {
            trigger: "sms-auto-detect",
            carrier,
            gateway: smsEmail,
            applicationId: applicationId || null,
            agedLeadId: agedLeadId || null,
          },
        });
      } catch (err: any) {
        results.push({ carrier, success: false, error: err.message });
        carrierFailures.push(carrier);
      }

      await delay(1000);
    }

    // Auto-save best-guess carrier
    let carrierSelected: string | null = null;

    if (carrierSuccesses.length > 0) {
      carrierSelected = carrierSuccesses.sort(
        (a, b) => (CARRIER_PRIORITY[b] || 0) - (CARRIER_PRIORITY[a] || 0)
      )[0];

      if (applicationId && carrierSelected) {
        try {
          const { data: app } = await supabase
            .from("applications")
            .select("carrier")
            .eq("id", applicationId)
            .maybeSingle();

          if (app && !app.carrier) {
            await supabase
              .from("applications")
              .update({ carrier: carrierSelected })
              .eq("id", applicationId);
            console.log(`Auto-saved carrier "${carrierSelected}" for application ${applicationId}`);
          }
        } catch (err: any) {
          console.error("Failed to auto-save carrier:", err.message);
        }
      }
    }

    // Send admin a CC email with the SMS content so they know it was sent
    try {
      await resend.emails.send({
        from: "Apex Financial <notifications@apex-financial.org>",
        to: [ADMIN_EMAIL],
        subject: `[SMS Copy] To: ${phone}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h3 style="color: #3b82f6;">SMS Auto-Detect Copy</h3>
            <p><strong>To:</strong> ${phone}</p>
            <p><strong>Gateways attempted:</strong> ${CARRIER_KEYS.length}</p>
            <p><strong>Accepted by:</strong> ${carrierSuccesses.join(", ") || "none"}</p>
            <p><strong>Best guess carrier:</strong> ${carrierSelected || "unknown"}</p>
            <div style="background: #f3f4f6; padding: 12px; border-radius: 8px; margin: 12px 0;">
              <p style="margin: 0;">"${message.substring(0, 160)}"</p>
            </div>
            <p style="color: #9ca3af; font-size: 12px;">Powered by Apex Financial</p>
          </div>
        `,
      });
    } catch (e) {
      console.error("Failed to send admin SMS copy email:", e);
    }

    console.log(`SMS auto-detect for ${phone}: ${successCount}/${CARRIER_KEYS.length} gateways accepted. Best guess: ${carrierSelected || "none"}`);

    return new Response(
      JSON.stringify({
        success: successCount > 0,
        phone,
        attempts: results,
        successCount,
        totalAttempts: CARRIER_KEYS.length,
        carrierSelected,
        carrierSuccesses,
        carrierFailures,
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in send-sms-auto-detect:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
