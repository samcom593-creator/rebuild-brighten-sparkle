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

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { applicationId, agentId, crmSetupLink } = await req.json();

    if (!applicationId || !crmSetupLink) {
      throw new Error("Missing required fields: applicationId and crmSetupLink");
    }

    // Fetch application details
    const { data: application, error: appError } = await supabase
      .from("applications")
      .select("first_name, last_name, email")
      .eq("id", applicationId)
      .single();

    if (appError || !application) {
      throw new Error("Application not found");
    }

    // Fetch manager details
    let managerName = "Apex Financial Team";
    if (agentId) {
      const { data: agent } = await supabase
        .from("agents")
        .select("user_id")
        .eq("id", agentId)
        .single();

      if (agent?.user_id) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("user_id", agent.user_id)
          .single();

        if (profile?.full_name) {
          managerName = profile.full_name;
        }
      }
    }

    const firstName = application.first_name;
    
    // Send email
    const { error: emailError } = await resend.emails.send({
      from: "APEX Financial <noreply@apex-financial.org>",
      to: [application.email],
      subject: "🎉 Welcome to the Team! Set Up Your CRM Access",
      html: `
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
      <div style="text-align:center;margin-bottom:24px;">
        <span style="font-size:48px;">🎉</span>
      </div>
      
      <h2 style="font-size:24px;margin:0 0 16px 0;color:#14b8a6;text-align:center;">Congratulations, ${firstName}!</h2>
      
      <p style="font-size:16px;line-height:1.6;color:#d1d5db;margin:0 0 16px 0;">
        Welcome to the Apex Financial family! We're thrilled to have you on board.
      </p>
      
      <p style="font-size:16px;line-height:1.6;color:#d1d5db;margin:0 0 16px 0;">
        You've officially been contracted as a licensed agent. The next step is to set up your CRM access so you can start managing your leads and growing your business.
      </p>
      
      <div style="background:rgba(20,184,166,0.1);border-radius:8px;padding:20px;margin:24px 0;text-align:center;">
        <p style="font-size:14px;color:#14b8a6;margin:0 0 12px 0;font-weight:bold;">YOUR NEXT STEP:</p>
        <a href="${crmSetupLink}" 
           style="display:inline-block;background:linear-gradient(135deg,#14b8a6,#0ea5e9);color:#ffffff;padding:16px 32px;text-decoration:none;border-radius:8px;font-weight:bold;font-size:16px;">
          Set Up Your CRM Access
        </a>
      </div>
      
      <div style="border-left:3px solid #14b8a6;padding-left:16px;margin:24px 0;">
        <p style="font-size:14px;color:#9ca3af;margin:0;">
          <strong style="color:#ffffff;">What to expect next:</strong><br>
          • Complete your CRM setup using the link above<br>
          • Join our team Discord for daily training and support<br>
          • Start receiving leads and building your pipeline<br>
          • Schedule your first week of training sessions
        </p>
      </div>
      
      <p style="font-size:14px;color:#9ca3af;margin:24px 0 0 0;">
        If you have any questions, don't hesitate to reach out. We're here to help you succeed!<br><br>
        Welcome aboard,<br>
        <strong style="color:#ffffff;">${managerName}</strong><br>
        Apex Financial
      </p>
    </div>
    
    <p style="font-size:12px;color:#6b7280;text-align:center;margin-top:32px;">
      © ${new Date().getFullYear()} Apex Financial. All rights reserved.
    </p>
  </div>
</body>
</html>
      `,
    });

    if (emailError) {
      console.error("Error sending contracted email:", emailError);
      throw new Error(`Failed to send email: ${emailError.message}`);
    }

    // Log to contact_history
    await supabase.from("contact_history").insert({
      application_id: applicationId,
      agent_id: agentId || null,
      contact_type: "contracted",
      subject: "Welcome to the Team! Set Up Your CRM Access",
      notes: `Sent contracted welcome email with CRM setup link`,
    });

    console.log(`Contracted email sent to ${application.email}`);

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in notify-agent-contracted:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
