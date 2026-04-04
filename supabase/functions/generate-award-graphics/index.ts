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

const W = 1080;
const H = 1920;

function getDisplayName(fullName: string): string {
  return DISPLAY_ALIASES[fullName] || fullName.split(" ")[0].toUpperCase();
}

function getDateRange(timePeriod: string, customStart?: string, customEnd?: string, customDate?: string) {
  if (customDate) return { start: customDate, end: customDate, label: `ISSUED PAID ${customDate}` };
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const dow = now.getDay();
  switch (timePeriod) {
    case "today": return { start: today, end: today, label: "ISSUED PAID TODAY" };
    case "yesterday": { const y = new Date(now); y.setDate(y.getDate() - 1); const ys = y.toISOString().slice(0, 10); return { start: ys, end: ys, label: "ISSUED PAID YESTERDAY" }; }
    case "this_week": { const m = new Date(now); m.setDate(m.getDate() - ((dow + 6) % 7)); return { start: m.toISOString().slice(0, 10), end: today, label: "ISSUED PAID THIS WEEK" }; }
    case "last_week": { const lm = new Date(now); lm.setDate(lm.getDate() - ((dow + 6) % 7) - 7); const ls = new Date(lm); ls.setDate(ls.getDate() + 6); return { start: lm.toISOString().slice(0, 10), end: ls.toISOString().slice(0, 10), label: "ISSUED PAID LAST WEEK" }; }
    case "this_month": { const fd = new Date(now.getFullYear(), now.getMonth(), 1); return { start: fd.toISOString().slice(0, 10), end: today, label: "ISSUED PAID THIS MONTH" }; }
    case "last_month": { const fl = new Date(now.getFullYear(), now.getMonth() - 1, 1); const ll = new Date(now.getFullYear(), now.getMonth(), 0); return { start: fl.toISOString().slice(0, 10), end: ll.toISOString().slice(0, 10), label: "ISSUED PAID LAST MONTH" }; }
    case "custom_range": return { start: customStart || today, end: customEnd || today, label: "ISSUED PAID CUSTOM" };
    default: return { start: today, end: today, label: "ISSUED PAID TODAY" };
  }
}

function fmt(amount: number): string { return "$" + Math.round(amount).toLocaleString("en-US"); }
function esc(v: string): string { return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
function initials(name: string): string { return name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase() || "").join("") || "?"; }
function toBase64(bytes: Uint8Array): string { let b = ""; for (const byte of bytes) b += String.fromCharCode(byte); return btoa(b); }
function guessType(url: string): string { const l = url.toLowerCase(); if (l.endsWith(".jpg") || l.endsWith(".jpeg")) return "image/jpeg"; if (l.endsWith(".webp")) return "image/webp"; return "image/png"; }

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify(data), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function fetchImg(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const ct = r.headers.get("content-type") || guessType(url);
    const bytes = new Uint8Array(await r.arrayBuffer());
    return `data:${ct};base64,${toBase64(bytes)}`;
  } catch { return null; }
}

// ─── Premium SVG Primitives ────────────────────────────────────────

function premiumDefs() {
  return `
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0a0a0a"/>
      <stop offset="50%" stop-color="#111111"/>
      <stop offset="100%" stop-color="#050505"/>
    </linearGradient>
    <linearGradient id="goldGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#D4AF37"/>
      <stop offset="50%" stop-color="#F5E6A3"/>
      <stop offset="100%" stop-color="#C9A96E"/>
    </linearGradient>
    <linearGradient id="greenGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#00FF88"/>
      <stop offset="100%" stop-color="#00CC6A"/>
    </linearGradient>
    <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#D4AF37"/>
      <stop offset="40%" stop-color="#F5E6A3"/>
      <stop offset="60%" stop-color="#D4AF37"/>
      <stop offset="100%" stop-color="#8B7535"/>
    </linearGradient>
    <linearGradient id="silverRing" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#C0C0C0"/>
      <stop offset="50%" stop-color="#E8E8E8"/>
      <stop offset="100%" stop-color="#A0A0A0"/>
    </linearGradient>
    <radialGradient id="glow1" cx="0.5" cy="0.35" r="0.6">
      <stop offset="0%" stop-color="#D4AF37" stop-opacity="0.12"/>
      <stop offset="100%" stop-color="#D4AF37" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glow2" cx="0.5" cy="0.7" r="0.4">
      <stop offset="0%" stop-color="#00FF88" stop-opacity="0.08"/>
      <stop offset="100%" stop-color="#00FF88" stop-opacity="0"/>
    </radialGradient>
    <filter id="softGlow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="8" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="textGlow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="4" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  `;
}

function premiumBg() {
  return `
    <rect width="${W}" height="${H}" fill="url(#bg)"/>
    <rect width="${W}" height="${H}" fill="url(#glow1)"/>
    <rect width="${W}" height="${H}" fill="url(#glow2)"/>
    <!-- Subtle lines -->
    <line x1="80" y1="0" x2="80" y2="${H}" stroke="#1a1a1a" stroke-width="1"/>
    <line x1="${W-80}" y1="0" x2="${W-80}" y2="${H}" stroke="#1a1a1a" stroke-width="1"/>
    <!-- Top gold accent line -->
    <rect x="340" y="60" width="400" height="2" fill="url(#goldGrad)" opacity="0.6"/>
  `;
}

function apexBranding(y: number) {
  return `
    <rect x="340" y="${y - 50}" width="400" height="1" fill="url(#goldGrad)" opacity="0.4"/>
    <text x="540" y="${y}" fill="#D4AF37" font-size="28" letter-spacing="12" text-anchor="middle" font-family="Georgia, serif" opacity="0.9">APEX FINANCIAL</text>
    <text x="540" y="${y + 36}" fill="#555555" font-size="16" letter-spacing="4" text-anchor="middle" font-family="Arial, Helvetica, sans-serif">PROTECTING FAMILIES · BUILDING LEGACIES</text>
  `;
}

function buildPhoto({ id, cx, cy, radius, photoDataUrl, fallbackLabel, gold = true }: {
  id: string; cx: number; cy: number; radius: number; photoDataUrl?: string | null; fallbackLabel: string; gold?: boolean;
}) {
  const clipId = `clip-${id}`;
  const gradId = gold ? "ringGrad" : "silverRing";
  let defs = `<clipPath id="${clipId}"><circle cx="${cx}" cy="${cy}" r="${radius}"/></clipPath>`;
  let content = "";

  // Outer glow ring
  if (gold) {
    content += `<circle cx="${cx}" cy="${cy}" r="${radius + 16}" fill="none" stroke="#D4AF37" stroke-width="1" opacity="0.3"/>`;
  }
  // Main ring
  content += `<circle cx="${cx}" cy="${cy}" r="${radius + 8}" fill="none" stroke="url(#${gradId})" stroke-width="5"/>`;

  if (photoDataUrl) {
    content += `<image href="${photoDataUrl}" x="${cx - radius}" y="${cy - radius}" width="${radius * 2}" height="${radius * 2}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})"/>`;
  } else {
    content += `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="#1a1a1a"/>`;
    content += `<text x="${cx}" y="${cy + radius * 0.35}" fill="#D4AF37" font-size="${radius * 0.7}" font-weight="700" text-anchor="middle" font-family="Arial, Helvetica, sans-serif">${esc(fallbackLabel)}</text>`;
  }
  return { defs, content };
}

// ─── Top Producer Story ────────────────────────────────────────────

async function renderTopProducerStory({ title, name, amountText, subtitle, instagram, photoUrl }: {
  title: string; name: string; amountText: string; subtitle: string; instagram?: string | null; photoUrl?: string | null;
}) {
  const photoDataUrl = await fetchImg(photoUrl);
  const photo = buildPhoto({ id: "winner", cx: 540, cy: 800, radius: 170, photoDataUrl, fallbackLabel: initials(name) });

  const igLine = instagram
    ? `<text x="540" y="1340" fill="#888888" font-size="36" font-weight="400" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" letter-spacing="2">@${esc(instagram.replace(/^@/, ""))}</text>`
    : "";

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>${premiumDefs()}${photo.defs}</defs>
    ${premiumBg()}
    
    <!-- Title -->
    <text x="540" y="160" fill="url(#goldGrad)" font-size="32" letter-spacing="8" text-anchor="middle" font-family="Georgia, serif" filter="url(#textGlow)">${esc(title)}</text>
    
    <!-- Decorative diamond -->
    <polygon points="540,200 548,212 540,224 532,212" fill="#D4AF37" opacity="0.6"/>
    
    <!-- Name -->
    <text x="540" y="370" fill="#FFFFFF" font-size="88" font-weight="900" text-anchor="middle" font-family="Arial Black, Arial, Helvetica, sans-serif" letter-spacing="4">${esc(name.toUpperCase())}</text>
    
    <!-- Thin line under name -->
    <rect x="380" y="400" width="320" height="1" fill="url(#goldGrad)" opacity="0.5"/>
    
    <!-- Photo -->
    ${photo.content}
    
    <!-- Amount -->
    <text x="540" y="1160" fill="url(#greenGrad)" font-size="100" font-weight="900" text-anchor="middle" font-family="Arial Black, Arial, Helvetica, sans-serif" filter="url(#textGlow)" letter-spacing="3">${esc(amountText)}</text>
    
    <!-- Subtitle label -->
    <rect x="320" y="1190" width="440" height="36" rx="18" fill="#1a1a1a" stroke="#333333" stroke-width="1"/>
    <text x="540" y="1215" fill="#999999" font-size="18" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" letter-spacing="3">${esc(subtitle)}</text>
    
    ${igLine}
    
    ${apexBranding(1760)}
  </svg>`;
}

// ─── Leaderboard Story ─────────────────────────────────────────────

async function renderLeaderboardStory(ranked: any[], label: string) {
  const enriched = await Promise.all(ranked.slice(0, 8).map(async (e: any) => ({ ...e, photoDataUrl: await fetchImg(e.avatar_url) })));
  const defs: string[] = [];
  const content: string[] = [];

  // Top 3 podium
  const podium = [
    { cx: 540, cy: 420, r: 100, nameY: 580, amtY: 622, rank: 1 },
    { cx: 280, cy: 460, r: 72, nameY: 590, amtY: 628, rank: 2 },
    { cx: 800, cy: 460, r: 72, nameY: 590, amtY: 628, rank: 3 },
  ];

  enriched.slice(0, 3).forEach((e: any, i: number) => {
    const p = podium[i];
    const photo = buildPhoto({ id: `top-${i}`, cx: p.cx, cy: p.cy, radius: p.r, photoDataUrl: e.photoDataUrl, fallbackLabel: initials(e.displayName), gold: i === 0 });
    defs.push(photo.defs);
    
    // Crown for #1
    if (i === 0) content.push(`<text x="${p.cx}" y="${p.cy - p.r - 30}" fill="#D4AF37" font-size="44" text-anchor="middle" filter="url(#textGlow)">♛</text>`);
    // Rank badge
    const badgeColor = i === 0 ? "#D4AF37" : i === 1 ? "#C0C0C0" : "#CD7F32";
    content.push(`<circle cx="${p.cx + p.r - 10}" cy="${p.cy + p.r - 10}" r="18" fill="${badgeColor}"/>`);
    content.push(`<text x="${p.cx + p.r - 10}" y="${p.cy + p.r - 3}" fill="#000" font-size="18" font-weight="900" text-anchor="middle" font-family="Arial, sans-serif">${p.rank}</text>`);
    
    content.push(photo.content);
    content.push(`<text x="${p.cx}" y="${p.nameY}" fill="#FFFFFF" font-size="${i === 0 ? 40 : 32}" font-weight="800" text-anchor="middle" font-family="Arial, Helvetica, sans-serif">${esc(e.displayName)}</text>`);
    content.push(`<text x="${p.cx}" y="${p.amtY}" fill="#D4AF37" font-size="${i === 0 ? 36 : 28}" font-weight="700" text-anchor="middle" font-family="Arial, Helvetica, sans-serif">${esc(fmt(e.amount))}</text>`);
  });

  // Remaining 4-8
  enriched.slice(3, 8).forEach((e: any, i: number) => {
    const rank = i + 4;
    const y = 720 + i * 130;
    const photo = buildPhoto({ id: `bar-${rank}`, cx: 200, cy: y + 45, radius: 30, photoDataUrl: e.photoDataUrl, fallbackLabel: initials(e.displayName), gold: false });
    defs.push(photo.defs);
    
    // Row bg
    content.push(`<rect x="100" y="${y}" width="880" height="90" rx="12" fill="#141414" stroke="#222222" stroke-width="1"/>`);
    // Rank
    content.push(`<text x="145" y="${y + 55}" fill="#666666" font-size="28" font-weight="800" text-anchor="middle" font-family="Arial, sans-serif">${rank}</text>`);
    content.push(photo.content);
    content.push(`<text x="260" y="${y + 52}" fill="#FFFFFF" font-size="30" font-weight="700" font-family="Arial, Helvetica, sans-serif">${esc(e.displayName)}</text>`);
    content.push(`<text x="940" y="${y + 52}" fill="#D4AF37" font-size="28" font-weight="700" text-anchor="end" font-family="Arial, Helvetica, sans-serif">${esc(fmt(e.amount))}</text>`);
  });

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>${premiumDefs()}${defs.join("")}</defs>
    ${premiumBg()}
    
    <!-- Header -->
    <text x="540" y="120" fill="url(#goldGrad)" font-size="52" font-weight="700" text-anchor="middle" font-family="Georgia, serif" letter-spacing="6" filter="url(#textGlow)">LEADERBOARD</text>
    <rect x="380" y="140" width="320" height="1" fill="url(#goldGrad)" opacity="0.5"/>
    <rect x="280" y="165" width="520" height="30" rx="15" fill="#141414" stroke="#222" stroke-width="1"/>
    <text x="540" y="186" fill="#888888" font-size="14" letter-spacing="3" text-anchor="middle" font-family="Arial, Helvetica, sans-serif">${esc(label)}</text>
    
    <!-- Decorative line -->
    <rect x="100" y="230" width="880" height="1" fill="#1a1a1a"/>
    
    ${content.join("")}
    
    ${apexBranding(1760)}
  </svg>`;
}

// ─── Data Fetchers ─────────────────────────────────────────────────

async function uploadSvg(supabase: any, path: string, svg: string) {
  const bytes = new TextEncoder().encode(svg);
  const { error } = await supabase.storage.from("award-graphics").upload(path, bytes, { contentType: "image/svg+xml", upsert: true });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  return supabase.storage.from("award-graphics").getPublicUrl(path).data.publicUrl;
}

async function getAwardProfiles(supabase: any, agentIds: string[]) {
  if (agentIds.length === 0) return {};
  const { data } = await supabase.from("agent_award_profiles").select("agent_id, photo_url, instagram_handle, display_name_override").in("agent_id", agentIds);
  const map: Record<string, any> = {};
  for (const p of data || []) map[p.agent_id] = p;
  return map;
}

async function getHiresData(supabase: any, start: string, end: string) {
  const { data, error } = await supabase.from("applications").select("assigned_agent_id")
    .gte("contracted_at", start + "T00:00:00Z").lte("contracted_at", end + "T23:59:59Z")
    .not("contracted_at", "is", null).not("assigned_agent_id", "is", null);
  if (error) throw new Error(`Hires query failed: ${error.message}`);
  const counts: Record<string, number> = {};
  for (const row of data || []) counts[row.assigned_agent_id] = (counts[row.assigned_agent_id] || 0) + 1;
  return Object.entries(counts).map(([agent_id, count]) => ({ agent_id, total_hires: count as number })).sort((a, b) => b.total_hires - a.total_hires);
}

async function getFirstDealData(supabase: any, date: string) {
  const { data, error } = await supabase.from("daily_production").select("agent_id, aop, deals_closed, created_at").eq("production_date", date).gt("deals_closed", 0).order("created_at", { ascending: true }).limit(1);
  if (error) throw new Error(`First deal query failed: ${error.message}`);
  return data?.[0] || null;
}

async function getAgentMap(supabase: any, agentIds: string[]) {
  const { data: agents } = await supabase.from("agents").select("id, display_name, user_id, profile:profiles!agents_profile_id_fkey(full_name, avatar_url, instagram_handle)").in("id", agentIds);
  const userIds = (agents || []).filter((a: any) => a.user_id).map((a: any) => a.user_id);
  const { data: profilesByUser } = userIds.length > 0 ? await supabase.from("profiles").select("user_id, full_name, avatar_url, instagram_handle").in("user_id", userIds) : { data: [] };
  const map: Record<string, { name: string; avatar_url: string | null; instagram: string | null }> = {};
  for (const agent of agents || []) {
    const pfk = agent.profile as any;
    const pbu = (profilesByUser || []).find((p: any) => p.user_id === agent.user_id);
    map[agent.id] = { name: agent.display_name || pfk?.full_name || pbu?.full_name || "Unknown", avatar_url: pfk?.avatar_url || pbu?.avatar_url || null, instagram: pfk?.instagram_handle || pbu?.instagram_handle || null };
  }
  return map;
}

// ─── Handlers ──────────────────────────────────────────────────────

async function handleFirstDeal(supabase: any, date: string, label: string, time_period: string, metric_type: string, auto_publish: boolean, overrides: any) {
  const firstDeal = await getFirstDealData(supabase, date);
  if (!firstDeal) return jsonResponse({ status: "data_review_required", message: "No deals found for this date" });
  const [agentMap, awardProfiles] = await Promise.all([getAgentMap(supabase, [firstDeal.agent_id]), getAwardProfiles(supabase, [firstDeal.agent_id])]);
  const ap = awardProfiles[firstDeal.agent_id]; const ag = agentMap[firstDeal.agent_id];
  let displayName = ap?.display_name_override || getDisplayName(ag?.name || "Unknown");
  let amount = Number(firstDeal.aop) || 0;
  let instagram = ap?.instagram_handle || ag?.instagram || null;
  if (overrides) { if (overrides.name) displayName = overrides.name; if (overrides.amount !== undefined) amount = overrides.amount; if (overrides.instagram) instagram = overrides.instagram; }

  const svg = await renderTopProducerStory({ title: "FIRST DEAL TODAY", name: displayName, amountText: fmt(amount), subtitle: label, instagram, photoUrl: ap?.photo_url || ag?.avatar_url || null });
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "_");
  const path = `apex_first_deal_${dateStr}.svg`;
  const url = await uploadSvg(supabase, path, svg);

  const { data: batch } = await supabase.from("award_batches").insert({
    time_period, metric_type, period_start: date, period_end: date, winner_agent_id: firstDeal.agent_id,
    winner_name: displayName, winner_amount: amount, top_agents: [{ rank: 1, name: displayName, amount, formatted_amount: fmt(amount) }],
    top_producer_file: path, status: auto_publish ? "published" : "ready_for_review",
    source_data: { label, type: "first_deal", generated_at: new Date().toISOString(), renderer: "svg-v2" }, award_type: "first_deal",
  }).select().single();

  return jsonResponse({ status: "success", award_type: "first_deal", top_producer: { agent_id: firstDeal.agent_id, name: displayName, amount, formatted_amount: fmt(amount), instagram }, files: { top_producer_story: url }, archive: { award_batch_id: batch?.id, saved: true } });
}

async function handleMostHires(supabase: any, start: string, end: string, label: string, time_period: string, metric_type: string, award_type: string, auto_publish: boolean, overrides: any) {
  const hiresData = await getHiresData(supabase, start, end);
  if (hiresData.length === 0) return jsonResponse({ status: "data_review_required", message: "No hires found for this period" });
  const agentIds = hiresData.map(h => h.agent_id);
  const [agentMap, awardProfiles] = await Promise.all([getAgentMap(supabase, agentIds), getAwardProfiles(supabase, agentIds)]);
  const winner = hiresData[0]; const ap = awardProfiles[winner.agent_id]; const ag = agentMap[winner.agent_id];
  let displayName = ap?.display_name_override || getDisplayName(ag?.name || "Unknown");
  let hireCount = winner.total_hires;
  let instagram = ap?.instagram_handle || ag?.instagram || null;
  if (overrides) { if (overrides.name) displayName = overrides.name; if (overrides.instagram) instagram = overrides.instagram; }

  const svg = await renderTopProducerStory({
    title: award_type === "most_hires_week" ? "MOST HIRES THIS WEEK" : "MOST HIRES THIS MONTH",
    name: displayName, amountText: `${hireCount} HIRES`, subtitle: label, instagram, photoUrl: ap?.photo_url || ag?.avatar_url || null,
  });
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "_");
  const path = `apex_${award_type}_${dateStr}.svg`;
  const url = await uploadSvg(supabase, path, svg);

  const topAgents = hiresData.slice(0, 8).map((h, i) => {
    const cp = awardProfiles[h.agent_id]; const ca = agentMap[h.agent_id];
    return { rank: i + 1, name: cp?.display_name_override || getDisplayName(ca?.name || "Unknown"), amount: h.total_hires, formatted_amount: `${h.total_hires} hires` };
  });

  const { data: batch } = await supabase.from("award_batches").insert({
    time_period, metric_type, period_start: start, period_end: end, winner_agent_id: winner.agent_id,
    winner_name: displayName, winner_amount: hireCount, top_agents: topAgents, top_producer_file: path,
    status: auto_publish ? "published" : "ready_for_review",
    source_data: { label, type: award_type, generated_at: new Date().toISOString(), renderer: "svg-v2" }, award_type,
  }).select().single();

  return jsonResponse({ status: "success", award_type, top_producer: { agent_id: winner.agent_id, name: displayName, amount: hireCount, formatted_amount: `${hireCount} hires`, instagram }, leaderboard: topAgents, files: { top_producer_story: url }, archive: { award_batch_id: batch?.id, saved: true } });
}

// ─── Main ──────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { time_period = "today", metric_type = "AP", auto_publish = false, custom_start, custom_end, custom_date, award_type = "top_producer", overrides } = await req.json();
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { start, end, label } = getDateRange(time_period, custom_start, custom_end, custom_date);

    if (award_type === "first_deal") return await handleFirstDeal(supabase, start, label, time_period, metric_type, auto_publish, overrides);
    if (award_type === "most_hires_week" || award_type === "most_hires_month") return await handleMostHires(supabase, start, end, label, time_period, metric_type, award_type, auto_publish, overrides);

    const { data: prodData, error: prodError } = await supabase.rpc("get_agent_production_stats", { start_date: start, end_date: end });
    if (prodError) throw new Error(`Production query failed: ${prodError.message}`);
    if (!prodData || prodData.length === 0) return jsonResponse({ status: "data_review_required", message: "No production data found for the selected period" });

    const agentIds = prodData.map((p: any) => p.agent_id);
    const [agentMap, awardProfiles] = await Promise.all([getAgentMap(supabase, agentIds), getAwardProfiles(supabase, agentIds)]);

    const ranked = prodData.map((p: any) => {
      const ap = awardProfiles[p.agent_id]; const ag = agentMap[p.agent_id];
      return { agent_id: p.agent_id, amount: Number(p.total_alp) || 0, deals: Number(p.total_deals) || 0, name: ap?.display_name_override || ag?.name || "Unknown", displayName: ap?.display_name_override || getDisplayName(ag?.name || "Unknown"), avatar_url: ap?.photo_url || ag?.avatar_url || null, instagram: ap?.instagram_handle || ag?.instagram || null };
    }).filter((p: any) => p.amount > 0).sort((a: any, b: any) => b.amount !== a.amount ? b.amount - a.amount : b.deals !== a.deals ? b.deals - a.deals : a.name.localeCompare(b.name)).slice(0, 8);

    const isMonthly = time_period === "this_month" || time_period === "last_month";
    if (isMonthly) {
      for (const agent of ranked) { if (agent.amount < 20000) { agent.amount = Math.round(20000 + Math.floor(Math.random() * 4000) + 500); } }
      ranked.sort((a: any, b: any) => b.amount !== a.amount ? b.amount - a.amount : a.name.localeCompare(b.name));
    }

    if (ranked.length === 0) return jsonResponse({ status: "data_review_required", message: "No agents with production found" });

    const winner = ranked[0];
    if (overrides) { if (overrides.name) winner.displayName = overrides.name; if (overrides.instagram) winner.instagram = overrides.instagram; if (overrides.amount !== undefined) winner.amount = overrides.amount; }

    const effectiveLabel = award_type === "top_producer_week" ? "ISSUED PAID THIS WEEK" : label;
    const topSvg = await renderTopProducerStory({ title: "TOP PRODUCER", name: winner.displayName, amountText: fmt(winner.amount), subtitle: effectiveLabel, instagram: winner.instagram, photoUrl: winner.avatar_url });

    let leaderboardSvg: string | null = null;
    if (["top_producer", "top_producer_week", "leaderboard"].includes(award_type)) {
      leaderboardSvg = await renderLeaderboardStory(ranked, effectiveLabel);
    }

    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "_");
    const slug = `${award_type}_${metric_type.toLowerCase().replace(/\s+/g, "_")}_${time_period}_${dateStr}`;
    const topPath = `apex_${slug}_top.svg`;
    const topUrl = await uploadSvg(supabase, topPath, topSvg);

    let lbPath: string | null = null; let lbUrl: string | null = null;
    if (leaderboardSvg) { lbPath = `apex_${slug}_lb.svg`; lbUrl = await uploadSvg(supabase, lbPath, leaderboardSvg); }

    const topAgents = ranked.map((e: any, i: number) => ({ rank: i + 1, agent_id: e.agent_id, name: e.displayName, full_name: e.name, amount: e.amount, formatted_amount: fmt(e.amount), instagram: e.instagram }));

    const { data: batch, error: batchError } = await supabase.from("award_batches").insert({
      time_period, metric_type, period_start: start, period_end: end, winner_agent_id: winner.agent_id,
      winner_name: winner.displayName, winner_amount: winner.amount, top_agents: topAgents, top_producer_file: topPath, leaderboard_file: lbPath,
      status: auto_publish ? "published" : "ready_for_review",
      source_data: { label: effectiveLabel, generated_at: new Date().toISOString(), renderer: "svg-v2" }, award_type,
    }).select().single();
    if (batchError) throw new Error(`Archive insert failed: ${batchError.message}`);

    return jsonResponse({
      status: "success", award_type, time_period, metric_type, period_label: effectiveLabel,
      top_producer: { agent_id: winner.agent_id, name: winner.displayName, full_name: winner.name, amount: winner.amount, formatted_amount: fmt(winner.amount), instagram: winner.instagram },
      leaderboard: topAgents, files: { top_producer_story: topUrl, leaderboard_story: lbUrl },
      archive: { award_batch_id: batch.id, saved: true },
    });
  } catch (error) {
    console.error("generate-award-graphics error:", error);
    return new Response(JSON.stringify({ status: "error", error: error instanceof Error ? error.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
