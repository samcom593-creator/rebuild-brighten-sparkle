import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import { Resend } from "https://esm.sh/resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

    const { testEmail } = await req.json();

    console.log("Sending monthly motivation emails...");

    // Calculate week start (Sunday)
    const now = new Date();
    const dayOfWeek = now.getDay();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - dayOfWeek);
    weekStart.setHours(0, 0, 0, 0);
    const weekStartStr = weekStart.toISOString().split("T")[0];

    // Get all live agents
    const { data: agents, error: agentsError } = await supabase
      .from("agents")
      .select(`
        id,
        profile_id
      `)
      .eq("onboarding_stage", "evaluated")
      .eq("is_deactivated", false);

    if (agentsError) throw agentsError;

    // Get profiles for all agents
    const profileIds = (agents || []).map(a => a.profile_id).filter(Boolean);
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", profileIds);

    const profileMap = new Map((profiles || []).map(p => [p.id, p]));

    // Get this week's production for all agents
    const { data: production, error: prodError } = await supabase
      .from("daily_production")
      .select("agent_id, aop")
      .gte("production_date", weekStartStr);

    if (prodError) throw prodError;

    // Calculate weekly ALP per agent
    const agentWeeklyALP = new Map<string, number>();
    for (const prod of production || []) {
      const current = agentWeeklyALP.get(prod.agent_id) || 0;
      agentWeeklyALP.set(prod.agent_id, current + (Number(prod.aop) || 0));
    }

    // Filter agents below $5,000 for the week
    const lowPerformers = (agents || []).filter(agent => {
      const weeklyALP = agentWeeklyALP.get(agent.id) || 0;
      const profile = profileMap.get(agent.profile_id);
      return weeklyALP < 5000 && profile?.email;
    });

    console.log(`Found ${lowPerformers.length} agents below $5k this week`);

    const emailsSent: string[] = [];
    const errors: string[] = [];

    for (const agent of lowPerformers) {
      const profile = profileMap.get(agent.profile_id);
      const agentName = profile?.full_name || "Agent";
      const agentEmail = testEmail || profile?.email;
      const weeklyALP = agentWeeklyALP.get(agent.id) || 0;

      if (!agentEmail) continue;

      const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#0a0a0a;color:#ffffff;">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
    <div style="text-align:center;margin-bottom:32px;">
      <h1 style="font-size:28px;font-weight:bold;margin:0;background:linear-gradient(135deg,#14b8a6,#0ea5e9);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">APEX FINANCIAL</h1>
    </div>
    
    <div style="background:linear-gradient(145deg,#1a1a2e,#16213e);border-radius:16px;padding:32px;border:1px solid rgba(20,184,166,0.2);">
      <div style="text-align:center;margin-bottom:24px;">
        <span style="font-size:64px;">💪</span>
      </div>
      
      <h2 style="font-size:24px;margin:0 0 16px 0;color:#14b8a6;text-align:center;">Prepare for February!</h2>
      
      <p style="font-size:16px;line-height:1.6;color:#d1d5db;margin:0 0 24px 0;">
        Hey ${agentName},
      </p>
      
      <p style="font-size:16px;line-height:1.6;color:#d1d5db;margin:0 0 24px 0;">
        We're wrapping up January and heading into a brand new month. This is YOUR moment to finish strong!
      </p>
      
      <!-- Current Week Stats -->
      <div style="background:rgba(239,68,68,0.1);border-radius:8px;padding:20px;margin:24px 0;border:1px solid rgba(239,68,68,0.3);">
        <h3 style="font-size:16px;color:#f87171;margin:0 0 12px 0;">📊 Your Current Week</h3>
        <p style="font-size:14px;color:#d1d5db;margin:0;">
          You're currently at <strong style="color:#ffffff;font-size:20px;">$${weeklyALP.toLocaleString()}</strong> this week.<br><br>
          The standard we know is <strong style="color:#14b8a6;">$20,000/month</strong> to stay competitive.
        </p>
      </div>
      
      <!-- February Goals -->
      <div style="background:rgba(20,184,166,0.1);border-radius:8px;padding:20px;margin:24px 0;">
        <h3 style="font-size:16px;color:#14b8a6;margin:0 0 12px 0;">🎯 Set Your February Goals</h3>
        <p style="font-size:14px;color:#d1d5db;margin:0;">
          What are you going to crush next month?<br><br>
          • How many presentations will you commit to?<br>
          • What's your ALP target?<br>
          • How will you beat last month?
        </p>
      </div>
      
      <!-- Finish Strong -->
      <div style="background:linear-gradient(135deg,rgba(249,115,22,0.2),rgba(234,179,8,0.2));border-radius:8px;padding:20px;margin:24px 0;border:1px solid rgba(249,115,22,0.3);">
        <h3 style="font-size:16px;color:#f59e0b;margin:0 0 12px 0;">💡 Finish January Strong</h3>
        <p style="font-size:14px;color:#d1d5db;margin:0;">
          You still have today and tomorrow to make this month count.<br><br>
          Every presentation matters. Every deal counts.<br><br>
          <strong style="color:#ffffff;font-size:16px;">Let's go!</strong>
        </p>
      </div>
      
      <p style="font-size:14px;color:#9ca3af;margin:24px 0 0 0;text-align:center;">
        We believe in you.<br>
        <strong style="color:#ffffff;">— The Apex Team</strong>
      </p>
    </div>
    
    <p style="font-size:12px;color:#6b7280;text-align:center;margin-top:32px;">
      Powered by Apex Financial
    </p>
  </div>
</body>
</html>
      `;

      try {
        const { error: emailError } = await resend.emails.send({
          from: "APEX Financial <notifications@apex-financial.org>",
          to: [agentEmail],
          subject: `💪 Finish January Strong, ${agentName}!`,
          html: emailHtml,
        });

        if (emailError) {
          errors.push(`${agentEmail}: ${emailError.message}`);
        } else {
          emailsSent.push(agentEmail);
        }

        // If test mode, only send one email
        if (testEmail) break;
      } catch (err: any) {
        errors.push(`${agentEmail}: ${err.message}`);
      }
    }

    console.log(`Sent ${emailsSent.length} motivation emails`);
    if (errors.length > 0) {
      console.error("Errors:", errors);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        emailsSent: emailsSent.length,
        errors: errors.length,
        recipients: emailsSent 
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in send-monthly-motivation:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
