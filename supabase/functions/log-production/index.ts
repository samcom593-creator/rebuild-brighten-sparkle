import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { action, ...params } = await req.json();

    // ACTION: search — find agents by name/email
    if (action === "search") {
      const query = (params.query || "").toLowerCase().trim();
      if (!query) {
        return new Response(JSON.stringify({ agents: [] }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: agents, error } = await supabaseAdmin
        .from("agents")
        .select(`
          id,
          onboarding_stage,
          profile:profiles!agents_profile_id_fkey(full_name, email)
        `)
        .eq("is_deactivated", false);

      if (error) throw error;

      const matches = (agents || [])
        .filter((a: any) => {
          const name = a.profile?.full_name?.toLowerCase() || "";
          const email = a.profile?.email?.toLowerCase() || "";
          return name.includes(query) || email.includes(query);
        })
        .map((a: any) => ({
          id: a.id,
          name: a.profile?.full_name || "Unknown",
          email: a.profile?.email || "",
          onboardingStage: a.onboarding_stage,
        }));

      return new Response(JSON.stringify({ agents: matches }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ACTION: load-existing — get today's production for an agent
    if (action === "load-existing") {
      const { agentId, date } = params;
      const { data, error } = await supabaseAdmin
        .from("daily_production")
        .select("*")
        .eq("agent_id", agentId)
        .eq("production_date", date)
        .maybeSingle();

      if (error) throw error;

      return new Response(JSON.stringify({ data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ACTION: submit — upsert daily production
    if (action === "submit") {
      const { agentId, date, productionData } = params;

      const { error } = await supabaseAdmin
        .from("daily_production")
        .upsert(
          {
            agent_id: agentId,
            production_date: date,
            ...productionData,
            hours_called: Number(productionData.hours_called),
            aop: Number(productionData.aop),
          },
          { onConflict: "agent_id,production_date" }
        );

      if (error) throw error;

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ACTION: leaderboard — weekly leaderboard
    if (action === "leaderboard") {
      const { weekStart, currentAgentId } = params;

      const [agentsResult, prodResult] = await Promise.all([
        supabaseAdmin
          .from("agents")
          .select(`
            id,
            profile:profiles!agents_profile_id_fkey(full_name)
          `)
          .eq("is_deactivated", false),
        supabaseAdmin
          .from("daily_production")
          .select("agent_id, aop, deals_closed, presentations")
          .gte("production_date", weekStart),
      ]);

      if (agentsResult.error) throw agentsResult.error;
      if (prodResult.error) throw prodResult.error;

      const agentMap = new Map<string, any>();
      for (const agent of agentsResult.data || []) {
        agentMap.set(agent.id, {
          agentId: agent.id,
          agentName: (agent as any).profile?.full_name || "Unknown",
          weeklyALP: 0,
          weeklyDeals: 0,
          weeklyPresentations: 0,
          closingRate: 0,
          rank: 0,
        });
      }

      for (const prod of prodResult.data || []) {
        const entry = agentMap.get(prod.agent_id);
        if (entry) {
          entry.weeklyALP += Number(prod.aop) || 0;
          entry.weeklyDeals += prod.deals_closed || 0;
          entry.weeklyPresentations += prod.presentations || 0;
        }
      }

      const entries = Array.from(agentMap.values())
        .map((e: any) => ({
          ...e,
          closingRate:
            e.weeklyPresentations > 0
              ? Math.round((e.weeklyDeals / e.weeklyPresentations) * 100)
              : 0,
        }))
        .sort((a: any, b: any) => b.weeklyALP - a.weeklyALP)
        .map((e: any, idx: number) => ({ ...e, rank: idx + 1 }));

      return new Response(JSON.stringify({ entries }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("log-production error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
