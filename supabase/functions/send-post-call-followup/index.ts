import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { Resend } from "npm:resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ADMIN_EMAIL = "info@apex-financial.org";

interface PostCallFollowupRequest {
  firstName: string;
  email: string;
  licenseStatus: string;
  actionType?: string;
  calendarLink?: string;
  agentId?: string;
}

async function getManagerEmail(supabase: any, agentId: string): Promise<string | null> {
  try {
    const { data: agent } = await supabase.from("agents").select("user_id, invited_by_manager_id").eq("id", agentId).single();
    if (!agent) return null;
    const managerId = agent.invited_by_manager_id || agentId;
    const { data: manager } = await supabase.from("agents").select("user_id").eq("id", managerId).single();
    if (!manager?.user_id) return null;
    const { data: authData } = await supabase.auth.admin.getUserById(manager.user_id);
    return authData?.user?.email || null;
  } catch (e) {
    console.error("Error resolving manager email:", e);
    return null;
  }
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { firstName, email, licenseStatus, actionType = "contacted", calendarLink, agentId }: PostCallFollowupRequest = await req.json();

    if (!firstName || !email) {
      throw new Error("Missing required fields: firstName and email");
    }

    console.log(`Sending post-call followup (${actionType}) to ${email} (${licenseStatus})`);

    // Resolve manager email for CC
    let managerEmail: string | null = null;
    if (agentId) {
      managerEmail = await getManagerEmail(supabase, agentId);
    }
    const ccList = [ADMIN_EMAIL, managerEmail].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i) as string[];

    const isLicensed = licenseStatus === "licensed";
    const defaultCalendarLink = isLicensed 
      ? "https://calendly.com/apex-financial/licensed-consultation"
      : "https://calendly.com/apex-financial/getting-started";
    const finalCalendarLink = calendarLink || defaultCalendarLink;

    const subjectLines: Record<string, string> = {
      contacted: `Great Talking to You, ${firstName}! 📞`,
      hired: `Welcome to the APEX Team, ${firstName}! 🎉`,
      contracted: `Congratulations on Getting Contracted, ${firstName}! 🏆`,
      licensing: `Your Licensing Journey Starts Now, ${firstName}! 🚀`,
    };
    const emailSubject = subjectLines[actionType] || subjectLines.contacted;

    const greetingLines: Record<string, string> = {
      contacted: `Hey ${firstName}! 📞`,
      hired: `Welcome to APEX, ${firstName}! 🎉`,
      contracted: `Congratulations, ${firstName}! 🏆`,
      licensing: `Let's Get You Licensed, ${firstName}! 🚀`,
    };
    const greeting = greetingLines[actionType] || greetingLines.contacted;

    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Great Talking to You!</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0a0a0f; color: #ffffff;">
  <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
    
    <!-- Logo Header -->
    <div style="text-align: center; margin-bottom: 40px;">
      <div style="display: inline-block; background: linear-gradient(135deg, #10b981 0%, #14b8a6 100%); padding: 16px 32px; border-radius: 12px;">
        <span style="font-size: 28px; font-weight: 800; color: white; letter-spacing: -0.5px;">APEX</span>
      </div>
    </div>

    <!-- Main Card -->
    <div style="background: linear-gradient(145deg, rgba(20, 20, 30, 0.9) 0%, rgba(15, 15, 25, 0.95) 100%); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 20px; padding: 40px; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);">
      
      <h1 style="margin: 0 0 24px 0; font-size: 28px; font-weight: 700; background: linear-gradient(135deg, #10b981, #14b8a6); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;">
        ${greeting}
      </h1>

      ${isLicensed ? `
      <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.7; color: #e5e7eb;">
        It was great chatting with you just now! I'm excited about the possibility of having you join the <strong style="color: #10b981;">APEX</strong> team.
      </p>
      <p style="margin: 0 0 24px 0; font-size: 16px; line-height: 1.7; color: #e5e7eb;">
        With your experience, I think you'd be a fantastic fit. If you have any questions or want to continue our conversation, feel free to book another call:
      </p>
      ` : `
      <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.7; color: #e5e7eb;">
        Great talking with you! Here's everything you need to get started on your licensing journey:
      </p>

      <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 16px; padding: 24px; margin-bottom: 16px;">
        <h3 style="margin: 0 0 12px 0; font-size: 18px; font-weight: 700; color: #10b981;">📺 Step 1: Watch the Overview Video</h3>
        <a href="https://www.youtube.com/watch?v=i1e5p-GEfAU" style="display: inline-block; background: #ef4444; color: white; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-size: 14px; font-weight: 600;">▶️ Watch Video</a>
      </div>

      <div style="background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 16px; padding: 24px; margin-bottom: 16px;">
        <h3 style="margin: 0 0 12px 0; font-size: 18px; font-weight: 700; color: #3b82f6;">📄 Step 2: Review the Licensing Guide</h3>
        <a href="https://docs.google.com/document/d/1WBN_bh7Tl6IkhdXwQvrUa6Q58xmV9As_q048aKAeyNg/edit?usp=sharing" style="display: inline-block; background: #3b82f6; color: white; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-size: 14px; font-weight: 600;">📖 View Guide</a>
      </div>

      <div style="background: rgba(168, 85, 247, 0.1); border: 1px solid rgba(168, 85, 247, 0.3); border-radius: 16px; padding: 24px; margin-bottom: 24px;">
        <h3 style="margin: 0 0 12px 0; font-size: 18px; font-weight: 700; color: #a855f7;">🎓 Step 3: Start Your Pre-Licensing Course</h3>
        <a href="https://partners.xcelsolutions.com/afe" style="display: inline-block; background: linear-gradient(135deg, #a855f7 0%, #9333ea 100%); color: white; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-size: 14px; font-weight: 600;">🚀 Start Course</a>
      </div>

      <div style="background: rgba(16, 185, 129, 0.05); border-radius: 12px; padding: 20px; margin-bottom: 24px;">
        <div style="margin-bottom: 8px;"><span style="color: #10b981;">✅</span> <span style="color: #e5e7eb; font-size: 14px;"><strong>We Cover Licensing Costs</strong></span></div>
        <div style="margin-bottom: 8px;"><span style="color: #10b981;">✅</span> <span style="color: #e5e7eb; font-size: 14px;"><strong>Takes About 7 Days</strong></span></div>
        <div><span style="color: #10b981;">✅</span> <span style="color: #e5e7eb; font-size: 14px;"><strong>Full Training Provided</strong></span></div>
      </div>

      <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.7; color: #e5e7eb;">
        📅 <strong>Have questions?</strong> Book a follow-up call anytime:
      </p>
      `}

      <div style="text-align: center; margin: 32px 0;">
        <a href="${finalCalendarLink}" style="display: inline-block; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; text-decoration: none; padding: 16px 40px; border-radius: 12px; font-size: 16px; font-weight: 600; box-shadow: 0 8px 24px rgba(16, 185, 129, 0.4);">
          📅 Schedule Follow-Up Call
        </a>
      </div>

      <div style="height: 1px; background: linear-gradient(90deg, transparent, rgba(16, 185, 129, 0.3), transparent); margin: 32px 0;"></div>

      <p style="margin: 0 0 8px 0; font-size: 16px; color: #e5e7eb;">
        ${isLicensed ? "Looking forward to working with you!" : "You've got this! 💪"}
      </p>
      <p style="margin: 0; font-size: 16px; font-weight: 600; color: #10b981;">
        – The APEX Team
      </p>
    </div>

    <div style="text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid rgba(255, 255, 255, 0.1);">
      <p style="margin: 0; font-size: 12px; color: #6b7280;">
        Powered by <span style="color: #10b981; font-weight: 600;">Apex Financial</span>
      </p>
    </div>
  </div>
</body>
</html>
    `;

    const emailResponse = await resend.emails.send({
      from: "APEX Financial <noreply@apex-financial.org>",
      to: [email],
      cc: ccList.length > 0 ? ccList : undefined,
      subject: emailSubject,
      html: emailHtml,
    });

    console.log("Post-call followup email sent successfully:", emailResponse, "CC:", ccList.join(", "));

    return new Response(JSON.stringify({ success: true, emailId: emailResponse.id }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("Error sending post-call followup:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
