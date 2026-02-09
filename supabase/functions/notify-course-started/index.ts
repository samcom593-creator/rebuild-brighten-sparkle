import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ADMIN_EMAIL = "sam@apex-financial.org";

interface NotifyCourseStartedRequest {
  agentId: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { agentId }: NotifyCourseStartedRequest = await req.json();
    console.log(`Course started notification requested for agent: ${agentId}`);

    const supabaseClient = createClient(
      SUPABASE_URL,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Get agent details
    const { data: agent, error: agentError } = await supabaseClient
      .from("agents")
      .select("user_id, onboarding_stage, invited_by_manager_id, manager_id")
      .eq("id", agentId)
      .single();

    if (agentError || !agent?.user_id) {
      console.error("Agent not found:", agentError);
      return new Response(
        JSON.stringify({ success: false, message: "Agent not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get profile
    const { data: profile } = await supabaseClient
      .from("profiles")
      .select("full_name, email")
      .eq("user_id", agent.user_id)
      .single();

    if (!profile?.email) {
      console.error("Profile email not found");
      return new Response(
        JSON.stringify({ success: false, message: "Profile email not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const agentName = profile.full_name || "Unknown Agent";
    const agentEmail = profile.email;

    // Look up manager's email
    let managerEmail: string | null = null;
    const managerId = agent.invited_by_manager_id || agent.manager_id;
    
    if (managerId) {
      const { data: managerAgent } = await supabaseClient
        .from("agents")
        .select("user_id")
        .eq("id", managerId)
        .single();

      if (managerAgent?.user_id) {
        const { data: managerProfile } = await supabaseClient
          .from("profiles")
          .select("full_name, email")
          .eq("user_id", managerAgent.user_id)
          .single();
        if (managerProfile?.email) {
          managerEmail = managerProfile.email;
          console.log(`Manager found: ${managerProfile.full_name} (${managerEmail})`);
        }
      }
    }

    // Build recipient list
    const recipients: string[] = [ADMIN_EMAIL];
    if (managerEmail && managerEmail !== ADMIN_EMAIL) {
      recipients.push(managerEmail);
    }

    // Send notification email to admin + manager
    try {
      await resend.emails.send({
        from: "APEX Financial <noreply@apex-financial.org>",
        to: recipients,
        subject: `📚 ${agentName} Started the Training Course`,
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 0; background-color: #0a0f1a;">
            <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
              <div style="background: linear-gradient(135deg, #0d1526 0%, #1a2a4a 100%); border-radius: 16px; padding: 40px; border: 1px solid rgba(20, 184, 166, 0.3);">
                
                <div style="text-align: center; margin-bottom: 24px;">
                  <span style="font-size: 64px;">📚</span>
                </div>
                
                <h1 style="color: #14b8a6; font-size: 28px; margin: 0 0 16px 0; text-align: center;">
                  Course Started!
                </h1>
                
                <p style="color: #e2e8f0; font-size: 16px; line-height: 1.8; margin: 0 0 24px 0; text-align: center;">
                  <strong>${agentName}</strong> has started the onboarding training course.
                </p>
                
                <div style="background: rgba(20, 184, 166, 0.1); border-radius: 12px; padding: 24px; margin: 24px 0;">
                  <h3 style="color: #14b8a6; font-size: 18px; margin: 0 0 16px 0;">Agent Details</h3>
                  <p style="color: #94a3b8; font-size: 14px; line-height: 1.8; margin: 0;">
                    <strong style="color: #e2e8f0;">Name:</strong> ${agentName}<br>
                    <strong style="color: #e2e8f0;">Email:</strong> ${agentEmail}<br>
                    <strong style="color: #e2e8f0;">Current Stage:</strong> ${agent.onboarding_stage || "Onboarding"}<br>
                    <strong style="color: #e2e8f0;">Started At:</strong> ${new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" })} PST
                  </p>
                </div>
                
                <p style="color: #94a3b8; font-size: 14px; text-align: center; margin: 24px 0 0 0;">
                  This agent is now actively working on their training. You'll receive another notification when they complete the course.
                </p>
                
                <div style="border-top: 1px solid rgba(148, 163, 184, 0.2); padding-top: 24px; margin-top: 32px;">
                  <p style="color: #64748b; font-size: 12px; margin: 0; text-align: center;">
                    APEX Financial Empire<br>
                    Building Empires, Protecting Families
                  </p>
                </div>
              </div>
            </div>
          </body>
          </html>
        `,
      });

      console.log(`Course started notification sent to admin for ${agentName}`);

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: `Admin notified that ${agentName} started the course`
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (emailError: any) {
      console.error("Failed to send course started notification:", emailError);
      return new Response(
        JSON.stringify({ success: false, error: emailError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (error: any) {
    console.error("Error in notify-course-started:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);
