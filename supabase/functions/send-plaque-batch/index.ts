/**
 * send-plaque-batch — branded APEX plaque email blaster
 *
 * Renders high-quality SVG plaques inline (NO WASM — string templates
 * only, so the Resvg crash in send-plaque-recognition doesn't affect
 * this path) and emails them to each agent via Resend.
 *
 * Body: { limit?: number, dry_run?: boolean, force_resend?: boolean, target_admin_email?: boolean }
 *   - limit: how many plaques to process in one invocation (default 25)
 *   - dry_run: true → log what would be sent, don't actually email
 *   - force_resend: true → include plaques that already have email_sent_at
 *   - target_admin_email: true → email all rendered plaques to sam@apex-financial.org
 *     (a single digest email with every plaque), instead of per-agent
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TIER_CONFIG: Record<string, { accent: string; badge: string; sub: string; glow: string; emoji: string; title: string }> = {
  single_day_platinum: { accent: "#e5e4e2", glow: "#8b5cf6", badge: "PLATINUM ACHIEVEMENT", sub: "$5K+ Single Day",     emoji: "💎", title: "Platinum Plaque" },
  single_day:          { accent: "#f59e0b", glow: "#f59e0b", badge: "GOLD ACHIEVEMENT",     sub: "$3K+ Single Day",     emoji: "🥇", title: "Gold Plaque" },
  single_day_bronze:   { accent: "#cd7f32", glow: "#cd7f32", badge: "BRONZE ACHIEVEMENT",   sub: "$1K+ Single Day",     emoji: "🥉", title: "Bronze Plaque" },
  weekly:              { accent: "#7dd3fc", glow: "#06b6d4", badge: "WEEKLY DIAMOND",       sub: "$10K+ Week",          emoji: "💠", title: "Weekly Diamond" },
  monthly:             { accent: "#a78bfa", glow: "#8b5cf6", badge: "ELITE PRODUCER",       sub: "$25K+ Month",         emoji: "👑", title: "Elite Producer" },
  hot_streak:          { accent: "#fb923c", glow: "#f59e0b", badge: "HOT STREAK",           sub: "5+ Consecutive Days", emoji: "🔥", title: "Hot Streak" },
  team_week_50k:       { accent: "#22d3a5", glow: "#22d3a5", badge: "TEAM CHAMPION",        sub: "$50K+ Team Week",     emoji: "🏆", title: "Team Champion" },
};

function fmt$(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

function prettyDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function renderPlaqueSVG(name: string, tier: string, amount: number, date: string): string {
  const cfg = TIER_CONFIG[tier] || TIER_CONFIG.single_day_bronze;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1920" width="1080" height="1920">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0a0f1a"/><stop offset="1" stop-color="#020617"/>
    </linearGradient>
    <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${cfg.accent}"/><stop offset="1" stop-color="${cfg.accent}" stop-opacity="0.4"/>
    </linearGradient>
    <radialGradient id="glow">
      <stop offset="0" stop-color="${cfg.glow}" stop-opacity="0.35"/>
      <stop offset="1" stop-color="${cfg.glow}" stop-opacity="0"/>
    </radialGradient>
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

function svgToDataUri(svg: string): string {
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

function renderEmailHtml(name: string, tier: string, amount: number, date: string, svgDataUri: string): string {
  const cfg = TIER_CONFIG[tier] || TIER_CONFIG.single_day_bronze;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:'DM Sans',Arial,sans-serif;background:#030712;color:#e2e8f0;margin:0;padding:32px 16px;">
  <div style="max-width:560px;margin:0 auto;background:#0d1526;border:1px solid ${cfg.accent}40;border-radius:20px;overflow:hidden;">
    <div style="padding:36px 36px 0 36px;text-align:center;">
      <div style="font-size:56px;line-height:1;margin-bottom:12px;">${cfg.emoji}</div>
      <div style="color:${cfg.accent};letter-spacing:4px;font-weight:700;font-size:13px;">${esc(cfg.badge)}</div>
      <h1 style="color:#fff;font-size:28px;margin:14px 0 6px 0;">Congratulations, ${esc(name.split(" ")[0])}!</h1>
      <p style="color:#94a3b8;font-size:14px;margin:0 0 24px 0;">You just unlocked a ${esc(cfg.title)} — ${esc(fmt$(amount))} on ${esc(prettyDate(date))}.</p>
    </div>
    <div style="background:${cfg.accent}15;padding:28px 36px;text-align:center;">
      <img src="${svgDataUri}" alt="APEX Plaque" width="100%" style="max-width:480px;display:block;margin:0 auto;border-radius:12px;"/>
    </div>
    <div style="padding:28px 36px;text-align:center;">
      <p style="color:#e2e8f0;font-size:15px;line-height:1.7;margin:0 0 20px 0;">Save this image. Post it. Tag <strong style="color:#22d3a5;">@apex.financial</strong>. The team is watching.</p>
      <a href="https://apex-financial.org/dashboard" style="display:inline-block;background:#22d3a5;color:#030712;font-weight:700;padding:14px 32px;border-radius:10px;text-decoration:none;letter-spacing:0.5px;">VIEW DASHBOARD →</a>
    </div>
    <div style="border-top:1px solid #1e293b;padding:20px;text-align:center;color:#475569;font-size:11px;letter-spacing:2px;">APEX FINANCIAL · BUILDING EMPIRES</div>
  </div>
</body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );
  const resend = new Resend(Deno.env.get("RESEND_API_KEY") ?? "");

  try {
    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Number(body.limit ?? 25), 100);
    const dryRun = !!body.dry_run;
    const forceResend = !!body.force_resend;
    const targetAdmin = !!body.target_admin_email || !!body.admin_email;
    const customAdminEmail = typeof body.admin_email === "string" && body.admin_email.includes("@")
      ? body.admin_email.trim()
      : null;

    let q = sb.from("plaque_awards")
      .select(`
        id, agent_id, milestone_type, amount, milestone_date,
        email_sent_at, email_delivery_status,
        agent:agents!inner(id, user_id, profile:profiles!agents_profile_id_fkey(full_name, email))
      `)
      .order("milestone_date", { ascending: false })
      .limit(limit);

    if (!forceResend) q = q.is("email_sent_at", null);

    const { data: plaques, error } = await q;
    if (error) throw error;
    if (!plaques || plaques.length === 0) {
      return new Response(JSON.stringify({ ok: true, processed: 0, message: "No plaques pending" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const summary = { processed: 0, sent: 0, failed: 0, skipped: 0, errors: [] as string[], dry_run: dryRun };

    // Admin-digest mode: build one combined email with all plaques and send to Sam
    if (targetAdmin) {
      const adminEmail = customAdminEmail ?? Deno.env.get("ADMIN_EMAIL") ?? "info@kingofsales.net";
      const cards = await Promise.all((plaques as any[]).map(async p => {
        const name = p.agent?.profile?.full_name ?? "Agent";
        const tier = p.milestone_type as string;
        const amount = Number(p.amount) || 0;
        const date = p.milestone_date as string;
        const cfg = TIER_CONFIG[tier] ?? TIER_CONFIG.single_day_bronze;
        const svg = renderPlaqueSVG(name, tier, amount, date);
        const uri = svgToDataUri(svg);
        // Persist the rendered SVG so the Awards Gallery renders properly
        await sb.from("plaque_awards").update({ image_svg_url: uri }).eq("id", p.id);
        return `<div style="margin:18px 0;border:1px solid ${cfg.accent}40;border-radius:12px;overflow:hidden;background:#0d1526;">
          <div style="padding:14px 18px;background:${cfg.accent}15;display:flex;justify-content:space-between;align-items:center;">
            <div><span style="font-size:18px;">${cfg.emoji}</span> <strong style="color:${cfg.accent};letter-spacing:2px;font-size:11px;">${esc(cfg.badge)}</strong></div>
            <div style="color:#fff;font-size:14px;font-weight:600;">${esc(name)} · ${esc(prettyDate(date))}</div>
          </div>
          <div style="padding:16px;text-align:center;">
            <img src="${uri}" alt="" width="100%" style="max-width:360px;border-radius:8px;"/>
            <div style="color:${cfg.accent};font-size:22px;font-weight:800;margin-top:8px;">${esc(fmt$(amount))}</div>
          </div>
        </div>`;
      }));
      const cardsHtml = cards.join("");

      const digestHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:'DM Sans',Arial,sans-serif;background:#030712;color:#e2e8f0;padding:32px 16px;">
  <div style="max-width:620px;margin:0 auto;background:#0a0f1a;border-radius:16px;padding:32px;">
    <h1 style="color:#22d3a5;text-align:center;font-size:28px;margin:0 0 6px 0;">APEX Plaque Digest</h1>
    <p style="color:#94a3b8;text-align:center;font-size:13px;margin:0 0 24px 0;">${plaques!.length} plaques · ${esc(new Date().toLocaleDateString("en-US", {dateStyle:"long"}))}</p>
    ${cardsHtml}
    <p style="color:#475569;font-size:11px;text-align:center;margin-top:28px;letter-spacing:2px;">APEX FINANCIAL · BUILDING EMPIRES</p>
  </div>
</body></html>`;

      if (dryRun) {
        return new Response(JSON.stringify({ ok: true, mode: "admin_digest_dry_run", to: adminEmail, plaques: plaques!.length }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      try {
        await resend.emails.send({
          from: "APEX Financial <notifications@apex-financial.org>",
          to: [adminEmail],
          subject: `🏆 APEX Plaque Digest — ${plaques!.length} awards`,
          html: digestHtml,
        });
        return new Response(JSON.stringify({ ok: true, mode: "admin_digest", to: adminEmail, sent: plaques!.length }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: String(e) }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    for (const p of plaques as any[]) {
      summary.processed++;
      const email = p.agent?.profile?.email as string | undefined;
      const fullName = (p.agent?.profile?.full_name as string | undefined) ?? "Agent";
      const tier = p.milestone_type as string;
      const amount = Number(p.amount) || 0;
      const date = p.milestone_date as string;

      if (!email) { summary.skipped++; continue; }

      const svg = renderPlaqueSVG(fullName, tier, amount, date);
      const dataUri = svgToDataUri(svg);

      if (dryRun) { summary.sent++; continue; }

      try {
        await resend.emails.send({
          from: "APEX Financial <notifications@apex-financial.org>",
          to: [email],
          subject: `${TIER_CONFIG[tier]?.emoji ?? "🏆"} You earned the ${TIER_CONFIG[tier]?.title ?? "APEX"} — ${fmt$(amount)}`,
          html: renderEmailHtml(fullName, tier, amount, date, dataUri),
        });
        summary.sent++;
        await sb.from("plaque_awards").update({
          email_sent_at: new Date().toISOString(),
          email_delivery_status: "sent",
          image_svg_url: dataUri,
        }).eq("id", p.id);
      } catch (e) {
        summary.failed++;
        summary.errors.push(`${p.id}: ${String(e).slice(0,150)}`);
        await sb.from("plaque_awards").update({
          email_delivery_status: "failed",
          email_error: String(e).slice(0,500),
        }).eq("id", p.id);
      }
    }

    return new Response(JSON.stringify({ ok: true, ...summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
