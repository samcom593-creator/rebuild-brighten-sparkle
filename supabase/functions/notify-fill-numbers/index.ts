import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const PORTAL_URL = "https://apex-financial.org/agent-portal";

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { reminderType } = await req.json();
    // reminderType: "7pm" | "9pm" | "9am"

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Get all "Live" agents
    const { data: liveAgents, error: agentsError } = await supabaseClient
      .from("agents")
      .select("id, user_id")
      .eq("status", "active")
      .eq("onboarding_stage", "evaluated")
      .eq("is_deactivated", false);

    if (agentsError) throw agentsError;
    if (!liveAgents?.length) {
      return new Response(
        JSON.stringify({ success: true, message: "No live agents to notify" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Determine which date to check
    const now = new Date();
    const isNextDayReminder = reminderType === "9am";
    const targetDate = isNextDayReminder 
      ? new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().split("T")[0]
      : now.toISOString().split("T")[0];

    // Get agents who haven't filled in their numbers
    const { data: filledAgents } = await supabaseClient
      .from("daily_production")
      .select("agent_id")
      .eq("production_date", targetDate);

    const filledAgentIds = new Set(filledAgents?.map(f => f.agent_id) || []);
    const agentsNeedingReminder = liveAgents.filter(a => !filledAgentIds.has(a.id));

    if (!agentsNeedingReminder.length) {
      return new Response(
        JSON.stringify({ success: true, message: "All agents have filled their numbers" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // BATCH: Fetch all profiles in one query
    const userIds = agentsNeedingReminder.map(a => a.user_id).filter(Boolean);
    const { data: profiles } = await supabaseClient
      .from("profiles")
      .select("user_id, full_name, email")
      .in("user_id", userIds);

    // Build profile map for quick lookup
    const profileMap = new Map(profiles?.map(p => [p.user_id, p]) || []);

    const emailsSent: string[] = [];
    const subjectByType: Record<string, string> = {
      "7pm": "📊 Time to Log Your Numbers!",
      "9pm": "⏰ Don't Forget Your Daily Numbers",
      "9am": "🌅 Yesterday's Numbers Still Missing",
    };

    const urgencyByType: Record<string, string> = {
      "7pm": "End of day is approaching!",
      "9pm": "Final reminder for today.",
      "9am": "Please log yesterday's numbers ASAP.",
    };

    // BATCH: Send emails in parallel batches of 10
    const BATCH_SIZE = 10;
    for (let i = 0; i < agentsNeedingReminder.length; i += BATCH_SIZE) {
      const batch = agentsNeedingReminder.slice(i, i + BATCH_SIZE);
      
      const results = await Promise.allSettled(
        batch.map(async (agent) => {
          const profile = profileMap.get(agent.user_id);
          if (!profile?.email) return null;

          const firstName = profile.full_name?.split(" ")[0] || "Agent";

          await resend.emails.send({
            from: "APEX Financial Empire <notifications@tx.apex-financial.org>",
            to: [profile.email],
            subject: subjectByType[reminderType] || "Log Your Daily Numbers",
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
                    
                    <h1 style="color: #14b8a6; font-size: 24px; margin: 0 0 20px 0;">
                      Hey ${firstName}! 👋
                    </h1>
                    
                    <p style="color: #f59e0b; font-size: 16px; font-weight: bold; margin: 0 0 16px 0;">
                      ${urgencyByType[reminderType]}
                    </p>
                    
                    <p style="color: #e2e8f0; font-size: 16px; line-height: 1.8; margin: 0 0 24px 0;">
                      Your daily production numbers haven't been logged yet. Take a minute to update your stats so we can track your progress and celebrate your wins!
                    </p>
                    
                    <div style="text-align: center; margin: 32px 0;">
                      <a href="${PORTAL_URL}" style="display: inline-block; background: linear-gradient(135deg, #14b8a6 0%, #0d9488 100%); color: #0a0f1a; text-decoration: none; padding: 16px 40px; border-radius: 8px; font-weight: bold; font-size: 16px;">
                        Log My Numbers Now →
                      </a>
                    </div>
                    
                    <p style="color: #94a3b8; font-size: 14px; text-align: center;">
                      It only takes 30 seconds!
                    </p>
                    
                    <div style="border-top: 1px solid rgba(148, 163, 184, 0.2); padding-top: 24px; margin-top: 24px;">
                      <p style="color: #64748b; font-size: 12px; margin: 0; text-align: center;">
                        APEX Financial Empire
                      </p>
                    </div>
                    
                  </div>
                </div>
              </body>
              </html>
            `,
          });

          return profile.email;
        })
      );

      // Collect successful sends
      results.forEach((result) => {
        if (result.status === "fulfilled" && result.value) {
          emailsSent.push(result.value);
        } else if (result.status === "rejected") {
          console.error("Email send failed:", result.reason);
        }
      });
    }

    console.log(`Sent ${emailsSent.length} fill numbers reminders (${reminderType})`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        reminderType,
        message: `Sent ${emailsSent.length} fill numbers reminders`,
        emailsSent 
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error in notify-fill-numbers:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);
