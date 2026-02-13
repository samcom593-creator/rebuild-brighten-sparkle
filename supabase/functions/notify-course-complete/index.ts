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

const discordLink = "https://discord.gg/JpUWA73UZX";
const portalLink = "https://apex-financial.org/agent-portal";

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { agentId, agentName, agentEmail } = await req.json();

    if (!agentId) {
      throw new Error("Missing agentId");
    }

    console.log(`Processing course completion for agent: ${agentId}`);

    // Get agent's manager and profile (include manager_id as fallback)
    const { data: agent } = await supabase
      .from("agents")
      .select("invited_by_manager_id, manager_id, profile_id")
      .eq("id", agentId)
      .single();

    // Get agent profile (try profile_id first, fallback to user_id)
    let finalAgentName = agentName || "Agent";
    let finalAgentEmail = agentEmail;
    let profileFound = false;

    if (agent?.profile_id) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, email")
        .eq("id", agent.profile_id)
        .single();
      if (profile) {
        finalAgentName = agentName || profile.full_name || "Agent";
        finalAgentEmail = agentEmail || profile.email;
        profileFound = true;
      }
    }

    // Fallback: lookup by user_id if profile_id lookup failed
    if (!profileFound) {
      const { data: agentRecord } = await supabase
        .from("agents")
        .select("user_id")
        .eq("id", agentId)
        .single();
      
      if (agentRecord?.user_id) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name, email")
          .eq("user_id", agentRecord.user_id)
          .single();
        if (profile) {
          finalAgentName = agentName || profile.full_name || "Agent";
          finalAgentEmail = agentEmail || profile.email;
          console.log(`Resolved agent via user_id fallback: ${finalAgentName}`);
        }
      }
    }

    // Get admin email
    const adminEmail = "info@apex-financial.org";

    // Get manager's email if exists (use invited_by_manager_id first, fallback to manager_id)
    let managerEmail: string | null = null;
    let managerName = "Apex Team";
    const managerId = agent?.invited_by_manager_id || agent?.manager_id;
    
    if (managerId) {
      const { data: manager } = await supabase
        .from("agents")
        .select("profile_id")
        .eq("id", managerId)
        .single();

      if (manager?.profile_id) {
        const { data: managerProfile } = await supabase
          .from("profiles")
          .select("full_name, email")
          .eq("id", manager.profile_id)
          .single();
        if (managerProfile?.email) {
          managerEmail = managerProfile.email;
          managerName = managerProfile.full_name || "Manager";
        }
      }
    }

    // Build recipient list for admin/manager notification
    const adminRecipients: string[] = [adminEmail];
    if (managerEmail && managerEmail !== adminEmail) {
      adminRecipients.push(managerEmail);
    }

    // Email 1: Notification to Admin + Manager
    const adminEmailHtml = `
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
        <span style="font-size:64px;">🎓</span>
      </div>
      
      <h2 style="font-size:24px;margin:0 0 16px 0;color:#14b8a6;text-align:center;">Course Completed!</h2>
      
      <p style="font-size:16px;line-height:1.6;color:#d1d5db;margin:0 0 16px 0;text-align:center;">
        <strong style="color:#ffffff;font-size:20px;">${finalAgentName}</strong><br/>
        has completed all onboarding coursework!
      </p>
      
      <div style="background:rgba(20,184,166,0.1);border-radius:8px;padding:20px;margin:24px 0;text-align:center;">
        <p style="font-size:14px;color:#14b8a6;margin:0 0 8px 0;font-weight:bold;">NEXT STEP:</p>
        <p style="font-size:16px;color:#ffffff;margin:0;">Ready for Field Training</p>
      </div>
      
      <div style="border-left:3px solid #14b8a6;padding-left:16px;margin:24px 0;">
        <p style="font-size:14px;color:#9ca3af;margin:0;">
          <strong style="color:#ffffff;">Recommended Actions:</strong><br>
          • Schedule first field training session<br>
          • Verify CRM access is set up<br>
          • Confirm Discord channel access<br>
          • Review initial lead assignments
        </p>
      </div>
      
      ${finalAgentEmail ? `
      <p style="font-size:14px;color:#9ca3af;margin:24px 0 0 0;text-align:center;">
        Contact: <a href="mailto:${finalAgentEmail}" style="color:#14b8a6;">${finalAgentEmail}</a>
      </p>
      ` : ''}
    </div>
    
    <p style="font-size:12px;color:#6b7280;text-align:center;margin-top:32px;">
      Powered by Apex Financial
    </p>
  </div>
</body>
</html>
    `;

    // Email 2: Congratulations to the Agent
    const agentCongratulationsHtml = `
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
        <span style="font-size:64px;">🎉</span>
      </div>
      
      <h2 style="font-size:28px;margin:0 0 16px 0;color:#14b8a6;text-align:center;">Congratulations, ${finalAgentName}!</h2>
      
      <p style="font-size:16px;line-height:1.6;color:#d1d5db;margin:0 0 24px 0;text-align:center;">
        You've successfully completed all onboarding coursework! You're ready for field training.
      </p>
      
      <!-- Next Steps -->
      <div style="background:rgba(20,184,166,0.1);border-radius:8px;padding:20px;margin:24px 0;">
        <h3 style="font-size:16px;color:#14b8a6;margin:0 0 12px 0;">🎯 Next Steps - Field Training</h3>
        <p style="font-size:14px;color:#d1d5db;margin:0;">
          Your manager will be reaching out to schedule your first field training session. Get ready to put everything you learned into action!
        </p>
      </div>
      
      <!-- Discord -->
      <div style="background:rgba(20,184,166,0.1);border-radius:8px;padding:20px;margin:24px 0;">
        <h3 style="font-size:16px;color:#14b8a6;margin:0 0 12px 0;">💬 Join Our Discord</h3>
        <p style="font-size:14px;color:#d1d5db;margin:0 0 12px 0;">
          This is where all team communication happens:
        </p>
        <a href="${discordLink}" style="display:inline-block;background:#14b8a6;color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">Join Discord →</a>
      </div>
      
      <!-- Daily Meeting -->
      <div style="background:rgba(20,184,166,0.1);border-radius:8px;padding:20px;margin:24px 0;">
        <h3 style="font-size:16px;color:#14b8a6;margin:0 0 12px 0;">📅 Daily Team Meeting</h3>
        <p style="font-size:14px;color:#d1d5db;margin:0;">
          <strong style="color:#ffffff;">Time:</strong> 10:00 AM CST on Discord<br><br>
          <strong style="color:#ffffff;">Expectations:</strong><br>
          • Camera ON (required)<br>
          • Remember: <strong style="color:#f59e0b;">On time is LATE</strong>
        </p>
      </div>
      
      <!-- The Standard -->
      <div style="background:linear-gradient(135deg,rgba(20,184,166,0.2),rgba(14,165,233,0.2));border-radius:8px;padding:20px;margin:24px 0;border:1px solid rgba(20,184,166,0.3);">
        <h3 style="font-size:16px;color:#14b8a6;margin:0 0 12px 0;">🏆 The Standard Here</h3>
        <p style="font-size:14px;color:#d1d5db;margin:0;">
          Excellence is the expectation. Our minimum standard is <strong style="color:#ffffff;font-size:18px;">$20,000/month</strong>.<br><br>
          You've got what it takes - now let's prove it in the field.
        </p>
      </div>
      
      <p style="font-size:14px;color:#9ca3af;margin:24px 0 0 0;text-align:center;">
        Let's build something great together!<br>
        <strong style="color:#ffffff;">— The Apex Team</strong>
      </p>
    </div>
    
    <p style="font-size:12px;color:#6b7280;text-align:center;margin-top:32px;">
      Powered by Apex Financial
    </p>
  </div>
</body>
</html>
    `;

    // Send admin/manager notification
    const { error: adminEmailError } = await resend.emails.send({
      from: "APEX Financial <noreply@apex-financial.org>",
      to: adminRecipients,
      subject: `🎓 ${finalAgentName} Completed Onboarding Course!`,
      html: adminEmailHtml,
    });

    if (adminEmailError) {
      console.error("Error sending admin notification:", adminEmailError);
    } else {
      console.log(`Admin notification sent to: ${adminRecipients.join(", ")}`);
    }

    // Send congratulations to the agent
    if (finalAgentEmail) {
      const { error: agentEmailError } = await resend.emails.send({
        from: "APEX Financial <noreply@apex-financial.org>",
        to: [finalAgentEmail],
        subject: `🎉 Congratulations! You've Completed Your Training!`,
        html: agentCongratulationsHtml,
      });

      if (agentEmailError) {
        console.error("Error sending agent congratulations:", agentEmailError);
      } else {
        console.log(`Congratulations email sent to: ${finalAgentEmail}`);
      }
    }

    // Update agent's onboarding stage to in_field_training
    await supabase
      .from("agents")
      .update({ onboarding_stage: "in_field_training" })
      .eq("id", agentId);

    // Log the progression event
    await supabase.from("agent_onboarding").insert({
      agent_id: agentId,
      stage: "in_field_training",
      notes: "Completed online coursework, ready for field training",
    });

    console.log(`Course completion processed for ${finalAgentName}`);

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in notify-course-complete:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
