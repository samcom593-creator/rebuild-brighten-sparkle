import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const UNLICENSED_CALENDLY = "https://calendly.com/sam-com593/licensed-prospect-call-clone";
const LICENSED_CALENDLY = "https://calendly.com/sam-com593/1on1-call-clone";
const ADMIN_EMAIL = "sam@apex-financial.org";

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
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      console.error("RESEND_API_KEY not configured");
      return new Response(
        JSON.stringify({ error: "Email service not configured" }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const resend = new Resend(resendApiKey);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { applicationId, agentId } = await req.json();

    if (!applicationId) {
      return new Response(
        JSON.stringify({ error: "Application ID is required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log(`Processing manual follow-up for application: ${applicationId}`);

    const { data: application, error: appError } = await supabase
      .from("applications")
      .select("id, first_name, last_name, email, license_status, manual_followup_sent_at")
      .eq("id", applicationId)
      .single();

    if (appError || !application) {
      console.error("Application not found:", appError);
      return new Response(
        JSON.stringify({ error: "Application not found" }),
        { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Get agent name for personalization
    let agentName = "Your Apex Recruiter";
    if (agentId) {
      const { data: agentData } = await supabase
        .from("agents")
        .select("user_id")
        .eq("id", agentId)
        .single();
      
      if (agentData) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("user_id", agentData.user_id)
          .single();
        
        if (profile?.full_name) {
          agentName = profile.full_name;
        }
      }
    }

    // Resolve manager email for CC
    let managerEmail: string | null = null;
    if (agentId) {
      managerEmail = await getManagerEmail(supabase, agentId);
    }
    const ccList = [ADMIN_EMAIL, managerEmail].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i) as string[];

    const firstName = application.first_name;
    const isLicensed = application.license_status === "licensed";

    let subject: string;
    let htmlContent: string;

    if (isLicensed) {
      subject = "Still Interested? Let's Connect! 🚀";
      htmlContent = `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
        <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0a0a0f;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0a0a0f; padding: 40px 20px;">
            <tr><td align="center">
              <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 16px; overflow: hidden; border: 1px solid rgba(0, 204, 153, 0.2);">
                <tr><td style="padding: 40px 40px 20px; text-align: center;"><h1 style="margin: 0; color: #00cc99; font-size: 28px; font-weight: 700;">Hey ${firstName}! 👋</h1></td></tr>
                <tr><td style="padding: 20px 40px;">
                  <p style="color: #e0e0e0; font-size: 16px; line-height: 1.6; margin: 0 0 20px;">Just wanted to reach out and see how everything's going! We noticed you're already licensed – that's awesome! 🎉</p>
                  <p style="color: #e0e0e0; font-size: 16px; line-height: 1.6; margin: 0 0 20px;">Are you still looking for the right opportunity to grow your career? We'd love to connect and show you how Apex Financial can help you take your earnings to the next level.</p>
                  <p style="color: #e0e0e0; font-size: 16px; line-height: 1.6; margin: 0 0 30px;">Let's hop on a quick call and chat about your goals!</p>
                </td></tr>
                <tr><td style="padding: 0 40px 30px; text-align: center;"><a href="${LICENSED_CALENDLY}" style="display: inline-block; background: linear-gradient(135deg, #00cc99 0%, #00a37a 100%); color: #000; text-decoration: none; padding: 16px 32px; border-radius: 8px; font-weight: 600; font-size: 16px; max-width:100%; box-sizing:border-box;">Schedule Your Call →</a></td></tr>
                <tr><td style="padding: 20px 40px 40px; border-top: 1px solid rgba(255,255,255,0.1);"><p style="color: #888; font-size: 14px; margin: 0;">Looking forward to connecting!</p><p style="color: #00cc99; font-size: 14px; margin: 10px 0 0; font-weight: 600;">– ${agentName}</p></td></tr>
              </table>
            </td></tr>
          </table>
        </body></html>
      `;
    } else {
      subject = "Just Checking In! 👋";
      htmlContent = `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
        <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0a0a0f;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0a0a0f; padding: 40px 20px;">
            <tr><td align="center">
              <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 16px; overflow: hidden; border: 1px solid rgba(0, 204, 153, 0.2);">
                <tr><td style="padding: 40px 40px 20px; text-align: center;"><h1 style="margin: 0; color: #00cc99; font-size: 28px; font-weight: 700;">Hey ${firstName}! 👋</h1></td></tr>
                <tr><td style="padding: 20px 40px;">
                  <p style="color: #e0e0e0; font-size: 16px; line-height: 1.6; margin: 0 0 20px;">Just checking in to see how your licensing journey is going! We're here to help if you have any questions or need guidance.</p>
                  <p style="color: #e0e0e0; font-size: 16px; line-height: 1.6; margin: 0 0 20px;">Getting licensed can feel like a lot, but don't worry – we've got resources and support to help you through every step.</p>
                  <p style="color: #e0e0e0; font-size: 16px; line-height: 1.6; margin: 0 0 30px;">If you're stuck or just want some guidance, book a quick call with us!</p>
                </td></tr>
                <tr><td style="padding: 0 40px 30px; text-align: center;"><a href="${UNLICENSED_CALENDLY}" style="display: inline-block; background: linear-gradient(135deg, #00cc99 0%, #00a37a 100%); color: #000; text-decoration: none; padding: 16px 32px; border-radius: 8px; font-weight: 600; font-size: 16px; max-width:100%; box-sizing:border-box;">Book a Licensing Help Call →</a></td></tr>
                <tr><td style="padding: 20px 40px 40px; border-top: 1px solid rgba(255,255,255,0.1);"><p style="color: #888; font-size: 14px; margin: 0;">We're rooting for you!</p><p style="color: #00cc99; font-size: 14px; margin: 10px 0 0; font-weight: 600;">– ${agentName}</p></td></tr>
              </table>
            </td></tr>
          </table>
        </body></html>
      `;
    }

    console.log(`Sending ${isLicensed ? "licensed" : "unlicensed"} follow-up to ${application.email}, CC: ${ccList.join(", ")}`);
    
    const { error: emailError } = await resend.emails.send({
      from: "Apex Financial <notifications@apex-financial.org>",
      to: [application.email],
      cc: ccList.length > 0 ? ccList : undefined,
      subject,
      html: htmlContent,
    });

    if (emailError) {
      console.error("Failed to send email:", emailError);
      return new Response(
        JSON.stringify({ error: "Failed to send email", details: emailError }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const { error: updateError } = await supabase
      .from("applications")
      .update({ manual_followup_sent_at: new Date().toISOString() })
      .eq("id", applicationId);

    if (updateError) {
      console.error("Failed to update follow-up timestamp:", updateError);
    }

    console.log(`Manual follow-up sent successfully to ${application.email}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Follow-up email sent to ${firstName}`,
        licenseStatus: application.license_status
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Error in send-manual-followup:", errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
