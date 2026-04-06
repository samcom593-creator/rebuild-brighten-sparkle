import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import { Resend } from "https://esm.sh/resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ADMIN_EMAIL = "sam@apex-financial.org";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { data: trainingAgents, error } = await supabase
      .from("agents")
      .select("id, user_id, field_training_started_at, onboarding_stage")
      .eq("status", "active")
      .in("onboarding_stage", ["training_online", "in_field_training"]);

    if (error) throw error;

    if (!trainingAgents?.length) {
      console.log("No agents currently in training");
      return new Response(
        JSON.stringify({ success: true, sent: 0 }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const userIds = trainingAgents.map(a => a.user_id).filter(Boolean);
    
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, full_name, email")
      .in("user_id", userIds);

    const profileMap = new Map(profiles?.map(p => [p.user_id, p]) || []);

    let sentCount = 0;

    for (const agent of trainingAgents) {
      const profile = profileMap.get(agent.user_id);
      if (!profile?.email) continue;

      let daysRemaining = 7;
      if (agent.field_training_started_at) {
        const startDate = new Date(agent.field_training_started_at);
        const evaluationDate = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000);
        daysRemaining = Math.max(0, Math.ceil((evaluationDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
      }

      const stageLabel = agent.onboarding_stage === "in_field_training" 
        ? "Field Training" 
        : "Online Training";

      try {
        await resend.emails.send({
          from: "Apex Financial <notifications@apex-financial.org>",
          to: [profile.email],
          cc: [ADMIN_EMAIL],
          subject: `🌅 Good Morning! Training Reminder - Day ${8 - daysRemaining} of 7`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #3b82f6;">Good Morning, ${profile.full_name || "Agent"}! ☀️</h2>
              
              <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 12px; margin: 20px 0;">
                <h3 style="margin: 0 0 10px 0;">Daily Training Reminder</h3>
                <p style="margin: 0; font-size: 18px;">Please be <strong>logged on and camera-ready by 9:30 AM CST</strong></p>
              </div>

              <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin: 16px 0;">
                <p style="margin: 0 0 8px 0;"><strong>Current Stage:</strong> ${stageLabel}</p>
                ${agent.onboarding_stage === "in_field_training" ? `
                  <p style="margin: 0; color: ${daysRemaining <= 2 ? '#ef4444' : '#f59e0b'};">
                    <strong>Days until evaluation:</strong> ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''}
                  </p>
                ` : ''}
              </div>

              <h3>Today's Checklist:</h3>
              <ul>
                <li>✅ Log into the dialer</li>
                <li>✅ Turn on your camera</li>
                <li>✅ Have your scripts ready</li>
                <li>✅ Prepare questions for your trainer</li>
              </ul>

              <p>Remember: Consistent attendance and participation are key to your success!</p>

              <br/>
              <p>Let's make today a great day!<br/>
              <strong>Apex Financial Team</strong></p>
            </div>
          `,
        });
        sentCount++;
      } catch (emailError) {
        console.error(`Failed to send reminder to ${profile.email}:`, emailError);
      }
    }

    console.log(`Training reminders sent to ${sentCount} agents, CC: ${ADMIN_EMAIL}`);

    return new Response(
      JSON.stringify({ success: true, sent: sentCount }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in notify-training-reminder:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
