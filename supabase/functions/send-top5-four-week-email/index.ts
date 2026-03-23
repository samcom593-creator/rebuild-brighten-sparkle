import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

    // Rolling 4-week window
    const now = new Date();
    const fourWeeksAgo = new Date(now);
    fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
    const startDate = fourWeeksAgo.toISOString().split("T")[0];
    const endDate = now.toISOString().split("T")[0];

    // Get production data
    const { data: production, error: prodError } = await supabase
      .from("daily_production")
      .select("agent_id, aop, deals_closed, presentations")
      .gte("production_date", startDate)
      .lte("production_date", endDate);

    if (prodError) throw prodError;
    if (!production || production.length === 0) {
      return new Response(
        JSON.stringify({ success: true, sent: 0, reason: "no production data" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Aggregate by agent
    const totals: Record<string, { aop: number; deals: number; presentations: number }> = {};
    for (const row of production) {
      if (!totals[row.agent_id]) totals[row.agent_id] = { aop: 0, deals: 0, presentations: 0 };
      totals[row.agent_id].aop += Number(row.aop || 0);
      totals[row.agent_id].deals += Number(row.deals_closed || 0);
      totals[row.agent_id].presentations += Number(row.presentations || 0);
    }

    // Sort by AOP descending, take top 5
    const ranked = Object.entries(totals)
      .sort(([, a], [, b]) => b.aop - a.aop)
      .slice(0, 5);

    if (ranked.length === 0) {
      return new Response(
        JSON.stringify({ success: true, sent: 0, reason: "no agents" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get agent profiles
    const agentIds = ranked.map(([id]) => id);
    const { data: agents } = await supabase
      .from("agents")
      .select("id, profile:profiles!agents_profile_id_fkey(full_name, email)")
      .in("id", agentIds);

    const agentMap: Record<string, { name: string; email: string | null }> = {};
    for (const agent of agents || []) {
      const profile = agent.profile as any;
      agentMap[agent.id] = {
        name: profile?.full_name || "Agent",
        email: profile?.email || null,
      };
    }

    // Build top 5 list
    const top5 = ranked.map(([agentId, stats], idx) => ({
      rank: idx + 1,
      name: agentMap[agentId]?.name || "Agent",
      email: agentMap[agentId]?.email,
      aop: stats.aop,
      deals: stats.deals,
      closeRate: stats.presentations > 0 ? Math.round((stats.deals / stats.presentations) * 100) : 0,
    }));

    const medals = ["🥇", "🥈", "🥉", "4.", "5."];

    const tableRows = top5.map((agent, idx) => {
      const rowBg = idx === 0
        ? "background: linear-gradient(90deg, rgba(234,179,8,0.15) 0%, transparent 100%);"
        : idx < 3
          ? "background: linear-gradient(90deg, rgba(20,184,166,0.08) 0%, transparent 100%);"
          : "";
      return `
        <tr style="border-bottom: 1px solid #1e3a5f; ${rowBg}">
          <td style="padding: 14px 16px; font-size: ${idx < 3 ? '22px' : '14px'}; text-align: center; color: #94a3b8;">${medals[idx]}</td>
          <td style="padding: 14px 16px; color: #ffffff; font-weight: ${idx < 3 ? '700' : '400'}; font-size: ${idx === 0 ? '16px' : '14px'};">${agent.name}</td>
          <td style="padding: 14px 16px; text-align: right; color: #14b8a6; font-weight: 700; font-size: ${idx === 0 ? '16px' : '14px'};">$${agent.aop.toLocaleString()}</td>
          <td style="padding: 14px 16px; text-align: right; color: #94a3b8;">${agent.deals}</td>
          <td style="padding: 14px 16px; text-align: right; color: #94a3b8;">${agent.closeRate}%</td>
        </tr>`;
    }).join("");

    const buildEmailHtml = (recipientName: string, recipientRank: number) => `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#0a0f1a;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;">
  <div style="max-width:700px;margin:0 auto;padding:40px 20px;">
    <div style="text-align:center;margin-bottom:32px;">
      <h1 style="color:#14b8a6;font-size:28px;margin:0 0 8px 0;">🏆 4-Week Rolling Top 5</h1>
      <p style="color:#94a3b8;font-size:15px;margin:0;">
        ${recipientName}, you're currently <strong style="color:#eab308;">#${recipientRank}</strong> in the agency!
      </p>
      <p style="color:#64748b;font-size:12px;margin:8px 0 0 0;">${startDate} → ${endDate}</p>
    </div>
    <div style="background:linear-gradient(145deg,#0f172a 0%,#1e293b 100%);border-radius:16px;border:1px solid #1e3a5f;overflow:hidden;margin-bottom:32px;">
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="background:#0f172a;border-bottom:2px solid #14b8a6;">
            <th style="padding:12px 16px;text-align:center;color:#64748b;font-size:11px;text-transform:uppercase;">Rank</th>
            <th style="padding:12px 16px;text-align:left;color:#64748b;font-size:11px;text-transform:uppercase;">Agent</th>
            <th style="padding:12px 16px;text-align:right;color:#64748b;font-size:11px;text-transform:uppercase;">ALP</th>
            <th style="padding:12px 16px;text-align:right;color:#64748b;font-size:11px;text-transform:uppercase;">Deals</th>
            <th style="padding:12px 16px;text-align:right;color:#64748b;font-size:11px;text-transform:uppercase;">Close %</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
    <div style="background:linear-gradient(135deg,#14b8a6 0%,#0d9488 100%);border-radius:12px;padding:24px;text-align:center;margin-bottom:32px;">
      <h2 style="color:#ffffff;font-size:20px;margin:0 0 12px 0;">Keep pushing! Every deal counts 🔥</h2>
      <a href="https://rebuild-brighten-sparkle.lovable.app/agent-portal" style="display:inline-block;background:#0a0f1a;color:#14b8a6;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
        Log Today's Numbers →
      </a>
    </div>
    <div style="text-align:center;padding-top:24px;border-top:1px solid #1e3a5f;">
      <p style="color:#64748b;font-size:12px;margin:0;">APEX Financial • Top 5 Daily Update</p>
    </div>
  </div>
</body>
</html>`;

    // Send to each top 5 agent
    let sentCount = 0;
    for (const agent of top5) {
      if (!agent.email) continue;
      try {
        await resend.emails.send({
          from: "APEX Financial <notifications@apex-financial.org>",
          to: [agent.email],
          cc: ["sam@apex-financial.org"],
          subject: `🏆 You're #${agent.rank} in the 4-Week Top 5! $${agent.aop.toLocaleString()} ALP`,
          html: buildEmailHtml(agent.name, agent.rank),
        });
        sentCount++;
        await new Promise((r) => setTimeout(r, 300));
      } catch (emailError) {
        console.error(`Failed to send to ${agent.email}:`, emailError);
      }
    }

    console.log(`Top 5 four-week email sent to ${sentCount} agents`);

    return new Response(
      JSON.stringify({ success: true, sentCount, top5: top5.map(a => ({ name: a.name, rank: a.rank, aop: a.aop })) }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error in send-top5-four-week-email:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
