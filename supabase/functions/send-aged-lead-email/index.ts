import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ADMIN_EMAIL = "info@apex-financial.org";

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function getManagerEmail(managerId: string): Promise<string | null> {
  try {
    const { data: agent } = await supabaseAdmin.from("agents").select("user_id, invited_by_manager_id").eq("id", managerId).single();
    if (!agent) return null;
    const resolvedManagerId = agent.invited_by_manager_id || managerId;
    const { data: manager } = await supabaseAdmin.from("agents").select("user_id").eq("id", resolvedManagerId).single();
    if (!manager?.user_id) return null;
    const { data: authData } = await supabaseAdmin.auth.admin.getUserById(manager.user_id);
    return authData?.user?.email || null;
  } catch (e) {
    console.error("Error resolving manager email:", e);
    return null;
  }
}

const getEmailHtml = (firstName: string, trackingClickUrl: string, trackingPixelUrl: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#0a0a0a;color:#ffffff;">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
    <div style="text-align:center;margin-bottom:32px;">
      <h1 style="font-size:28px;font-weight:bold;margin:0;background:linear-gradient(135deg,#14b8a6,#0ea5e9);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">APEX FINANCIAL</h1>
    </div>
    
    <div style="background:linear-gradient(145deg,#1a1a2e,#16213e);border-radius:16px;padding:32px;border:1px solid rgba(20,184,166,0.2);">
      <h2 style="font-size:22px;margin:0 0 20px 0;color:#ffffff;">Hey ${firstName}, a lot has changed since you applied.</h2>
      
      <p style="font-size:16px;line-height:1.7;color:#d1d5db;margin:0 0 24px 0;">
        You applied to Apex Financial before — and since then, our team has been on a tear. The results speak for themselves:
      </p>
      
      <!-- Stats Block -->
      <div style="margin:0 0 28px 0;">
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          <tr>
            <td width="50%" style="padding:0 6px 0 0;">
              <div style="background:linear-gradient(135deg,rgba(20,184,166,0.15),rgba(20,184,166,0.05));border:1px solid rgba(20,184,166,0.3);border-radius:12px;padding:20px;text-align:center;">
                <div style="font-size:28px;font-weight:bold;color:#14b8a6;margin-bottom:6px;">$20,000+</div>
                <div style="font-size:13px;color:#d1d5db;line-height:1.4;">produced by every<br>agent last month</div>
              </div>
            </td>
            <td width="50%" style="padding:0 0 0 6px;">
              <div style="background:linear-gradient(135deg,rgba(14,165,233,0.15),rgba(14,165,233,0.05));border:1px solid rgba(14,165,233,0.3);border-radius:12px;padding:20px;text-align:center;">
                <div style="font-size:28px;font-weight:bold;color:#0ea5e9;margin-bottom:6px;">$10,000+</div>
                <div style="font-size:13px;color:#d1d5db;line-height:1.4;">deposited by every<br>agent last month</div>
              </div>
            </td>
          </tr>
        </table>
      </div>
      
      <p style="font-size:16px;line-height:1.7;color:#ffffff;margin:0 0 12px 0;font-weight:600;">
        Here's what you get when you join:
      </p>
      
      <div style="background:rgba(20,184,166,0.08);border-radius:12px;padding:24px;margin:0 0 24px 0;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="padding:10px 0;color:#d1d5db;font-size:15px;">
              <span style="color:#14b8a6;font-weight:bold;margin-right:8px;">✓</span>
              Start at <strong style="color:#ffffff;">70% commission</strong> (up to 145%)
            </td>
          </tr>
          <tr>
            <td style="padding:10px 0;color:#d1d5db;font-size:15px;">
              <span style="color:#14b8a6;font-weight:bold;margin-right:8px;">✓</span>
              Unlimited warm leads provided daily
            </td>
          </tr>
          <tr>
            <td style="padding:10px 0;color:#d1d5db;font-size:15px;">
              <span style="color:#14b8a6;font-weight:bold;margin-right:8px;">✓</span>
              Complete training + mentorship included
            </td>
          </tr>
          <tr>
            <td style="padding:10px 0;color:#d1d5db;font-size:15px;">
              <span style="color:#14b8a6;font-weight:bold;margin-right:8px;">✓</span>
              No cold calling — work from anywhere
            </td>
          </tr>
        </table>
      </div>
      
      <!-- Primary CTA -->
      <div style="text-align:center;margin:32px 0 20px 0;">
        <a href="\${trackingClickUrl}" 
           style="display:inline-block;background:linear-gradient(135deg,#14b8a6,#0ea5e9);color:#ffffff;padding:18px 52px;text-decoration:none;border-radius:12px;font-weight:bold;font-size:18px;box-shadow:0 6px 24px rgba(20,184,166,0.35);letter-spacing:0.5px;">
          REAPPLY NOW →
        </a>
      </div>
      
      <p style="font-size:14px;color:#f59e0b;text-align:center;margin:20px 0 0 0;font-weight:600;">
        ⚡ We're only accepting a limited number of new agents this month.
      </p>
      
      <div style="border-top:1px solid rgba(255,255,255,0.1);margin-top:28px;padding-top:20px;">
        <p style="font-size:14px;color:#9ca3af;margin:0;">
          – The Apex Financial Team
        </p>
      </div>
    </div>
    
    <!-- Footer -->
    <div style="text-align:center;margin-top:32px;">
      <p style="font-size:12px;color:#6b7280;margin:0 0 8px 0;">
        Powered by Apex Financial · © ${new Date().getFullYear()}
      </p>
      <a href="https://apex-financial.org" style="color:#6b7280;font-size:12px;">Visit our website</a>
    </div>
  </div>
  <img src="\${trackingPixelUrl}" width="1" height="1" style="display:none;" alt="" />
</body>
</html>
`;

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      throw new Error("RESEND_API_KEY not configured");
    }

    const resend = new Resend(resendApiKey);

    const { email, firstName, managerId } = await req.json() as {
      email: string;
      firstName: string;
      managerId?: string;
    };

    if (!email) {
      throw new Error("Missing required field: email");
    }

    const name = firstName || "there";

    // Build tracking URLs
    const encodedEmail = encodeURIComponent(email);
    const encodedName = encodeURIComponent(name);
    const trackingClickUrl = `${SUPABASE_URL}/functions/v1/track-email-click?email=${encodedEmail}&name=${encodedName}&source=aged_lead`;
    const trackingPixelUrl = `${SUPABASE_URL}/functions/v1/track-email-open?id=${encodedEmail}`;

    const html = getEmailHtml(name, trackingClickUrl, trackingPixelUrl);

    // Resolve manager email for CC
    let managerEmail: string | null = null;
    if (managerId) {
      managerEmail = await getManagerEmail(managerId);
    }
    const ccList = [ADMIN_EMAIL, managerEmail].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i) as string[];

    const { error: emailError } = await resend.emails.send({
      from: "APEX Financial <noreply@apex-financial.org>",
      to: [email],
      cc: ccList.length > 0 ? ccList : undefined,
      subject: "We've Grown Since You Applied — See What's Changed",
      html,
    });

    if (emailError) {
      console.error("Error sending aged lead email:", emailError);
      throw new Error(`Failed to send email: ${emailError.message}`);
    }

    console.log(`Aged lead email sent successfully to ${email}, CC: ${ccList.join(", ")}`);

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in send-aged-lead-email:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
