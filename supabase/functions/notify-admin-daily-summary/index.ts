import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("Generating admin daily summary...");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get today's date
    const today = new Date().toISOString().split("T")[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];

    // Get this week's start date (Sunday)
    const now = new Date();
    const dayOfWeek = now.getDay();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - dayOfWeek);
    const weekStartStr = weekStart.toISOString().split("T")[0];

    // Fetch all Live agents
    const { data: agents } = await supabase
      .from("agents")
      .select(`
        id,
        profile:profiles!agents_profile_id_fkey(full_name, email)
      `)
      .eq("onboarding_stage", "evaluated")
      .eq("is_deactivated", false);

    const agentIds = (agents || []).map((a: any) => a.id);
    const agentMap = new Map((agents || []).map((a: any) => [a.id, a.profile?.full_name || "Unknown"]));

    // Fetch today's production
    const { data: todayProduction } = await supabase
      .from("daily_production")
      .select("*")
      .eq("production_date", today);

    // Fetch yesterday's production for comparison
    const { data: yesterdayProduction } = await supabase
      .from("daily_production")
      .select("aop, deals_closed")
      .eq("production_date", yesterday);

    // Fetch weekly production
    const { data: weeklyProduction } = await supabase
      .from("daily_production")
      .select("agent_id, aop, deals_closed, presentations")
      .gte("production_date", weekStartStr);

    // Calculate today's totals
    const todayTotalALP = (todayProduction || []).reduce((sum, p) => sum + (Number(p.aop) || 0), 0);
    const todayTotalDeals = (todayProduction || []).reduce((sum, p) => sum + (p.deals_closed || 0), 0);
    const todayTotalPresentations = (todayProduction || []).reduce((sum, p) => sum + (p.presentations || 0), 0);
    const todayCloseRate = todayTotalPresentations > 0 
      ? Math.round((todayTotalDeals / todayTotalPresentations) * 100) 
      : 0;

    // Calculate yesterday's totals for comparison
    const yesterdayTotalALP = (yesterdayProduction || []).reduce((sum, p) => sum + (Number(p.aop) || 0), 0);
    const yesterdayTotalDeals = (yesterdayProduction || []).reduce((sum, p) => sum + (p.deals_closed || 0), 0);

    // Calculate weekly totals
    const weeklyTotalALP = (weeklyProduction || []).reduce((sum, p) => sum + (Number(p.aop) || 0), 0);
    const weeklyTotalDeals = (weeklyProduction || []).reduce((sum, p) => sum + (p.deals_closed || 0), 0);

    // Find who logged and who didn't
    const loggedAgentIds = new Set((todayProduction || []).map(p => p.agent_id));
    const loggedAgents = (agents || []).filter(a => loggedAgentIds.has(a.id));
    const missingAgents = (agents || []).filter(a => !loggedAgentIds.has(a.id));

    // Build individual breakdown
    const agentBreakdown = (todayProduction || [])
      .map(p => ({
        name: agentMap.get(p.agent_id) || "Unknown",
        aop: Number(p.aop) || 0,
        deals: p.deals_closed || 0,
        presentations: p.presentations || 0,
        closeRate: p.presentations > 0 ? Math.round((p.deals_closed / p.presentations) * 100) : 0
      }))
      .sort((a, b) => b.aop - a.aop);

    // Top performers (top 3 by ALP)
    const topPerformers = agentBreakdown.slice(0, 3);

    // Get all managers to also send summary
    const { data: managers } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "manager");

    const managerUserIds = (managers || []).map((m: any) => m.user_id);

    const { data: managerProfiles } = await supabase
      .from("profiles")
      .select("email, full_name")
      .in("user_id", managerUserIds);

    // Build email
    const adminEmail = "sam@apex-financial.org";
    const allRecipients = [
      adminEmail,
      ...(managerProfiles || []).map((p: any) => p.email).filter(Boolean)
    ];

    const dateStr = new Date().toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric"
    });

    const alpChange = todayTotalALP - yesterdayTotalALP;
    const alpChangeStr = alpChange >= 0 ? `+$${alpChange.toLocaleString()}` : `-$${Math.abs(alpChange).toLocaleString()}`;
    const alpChangeColor = alpChange >= 0 ? "#10b981" : "#ef4444";

    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; background-color: #0f172a; color: #e2e8f0; margin: 0; padding: 20px; }
          .container { max-width: 600px; margin: 0 auto; background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); border-radius: 16px; padding: 24px; border: 1px solid #334155; }
          .header { text-align: center; margin-bottom: 24px; }
          .header h1 { color: #14b8a6; margin: 0 0 8px; font-size: 24px; }
          .header .date { color: #94a3b8; font-size: 14px; }
          .hero-stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin-bottom: 24px; }
          .hero-stat { background: linear-gradient(135deg, #14b8a620 0%, #10b98120 100%); border-radius: 12px; padding: 20px; text-align: center; border: 1px solid #14b8a630; }
          .hero-value { font-size: 36px; font-weight: bold; color: #14b8a6; }
          .hero-label { font-size: 12px; color: #94a3b8; margin-top: 4px; text-transform: uppercase; }
          .hero-change { font-size: 12px; margin-top: 4px; }
          .section { margin-bottom: 24px; }
          .section-title { font-size: 14px; font-weight: bold; color: #f1f5f9; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid #334155; }
          .stats-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 16px; }
          .stat-box { background: #1e293b; border-radius: 8px; padding: 12px; text-align: center; }
          .stat-value { font-size: 18px; font-weight: bold; color: #f1f5f9; }
          .stat-label { font-size: 10px; color: #64748b; margin-top: 2px; }
          .agent-row { display: flex; justify-content: space-between; align-items: center; padding: 10px; background: #1e293b; border-radius: 8px; margin-bottom: 6px; }
          .agent-name { font-weight: 500; color: #f1f5f9; }
          .agent-stats { display: flex; gap: 12px; font-size: 12px; color: #94a3b8; }
          .agent-alp { color: #14b8a6; font-weight: bold; }
          .trophy { margin-right: 6px; }
          .missing-list { display: flex; flex-wrap: wrap; gap: 8px; }
          .missing-agent { background: #ef444420; color: #fca5a5; padding: 6px 12px; border-radius: 20px; font-size: 12px; border: 1px solid #ef444430; }
          .footer { text-align: center; margin-top: 24px; font-size: 11px; color: #64748b; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>📊 Daily Production Summary</h1>
            <div class="date">${dateStr}</div>
          </div>
          
          <div class="hero-stats">
            <div class="hero-stat">
              <div class="hero-value">$${todayTotalALP.toLocaleString()}</div>
              <div class="hero-label">Today's ALP</div>
              <div class="hero-change" style="color: ${alpChangeColor}">${alpChangeStr} vs yesterday</div>
            </div>
            <div class="hero-stat">
              <div class="hero-value">$${weeklyTotalALP.toLocaleString()}</div>
              <div class="hero-label">Week-to-Date</div>
              <div class="hero-change" style="color: #94a3b8">${weeklyTotalDeals} deals closed</div>
            </div>
          </div>
          
          <div class="stats-row">
            <div class="stat-box">
              <div class="stat-value">${todayTotalDeals}</div>
              <div class="stat-label">Deals</div>
            </div>
            <div class="stat-box">
              <div class="stat-value">${todayTotalPresentations}</div>
              <div class="stat-label">Presentations</div>
            </div>
            <div class="stat-box">
              <div class="stat-value">${todayCloseRate}%</div>
              <div class="stat-label">Close Rate</div>
            </div>
            <div class="stat-box">
              <div class="stat-value">${loggedAgents.length}/${agents?.length || 0}</div>
              <div class="stat-label">Logged</div>
            </div>
          </div>
          
          ${topPerformers.length > 0 ? `
            <div class="section">
              <div class="section-title">🏆 Top Performers</div>
              ${topPerformers.map((p, i) => `
                <div class="agent-row">
                  <div class="agent-name">
                    <span class="trophy">${i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'}</span>
                    ${p.name}
                  </div>
                  <div class="agent-stats">
                    <span class="agent-alp">$${p.aop.toLocaleString()}</span>
                    <span>${p.deals} deals</span>
                    <span>${p.closeRate}% close</span>
                  </div>
                </div>
              `).join('')}
            </div>
          ` : ''}
          
          ${agentBreakdown.length > 3 ? `
            <div class="section">
              <div class="section-title">📋 All Production</div>
              ${agentBreakdown.slice(3).map(p => `
                <div class="agent-row">
                  <div class="agent-name">${p.name}</div>
                  <div class="agent-stats">
                    <span class="agent-alp">$${p.aop.toLocaleString()}</span>
                    <span>${p.deals} deals</span>
                    <span>${p.closeRate}%</span>
                  </div>
                </div>
              `).join('')}
            </div>
          ` : ''}
          
          ${missingAgents.length > 0 ? `
            <div class="section">
              <div class="section-title">⚠️ Haven't Logged Yet (${missingAgents.length})</div>
              <div class="missing-list">
                ${missingAgents.map((a: any) => `
                  <span class="missing-agent">${a.profile?.full_name || 'Unknown'}</span>
                `).join('')}
              </div>
            </div>
          ` : ''}
          
          <div class="footer">
            APEX Financial Group Daily Summary<br>
            Generated at ${new Date().toLocaleString("en-US", { timeZone: "America/Chicago" })} CST
          </div>
        </div>
      </body>
      </html>
    `;

    // Send to all recipients
    let sentCount = 0;
    for (const recipient of allRecipients) {
      try {
        await resend.emails.send({
          from: "APEX Daily Summary <noreply@apex-financial.org>",
          to: [recipient],
          subject: `📊 Daily Summary: $${todayTotalALP.toLocaleString()} ALP | ${dateStr}`,
          html: emailHtml,
        });
        sentCount++;
        await new Promise((r) => setTimeout(r, 200));
      } catch (emailError) {
        console.error(`Failed to send to ${recipient}:`, emailError);
      }
    }

    console.log(`Daily summary sent to ${sentCount} recipients (admin + managers)`);

    return new Response(JSON.stringify({ success: true, sentCount }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});
