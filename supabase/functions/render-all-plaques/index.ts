/**
 * render-all-plaques — populate image_svg_url on every plaque_awards row
 *
 * No emails sent. No WASM. Just SVG string templates → data URIs → UPDATE.
 * Run once to make the Awards Gallery show real images for all 295 plaques.
 *
 * Body: { limit?: number, force?: boolean }
 *   - limit: max plaques per invocation (default 500)
 *   - force: re-render plaques that already have image_svg_url
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TIER_CONFIG: Record<string, { accent: string; badge: string; sub: string; glow: string }> = {
  single_day_platinum: { accent: "#e5e4e2", glow: "#8b5cf6", badge: "PLATINUM ACHIEVEMENT", sub: "$5K+ Single Day" },
  single_day:          { accent: "#f59e0b", glow: "#f59e0b", badge: "GOLD ACHIEVEMENT",     sub: "$3K+ Single Day" },
  single_day_bronze:   { accent: "#cd7f32", glow: "#cd7f32", badge: "BRONZE ACHIEVEMENT",   sub: "$1K+ Single Day" },
  weekly:              { accent: "#7dd3fc", glow: "#06b6d4", badge: "WEEKLY DIAMOND",       sub: "$10K+ Week" },
  monthly:             { accent: "#a78bfa", glow: "#8b5cf6", badge: "ELITE PRODUCER",       sub: "$25K+ Month" },
  hot_streak:          { accent: "#fb923c", glow: "#f59e0b", badge: "HOT STREAK",           sub: "5+ Consecutive Days" },
  team_week_50k:       { accent: "#22d3a5", glow: "#22d3a5", badge: "TEAM CHAMPION",        sub: "$50K+ Team Week" },
  team_two_day_20k:    { accent: "#22d3a5", glow: "#22d3a5", badge: "TEAM BLITZ",           sub: "$20K+ Two Days" },
  team_single_day_10k: { accent: "#22d3a5", glow: "#22d3a5", badge: "TEAM ONE-DAY",         sub: "$10K+ Single Day" },
  streak_5:            { accent: "#fb923c", glow: "#f59e0b", badge: "5-DAY STREAK",         sub: "5 Consecutive Days" },
  first_deal_of_day:   { accent: "#22d3a5", glow: "#22d3a5", badge: "FIRST DEAL OF DAY",    sub: "Opened the Board" },
  diamond_week:        { accent: "#7dd3fc", glow: "#06b6d4", badge: "DIAMOND WEEK",         sub: "Elite Week" },
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

function renderSVG(name: string, tier: string, amount: number, date: string): string {
  const cfg = TIER_CONFIG[tier] ?? TIER_CONFIG.single_day_bronze;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1920" width="1080" height="1920">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0a0f1a"/><stop offset="1" stop-color="#020617"/></linearGradient>
<linearGradient id="ring" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${cfg.accent}"/><stop offset="1" stop-color="${cfg.accent}" stop-opacity="0.4"/></linearGradient>
<radialGradient id="glow"><stop offset="0" stop-color="${cfg.glow}" stop-opacity="0.35"/><stop offset="1" stop-color="${cfg.glow}" stop-opacity="0"/></radialGradient>
</defs>
<rect width="1080" height="1920" fill="url(#bg)"/>
<circle cx="540" cy="880" r="700" fill="url(#glow)"/>
<text x="540" y="170" text-anchor="middle" font-family="ui-sans-serif,system-ui" font-weight="800" font-size="44" letter-spacing="14" fill="#22d3a5">APEX FINANCIAL</text>
<rect x="320" y="230" width="440" height="3" fill="${cfg.accent}"/>
<text x="540" y="340" text-anchor="middle" font-family="ui-sans-serif,system-ui" font-weight="700" font-size="28" letter-spacing="6" fill="${cfg.accent}">${esc(cfg.badge)}</text>
<circle cx="540" cy="620" r="200" fill="none" stroke="url(#ring)" stroke-width="6"/>
<circle cx="540" cy="620" r="170" fill="${cfg.accent}" fill-opacity="0.15"/>
<text x="540" y="665" text-anchor="middle" font-family="ui-sans-serif,system-ui" font-weight="800" font-size="130" fill="#ffffff">${esc(initials(name))}</text>
<text x="540" y="980" text-anchor="middle" font-family="ui-sans-serif,system-ui" font-weight="600" font-size="42" fill="#e2e8f0">${esc(name.toUpperCase())}</text>
<text x="540" y="1220" text-anchor="middle" font-family="ui-sans-serif,system-ui" font-weight="800" font-size="180" fill="${cfg.accent}">${esc(fmt$(amount))}</text>
<text x="540" y="1310" text-anchor="middle" font-family="ui-sans-serif,system-ui" font-size="32" letter-spacing="4" fill="#94a3b8">${esc(cfg.sub)}</text>
<rect x="320" y="1430" width="440" height="2" fill="#22d3a5" fill-opacity="0.4"/>
<text x="540" y="1500" text-anchor="middle" font-family="ui-sans-serif,system-ui" font-size="26" letter-spacing="3" fill="#94a3b8">${esc(prettyDate(date))}</text>
<text x="540" y="1800" text-anchor="middle" font-family="ui-sans-serif,system-ui" font-size="22" letter-spacing="5" fill="#334155">BUILDING EMPIRES · PROTECTING FAMILIES</text>
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

    let q = sb.from("plaque_awards")
      .select(`id, agent_id, milestone_type, amount, milestone_date, image_svg_url,
               agent:agents!inner(id, profile:profiles!agents_profile_id_fkey(full_name))`)
      .order("milestone_date", { ascending: false })
      .limit(limit);
    if (!force) q = q.is("image_svg_url", null);

    const { data: plaques, error } = await q;
    if (error) throw error;

    let updated = 0;
    for (const p of (plaques ?? []) as any[]) {
      const name = p.agent?.profile?.full_name ?? "Agent";
      const svg = renderSVG(name, p.milestone_type, Number(p.amount) || 0, p.milestone_date);
      const uri = "data:image/svg+xml;utf8," + encodeURIComponent(svg);
      const { error: uErr } = await sb.from("plaque_awards")
        .update({ image_svg_url: uri })
        .eq("id", p.id);
      if (!uErr) updated++;
    }

    return new Response(JSON.stringify({ ok: true, processed: (plaques ?? []).length, updated }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
