import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Team milestone thresholds for admin recognition
const TEAM_MILESTONES = [
  { type: "team_single_day_10k", threshold: 10000, window: 1, label: "TEAM $10K DAY", color: "#7DD3FC" },
  { type: "team_two_day_20k", threshold: 20000, window: 2, label: "TEAM $20K IN 2 DAYS", color: "#A78BFA" },
  { type: "team_single_day_25k", threshold: 25000, window: 1, label: "TEAM $25K DAY", color: "#F59E0B" },
  { type: "team_week_50k", threshold: 50000, window: 7, label: "TEAM $50K WEEK", color: "#EF4444" },
];

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("🏆 Starting team milestone check...");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get today's date in CST
    const now = new Date();
    const cstOffset = -6 * 60;
    const cstDate = new Date(now.getTime() + (cstOffset - now.getTimezoneOffset()) * 60000);
    const todayStr = cstDate.toISOString().split("T")[0];

    console.log(`📅 Checking team milestones for: ${todayStr}`);

    // Get admin user(s)
    const { data: adminRoles } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");

    if (!adminRoles?.length) {
      console.log("No admin users found");
      return new Response(JSON.stringify({ success: true, message: "No admins" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminUserIds = adminRoles.map(r => r.user_id);

    // Get admin emails
    const { data: adminProfiles } = await supabase
      .from("profiles")
      .select("user_id, full_name, email")
      .in("user_id", adminUserIds);

    const adminEmails = adminProfiles?.filter(p => p.email).map(p => p.email) || [];

    if (adminEmails.length === 0) {
      console.log("No admin emails found");
      return new Response(JSON.stringify({ success: true, message: "No admin emails" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: Array<{ milestone: string; total: number; success: boolean }> = [];

    for (const milestone of TEAM_MILESTONES) {
      // Calculate date range
      const startDate = new Date(cstDate);
      startDate.setDate(startDate.getDate() - (milestone.window - 1));
      const startStr = startDate.toISOString().split("T")[0];

      // Get team total for this window
      const { data: production } = await supabase
        .from("daily_production")
        .select("aop, production_date")
        .gte("production_date", startStr)
        .lte("production_date", todayStr);

      const totalALP = (production || []).reduce((sum, p) => sum + Number(p.aop || 0), 0);
      const roundedTotal = Math.round(totalALP);

      console.log(`📊 ${milestone.label}: $${roundedTotal.toLocaleString()} (threshold: $${milestone.threshold.toLocaleString()})`);

      if (roundedTotal < milestone.threshold) {
        continue; // Below threshold
      }

      // Check if already awarded
      const { data: existing } = await supabase
        .from("plaque_awards")
        .select("id")
        .eq("milestone_type", milestone.type)
        .eq("milestone_date", todayStr)
        .maybeSingle();

      if (existing) {
        console.log(`⏭️ Already awarded ${milestone.label} for ${todayStr}`);
        continue;
      }

      // Award the milestone - use first admin's agent ID if available
      const { data: adminAgent } = await supabase
        .from("agents")
        .select("id")
        .in("user_id", adminUserIds)
        .limit(1)
        .maybeSingle();

      if (adminAgent) {
        await supabase.from("plaque_awards").insert({
          agent_id: adminAgent.id,
          milestone_type: milestone.type,
          milestone_date: todayStr,
          amount: roundedTotal,
        });
      }

      // Format date range for email
      const dateRange = milestone.window === 1 
        ? new Date(todayStr).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
        : `${new Date(startStr).toLocaleDateString("en-US", { month: "short", day: "numeric" })} - ${new Date(todayStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

      // Generate team milestone email
      const emailHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=Inter:wght@300;400;500;600&display=swap');
          </style>
        </head>
        <body style="margin:0;padding:40px;background:#0a0a0a;font-family:'Inter',sans-serif;">
          <div style="max-width:560px;margin:0 auto;">
            
            <!-- Plaque Container -->
            <div style="background:linear-gradient(180deg,#141414 0%,#0a0a0a 100%);border:1px solid #2a2a2a;border-radius:4px;padding:48px;text-align:center;">
              
              <!-- Header Line -->
              <div style="width:60px;height:1px;background:${milestone.color};margin:0 auto 32px;"></div>
              
              <!-- Badge Type -->
              <p style="font-family:'Inter',sans-serif;font-size:11px;font-weight:500;letter-spacing:3px;color:#666;margin:0 0 24px;text-transform:uppercase;">
                ${milestone.label}
              </p>
              
              <!-- Team Name -->
              <h1 style="font-family:'Playfair Display',Georgia,serif;font-size:28px;font-weight:600;color:#ffffff;margin:0 0 8px;letter-spacing:1px;">
                APEX FINANCIAL TEAM
              </h1>
              
              <!-- Period -->
              <p style="font-family:'Inter',sans-serif;font-size:12px;font-weight:400;color:#888;margin:0 0 40px;letter-spacing:1px;">
                ${dateRange}
              </p>
              
              <!-- Amount -->
              <div style="background:#141414;border:1px solid #222;border-radius:2px;padding:24px 32px;margin:0 0 32px;display:inline-block;">
                <p style="font-family:'Playfair Display',Georgia,serif;font-size:42px;font-weight:700;color:${milestone.color};margin:0;">
                  $${roundedTotal.toLocaleString()}
                </p>
              </div>
              
              <!-- Description -->
              <p style="font-family:'Inter',sans-serif;font-size:13px;font-weight:400;color:#888;margin:0 0 8px;line-height:1.6;">
                Team Production Milestone Achieved
              </p>
              
              <p style="font-family:'Inter',sans-serif;font-size:11px;font-weight:400;color:#555;margin:0 0 40px;">
                Threshold: $${milestone.threshold.toLocaleString()}+
              </p>
              
              <!-- Footer Line -->
              <div style="width:60px;height:1px;background:#2a2a2a;margin:0 auto;"></div>
              
            </div>
            
            <!-- CTA -->
            <div style="text-align:center;margin-top:32px;">
              <a href="https://rebuild-brighten-sparkle.lovable.app/agent-portal" 
                 style="display:inline-block;background:${milestone.color};color:#000;font-weight:600;padding:14px 32px;border-radius:2px;text-decoration:none;font-size:13px;letter-spacing:0.5px;">
                View Dashboard
              </a>
            </div>
          </div>
        </body>
        </html>
      `;

      // Send email to all admins
      if (resendApiKey) {
        const resend = new Resend(resendApiKey);
        
        for (const email of adminEmails) {
          try {
            await resend.emails.send({
              from: "APEX Financial <notifications@tx.apex-financial.org>",
              to: [email],
              subject: `🏆 ${milestone.label}: $${roundedTotal.toLocaleString()}`,
              html: emailHtml,
            });
            console.log(`✅ Team milestone email sent to ${email}`);
          } catch (emailError) {
            console.error(`Failed to send to ${email}:`, emailError);
          }
        }
      }

      results.push({ milestone: milestone.label, total: roundedTotal, success: true });
    }

    console.log(`🏆 Team milestone check complete. Awards:`, results.length);

    return new Response(
      JSON.stringify({
        success: true,
        date: todayStr,
        results,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: unknown) {
    console.error("Error in check-team-milestones:", error);
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
