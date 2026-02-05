import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const resendApiKey = Deno.env.get("RESEND_API_KEY");

const supabase = createClient(supabaseUrl, supabaseServiceKey);
const resend = resendApiKey ? new Resend(resendApiKey) : null;

interface ManagerStats {
  managerId: string;
  managerName: string;
  managerEmail: string;
  totalLeads: number;
  contacted: number;
  qualified: number;
  closed: number;
  closeRate: number;
  newThisWeek: number;
  staleLeads: number;
}

async function getManagerStats(): Promise<ManagerStats[]> {
  const stats: ManagerStats[] = [];
  
  // Get all managers with their agent records
  const { data: managers, error: managersError } = await supabase
    .from("agents")
    .select("id, user_id")
    .eq("status", "active");

  if (managersError || !managers) {
    console.error("Error fetching managers:", managersError);
    return stats;
  }

  // Get user roles to identify managers
  const { data: managerRoles } = await supabase
    .from("user_roles")
    .select("user_id")
    .eq("role", "manager");

  const managerUserIds = new Set(managerRoles?.map(r => r.user_id) || []);

  for (const agent of managers) {
    if (!managerUserIds.has(agent.user_id)) continue;

    // Get profile info
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, email")
      .eq("user_id", agent.user_id)
      .single();

    if (!profile?.email) continue;

    // Get team members (agents invited by this manager)
    const { data: teamAgents } = await supabase
      .from("agents")
      .select("id")
      .eq("invited_by_manager_id", agent.id);

    const teamAgentIds = teamAgents?.map(a => a.id) || [];
    teamAgentIds.push(agent.id); // Include manager's own leads

    // Get applications for the team
    const { data: applications } = await supabase
      .from("applications")
      .select("*")
      .in("assigned_agent_id", teamAgentIds);

    const apps = applications || [];
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

    const totalLeads = apps.length;
    const contacted = apps.filter(a => a.contacted_at).length;
    const qualified = apps.filter(a => a.qualified_at).length;
    const closed = apps.filter(a => a.closed_at).length;
    const newThisWeek = apps.filter(a => new Date(a.created_at) >= oneWeekAgo).length;
    const staleLeads = apps.filter(a => 
      !a.contacted_at && new Date(a.created_at) < fortyEightHoursAgo
    ).length;

    stats.push({
      managerId: agent.id,
      managerName: profile.full_name || "Manager",
      managerEmail: profile.email,
      totalLeads,
      contacted,
      qualified,
      closed,
      closeRate: totalLeads > 0 ? (closed / totalLeads) * 100 : 0,
      newThisWeek,
      staleLeads,
    });
  }

  return stats;
}

async function sendAnalyticsEmail(stats: ManagerStats) {
  if (!resend) {
    console.log("Resend not configured, skipping email for:", stats.managerEmail);
    return;
  }

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; background-color: #111; color: #fff; padding: 20px; }
        .container { max-width: 600px; margin: 0 auto; background: #1a1a1a; border-radius: 12px; padding: 30px; }
        .header { text-align: center; margin-bottom: 30px; }
        .header h1 { color: #c5a04a; margin: 0; }
        .stats-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; margin-bottom: 30px; }
        .stat-card { background: #222; border-radius: 8px; padding: 15px; text-align: center; }
        .stat-value { font-size: 32px; font-weight: bold; color: #c5a04a; }
        .stat-label { font-size: 12px; color: #888; margin-top: 5px; }
        .alert { background: #332200; border: 1px solid #664400; border-radius: 8px; padding: 15px; margin-top: 20px; }
        .alert-title { color: #ffcc00; font-weight: bold; margin-bottom: 5px; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>📊 Weekly Analytics Report</h1>
          <p style="color: #888;">Hey ${stats.managerName}, here's your team's performance this week</p>
        </div>
        
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-value">${stats.totalLeads}</div>
            <div class="stat-label">Total Leads</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${stats.newThisWeek}</div>
            <div class="stat-label">New This Week</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${stats.contacted}</div>
            <div class="stat-label">Contacted</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${stats.closed}</div>
            <div class="stat-label">Closed</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${stats.closeRate.toFixed(1)}%</div>
            <div class="stat-label">Close Rate</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${stats.qualified}</div>
            <div class="stat-label">Qualified</div>
          </div>
        </div>
        
        ${stats.staleLeads > 0 ? `
        <div class="alert">
          <div class="alert-title">⚠️ Leads Needing Attention</div>
          <p style="margin: 0; color: #ccc;">You have ${stats.staleLeads} leads that haven't been contacted in 48+ hours.</p>
        </div>
        ` : `
        <div style="background: #003300; border: 1px solid #006600; border-radius: 8px; padding: 15px; margin-top: 20px;">
          <div style="color: #00ff00; font-weight: bold;">✅ All Leads Contacted</div>
          <p style="margin: 0; color: #ccc;">Great job! All your leads have been contacted.</p>
        </div>
        `}
        
        <div class="footer">
          <p>APEX Financial Group • Weekly Analytics</p>
          <p>Login to your dashboard for more details</p>
        </div>
      </div>
    </body>
    </html>
  `;

  try {
    await resend.emails.send({
      from: "APEX Financial <noreply@apex-financial.org>",
      to: [stats.managerEmail],
      subject: `📊 Your Weekly Analytics - ${stats.newThisWeek} new leads, ${stats.closeRate.toFixed(0)}% close rate`,
      html,
    });
    console.log("Analytics email sent to:", stats.managerEmail);
  } catch (error) {
    console.error("Failed to send email to:", stats.managerEmail, error);
  }
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  console.log("Starting weekly analytics job...");

  try {
    const stats = await getManagerStats();
    console.log(`Found ${stats.length} managers to email`);

    for (const managerStats of stats) {
      await sendAnalyticsEmail(managerStats);
    }

    // Also send to admin
    const adminEmail = "info@apex-financial.org";
    const totalStats: ManagerStats = {
      managerId: "admin",
      managerName: "Admin",
      managerEmail: adminEmail,
      totalLeads: stats.reduce((sum, s) => sum + s.totalLeads, 0),
      contacted: stats.reduce((sum, s) => sum + s.contacted, 0),
      qualified: stats.reduce((sum, s) => sum + s.qualified, 0),
      closed: stats.reduce((sum, s) => sum + s.closed, 0),
      closeRate: 0,
      newThisWeek: stats.reduce((sum, s) => sum + s.newThisWeek, 0),
      staleLeads: stats.reduce((sum, s) => sum + s.staleLeads, 0),
    };
    totalStats.closeRate = totalStats.totalLeads > 0 
      ? (totalStats.closed / totalStats.totalLeads) * 100 
      : 0;

    await sendAnalyticsEmail(totalStats);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Sent analytics to ${stats.length} managers and admin` 
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error in weekly analytics:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);
