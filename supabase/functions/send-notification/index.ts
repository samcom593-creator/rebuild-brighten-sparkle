import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import { Resend } from "https://esm.sh/resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { userId, title, message, url, email } = await req.json();

    if (!userId && !email) {
      return new Response(
        JSON.stringify({ error: "userId or email is required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const results = { push: false, sms: false, email: false };

    // Resolve profile info
    let profileData: any = null;
    if (userId) {
      const { data } = await supabase
        .from("profiles")
        .select("email, phone, carrier")
        .eq("user_id", userId)
        .single();
      profileData = data;
    }

    const recipientEmail = email || profileData?.email;

    // 1. Try push notification
    if (userId) {
      try {
        const pushResponse = await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({ userId, title, body: message, url }),
        });
        const pushResult = await pushResponse.json();
        results.push = pushResult.sent > 0;
      } catch (err) {
        console.error("Push notification failed:", err);
      }
    }

    // 2. Try SMS via email gateway
    if (profileData?.phone && profileData?.carrier) {
      const gateway = CARRIER_GATEWAYS[profileData.carrier];
      if (gateway) {
        const cleanedPhone = profileData.phone.replace(/\D/g, "").slice(-10);
        if (cleanedPhone.length === 10) {
          try {
            const smsEmail = `${cleanedPhone}@${gateway}`;
            await resend.emails.send({
              from: "Apex Financial <notifications@apex-financial.org>",
              to: [smsEmail],
              subject: "",
              text: `${title}: ${message}`.substring(0, 160),
            });
            results.sms = true;
          } catch (err) {
            console.error("SMS via email failed:", err);
          }
        }
      }
    }

    // 3. Fallback to email (always send if we have an email)
    if (recipientEmail && !results.push && !results.sms) {
      try {
        await resend.emails.send({
          from: "Apex Financial <notifications@apex-financial.org>",
          to: [recipientEmail],
          subject: title || "Apex Financial Notification",
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #3b82f6;">${title || "Notification"}</h2>
              <p>${message}</p>
              ${url ? `<p><a href="${url}" style="color: #3b82f6;">View Details →</a></p>` : ""}
              <br/>
              <p style="color: #9ca3af; font-size: 12px;">Powered by Apex Financial</p>
            </div>
          `,
        });
        results.email = true;
      } catch (err) {
        console.error("Email fallback failed:", err);
      }
    }

    console.log(`Notification for ${userId || email}: push=${results.push}, sms=${results.sms}, email=${results.email}`);

    return new Response(
      JSON.stringify({ success: true, channels: results }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in send-notification:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
