import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RESEND_URL = "https://api.resend.com/emails";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendKey = Deno.env.get("RESEND_API_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Get top producer last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: production } = await supabase
      .from("daily_production")
      .select("agent_id, aop, deals_closed")
      .gte("production_date", thirtyDaysAgo.toISOString().split("T")[0]);

    if (!production || production.length === 0) {
      return new Response(JSON.stringify({ message: "No production data" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Aggregate by agent
    const agentTotals = new Map<string, { alp: number; deals: number }>();
    production.forEach(p => {
      const existing = agentTotals.get(p.agent_id) || { alp: 0, deals: 0 };
      existing.alp += Number(p.aop) || 0;
      existing.deals += Number(p.deals_closed) || 0;
      agentTotals.set(p.agent_id, existing);
    });

    // Find top producer
    let topAgentId = "";
    let topAlp = 0;
    agentTotals.forEach((stats, agentId) => {
      if (stats.alp > topAlp) {
        topAlp = stats.alp;
        topAgentId = agentId;
      }
    });

    if (!topAgentId || topAlp < 1000) {
      return new Response(JSON.stringify({ message: "No qualifying producer" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get agent details
    const { data: agent } = await supabase
      .from("agents")
      .select("id, display_name, profile_id")
      .eq("id", topAgentId)
      .single();

    let agentName = agent?.display_name || "Unknown";
    let agentPhotoUrl = "";

    if (agent?.profile_id) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, avatar_url")
        .eq("id", agent.profile_id)
        .single();
      if (profile?.full_name) agentName = profile.full_name;
      if (profile?.avatar_url) agentPhotoUrl = profile.avatar_url;
    }

    const firstName = agentName.split(" ")[0];
    const alpFormatted = `$${topAlp.toLocaleString("en-US", { minimumFractionDigits: 0 })}`;
    const topStats = agentTotals.get(topAgentId)!;

    // Determine achievement label
    let achievementLabel = `${alpFormatted} in 30 Days`;
    let achievementIcon = "👑";
    if (topAlp >= 40000) { achievementLabel = `${alpFormatted} Machine Mode`; achievementIcon = "🚀"; }
    else if (topAlp >= 25000) { achievementLabel = `${alpFormatted} Month`; achievementIcon = "👑"; }
    else if (topStats.deals >= 15) { achievementLabel = `${topStats.deals} Deals in 30 Days`; achievementIcon = "⚡"; }

    // Build email
    const photoSection = agentPhotoUrl
      ? `<div style="position:relative;margin:24px 32px;border-radius:12px;overflow:hidden">
           <img src="${agentPhotoUrl}" style="width:100%;height:300px;object-fit:cover;object-position:center top;filter:brightness(0.7)">
           <div style="position:absolute;bottom:0;left:0;right:0;padding:24px;background:linear-gradient(transparent,#030712)">
             <div style="font-size:42px;font-weight:800;color:#22d3a5;font-family:'Syne',sans-serif;line-height:1">${achievementIcon} ${alpFormatted}</div>
             <div style="font-size:16px;color:rgba(255,255,255,0.7);margin-top:4px">${agentName} · ${achievementLabel}</div>
           </div>
         </div>`
      : `<div style="margin:24px 32px;padding:32px;border-radius:12px;background:linear-gradient(135deg,#0f172a,#1e293b);text-align:center">
           <div style="font-size:48px;font-weight:800;color:#22d3a5;font-family:'Syne',sans-serif">${achievementIcon} ${alpFormatted}</div>
           <div style="font-size:18px;color:rgba(255,255,255,0.7);margin-top:8px">${agentName} · ${achievementLabel}</div>
         </div>`;

    const html = `<div style="background:#030712;font-family:'DM Sans',sans-serif;max-width:600px;margin:0 auto">
      <div style="height:3px;background:linear-gradient(90deg,#22d3a5,#0ea5e9)"></div>
      <div style="padding:32px 32px 0;text-align:center">
        <div style="font-size:11px;letter-spacing:4px;color:#22d3a5;text-transform:uppercase;margin-bottom:8px">APEX FINANCIAL · DAILY SPOTLIGHT</div>
      </div>
      ${photoSection}
      <div style="padding:0 32px 32px">
        <p style="font-size:16px;line-height:1.8;color:rgba(255,255,255,0.8);margin:0 0 24px">
          In less time than it takes most people to decide if this is real, <strong style="color:white">${firstName}</strong> built a machine. No leads handed to them. No shortcuts. Pure execution on the system we all have access to.
        </p>
        <p style="font-size:14px;color:#64748b;margin:0 0 32px">What's the difference between you and them right now? One logged their numbers. Log yours today.</p>
        <a href="https://rebuild-brighten-sparkle.lovable.app/agent-portal" style="display:block;text-align:center;background:#22d3a5;color:#030712;padding:16px;border-radius:8px;font-weight:700;font-size:15px;text-decoration:none;font-family:'Syne',sans-serif;letter-spacing:0.5px">
          LOG TODAY'S NUMBERS →
        </a>
      </div>
      <div style="height:3px;background:linear-gradient(90deg,#22d3a5,#0ea5e9)"></div>
    </div>`;

    // Get all active agent emails
    const { data: allAgents } = await supabase
      .from("agents")
      .select("profile_id")
      .or("is_deactivated.is.null,is_deactivated.eq.false");

    const profileIds = (allAgents || []).map(a => a.profile_id).filter(Boolean);
    const { data: emails } = await supabase
      .from("profiles")
      .select("email")
      .in("id", profileIds);

    const recipientEmails = (emails || []).map(e => e.email).filter(Boolean);

    // Send email to all agents (batch in groups of 50)
    let sent = 0;
    for (let i = 0; i < recipientEmails.length; i += 50) {
      const batch = recipientEmails.slice(i, i + 50);
      const res = await fetch(RESEND_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "APEX Financial <spotlight@rebuildbrightenseattle.com>",
          to: batch,
          subject: `${achievementIcon} ${agentName} just hit ${alpFormatted} — Daily Spotlight`,
          html,
        }),
      });
      if (res.ok) sent += batch.length;
    }

    return new Response(JSON.stringify({ success: true, sent, agent: agentName, alp: topAlp }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
