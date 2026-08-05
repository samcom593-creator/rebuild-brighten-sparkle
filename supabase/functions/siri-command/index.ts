/**
 * siri-command — natural-language command endpoint for Siri Shortcut.
 *
 * iOS Shortcut posts { command: "Schedule call with Joe tomorrow 2pm", source: "siri" }
 * with a bearer token. This function:
 *   1. Parses the intent (simple patterns — extend with Claude API when key lands)
 *   2. Creates a calendar_events row (APEX native)
 *   3. Creates a Calendly scheduling link if the carrier is wired
 *   4. Fires email + SMS confirmations
 *   5. Returns a voice-ready response string Siri reads back
 *
 * Auth: bearer token in system_settings under key `siri_shortcut_token`
 *       (generate once, paste into Shortcut once, stays forever).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Intent =
  | { kind: "schedule"; title: string; whoRaw?: string; whenRaw?: string; when?: Date; durationMin?: number }
  | { kind: "reminder"; title: string; when?: Date }
  | { kind: "note";     body: string }
  | { kind: "status";   subject: string }
  | { kind: "unknown";  raw: string };

const now = () => new Date();
const pad = (n: number) => String(n).padStart(2, "0");

function parseWhen(s: string): { when: Date | undefined; whenRaw: string | undefined } {
  const raw = s.toLowerCase().trim();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Handle: "today at 3", "tomorrow 2pm", "next monday 10:30am", "in 30 minutes"
  const mInMin = raw.match(/in (\d+)\s*(minute|min|m)s?/);
  if (mInMin) {
    return { when: new Date(Date.now() + parseInt(mInMin[1]) * 60000), whenRaw: raw };
  }
  const mInHr = raw.match(/in (\d+)\s*(hour|hr|h)s?/);
  if (mInHr) {
    return { when: new Date(Date.now() + parseInt(mInHr[1]) * 60 * 60000), whenRaw: raw };
  }

  // Parse time "HH[:MM]am/pm" or "HH[:MM]"
  const tm = raw.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  let hour = 9, minute = 0;
  if (tm) {
    hour = parseInt(tm[1]);
    minute = tm[2] ? parseInt(tm[2]) : 0;
    if (tm[3] === "pm" && hour < 12) hour += 12;
    if (tm[3] === "am" && hour === 12) hour = 0;
  }

  // Day
  const base = new Date(today);
  if (raw.includes("tomorrow")) base.setDate(base.getDate() + 1);
  else if (raw.includes("today")) { /* stay */ }
  else {
    const days = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
    for (let i = 0; i < days.length; i++) {
      if (raw.includes(days[i])) {
        const cur = today.getDay();
        let delta = (i - cur + 7) % 7;
        if (delta === 0) delta = 7;                       // default to next week's occurrence
        if (raw.includes("this")) delta = delta % 7;      // "this monday" = coming monday
        base.setDate(base.getDate() + delta);
        break;
      }
    }
  }
  base.setHours(hour, minute, 0, 0);

  const whenStr = tm || /tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday/i.test(raw)
    ? raw : undefined;
  return { when: tm ? base : undefined, whenRaw: whenStr };
}

function parseIntent(command: string): Intent {
  const c = command.toLowerCase().trim();

  // Schedule: "schedule call with X at Y", "book meeting with X tomorrow 3pm"
  const m = c.match(/(?:schedule|book|set up|add)\s+(?:a\s+)?(?:call|meeting|chat|appointment|time)\s+(?:with\s+)?([^,]+?)(?:\s+(?:at|on|for|this|next|tomorrow|today|in)\s+(.+))?$/i);
  if (m) {
    const whoRaw = m[1]?.trim();
    const whenRaw = m[2]?.trim();
    const parsed = whenRaw ? parseWhen(whenRaw) : { when: undefined, whenRaw: undefined };
    return {
      kind: "schedule",
      title: whoRaw ? `Call with ${whoRaw}` : `Call`,
      whoRaw,
      whenRaw: parsed.whenRaw ?? whenRaw,
      when:   parsed.when,
      durationMin: 30,
    };
  }

  // Reminder
  const rm = c.match(/(?:remind me|reminder)\s+(?:to\s+)?(.+?)(?:\s+(?:at|on|tomorrow|today|in)\s+(.+))?$/i);
  if (rm) {
    const parsed = rm[2] ? parseWhen(rm[2]) : { when: undefined };
    return { kind: "reminder", title: rm[1].trim(), when: parsed.when };
  }

  // Note
  if (/^(?:note|note to self|remember|write down)/i.test(c)) {
    return { kind: "note", body: command.replace(/^(note( to self)?|remember|write down)[:\s,]+/i, "").trim() };
  }

  // Status
  if (/status|how are|what'?s (?:up|new|today)|today'?s numbers|how many deals/i.test(c)) {
    return { kind: "status", subject: c };
  }

  return { kind: "unknown", raw: command };
}

async function handleStatus(sb: ReturnType<typeof createClient>): Promise<string> {
  const { count: dealsToday }  = await sb.from("deals").select("*", { count: "exact", head: true })
    .gte("effective_date", new Date().toISOString().slice(0, 10));
  const { data: dealsMtd } = await sb.from("deals").select("annual_premium")
    .gte("effective_date", new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10));
  const mtdAlp = (dealsMtd as any[] ?? []).reduce((a, r) => a + Number(r.annual_premium || 0), 0);
  const { count: appsOpen } = await sb.from("applications").select("*", { count: "exact", head: true })
    .in("status", ["new", "no_pickup", "reviewing"]);
  return `Today: ${dealsToday ?? 0} deals. Month to date: $${mtdAlp.toLocaleString(undefined, { maximumFractionDigits: 0 })}. Open applications: ${appsOpen ?? 0}.`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  // Auth: bearer matches system_settings.siri_shortcut_token
  const authHeader = req.headers.get("Authorization") ?? "";
  const presented = authHeader.replace(/^Bearer\s+/i, "").trim();
  const { data: tokenRow } = await sb.from("system_settings")
    .select("value").eq("key", "siri_shortcut_token").maybeSingle();
  const expected = (tokenRow as any)?.value;
  if (!expected || presented !== expected) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: { command?: string; source?: string };
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const command = (body.command ?? "").trim();
  if (!command) {
    return new Response(JSON.stringify({ spoken: "I didn't catch that." }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const intent = parseIntent(command);
  let spoken = "";
  let saved: Record<string, unknown> = {};

  switch (intent.kind) {
    case "schedule": {
      const when = intent.when ?? new Date(Date.now() + 60 * 60000);      // default: one hour out
      const endAt = new Date(when.getTime() + (intent.durationMin ?? 30) * 60000);
      const { data: row } = await sb.from("calendar_events" as any).insert({
        title:        intent.title,
        starts_at:    when.toISOString(),
        ends_at:      endAt.toISOString(),
        source:       "siri",
        raw_command:  command,
        status:       "scheduled",
      }).select().maybeSingle();
      saved = { event: row };
      const whenPretty = when.toLocaleString("en-US", {
        timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric",
        hour: "numeric", minute: "2-digit",
      });
      spoken = `Scheduled ${intent.title} for ${whenPretty} Central time.`;
      // Fire email confirmation if we have a default recipient in settings
      const { data: confirmTo } = await sb.from("system_settings" as any)
        .select("value").eq("key", "siri_confirm_email").maybeSingle();
      if ((confirmTo as any)?.value) {
        await sb.functions.invoke("send-email", { body: {
          to: (confirmTo as any).value,
          subject: `📆 ${intent.title}`,
          text: `${whenPretty} CT\n\nCreated via Siri: "${command}"`,
        }}).catch(() => {});
      }
      break;
    }
    case "reminder": {
      const when = intent.when ?? new Date(Date.now() + 30 * 60000);
      await sb.from("calendar_events" as any).insert({
        title:       `Reminder: ${intent.title}`,
        starts_at:   when.toISOString(),
        ends_at:     new Date(when.getTime() + 5 * 60000).toISOString(),
        source:      "siri",
        raw_command: command,
        status:      "reminder",
      });
      spoken = `I'll remind you ${when.toLocaleString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" })} Central to ${intent.title}.`;
      break;
    }
    case "note": {
      await sb.from("notifications").insert({
        title: "Siri note", body: intent.body, type: "note", priority: "low",
      });
      spoken = `Saved.`;
      break;
    }
    case "status": {
      spoken = await handleStatus(sb);
      break;
    }
    default: {
      // Unknown — save to inbox so nothing is lost
      await sb.from("notifications").insert({
        title: "Siri — needs parsing", body: intent.raw, type: "note", priority: "normal",
      });
      spoken = `I saved "${intent.raw}" to your inbox. I don't know how to do that yet.`;
    }
  }

  return new Response(JSON.stringify({ ok: true, spoken, intent, saved }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
