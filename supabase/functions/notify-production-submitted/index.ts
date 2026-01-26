import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ProductionData {
  presentations: number;
  passed_price: number;
  hours_called: number;
  referrals_caught: number;
  booked_inhome_referrals: number;
  referral_presentations: number;
  deals_closed: number;
  aop: number;
}

interface RequestBody {
  agentId: string;
  agentName: string;
  productionData: ProductionData;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { agentId, agentName, productionData }: RequestBody = await req.json();

    console.log("Production submitted notification for:", agentName);

    // Create Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get weekly totals for this agent
    const today = new Date();
    const dayOfWeek = today.getDay();
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - dayOfWeek);
    const weekStartStr = weekStart.toISOString().split("T")[0];

    const { data: weeklyData } = await supabase
      .from("daily_production")
      .select("aop, deals_closed, presentations")
      .eq("agent_id", agentId)
      .gte("production_date", weekStartStr);

    const weeklyALP = (weeklyData || []).reduce((sum, d) => sum + (Number(d.aop) || 0), 0);
    const weeklyDeals = (weeklyData || []).reduce((sum, d) => sum + (d.deals_closed || 0), 0);
    const weeklyPresentations = (weeklyData || []).reduce((sum, d) => sum + (d.presentations || 0), 0);
    const weeklyCloseRate = weeklyPresentations > 0 
      ? Math.round((weeklyDeals / weeklyPresentations) * 100) 
      : 0;

    // Calculate today's close rate
    const todayCloseRate = productionData.presentations > 0
      ? Math.round((productionData.deals_closed / productionData.presentations) * 100)
      : 0;

    // Admin email
    const adminEmail = "info@kingofsales.net";
    const timestamp = new Date().toLocaleString("en-US", { 
      timeZone: "America/Chicago",
      dateStyle: "short",
      timeStyle: "short"
    });

    // Send notification email with story-worthy design
    const emailResponse = await resend.emails.send({
      from: "APEX Production <noreply@apex-financial.org>",
      to: [adminEmail],
      subject: `🔥 ${agentName} | ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} Production Report`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: 'Segoe UI', Arial, sans-serif; background-color: #0f172a; color: #e2e8f0; margin: 0; padding: 20px; }
            .container { max-width: 400px; margin: 0 auto; background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); border-radius: 20px; padding: 28px; border: 1px solid #334155; }
            .header { text-align: center; margin-bottom: 24px; }
            .header h1 { color: #14b8a6; margin: 0; font-size: 28px; font-weight: 800; }
            .header .date { font-size: 13px; color: #64748b; margin-top: 6px; }
            .agent-name { font-size: 22px; font-weight: bold; color: #f1f5f9; text-align: center; margin: 20px 0 8px; }
            .hero-stat { text-align: center; background: linear-gradient(135deg, #14b8a630 0%, #10b98130 100%); border-radius: 16px; padding: 24px; margin-bottom: 20px; border: 1px solid #14b8a640; }
            .hero-value { font-size: 48px; font-weight: 800; color: #14b8a6; line-height: 1; }
            .hero-label { font-size: 14px; color: #94a3b8; margin-top: 8px; text-transform: uppercase; letter-spacing: 1px; }
            .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px; }
            .stat-box { background: #1e293b; border-radius: 12px; padding: 16px 8px; text-align: center; border: 1px solid #334155; }
            .stat-value { font-size: 24px; font-weight: bold; color: #f1f5f9; }
            .stat-label { font-size: 10px; color: #94a3b8; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
            .weekly-section { background: linear-gradient(135deg, #8b5cf620 0%, #a78bfa20 100%); border-radius: 14px; padding: 18px; border: 1px solid #8b5cf630; margin-bottom: 20px; }
            .weekly-title { font-size: 13px; font-weight: bold; color: #a78bfa; margin-bottom: 14px; text-align: center; text-transform: uppercase; letter-spacing: 1px; }
            .weekly-stats { display: flex; justify-content: space-around; }
            .weekly-stat { text-align: center; }
            .weekly-value { font-size: 22px; font-weight: bold; color: #f1f5f9; }
            .weekly-label { font-size: 10px; color: #94a3b8; text-transform: uppercase; }
            .motivation { text-align: center; padding: 20px; background: linear-gradient(135deg, #f59e0b20 0%, #fbbf2420 100%); border-radius: 14px; border: 1px solid #f59e0b30; }
            .motivation-text { font-size: 16px; color: #fbbf24; font-weight: 600; }
            .motivation-sub { font-size: 12px; color: #94a3b8; margin-top: 8px; }
            .footer { text-align: center; margin-top: 24px; font-size: 11px; color: #475569; }
            .share-hint { text-align: center; margin-top: 16px; padding: 12px; background: #1e293b; border-radius: 8px; }
            .share-hint-text { font-size: 11px; color: #64748b; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🔥 PRODUCTION REPORT</h1>
              <div class="date">${timestamp} CST</div>
            </div>
            
            <div class="agent-name">${agentName}</div>
            
            <div class="hero-stat">
              <div class="hero-value">$${productionData.aop.toLocaleString()}</div>
              <div class="hero-label">Today's ALP</div>
            </div>
            
            <div class="stats-grid">
              <div class="stat-box">
                <div class="stat-value">${productionData.deals_closed}</div>
                <div class="stat-label">Deals</div>
              </div>
              <div class="stat-box">
                <div class="stat-value">${productionData.presentations}</div>
                <div class="stat-label">Presents</div>
              </div>
              <div class="stat-box">
                <div class="stat-value">${todayCloseRate}%</div>
                <div class="stat-label">Close Rate</div>
              </div>
            </div>
            
            <div class="weekly-section">
              <div class="weekly-title">📈 Week Running Total</div>
              <div class="weekly-stats">
                <div class="weekly-stat">
                  <div class="weekly-value">$${weeklyALP.toLocaleString()}</div>
                  <div class="weekly-label">Week ALP</div>
                </div>
                <div class="weekly-stat">
                  <div class="weekly-value">${weeklyDeals}</div>
                  <div class="weekly-label">Deals</div>
                </div>
                <div class="weekly-stat">
                  <div class="weekly-value">${weeklyCloseRate}%</div>
                  <div class="weekly-label">Close %</div>
                </div>
              </div>
            </div>
            
            <div class="motivation">
              <div class="motivation-text">Great work today! Keep crushing it! 🚀</div>
              <div class="motivation-sub">Every day you show up is a day closer to your goals.</div>
            </div>
            
            <div class="share-hint">
              <div class="share-hint-text">📱 Screenshot this and share it on your story!</div>
            </div>
            
            <div class="footer">
              APEX Financial Group | Production Tracker
            </div>
          </div>
        </body>
        </html>
      `,
    });

    console.log("Notification sent:", emailResponse);

    return new Response(JSON.stringify({ success: true }), {
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
