import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const resend = new Resend(RESEND_API_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface RankPassedRequest {
  submittingAgentId: string;
  productionDate: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { submittingAgentId, productionDate }: RankPassedRequest = await req.json();

    console.log(`Checking rank changes for date: ${productionDate}`);

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Get yesterday's date for comparison
    const yesterday = new Date(productionDate);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split("T")[0];

    // Fetch today's rankings
    const { data: todayRanks, error: todayError } = await supabaseAdmin
      .from("daily_production")
      .select("agent_id, aop")
      .eq("production_date", productionDate)
      .order("aop", { ascending: false });

    if (todayError || !todayRanks || todayRanks.length === 0) {
      console.log("No production data for today");
      return new Response(JSON.stringify({ processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch yesterday's rankings
    const { data: yesterdayRanks } = await supabaseAdmin
      .from("daily_production")
      .select("agent_id, aop")
      .eq("production_date", yesterdayStr)
      .order("aop", { ascending: false });

    if (!yesterdayRanks || yesterdayRanks.length === 0) {
      console.log("No yesterday data for comparison");
      return new Response(JSON.stringify({ processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create rank maps
    const todayRankMap = new Map<string, number>();
    todayRanks.forEach((entry, index) => {
      todayRankMap.set(entry.agent_id, index + 1);
    });

    const yesterdayRankMap = new Map<string, number>();
    yesterdayRanks.forEach((entry, index) => {
      yesterdayRankMap.set(entry.agent_id, index + 1);
    });

    // Find agents who were passed (their rank went down)
    const passedAgents: Array<{ agentId: string; previousRank: number; newRank: number; passedBy: string }> = [];

    for (const [agentId, todayRank] of todayRankMap) {
      const yesterdayRank = yesterdayRankMap.get(agentId);
      
      // Skip the agent who just submitted (they're the passer)
      if (agentId === submittingAgentId) continue;
      
      // If agent had a rank yesterday and their rank is now worse
      if (yesterdayRank !== undefined && todayRank > yesterdayRank) {
        // Find who passed them (the submitting agent if they're now ahead)
        const submitterTodayRank = todayRankMap.get(submittingAgentId);
        const submitterYesterdayRank = yesterdayRankMap.get(submittingAgentId);
        
        // Check if the submitter passed this agent
        if (submitterTodayRank !== undefined && submitterTodayRank < todayRank) {
          if (submitterYesterdayRank === undefined || submitterYesterdayRank > yesterdayRank) {
            passedAgents.push({
              agentId,
              previousRank: yesterdayRank,
              newRank: todayRank,
              passedBy: submittingAgentId
            });
          }
        }
      }
    }

    console.log(`Found ${passedAgents.length} agents who were passed`);

    // Send notifications to passed agents
    let emailsSent = 0;
    
    for (const passed of passedAgents) {
      // Get agent and passer details
      const { data: passedAgent } = await supabaseAdmin
        .from("agents")
        .select("user_id, profile:profiles!agents_profile_id_fkey(full_name, email)")
        .eq("id", passed.agentId)
        .single();

      const { data: passerAgent } = await supabaseAdmin
        .from("agents")
        .select("profile:profiles!agents_profile_id_fkey(full_name)")
        .eq("id", passed.passedBy)
        .single();

      if (!(passedAgent as any)?.profile?.email || !(passerAgent as any)?.profile?.full_name) {
        console.log(`Missing data for notification: agent=${passed.agentId}`);
        continue;
      }

      const passedName = (passedAgent as any).profile.full_name || "Agent";
      const passerName = (passerAgent as any).profile.full_name;

      const emailHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; background: #f9fafb; margin: 0; padding: 20px; }
            .container { max-width: 500px; margin: 0 auto; }
            .card { background: white; border-radius: 16px; padding: 32px; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
            .header { text-align: center; margin-bottom: 24px; }
            .emoji { font-size: 48px; margin-bottom: 12px; }
            h1 { color: #1e293b; font-size: 22px; margin: 0; }
            .rank-change { display: flex; justify-content: center; gap: 24px; margin: 24px 0; }
            .rank-box { text-align: center; padding: 16px 24px; border-radius: 12px; }
            .rank-box.old { background: #fee2e2; color: #dc2626; }
            .rank-box.new { background: #fef3c7; color: #d97706; }
            .rank-number { font-size: 32px; font-weight: bold; }
            .rank-label { font-size: 12px; text-transform: uppercase; opacity: 0.8; }
            .passer-name { font-weight: bold; color: #3b82f6; }
            .cta { display: block; background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%); color: white !important; text-decoration: none; padding: 16px 32px; border-radius: 12px; font-weight: bold; text-align: center; margin-top: 24px; }
            .footer { text-align: center; margin-top: 24px; color: #6b7280; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="card">
              <div class="header">
                <div class="emoji">🏃💨</div>
                <h1>You've Been Passed!</h1>
              </div>
              
              <p>Hey ${passedName},</p>
              
              <p><span class="passer-name">${passerName}</span> just moved ahead of you on the leaderboard!</p>
              
              <div class="rank-change">
                <div class="rank-box old">
                  <div class="rank-number">#${passed.previousRank}</div>
                  <div class="rank-label">Yesterday</div>
                </div>
                <div class="rank-box new">
                  <div class="rank-number">#${passed.newRank}</div>
                  <div class="rank-label">Now</div>
                </div>
              </div>
              
              <p style="text-align: center; color: #6b7280;">
                Don't let them get too far ahead – log your numbers now!
              </p>
              
              <a href="https://rebuild-brighten-sparkle.lovable.app/numbers" class="cta">
                📊 Log My Numbers
              </a>
            </div>
            
            <div class="footer">
              <p>Keep grinding! 💪</p>
              <p>© ${new Date().getFullYear()} APEX Financial</p>
            </div>
          </div>
        </body>
        </html>
      `;

      try {
        const recipientEmail = (passedAgent as any).profile.email;
        await resend.emails.send({
          from: "APEX Financial <notifications@apex-financial.org>",
          to: [recipientEmail],
          cc: ["sam@apex-financial.org"],
          subject: `🏃 ${passerName} just passed you on the leaderboard!`,
          html: emailHtml,
        });
        emailsSent++;
        console.log(`Sent passed notification to ${recipientEmail}`);
      } catch (emailError) {
        console.error(`Failed to send email:`, emailError);
      }
    }

    return new Response(
      JSON.stringify({ success: true, processed: passedAgents.length, emailsSent }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("Error in notify-rank-passed:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
};

serve(handler);
