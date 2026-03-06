import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import { Resend } from "https://esm.sh/resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
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

async function logNotification(supabase: any, data: any) {
  try {
    await supabase.from("notification_log").insert({
      recipient_user_id: data.recipient_user_id || null,
      recipient_email: data.recipient_email || null,
      recipient_phone: data.recipient_phone || null,
      channel: data.channel,
      title: data.title,
      message: data.message,
      status: data.status,
      error_message: data.error_message || null,
      metadata: data.metadata || {},
    });
  } catch (e) {
    console.error("Failed to log notification:", e);
  }
}

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
    const logMeta = { url, trigger: "send-notification" };

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
        await logNotification(supabase, {
          recipient_user_id: userId,
          recipient_email: recipientEmail,
          channel: "push",
          title: title || "Notification",
          message: message || "",
          status: results.push ? "sent" : "failed",
          error_message: results.push ? null : "No push subscriptions or push failed",
          metadata: logMeta,
        });
      } catch (err: any) {
        console.error("Push notification failed:", err);
        await logNotification(supabase, {
          recipient_user_id: userId,
          recipient_email: recipientEmail,
          channel: "push",
          title: title || "Notification",
          message: message || "",
          status: "failed",
          error_message: err.message,
          metadata: logMeta,
        });
      }
    }

    // 2. Try SMS via email gateway (known carrier)
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
            await logNotification(supabase, {
              recipient_user_id: userId,
              recipient_phone: profileData.phone,
              channel: "sms",
              title: title || "Notification",
              message: `${title}: ${message}`.substring(0, 160),
              status: "sent",
              metadata: { ...logMeta, carrier: profileData.carrier, gateway: smsEmail },
            });
          } catch (err: any) {
            console.error("SMS via email failed:", err);
            await logNotification(supabase, {
              recipient_user_id: userId,
              recipient_phone: profileData.phone,
              channel: "sms",
              title: title || "Notification",
              message: `${title}: ${message}`.substring(0, 160),
              status: "failed",
              error_message: err.message,
              metadata: { ...logMeta, carrier: profileData.carrier },
            });
          }
        }
      }
    }

    // 2b. SMS Auto-Detect (unknown carrier, has phone)
    if (!results.sms && profileData?.phone && !profileData?.carrier) {
      try {
        const autoResp = await fetch(`${supabaseUrl}/functions/v1/send-sms-auto-detect`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({
            phone: profileData.phone,
            message: `${title}: ${message}`.substring(0, 160),
          }),
        });
        const autoResult = await autoResp.json();
        if (autoResult.successCount > 0) results.sms = true;
      } catch (err: any) {
        console.error("SMS auto-detect failed:", err);
      }
    }

    // 3. ALWAYS send email if we have a recipient (not just fallback)
    if (recipientEmail) {
      try {
        await resend.emails.send({
          from: "Apex Financial <notifications@apex-financial.org>",
          to: [recipientEmail],
          cc: [ADMIN_EMAIL],
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
        await logNotification(supabase, {
          recipient_user_id: userId,
          recipient_email: recipientEmail,
          channel: "email",
          title: title || "Notification",
          message: message || "",
          status: "sent",
          metadata: { ...logMeta, cc: ADMIN_EMAIL },
        });
      } catch (err: any) {
        console.error("Email send failed:", err);
        await logNotification(supabase, {
          recipient_user_id: userId,
          recipient_email: recipientEmail,
          channel: "email",
          title: title || "Notification",
          message: message || "",
          status: "failed",
          error_message: err.message,
          metadata: logMeta,
        });
      }
    }

    console.log(`Notification for ${userId || email}: push=${results.push}, sms=${results.sms}, email=${results.email}, cc=${ADMIN_EMAIL}`);

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
