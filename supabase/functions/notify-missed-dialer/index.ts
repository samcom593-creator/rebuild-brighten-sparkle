import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const CALENDLY_LINK = "https://calendly.com/sam-com593/licensed-prospect-call-clone-1";
const DASHBOARD_URL = "https://apex-financial.org";

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Get all "Live" agents (onboarding_stage = 'evaluated')
    const { data: liveAgents, error: agentsError } = await supabaseClient
      .from("agents")
      .select("id, user_id")
      .eq("status", "active")
      .eq("onboarding_stage", "evaluated")
      .eq("is_deactivated", false);

    if (agentsError) throw agentsError;
    if (!liveAgents?.length) {
      return new Response(
        JSON.stringify({ success: true, message: "No live agents to check" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const today = new Date().toISOString().split("T")[0];
    const emailsSent: string[] = [];

    for (const agent of liveAgents) {
      // Check if agent has dialer activity for today
      const { data: attendance } = await supabaseClient
        .from("agent_attendance")
        .select("status")
        .eq("agent_id", agent.id)
        .eq("attendance_date", today)
        .eq("attendance_type", "dialer_activity")
        .eq("status", "present")
        .single();

      // If no dialer activity, send email
      if (!attendance) {
        // Get agent profile
        const { data: profile } = await supabaseClient
          .from("profiles")
          .select("full_name, email")
          .eq("user_id", agent.user_id)
          .single();

        if (!profile?.email) continue;

        const firstName = profile.full_name?.split(" ")[0] || "Agent";

        try {
          await resend.emails.send({
            from: "APEX Financial Empire <notifications@tx.apex-financial.org>",
            to: [profile.email],
            subject: "Let's Close Strong Tomorrow 💪",
            html: `
              <!DOCTYPE html>
              <html>
              <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
              </head>
              <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 0; background-color: #0a0f1a;">
                <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
                  <div style="background: linear-gradient(135deg, #0d1526 0%, #1a2a4a 100%); border-radius: 16px; padding: 40px; border: 1px solid rgba(20, 184, 166, 0.2);">
                    
                    <h1 style="color: #14b8a6; font-size: 28px; margin: 0 0 24px 0; text-align: center;">
                      Hey ${firstName} 👋
                    </h1>
                    
                    <p style="color: #e2e8f0; font-size: 16px; line-height: 1.8; margin: 0 0 20px 0;">
                      I noticed you didn't log any dialer activity today. Every day is an opportunity to change someone's life and protect a family.
                    </p>
                    
                    <div style="background: rgba(20, 184, 166, 0.1); border-left: 4px solid #14b8a6; padding: 20px; margin: 24px 0; border-radius: 0 12px 12px 0;">
                      <p style="color: #14b8a6; font-size: 18px; font-weight: bold; margin: 0 0 8px 0;">
                        The expectation: Close at least ONE deal every single day.
                      </p>
                      <p style="color: #94a3b8; font-size: 14px; margin: 0;">
                        That's how top producers are built. One deal at a time, one day at a time.
                      </p>
                    </div>
                    
                    <p style="color: #e2e8f0; font-size: 16px; line-height: 1.8; margin: 0 0 20px 0;">
                      I want you to succeed. If you're facing challenges or need support, <strong style="color: #14b8a6;">help is here</strong>. Let's get on a quick call tomorrow morning at <strong>8:30 AM CST</strong> to get you back on track.
                    </p>
                    
                    <div style="text-align: center; margin: 32px 0;">
                      <a href="${CALENDLY_LINK}" style="display: inline-block; background: linear-gradient(135deg, #14b8a6 0%, #0d9488 100%); color: #0a0f1a; text-decoration: none; padding: 16px 40px; border-radius: 8px; font-weight: bold; font-size: 16px;">
                        Book Your Support Call →
                      </a>
                    </div>
                    
                    <p style="color: #94a3b8; font-size: 14px; line-height: 1.8; margin: 0 0 20px 0;">
                      Remember: The only way to fail is to quit. Tomorrow is a new day to crush it.
                    </p>
                    
                    <div style="border-top: 1px solid rgba(148, 163, 184, 0.2); padding-top: 24px; margin-top: 24px;">
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

          emailsSent.push(profile.email);
          console.log(`Sent missed dialer email to ${profile.email}`);
          
          // Small delay to prevent rate limiting
          await new Promise(resolve => setTimeout(resolve, 300));
        } catch (emailError) {
          console.error(`Failed to send email to ${profile.email}:`, emailError);
        }
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Sent ${emailsSent.length} missed dialer notifications`,
        emailsSent 
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error in notify-missed-dialer:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);
