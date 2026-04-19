import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { Resvg, initWasm } from "https://esm.sh/@resvg/resvg-wasm@2.6.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

let wasmReady = false;
async function ensureWasm() {
  if (wasmReady) return;
  const wasmBuffer = await fetch(
    "https://unpkg.com/@resvg/[email protected]/index_bg.wasm",
  ).then((r) => r.arrayBuffer());
  await initWasm(wasmBuffer);
  wasmReady = true;
}

interface PlaqueRequest {
  agentId: string;
  milestoneType: string;
  amount: number;
  date: string;
  skipEmail?: boolean;
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
  comeback_champion:    { title: "Comeback Champion",      description: "Returned to form with conviction",   color: "#F59E0B", badge: "COMEBACK CHAMPION",    threshold: "Return to top" },
};

function generatePlaqueSVG(
  agentName: string,
  milestoneKey: string,
  amount: number,
  date: string,
  instagram?: string | null,
): string {
  const m = MILESTONES[milestoneKey] || MILESTONES.single_day;
  const formattedDate = new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const formattedAmount = "$" + Math.round(amount).toLocaleString("en-US");

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

  <text x="${W / 2}" y="420" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="72" font-weight="500" fill="#ffffff">${esc(agentName)}</text>

  ${
    instagram
      ? `<text x="${W / 2}" y="470" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="24" fill="#888">@${esc(instagram)}</text>`
      : ""
  }

  <text x="${W / 2}" y="${instagram ? 540 : 510}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="20" fill="#555" letter-spacing="6">APEX FINANCIAL GROUP</text>

  <text x="${W / 2}" y="780" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="140" font-weight="600" fill="${m.color}" filter="url(#glow)">${esc(formattedAmount)}</text>

  <text x="${W / 2}" y="900" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="28" fill="#888">${esc(m.description)}</text>

  <text x="${W / 2}" y="970" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="22" fill="#555">${esc(formattedDate)}</text>

  <rect x="${W / 2 - 40}" y="1100" width="80" height="3" fill="#333"/>

  <text x="${W / 2}" y="1200" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="18" fill="#333" letter-spacing="4">POWERED BY APEX FINANCIAL</text>
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
  const roundedAmount = "$" + Math.round(amount).toLocaleString("en-US");

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
              ? `They hit <strong style="color:${m.color}">${roundedAmount}</strong>. This achievement reflects their dedication and skill.`
              : `You hit <strong style="color:${m.color}">${roundedAmount}</strong>. Keep the momentum going.`
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
        <p style="margin:0;font-size:10px;color:#555;letter-spacing:1px;">APEX FINANCIAL GROUP</p>
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
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let logRowId: string | null = null;

  try {
    const { agentId, milestoneType, amount, date, skipEmail }: PlaqueRequest = await req.json();

    const { data: agentData } = await supabase
      .from("agents")
      .select("id, invited_by_manager_id, profile_id")
      .eq("id", agentId)
      .single();

    if (!agentData) {
      return new Response(JSON.stringify({ error: "Agent not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let agentName = "Team Member";
    let agentEmail: string | null = null;
    let instagram: string | null = null;

    if (agentData.profile_id) {
      const { data: p } = await supabase
        .from("profiles")
        .select("full_name, email, instagram_handle")
        .eq("id", agentData.profile_id)
        .single();
      if (p) {
        agentName = p.full_name || "Team Member";
        agentEmail = p.email;
        instagram = (p as any).instagram_handle ?? null;
      }
    }

    // Generate SVG → PNG
    await ensureWasm();
    const svg = generatePlaqueSVG(agentName, milestoneType, amount, date, instagram);
    const resvg = new Resvg(svg, { fitTo: { mode: "width", value: 1080 } });
    const pngData = resvg.render().asPng();

    // Upload both
    const timestamp = Date.now();
    const slug = crypto.randomUUID().slice(0, 10);
    const safeName = agentName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const pngPath = `plaques/${safeName}-${milestoneType}-${timestamp}.png`;
    const svgPath = `plaques/${safeName}-${milestoneType}-${timestamp}.svg`;

    await supabase.storage.from("plaque-images").upload(pngPath, pngData, {
      contentType: "image/png",
      upsert: true,
    });
    await supabase.storage
      .from("plaque-images")
      .upload(svgPath, new TextEncoder().encode(svg), {
        contentType: "image/svg+xml",
        upsert: true,
      });

    const pngUrl = supabase.storage.from("plaque-images").getPublicUrl(pngPath).data.publicUrl;
    const svgUrl = supabase.storage.from("plaque-images").getPublicUrl(svgPath).data.publicUrl;

    const milestone = MILESTONES[milestoneType] || MILESTONES.single_day;
    const { data: awardRow } = await supabase
      .from("plaque_awards")
      .insert({
        agent_id: agentId,
        milestone_type: milestoneType,
        milestone_date: date,
        amount: Math.round(amount),
        amount_at_time: Math.round(amount),
        image_png_url: pngUrl,
        image_svg_url: svgUrl,
        share_slug: slug,
        color_hex: milestone.color,
        badge_label: milestone.badge,
        generated_at: new Date().toISOString(),
      })
      .select()
      .single();

    const shareUrl = `https://apex-financial.org/plaque/${slug}`;
    const pngBase64 = uint8ToBase64(pngData);

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!skipEmail && resendApiKey && agentEmail) {
      const resend = new Resend(resendApiKey);

      const { data: emailLog } = await supabase
        .from("email_delivery_log")
        .insert({
          template: "plaque",
          recipient_email: agentEmail,
          agent_id: agentId,
          subject: `${milestone.badge} – Congratulations ${agentName}`,
          related_record_id: awardRow?.id,
          related_record_type: "plaque_award",
          status: "queued",
        })
        .select("id")
        .single();
      logRowId = emailLog?.id ?? null;

      try {
        const emailResponse = await resend.emails.send({
          from: "APEX Financial <notifications@apex-financial.org>",
          to: [agentEmail],
          subject: `${milestone.badge} – Congratulations ${agentName}`,
          html: generateEmailHTML(agentName, milestoneType, amount, pngUrl, shareUrl, false),
          attachments: [
            {
              filename: `apex-${milestoneType}-plaque.png`,
              content: pngBase64,
            },
          ],
        });

        if (logRowId) {
          await supabase
            .from("email_delivery_log")
            .update({
              status: "sent",
              sent_at: new Date().toISOString(),
              provider_message_id: (emailResponse as any)?.data?.id ?? null,
            })
            .eq("id", logRowId);
        }

        await supabase
          .from("plaque_awards")
          .update({
            email_sent_at: new Date().toISOString(),
            email_delivery_status: "sent",
          })
          .eq("id", awardRow!.id);
      } catch (emailError: any) {
        console.error("Plaque email failed:", emailError);
        if (logRowId) {
          await supabase
            .from("email_delivery_log")
            .update({
              status: "failed",
              error: emailError.message || String(emailError),
            })
            .eq("id", logRowId);
        }
        await supabase
          .from("plaque_awards")
          .update({
            email_delivery_status: "failed",
            email_error: emailError.message || String(emailError),
          })
          .eq("id", awardRow!.id);
      }

      // Notify manager
      if (agentData.invited_by_manager_id) {
        const { data: mgr } = await supabase
          .from("agents")
          .select("profile_id")
          .eq("id", agentData.invited_by_manager_id)
          .single();
        if (mgr?.profile_id) {
          const { data: mgrProf } = await supabase
            .from("profiles")
            .select("email")
            .eq("id", mgr.profile_id)
            .single();
          if (mgrProf?.email) {
            const { data: mgrLog } = await supabase
              .from("email_delivery_log")
              .insert({
                template: "plaque_manager_notify",
                recipient_email: mgrProf.email,
                agent_id: agentId,
                subject: `Team Achievement: ${agentName} – ${milestone.badge}`,
                related_record_id: awardRow?.id,
                related_record_type: "plaque_award",
                status: "queued",
              })
              .select("id")
              .single();
            try {
              const mgrResp = await resend.emails.send({
                from: "APEX Financial <notifications@apex-financial.org>",
                to: [mgrProf.email],
                subject: `Team Achievement: ${agentName} – ${milestone.badge}`,
                html: generateEmailHTML(agentName, milestoneType, amount, pngUrl, shareUrl, true),
                attachments: [
                  {
                    filename: `apex-${agentName}-${milestoneType}.png`,
                    content: pngBase64,
                  },
                ],
              });
              if (mgrLog?.id) {
                await supabase
                  .from("email_delivery_log")
                  .update({
                    status: "sent",
                    sent_at: new Date().toISOString(),
                    provider_message_id: (mgrResp as any)?.data?.id ?? null,
                  })
                  .eq("id", mgrLog.id);
              }
            } catch (e: any) {
              console.error("Manager notify failed:", e);
              if (mgrLog?.id) {
                await supabase
                  .from("email_delivery_log")
                  .update({
                    status: "failed",
                    error: e.message || String(e),
                  })
                  .eq("id", mgrLog.id);
              }
            }
          }
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        plaque: {
          id: awardRow?.id,
          png_url: pngUrl,
          svg_url: svgUrl,
          share_slug: slug,
          share_url: shareUrl,
          milestone: milestone.badge,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("send-plaque-recognition error:", error);
    return new Response(JSON.stringify({ error: error.message || String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
