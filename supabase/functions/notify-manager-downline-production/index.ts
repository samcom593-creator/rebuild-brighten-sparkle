import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface DownlineProductionRequest {
  agentId: string;
  amount: number;
  date: string;
  deals?: number;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { agentId, amount, date, deals }: DownlineProductionRequest = await req.json();
    
    console.log(`📊 Processing downline production notification for agent ${agentId}: $${amount}`);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Check thresholds - only notify for significant production
    const roundedAmount = Math.round(amount);
    if (roundedAmount < 1000) {
      console.log(`⏭️ Amount $${roundedAmount} below $1,000 threshold - skipping notification`);
      return new Response(JSON.stringify({ skipped: true, reason: "Below threshold" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get agent and their manager
    const { data: agent, error: agentError } = await supabase
      .from("agents")
      .select("id, invited_by_manager_id, profile_id")
      .eq("id", agentId)
      .single();

    if (agentError || !agent || !agent.invited_by_manager_id) {
      console.log("Agent has no manager - skipping notification");
      return new Response(JSON.stringify({ skipped: true, reason: "No manager" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get agent name
    let agentName = "Your downline agent";
    if (agent.profile_id) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", agent.profile_id)
        .single();
      if (profile?.full_name) agentName = profile.full_name;
    }

    // Get manager details
    const { data: manager } = await supabase
      .from("agents")
      .select("profile_id")
      .eq("id", agent.invited_by_manager_id)
      .single();

    if (!manager?.profile_id) {
      console.log("Manager has no profile - skipping");
      return new Response(JSON.stringify({ skipped: true, reason: "Manager no profile" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: managerProfile } = await supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", manager.profile_id)
      .single();

    if (!managerProfile?.email) {
      console.log("Manager has no email - skipping");
      return new Response(JSON.stringify({ skipped: true, reason: "Manager no email" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Calculate team roll-up for this date
    const { data: teamAgents } = await supabase
      .from("agents")
      .select("id")
      .eq("invited_by_manager_id", agent.invited_by_manager_id);

    const teamAgentIds = teamAgents?.map(a => a.id) || [];
    teamAgentIds.push(agent.invited_by_manager_id); // Include manager

    const { data: teamProduction } = await supabase
      .from("daily_production")
      .select("aop")
      .in("agent_id", teamAgentIds)
      .eq("production_date", date);

    const teamTotal = (teamProduction || []).reduce((sum, p) => sum + Number(p.aop || 0), 0);

    // Determine tier description
    let tierLabel = "";
    let tierColor = "#14b8a6"; // default teal
    if (roundedAmount >= 5000) {
      tierLabel = "PLATINUM DAY";
      tierColor = "#E5E4E2";
    } else if (roundedAmount >= 3000) {
      tierLabel = "GOLD DAY";
      tierColor = "#C9A962";
    } else if (roundedAmount >= 1000) {
      tierLabel = "BRONZE DAY";
      tierColor = "#CD7F32";
    }

    const formattedDate = new Date(date).toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    // Generate clean, social-ready email
    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
        </style>
      </head>
      <body style="margin:0;padding:0;background:#0a0a0a;font-family:'Inter',Arial,sans-serif;">
        <div style="max-width:520px;margin:0 auto;padding:40px 24px;">
          
          <!-- Header -->
          <div style="text-align:center;margin-bottom:32px;">
            <p style="font-size:11px;font-weight:600;letter-spacing:3px;color:${tierColor};margin:0 0 8px;text-transform:uppercase;">
              DOWNLINE PRODUCTION ALERT
            </p>
            <p style="font-size:12px;color:#666;margin:0;">${formattedDate}</p>
          </div>
          
          <!-- Main Card -->
          <div style="background:#141414;border:1px solid #222;border-radius:8px;padding:32px;margin-bottom:24px;">
            
            <!-- Agent Name -->
            <h1 style="font-size:24px;font-weight:600;color:#ffffff;margin:0 0 8px;text-align:center;">
              ${agentName}
            </h1>
            <p style="font-size:12px;color:#888;margin:0 0 24px;text-align:center;letter-spacing:1px;">
              ${tierLabel}
            </p>
            
            <!-- Amount -->
            <div style="background:#0a0a0a;border:1px solid #2a2a2a;border-radius:4px;padding:24px;text-align:center;margin-bottom:24px;">
              <p style="font-size:40px;font-weight:700;color:${tierColor};margin:0;">
                $${roundedAmount.toLocaleString()}
              </p>
              <p style="font-size:12px;color:#666;margin:8px 0 0;">Single Day Production</p>
            </div>
            
            ${deals ? `
            <div style="text-align:center;margin-bottom:24px;">
              <span style="font-size:14px;color:#888;">Deals Closed: </span>
              <span style="font-size:14px;font-weight:600;color:#ffffff;">${deals}</span>
            </div>
            ` : ""}
            
            <!-- Team Total -->
            <div style="border-top:1px solid #222;padding-top:20px;">
              <p style="font-size:11px;font-weight:500;letter-spacing:2px;color:#555;margin:0 0 8px;text-transform:uppercase;text-align:center;">
                Your Team Total Today
              </p>
              <p style="font-size:24px;font-weight:600;color:#14b8a6;margin:0;text-align:center;">
                $${Math.round(teamTotal).toLocaleString()}
              </p>
            </div>
          </div>
          
          <!-- CTA -->
          <div style="text-align:center;margin-bottom:32px;">
            <a href="https://rebuild-brighten-sparkle.lovable.app/agent-portal" 
               style="display:inline-block;background:#14b8a6;color:#000;font-weight:600;padding:12px 28px;border-radius:4px;text-decoration:none;font-size:13px;">
              View Full Leaderboard
            </a>
          </div>
          
          <!-- Footer -->
          <div style="text-align:center;border-top:1px solid #222;padding-top:20px;">
            <p style="font-size:11px;color:#444;margin:0;letter-spacing:1px;">
              APEX FINANCIAL GROUP
            </p>
          </div>
        </div>
      </body>
      </html>
    `;

    // Send email
    if (resendApiKey) {
      const resend = new Resend(resendApiKey);
      
      await resend.emails.send({
        from: "APEX Financial <noreply@apex-financial.org>",
        to: [managerProfile.email],
        subject: `${tierLabel}: ${agentName} hit $${roundedAmount.toLocaleString()} today`,
        html: emailHtml,
      });

      console.log(`✅ Downline production email sent to ${managerProfile.email}`);
    } else {
      console.warn("⚠️ Resend API key not configured");
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        managerEmail: managerProfile.email,
        agentName,
        amount: roundedAmount,
        teamTotal: Math.round(teamTotal),
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: unknown) {
    console.error("Error in notify-manager-downline-production:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
