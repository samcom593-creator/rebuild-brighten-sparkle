import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  try {
    const { event_type, agent_name, details } = await req.json();

    // Get Discord webhook URL from automation_settings
    const { data: setting } = await supabase
      .from("automation_settings")
      .select("*")
      .eq("name", "Discord Webhook")
      .single();

    // Also check profiles for webhook URL stored in settings
    const { data: profiles } = await supabase
      .from("profiles")
      .select("discord_webhook_url")
      .not("discord_webhook_url", "is", null)
      .limit(1);

    const webhookUrl = (profiles as any)?.[0]?.discord_webhook_url || null;

    if (!webhookUrl) {
      return new Response(JSON.stringify({ message: "No Discord webhook configured" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build embed based on event type
    let embed: any = {};
    
    switch (event_type) {
      case "deal_closed":
        embed = {
          title: "🎉 Deal Closed!",
          description: `**${agent_name}** just closed a deal!`,
          color: 0x10b981, // emerald
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
          color: 0xf59e0b, // amber
          fields: [
            { name: "Achievement", value: details?.milestone || "Unknown", inline: false },
          ],
          footer: { text: "Apex Financial • Milestone" },
          timestamp: new Date().toISOString(),
        };
        break;
      case "new_hire":
        embed = {
          title: "👋 New Team Member!",
          description: `**${agent_name}** just joined the team!`,
          color: 0x3b82f6, // blue
          footer: { text: "Apex Financial • Recruitment" },
          timestamp: new Date().toISOString(),
        };
        break;
      default:
        embed = {
          title: `📢 ${event_type}`,
          description: `**${agent_name}**: ${details?.message || ""}`,
          color: 0x8b5cf6, // purple
          footer: { text: "Apex Financial" },
          timestamp: new Date().toISOString(),
        };
    }

    // Send to Discord
    const discordRes = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "APEX Bot",
        embeds: [embed],
      }),
    });

    if (!discordRes.ok) {
      const errText = await discordRes.text();
      throw new Error(`Discord API error ${discordRes.status}: ${errText}`);
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Discord webhook error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
