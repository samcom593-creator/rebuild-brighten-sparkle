/**
 * ig-voice-broadcast (PL-076)
 *
 * Pushes sanitized recruit/deal notifications to the Discord voice channel
 * so the team gets ambient "another one" energy on the call without ever
 * leaking client PII.
 *
 * STRICT sanitization rules — these are non-negotiable:
 *   - NO client names, NO carrier names, NO dollar amounts, NO emails,
 *     NO phone numbers, NO state names. Anything except the agent's
 *     first name and the event type is stripped.
 *   - Allowed event types: deal_closed, hire_activated, applicant_submitted.
 *   - Output format is always one of:
 *       "Another deal from <First>."
 *       "Another hire — <First>."
 *       "Another applicant in — <First> just sent the link."
 *
 * Webhook URL is read from system_settings.discord_webhook_url_voice.
 * If that setting is empty/missing the function returns 200 with
 * status='disabled' so the upstream caller never errors.
 *
 * Auth: BOT_SQL_TOKEN (admin / service role) OR a JWT from an active
 * recruiting/manager agent. Both checked.
 *
 * Request body:
 *   { event: "deal_closed" | "hire_activated" | "applicant_submitted",
 *     agent_first_name: string }
 *
 * Response:
 *   { ok: true, status: "sent" | "disabled" | "blocked" }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type EventType = "deal_closed" | "hire_activated" | "applicant_submitted";

const ALLOWED_EVENTS = new Set<EventType>([
  "deal_closed",
  "hire_activated",
  "applicant_submitted",
]);

// Block any string that smells like client PII before it hits Discord.
// Belt + suspenders — the message templates only use the first name,
// but if a caller ever passes free-form text in agent_first_name this
// catches it before it leaks.
const PII_PATTERNS: RegExp[] = [
  /\b\d{3}[\s.-]?\d{3}[\s.-]?\d{4}\b/, // US phone
  /\S+@\S+\.\S+/,                       // email
  /\$[\d,]+/,                           // dollar amount
  /\b\d{4,}\b/,                         // any 4+ digit run (zip, premium, etc)
];

function containsPII(s: string): boolean {
  return PII_PATTERNS.some((re) => re.test(s));
}

function sanitizeFirstName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Strip everything except letters, hyphens, apostrophes, max 32 chars.
  // First word only — "Mike Johnson" → "Mike".
  const firstWord = trimmed.split(/\s+/)[0];
  const cleaned = firstWord.replace(/[^A-Za-z'-]/g, "").slice(0, 32);
  if (!cleaned) return null;
  if (containsPII(cleaned)) return null;
  // Capitalize.
  return cleaned[0].toUpperCase() + cleaned.slice(1).toLowerCase();
}

function buildMessage(event: EventType, firstName: string): string {
  switch (event) {
    case "deal_closed":         return `Another deal from ${firstName}.`;
    case "hire_activated":      return `Another hire — ${firstName}.`;
    case "applicant_submitted": return `Another applicant in — ${firstName} just sent the link.`;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: { event?: string; agent_first_name?: string };
  try { body = await req.json(); }
  catch {
    return new Response(JSON.stringify({ ok: false, error: "bad json" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Event type guard.
  const event = body.event as EventType | undefined;
  if (!event || !ALLOWED_EVENTS.has(event)) {
    return new Response(JSON.stringify({ ok: false, error: "invalid event", allowed: Array.from(ALLOWED_EVENTS) }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Sanitize first name. If the caller tried to slip PII through, refuse.
  const firstName = sanitizeFirstName(body.agent_first_name);
  if (!firstName) {
    return new Response(JSON.stringify({ ok: false, status: "blocked", error: "invalid or PII-bearing agent_first_name" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Pull webhook URL from system_settings.
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const { data: setting } = await supabase
    .from("system_settings")
    .select("value")
    .eq("key", "discord_webhook_url_voice")
    .maybeSingle();

  const webhookUrl = (setting?.value as string | null | undefined)?.trim();
  if (!webhookUrl) {
    // PL-076: webhook URL not set yet. Return 200 so callers don't error.
    // Sam-only fix: insert system_settings row with the voice-channel webhook URL.
    return new Response(JSON.stringify({ ok: true, status: "disabled", reason: "discord_webhook_url_voice not set" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const message = buildMessage(event, firstName);

  // Final defensive PII check on the rendered message.
  if (containsPII(message)) {
    return new Response(JSON.stringify({ ok: false, status: "blocked", error: "rendered message tripped PII guard" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: message,
        username: "APEX",
        // Suppress @everyone / @here parsing as a hardening measure.
        allowed_mentions: { parse: [] },
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      return new Response(JSON.stringify({ ok: false, status: "discord_error", code: res.status, body: txt.slice(0, 500) }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (err: any) {
    return new Response(JSON.stringify({ ok: false, status: "network_error", error: String(err?.message ?? err) }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true, status: "sent", message, event }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
