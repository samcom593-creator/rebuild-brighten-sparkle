import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("👥 Starting recruiting milestones check...");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get today's date in CST (UTC-6)
    const now = new Date();
    const cstOffset = -6 * 60;
    const cstDate = new Date(now.getTime() + (cstOffset - now.getTimezoneOffset()) * 60000);
    const todayStr = cstDate.toISOString().split("T")[0];

    // Calculate week start (Sunday)
    const dayOfWeek = cstDate.getDay();
    const weekStart = new Date(cstDate);
    weekStart.setDate(cstDate.getDate() - dayOfWeek);
    const weekStartStr = weekStart.toISOString().split("T")[0];

    console.log(`📅 Checking recruiting for: ${todayStr} (week started: ${weekStartStr})`);

    // Fetch applications contracted today
    const { data: dailyContracts, error: dailyError } = await supabase
      .from("applications")
      .select("id, assigned_agent_id, contracted_at")
      .gte("contracted_at", `${todayStr}T00:00:00`)
      .lt("contracted_at", `${todayStr}T23:59:59.999`)
      .not("assigned_agent_id", "is", null);

    if (dailyError) {
      console.error("Error fetching daily contracts:", dailyError);
      throw dailyError;
    }

    // Group by recruiter (assigned_agent_id)
    const dailyRecruiterCounts: Record<string, number> = {};
    dailyContracts?.forEach((app) => {
      if (app.assigned_agent_id) {
        dailyRecruiterCounts[app.assigned_agent_id] = (dailyRecruiterCounts[app.assigned_agent_id] || 0) + 1;
      }
    });

    console.log(`📊 Daily recruiting counts:`, dailyRecruiterCounts);

    // Define daily recruiting tiers (check highest first)
    const dailyTiers = [
      { type: "hiring_champion", threshold: 5, badge: "HIRING CHAMPION" },
      { type: "recruiter_rising", threshold: 3, badge: "RECRUITER RISING" },
    ];

    const results: Array<{ agentId: string; count: number; tier: string; success: boolean; error?: string }> = [];

    // Process daily achievements
    for (const [recruiterId, count] of Object.entries(dailyRecruiterCounts)) {
      const qualifiedTier = dailyTiers.find(tier => count >= tier.threshold);
      
      if (!qualifiedTier) continue;

      // Check for existing award
      const { data: existingAward } = await supabase
        .from("plaque_awards")
        .select("id")
        .eq("agent_id", recruiterId)
        .eq("milestone_type", qualifiedTier.type)
        .eq("milestone_date", todayStr)
        .maybeSingle();

      if (existingAward) {
        console.log(`⏭️ Agent ${recruiterId} already has ${qualifiedTier.badge} for ${todayStr}`);
        continue;
      }

      try {
        console.log(`🎖️ Awarding ${qualifiedTier.badge} to recruiter ${recruiterId}: ${count} hires`);

        // Record the award
        await supabase.from("plaque_awards").insert({
          agent_id: recruiterId,
          milestone_type: qualifiedTier.type,
          milestone_date: todayStr,
          amount: count,
        });

        // Send the plaque
        const response = await fetch(`${supabaseUrl}/functions/v1/send-plaque-recognition`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseKey}`,
          },
          body: JSON.stringify({
            agentId: recruiterId,
            milestoneType: qualifiedTier.type,
            amount: count,
            date: todayStr,
          }),
        });

        await response.json();
        results.push({ agentId: recruiterId, count, tier: qualifiedTier.badge, success: response.ok });
        console.log(`✅ ${qualifiedTier.badge} plaque sent to recruiter ${recruiterId}`);
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : "Unknown error";
        console.error(`❌ Failed to process recruiter ${recruiterId}:`, err);
        results.push({ agentId: recruiterId, count, tier: qualifiedTier.badge, success: false, error: errorMessage });
      }
    }

    // Weekly check - Team Builder (10+ contracts in a week)
    // Only run on Saturday (end of week)
    if (cstDate.getDay() === 6) {
      console.log("📆 Saturday - checking weekly Team Builder milestone...");
      
      const { data: weeklyContracts, error: weeklyError } = await supabase
        .from("applications")
        .select("id, assigned_agent_id")
        .gte("contracted_at", `${weekStartStr}T00:00:00`)
        .lte("contracted_at", `${todayStr}T23:59:59.999`)
        .not("assigned_agent_id", "is", null);

      if (!weeklyError && weeklyContracts) {
        const weeklyRecruiterCounts: Record<string, number> = {};
        weeklyContracts.forEach((app) => {
          if (app.assigned_agent_id) {
            weeklyRecruiterCounts[app.assigned_agent_id] = (weeklyRecruiterCounts[app.assigned_agent_id] || 0) + 1;
          }
        });

        for (const [recruiterId, count] of Object.entries(weeklyRecruiterCounts)) {
          if (count < 10) continue;

          // Check for existing weekly award
          const { data: existingAward } = await supabase
            .from("plaque_awards")
            .select("id")
            .eq("agent_id", recruiterId)
            .eq("milestone_type", "team_builder")
            .eq("milestone_date", todayStr)
            .maybeSingle();

          if (existingAward) continue;

          try {
            console.log(`🎖️ Awarding TEAM BUILDER to recruiter ${recruiterId}: ${count} weekly hires`);

            await supabase.from("plaque_awards").insert({
              agent_id: recruiterId,
              milestone_type: "team_builder",
              milestone_date: todayStr,
              amount: count,
            });

            const response = await fetch(`${supabaseUrl}/functions/v1/send-plaque-recognition`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${supabaseKey}`,
              },
              body: JSON.stringify({
                agentId: recruiterId,
                milestoneType: "team_builder",
                amount: count,
                date: todayStr,
              }),
            });

            await response.json();
            results.push({ agentId: recruiterId, count, tier: "TEAM BUILDER", success: response.ok });
          } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : "Unknown error";
            results.push({ agentId: recruiterId, count, tier: "TEAM BUILDER", success: false, error: errorMessage });
          }
        }
      }
    }

    console.log(`👥 Recruiting milestones check complete: ${results.length} awards`);

    return new Response(
      JSON.stringify({
        success: true,
        date: todayStr,
        weekStart: weekStartStr,
        results,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: unknown) {
    console.error("Error in check-recruiting-milestones:", error);
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
