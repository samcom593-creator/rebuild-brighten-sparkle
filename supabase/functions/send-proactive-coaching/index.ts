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

    const { agentId } = await req.json();

    if (!agentId) {
      return new Response(JSON.stringify({ error: "agentId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get agent + profile
    const { data: agent } = await supabase
      .from("agents")
      .select("id, display_name, profile_id, total_policies, total_premium, total_earnings, created_at")
      .eq("id", agentId)
      .single();

    if (!agent) {
      return new Response(JSON.stringify({ error: "Agent not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("email, full_name")
      .eq("id", agent.profile_id)
      .single();

    if (!profile?.email) {
      return new Response(JSON.stringify({ error: "No email found" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get recent 14-day production
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const { data: recentProd } = await supabase
      .from("daily_production")
      .select("deals_closed, aop, presentations, closing_rate, production_date")
      .eq("agent_id", agentId)
      .gte("production_date", fourteenDaysAgo);

    const totalDeals = (recentProd || []).reduce((s, p) => s + p.deals_closed, 0);
    const totalALP = (recentProd || []).reduce((s, p) => s + Number(p.aop), 0);
    const totalPresentations = (recentProd || []).reduce((s, p) => s + p.presentations, 0);
    const avgCloseRate = totalPresentations > 0 ? Math.round((totalDeals / totalPresentations) * 100) : 0;

    const name = profile.full_name || agent.display_name || "Agent";
    const firstName = name.split(" ")[0];

    // Determine coaching focus
    let subject: string;
    let coachingHtml: string;

    if (totalDeals === 0) {
      subject = `${firstName}, let's get you back on track 💪`;
      coachingHtml = `
        <h2 style="color:#22d3a5;">Hey ${firstName},</h2>
        <p>I noticed you haven't closed any deals in the last 2 weeks. That's okay — every top producer has dry spells.</p>
        <p><strong>Here's what the top 10% do differently:</strong></p>
        <ul>
          <li>🎯 Make at least 30 dials per day</li>
          <li>📋 Book 2-3 presentations daily</li>
          <li>🔄 Follow up with every "not now" within 48 hours</li>
        </ul>
        <p>Your manager is here to help. Reach out for a 1-on-1 strategy session!</p>
      `;
    } else if (avgCloseRate < 30) {
      subject = `${firstName}, boost your closing rate with this tip 🎯`;
      coachingHtml = `
        <h2 style="color:#22d3a5;">Coaching Alert: Closing Rate</h2>
        <p>Your closing rate this period is <strong>${avgCloseRate}%</strong>. Our top agents average 45-55%.</p>
        <p><strong>3 quick wins to improve:</strong></p>
        <ol>
          <li>Ask more qualifying questions upfront — disqualify faster</li>
          <li>Use the "feel-felt-found" technique for objections</li>
          <li>Always present 3 options (good, better, best)</li>
        </ol>
        <p>You've got ${totalDeals} deals this period — imagine doubling that with a higher close rate!</p>
      `;
    } else {
      subject = `${firstName}, you're crushing it! Keep this momentum 🔥`;
      coachingHtml = `
        <h2 style="color:#22d3a5;">Great Work, ${firstName}!</h2>
        <p>Your stats this period:</p>
        <ul>
          <li>📊 ${totalDeals} deals closed</li>
          <li>💰 $${totalALP.toLocaleString()} ALP</li>
          <li>🎯 ${avgCloseRate}% close rate</li>
        </ul>
        <p><strong>Challenge:</strong> Can you beat last period? Set a stretch goal and go for it!</p>
      `;
    }

    const html = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
      ${coachingHtml}
      <hr style="border:none;border-top:1px solid #333;margin:20px 0;">
      <p style="color:#888;font-size:12px;">Powered by APEX Financial AI Coaching</p>
    </div>`;

    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "APEX Coaching <coaching@rebuildbrightenseattle.com>",
        to: [profile.email],
        subject,
        html,
      }),
    });

    return new Response(JSON.stringify({ success: res.ok, focus: totalDeals === 0 ? "reactivation" : avgCloseRate < 30 ? "closing_rate" : "momentum" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
