/**
 * generate-monthly-awards — magazine-quality monthly awards generator.
 *
 * Runs on the 1st of every month at 09:00 CST (cron) for the previous
 * month, OR on demand with { month: "YYYY-MM" }.
 *
 * Produces 1080×1920 PNGs (Instagram-story ratio) for:
 *   • team-total.png             — the month's full-team ALP
 *   • leaderboard.png            — top-6 stacked card
 *   • individual/<rank>-name.png — one per top-6 producer (face + ALP)
 *   • lifetime-<name>.png        — every agent who's now ≥ $100k career ALP
 *                                  (only when they've crossed since last run)
 *
 * SVGs are rasterized server-side with @resvg/resvg-wasm, uploaded to
 * the public `awards` bucket, persisted via plaque_awards.image_png_url,
 * then a digest is fired to Discord + ntfy + Sam's email via Resend.
 *
 * No placeholders: when an agent has a real avatar_url it embeds; when
 * they don't, the layout uses a full-bleed brand-tone initials canvas
 * (intentional design, not a stock placeholder).
 *
 * Body (optional):
 *   { month?: "2026-03", dry_run?: boolean, target_admin_email?: boolean,
 *     skip_discord?: boolean, skip_ntfy?: boolean }
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { Resvg, initWasm } from "https://esm.sh/@resvg/resvg-wasm@2.6.2";

// One-time WASM init (cold start cost ~150ms)
let wasmReady = false;
async function ensureWasm() {
  if (wasmReady) return;
  const wasm = await fetch("https://esm.sh/@resvg/resvg-wasm@2.6.2/index_bg.wasm").then(r => r.arrayBuffer());
  await initWasm(wasm);
  wasmReady = true;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const W = 1080;
const H = 1920;
const NTFY_URL = "https://ntfy.sh/sams-agent-yrkv9kbqp9e987nb";
const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL") ?? "info@kingofsales.net";

// ─── helpers ─────────────────────────────────────────────────────────────
const fmt$ = (n: number) => "$" + Math.round(Number(n)).toLocaleString("en-US");
const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const initials = (name: string) => {
  const p = (name || "?").trim().split(/\s+/);
  return ((p[0]?.[0] ?? "?") + (p[1]?.[0] ?? "")).toUpperCase();
};
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function previousMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthBounds(yyyymm: string) {
  const [y, m] = yyyymm.split("-").map(Number);
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const end = new Date(Date.UTC(y, m, 0));
  const endStr = `${end.getUTCFullYear()}-${String(end.getUTCMonth() + 1).padStart(2, "0")}-${String(end.getUTCDate()).padStart(2, "0")}`;
  const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  return { start, end: endStr, label };
}

async function fetchImageDataUri(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.length > 3_000_000) return null;
    const ct = r.headers.get("content-type") ?? "image/jpeg";
    let bin = "";
    for (const b of buf) bin += String.fromCharCode(b);
    return `data:${ct};base64,${btoa(bin)}`;
  } catch { return null; }
}

// ─── SVG templates (parity with local renderer) ──────────────────────────

const COMMON_DEFS = `
  <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#0a0f1a"/><stop offset="55%" stop-color="#0a1f1a"/><stop offset="100%" stop-color="#020617"/></linearGradient>
  <linearGradient id="emerald" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#22d3a5"/><stop offset="100%" stop-color="#10b981"/></linearGradient>
  <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#f5e6a3"/><stop offset="50%" stop-color="#d4af37"/><stop offset="100%" stop-color="#c9a96e"/></linearGradient>
  <linearGradient id="photoFade" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity="0.55"/></linearGradient>
  <radialGradient id="vignette" cx="50%" cy="50%" r="80%"><stop offset="60%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity="0.55"/></radialGradient>
  <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="14" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
`;

const HEADER = `<text x="80" y="120" font-family="ui-sans-serif, -apple-system" font-weight="900" font-size="52" fill="#22d3a5" letter-spacing="6">APEX</text><text x="262" y="120" font-family="ui-sans-serif, -apple-system" font-weight="400" font-size="52" fill="#f8fafc" letter-spacing="6">FINANCIAL</text><rect x="80" y="142" width="120" height="3" fill="url(#emerald)"/>`;

const footer = (label: string) =>
  `<rect x="80" y="1780" width="${W - 160}" height="2" fill="#22d3a5" fill-opacity="0.35"/><text x="80" y="1830" font-family="ui-sans-serif, -apple-system" font-weight="600" font-size="22" fill="#94a3b8" letter-spacing="4">${esc(label)}</text><text x="${W - 80}" y="1830" text-anchor="end" font-family="ui-sans-serif, -apple-system" font-weight="700" font-size="22" fill="#22d3a5" letter-spacing="4">@APEX.FINANCIAL</text>`;

function teamTotalSVG(opts: { amount: number; deals: number; agentCount: number; monthLabel: string }) {
  const { amount, deals, agentCount, monthLabel } = opts;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
    <defs>${COMMON_DEFS}</defs>
    <rect width="${W}" height="${H}" fill="url(#bg)"/>
    <rect width="${W}" height="${H}" fill="url(#vignette)"/>
    <text x="${W/2}" y="940" text-anchor="middle" font-family="ui-sans-serif" font-weight="900" font-size="320" fill="#22d3a5" fill-opacity="0.06" letter-spacing="14">TEAM</text>
    ${HEADER}
    <rect x="80" y="200" width="640" height="64" rx="32" fill="#22d3a5" fill-opacity="0.12" stroke="#22d3a5" stroke-opacity="0.5" stroke-width="2"/>
    <text x="400" y="244" text-anchor="middle" font-family="ui-sans-serif" font-weight="700" font-size="22" fill="#22d3a5" letter-spacing="6">${esc(monthLabel.toUpperCase())} TEAM PRODUCTION</text>
    <text x="80" y="500" font-family="ui-sans-serif" font-weight="500" font-size="36" fill="#94a3b8" letter-spacing="4">TOTAL ALP</text>
    <text x="80" y="780" font-family="ui-sans-serif" font-weight="900" font-size="220" fill="url(#emerald)" filter="url(#glow)">${esc(fmt$(amount))}</text>
    <g transform="translate(80, 900)">
      <rect width="${W - 160}" height="220" rx="24" fill="#0d1526" stroke="#22d3a5" stroke-opacity="0.3" stroke-width="2"/>
      <g transform="translate(60, 60)"><text font-family="ui-sans-serif" font-weight="500" font-size="20" fill="#64748b" letter-spacing="4">DEALS</text><text y="80" font-family="ui-sans-serif" font-weight="800" font-size="68" fill="#f8fafc">${deals}</text></g>
      <g transform="translate(380, 60)"><text font-family="ui-sans-serif" font-weight="500" font-size="20" fill="#64748b" letter-spacing="4">PRODUCERS</text><text y="80" font-family="ui-sans-serif" font-weight="800" font-size="68" fill="#f8fafc">${agentCount}</text></g>
      <g transform="translate(720, 60)"><text font-family="ui-sans-serif" font-weight="500" font-size="20" fill="#64748b" letter-spacing="4">AVG ALP</text><text y="80" font-family="ui-sans-serif" font-weight="800" font-size="58" fill="#22d3a5">${esc(fmt$(amount / Math.max(agentCount,1)))}</text></g>
    </g>
    <text x="${W/2}" y="1260" text-anchor="middle" font-family="ui-sans-serif" font-weight="900" font-size="64" fill="#f8fafc" letter-spacing="3">ANOTHER MONTH</text>
    <text x="${W/2}" y="1340" text-anchor="middle" font-family="ui-sans-serif" font-weight="900" font-size="64" fill="#22d3a5" letter-spacing="3">IN THE BOOKS</text>
    <text x="${W/2}" y="1430" text-anchor="middle" font-family="ui-sans-serif" font-weight="500" font-size="28" fill="#94a3b8" letter-spacing="2">Built by every one of you.</text>
    ${footer(monthLabel.toUpperCase() + " · TEAM TOTAL")}
  </svg>`;
}

function leaderboardSVG(opts: { rows: Array<{ full_name: string; alp: number; deals: number }>; monthLabel: string }) {
  const { rows, monthLabel } = opts;
  const rowH = 130;
  const startY = 540;
  const rowsSvg = rows.map((r, i) => {
    const y = startY + i * rowH;
    const rank = i + 1;
    const numColor = rank === 1 ? "#f5e6a3" : "#22d3a5";
    return `<g transform="translate(80, ${y})">
      <rect width="${W - 160}" height="${rowH - 20}" rx="18" fill="#0d1526" stroke="${rank === 1 ? '#f5e6a3' : '#22d3a5'}" stroke-opacity="${rank === 1 ? 0.6 : 0.3}" stroke-width="2"/>
      <text x="50" y="74" font-family="ui-sans-serif" font-weight="900" font-size="68" fill="${numColor}">${rank}</text>
      <text x="160" y="56" font-family="ui-sans-serif" font-weight="700" font-size="34" fill="#f8fafc">${esc(r.full_name.toUpperCase())}</text>
      <text x="160" y="92" font-family="ui-sans-serif" font-weight="500" font-size="20" fill="#64748b" letter-spacing="2">${r.deals} DEALS</text>
      <text x="${W - 200}" y="78" text-anchor="end" font-family="ui-sans-serif" font-weight="800" font-size="46" fill="${rank === 1 ? '#f5e6a3' : '#f8fafc'}">${esc(fmt$(r.alp))}</text>
    </g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
    <defs>${COMMON_DEFS}</defs>
    <rect width="${W}" height="${H}" fill="url(#bg)"/>
    <rect width="${W}" height="${H}" fill="url(#vignette)"/>
    ${HEADER}
    <rect x="80" y="200" width="640" height="64" rx="32" fill="#f5e6a3" fill-opacity="0.12" stroke="#f5e6a3" stroke-opacity="0.5" stroke-width="2"/>
    <text x="400" y="244" text-anchor="middle" font-family="ui-sans-serif" font-weight="700" font-size="22" fill="#f5e6a3" letter-spacing="6">${esc(monthLabel.toUpperCase())} LEADERBOARD</text>
    <text x="80" y="380" font-family="ui-sans-serif" font-weight="900" font-size="120" fill="#f8fafc" letter-spacing="2">TOP 6</text>
    <text x="80" y="450" font-family="ui-sans-serif" font-weight="500" font-size="32" fill="#94a3b8" letter-spacing="3">PRODUCERS</text>
    ${rowsSvg}
    ${footer(monthLabel.toUpperCase() + " · TOP PRODUCERS")}
  </svg>`;
}

function individualSVG(opts: { rank: number; fullName: string; amount: number; deals: number; photoDataUri: string | null; monthLabel: string }) {
  const { rank, fullName, amount, deals, photoDataUri, monthLabel } = opts;
  const isFirst = rank === 1;
  const accentRef = isFirst ? "url(#gold)" : "url(#emerald)";
  const accentHex = isFirst ? "#f5e6a3" : "#22d3a5";
  const tagline = isFirst ? `${monthLabel.split(" ")[0].toUpperCase()} CHAMPION` : "ELITE PRODUCER";
  const photoH = 1080;
  const photoBlock = photoDataUri
    ? `<g><clipPath id="photoClip${rank}"><rect x="0" y="0" width="${W}" height="${photoH}"/></clipPath><g clip-path="url(#photoClip${rank})"><image href="${photoDataUri}" x="0" y="0" width="${W}" height="${photoH}" preserveAspectRatio="xMidYMid slice"/><rect x="0" y="${photoH-380}" width="${W}" height="380" fill="url(#photoFade)"/><rect x="0" y="0" width="${W}" height="${photoH}" fill="#020617" fill-opacity="0.18"/></g><rect x="0" y="${photoH-4}" width="${W}" height="4" fill="${accentHex}" fill-opacity="0.7"/></g>`
    : `<g><rect x="0" y="0" width="${W}" height="${photoH}" fill="${accentHex}" fill-opacity="0.08"/><circle cx="${W/2}" cy="${photoH/2}" r="240" fill="${accentHex}" fill-opacity="0.16"/><text x="${W/2}" y="${photoH/2+90}" text-anchor="middle" font-family="ui-sans-serif" font-weight="900" font-size="280" fill="#f8fafc">${esc(initials(fullName))}</text><rect x="0" y="${photoH-4}" width="${W}" height="4" fill="${accentHex}" fill-opacity="0.7"/></g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
    <defs>${COMMON_DEFS}</defs>
    <rect width="${W}" height="${H}" fill="url(#bg)"/>
    ${photoBlock}
    <rect width="${W}" height="${H}" fill="url(#vignette)"/>
    ${HEADER}
    <rect x="80" y="200" width="420" height="56" rx="28" fill="${accentHex}" fill-opacity="0.92" stroke="#020617" stroke-opacity="0.4" stroke-width="2"/>
    <text x="290" y="237" text-anchor="middle" font-family="ui-sans-serif" font-weight="800" font-size="20" fill="#020617" letter-spacing="5">${esc(tagline)}</text>
    <rect x="${W-220}" y="200" width="140" height="56" rx="16" fill="#020617" fill-opacity="0.7" stroke="${accentHex}" stroke-opacity="0.6" stroke-width="2"/>
    <text x="${W-150}" y="237" text-anchor="middle" font-family="ui-sans-serif" font-weight="900" font-size="22" fill="${accentHex}" letter-spacing="3">#${rank}</text>
    <rect x="0" y="${photoH}" width="${W}" height="${H-photoH}" fill="#020617" fill-opacity="0.85"/>
    <text x="80" y="${photoH+110}" font-family="ui-sans-serif" font-weight="500" font-size="22" fill="#94a3b8" letter-spacing="4">${esc(monthLabel.toUpperCase())} ALP</text>
    <text x="80" y="${photoH+280}" font-family="ui-sans-serif" font-weight="900" font-size="170" fill="${accentRef}" filter="url(#glow)">${esc(fmt$(amount))}</text>
    <text x="80" y="${photoH+340}" font-family="ui-sans-serif" font-weight="500" font-size="24" fill="#94a3b8" letter-spacing="3">${deals} DEALS WRITTEN</text>
    <rect x="80" y="${photoH+410}" width="${W-160}" height="160" rx="18" fill="#0d1526" stroke="${accentHex}" stroke-opacity="0.4" stroke-width="2"/>
    <text x="110" y="${photoH+465}" font-family="ui-sans-serif" font-weight="500" font-size="16" fill="#64748b" letter-spacing="4">AGENT</text>
    <text x="110" y="${photoH+525}" font-family="ui-sans-serif" font-weight="800" font-size="44" fill="#f8fafc">${esc(fullName.toUpperCase())}</text>
    ${footer(monthLabel.toUpperCase() + " · INDIVIDUAL")}
  </svg>`;
}

function lifetimeSVG(opts: { fullName: string; amount: number; deals: number; photoDataUri: string | null }) {
  const { fullName, amount, deals, photoDataUri } = opts;
  const photoH = 1080;
  const photoBlock = photoDataUri
    ? `<g><clipPath id="photoClipL"><rect x="0" y="0" width="${W}" height="${photoH}"/></clipPath><g clip-path="url(#photoClipL)"><image href="${photoDataUri}" x="0" y="0" width="${W}" height="${photoH}" preserveAspectRatio="xMidYMid slice"/><rect x="0" y="${photoH-380}" width="${W}" height="380" fill="url(#photoFade)"/><rect x="0" y="0" width="${W}" height="${photoH}" fill="#020617" fill-opacity="0.18"/></g><rect x="0" y="${photoH-4}" width="${W}" height="4" fill="#f5e6a3" fill-opacity="0.8"/></g>`
    : `<g><rect x="0" y="0" width="${W}" height="${photoH}" fill="#f5e6a3" fill-opacity="0.08"/><circle cx="${W/2}" cy="${photoH/2}" r="240" fill="#f5e6a3" fill-opacity="0.18"/><text x="${W/2}" y="${photoH/2+90}" text-anchor="middle" font-family="ui-sans-serif" font-weight="900" font-size="280" fill="#f8fafc">${esc(initials(fullName))}</text><rect x="0" y="${photoH-4}" width="${W}" height="4" fill="#f5e6a3" fill-opacity="0.8"/></g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
    <defs>${COMMON_DEFS}</defs>
    <rect width="${W}" height="${H}" fill="url(#bg)"/>
    ${photoBlock}
    <rect width="${W}" height="${H}" fill="url(#vignette)"/>
    ${HEADER}
    <rect x="80" y="200" width="500" height="56" rx="28" fill="#f5e6a3" fill-opacity="0.92" stroke="#020617" stroke-opacity="0.4" stroke-width="2"/>
    <text x="330" y="237" text-anchor="middle" font-family="ui-sans-serif" font-weight="800" font-size="20" fill="#020617" letter-spacing="5">LIFETIME ACHIEVEMENT</text>
    <rect x="${W-230}" y="200" width="150" height="56" rx="16" fill="#020617" fill-opacity="0.7" stroke="#f5e6a3" stroke-opacity="0.7" stroke-width="2"/>
    <text x="${W-155}" y="237" text-anchor="middle" font-family="ui-sans-serif" font-weight="900" font-size="22" fill="#f5e6a3" letter-spacing="3">$100K</text>
    <rect x="0" y="${photoH}" width="${W}" height="${H-photoH}" fill="#020617" fill-opacity="0.85"/>
    <text x="80" y="${photoH+110}" font-family="ui-sans-serif" font-weight="500" font-size="22" fill="#94a3b8" letter-spacing="4">CAREER ALP</text>
    <text x="80" y="${photoH+280}" font-family="ui-sans-serif" font-weight="900" font-size="170" fill="url(#gold)" filter="url(#glow)">${esc(fmt$(amount))}</text>
    <text x="80" y="${photoH+340}" font-family="ui-sans-serif" font-weight="500" font-size="24" fill="#94a3b8" letter-spacing="3">${deals} DEALS · ALL-TIME</text>
    <rect x="80" y="${photoH+410}" width="${W-160}" height="160" rx="18" fill="#0d1526" stroke="#f5e6a3" stroke-opacity="0.5" stroke-width="2"/>
    <text x="110" y="${photoH+465}" font-family="ui-sans-serif" font-weight="500" font-size="16" fill="#64748b" letter-spacing="4">AGENT</text>
    <text x="110" y="${photoH+525}" font-family="ui-sans-serif" font-weight="800" font-size="44" fill="#f8fafc">${esc(fullName.toUpperCase())}</text>
    ${footer("LIFETIME · $100K+ CLUB")}
  </svg>`;
}

async function svgToPng(svg: string): Promise<Uint8Array> {
  await ensureWasm();
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: 1080 }, background: "transparent" });
  return resvg.render().asPng();
}

// ─── main handler ────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  try {
    const body = await req.json().catch(() => ({}));
    const yyyymm: string = body.month ?? previousMonth();
    const dryRun = !!body.dry_run;
    const skipDiscord = !!body.skip_discord;
    const skipNtfy = !!body.skip_ntfy;
    const skipEmail = !!body.skip_email;
    const targetAdmin = !!body.target_admin_email || !!body.admin_email;
    const adminEmail = (typeof body.admin_email === "string" && body.admin_email.includes("@")) ? body.admin_email.trim() : ADMIN_EMAIL;

    const { start, end, label } = monthBounds(yyyymm);

    // Fetch top-6 producers for the month (all statuses)
    // supabase-js QueryBuilder/rpc has no .catch — must await + try/catch
    let top6: any[] | null = null;
    try {
      const { data } = await sb.rpc("execute_sql", { q: `
        SELECT a.id AS agent_id, p.full_name, p.email, p.avatar_url,
               count(d.id)::int AS deals, sum(d.annual_premium)::numeric AS alp
        FROM deals d
        JOIN agents a ON a.id = d.agent_id
        JOIN profiles p ON p.id = a.profile_id
        WHERE d.effective_date BETWEEN '${start}' AND '${end}'
        GROUP BY a.id, p.full_name, p.email, p.avatar_url
        ORDER BY alp DESC LIMIT 6
      `});
      top6 = data as any[] | null;
    } catch (_rpcErr) {
      // Fallback to direct query if execute_sql RPC doesn't exist
      // Truth-layer 2026-04-28: status submitted/active + Sam excluded
      const { data } = await sb.from("deals")
        .select("agent_id, annual_premium, agent:agents!inner(id, profile:profiles!agents_profile_id_fkey(full_name, email, avatar_url))")
        .gte("effective_date", start).lte("effective_date", end)
        .in("status", ["submitted", "active"])
        .neq("agent_id", "7c3c5581-3544-437f-bfe2-91391afb217d");
      top6 = data as any[] | null;
    }

    const top6Rows: Array<{ agent_id: string; full_name: string; email: string | null; avatar_url: string | null; deals: number; alp: number }> =
      Array.isArray(top6) ? top6.map((r: any) => ({ ...r, alp: Number(r.alp) })) : [];

    // Team totals
    const { data: teamRows } = await sb.rpc("execute_sql", { q: `
      SELECT count(d.id)::int AS deals, sum(d.annual_premium)::numeric AS alp,
             count(DISTINCT d.agent_id)::int AS agents
      FROM deals d WHERE d.effective_date BETWEEN '${start}' AND '${end}'
    `}).catch(() => ({ data: [{ deals: 0, alp: 0, agents: 0 }] }));
    const team = (teamRows?.[0] ?? { deals: 0, alp: 0, agents: 0 }) as { deals: number; alp: number; agents: number };
    team.alp = Number(team.alp);

    // Lifetime $100k+ club
    const { data: lifetimeRows } = await sb.rpc("execute_sql", { q: `
      SELECT a.id AS agent_id, p.full_name, p.avatar_url,
             count(d.id)::int AS deals, sum(d.annual_premium)::numeric AS alp
      FROM deals d
      JOIN agents a ON a.id = d.agent_id
      JOIN profiles p ON p.id = a.profile_id
      WHERE d.status IN ('submitted','active')
      GROUP BY a.id, p.full_name, p.avatar_url
      HAVING sum(d.annual_premium) >= 100000
      ORDER BY alp DESC
    `}).catch(() => ({ data: [] }));
    const lifetime: Array<{ agent_id: string; full_name: string; avatar_url: string | null; deals: number; alp: number }> =
      Array.isArray(lifetimeRows) ? lifetimeRows.map((r: any) => ({ ...r, alp: Number(r.alp) })) : [];

    if (dryRun) {
      return new Response(JSON.stringify({ ok: true, mode: "dry_run", month: yyyymm, top6: top6Rows, team, lifetime }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const generated: Array<{ kind: string; rank?: number; full_name?: string; alp?: number; deals?: number; agent_id?: string; url: string }> = [];

    // 1. Team total
    const teamSvg = teamTotalSVG({ amount: team.alp, deals: team.deals, agentCount: team.agents, monthLabel: label });
    const teamPng = await svgToPng(teamSvg);
    await sb.storage.from("awards").upload(`${yyyymm}/team-total.png`, teamPng, { upsert: true, contentType: "image/png" });
    const teamUrl = `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/awards/${yyyymm}/team-total.png`;
    generated.push({ kind: "team_total", url: teamUrl });

    // 2. Leaderboard
    const lbSvg = leaderboardSVG({ rows: top6Rows, monthLabel: label });
    const lbPng = await svgToPng(lbSvg);
    await sb.storage.from("awards").upload(`${yyyymm}/leaderboard.png`, lbPng, { upsert: true, contentType: "image/png" });
    const lbUrl = `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/awards/${yyyymm}/leaderboard.png`;
    generated.push({ kind: "leaderboard", url: lbUrl });

    // 3. Individual top-6
    for (let i = 0; i < top6Rows.length; i++) {
      const r = top6Rows[i];
      const rank = i + 1;
      const photo = await fetchImageDataUri(r.avatar_url);
      const svg = individualSVG({ rank, fullName: r.full_name, amount: r.alp, deals: r.deals, photoDataUri: photo, monthLabel: label });
      const png = await svgToPng(svg);
      const key = `${yyyymm}/individual/${rank}-${slug(r.full_name)}.png`;
      await sb.storage.from("awards").upload(key, png, { upsert: true, contentType: "image/png" });
      const url = `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/awards/${key}`;
      generated.push({ kind: "individual", rank, full_name: r.full_name, alp: r.alp, deals: r.deals, agent_id: r.agent_id, url });

      await sb.from("plaque_awards").insert({
        agent_id: r.agent_id,
        milestone_type: "monthly_top6",
        milestone_date: end,
        amount: r.alp,
        image_png_url: url,
        share_slug: `${yyyymm}-top6-${rank}-${slug(r.full_name)}`,
        generated_at: new Date().toISOString(),
      });
    }

    // 4. Lifetime $100k+ (only insert if not already plaqued — idempotent)
    for (const a of lifetime) {
      const { data: existing } = await sb.from("plaque_awards")
        .select("id").eq("agent_id", a.agent_id).eq("milestone_type", "lifetime_100k").maybeSingle();
      if (existing) continue;
      const photo = await fetchImageDataUri(a.avatar_url);
      const svg = lifetimeSVG({ fullName: a.full_name, amount: a.alp, deals: a.deals, photoDataUri: photo });
      const png = await svgToPng(svg);
      const key = `${yyyymm}/lifetime-${slug(a.full_name)}.png`;
      await sb.storage.from("awards").upload(key, png, { upsert: true, contentType: "image/png" });
      const url = `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/awards/${key}`;
      generated.push({ kind: "lifetime", full_name: a.full_name, alp: a.alp, deals: a.deals, agent_id: a.agent_id, url });
      await sb.from("plaque_awards").insert({
        agent_id: a.agent_id,
        milestone_type: "lifetime_100k",
        milestone_date: end,
        amount: a.alp,
        image_png_url: url,
        share_slug: `lifetime-100k-${slug(a.full_name)}`,
        generated_at: new Date().toISOString(),
      });
    }

    // 5. Discord post
    if (!skipDiscord) {
      const { data: ws } = await sb.from("system_settings").select("value").eq("key", "discord_webhook_url").maybeSingle();
      const webhook = ws?.value;
      if (webhook) {
        const lbLines = top6Rows.map((p, i) => `\`#${i + 1}\` **${p.full_name}** — ${fmt$(p.alp)} (${p.deals} deals)`).join("\n");
        const embeds = [
          { title: `🏆 APEX ${label} — Team Production`, color: 0x22d3a5,
            description: `**${fmt$(team.alp)}** total ALP\n${team.deals} deals · ${team.agents} producers`,
            image: { url: teamUrl }, footer: { text: "APEX Financial · Building Empires" }, timestamp: new Date().toISOString() },
          { title: `🥇 ${label} Leaderboard — Top 6`, color: 0xf5e6a3,
            description: lbLines, image: { url: lbUrl } },
          ...generated.filter(g => g.kind === "individual").map((g, i) => ({
            title: `${i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "🏅"} #${g.rank} ${g.full_name}`,
            description: `**${fmt$(g.alp!)}** · ${g.deals} deals`,
            color: i === 0 ? 0xf5e6a3 : 0x22d3a5, image: { url: g.url },
          })),
          ...generated.filter(g => g.kind === "lifetime").map(g => ({
            title: `💎 LIFETIME $100K CLUB — ${g.full_name}`,
            description: `**${fmt$(g.alp!)}** career ALP · ${g.deals} deals all-time`,
            color: 0xf5e6a3, image: { url: g.url },
          })),
        ].slice(0, 10);

        await fetch(webhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: "APEX Awards",
            content: `**🚀 ${label} wrapped — full awards bundle below.** Save · post · tag @apex.financial`,
            embeds,
          }),
        }).catch(() => {});
      }
    }

    // 6. ntfy push to Sam's phone
    if (!skipNtfy) {
      for (const g of generated) {
        const title = g.kind === "team_total" ? `🏆 ${label} Team Total`
                    : g.kind === "leaderboard" ? `🥇 ${label} Leaderboard`
                    : g.kind === "lifetime" ? `💎 LIFETIME $100K — ${g.full_name}`
                    : `${g.rank === 1 ? "🥇" : g.rank === 2 ? "🥈" : g.rank === 3 ? "🥉" : "🏅"} #${g.rank} ${g.full_name}`;
        const msg = g.kind === "team_total" ? `${fmt$(team.alp)} ALP · ${team.deals} deals · ${team.agents} producers`
                  : g.kind === "leaderboard" ? "Top 6 producers — full board attached"
                  : g.kind === "lifetime" ? `${fmt$(g.alp!)} career ALP · ${g.deals} deals all-time`
                  : `${fmt$(g.alp!)} · ${g.deals} deals`;
        await fetch(NTFY_URL, {
          method: "POST",
          headers: { "Title": title, "Tags": "trophy", "Priority": "4", "Attach": g.url, "Click": g.url },
          body: msg,
        }).catch(() => {});
      }
    }

    // 7. Email digest to Sam via Resend
    let emailResult = null;
    if (!skipEmail && targetAdmin) {
      const resend = new Resend(Deno.env.get("RESEND_API_KEY") ?? "");
      const cards = generated.map(g => `<div style="margin:14px 0;border:1px solid #22d3a540;border-radius:12px;overflow:hidden;background:#0d1526;"><img src="${g.url}" alt="" width="100%" style="display:block;max-width:540px;"/></div>`).join("");
      const html = `<!DOCTYPE html><html><body style="font-family:ui-sans-serif,Arial,sans-serif;background:#020617;color:#e2e8f0;padding:32px 16px;">
        <div style="max-width:620px;margin:0 auto;background:#0a0f1a;border-radius:16px;padding:32px;">
          <h1 style="color:#22d3a5;text-align:center;font-size:28px;margin:0 0 6px 0;">APEX ${esc(label)} — Awards Bundle</h1>
          <p style="color:#94a3b8;text-align:center;font-size:13px;margin:0 0 24px 0;">${generated.length} plaques · team total ${esc(fmt$(team.alp))}</p>
          ${cards}
          <p style="color:#475569;font-size:11px;text-align:center;margin-top:28px;letter-spacing:2px;">APEX FINANCIAL · BUILDING EMPIRES</p>
        </div>
      </body></html>`;
      try {
        emailResult = await resend.emails.send({
          from: "APEX Awards <notifications@apex-financial.org>",
          to: [adminEmail],
          subject: `🏆 APEX ${label} — Awards Bundle (${generated.length} plaques)`,
          html,
        });
      } catch (e) {
        emailResult = { error: String(e) };
      }
    }

    return new Response(JSON.stringify({
      ok: true, month: yyyymm, label, generated_count: generated.length,
      team_total: team.alp, team_deals: team.deals, team_agents: team.agents,
      top6: top6Rows.length, lifetime: lifetime.length,
      generated, emailResult,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
