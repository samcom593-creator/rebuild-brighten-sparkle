// Vercel serverless function: notify Discord on deal events
const DISCORD_WEBHOOK =
  process.env.DISCORD_WEBHOOK_URL ||
  "https://discord.com/api/webhooks/1425987081418571779/3JrtT5W00gDos8XY2iYc5_nb5sxr9S9ztagW1bBigI-8daIrb170vTyxIqXV2E8x2S0T";

const COLORS: Record<string, number> = {
  deal_closed:   0x10b981,
  stage_change:  0x8b5cf6,
  new_applicant: 0x3b82f6,
  default:       0x64748b,
};

const fmt$ = (n: unknown) => {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(1)}k`;
  return `$${v.toFixed(0)}`;
};

function buildEmbed(event_type: string, agent_name: string, details: Record<string, unknown>) {
  const color = COLORS[event_type] ?? COLORS.default;
  const ts = new Date().toISOString();

  if (event_type === "deal_closed") {
    const aop     = Number(details.aop ?? details.annual_premium ?? 0);
    const monthly = aop / 12;
    const deals   = Number(details.deals ?? 1);
    return {
      title: "🔥  DEAL CLOSED!",
      description: `**${agent_name}** just slammed a deal shut! The money is IN! 💥`,
      color,
      fields: [
        { name: "💰 ALP",         value: fmt$(aop),      inline: true },
        { name: "📅 Monthly",     value: fmt$(monthly),  inline: true },
        { name: "🔢 Deals Today", value: `**${deals}**`, inline: true },
      ],
      footer: { text: "Apex Financial • Deal Alert" },
      timestamp: ts,
    };
  }

  return {
    title: `📣 ${event_type}`,
    description: `**${agent_name}**`,
    color,
    fields: Object.entries(details).map(([k, v]) => ({
      name: k, value: String(v), inline: true,
    })),
    timestamp: ts,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")    return res.status(405).json({ error: "Method not allowed" });

  const { event_type = "notification", agent_name = "Agent", details = {} } = req.body ?? {};

  const embed = buildEmbed(String(event_type), String(agent_name), details as Record<string, unknown>);

  try {
    const response = await fetch(DISCORD_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed] }),
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ ok: false, error: text.slice(0, 200) });
    }

    return res.status(200).json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message ?? String(e) });
  }
}
