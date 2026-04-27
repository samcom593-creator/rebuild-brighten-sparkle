// tiktok-fan-monetizer — pulls Sam's recent TikTok DM/comment activity and
// turns high-intent fan questions into queued auto-replies that pitch the
// right APEX offer.
//
// Phase 1 (this file): scaffold + intent classifier + offer matcher.
// Inputs: rows already pushed into public.tiktok_inbox by the local
// `~/agent/scripts/tiktok-inbox-snapshot.ts` worker (or manually pasted).
// Outputs: queued replies in public.tiktok_outbox with a preview link
// for Sam to approve before send (per follow-up-operator memory).
//
// Phase 2 (later): pull TikTok via official API once Sam links the
// account, auto-send replies after Sam confirms a "trust mode" toggle.
//
// Cron: hourly. Run alongside offers-monetization-monitor.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

// Keyword → SKU mapping. The right offer to pitch depends on what the fan asked.
const INTENT_MAP: Array<{ test: RegExp; sku: string; ctaText: string }> = [
  { test: /\b(leads?|prospects?|appointments?)\b/i,                  sku: "platinum",            ctaText: "Get Sam's Platinum Vet Leads (fresh weekly)" },
  { test: /\b(dm|message|inbox|comment|engagement|followers?)\b/i,  sku: "social_growth",       ctaText: "Sam's Full Social Media Growth Suite — done-for-you" },
  { test: /\b(automate|bot|manychat|auto.?dm)\b/i,                  sku: "auto_dm",              ctaText: "Sam's Auto-DM Engine — replaces ManyChat" },
  { test: /\b(gym|workout|fit|body|diet|train|reset)\b/i,           sku: "fitness_reset",        ctaText: "Sam's 30-day Fitness Reset Blueprint ($97)" },
  { test: /\b(course|teach|train|how do i|how can i|learn)\b/i,     sku: "kingofsales_course",   ctaText: "King of Sales — Sam's full closing system" },
  { test: /\b(work with you|coaching|mentor|1.?on.?1|consult)\b/i,  sku: "work_with_sam",        ctaText: "1:1 Work With Sam — limited slots" },
];

const OFFER_URL: Record<string, string> = {
  gold:               "https://apex-financial.org/purchase-leads",
  platinum:           "https://apex-financial.org/purchase-leads",
  auto_dm:            "https://apex-financial.org/purchase-leads",
  social_growth:      "https://apex-financial.org/purchase-leads",
  fitness_reset:      "https://apex-financial.org/purchase-leads",
  kingofsales_course: "https://apex-financial.org/purchase-leads",
  work_with_sam:      "https://apex-financial.org/purchase-leads",
};

function classifyAndPitch(text: string): { sku: string; cta: string } | null {
  for (const rule of INTENT_MAP) {
    if (rule.test.test(text)) return { sku: rule.sku, cta: rule.ctaText };
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Pull anything in the inbox without a queued reply.
  const { data: pending = [] } = await supabase
    .from("tiktok_inbox" as any)
    .select("id, sender, message, received_at")
    .is("replied_at", null)
    .order("received_at", { ascending: true })
    .limit(50);

  const out: any = { processed: 0, queued: 0, skipped: 0 };
  for (const msg of pending as any[]) {
    out.processed++;
    const match = classifyAndPitch(msg.message ?? "");
    if (!match) { out.skipped++; continue; }
    const reply = `${match.cta}: ${OFFER_URL[match.sku] ?? "https://apex-financial.org"}`;
    await supabase.from("tiktok_outbox" as any).insert({
      inbox_id: msg.id,
      sender: msg.sender,
      reply_text: reply,
      pitched_sku: match.sku,
      status: "pending_approval",
    });
    out.queued++;
  }

  return new Response(JSON.stringify(out, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
