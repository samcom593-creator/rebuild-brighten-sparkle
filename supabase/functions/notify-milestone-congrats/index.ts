import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

interface MilestoneRequest {
  agentId: string;
  milestone: number; // 3000, 5000, or 10000
  weeklyProduction: number;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { agentId, milestone, weeklyProduction }: MilestoneRequest = await req.json();

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Get agent details
    const { data: agent } = await supabaseClient
      .from("agents")
      .select("user_id")
      .eq("id", agentId)
      .single();

    if (!agent?.user_id) {
      return new Response(
        JSON.stringify({ success: false, message: "Agent not found" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: profile } = await supabaseClient
      .from("profiles")
      .select("full_name, email")
      .eq("user_id", agent.user_id)
      .single();

    if (!profile?.email) {
      return new Response(
        JSON.stringify({ success: false, message: "Profile not found" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const fullName = profile.full_name || "Agent";
    const milestoneFormatted = milestone >= 1000 ? `$${(milestone / 1000).toFixed(0)}K` : `$${milestone}`;
    
    const milestoneEmoji: Record<number, string> = {
      3000: "🎯",
      5000: "⭐",
      10000: "🏆",
    };

    const milestoneMessage: Record<number, string> = {
      3000: "You're building momentum! Keep pushing forward.",
      5000: "You're on fire! This is what top producers look like.",
      10000: "ELITE PERFORMER! You're in the top tier of the team!",
    };

    try {
      await resend.emails.send({
        from: "APEX Financial <notifications@tx.apex-financial.org>",
        to: [profile.email],
        cc: ["sam@apex-financial.org"],
        subject: `${milestoneEmoji[milestone] || "🎉"} Congratulations on ${milestoneFormatted}+ Production!`,
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 0; background-color: #0a0f1a;">
            <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
              <div style="background: linear-gradient(135deg, #0d1526 0%, #1a2a4a 100%); border-radius: 16px; padding: 40px; border: 1px solid ${milestone >= 10000 ? "rgba(245, 158, 11, 0.4)" : "rgba(20, 184, 166, 0.3)"};">
                
                <div style="text-align: center; margin-bottom: 24px;">
                  <span style="font-size: 72px;">${milestoneEmoji[milestone] || "🎉"}</span>
                </div>
                
                <h1 style="color: ${milestone >= 10000 ? "#f59e0b" : "#14b8a6"}; font-size: 32px; margin: 0 0 8px 0; text-align: center;">
                  CONGRATULATIONS!
                </h1>
                
                <h2 style="color: #ffffff; font-size: 28px; margin: 0 0 24px 0; text-align: center;">
                  ${fullName}
                </h2>
                
                <div style="background: ${milestone >= 10000 ? "rgba(245, 158, 11, 0.15)" : "rgba(20, 184, 166, 0.15)"}; border-radius: 12px; padding: 32px; margin: 24px 0; text-align: center;">
                  <p style="color: #94a3b8; font-size: 14px; margin: 0 0 8px 0;">This Week's Production</p>
                  <p style="color: ${milestone >= 10000 ? "#f59e0b" : "#14b8a6"}; font-size: 48px; font-weight: bold; margin: 0;">
                    $${weeklyProduction.toLocaleString()}
                  </p>
                </div>
                
                <p style="color: #e2e8f0; font-size: 18px; line-height: 1.8; text-align: center; margin: 24px 0;">
                  ${milestoneMessage[milestone] || "Amazing work this week!"}
                </p>
                
                ${milestone >= 10000 ? `
                  <div style="background: linear-gradient(135deg, rgba(245, 158, 11, 0.2) 0%, rgba(239, 68, 68, 0.2) 100%); border-radius: 12px; padding: 20px; margin: 24px 0; text-align: center;">
                    <p style="color: #f59e0b; font-size: 16px; font-weight: bold; margin: 0;">
                      🔥 $10K+ CLUB MEMBER 🔥
                    </p>
                  </div>
                ` : ""}
                
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

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: `Milestone email sent to ${profile.email}`,
          milestone,
          weeklyProduction
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (emailError: any) {
      console.error("Failed to send milestone email:", emailError);
      return new Response(
        JSON.stringify({ success: false, error: emailError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (error: any) {
    console.error("Error in notify-milestone-congrats:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);
