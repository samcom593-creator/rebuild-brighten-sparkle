import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Yesterday
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split("T")[0];

    // This week
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const weekStartStr = weekStart.toISOString().split("T")[0];

    // Active agents
    const { data: activeAgents } = await supabase
      .from("agents")
      .select("id, display_name, profiles(full_name, email)")
      .eq("is_deactivated", false)
      .eq("status", "active");

    const activeIds = (activeAgents || []).map((a: any) => a.id);

    // Yesterday production
    const { data: yesterdayProd } = await supabase
      .from("daily_production")
      .select("agent_id, aop, deals_closed, presentations")
      .eq("production_date", yesterdayStr)
      .in("agent_id", activeIds);

    const totalALP = yesterdayProd?.reduce((s: number, r: any) => s + Number(r.aop || 0), 0) || 0;
    const totalDeals = yesterdayProd?.reduce((s: number, r: any) => s + Number(r.deals_closed || 0), 0) || 0;
    const agentsProduced = yesterdayProd?.filter((r: any) => Number(r.aop) > 0).length || 0;
    const agentsNotProduced = activeIds.length - agentsProduced;

    const topProducer = [...(yesterdayProd || [])].sort((a: any, b: any) => Number(b.aop) - Number(a.aop))[0];
    const topName = topProducer
      ? (activeAgents || []).find((a: any) => a.id === topProducer.agent_id)?.display_name ||
        (activeAgents || []).find((a: any) => a.id === topProducer.agent_id)?.profiles?.full_name || "Unknown"
      : "N/A";

    // Week running total
    const { data: weekProd } = await supabase
      .from("daily_production")
      .select("aop")
      .in("agent_id", activeIds)
      .gte("production_date", weekStartStr);

    const weekTotal = weekProd?.reduce((s: number, r: any) => s + Number(r.aop || 0), 0) || 0;

    // Agents who didn't log
    const producedIds = (yesterdayProd || []).filter((r: any) => Number(r.aop) > 0).map((r: any) => r.agent_id);
    const didNotLog = (activeAgents || [])
      .filter((a: any) => !producedIds.includes(a.id))
      .map((a: any) => a.display_name || a.profiles?.full_name || "Unknown");

    // Send to Sam
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (resendKey) {
      const { Resend } = await import("https://esm.sh/resend@2.0.0");
      const resend = new Resend(resendKey);

      await resend.emails.send({
        from: "APEX System <sam@apex-financial.org>",
        to: "sam@apex-financial.org",
        subject: `📊 Morning Report — $${totalALP.toLocaleString()} ALP Yesterday`,
        html: `
          <div style="font-family:'DM Sans',sans-serif;max-width:600px;margin:0 auto;background:#030712;color:white;padding:32px">
            <div style="font-size:11px;letter-spacing:4px;color:#22d3a5;text-transform:uppercase;margin-bottom:16px">APEX FINANCIAL · DAILY REPORT</div>
            <h1 style="font-family:'Syne',sans-serif;font-size:28px;font-weight:800;margin:0 0 24px">Yesterday's Summary</h1>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px">
              <div style="background:#0f172a;padding:16px;border-radius:12px">
                <div style="font-size:11px;color:#64748b;text-transform:uppercase">Total ALP</div>
                <div style="font-size:28px;font-weight:800;color:#22d3a5">$${totalALP.toLocaleString()}</div>
              </div>
              <div style="background:#0f172a;padding:16px;border-radius:12px">
                <div style="font-size:11px;color:#64748b;text-transform:uppercase">Total Deals</div>
                <div style="font-size:28px;font-weight:800;color:white">${totalDeals}</div>
              </div>
            </div>
            <div style="margin-bottom:16px">
              <strong>Top Producer:</strong> ${topName} — $${topProducer ? Number(topProducer.aop).toLocaleString() : '0'}
            </div>
            <div style="margin-bottom:16px">
              <strong>Agents Produced:</strong> ${agentsProduced} / ${activeIds.length}
            </div>
            <div style="margin-bottom:16px">
              <strong>Week Running Total:</strong> $${weekTotal.toLocaleString()}
            </div>
            ${didNotLog.length > 0 ? `
            <div style="margin-bottom:16px">
              <strong style="color:#f87171">Didn't Log (${didNotLog.length}):</strong><br/>
              <span style="color:#94a3b8">${didNotLog.join(", ")}</span>
            </div>
            ` : ""}
          </div>
        `,
      });
    }

    return new Response(JSON.stringify({ success: true, totalALP, totalDeals, agentsProduced }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("send-sam-morning-report error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
