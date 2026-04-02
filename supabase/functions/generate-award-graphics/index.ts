import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Display name aliases
const DISPLAY_ALIASES: Record<string, string> = {
  "Mahmod Imran": "MOODY",
  "Kaeden Vaughns": "KJ",
  "Chukwudi Ifediora": "CHUDI",
  "Obiajulu Ifediora": "OBI",
  "KJ Vaughns": "KJ",
};

function getDisplayName(fullName: string): string {
  return DISPLAY_ALIASES[fullName] || fullName.split(" ")[0].toUpperCase();
}

function getDateRange(
  timePeriod: string,
  customStart?: string,
  customEnd?: string
): { start: string; end: string; label: string } {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const dayOfWeek = now.getDay();

  switch (timePeriod) {
    case "today":
      return { start: today, end: today, label: "AP TODAY" };
    case "yesterday": {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      const ys = y.toISOString().slice(0, 10);
      return { start: ys, end: ys, label: "AP YESTERDAY" };
    }
    case "this_week": {
      const monday = new Date(now);
      monday.setDate(monday.getDate() - ((dayOfWeek + 6) % 7));
      return {
        start: monday.toISOString().slice(0, 10),
        end: today,
        label: "AP THIS WEEK",
      };
    }
    case "last_week": {
      const lastMon = new Date(now);
      lastMon.setDate(lastMon.getDate() - ((dayOfWeek + 6) % 7) - 7);
      const lastSun = new Date(lastMon);
      lastSun.setDate(lastSun.getDate() + 6);
      return {
        start: lastMon.toISOString().slice(0, 10),
        end: lastSun.toISOString().slice(0, 10),
        label: "AP LAST WEEK",
      };
    }
    case "this_month": {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      return {
        start: firstDay.toISOString().slice(0, 10),
        end: today,
        label: "AP THIS MONTH",
      };
    }
    case "last_month": {
      const firstLast = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastDayLast = new Date(now.getFullYear(), now.getMonth(), 0);
      return {
        start: firstLast.toISOString().slice(0, 10),
        end: lastDayLast.toISOString().slice(0, 10),
        label: "AP LAST MONTH",
      };
    }
    case "custom_range":
      return {
        start: customStart || today,
        end: customEnd || today,
        label: "AP CUSTOM",
      };
    default:
      return { start: today, end: today, label: "AP TODAY" };
  }
}

function formatCurrency(amount: number): string {
  return "$" + Math.round(amount).toLocaleString("en-US");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      time_period = "today",
      metric_type = "AP",
      auto_publish = false,
      custom_start,
      custom_end,
    } = await req.json();

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Calculate date range
    const { start, end, label } = getDateRange(
      time_period,
      custom_start,
      custom_end
    );

    // 2. Query production data
    const { data: prodData, error: prodError } = await supabase.rpc(
      "get_agent_production_stats",
      { start_date: start, end_date: end }
    );

    if (prodError) throw new Error(`Production query failed: ${prodError.message}`);
    if (!prodData || prodData.length === 0) {
      return new Response(
        JSON.stringify({
          status: "data_review_required",
          message: "No production data found for the selected period",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Get agent details (names + avatars)
    const agentIds = prodData.map((p: any) => p.agent_id);
    const { data: agents } = await supabase
      .from("agents")
      .select("id, display_name, user_id, profile:profiles!agents_profile_id_fkey(full_name, avatar_url)")
      .in("id", agentIds);

    // Also get profiles by user_id for avatar
    const userIds = (agents || []).filter((a: any) => a.user_id).map((a: any) => a.user_id);
    const { data: profilesByUser } = userIds.length > 0
      ? await supabase
          .from("profiles")
          .select("user_id, full_name, avatar_url")
          .in("user_id", userIds)
      : { data: [] };

    const agentMap: Record<string, { name: string; avatar_url: string | null }> = {};
    for (const a of agents || []) {
      const profileViaFK = a.profile as any;
      const profileViaUser = (profilesByUser || []).find((p: any) => p.user_id === a.user_id);
      const name = a.display_name || profileViaFK?.full_name || profileViaUser?.full_name || "Unknown";
      const avatar = profileViaFK?.avatar_url || profileViaUser?.avatar_url || null;
      agentMap[a.id] = { name, avatar_url: avatar };
    }

    // 4. Rank agents
    const ranked = prodData
      .map((p: any) => ({
        agent_id: p.agent_id,
        amount: Number(p.total_alp) || 0,
        deals: Number(p.total_deals) || 0,
        name: agentMap[p.agent_id]?.name || "Unknown",
        displayName: getDisplayName(agentMap[p.agent_id]?.name || "Unknown"),
        avatar_url: agentMap[p.agent_id]?.avatar_url || null,
      }))
      .filter((p: any) => p.amount > 0)
      .sort((a: any, b: any) => {
        if (b.amount !== a.amount) return b.amount - a.amount;
        if (b.deals !== a.deals) return b.deals - a.deals;
        return a.name.localeCompare(b.name);
      })
      .slice(0, 8);

    if (ranked.length === 0) {
      return new Response(
        JSON.stringify({
          status: "data_review_required",
          message: "No agents with production found for the selected period",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const winner = ranked[0];

    // 5. Generate images via Lovable AI
    const topProducerPrompt = `Create an Instagram Story graphic (1080x1920 pixels, vertical portrait).

EXACT DESIGN REQUIREMENTS - follow precisely:
- Pure solid BLACK background (#000000)
- At the very top center: small elegant text "TOP PRODUCER" in a luxury serif font (gold/champagne color)
- Below that: the name "${winner.displayName}" in large bold uppercase condensed white sans-serif text, centered
- Center of the graphic: a large circular placeholder for a portrait photo - make it a dark gray circle with the initials "${winner.displayName.charAt(0)}" in white
- Below the photo: the amount "${formatCurrency(winner.amount)}" in large bold bright green text (#00FF88)
- Below the amount: "${label}" in smaller white text
- At the very bottom center: "APEX FINANCIAL" in elegant spaced-out white text
- Style: clean, sharp, luxury sales team aesthetic
- No decorative elements, no gradients, no patterns - just clean typography on black
- Make it look like a premium, high-status sales team award post`;

    const leaderboardLines = ranked.map(
      (a: any, i: number) =>
        `#${i + 1}: ${a.displayName} — ${formatCurrency(a.amount)}`
    );
    
    const leaderboardPrompt = `Create an Instagram Story graphic (1080x1920 pixels, vertical portrait).

EXACT DESIGN REQUIREMENTS - follow precisely:
- Pure solid BLACK background (#000000)
- Title at top: "LEADERBOARD" in elegant serif font, gold/champagne color, centered
- Subtitle: "${label}" in smaller white text below title

TOP 3 PODIUM SECTION (upper half):
- #1 WINNER (center, largest): Large dark gray circle with initial "${ranked[0]?.displayName.charAt(0) || "?"}", a small gold crown icon above it, name "${ranked[0]?.displayName || ""}" in bold white text below, amount "${formatCurrency(ranked[0]?.amount || 0)}" in bright yellow/gold
- #2 (left side, smaller): Dark gray circle with initial "${ranked[1]?.displayName.charAt(0) || "?"}", name "${ranked[1]?.displayName || ""}" below, amount "${formatCurrency(ranked[1]?.amount || 0)}" in yellow
- #3 (right side, smaller): Dark gray circle with initial "${ranked[2]?.displayName.charAt(0) || "?"}", name "${ranked[2]?.displayName || ""}" below, amount "${formatCurrency(ranked[2]?.amount || 0)}" in yellow

RANKINGS 4-8 (lower half) - white horizontal bars stacked vertically:
${ranked.slice(3).map((a: any, i: number) => `- Bar ${i + 4}: Small dark circle with initial "${a.displayName.charAt(0)}" on left, rank "#${i + 4}" on far left, name "${a.displayName}" and amount "${formatCurrency(a.amount)}" in black text on white bar`).join("\n")}

- Bottom center: "APEX FINANCIAL" in elegant spaced white text
- Style: clean, sharp, luxury sales team leaderboard
- No decorative elements beyond the crown icon on #1
- This should look like a premium, high-status competitive sales leaderboard`;

    // Generate both images
    const [topProducerRes, leaderboardRes] = await Promise.all([
      fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-pro-image-preview",
          messages: [{ role: "user", content: topProducerPrompt }],
          modalities: ["image", "text"],
        }),
      }),
      fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-pro-image-preview",
          messages: [{ role: "user", content: leaderboardPrompt }],
          modalities: ["image", "text"],
        }),
      }),
    ]);

    if (!topProducerRes.ok) {
      const errText = await topProducerRes.text();
      throw new Error(`Top producer image generation failed [${topProducerRes.status}]: ${errText}`);
    }
    if (!leaderboardRes.ok) {
      const errText = await leaderboardRes.text();
      throw new Error(`Leaderboard image generation failed [${leaderboardRes.status}]: ${errText}`);
    }

    const topProducerData = await topProducerRes.json();
    const leaderboardData = await leaderboardRes.json();

    const topProducerB64 =
      topProducerData.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    const leaderboardB64 =
      leaderboardData.choices?.[0]?.message?.images?.[0]?.image_url?.url;

    if (!topProducerB64 || !leaderboardB64) {
      throw new Error("AI did not return images for one or both graphics");
    }

    // 6. Upload to storage
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "_");
    const metricSlug = metric_type.toLowerCase().replace(/\s+/g, "_");
    const periodSlug = time_period.toLowerCase();

    const topProducerPath = `apex_top_producer_${metricSlug}_${periodSlug}_${dateStr}.png`;
    const leaderboardPath = `apex_leaderboard_${metricSlug}_${periodSlug}_${dateStr}.png`;

    // Decode base64 images
    const topB64Data = topProducerB64.replace(/^data:image\/\w+;base64,/, "");
    const lbB64Data = leaderboardB64.replace(/^data:image\/\w+;base64,/, "");

    const topBytes = Uint8Array.from(atob(topB64Data), (c) => c.charCodeAt(0));
    const lbBytes = Uint8Array.from(atob(lbB64Data), (c) => c.charCodeAt(0));

    const [topUpload, lbUpload] = await Promise.all([
      supabase.storage
        .from("award-graphics")
        .upload(topProducerPath, topBytes, {
          contentType: "image/png",
          upsert: true,
        }),
      supabase.storage
        .from("award-graphics")
        .upload(leaderboardPath, lbBytes, {
          contentType: "image/png",
          upsert: true,
        }),
    ]);

    if (topUpload.error)
      throw new Error(`Top producer upload failed: ${topUpload.error.message}`);
    if (lbUpload.error)
      throw new Error(`Leaderboard upload failed: ${lbUpload.error.message}`);

    // Get public URLs
    const topUrl = supabase.storage
      .from("award-graphics")
      .getPublicUrl(topProducerPath).data.publicUrl;
    const lbUrl = supabase.storage
      .from("award-graphics")
      .getPublicUrl(leaderboardPath).data.publicUrl;

    // 7. Archive to award_batches
    const topAgents = ranked.map((a: any, i: number) => ({
      rank: i + 1,
      agent_id: a.agent_id,
      name: a.displayName,
      full_name: a.name,
      amount: a.amount,
      formatted_amount: formatCurrency(a.amount),
    }));

    const { data: batch, error: batchError } = await supabase
      .from("award_batches")
      .insert({
        time_period,
        metric_type,
        period_start: start,
        period_end: end,
        winner_agent_id: winner.agent_id,
        winner_name: winner.displayName,
        winner_amount: winner.amount,
        top_agents: topAgents,
        top_producer_file: topProducerPath,
        leaderboard_file: leaderboardPath,
        status: auto_publish ? "published" : "ready_for_review",
        source_data: { label, generated_at: new Date().toISOString() },
      })
      .select()
      .single();

    if (batchError)
      throw new Error(`Archive insert failed: ${batchError.message}`);

    // 8. Return result
    return new Response(
      JSON.stringify({
        status: "success",
        organization_name: "APEX FINANCIAL",
        time_period,
        metric_type,
        period_label: label,
        top_producer: {
          agent_id: winner.agent_id,
          name: winner.displayName,
          full_name: winner.name,
          amount: winner.amount,
          formatted_amount: formatCurrency(winner.amount),
          image_url: topUrl,
        },
        leaderboard: topAgents,
        files: {
          top_producer_story: topUrl,
          leaderboard_story: lbUrl,
        },
        archive: {
          award_batch_id: batch.id,
          saved: true,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("generate-award-graphics error:", error);
    return new Response(
      JSON.stringify({
        status: "error",
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
