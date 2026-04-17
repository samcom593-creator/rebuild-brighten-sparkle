import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { createHandler } from "../_shared/handler.ts";
import { jsonResponse } from "../_shared/cors.ts";
import { parseBody, v } from "../_shared/validate.ts";

const BodySchema = v.object({
  event_type: v.string({ min: 1, max: 64, required: true }),
  agent_name: v.string({ min: 1, max: 200, required: true }),
  details: v.any(),
});

Deno.serve(
  createHandler(
    {
      functionName: "discord-webhook-notify",
      requireAuth: false, // called from triggers + client; protect via rate limit
      rateLimit: { maxRequests: 60, windowSeconds: 60 },
    },
    async (req) => {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
        { auth: { persistSession: false } }
      );

      const { event_type, agent_name, details } = await req.json();

      // Resolve webhook from profiles (first profile with one set wins)
      const { data: profiles } = await supabase
        .from("profiles")
        .select("discord_webhook_url")
        .not("discord_webhook_url", "is", null)
        .limit(1);

      const webhookUrl = (profiles as any)?.[0]?.discord_webhook_url || null;
      if (!webhookUrl) {
        return jsonResponse({ message: "No Discord webhook configured" });
      }

      let embed: any;
      switch (event_type) {
        case "deal_closed":
          embed = {
            title: "🎉 Deal Closed!",
            description: `**${agent_name}** just closed a deal!`,
            color: 0x10b981,
            fields: [
              { name: "ALP", value: `$${details?.aop || 0}`, inline: true },
              { name: "Deals Today", value: `${details?.deals || 1}`, inline: true },
            ],
            footer: { text: "Apex Financial • Deal Alert" },
            timestamp: new Date().toISOString(),
          };
          break;
        case "milestone":
          embed = {
            title: "🏆 Milestone Reached!",
            description: `**${agent_name}** hit a new milestone!`,
            color: 0xf59e0b,
            fields: [{ name: "Achievement", value: details?.milestone || "Unknown", inline: false }],
            footer: { text: "Apex Financial • Milestone" },
            timestamp: new Date().toISOString(),
          };
          break;
        case "new_hire":
          embed = {
            title: "👋 New Team Member!",
            description: `**${agent_name}** just joined the team!`,
            color: 0x3b82f6,
            footer: { text: "Apex Financial • Recruitment" },
            timestamp: new Date().toISOString(),
          };
          break;
        default:
          embed = {
            title: `📢 ${event_type}`,
            description: `**${agent_name}**: ${details?.message || ""}`,
            color: 0x8b5cf6,
            footer: { text: "Apex Financial" },
            timestamp: new Date().toISOString(),
          };
      }

      const discordRes = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "APEX Bot", embeds: [embed] }),
      });

      if (!discordRes.ok) {
        const errText = await discordRes.text();
        throw new Error(`Discord API error ${discordRes.status}: ${errText}`);
      }

      return jsonResponse({ success: true });
    }
  )
);
