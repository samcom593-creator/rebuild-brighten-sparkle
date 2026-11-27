import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { gateResend } from "../_shared/resend-gate.ts";
import { Resvg, initWasm } from "https://esm.sh/@resvg/resvg-wasm@2.6.2";
import { requireSendAuth } from "../_shared/require-send-auth.ts";
import { DEPARTED_AGENT_COLUMNS, isDepartedAgent } from "../_shared/departed.ts";
import { deliverWithReceipt, PRODUCTION_THRESHOLDS, readCanonicalPremium, recognitionMetric, recognitionPeriod, validPlaqueDate, validRecognitionAmount } from "./contract.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

let wasmPromise: Promise<void> | null = null;
let fontPromise: Promise<Uint8Array> | null = null;
async function plaqueFont() {
  if (!fontPromise) {
    fontPromise = fetch("https://galaxyfinancial.org/fonts/hanken-grotesk.woff2").then(async (response) => {
      if (!response.ok) throw new Error("The plaque font could not be loaded.");
      return new Uint8Array(await response.arrayBuffer());
    }).catch((error) => { fontPromise = null; throw error; });
  }
  return fontPromise;
}
async function ensureWasm() {
  if (!wasmPromise) {
    wasmPromise = (async () => {
      const response = await fetch("https://unpkg.com/@resvg/resvg-wasm@2.6.2/index_bg.wasm");
      if (!response.ok) throw new Error("Plaque renderer could not be loaded.");
      await initWasm(await response.arrayBuffer());
    })().catch((error) => { wasmPromise = null; throw error; });
  }
  await wasmPromise;
}

interface PlaqueRequest {
  agentId: string;
  milestoneType: string;
  amount: unknown;
  date: string;
  skipEmail?: boolean;
  retryTarget?: "agent" | "manager";
}

interface AwardRow {
  id: string; agent_id: string; amount: number | null; milestone_date: string;
  image_png_url: string | null; image_svg_url: string | null; share_slug: string | null;
  email_sent_at: string | null; email_delivery_status: string | null;
}

const MILESTONES: Record<
  string,
  { title: string; description: string; color: string; badge: string; threshold: string }
> = {
  single_day_bronze:    { title: "Bronze Achievement",     description: "Outstanding single-day production",  color: "#CD7F32", badge: "BRONZE ACHIEVEMENT",   threshold: "$1,000+" },
  single_day:           { title: "Gold Achievement",       description: "Exceptional single-day production",  color: "#C9A962", badge: "GOLD ACHIEVEMENT",     threshold: "$3,000+" },
  single_day_platinum:  { title: "Platinum Achievement",   description: "Elite single-day production",        color: "#E5E4E2", badge: "PLATINUM ACHIEVEMENT", threshold: "$5,000+" },
  weekly:               { title: "Weekly Diamond",         description: "Exceptional weekly production",      color: "#7DD3FC", badge: "WEEKLY DIAMOND",       threshold: "$10,000+" },
  monthly:              { title: "Elite Producer",         description: "Outstanding monthly production",     color: "#A78BFA", badge: "ELITE PRODUCER",       threshold: "$25,000+" },
  recruiter_rising:     { title: "Rising Recruiter",       description: "New talent pipeline momentum",       color: "#34D399", badge: "RISING RECRUITER",     threshold: "5+ recruits" },
  hiring_champion:      { title: "Hiring Champion",        description: "Consistent recruiting excellence",   color: "#60A5FA", badge: "HIRING CHAMPION",      threshold: "10+ recruits" },
  team_builder:         { title: "Team Builder",           description: "Building a legacy of leaders",       color: "#F472B6", badge: "TEAM BUILDER",         threshold: "20+ recruits" },
  hot_streak:           { title: "Hot Streak",             description: "Consecutive days of excellence",     color: "#FB923C", badge: "HOT STREAK",           threshold: "5+ days" },
  on_fire:              { title: "On Fire",                description: "Unstoppable production momentum",    color: "#EF4444", badge: "ON FIRE",              threshold: "10+ days" },
  unstoppable:          { title: "Unstoppable",            description: "Legendary consistency",              color: "#DC2626", badge: "UNSTOPPABLE",          threshold: "30+ days" },
  comeback_champion:    { title: "Comeback Champion",      description: "Week-over-week premium increase",    color: "#F59E0B", badge: "COMEBACK CHAMPION",    threshold: "Return to top" },
};

function generatePlaqueSVG(
  agentName: string,
  milestoneKey: string,
  amount: number,
  date: string,
  instagram?: string | null,
): string {
  const m = MILESTONES[milestoneKey] || MILESTONES.single_day;
  const formattedDate = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const formattedAmount = recognitionMetric(milestoneKey, amount);
  const nameSize = Math.max(34, Math.min(72, 1600 / Math.max(1, agentName.length)));

  const esc = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const W = 1080;
  const H = 1350;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0a0a0a"/>
      <stop offset="100%" stop-color="#050505"/>
    </linearGradient>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="8" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#bgGrad)"/>
  <rect x="80" y="100" width="${W - 160}" height="${H - 200}" fill="#0f0f0f" stroke="${m.color}" stroke-opacity="0.3" stroke-width="2" rx="4"/>
  <rect x="${W / 2 - 40}" y="200" width="80" height="3" fill="${m.color}" opacity="0.9"/>

  <text x="${W / 2}" y="280" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="22" font-weight="600" fill="${m.color}" letter-spacing="8">${esc(m.badge)}</text>

  <text x="${W / 2}" y="420" text-anchor="middle" font-family="Hanken Grotesk" font-size="${nameSize}" font-weight="700" fill="#ffffff">${esc(agentName)}</text>

  ${
    instagram
      ? `<text x="${W / 2}" y="470" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="24" fill="#888">@${esc(instagram)}</text>`
      : ""
  }

  <text x="${W / 2}" y="${instagram ? 540 : 510}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="20" fill="#555" letter-spacing="6">GALAXY FINANCIAL GROUP</text>

  <circle cx="540" cy="635" r="72" fill="${m.color}" fill-opacity="0.06" stroke="${m.color}" stroke-opacity="0.35" />
  <circle cx="540" cy="635" r="63" fill="none" stroke="${m.color}" stroke-opacity="0.18" />
  <g transform="translate(496 592) scale(3.65)" fill="none" stroke="${m.color}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M8 3h8v7a4 4 0 0 1-8 0V3Z M8 5H4v3a4 4 0 0 0 4 4 M16 5h4v3a4 4 0 0 1-4 4 M12 14v5 M8 21h8 M9 19h6" />
  </g>
  <text x="${W / 2}" y="830" text-anchor="middle" font-family="Hanken Grotesk" font-size="120" font-weight="700" fill="${m.color}">${esc(formattedAmount)}</text>

  <text x="${W / 2}" y="900" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="28" fill="#888">${esc(m.description)}</text>

  <text x="${W / 2}" y="970" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="22" fill="#555">${esc(formattedDate)}</text>

  <rect x="${W / 2 - 40}" y="1100" width="80" height="3" fill="#333"/>

  <text x="${W / 2}" y="1200" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="18" fill="#333" letter-spacing="4">POWERED BY GALAXY FINANCIAL</text>
</svg>`;
}

function generateEmailHTML(
  agentName: string,
  milestoneKey: string,
  amount: number,
  imageUrl: string,
  shareUrl: string,
  isManager: boolean,
): string {
  const m = MILESTONES[milestoneKey] || MILESTONES.single_day;
  const esc = (s: string) => s.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const greeting = isManager
    ? `Your team member ${esc(agentName)} just earned a plaque`
    : `Congratulations ${esc(agentName)}`;
  const roundedAmount = recognitionMetric(milestoneKey, amount);
  const metricContext = milestoneKey === "comeback_champion" ? " in week-over-week premium improvement" : "";

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(m.badge)}</title></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:Helvetica,Arial,sans-serif;color:#fff;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0a0a0a;padding:40px 20px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
      <tr><td align="center" style="padding:20px 0 40px;">
        <p style="margin:0;font-size:12px;letter-spacing:4px;color:${m.color};text-transform:uppercase;font-weight:600;">${esc(m.badge)}</p>
      </td></tr>
      <tr><td align="center">
        <h1 style="margin:0 0 20px;font-size:32px;font-weight:500;color:#fff;font-family:Georgia,serif;">${greeting}</h1>
        <p style="margin:0 0 40px;font-size:16px;color:#888;line-height:1.6;">
          ${
            isManager
              ? `They hit <strong style="color:${m.color}">${roundedAmount}</strong>${metricContext}. This achievement reflects their dedication and skill.`
              : `You hit <strong style="color:${m.color}">${roundedAmount}</strong>${metricContext}. Keep the momentum going.`
          }
        </p>
      </td></tr>
      <tr><td align="center" style="padding:0 0 40px;">
        <img src="${imageUrl}" alt="${esc(m.badge)} Plaque" width="540" style="max-width:100%;height:auto;border:0;display:block;border-radius:8px;" />
      </td></tr>
      <tr><td align="center" style="padding:0 0 30px;">
        <a href="${shareUrl}" style="display:inline-block;background:${m.color};color:#000;font-weight:700;padding:16px 36px;border-radius:4px;text-decoration:none;font-size:14px;letter-spacing:1px;text-transform:uppercase;">View &amp; Share Plaque</a>
      </td></tr>
      <tr><td align="center" style="padding:20px 0;border-top:1px solid #222;">
        <p style="margin:0;font-size:10px;color:#555;letter-spacing:1px;">GALAXY FINANCIAL GROUP</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

// Convert Uint8Array to base64 (Resend expects base64 for binary attachments)
function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

serve(async (req: Request) => {
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);

  const auth = await requireSendAuth(req, { floor: "staff_or_agent" });
  if (!auth.ok) return reply({ error: auth.error ?? "unauthorized" }, auth.status);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let awardId: string | null = null;
  let claimed = false;
  let agentAlreadySent = false;
  let uncertain = false;

  const updateAward = async (values: Record<string, unknown>) => {
    const { data, error } = await supabase.from("plaque_awards").update(values).eq("id", awardId!).select("id").single();
    if (error || !data) throw new Error("The recognition record could not be saved.");
  };

  try {
    const input: PlaqueRequest = await req.json();
    if (!input || typeof input !== "object") return reply({ error: "A recognition request is required." }, 400);
    const { milestoneType, skipEmail = false, retryTarget } = input;
    let { agentId, date } = input;
    const requestedAmount = input.amount;
    if (typeof agentId !== "string" || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(agentId)
      || !Object.hasOwn(MILESTONES, milestoneType) || !validPlaqueDate(date)
      || !validRecognitionAmount(requestedAmount) || typeof skipEmail !== "boolean"
      || (retryTarget !== undefined && retryTarget !== "agent" && retryTarget !== "manager")) {
      return reply({ error: "Choose a valid agent, milestone, amount and business date." }, 400);
    }
    let amount = requestedAmount;
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Phoenix", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    if (date > today) return reply({ error: "Recognition cannot use a future business date." }, 400);
    const productionMilestone = Object.hasOwn(PRODUCTION_THRESHOLDS, milestoneType);
    const period = recognitionPeriod(milestoneType, date, today);
    if (productionMilestone) date = period.start;

    let agentRead = await supabase.from("agents")
      .select(`id, profile_id, invited_by_manager_id, canonical_agent_id, ${DEPARTED_AGENT_COLUMNS}`)
      .eq("id", agentId).single();
    if (agentRead.error) throw new Error("The agent record could not be loaded.");
    // Follow the same merged-record winner used by production and training.
    if (agentRead.data?.canonical_agent_id) {
      agentId = agentRead.data.canonical_agent_id;
      agentRead = await supabase.from("agents")
        .select(`id, profile_id, invited_by_manager_id, canonical_agent_id, ${DEPARTED_AGENT_COLUMNS}`)
        .eq("id", agentId).single();
    }
    const agent = agentRead.data;
    if (agentRead.error || !agent || agent.canonical_agent_id) return reply({ error: "A canonical agent record is required." }, 409);
    if (!skipEmail && isDepartedAgent(agent)) return reply({ error: "This agent is no longer eligible for recognition emails." }, 409);

    if (auth.caller !== "service") {
      const viewer = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: req.headers.get("authorization")! } }, auth: { persistSession: false },
      });
      const { data: allowed, error } = await viewer.rpc("production_can_read_agent", { p_agent_id: agentId });
      if (error) throw new Error("Recognition access could not be verified.");
      if (allowed !== true) return reply({ error: "This agent is outside your recognition scope." }, 403);
    }

    const { data: aliases, error: aliasError } = await supabase.from("agents").select("id")
      .or(`id.eq.${agentId},canonical_agent_id.eq.${agentId}`);
    if (aliasError || !aliases?.length) throw new Error("Agent identity could not be verified.");
    const ids = aliases.map((row) => row.id);
    let existingQuery = supabase.from("plaque_awards")
      .select("id, agent_id, amount, milestone_date, image_png_url, image_svg_url, share_slug, email_sent_at, email_delivery_status")
      .in("agent_id", ids).eq("milestone_type", milestoneType);
    existingQuery = productionMilestone
      ? existingQuery.gte("milestone_date", period.start).lt("milestone_date", period.end)
      : existingQuery.eq("milestone_date", date);
    const existingRows: AwardRow[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await existingQuery.order("id").range(offset, offset + 999);
      if (error || !data) throw new Error("Prior recognition could not be checked.");
      existingRows.push(...data as AwardRow[]);
      if (data.length < 1000) break;
    }
    let award = existingRows.find((row) => row.email_sent_at || row.email_delivery_status === "sent") ?? existingRows[0] ?? null;
    agentAlreadySent = Boolean(award?.email_sent_at || award?.email_delivery_status === "sent");
    const plaqueResult = (row: AwardRow | null) => ({
      id: row?.id, png_url: row?.image_png_url, svg_url: row?.image_svg_url,
      share_slug: row?.share_slug, share_url: row?.share_slug ? `https://galaxyfinancial.org/plaque/${row.share_slug}` : null,
      milestone: MILESTONES[milestoneType].badge,
    });
    if (agentAlreadySent && retryTarget !== "manager" && !skipEmail) {
      return reply({ success: true, email_status: "already_sent", plaque: plaqueResult(award) });
    }
    const unresolved = existingRows.find((row) => row.email_delivery_status === "processing" || row.email_delivery_status === "unknown");
    if (unresolved) {
      return reply({ success: false, email_status: unresolved.email_delivery_status,
        error: "This recognition is in progress or needs a receipt review. Check the email delivery log before retrying." }, 409);
    }
    if (retryTarget === "manager" && !agentAlreadySent) return reply({ error: "Confirm the agent's recognition before retrying the manager copy." }, 409);

    if (award) {
      // Delivered history is immutable; an unsent production award is reverified below.
      if (!productionMilestone || agentAlreadySent) {
        if (!validRecognitionAmount(award.amount)) return reply({ error: "The original award amount is unavailable. Verify the recognition record before generating or sending it." }, 409);
        amount = award.amount;
      }
      date = award.milestone_date;
    }
    if (productionMilestone && !agentAlreadySent) {
      amount = 0;
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await supabase.from("v_production_canonical")
          .select("annual_premium, posted_date, agent_id").in("agent_id", ids)
          .gte("posted_date", period.start).lt("posted_date", period.end)
          .order("posted_date").order("agent_id").order("row_key").range(offset, offset + 999);
        if (error || !data) throw new Error("Posted production could not be verified.");
        for (const row of data) {
          amount += readCanonicalPremium(row.annual_premium);
        }
        if (data.length < 1000) break;
      }
      if (amount < PRODUCTION_THRESHOLDS[milestoneType]) {
        return reply({ error: "The posted production book has not reached this milestone. Refresh recognition after production is posted." }, 409);
      }
    } else if (!productionMilestone && auth.caller !== "service" && !agentAlreadySent) {
      // A manager can insert a plaque row. That alone cannot authorize a first
      // non-production email; only an existing server-side attempt may be retried.
      if (!award) return reply({ error: "This milestone must first be verified by its recognition workflow." }, 403);
      const { data: attempts, error } = await supabase.from("email_delivery_log").select("id")
        .in("related_record_id", existingRows.map((row) => row.id)).eq("template", "plaque").limit(1);
      if (error) throw new Error("The original recognition attempt could not be verified.");
      if (!attempts?.length) return reply({ error: "This milestone must first be verified by its recognition workflow." }, 403);
    }

    const milestone = MILESTONES[milestoneType];
    if (!award) {
      const { data, error } = await supabase.from("plaque_awards").insert({
        agent_id: agentId, milestone_type: milestoneType, milestone_date: date,
        amount: Math.round(amount), amount_at_time: Math.round(amount),
        share_slug: crypto.randomUUID(), color_hex: milestone.color, badge_label: milestone.badge,
      }).select("id, agent_id, amount, milestone_date, image_png_url, image_svg_url, share_slug, email_sent_at, email_delivery_status").single();
      if (error?.code === "23505") return reply({ error: "This recognition was just claimed. Refresh before retrying." }, 409);
      if (error || !data) throw new Error("The recognition could not be created.");
      award = data;
    }
    awardId = award.id;
    let claim = supabase.from("plaque_awards").update({ email_delivery_status: "processing", email_error: null }).eq("id", awardId);
    claim = award.email_delivery_status === null
      ? claim.is("email_delivery_status", null) : claim.eq("email_delivery_status", award.email_delivery_status);
    const { data: claimedRow, error: claimError } = await claim.select("id").maybeSingle();
    if (claimError) throw new Error("Recognition could not be reserved.");
    if (!claimedRow) return reply({ error: "Someone is already processing this recognition. Refresh before retrying." }, 409);
    claimed = true;
    if (productionMilestone && !agentAlreadySent) {
      await updateAward({ amount: Math.round(amount), amount_at_time: Math.round(amount) });
    }

    const { data: profile, error: profileError } = await supabase.from("profiles")
      .select("full_name, email, instagram_handle").eq("id", agent.profile_id).single();
    if (profileError || !profile?.full_name?.trim()) throw new Error("The agent's recognition profile is incomplete.");
    const agentName = profile.full_name;
    const [, font] = await Promise.all([ensureWasm(), plaqueFont()]);
    const svg = generatePlaqueSVG(agentName, milestoneType, amount, date, profile.instagram_handle);
    const resvg = new Resvg(svg, { fitTo: { mode: "width", value: 1080 },
      font: { fontBuffers: [font], loadSystemFonts: false, defaultFontFamily: "Hanken Grotesk" },
    });
    const pngData = resvg.render().asPng();
    const pngPath = `plaques/${award.id}.png`, svgPath = `plaques/${award.id}.svg`;
    const pngUpload = await supabase.storage.from("plaque-images").upload(pngPath, pngData, { contentType: "image/png", upsert: true });
    if (pngUpload.error) throw new Error("The plaque image could not be uploaded.");
    const svgUpload = await supabase.storage.from("plaque-images").upload(svgPath, new TextEncoder().encode(svg), { contentType: "image/svg+xml", upsert: true });
    if (svgUpload.error) throw new Error("The plaque artwork could not be uploaded.");
    const pngUrl = supabase.storage.from("plaque-images").getPublicUrl(pngPath).data.publicUrl;
    const svgUrl = supabase.storage.from("plaque-images").getPublicUrl(svgPath).data.publicUrl;
    const slug = award.share_slug || crypto.randomUUID();
    const shareUrl = `https://galaxyfinancial.org/plaque/${slug}`;
    await updateAward({ image_png_url: pngUrl, image_svg_url: svgUrl, share_slug: slug, generated_at: new Date().toISOString() });
    const plaque = { id: award.id, png_url: pngUrl, svg_url: svgUrl, share_slug: slug, share_url: shareUrl, milestone: milestone.badge };
    if (skipEmail) {
      await updateAward({ email_delivery_status: agentAlreadySent ? "sent" : "generated" });
      claimed = false;
      return reply({ success: true, email_status: "skipped", plaque });
    }
    const apiKey = Deno.env.get("RESEND_API_KEY");
    if (!apiKey) throw new Error("Plaque generated; email delivery is unavailable.");
    const resend = gateResend(new Resend(apiKey));
    const attachment = uint8ToBase64(pngData);

    const deliver = async (recipient: string, manager: boolean) => {
      const template = manager ? "plaque_manager_notify" : "plaque";
      const subject = manager ? `Team Achievement: ${agentName} – ${milestone.badge}` : `${milestone.badge} – Congratulations ${agentName}`;
      const prior: Array<{ status: string; provider_message_id: string | null }> = [];
      const familyIds = [...new Set([awardId!, ...existingRows.map((row) => row.id)])];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await supabase.from("email_delivery_log")
          .select("status, provider_message_id").in("related_record_id", familyIds).eq("template", template)
          .eq("recipient_email", recipient).order("id").range(offset, offset + 999);
        if (error || !data) throw new Error("Prior email delivery could not be verified.");
        prior.push(...data);
        if (data.length < 1000) break;
      }
      const delivered = prior.find((row) => row.provider_message_id && ["sent", "delivered", "opened", "clicked"].includes(row.status));
      if (delivered?.provider_message_id) return { status: "sent" as const, providerId: delivered.provider_message_id };
      if (prior.some((row) => ["queued", "unknown", "bounced"].includes(row.status))) {
        return { status: "unknown" as const, error: "Review the prior delivery receipt or recipient before retrying." };
      }
      const { data: log, error: logError } = await supabase.from("email_delivery_log").insert({
        template, recipient_email: recipient, agent_id: agentId, subject,
        related_record_id: awardId, related_record_type: "plaque_award", status: "queued",
      }).select("id").single();
      if (logError || !log) throw new Error("The delivery attempt could not be recorded; no email was sent.");
      const result = await deliverWithReceipt(
        () => resend.emails.send({
          from: "Galaxy Financial <notifications@galaxyfinancial.org>", to: [recipient], subject,
          html: generateEmailHTML(agentName, milestoneType, amount, pngUrl, shareUrl, manager),
          attachments: [{ filename: `galaxy-${milestoneType}-plaque.png`, content: attachment }],
        }),
        async (providerId) => {
          const { data, error } = await supabase.from("email_delivery_log")
            .update({ status: "sent", sent_at: new Date().toISOString(), provider_message_id: providerId })
            .eq("id", log.id).select("id").single();
          if (error || !data) throw new Error("Delivery receipt could not be saved.");
        },
      );
      // Keep unknown agent acceptance intact even if the follow-up log write fails.
      if (!manager && result.status === "unknown") uncertain = true;
      if (result.status !== "sent") {
        const { error } = await supabase.from("email_delivery_log").update({ status: result.status, error: result.error }).eq("id", log.id);
        if (error) throw new Error("The unconfirmed delivery needs a receipt review.");
      }
      return result;
    };

    if (!agentAlreadySent) {
      if (!profile.email) throw new Error("Plaque generated; the agent needs a valid email address before delivery.");
      const result = await deliver(profile.email, false);
      if (result.status !== "sent") {
        uncertain = result.status === "unknown";
        throw new Error(result.error);
      }
      // Keep the reservation while the manager copy is handled.
      uncertain = true;
      await updateAward({ email_sent_at: new Date().toISOString() });
      uncertain = false;
      agentAlreadySent = true;
    }

    let managerStatus = "not_requested";
    let managerWarning: string | undefined;
    if (agent.invited_by_manager_id) {
      try {
        const { data: manager, error } = await supabase.from("agents")
          .select(`profile_id, ${DEPARTED_AGENT_COLUMNS}`).eq("id", agent.invited_by_manager_id).single();
        if (error) throw new Error("The manager copy could not be checked.");
        if (manager?.profile_id && !isDepartedAgent(manager)) {
          const { data: managerProfile, error } = await supabase.from("profiles").select("email").eq("id", manager.profile_id).single();
          if (error) throw new Error("The manager email could not be checked.");
          if (managerProfile?.email && managerProfile.email.toLowerCase() !== profile.email?.toLowerCase()) {
            const result = await deliver(managerProfile.email, true);
            managerStatus = result.status;
            if (result.status !== "sent") managerWarning = result.error;
          }
        }
      } catch (error) {
        managerStatus = "unknown";
        managerWarning = error instanceof Error ? error.message : "Review the manager copy in the email delivery log.";
      }
    }
    await updateAward({ email_delivery_status: "sent", email_error: null });
    claimed = false;
    const requestedSent = retryTarget !== "manager" || managerStatus === "sent";
    return reply({ success: requestedSent, email_status: requestedSent ? "sent" : managerStatus,
      manager_status: managerStatus, warning: managerWarning,
      ...(requestedSent ? {} : { error: managerWarning || "No eligible manager email was found." }), plaque });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Recognition could not be completed.";
    if (claimed && awardId) {
      const status = uncertain ? "unknown" : agentAlreadySent ? "sent" : "failed";
      const { error: recordError } = await supabase.from("plaque_awards")
        .update({ email_delivery_status: status, email_error: message }).eq("id", awardId);
      if (recordError) console.error("Recognition status needs reconciliation", { awardId });
    }
    return reply({ success: false, email_status: uncertain ? "unknown" : "failed", error: message }, 500);
  }
});
