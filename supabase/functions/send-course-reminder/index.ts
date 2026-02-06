import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

    const { agentId } = await req.json();

    if (!agentId) {
      return new Response(
        JSON.stringify({ error: "Agent ID is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get agent details with profile
    const { data: agent, error: agentError } = await supabase
      .from("agents")
      .select("id, onboarding_stage, user_id")
      .eq("id", agentId)
      .single();

    if (agentError || !agent) {
      console.error("Agent not found:", agentError);
      return new Response(
        JSON.stringify({ error: "Agent not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get profile by user_id
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("full_name, email")
      .eq("user_id", agent.user_id)
      .single();

    if (profileError || !profile?.email) {
      return new Response(
        JSON.stringify({ error: "Agent has no email" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get total modules
    const { data: modules } = await supabase
      .from("onboarding_modules")
      .select("id")
      .eq("is_active", true);
    const totalModules = modules?.length || 0;

    // Get completed modules
    const { data: progress } = await supabase
      .from("onboarding_progress")
      .select("module_id, passed")
      .eq("agent_id", agentId);

    const completedModules = progress?.filter(p => p.passed).length || 0;
    const percentComplete = totalModules > 0 ? Math.round((completedModules / totalModules) * 100) : 0;

    const firstName = profile.full_name?.split(" ")[0] || "Team Member";
    const courseUrl = `${Deno.env.get("SUPABASE_URL")?.replace(".supabase.co", ".lovable.app") || "https://rebuild-brighten-sparkle.lovable.app"}/onboarding-course`;

    // Send reminder email
    const emailHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin: 0; padding: 0; font-family: 'Helvetica Neue', Arial, sans-serif; background-color: #0f0f23;">
          <div style="max-width: 600px; margin: 0 auto; background: linear-gradient(180deg, #1a1a2e 0%, #0f0f23 100%); border-radius: 16px; overflow: hidden;">
            
            <!-- Header -->
            <div style="background: linear-gradient(135deg, #00d4ff 0%, #0099cc 100%); padding: 32px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700; letter-spacing: -0.5px;">
                📚 Course Reminder
              </h1>
            </div>
            
            <!-- Body -->
            <div style="padding: 32px;">
              <p style="color: #e0e0e0; font-size: 18px; line-height: 1.6; margin: 0 0 24px;">
                Hey ${firstName}! 👋
              </p>
              
              <p style="color: #b0b0b0; font-size: 16px; line-height: 1.6; margin: 0 0 24px;">
                We noticed you haven't been active in your training course lately. Don't worry - you're almost there!
              </p>
              
              <!-- Progress Box -->
              <div style="background: rgba(0, 212, 255, 0.1); border: 1px solid rgba(0, 212, 255, 0.3); border-radius: 12px; padding: 20px; margin: 24px 0;">
                <p style="color: #e0e0e0; font-size: 14px; margin: 0 0 8px;">Your Current Progress:</p>
                <div style="display: flex; align-items: center; gap: 12px;">
                  <div style="flex: 1; background: rgba(255,255,255,0.1); height: 8px; border-radius: 4px; overflow: hidden;">
                    <div style="width: ${percentComplete}%; background: linear-gradient(90deg, #00d4ff, #00ff88); height: 100%;"></div>
                  </div>
                  <span style="color: #00d4ff; font-size: 18px; font-weight: 700;">${percentComplete}%</span>
                </div>
                <p style="color: #888; font-size: 14px; margin: 8px 0 0;">
                  ${completedModules} of ${totalModules} modules completed
                </p>
              </div>
              
              <p style="color: #b0b0b0; font-size: 16px; line-height: 1.6; margin: 0 0 32px;">
                Every module you complete brings you closer to becoming a licensed producer. Your success story starts with completing this course!
              </p>
              
              <!-- CTA Button -->
              <div style="text-align: center; margin: 32px 0;">
                <a href="${courseUrl}" style="display: inline-block; background: linear-gradient(135deg, #00d4ff 0%, #0099cc 100%); color: #ffffff; font-size: 16px; font-weight: 600; text-decoration: none; padding: 16px 40px; border-radius: 8px; box-shadow: 0 4px 15px rgba(0, 212, 255, 0.3);">
                  Continue My Course →
                </a>
              </div>
              
              <p style="color: #666; font-size: 14px; text-align: center; margin-top: 32px;">
                Need help? Reply to this email or reach out to your manager.
              </p>
            </div>
            
            <!-- Footer -->
            <div style="padding: 24px; text-align: center; border-top: 1px solid rgba(255,255,255,0.1);">
              <p style="color: #666; font-size: 12px; margin: 0;">
                Powered by <span style="color: #00d4ff; font-weight: 600;">Apex Financial</span>
              </p>
            </div>
          </div>
        </body>
      </html>
    `;

    const { error: emailError } = await resend.emails.send({
      from: "APEX Financial <noreply@apex-financial.org>",
      to: [profile.email],
      subject: `📚 ${firstName}, your course is waiting for you!`,
      html: emailHtml,
    });

    if (emailError) {
      console.error("Error sending email:", emailError);
      throw emailError;
    }

    console.log(`Course reminder sent to ${profile.email}`);

    return new Response(
      JSON.stringify({ success: true, email: profile.email }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Error in send-course-reminder:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
