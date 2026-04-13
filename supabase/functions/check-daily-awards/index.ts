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
    const { agentId, alp, deals, date } = await req.json();
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const awards: { type: string; amount: number }[] = [];

    // GET AGENT INFO
    const { data: agent } = await supabase
      .from("agents")
      .select("id, display_name, profiles(full_name, email, phone)")
      .eq("id", agentId)
      .maybeSingle();

    const fullName = agent?.display_name || agent?.profiles?.full_name || "Agent";

    // AWARD 1: FIRST DEAL OF THE DAY
    if (deals > 0) {
      const { data: todayDeals } = await supabase
        .from("daily_production")
        .select("agent_id, deals_closed")
        .eq("production_date", date)
        .gt("deals_closed", 0)
        .neq("agent_id", agentId);

      if (!todayDeals || todayDeals.length === 0) {
        // Check if already awarded today
        const { data: existing } = await supabase
          .from("plaque_awards")
          .select("id")
          .eq("milestone_type", "first_deal_of_day")
          .eq("milestone_date", date)
          .maybeSingle();

        if (!existing) {
          await supabase.from("plaque_awards").insert({
            agent_id: agentId,
            milestone_type: "first_deal_of_day",
            milestone_date: date,
            amount: alp,
          });
          awards.push({ type: "first_deal_of_day", amount: alp });
        }
      }
    }

    // AWARD 2: FIRST DEAL EVER
    if (deals > 0) {
      const { count: previousDeals } = await supabase
        .from("daily_production")
        .select("id", { count: "exact", head: true })
        .eq("agent_id", agentId)
        .gt("deals_closed", 0)
        .neq("production_date", date);

      if (previousDeals === 0) {
        const { data: existing } = await supabase
          .from("plaque_awards")
          .select("id")
          .eq("agent_id", agentId)
          .eq("milestone_type", "first_deal_ever")
          .maybeSingle();

        if (!existing) {
          await supabase.from("plaque_awards").insert({
            agent_id: agentId,
            milestone_type: "first_deal_ever",
            milestone_date: date,
            amount: alp,
          });
          awards.push({ type: "first_deal_ever", amount: alp });
        }
      }
    }

    // AWARD 3: DIAMOND WEEK ($10K+)
    const weekStart = new Date(date);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const weekStartStr = weekStart.toISOString().split("T")[0];

    const { data: weekProd } = await supabase
      .from("daily_production")
      .select("aop")
      .eq("agent_id", agentId)
      .gte("production_date", weekStartStr);

    const weeklyTotal = weekProd?.reduce((s: number, r: any) => s + Number(r.aop || 0), 0) || 0;

    if (weeklyTotal >= 10000) {
      const { data: existingWeekAward } = await supabase
        .from("plaque_awards")
        .select("id")
        .eq("agent_id", agentId)
        .eq("milestone_type", "diamond_week")
        .gte("milestone_date", weekStartStr)
        .maybeSingle();

      if (!existingWeekAward) {
        await supabase.from("plaque_awards").insert({
          agent_id: agentId,
          milestone_type: "diamond_week",
          milestone_date: date,
          amount: weeklyTotal,
        });
        awards.push({ type: "diamond_week", amount: weeklyTotal });
      }
    }

    // AWARD 4: STREAK CHECK (5, 10, 20 consecutive days)
    let streak = 0;
    const checkDate = new Date(date);
    for (let i = 0; i < 60; i++) {
      const d = checkDate.toISOString().split("T")[0];
      const { count } = await supabase
        .from("daily_production")
        .select("id", { count: "exact", head: true })
        .eq("agent_id", agentId)
        .eq("production_date", d)
        .gt("deals_closed", 0);

      if ((count || 0) > 0) {
        streak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else {
        break;
      }
    }

    for (const milestone of [5, 10, 20]) {
      if (streak >= milestone) {
        const { data: existing } = await supabase
          .from("plaque_awards")
          .select("id")
          .eq("agent_id", agentId)
          .eq("milestone_type", `streak_${milestone}`)
          .gte("milestone_date", weekStartStr)
          .maybeSingle();

        if (!existing) {
          await supabase.from("plaque_awards").insert({
            agent_id: agentId,
            milestone_type: `streak_${milestone}`,
            milestone_date: date,
            amount: streak,
          });
          awards.push({ type: `streak_${milestone}`, amount: streak });
        }
      }
    }

    // Log awards to notification_log
    for (const award of awards) {
      await supabase.from("notification_log").insert({
        notification_type: `award_${award.type}`,
        recipient_email: agent?.profiles?.email || "",
        subject: `Award: ${award.type}`,
        body: `${fullName} received ${award.type} award for $${award.amount}`,
        status: "sent",
        agent_id: agentId,
      });
    }

    return new Response(JSON.stringify({ success: true, awards }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("check-daily-awards error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
