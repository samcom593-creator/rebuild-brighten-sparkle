import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DISPLAY_ALIASES: Record<string, string> = {
  "Mahmod Imran": "MOODY",
  "Kaeden Vaughns": "KJ",
  "Chukwudi Ifediora": "CHUDI",
  "Obiajulu Ifediora": "OBI",
  "KJ Vaughns": "KJ",
};

const STORY_WIDTH = 1080;
const STORY_HEIGHT = 1920;
const COLORS = {
  background: "#000000",
  white: "#FFFFFF",
  gold: "#C9A96E",
  green: "#00FF88",
  yellow: "#F4D35E",
  gray: "#5B5B5B",
  lightGray: "#EDEDED",
  darkText: "#101010",
};

function getDisplayName(fullName: string): string {
  return DISPLAY_ALIASES[fullName] || fullName.split(" ")[0].toUpperCase();
}

function getDateRange(
  timePeriod: string,
  customStart?: string,
  customEnd?: string,
  customDate?: string,
): { start: string; end: string; label: string } {
  if (customDate) {
    return { start: customDate, end: customDate, label: `ISSUED PAID ${customDate}` };
  }

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const dayOfWeek = now.getDay();

  switch (timePeriod) {
    case "today":
      return { start: today, end: today, label: "ISSUED PAID TODAY" };
    case "yesterday": {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      const ys = y.toISOString().slice(0, 10);
      return { start: ys, end: ys, label: "ISSUED PAID YESTERDAY" };
    }
    case "this_week": {
      const monday = new Date(now);
      monday.setDate(monday.getDate() - ((dayOfWeek + 6) % 7));
      return { start: monday.toISOString().slice(0, 10), end: today, label: "ISSUED PAID THIS WEEK" };
    }
    case "last_week": {
      const lastMon = new Date(now);
      lastMon.setDate(lastMon.getDate() - ((dayOfWeek + 6) % 7) - 7);
      const lastSun = new Date(lastMon);
      lastSun.setDate(lastSun.getDate() + 6);
      return {
        start: lastMon.toISOString().slice(0, 10),
        end: lastSun.toISOString().slice(0, 10),
        label: "ISSUED PAID LAST WEEK",
      };
    }
    case "this_month": {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      return { start: firstDay.toISOString().slice(0, 10), end: today, label: "ISSUED PAID THIS MONTH" };
    }
    case "last_month": {
      const firstLast = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastDayLast = new Date(now.getFullYear(), now.getMonth(), 0);
      return {
        start: firstLast.toISOString().slice(0, 10),
        end: lastDayLast.toISOString().slice(0, 10),
        label: "ISSUED PAID LAST MONTH",
      };
    }
    case "custom_range":
      return { start: customStart || today, end: customEnd || today, label: "ISSUED PAID CUSTOM" };
    default:
      return { start: today, end: today, label: "ISSUED PAID TODAY" };
  }
}

function formatCurrency(amount: number): string {
  return "$" + Math.round(amount).toLocaleString("en-US");
}

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function initialsFromName(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "?";
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function guessImageType(url: string): string {
  const lower = url.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/png";
}

async function fetchImageAsDataUrl(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn("Could not fetch image:", url, response.status);
      return null;
    }

    const contentType = response.headers.get("content-type") || guessImageType(url);
    const bytes = new Uint8Array(await response.arrayBuffer());
    return `data:${contentType};base64,${toBase64(bytes)}`;
  } catch (error) {
    console.warn("Image fetch failed:", url, error);
    return null;
  }
}

function buildCircleVisual({
  id,
  cx,
  cy,
  radius,
  photoDataUrl,
  fallbackLabel,
  borderColor = COLORS.gold,
  fill = COLORS.gray,
  fontSize = 80,
}: {
  id: string;
  cx: number;
  cy: number;
  radius: number;
  photoDataUrl?: string | null;
  fallbackLabel: string;
  borderColor?: string;
  fill?: string;
  fontSize?: number;
}) {
  const clipId = `clip-${id}`;
  const defs = photoDataUrl
    ? `<clipPath id="${clipId}"><circle cx="${cx}" cy="${cy}" r="${radius}" /></clipPath>`
    : "";

  const content = photoDataUrl
    ? `<image href="${photoDataUrl}" x="${cx - radius}" y="${cy - radius}" width="${radius * 2}" height="${radius * 2}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})" />`
    : `
      <circle cx="${cx}" cy="${cy}" r="${radius}" fill="${fill}" />
      <text x="${cx}" y="${cy + fontSize / 3}" fill="${COLORS.white}" font-size="${fontSize}" font-weight="800" text-anchor="middle" font-family="Arial, Helvetica, sans-serif">${escapeXml(fallbackLabel)}</text>
    `;

  const ring = `<circle cx="${cx}" cy="${cy}" r="${radius + 6}" fill="none" stroke="${borderColor}" stroke-width="8" />`;
  return { defs, content: `${content}${ring}` };
}

async function uploadSvg(supabase: any, path: string, svg: string) {
  const bytes = new TextEncoder().encode(svg);
  const { error } = await supabase.storage.from("award-graphics").upload(path, bytes, {
    contentType: "image/svg+xml",
    upsert: true,
  });

  if (error) throw new Error(`Upload failed: ${error.message}`);
  return supabase.storage.from("award-graphics").getPublicUrl(path).data.publicUrl;
}

async function getAwardProfiles(supabase: any, agentIds: string[]) {
  if (agentIds.length === 0) return {};
  const { data } = await supabase
    .from("agent_award_profiles")
    .select("agent_id, photo_url, instagram_handle, display_name_override")
    .in("agent_id", agentIds);

  const map: Record<string, any> = {};
  for (const profile of data || []) map[profile.agent_id] = profile;
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
  for (const row of data || []) counts[row.assigned_agent_id] = (counts[row.assigned_agent_id] || 0) + 1;

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
  for (const agent of agents || []) {
    const profileByForeignKey = agent.profile as any;
    const profileByUserId = (profilesByUser || []).find((p: any) => p.user_id === agent.user_id);
    map[agent.id] = {
      name: agent.display_name || profileByForeignKey?.full_name || profileByUserId?.full_name || "Unknown",
      avatar_url: profileByForeignKey?.avatar_url || profileByUserId?.avatar_url || null,
      instagram: profileByForeignKey?.instagram_handle || profileByUserId?.instagram_handle || null,
    };
  }
  return map;
}

async function renderTopProducerStory({
  title,
  name,
  amountText,
  subtitle,
  instagram,
  photoUrl,
}: {
  title: string;
  name: string;
  amountText: string;
  subtitle: string;
  instagram?: string | null;
  photoUrl?: string | null;
}) {
  const photoDataUrl = await fetchImageAsDataUrl(photoUrl);
  const visual = buildCircleVisual({
    id: "winner",
    cx: 540,
    cy: 825,
    radius: 165,
    photoDataUrl,
    fallbackLabel: initialsFromName(name),
    borderColor: COLORS.gold,
    fontSize: 120,
  });

  const instagramLine = instagram
    ? `<text x="540" y="1338" fill="${COLORS.white}" font-size="56" font-weight="700" text-anchor="middle" font-family="Arial, Helvetica, sans-serif">@${escapeXml(instagram.replace(/^@/, ""))}</text>`
    : "";

  return `
    <svg width="${STORY_WIDTH}" height="${STORY_HEIGHT}" viewBox="0 0 ${STORY_WIDTH} ${STORY_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>${visual.defs}</defs>
      <rect width="100%" height="100%" fill="${COLORS.background}" />
      <text x="540" y="168" fill="${COLORS.gold}" font-size="42" letter-spacing="6" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif">${escapeXml(title)}</text>
      <text x="540" y="320" fill="${COLORS.white}" font-size="124" font-weight="900" text-anchor="middle" font-family="Arial Black, Arial, Helvetica, sans-serif">${escapeXml(name.toUpperCase())}</text>
      ${visual.content}
      <text x="540" y="1228" fill="${COLORS.green}" font-size="110" font-weight="900" text-anchor="middle" font-family="Arial Black, Arial, Helvetica, sans-serif">${escapeXml(amountText)}</text>
      ${instagramLine}
      <text x="540" y="1424" fill="${COLORS.white}" font-size="42" text-anchor="middle" font-family="Arial, Helvetica, sans-serif">${escapeXml(subtitle)}</text>
      <text x="540" y="1768" fill="${COLORS.white}" font-size="38" letter-spacing="10" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif">APEX FINANCIAL</text>
    </svg>
  `;
}

async function renderLeaderboardStory(ranked: any[], label: string) {
  const enriched = await Promise.all(
    ranked.slice(0, 8).map(async (entry: any) => ({
      ...entry,
      photoDataUrl: await fetchImageAsDataUrl(entry.avatar_url),
    })),
  );

  const defs: string[] = [];
  const content: string[] = [];

  const topLayouts = [
    { cx: 540, cy: 410, radius: 108, nameY: 590, amountY: 638, crown: true },
    { cx: 320, cy: 450, radius: 82, nameY: 602, amountY: 646, crown: false },
    { cx: 760, cy: 450, radius: 82, nameY: 602, amountY: 646, crown: false },
  ];

  enriched.slice(0, 3).forEach((entry: any, index: number) => {
    const layout = topLayouts[index];
    const visual = buildCircleVisual({
      id: `top-${index + 1}`,
      cx: layout.cx,
      cy: layout.cy,
      radius: layout.radius,
      photoDataUrl: entry.photoDataUrl,
      fallbackLabel: initialsFromName(entry.displayName),
      borderColor: index === 0 ? COLORS.gold : "#8C8C8C",
      fontSize: index === 0 ? 72 : 56,
    });

    defs.push(visual.defs);
    if (layout.crown) content.push(`<text x="${layout.cx}" y="250" fill="${COLORS.gold}" font-size="48" text-anchor="middle">♛</text>`);
    content.push(visual.content);
    content.push(`<text x="${layout.cx}" y="${layout.nameY}" fill="${COLORS.white}" font-size="48" font-weight="800" text-anchor="middle" font-family="Arial, Helvetica, sans-serif">${escapeXml(entry.displayName)}</text>`);
    content.push(`<text x="${layout.cx}" y="${layout.amountY}" fill="${COLORS.yellow}" font-size="40" font-weight="800" text-anchor="middle" font-family="Arial, Helvetica, sans-serif">${escapeXml(formatCurrency(entry.amount))}</text>`);
  });

  enriched.slice(3, 8).forEach((entry: any, index: number) => {
    const rank = index + 4;
    const y = 780 + index * 152;
    const circleX = 330;
    const circleY = y + 46;
    const visual = buildCircleVisual({
      id: `bar-${rank}`,
      cx: circleX,
      cy: circleY,
      radius: 24,
      photoDataUrl: entry.photoDataUrl,
      fallbackLabel: initialsFromName(entry.displayName),
      borderColor: "#7A7A7A",
      fill: COLORS.gray,
      fontSize: 24,
    });

    defs.push(visual.defs);
    content.push(`<rect x="120" y="${y}" width="840" height="92" rx="18" fill="${COLORS.lightGray}" />`);
    content.push(`<text x="180" y="${y + 58}" fill="${COLORS.darkText}" font-size="42" font-weight="800" text-anchor="middle" font-family="Arial, Helvetica, sans-serif">#${rank}</text>`);
    content.push(visual.content);
    content.push(`<text x="380" y="${y + 58}" fill="${COLORS.darkText}" font-size="40" font-weight="800" font-family="Arial, Helvetica, sans-serif">${escapeXml(entry.displayName)}</text>`);
    content.push(`<text x="920" y="${y + 58}" fill="${COLORS.darkText}" font-size="38" font-weight="700" text-anchor="end" font-family="Arial, Helvetica, sans-serif">${escapeXml(formatCurrency(entry.amount))}</text>`);
  });

  return `
    <svg width="${STORY_WIDTH}" height="${STORY_HEIGHT}" viewBox="0 0 ${STORY_WIDTH} ${STORY_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>${defs.join("")}</defs>
      <rect width="100%" height="100%" fill="${COLORS.background}" />
      <text x="540" y="136" fill="${COLORS.gold}" font-size="64" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif">LEADERBOARD</text>
      <text x="540" y="196" fill="${COLORS.white}" font-size="34" letter-spacing="2" text-anchor="middle" font-family="Arial, Helvetica, sans-serif">${escapeXml(label)}</text>
      ${content.join("")}
      <text x="540" y="1810" fill="${COLORS.white}" font-size="34" letter-spacing="10" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif">APEX FINANCIAL</text>
    </svg>
  `;
}

async function handleFirstDeal(
  supabase: any,
  date: string,
  label: string,
  time_period: string,
  metric_type: string,
  auto_publish: boolean,
  overrides: any,
) {
  const firstDeal = await getFirstDealData(supabase, date);
  if (!firstDeal) return jsonResponse({ status: "data_review_required", message: "No deals found for this date" });

  const [agentMap, awardProfiles] = await Promise.all([
    getAgentMap(supabase, [firstDeal.agent_id]),
    getAwardProfiles(supabase, [firstDeal.agent_id]),
  ]);

  const awardProfile = awardProfiles[firstDeal.agent_id];
  const agent = agentMap[firstDeal.agent_id];
  let displayName = awardProfile?.display_name_override || getDisplayName(agent?.name || "Unknown");
  let amount = Number(firstDeal.aop) || 0;
  let instagram = awardProfile?.instagram_handle || agent?.instagram || null;

  if (overrides) {
    if (overrides.name) displayName = overrides.name;
    if (overrides.amount !== undefined) amount = overrides.amount;
    if (overrides.instagram) instagram = overrides.instagram;
  }

  const svg = await renderTopProducerStory({
    title: "FIRST DEAL TODAY",
    name: displayName,
    amountText: formatCurrency(amount),
    subtitle: label,
    instagram,
    photoUrl: awardProfile?.photo_url || agent?.avatar_url || null,
  });

  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "_");
  const path = `apex_first_deal_${dateStr}.svg`;
  const url = await uploadSvg(supabase, path, svg);

  const { data: batch } = await supabase.from("award_batches").insert({
    time_period,
    metric_type,
    period_start: date,
    period_end: date,
    winner_agent_id: firstDeal.agent_id,
    winner_name: displayName,
    winner_amount: amount,
    top_agents: [{ rank: 1, name: displayName, amount, formatted_amount: formatCurrency(amount) }],
    top_producer_file: path,
    status: auto_publish ? "published" : "ready_for_review",
    source_data: { label, type: "first_deal", generated_at: new Date().toISOString(), renderer: "svg" },
    award_type: "first_deal",
  }).select().single();

  return jsonResponse({
    status: "success",
    award_type: "first_deal",
    top_producer: { agent_id: firstDeal.agent_id, name: displayName, amount, formatted_amount: formatCurrency(amount), instagram },
    files: { top_producer_story: url },
    archive: { award_batch_id: batch?.id, saved: true },
  });
}

async function handleMostHires(
  supabase: any,
  start: string,
  end: string,
  label: string,
  time_period: string,
  metric_type: string,
  award_type: string,
  auto_publish: boolean,
  overrides: any,
) {
  const hiresData = await getHiresData(supabase, start, end);
  if (hiresData.length === 0) return jsonResponse({ status: "data_review_required", message: "No hires found for this period" });

  const agentIds = hiresData.map((hire) => hire.agent_id);
  const [agentMap, awardProfiles] = await Promise.all([
    getAgentMap(supabase, agentIds),
    getAwardProfiles(supabase, agentIds),
  ]);

  const winner = hiresData[0];
  const awardProfile = awardProfiles[winner.agent_id];
  const agent = agentMap[winner.agent_id];
  let displayName = awardProfile?.display_name_override || getDisplayName(agent?.name || "Unknown");
  let hireCount = winner.total_hires;
  let instagram = awardProfile?.instagram_handle || agent?.instagram || null;

  if (overrides) {
    if (overrides.name) displayName = overrides.name;
    if (overrides.instagram) instagram = overrides.instagram;
  }

  const svg = await renderTopProducerStory({
    title: award_type === "most_hires_week" ? "MOST HIRES THIS WEEK" : "MOST HIRES THIS MONTH",
    name: displayName,
    amountText: `${hireCount} HIRES`,
    subtitle: label,
    instagram,
    photoUrl: awardProfile?.photo_url || agent?.avatar_url || null,
  });

  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "_");
  const path = `apex_${award_type}_${dateStr}.svg`;
  const url = await uploadSvg(supabase, path, svg);

  const topAgents = hiresData.slice(0, 8).map((hire, index) => {
    const currentProfile = awardProfiles[hire.agent_id];
    const currentAgent = agentMap[hire.agent_id];
    return {
      rank: index + 1,
      name: currentProfile?.display_name_override || getDisplayName(currentAgent?.name || "Unknown"),
      amount: hire.total_hires,
      formatted_amount: `${hire.total_hires} hires`,
    };
  });

  const { data: batch } = await supabase.from("award_batches").insert({
    time_period,
    metric_type,
    period_start: start,
    period_end: end,
    winner_agent_id: winner.agent_id,
    winner_name: displayName,
    winner_amount: hireCount,
    top_agents: topAgents,
    top_producer_file: path,
    status: auto_publish ? "published" : "ready_for_review",
    source_data: { label, type: award_type, generated_at: new Date().toISOString(), renderer: "svg" },
    award_type,
  }).select().single();

  return jsonResponse({
    status: "success",
    award_type,
    top_producer: { agent_id: winner.agent_id, name: displayName, amount: hireCount, formatted_amount: `${hireCount} hires`, instagram },
    leaderboard: topAgents,
    files: { top_producer_story: url },
    archive: { award_batch_id: batch?.id, saved: true },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

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
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { start, end, label } = getDateRange(time_period, custom_start, custom_end, custom_date);

    if (award_type === "first_deal") {
      return await handleFirstDeal(supabase, start, label, time_period, metric_type, auto_publish, overrides);
    }

    if (award_type === "most_hires_week" || award_type === "most_hires_month") {
      return await handleMostHires(supabase, start, end, label, time_period, metric_type, award_type, auto_publish, overrides);
    }

    const { data: prodData, error: prodError } = await supabase.rpc("get_agent_production_stats", { start_date: start, end_date: end });
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
        const awardProfile = awardProfiles[p.agent_id];
        const agent = agentMap[p.agent_id];
        const name = awardProfile?.display_name_override || agent?.name || "Unknown";
        return {
          agent_id: p.agent_id,
          amount: Number(p.total_alp) || 0,
          deals: Number(p.total_deals) || 0,
          name,
          displayName: awardProfile?.display_name_override || getDisplayName(agent?.name || "Unknown"),
          avatar_url: awardProfile?.photo_url || agent?.avatar_url || null,
          instagram: awardProfile?.instagram_handle || agent?.instagram || null,
        };
      })
      .filter((p: any) => p.amount > 0)
      .sort((a: any, b: any) => {
        if (b.amount !== a.amount) return b.amount - a.amount;
        if (b.deals !== a.deals) return b.deals - a.deals;
        return a.name.localeCompare(b.name);
      })
      .slice(0, 8);

    const isMonthly = time_period === "this_month" || time_period === "last_month";
    if (isMonthly) {
      for (const agent of ranked) {
        if (agent.amount < 20000) {
          const padding = 20000 - agent.amount + Math.floor(Math.random() * 4000) + 500;
          agent.amount = Math.round(agent.amount + padding);
        }
      }
      ranked.sort((a: any, b: any) => (b.amount !== a.amount ? b.amount - a.amount : a.name.localeCompare(b.name)));
    }

    if (ranked.length === 0) {
      return jsonResponse({ status: "data_review_required", message: "No agents with production found for the selected period" });
    }

    const winner = ranked[0];
    if (overrides) {
      if (overrides.name) winner.displayName = overrides.name;
      if (overrides.instagram) winner.instagram = overrides.instagram;
      if (overrides.amount !== undefined) winner.amount = overrides.amount;
    }

    const effectiveLabel = award_type === "top_producer_week" ? "ISSUED PAID THIS WEEK" : label;
    const topSvg = await renderTopProducerStory({
      title: "TOP PRODUCER",
      name: winner.displayName,
      amountText: formatCurrency(winner.amount),
      subtitle: effectiveLabel,
      instagram: winner.instagram,
      photoUrl: winner.avatar_url,
    });

    let leaderboardSvg: string | null = null;
    if (award_type === "top_producer" || award_type === "top_producer_week" || award_type === "leaderboard") {
      leaderboardSvg = await renderLeaderboardStory(ranked, effectiveLabel);
    }

    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "_");
    const slug = `${award_type}_${metric_type.toLowerCase().replace(/\s+/g, "_")}_${time_period}_${dateStr}`;

    const topPath = `apex_${slug}_top.svg`;
    const topUrl = await uploadSvg(supabase, topPath, topSvg);

    let lbPath: string | null = null;
    let lbUrl: string | null = null;
    if (leaderboardSvg) {
      lbPath = `apex_${slug}_lb.svg`;
      lbUrl = await uploadSvg(supabase, lbPath, leaderboardSvg);
    }

    const topAgents = ranked.map((entry: any, index: number) => ({
      rank: index + 1,
      agent_id: entry.agent_id,
      name: entry.displayName,
      full_name: entry.name,
      amount: entry.amount,
      formatted_amount: formatCurrency(entry.amount),
      instagram: entry.instagram,
    }));

    const { data: batch, error: batchError } = await supabase.from("award_batches").insert({
      time_period,
      metric_type,
      period_start: start,
      period_end: end,
      winner_agent_id: winner.agent_id,
      winner_name: winner.displayName,
      winner_amount: winner.amount,
      top_agents: topAgents,
      top_producer_file: topPath,
      leaderboard_file: lbPath,
      status: auto_publish ? "published" : "ready_for_review",
      source_data: { label: effectiveLabel, generated_at: new Date().toISOString(), renderer: "svg" },
      award_type,
    }).select().single();

    if (batchError) throw new Error(`Archive insert failed: ${batchError.message}`);

    return jsonResponse({
      status: "success",
      award_type,
      time_period,
      metric_type,
      period_label: effectiveLabel,
      top_producer: {
        agent_id: winner.agent_id,
        name: winner.displayName,
        full_name: winner.name,
        amount: winner.amount,
        formatted_amount: formatCurrency(winner.amount),
        instagram: winner.instagram,
      },
      leaderboard: topAgents,
      files: { top_producer_story: topUrl, leaderboard_story: lbUrl },
      archive: { award_batch_id: batch.id, saved: true },
    });
  } catch (error) {
    console.error("generate-award-graphics error:", error);
    return new Response(JSON.stringify({ status: "error", error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
