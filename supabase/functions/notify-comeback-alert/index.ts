import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ComebackAlertRequest {
  agentId: string;
  agentName: string;
  previousRank: number;
  newRank: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { agentId, agentName, previousRank, newRank }: ComebackAlertRequest = await req.json();

    console.log(`⚡ Checking comeback for ${agentName}: #${previousRank} → #${newRank}`);

    // Only send if jumped INTO top 3 FROM outside top 5
    if (newRank > 3 || previousRank <= 5) {
      console.log("Not a qualifying comeback - no alert");
      return new Response(
        JSON.stringify({ success: true, alert_sent: false, reason: "not qualifying" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get all live agent emails
    const { data: agents, error: agentsError } = await supabase
      .from("agents")
      .select(`
        id,
        profile:profiles!agents_profile_id_fkey(email)
      `)
      .eq("is_deactivated", false)
      .eq("is_inactive", false);

    if (agentsError) throw agentsError;

    const recipients = agents
      ?.filter((a: any) => a.profile?.email && a.id !== agentId)
      .map((a: any) => a.profile?.email)
      .filter(Boolean) as string[];

    if (recipients.length === 0) {
      return new Response(
        JSON.stringify({ success: true, alert_sent: false, reason: "no recipients" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const rankJump = previousRank - newRank;
    
    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #0a0a0a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0a0a0a; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 500px; background: linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%); border-radius: 24px; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(139, 92, 246, 0.5);">
          
          <!-- Comeback Header -->
          <tr>
            <td style="padding: 32px 24px; text-align: center;">
              <div style="font-size: 48px; margin-bottom: 8px;">⚡⚡⚡</div>
              <h1 style="color: white; font-size: 28px; font-weight: 900; margin: 0; text-transform: uppercase; letter-spacing: 2px;">
                COMEBACK ALERT!
              </h1>
            </td>
          </tr>
          
          <!-- Rank Change Info -->
          <tr>
            <td style="background: rgba(0,0,0,0.2); padding: 32px 24px; text-align: center;">
              <h2 style="color: white; font-size: 28px; font-weight: 900; margin: 0 0 20px 0;">
                ${agentName}
              </h2>
              <p style="color: rgba(255,255,255,0.9); font-size: 18px; margin: 0 0 20px 0;">
                just made a <span style="color: #fef08a; font-weight: 900;">BIG MOVE!</span>
              </p>
              
              <!-- Rank Change Visualization -->
              <div style="display: flex; justify-content: center; align-items: center; gap: 16px; margin: 20px 0;">
                <div style="background: rgba(0,0,0,0.3); border-radius: 12px; padding: 20px 24px;">
                  <p style="color: rgba(255,255,255,0.6); font-size: 12px; margin: 0 0 4px 0; text-transform: uppercase;">Was</p>
                  <p style="color: #f87171; font-size: 36px; font-weight: 900; margin: 0;">#${previousRank}</p>
                </div>
                <div style="font-size: 32px;">→</div>
                <div style="background: rgba(0,0,0,0.3); border-radius: 12px; padding: 20px 24px;">
                  <p style="color: rgba(255,255,255,0.6); font-size: 12px; margin: 0 0 4px 0; text-transform: uppercase;">Now</p>
                  <p style="color: #4ade80; font-size: 36px; font-weight: 900; margin: 0;">#${newRank}</p>
                </div>
              </div>
              
              <p style="color: #fef08a; font-size: 20px; font-weight: 700; margin: 20px 0 0 0;">
                ↑ Jumped ${rankJump} spots!
              </p>
            </td>
          </tr>
          
          <!-- Challenge -->
          <tr>
            <td style="padding: 24px; text-align: center; background: rgba(0,0,0,0.1);">
              <p style="color: white; font-size: 20px; font-weight: 700; margin: 0 0 20px 0; font-style: italic;">
                "The leaderboard is shaking up!"
              </p>
              <a href="https://rebuild-brighten-sparkle.lovable.app/agent-portal" 
                 style="display: inline-block; background: linear-gradient(135deg, #fef08a 0%, #fbbf24 100%); color: #6d28d9; font-size: 16px; font-weight: 800; text-decoration: none; padding: 16px 40px; border-radius: 12px; text-transform: uppercase; letter-spacing: 1px;">
                📊 CHECK THE LEADERBOARD
              </a>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding: 20px; text-align: center; background: rgba(0,0,0,0.3);">
              <p style="color: rgba(255,255,255,0.5); font-size: 12px; margin: 0;">
                APEX Financial • Every Day is a New Opportunity ⚡
              </p>
            </td>
          </tr>
          
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    // Send to all agents
    try {
      await resend.emails.send({
        from: "APEX Financial <notifications@tx.apex-financial.org>",
        bcc: recipients,
        to: "sam@apex-financial.org",
        subject: `⚡ COMEBACK! ${agentName} jumped from #${previousRank} to #${newRank}!`,
        html: emailHtml,
      });
      console.log(`✅ Comeback alert sent to ${recipients.length} agents`);
    } catch (emailError) {
      console.error("Failed to send comeback alert:", emailError);
      throw emailError;
    }

    return new Response(
      JSON.stringify({ success: true, alert_sent: true, recipients: recipients.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error in notify-comeback-alert:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
