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

    // MP-270: this loop used to fan every single SMS out to ALL 8 carrier gateways.
    // A phone belongs to exactly one carrier, so 7 of the 8 were guaranteed waste --
    // 8 Resend sends per SMS, ~32k sends/month, which is what exhausted the 50k
    // monthly quota and silently killed new-application notifications for 38 days.
    //
    // It also could not learn its way out. Resend accepts any well-formed address,
    // so every gateway reported success: 19,498 of 19,522 logged rows show all 8
    // "succeeding". The carrier bounce happens later and asynchronously and never
    // comes back here, so successCount never carried any delivery information.
    //
    // New rule: send to ONE gateway when the carrier is actually known. When it is
    // not known, send nothing and say so, so the caller can fall back to a channel
    // that reports real delivery. Do not guess by broadcasting.
    let knownCarrier: string | null = null;

    const { data: profileCarrier } = await supabase
      .from("profiles")
      .select("carrier")
      .eq("phone", phone)
      .not("carrier", "is", null)
      .maybeSingle();
    if (profileCarrier?.carrier) knownCarrier = String(profileCarrier.carrier).toLowerCase();

    if (!knownCarrier && applicationId) {
      const { data: appCarrier } = await supabase
        .from("applications")
        .select("carrier")
        .eq("id", applicationId)
        .not("carrier", "is", null)
        .maybeSingle();
      if (appCarrier?.carrier) knownCarrier = String(appCarrier.carrier).toLowerCase();
    }

    if (knownCarrier && !CARRIER_GATEWAYS[knownCarrier]) {
      results.push({ carrier: knownCarrier, success: false, error: "unrecognized carrier value" });
      knownCarrier = null;
    }

    if (knownCarrier) {
      await delay(500);
      const smsEmail = `${cleaned}@${CARRIER_GATEWAYS[knownCarrier]}`;
      try {
        const { error: sendError } = await resend.emails.send({
          from: "Apex Financial <notifications@apex-financial.org>",
          to: [smsEmail],
          subject: "",
          text: message.substring(0, 160),
        });
        const success = !sendError;
        results.push({ carrier: knownCarrier, success, error: sendError?.message });
        if (success) {
          successCount++;
          carrierSuccesses.push(knownCarrier);
        } else {
          carrierFailures.push(knownCarrier);
        }
      } catch (err: any) {
        results.push({ carrier: knownCarrier, success: false, error: err.message });
        carrierFailures.push(knownCarrier);
      }
    } else {
      // No carrier on file. Previously this was the 96% case that triggered the
      // 8-gateway broadcast. Report it honestly instead of burning quota on a guess.
      results.push({ carrier: "unknown", success: false, error: "no carrier on file — not broadcasting" });
    }

    // ONE consolidated notification_log row per outbound SMS.
    // MP-270: status now distinguishes "we had no carrier and sent nothing" from
    // "we sent to the right gateway and the provider rejected it". The old code
    // collapsed both into failed with a message about 8 gateways that no longer
    // reflects what this function does.
    const outcome = knownCarrier
      ? (successCount > 0 ? "sent" : "failed")
      : "skipped";

    await logNotification(supabase, {
      recipient_phone: phone,
      channel: "sms-auto",
      title: "SMS Auto-Detect",
      message: message.substring(0, 160),
      status: outcome,
      error_message: outcome === "sent"
        ? null
        : (knownCarrier
            ? `Carrier gateway ${knownCarrier} rejected: ${results[results.length - 1]?.error ?? "unknown"}`
            : "No carrier on file — SMS not attempted, use another channel"),
      metadata: {
        trigger: "sms-auto-detect",
        gatewaysAttempted: knownCarrier ? 1 : 0,
        carrierResolved: knownCarrier,
        carrierSuccesses,
        carrierFailures,
        attempts: results,
        // Gateway acceptance is not delivery. The carrier bounce is asynchronous
        // and never reaches this function, so never read "sent" here as "arrived".
        deliveryConfirmed: false,
        applicationId: applicationId || null,
        agedLeadId: agedLeadId || null,
      },
    });

    // MP-270: only persist a carrier we actually resolved from stored data.
    // The old code sorted carrierSuccesses by CARRIER_PRIORITY and saved the winner,
    // but since all 8 gateways always "succeeded" that reduced to writing "att"
    // onto essentially every record it touched.
    let carrierSelected: string | null = null;

    if (knownCarrier && carrierSuccesses.length > 0) {
      carrierSelected = knownCarrier;

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

    // MP-270: this admin copy was ungated, so it fired on every attempt including
    // the ~96% with no carrier on file. Combined with the 8-gateway broadcast that
    // made 9 Resend sends per single SMS. Only copy admin when a send actually went out.
    if (outcome === "sent") {
      try {
        await resend.emails.send({
          from: "Apex Financial <notifications@apex-financial.org>",
          to: [ADMIN_EMAIL],
          subject: `[SMS Copy] To: ${phone}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h3 style="color: #3b82f6;">SMS Auto-Detect Copy</h3>
              <p><strong>To:</strong> ${phone}</p>
              <p><strong>Carrier gateway used:</strong> ${carrierSelected || "unknown"}</p>
              <p style="color:#b45309;"><strong>Note:</strong> the gateway accepted this message. Carrier delivery is not confirmed.</p>
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
    }

    console.log(`SMS auto-detect for ${phone}: outcome=${outcome}, carrier=${carrierSelected || "none"}, gatewaysAttempted=${knownCarrier ? 1 : 0}`);

    return new Response(
      JSON.stringify({
        success: successCount > 0,
        // MP-270: callers should branch on this. "skipped" means no carrier was on
        // file and nothing was sent, so fall back to email/Telegram rather than
        // treating the person as contacted.
        outcome,
        deliveryConfirmed: false,
        phone,
        attempts: results,
        successCount,
        totalAttempts: knownCarrier ? 1 : 0,
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
