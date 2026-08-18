// gcal-sync — 2026-06-10
// Pulls events from Sam's primary Google Calendar that match scheduled-call
// patterns and upserts them into apex_scheduled_calls. Designed to run on
// pg_cron every 5 minutes.
//
// Sam: "my assistant puts scheduled calls on my Google Calendar. I need a
// flow for that."
//
// Auth: GOOGLE_OAUTH_REFRESH_TOKEN + GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET
// set as Supabase secrets. Re-uses Sam's existing Google OAuth (same one
// the in-session Calendar MCP uses).
//
// Returns:  { synced: N, skipped: M, errors: K }
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// 2026-08-17: bumped off supabase-js@2.50.0 — esm.sh resolves transitive deps at
// request time, so that pin pinned nothing underneath it and now fails to resolve
// ws's optional native deps (bufferutil / utf-8-validate). The function died at
// BOOT, before the handler, so every call 500d and nothing recorded a reason.
// Measured 2026-08-17: send-notification 903/903 failures in 24h, poke-pusher
// 164/164, metricool-sync 3/3 — zero 200s. 2.90.1 is the version proven booting.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_REFRESH_TOKEN = Deno.env.get("GOOGLE_OAUTH_REFRESH_TOKEN") ?? "";
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") ?? "";
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface GCalEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  status?: string;
  attendees?: Array<{ email?: string; responseStatus?: string }>;
  eventType?: string;
}

async function getAccessToken(): Promise<string> {
  if (!GOOGLE_REFRESH_TOKEN || !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new Error("Google OAuth secrets missing");
  }
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  if (!r.ok) throw new Error(`Google token refresh ${r.status}: ${await r.text()}`);
  const data = await r.json();
  return data.access_token;
}

function classify(event: GCalEvent): { call_type: string; isCall: boolean } {
  const text = ((event.summary ?? "") + " " + (event.description ?? "")).toLowerCase();
  if (/licensed\s+prospect\s+call/i.test(event.description ?? "")) {
    return { call_type: "licensed_prospect", isCall: true };
  }
  if (/unlicensed\s+prospect|unlicensed\s+call/i.test(event.description ?? "")) {
    return { call_type: "unlicensed_prospect", isCall: true };
  }
  if (/1[:-]?on[:-]?1|one[\s-]?on[\s-]?one|agent\s+call/i.test(text)) {
    return { call_type: "agent_oneonone", isCall: true };
  }
  if (/follow[\s-]?up\s+call/i.test(text)) {
    return { call_type: "followup", isCall: true };
  }
  if (/team\s+meeting|staff\s+meeting/i.test(text)) {
    return { call_type: "team_meeting", isCall: true };
  }
  // "<First> <Last> and Samuel James" Calendly pattern
  if (/and\s+samuel\s+james/i.test(event.summary ?? "")) {
    return { call_type: "licensed_prospect", isCall: true };
  }
  return { call_type: "unknown", isCall: false };
}

function parseProspectName(summary: string): string | null {
  // Common patterns:
  //   "Francisco Palomares and Samuel James"  → "Francisco Palomares"
  //   "Sam and KJ" / "KJ and Sam"            → null (team meetings)
  const m = summary.match(/^(.+?)\s+(?:and|&)\s+samuel\s+james/i);
  if (m) return m[1].trim();
  return null;
}

function durationMinutes(start: string, end?: string): number | null {
  if (!end) return null;
  return Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000));
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  try {
    const token = await getAccessToken();
    // Pull next 14 days of events
    const timeMin = new Date().toISOString();
    const timeMax = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString();
    const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    url.searchParams.set("timeMin", timeMin);
    url.searchParams.set("timeMax", timeMax);
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("maxResults", "100");

    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`Google Calendar ${r.status}: ${await r.text()}`);
    const data = await r.json();
    const events: GCalEvent[] = data.items ?? [];

    let synced = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const event of events) {
      const start = event.start?.dateTime ?? event.start?.date;
      if (!start) { skipped++; continue; }
      const { call_type, isCall } = classify(event);
      if (!isCall) { skipped++; continue; }

      const prospect = parseProspectName(event.summary ?? "");
      const phone = event.location?.match(/\+?\d[\d\s\-\.()]+/)?.[0]?.replace(/[\s\-\.()]/g, "");

      const row = {
        gcal_event_id: event.id,
        gcal_calendar_id: "primary",
        prospect_name: prospect,
        prospect_phone: phone || null,
        summary: event.summary ?? null,
        description: (event.description ?? "").slice(0, 1000),
        location: event.location ?? null,
        start_at: start,
        end_at: event.end?.dateTime ?? null,
        duration_minutes: durationMinutes(start, event.end?.dateTime),
        call_type,
        status: event.status === "cancelled" ? "cancelled" : "scheduled",
        synced_at: new Date().toISOString(),
      };

      const { error } = await sb
        .from("apex_scheduled_calls")
        .upsert(row, { onConflict: "gcal_event_id" });
      if (error) errors.push(`${event.id}: ${error.message}`);
      else synced++;
    }

    return Response.json(
      { synced, skipped, errors: errors.length, error_details: errors.slice(0, 3), total_events: events.length },
      { status: 200, headers: cors },
    );
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500, headers: cors },
    );
  }
};

serve(handler);
