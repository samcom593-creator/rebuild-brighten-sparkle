// Discord Webhook Notify — 20+ event types, rich embeds, retry logic, rate-limit handling
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { createHandler } from "../_shared/handler.ts";
import { jsonResponse } from "../_shared/cors.ts";
import { parseBody, v } from "../_shared/validate.ts";

// ─── Discord embed colors ─────────────────────────────────────────────────────
const C = {
  green:   0x10b981,
  gold:    0xf59e0b,
  blue:    0x3b82f6,
  purple:  0x8b5cf6,
  red:     0xef4444,
  orange:  0xf97316,
  cyan:    0x06b6d4,
  pink:    0xec4899,
  emerald: 0x059669,
  slate:   0x64748b,
  rose:    0xf43f5e,
  indigo:  0x6366f1,
} as const;

// ─── Stage display labels ─────────────────────────────────────────────────────
const STAGE_LABELS: Record<string, string> = {
  new_applicant:        "📥 New Applicant",
  unlicensed:           "📣 Needs Outreach",
  course_purchased:     "📚 Course Started",
  finished_course:      "✅ Course Complete",
  test_scheduled:       "📅 Test Scheduled",
  passed_test:          "🎯 Exam Passed",
  fingerprints_done:    "🔍 Fingerprints Done",
  waiting_on_license:   "⏳ Waiting on License",
  licensed:             "🏆 LICENSED",
  dormant:              "💤 Dormant",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt$(val: unknown): string {
  const n = Number(val) || 0;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

function fmtNum(val: unknown): string {
  return (Number(val) || 0).toLocaleString();
}

// ─── Embed builder ────────────────────────────────────────────────────────────
function buildEmbed(event_type: string, agent_name: string, details: any): object {
  const ts = new Date().toISOString();
  const d  = details ?? {};

  switch (event_type) {

    // ── Deal closed ────────────────────────────────────────────────────────
    case "deal_closed": {
      const aop      = Number(d.aop ?? d.annual_premium ?? 0);
      const monthly  = Number(d.monthly ?? d.monthly_premium ?? aop / 12);
      const deals    = Number(d.deals ?? d.total_deals ?? 1);
      const mtd      = d.mtd_alp ? fmt$(d.mtd_alp) : null;
      const carrier  = d.carrier  || null;
      const product  = d.product  || null;
      const client   = d.client   || null;

      const fields: object[] = [
        { name: "💰 ALP",            value: fmt$(aop),       inline: true },
        { name: "📅 Monthly",        value: fmt$(monthly),   inline: true },
        { name: "🔢 Deals Today",    value: `**${deals}**`,  inline: true },
      ];
      if (carrier) fields.push({ name: "🏢 Carrier",  value: carrier,   inline: true });
      if (product) fields.push({ name: "📋 Product",  value: product,   inline: true });
      if (client)  fields.push({ name: "👤 Client",   value: client,    inline: true });
      if (mtd)     fields.push({ name: "📈 MTD ALP",  value: mtd,       inline: true });

      return {
        title: "🔥  DEAL CLOSED!",
        description: `**${agent_name}** just slammed a deal shut! The money is IN! 💥`,
        color: C.green,
        fields,
        footer: { text: "Apex Financial • Deal Alert" },
        timestamp: ts,
      };
    }

    // ── Stage change ───────────────────────────────────────────────────────
    case "stage_change": {
      const from     = STAGE_LABELS[d.from_stage] ?? d.from_stage ?? "—";
      const to       = STAGE_LABELS[d.to_stage]   ?? d.to_stage   ?? "—";
      const licensed = d.to_stage === "licensed";
      const recruiter = d.recruiter ? `\n👔 Recruiter: **${d.recruiter}**` : "";

      return {
        title: licensed ? "🏆  NEW LICENSED AGENT!" : "📊  Pipeline Stage Update",
        description: licensed
          ? `**${agent_name}** is NOW OFFICIALLY LICENSED! 🎉 Time to write some business!${recruiter}`
          : `**${agent_name}** advanced through the licensing pipeline!${recruiter}`,
        color: licensed ? C.gold : C.purple,
        fields: [
          { name: "From",     value: from,                             inline: true },
          { name: "To",       value: to,                               inline: true },
          { name: "Status",   value: licensed ? "✅ COMPLETE" : "⏳ In Progress", inline: true },
        ],
        footer: { text: "Apex Financial • Pipeline" },
        timestamp: ts,
      };
    }

    // ── New applicant ──────────────────────────────────────────────────────
    case "new_applicant": {
      return {
        title: "📥  New Applicant!",
        description: `**${agent_name}** just submitted an application to join the team! Let's get them going! 🚀`,
        color: C.blue,
        fields: [
          { name: "📧 Email", value: d.email || "—",  inline: true },
          { name: "📱 Phone", value: d.phone || "—",  inline: true },
          { name: "🗺️ State", value: d.state || "—",  inline: true },
        ],
        footer: { text: "Apex Financial • Recruiting" },
        timestamp: ts,
      };
    }

    // ── New hire (licensed + onboarded) ───────────────────────────────────
    case "new_hire": {
      const manager = d.manager || d.manager_name || null;
      return {
        title: "👋  NEW TEAM MEMBER!",
        description: `**${agent_name}** just joined the Apex Financial family! Welcome aboard! 🎊`,
        color: C.blue,
        fields: manager ? [{ name: "👔 Manager", value: manager, inline: true }] : [],
        footer: { text: "Apex Financial • Recruitment" },
        timestamp: ts,
      };
    }

    // ── Production milestone ───────────────────────────────────────────────
    case "milestone": {
      const milestone = d.milestone ?? d.achievement ?? "Unknown achievement";
      const value     = d.value ?? d.amount;
      return {
        title: "🏆  MILESTONE REACHED!",
        description: `**${agent_name}** just crushed a new milestone! 💪`,
        color: C.gold,
        fields: [
          { name: "🎯 Achievement", value: String(milestone), inline: false },
          ...(value ? [{ name: "💰 Value", value: fmt$(value), inline: true }] : []),
        ],
        footer: { text: "Apex Financial • Milestone" },
        timestamp: ts,
      };
    }

    // ── Production record ──────────────────────────────────────────────────
    case "production_record": {
      const period = d.period || "Today";
      const alp    = d.alp ?? d.amount;
      const rank   = d.rank;
      const deals  = d.deals;
      return {
        title: "📈  PRODUCTION RECORD!",
        description: `**${agent_name}** just set a new record for ${period}! Absolutely DOMINANT! 🔥`,
        color: C.emerald,
        fields: [
          { name: "📅 Period",      value: period,           inline: true },
          ...(alp   ? [{ name: "💰 ALP",   value: fmt$(alp),    inline: true }] : []),
          ...(deals ? [{ name: "🔢 Deals", value: fmtNum(deals), inline: true }] : []),
          ...(rank  ? [{ name: "🏆 Rank",  value: `#${rank}`,   inline: true }] : []),
        ],
        footer: { text: "Apex Financial • Production" },
        timestamp: ts,
      };
    }

    // ── Streak alert ───────────────────────────────────────────────────────
    case "streak_alert": {
      const streak = d.streak_days ?? d.streak ?? 0;
      const type   = d.streak_type || "production";
      const fires  = "🔥".repeat(Math.min(streak, 5));
      return {
        title: `${fires}  STREAK ALERT!`,
        description: `**${agent_name}** is on a **${streak}-day** ${type} streak! Don't break it!`,
        color: C.orange,
        fields: [
          { name: "🔥 Streak",  value: `${streak} days`,    inline: true },
          { name: "📊 Type",    value: type,                 inline: true },
        ],
        footer: { text: "Apex Financial • Streak" },
        timestamp: ts,
      };
    }

    // ── Rank up ────────────────────────────────────────────────────────────
    case "rank_up": {
      const newRank  = d.new_rank  ?? d.rank ?? "";
      const prevRank = d.previous_rank ?? "";
      return {
        title: "⬆️  RANK UP!",
        description: `**${agent_name}** just leveled up! They're climbing the leaderboard! 🎖️`,
        color: C.pink,
        fields: [
          ...(prevRank ? [{ name: "Before", value: prevRank, inline: true }] : []),
          { name: "🏅 New Rank", value: `**${newRank}**`, inline: true },
        ],
        footer: { text: "Apex Financial • Ranking" },
        timestamp: ts,
      };
    }

    // ── Daily summary ──────────────────────────────────────────────────────
    case "daily_summary": {
      const deals    = d.deals     || 0;
      const alp      = d.alp       || 0;
      const newLeads = d.new_leads || 0;
      const licensed = d.licensed  || 0;
      const top      = d.top_agent || d.top_performer;
      return {
        title: "📊  DAILY SUMMARY",
        description: `Here's the Apex Financial recap for today:`,
        color: C.cyan,
        fields: [
          { name: "🤝 Deals",      value: fmtNum(deals),    inline: true },
          { name: "💰 Total ALP",  value: fmt$(alp),        inline: true },
          { name: "📋 New Leads",  value: fmtNum(newLeads), inline: true },
          { name: "🏆 Licensed",   value: fmtNum(licensed), inline: true },
          ...(top ? [{ name: "👑 Top Performer", value: `**${top}**`, inline: false }] : []),
        ],
        footer: { text: "Apex Financial • Daily Report" },
        timestamp: ts,
      };
    }

    // ── Weekly champion ────────────────────────────────────────────────────
    case "weekly_champion": {
      const alp   = d.alp   || 0;
      const deals = d.deals || 0;
      return {
        title: "👑  WEEKLY CHAMPION!",
        description: `**${agent_name}** is this week's APEX Champion! Absolutely crushing it! 🏆`,
        color: C.gold,
        fields: [
          { name: "💰 Weekly ALP",   value: fmt$(alp),        inline: true },
          { name: "🔢 Weekly Deals", value: fmtNum(deals),    inline: true },
        ],
        footer: { text: "Apex Financial • Weekly Champion" },
        timestamp: ts,
      };
    }

    // ── Comeback alert (dormant agent re-engaged) ──────────────────────────
    case "comeback_alert": {
      const days = d.days_dormant ?? d.days ?? 0;
      return {
        title: "🎯  COMEBACK ALERT!",
        description: `**${agent_name}** is BACK after ${days} days! Let's get them fired up! 🔥`,
        color: C.orange,
        fields: [
          { name: "📅 Days Away", value: `${days}`, inline: true },
        ],
        footer: { text: "Apex Financial • Re-engagement" },
        timestamp: ts,
      };
    }

    // ── Lead assigned ──────────────────────────────────────────────────────
    case "lead_assigned": {
      const lead  = d.lead_name ?? "New Lead";
      const state = d.state     || null;
      const score = d.score     || null;
      return {
        title: "📋  Lead Assigned",
        description: `**${agent_name}** has a hot new lead: **${lead}** 🎯`,
        color: C.indigo,
        fields: [
          ...(state ? [{ name: "🗺️ State",      value: state,         inline: true }] : []),
          ...(score ? [{ name: "⭐ Lead Score", value: String(score), inline: true }] : []),
        ],
        footer: { text: "Apex Financial • Lead Management" },
        timestamp: ts,
      };
    }

    // ── Agent contracted ───────────────────────────────────────────────────
    case "agent_contracted": {
      const carrier = d.carrier || null;
      return {
        title: "📝  Agent Contracted!",
        description: `**${agent_name}** just got contracted and is ready to write business! 🚀`,
        color: C.blue,
        fields: carrier ? [{ name: "🏢 Carrier", value: carrier, inline: true }] : [],
        footer: { text: "Apex Financial • Contracting" },
        timestamp: ts,
      };
    }

    // ── Team alert (admin broadcast) ───────────────────────────────────────
    case "team_alert": {
      return {
        title: "⚡  TEAM ALERT",
        description: `**${agent_name}**: ${d.message || "Action required!"}`,
        color: C.red,
        fields: Array.isArray(d.fields) ? d.fields : [],
        footer: { text: "Apex Financial • Alert" },
        timestamp: ts,
      };
    }

    // ── Monthly leaderboard ────────────────────────────────────────────────
    case "monthly_leaderboard": {
      const month  = d.month  || new Date().toLocaleString("default", { month: "long" });
      const fields = (d.top ?? []).slice(0, 5).map((entry: any, i: number) => ({
        name:   `${["🥇","🥈","🥉","4️⃣","5️⃣"][i] ?? `${i+1}.`} ${entry.name}`,
        value:  `${fmt$(entry.alp)} • ${entry.deals} deals`,
        inline: false,
      }));
      return {
        title: `🏆  ${month.toUpperCase()} LEADERBOARD`,
        description: "Here are Apex Financial's top producers this month!",
        color: C.gold,
        fields,
        footer: { text: "Apex Financial • Monthly Leaderboard" },
        timestamp: ts,
      };
    }

    // ── Stale pipeline alert ───────────────────────────────────────────────
    case "stale_pipeline": {
      const count = d.count ?? 0;
      const stage = d.stage || "pipeline";
      return {
        title: "⚠️  Stale Pipeline Alert",
        description: `**${agent_name}** has **${count}** leads going cold in ${stage}. Time to reach out!`,
        color: C.rose,
        fields: [
          { name: "🔢 Leads at Risk", value: String(count), inline: true },
          { name: "📊 Stage",          value: stage,         inline: true },
        ],
        footer: { text: "Apex Financial • Pipeline Health" },
        timestamp: ts,
      };
    }

    // ── Fallback ───────────────────────────────────────────────────────────
    default:
      return {
        title: `📢  ${event_type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}`,
        description: `**${agent_name}**: ${d.message || ""}`,
        color: C.purple,
        footer: { text: "Apex Financial" },
        timestamp: ts,
      };
  }
}

// ─── Webhook delivery with retry + rate-limit handling ────────────────────────
async function sendToDiscord(webhookUrl: string, embed: object): Promise<void> {
  const payload = JSON.stringify({
    username:   "APEX Financial",
    avatar_url: "https://api.dicebear.com/7.x/bottts/svg?seed=apex-financial",
    embeds: [embed],
  });

  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 2 ** attempt * 400));
    }

    const res = await fetch(webhookUrl, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    payload,
    });

    if (res.ok) return;

    if (res.status === 429) {
      let retryMs = 1000;
      try {
        const body = await res.json();
        retryMs = Math.min((body.retry_after ?? 1) * 1000, 10_000);
      } catch { /* ignore */ }
      await new Promise((r) => setTimeout(r, retryMs));
      continue;
    }

    if (res.status < 500) {
      const txt = await res.text();
      throw new Error(`Discord rejected request (${res.status}): ${txt.slice(0, 300)}`);
    }
    // 5xx — retry on next iteration
  }

  throw new Error("Failed to deliver Discord message after 4 attempts");
}

// ─── Schema ───────────────────────────────────────────────────────────────────
const BodySchema = v.object({
  event_type: v.string({ min: 1, max: 64, required: true }),
  agent_name: v.string({ min: 1, max: 200, required: true }),
  details:    v.any(),
  channel:    v.any(), // optional channel suffix for multi-webhook routing
});

// ─── Handler ──────────────────────────────────────────────────────────────────
Deno.serve(
  createHandler(
    {
      functionName: "discord-webhook-notify",
      requireAuth:  false,
      rateLimit:    { maxRequests: 120, windowSeconds: 60 },
    },
    async (req) => {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")  ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
        { auth: { persistSession: false } }
      );

      const { event_type, agent_name, details, channel } = await parseBody(req, BodySchema);

      // ── Resolve webhook URL ────────────────────────────────────────────────
      // Priority: (1) DISCORD_WEBHOOK_URL env secret
      //           (2) system_settings channel-specific key
      //           (3) system_settings default key
      //           (4) hardcoded bootstrap URL (self-heals until migration runs)
      const BOOTSTRAP_WEBHOOK = "https://discord.com/api/webhooks/1425987081418571779/3JrtT5W00gDos8XY2iYc5_nb5sxr9S9ztagW1bBigI-8daIrb170vTyxIqXV2E8x2S0T";

      let webhookUrl: string | null = Deno.env.get("DISCORD_WEBHOOK_URL") || null;

      if (!webhookUrl && channel) {
        const { data } = await supabase
          .from("system_settings")
          .select("value")
          .eq("key", `discord_webhook_url_${String(channel)}`)
          .maybeSingle();
        webhookUrl = (data as any)?.value || null;
      }

      if (!webhookUrl) {
        const { data } = await supabase
          .from("system_settings")
          .select("value")
          .eq("key", "discord_webhook_url")
          .maybeSingle();
        webhookUrl = (data as any)?.value || null;
      }

      // Bootstrap fallback — active until migration stores the URL in system_settings
      if (!webhookUrl) webhookUrl = BOOTSTRAP_WEBHOOK;

      const embed = buildEmbed(event_type, agent_name, details ?? {});
      await sendToDiscord(webhookUrl, embed);

      return jsonResponse({ ok: true, event_type });
    }
  )
);
