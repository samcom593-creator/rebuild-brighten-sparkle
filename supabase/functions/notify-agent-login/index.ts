import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const resend = new Resend(RESEND_API_KEY);
const ADMIN_EMAIL = "sam@apex-financial.org";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface LoginNotificationRequest {
  email: string;
  name: string;
  userAgent?: string;
  agentId?: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, name, userAgent, agentId }: LoginNotificationRequest = await req.json();

    if (!email || !name) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Sending login notification to ${name} at ${email}`);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Look up manager email for CC
    let managerEmail: string | null = null;
    if (agentId) {
      const { data: agent } = await supabase
        .from("agents")
        .select("invited_by_manager_id")
        .eq("id", agentId)
        .single();

      if (agent?.invited_by_manager_id) {
        const { data: managerAgent } = await supabase
          .from("agents")
          .select("profile_id")
          .eq("id", agent.invited_by_manager_id)
          .single();

        if (managerAgent?.profile_id) {
          const { data: managerProfile } = await supabase
            .from("profiles")
            .select("email")
            .eq("id", managerAgent.profile_id)
            .single();
          managerEmail = managerProfile?.email || null;
        }
      }
    }

    const ccList = [ADMIN_EMAIL, managerEmail]
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i) as string[];

    // Format current time in CST
    const now = new Date();
    const cstTime = now.toLocaleString("en-US", {
      timeZone: "America/Chicago",
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });

    // Parse user agent for device info
    let deviceInfo = "Unknown device";
    if (userAgent) {
      if (userAgent.includes("iPhone") || userAgent.includes("iPad")) {
        deviceInfo = "iOS Device";
      } else if (userAgent.includes("Android")) {
        deviceInfo = "Android Device";
      } else if (userAgent.includes("Windows")) {
        deviceInfo = "Windows Computer";
      } else if (userAgent.includes("Mac")) {
        deviceInfo = "Mac Computer";
      } else if (userAgent.includes("Linux")) {
        deviceInfo = "Linux Computer";
      }
    }

    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; background: #f9fafb; margin: 0; padding: 20px; }
          .container { max-width: 500px; margin: 0 auto; }
          .card { background: white; border-radius: 16px; padding: 32px; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
          .header { text-align: center; margin-bottom: 24px; }
          .emoji { font-size: 48px; margin-bottom: 12px; }
          h1 { color: #1e293b; font-size: 22px; margin: 0; }
          .info-box { background: #f1f5f9; border-radius: 12px; padding: 16px; margin: 20px 0; }
          .info-row { display: flex; align-items: center; gap: 12px; margin: 8px 0; }
          .info-icon { font-size: 18px; }
          .info-label { color: #64748b; font-size: 12px; }
          .info-value { font-weight: 600; color: #1e293b; }
          .warning { background: #fef3c7; border: 1px solid #fbbf24; border-radius: 12px; padding: 16px; margin: 20px 0; }
          .warning-text { color: #92400e; font-size: 14px; margin: 0; }
          .cta { display: block; background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%); color: white !important; text-decoration: none; padding: 16px 32px; border-radius: 12px; font-weight: bold; text-align: center; margin-top: 24px; }
          .footer { text-align: center; margin-top: 24px; color: #6b7280; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="card">
            <div class="header">
              <div class="emoji">✅</div>
              <h1>Portal Login Confirmed</h1>
            </div>
            
            <p>Hey ${name},</p>
            
            <p>You just logged into the APEX Daily Numbers portal.</p>
            
            <div class="info-box">
              <div class="info-row">
                <span class="info-icon">🕐</span>
                <div>
                  <div class="info-label">Time</div>
                  <div class="info-value">${cstTime} CST</div>
                </div>
              </div>
              <div class="info-row">
                <span class="info-icon">🖥️</span>
                <div>
                  <div class="info-label">Device</div>
                  <div class="info-value">${deviceInfo}</div>
                </div>
              </div>
            </div>
            
            <div class="warning">
              <p class="warning-text">
                ⚠️ If this wasn't you, please contact your manager immediately.
              </p>
            </div>
            
            <p style="text-align: center; color: #6b7280;">
              Ready to log today's numbers?
            </p>
            
            <a href="https://rebuild-brighten-sparkle.lovable.app/numbers" class="cta">
              📊 Log My Numbers
            </a>
          </div>
          
          <div class="footer">
            <p>Stay secure! 🔒</p>
            <p>© ${new Date().getFullYear()} APEX Financial</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const res = await resend.emails.send({
      from: "APEX Financial <notifications@apex-financial.org>",
      to: [email],
      cc: ccList.length > 0 ? ccList : undefined,
      subject: "✅ Portal Login Confirmed",
      html: emailHtml,
    });

    if (!res.data?.id) {
      console.error("Resend API error:", res);
      throw new Error("Failed to send email");
    }

    console.log("Login notification sent successfully:", res.data.id, "CC:", ccList);

    return new Response(
      JSON.stringify({ success: true, emailId: res.data.id }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("Error in notify-agent-login:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
};

serve(handler);
