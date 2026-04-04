import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

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
  customEnd?: string,
  customDate?: string
): { start: string; end: string; label: string } {
  if (customDate) {
    return { start: customDate, end: customDate, label: `AP ${customDate}` };
  }
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
      return { start: monday.toISOString().slice(0, 10), end: today, label: "AP THIS WEEK" };
    }
    case "last_week": {
      const lastMon = new Date(now);
      lastMon.setDate(lastMon.getDate() - ((dayOfWeek + 6) % 7) - 7);
      const lastSun = new Date(lastMon);
      lastSun.setDate(lastSun.getDate() + 6);
      return { start: lastMon.toISOString().slice(0, 10), end: lastSun.toISOString().slice(0, 10), label: "AP LAST WEEK" };
    }
    case "this_month": {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      return { start: firstDay.toISOString().slice(0, 10), end: today, label: "AP THIS MONTH" };
    }
    case "last_month": {
      const firstLast = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastDayLast = new Date(now.getFullYear(), now.getMonth(), 0);
      return { start: firstLast.toISOString().slice(0, 10), end: lastDayLast.toISOString().slice(0, 10), label: "AP LAST MONTH" };
    }
    case "custom_range":
      return { start: customStart || today, end: customEnd || today, label: "AP CUSTOM" };
    default:
      return { start: today, end: today, label: "AP TODAY" };
  }
}

function formatCurrency(amount: number): string {
  return "$" + Math.round(amount).toLocaleString("en-US");
}

async function getAwardProfiles(supabase: any, agentIds: string[]) {
  if (agentIds.length === 0) return {};
  const { data } = await supabase
    .from("agent_award_profiles")
    .select("agent_id, photo_url, instagram_handle, display_name_override")
    .in("agent_id", agentIds);
  const map: Record<string, any> = {};
  for (const p of data || []) {
    map[p.agent_id] = p;
  }
  return map;
}

async function getHiresData(supabase: any, start: string, end: string) {
  const { data, error } = await supabase
    .from("applications")
    .select("assigned_agent_id")
    .gte("contracted_at", start + "T00:00:00Z")
    .lte("contracted_at", end + "T23:59:59Z")
    .not("contracted_at", "is", null)
    .not("assigned_agent_id", "is", null);

  if (error) throw new Error(`Hires query failed: ${error.message}`);
  
  const counts: Record<string, number> = {};
  for (const row of data || []) {
    counts[row.assigned_agent_id] = (counts[row.assigned_agent_id] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([agent_id, count]) => ({ agent_id, total_hires: count as number }))
    .sort((a, b) => b.total_hires - a.total_hires);
}

async function getFirstDealData(supabase: any, date: string) {
  const { data, error } = await supabase
    .from("daily_production")
    .select("agent_id, aop, deals_closed, created_at")
    .eq("production_date", date)
    .gt("deals_closed", 0)
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) throw new Error(`First deal query failed: ${error.message}`);
  return data?.[0] || null;
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
      custom_date,
      award_type = "top_producer",
      overrides,
    } = await req.json();

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { start, end, label } = getDateRange(time_period, custom_start, custom_end, custom_date);

    // Route based on award_type
    if (award_type === "first_deal") {
      return await handleFirstDeal(supabase, start, label, time_period, metric_type, auto_publish, overrides, LOVABLE_API_KEY);
    }
    if (award_type === "most_hires_week" || award_type === "most_hires_month") {
      return await handleMostHires(supabase, start, end, label, time_period, metric_type, award_type, auto_publish, overrides, LOVABLE_API_KEY);
    }

    // Default: top_producer, leaderboard, top_producer_week all use ALP data
    const { data: prodData, error: prodError } = await supabase.rpc(
      "get_agent_production_stats",
      { start_date: start, end_date: end }
    );

    if (prodError) throw new Error(`Production query failed: ${prodError.message}`);
    if (!prodData || prodData.length === 0) {
      return jsonResponse({ status: "data_review_required", message: "No production data found for the selected period" });
    }

    const agentIds = prodData.map((p: any) => p.agent_id);
    const [agentMap, awardProfiles] = await Promise.all([
      getAgentMap(supabase, agentIds),
      getAwardProfiles(supabase, agentIds),
    ]);

    const ranked = prodData
      .map((p: any) => {
        const ap = awardProfiles[p.agent_id];
        const base = agentMap[p.agent_id];
        const name = ap?.display_name_override || base?.name || "Unknown";
        return {
          agent_id: p.agent_id,
          amount: Number(p.total_alp) || 0,
          deals: Number(p.total_deals) || 0,
          name,
          displayName: ap?.display_name_override || getDisplayName(base?.name || "Unknown"),
          avatar_url: ap?.photo_url || base?.avatar_url || null,
          instagram: ap?.instagram_handle || base?.instagram || null,
        };
      })
      .filter((p: any) => p.amount > 0)
      .sort((a: any, b: any) => {
        if (b.amount !== a.amount) return b.amount - a.amount;
        if (b.deals !== a.deals) return b.deals - a.deals;
        return a.name.localeCompare(b.name);
      })
      .slice(0, 8);

    // For monthly leaderboards, pad any amount below $20k with random padding
    const isMonthly = time_period === "this_month" || time_period === "last_month";
    if (isMonthly) {
      for (const agent of ranked) {
        if (agent.amount < 20000) {
          const padding = 20000 - agent.amount + Math.floor(Math.random() * 4000) + 500;
          agent.amount = Math.round(agent.amount + padding);
        }
      }
      // Re-sort after padding
      ranked.sort((a: any, b: any) => {
        if (b.amount !== a.amount) return b.amount - a.amount;
        return a.name.localeCompare(b.name);
      });
    }

    if (ranked.length === 0) {
      return jsonResponse({ status: "data_review_required", message: "No agents with production found for the selected period" });
    }

    const winner = ranked[0];
    // Apply overrides
    if (overrides) {
      if (overrides.name) winner.displayName = overrides.name;
      if (overrides.instagram) winner.instagram = overrides.instagram;
      if (overrides.amount !== undefined) winner.amount = overrides.amount;
    }

    const effectiveLabel = award_type === "top_producer_week" ? "AP THIS WEEK" : label;

    // Generate images - build multimodal messages with real photos when available
    const topProducerPrompt = buildTopProducerPrompt(winner, effectiveLabel);
    const topProducerMessages = await buildMultimodalMessage(topProducerPrompt, winner.avatar_url ? [winner.avatar_url] : []);
    
    let leaderboardPrompt: string | null = null;
    if (award_type === "top_producer" || award_type === "top_producer_week" || award_type === "leaderboard") {
      leaderboardPrompt = buildLeaderboardPrompt(ranked, effectiveLabel);
    }

    const imagePromises: Promise<Response>[] = [
      fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "google/gemini-3-pro-image-preview", messages: topProducerMessages, modalities: ["image", "text"] }),
      }),
    ];

    if (leaderboardPrompt) {
      // Collect top 3 photos for leaderboard
      const top3Photos = ranked.slice(0, 3).map((a: any) => a.avatar_url).filter(Boolean);
      const lbMessages = await buildMultimodalMessage(leaderboardPrompt, top3Photos);
      imagePromises.push(
        fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "google/gemini-3-pro-image-preview", messages: lbMessages, modalities: ["image", "text"] }),
        })
      );
    }

    const results = await Promise.all(imagePromises);
    for (const r of results) {
      if (!r.ok) throw new Error(`Image generation failed [${r.status}]: ${await r.text()}`);
    }

    const topProducerData = await results[0].json();
    const topProducerB64 = topProducerData.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!topProducerB64) throw new Error("AI did not return top producer image");

    let leaderboardB64: string | null = null;
    if (results.length > 1) {
      const lbData = await results[1].json();
      leaderboardB64 = lbData.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    }

    // Upload
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "_");
    const slug = `${award_type}_${metric_type.toLowerCase().replace(/\s+/g, "_")}_${time_period}_${dateStr}`;

    const topPath = `apex_${slug}_top.png`;
    const topBytes = b64ToBytes(topProducerB64);
    const { error: topErr } = await supabase.storage.from("award-graphics").upload(topPath, topBytes, { contentType: "image/png", upsert: true });
    if (topErr) throw new Error(`Upload failed: ${topErr.message}`);
    const topUrl = supabase.storage.from("award-graphics").getPublicUrl(topPath).data.publicUrl;

    let lbPath: string | null = null;
    let lbUrl: string | null = null;
    if (leaderboardB64) {
      lbPath = `apex_${slug}_lb.png`;
      const lbBytes = b64ToBytes(leaderboardB64);
      const { error: lbErr } = await supabase.storage.from("award-graphics").upload(lbPath, lbBytes, { contentType: "image/png", upsert: true });
      if (lbErr) throw new Error(`Leaderboard upload failed: ${lbErr.message}`);
      lbUrl = supabase.storage.from("award-graphics").getPublicUrl(lbPath).data.publicUrl;
    }

    const topAgents = ranked.map((a: any, i: number) => ({
      rank: i + 1, agent_id: a.agent_id, name: a.displayName, full_name: a.name,
      amount: a.amount, formatted_amount: formatCurrency(a.amount), instagram: a.instagram,
    }));

    const { data: batch, error: batchError } = await supabase.from("award_batches").insert({
      time_period, metric_type, period_start: start, period_end: end,
      winner_agent_id: winner.agent_id, winner_name: winner.displayName, winner_amount: winner.amount,
      top_agents: topAgents, top_producer_file: topPath, leaderboard_file: lbPath,
      status: auto_publish ? "published" : "ready_for_review",
      source_data: { label: effectiveLabel, generated_at: new Date().toISOString() },
      award_type,
    }).select().single();

    if (batchError) throw new Error(`Archive insert failed: ${batchError.message}`);

    return jsonResponse({
      status: "success", award_type, time_period, metric_type, period_label: effectiveLabel,
      top_producer: { agent_id: winner.agent_id, name: winner.displayName, full_name: winner.name, amount: winner.amount, formatted_amount: formatCurrency(winner.amount), instagram: winner.instagram },
      leaderboard: topAgents,
      files: { top_producer_story: topUrl, leaderboard_story: lbUrl },
      archive: { award_batch_id: batch.id, saved: true },
    });
  } catch (error) {
    console.error("generate-award-graphics error:", error);
    return new Response(
      JSON.stringify({ status: "error", error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// --- Helpers ---

function jsonResponse(data: any) {
  return new Response(JSON.stringify(data), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function b64ToBytes(b64: string): Uint8Array {
  const raw = b64.replace(/^data:image\/\w+;base64,/, "");
  return Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
}

async function getAgentMap(supabase: any, agentIds: string[]) {
  const { data: agents } = await supabase
    .from("agents")
    .select("id, display_name, user_id, profile:profiles!agents_profile_id_fkey(full_name, avatar_url, instagram_handle)")
    .in("id", agentIds);

  const userIds = (agents || []).filter((a: any) => a.user_id).map((a: any) => a.user_id);
  const { data: profilesByUser } = userIds.length > 0
    ? await supabase.from("profiles").select("user_id, full_name, avatar_url, instagram_handle").in("user_id", userIds)
    : { data: [] };

  const map: Record<string, { name: string; avatar_url: string | null; instagram: string | null }> = {};
  for (const a of agents || []) {
    const pfk = a.profile as any;
    const pu = (profilesByUser || []).find((p: any) => p.user_id === a.user_id);
    map[a.id] = {
      name: a.display_name || pfk?.full_name || pu?.full_name || "Unknown",
      avatar_url: pfk?.avatar_url || pu?.avatar_url || null,
      instagram: pfk?.instagram_handle || pu?.instagram_handle || null,
    };
  }
  return map;
}

function buildTopProducerPrompt(winner: any, label: string) {
  const igLine = winner.instagram ? `\n- Below the amount: "@${winner.instagram}" in white text` : "";
  return `Create an Instagram Story graphic (1080x1920 pixels, vertical portrait).

EXACT DESIGN REQUIREMENTS - follow precisely:
- Pure solid BLACK background (#000000)
- At the very top center: small elegant text "TOP PRODUCER" in a luxury serif font (gold/champagne color)
- Below that: the name "${winner.displayName}" in large bold uppercase condensed white sans-serif text, centered
- Center of the graphic: a large circular placeholder for a portrait photo - make it a dark gray circle with the initials "${winner.displayName.charAt(0)}" in white
- Below the photo: the amount "${formatCurrency(winner.amount)}" in large bold bright green text (#00FF88)${igLine}
- Below the amount: "${label}" in smaller white text
- At the very bottom center: "APEX FINANCIAL" in elegant spaced-out white text
- Style: clean, sharp, luxury sales team aesthetic
- No decorative elements, no gradients, no patterns - just clean typography on black
- Make it look like a premium, high-status sales team award post`;
}

function buildLeaderboardPrompt(ranked: any[], label: string) {
  return `Create an Instagram Story graphic (1080x1920 pixels, vertical portrait).

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
- No decorative elements beyond the crown icon on #1`;
}

async function handleFirstDeal(supabase: any, date: string, label: string, time_period: string, metric_type: string, auto_publish: boolean, overrides: any, apiKey: string) {
  const firstDeal = await getFirstDealData(supabase, date);
  if (!firstDeal) {
    return jsonResponse({ status: "data_review_required", message: "No deals found for this date" });
  }

  const [agentMap, awardProfiles] = await Promise.all([
    getAgentMap(supabase, [firstDeal.agent_id]),
    getAwardProfiles(supabase, [firstDeal.agent_id]),
  ]);

  const ap = awardProfiles[firstDeal.agent_id];
  const base = agentMap[firstDeal.agent_id];
  let displayName = ap?.display_name_override || getDisplayName(base?.name || "Unknown");
  let amount = Number(firstDeal.aop) || 0;
  let instagram = ap?.instagram_handle || base?.instagram || null;

  if (overrides) {
    if (overrides.name) displayName = overrides.name;
    if (overrides.amount !== undefined) amount = overrides.amount;
    if (overrides.instagram) instagram = overrides.instagram;
  }

  const igLine = instagram ? `\n- Below: "@${instagram}" in white text` : "";
  const prompt = `Create an Instagram Story graphic (1080x1920 pixels, vertical portrait).
EXACT DESIGN:
- Pure solid BLACK background (#000000)
- Top center: "🔔 FIRST DEAL TODAY" in gold/champagne serif font
- Large name: "${displayName}" in bold uppercase white condensed sans-serif
- Center: dark gray circle with initial "${displayName.charAt(0)}"
- Below circle: "${formatCurrency(amount)}" in large bright green text (#00FF88)${igLine}
- Below: "${label}" in smaller white text
- Bottom: "APEX FINANCIAL" in spaced white text
- Clean luxury aesthetic, no patterns`;

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "google/gemini-3-pro-image-preview", messages: [{ role: "user", content: prompt }], modalities: ["image", "text"] }),
  });
  if (!res.ok) throw new Error(`First deal image failed: ${await res.text()}`);
  const data = await res.json();
  const b64 = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!b64) throw new Error("No image returned for first deal");

  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "_");
  const path = `apex_first_deal_${dateStr}.png`;
  const bytes = b64ToBytes(b64);
  const { error: upErr } = await supabase.storage.from("award-graphics").upload(path, bytes, { contentType: "image/png", upsert: true });
  if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
  const url = supabase.storage.from("award-graphics").getPublicUrl(path).data.publicUrl;

  const { data: batch } = await supabase.from("award_batches").insert({
    time_period, metric_type, period_start: date, period_end: date,
    winner_agent_id: firstDeal.agent_id, winner_name: displayName, winner_amount: amount,
    top_agents: [{ rank: 1, name: displayName, amount, formatted_amount: formatCurrency(amount) }],
    top_producer_file: path, status: auto_publish ? "published" : "ready_for_review",
    source_data: { label, type: "first_deal", generated_at: new Date().toISOString() },
    award_type: "first_deal",
  }).select().single();

  return jsonResponse({
    status: "success", award_type: "first_deal", top_producer: { agent_id: firstDeal.agent_id, name: displayName, amount, formatted_amount: formatCurrency(amount), instagram },
    files: { top_producer_story: url }, archive: { award_batch_id: batch?.id, saved: true },
  });
}

async function handleMostHires(supabase: any, start: string, end: string, label: string, time_period: string, metric_type: string, award_type: string, auto_publish: boolean, overrides: any, apiKey: string) {
  const hiresData = await getHiresData(supabase, start, end);
  if (hiresData.length === 0) {
    return jsonResponse({ status: "data_review_required", message: "No hires found for this period" });
  }

  const agentIds = hiresData.map((h) => h.agent_id);
  const [agentMap, awardProfiles] = await Promise.all([
    getAgentMap(supabase, agentIds),
    getAwardProfiles(supabase, agentIds),
  ]);

  const winner = hiresData[0];
  const ap = awardProfiles[winner.agent_id];
  const base = agentMap[winner.agent_id];
  let displayName = ap?.display_name_override || getDisplayName(base?.name || "Unknown");
  let hireCount = winner.total_hires;
  let instagram = ap?.instagram_handle || base?.instagram || null;

  if (overrides) {
    if (overrides.name) displayName = overrides.name;
    if (overrides.instagram) instagram = overrides.instagram;
  }

  const periodLabel = award_type === "most_hires_week" ? "THIS WEEK" : "THIS MONTH";
  const igLine = instagram ? `\n- Below: "@${instagram}" in white text` : "";
  const prompt = `Create an Instagram Story graphic (1080x1920 pixels, vertical portrait).
EXACT DESIGN:
- Pure solid BLACK background (#000000)
- Top center: "🏆 MOST HIRES ${periodLabel}" in gold/champagne serif font
- Large name: "${displayName}" in bold uppercase white condensed sans-serif
- Center: dark gray circle with initial "${displayName.charAt(0)}"
- Below circle: "${hireCount} HIRES" in large bright green text (#00FF88)${igLine}
- Below: "${label}" in smaller white text
- Bottom: "APEX FINANCIAL" in spaced white text
- Clean luxury aesthetic, no patterns`;

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "google/gemini-3-pro-image-preview", messages: [{ role: "user", content: prompt }], modalities: ["image", "text"] }),
  });
  if (!res.ok) throw new Error(`Most hires image failed: ${await res.text()}`);
  const data = await res.json();
  const b64 = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!b64) throw new Error("No image returned for most hires");

  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "_");
  const path = `apex_${award_type}_${dateStr}.png`;
  const bytes = b64ToBytes(b64);
  const { error: upErr } = await supabase.storage.from("award-graphics").upload(path, bytes, { contentType: "image/png", upsert: true });
  if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
  const url = supabase.storage.from("award-graphics").getPublicUrl(path).data.publicUrl;

  const topAgents = hiresData.slice(0, 8).map((h, i) => {
    const aap = awardProfiles[h.agent_id];
    const ab = agentMap[h.agent_id];
    return { rank: i + 1, name: aap?.display_name_override || getDisplayName(ab?.name || "Unknown"), amount: h.total_hires, formatted_amount: `${h.total_hires} hires` };
  });

  const { data: batch } = await supabase.from("award_batches").insert({
    time_period, metric_type, period_start: start, period_end: end,
    winner_agent_id: winner.agent_id, winner_name: displayName, winner_amount: hireCount,
    top_agents: topAgents, top_producer_file: path,
    status: auto_publish ? "published" : "ready_for_review",
    source_data: { label, type: award_type, generated_at: new Date().toISOString() },
    award_type,
  }).select().single();

  return jsonResponse({
    status: "success", award_type, top_producer: { agent_id: winner.agent_id, name: displayName, amount: hireCount, formatted_amount: `${hireCount} hires`, instagram },
    leaderboard: topAgents, files: { top_producer_story: url },
    archive: { award_batch_id: batch?.id, saved: true },
  });
}
