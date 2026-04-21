/**
 * render-all-plaques — magazine-quality APEX plaque renderer
 *
 * Produces Instagram-story (1080×1920) SVG plaques with the agent's
 * PHOTO embedded as a base64-encoded <image/> element, plus tier
 * branding, big-number amount, and APEX accent stack.
 *
 * Pure string templates — no WASM, no server-side PNG rendering.
 * The SVG is stored as a data URI in plaque_awards.image_svg_url and
 * renders natively in every modern browser + email client.
 *
 * Body:
 *   { limit?: number, force?: boolean, agent_id?: string }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Tier = {
  accent: string;
  accent2: string;
  glow: string;
  badge: string;
  sub: string;
  tagline: string;
};

const TIER: Record<string, Tier> = {
  single_day_platinum: { accent: "#c0c0c0", accent2: "#e5e4e2", glow: "#8b5cf6", badge: "PLATINUM", sub: "$5K+ Single Day",    tagline: "ELITE TERRITORY" },
  single_day:          { accent: "#f59e0b", accent2: "#fbbf24", glow: "#f59e0b", badge: "GOLD",     sub: "$3K+ Single Day",    tagline: "WINNER'S CIRCLE" },
  single_day_bronze:   { accent: "#cd7f32", accent2: "#e8a058", glow: "#f59e0b", badge: "BRONZE",   sub: "$1K+ Single Day",    tagline: "THE CLIMB" },
  weekly:              { accent: "#06b6d4", accent2: "#67e8f9", glow: "#06b6d4", badge: "WEEKLY",   sub: "$10K+ Week",         tagline: "DIAMOND WEEK" },
  monthly:             { accent: "#8b5cf6", accent2: "#c4b5fd", glow: "#8b5cf6", badge: "MONTHLY",  sub: "$25K+ Month",        tagline: "ELITE PRODUCER" },
  hot_streak:          { accent: "#f59e0b", accent2: "#fb923c", glow: "#ef4444", badge: "STREAK",   sub: "5+ Days Straight",   tagline: "UNSTOPPABLE" },
  team_week_50k:       { accent: "#22d3a5", accent2: "#6ee7b7", glow: "#22d3a5", badge: "TEAM",     sub: "$50K+ Team Week",    tagline: "CHAMPIONS" },
  team_two_day_20k:    { accent: "#22d3a5", accent2: "#6ee7b7", glow: "#22d3a5", badge: "TEAM",     sub: "$20K+ Two Days",     tagline: "BACK-TO-BACK" },
  team_single_day_10k: { accent: "#22d3a5", accent2: "#6ee7b7", glow: "#22d3a5", badge: "TEAM",     sub: "$10K+ One Day",      tagline: "GAMEDAY" },
  streak_5:            { accent: "#f59e0b", accent2: "#fb923c", glow: "#ef4444", badge: "STREAK",   sub: "5 Days Straight",    tagline: "MOMENTUM" },
  first_deal_of_day:   { accent: "#22d3a5", accent2: "#6ee7b7", glow: "#22d3a5", badge: "FIRST",    sub: "Opened the Board",   tagline: "LEAD THE DAY" },
  diamond_week:        { accent: "#06b6d4", accent2: "#67e8f9", glow: "#06b6d4", badge: "DIAMOND",  sub: "Elite Week",         tagline: "DIAMOND STATUS" },
};

function fmt$(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}
function prettyDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}
function initials(name: string): string {
  const parts = (name || "?").trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

async function fetchImageAsDataUri(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length > 2_500_000) return null; // 2.5MB cap — keep SVG sane
    const b64 = btoa(Array.from(buf).map(b => String.fromCharCode(b)).join(""));
    const ct = res.headers.get("content-type") ?? "image/jpeg";
    return `data:${ct};base64,${b64}`;
  } catch {
    return null;
  }
}

function renderSVG(name: string, tier: string, amount: number, date: string, photoDataUri: string | null): string {
  const t = TIER[tier] ?? TIER.single_day_bronze;
  const hasPhoto = !!photoDataUri;

  // Photo portrait anchored to the right side, APEX brand stack anchored left.
  // Matches the Wolfpack/Viper social-card composition but with APEX emerald accent over red-to-black gradient.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1920" width="1080" height="1920">
<defs>
  <linearGradient id="bgGrad" x1="0" y1="0" x2="0.8" y2="1">
    <stop offset="0" stop-color="${t.accent}" stop-opacity="0.28"/>
    <stop offset="0.35" stop-color="#0a0f1a"/>
    <stop offset="1" stop-color="#020617"/>
  </linearGradient>
  <linearGradient id="accentBar" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="${t.accent}"/>
    <stop offset="1" stop-color="${t.accent2}"/>
  </linearGradient>
  <radialGradient id="photoGlow" cx="0.5" cy="0.5" r="0.7">
    <stop offset="0" stop-color="${t.glow}" stop-opacity="0.45"/>
    <stop offset="1" stop-color="${t.glow}" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="photoFade" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#000" stop-opacity="0"/>
    <stop offset="1" stop-color="#000" stop-opacity="0.55"/>
  </linearGradient>
  <clipPath id="photoClip"><rect x="540" y="220" width="500" height="1100" rx="16"/></clipPath>
  <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
    <feGaussianBlur stdDeviation="18"/>
  </filter>
</defs>

<!-- Background -->
<rect width="1080" height="1920" fill="#020617"/>
<rect width="1080" height="1920" fill="url(#bgGrad)"/>

<!-- Giant tier wordmark behind the photo (watermark style like the Wolfpack refs) -->
<text x="540" y="1000" text-anchor="middle" font-family="ui-sans-serif,system-ui" font-weight="800" font-size="420" fill="${t.accent}" fill-opacity="0.07" letter-spacing="8">${esc(t.badge)}</text>
<text x="540" y="1280" text-anchor="middle" font-family="ui-sans-serif,system-ui" font-weight="800" font-size="420" fill="${t.accent}" fill-opacity="0.05" letter-spacing="8">${esc(t.badge)}</text>

<!-- Photo glow -->
<circle cx="790" cy="760" r="420" fill="url(#photoGlow)"/>

<!-- Agent photo or initials fallback, right-anchored portrait -->
${hasPhoto ? `<g clip-path="url(#photoClip)">
  <image href="${photoDataUri}" x="540" y="220" width="500" height="1100" preserveAspectRatio="xMidYMid slice"/>
  <rect x="540" y="220" width="500" height="1100" fill="url(#photoFade)"/>
</g>
<rect x="540" y="220" width="500" height="1100" rx="16" fill="none" stroke="${t.accent}" stroke-opacity="0.5" stroke-width="3"/>` :
`<g>
  <rect x="540" y="220" width="500" height="1100" rx="16" fill="${t.accent}" fill-opacity="0.10" stroke="${t.accent}" stroke-opacity="0.35" stroke-width="3" stroke-dasharray="12 10"/>
  <circle cx="790" cy="770" r="180" fill="${t.accent}" fill-opacity="0.15"/>
  <text x="790" y="820" text-anchor="middle" font-family="ui-sans-serif,system-ui" font-weight="800" font-size="200" fill="#ffffff">${esc(initials(name))}</text>
  <text x="790" y="1250" text-anchor="middle" font-family="ui-sans-serif,system-ui" font-weight="600" font-size="22" fill="#94a3b8" letter-spacing="3">ADD PHOTO TO UPGRADE</text>
</g>`}

<!-- APEX brand header -->
<text x="80" y="120" font-family="ui-sans-serif,system-ui" font-weight="800" font-size="48" fill="#22d3a5" letter-spacing="6">APEX</text>
<text x="80" y="120" font-family="ui-sans-serif,system-ui" font-weight="400" font-size="48" fill="#f8fafc" letter-spacing="6" dx="170">FINANCIAL</text>
<rect x="80" y="140" width="110" height="3" fill="url(#accentBar)"/>

<!-- Tier badge -->
<rect x="80" y="200" width="380" height="48" rx="24" fill="${t.accent}" fill-opacity="0.15" stroke="${t.accent}" stroke-opacity="0.6" stroke-width="2"/>
<text x="270" y="232" text-anchor="middle" font-family="ui-sans-serif,system-ui" font-weight="700" font-size="20" fill="${t.accent}" letter-spacing="6">${esc(t.badge)} · ${esc(t.sub)}</text>

<!-- Tagline -->
<text x="80" y="340" font-family="ui-sans-serif,system-ui" font-weight="800" font-size="64" fill="#f8fafc" letter-spacing="2">${esc(t.tagline)}</text>

<!-- Massive amount -->
<text x="80" y="580" font-family="ui-sans-serif,system-ui" font-weight="900" font-size="200" fill="${t.accent}">${esc(fmt$(amount))}</text>
<text x="80" y="640" font-family="ui-sans-serif,system-ui" font-weight="500" font-size="26" fill="#94a3b8" letter-spacing="4">SINGLE-DAY PRODUCTION</text>

<!-- Agent name card -->
<rect x="80" y="1440" width="500" height="140" rx="16" fill="#0d1526" stroke="${t.accent}" stroke-opacity="0.4" stroke-width="2"/>
<text x="110" y="1490" font-family="ui-sans-serif,system-ui" font-weight="500" font-size="18" fill="#64748b" letter-spacing="4">AGENT</text>
<text x="110" y="1550" font-family="ui-sans-serif,system-ui" font-weight="800" font-size="44" fill="#f8fafc">${esc(name.toUpperCase())}</text>

<!-- Date / footer row -->
<rect x="80" y="1780" width="920" height="2" fill="${t.accent}" fill-opacity="0.35"/>
<text x="80" y="1830" font-family="ui-sans-serif,system-ui" font-weight="600" font-size="22" fill="#94a3b8" letter-spacing="3">${esc(prettyDate(date).toUpperCase())}</text>
<text x="1000" y="1830" text-anchor="end" font-family="ui-sans-serif,system-ui" font-weight="700" font-size="22" fill="${t.accent}" letter-spacing="4">@APEX.FINANCIAL</text>
</svg>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  try {
    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Number(body.limit ?? 500), 1000);
    const force = !!body.force;
    const specificAgent = body.agent_id as string | undefined;

    let q = sb.from("plaque_awards")
      .select(`id, agent_id, milestone_type, amount, milestone_date, image_svg_url, custom_photo_url,
               agent:agents!inner(id, profile:profiles!agents_profile_id_fkey(full_name, avatar_url, photo_url))`)
      .order("milestone_date", { ascending: false })
      .limit(limit);
    if (!force) q = q.is("image_svg_url", null);
    if (specificAgent) q = q.eq("agent_id", specificAgent);

    const { data: plaques, error } = await q;
    if (error) throw error;

    let updated = 0;
    let withPhoto = 0;
    let noPhoto = 0;

    // Photo cache — same agent's photo gets encoded once per invocation
    const photoCache = new Map<string, string | null>();

    for (const p of (plaques ?? []) as any[]) {
      const name = p.agent?.profile?.full_name ?? "Agent";
      const photoUrl = p.custom_photo_url ?? p.agent?.profile?.avatar_url ?? p.agent?.profile?.photo_url ?? null;

      let photoDataUri: string | null = null;
      if (photoUrl) {
        if (photoCache.has(photoUrl)) {
          photoDataUri = photoCache.get(photoUrl) ?? null;
        } else {
          photoDataUri = await fetchImageAsDataUri(photoUrl);
          photoCache.set(photoUrl, photoDataUri);
        }
      }
      if (photoDataUri) withPhoto++; else noPhoto++;

      const svg = renderSVG(name, p.milestone_type, Number(p.amount) || 0, p.milestone_date, photoDataUri);
      const uri = "data:image/svg+xml;utf8," + encodeURIComponent(svg);

      const { error: uErr } = await sb.from("plaque_awards")
        .update({ image_svg_url: uri, generated_at: new Date().toISOString() })
        .eq("id", p.id);
      if (!uErr) updated++;
    }

    return new Response(JSON.stringify({
      ok: true,
      processed: (plaques ?? []).length,
      updated,
      with_photo: withPhoto,
      no_photo: noPhoto,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
