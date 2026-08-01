// calendly-backfill — MP-264 reconciliation (2026-07-24)
//
// WHY THIS EXISTS
//   Webhooks get missed. The 2026-06/07 outage lost 105 bookings and stayed
//   invisible for six weeks because "no rows arrived" and "quiet week" look
//   identical from inside the database. A poller that reconciles against
//   Calendly's own record is the only thing that makes capture honest — this
//   function alone would have caught all 105 on day one.
//
//   Runs on a 6-hour cron. Idempotent: upserts on calendly_event_uri, so
//   re-running is free and safe.
//
// AUTH
//   Requires the CALENDLY_API_TOKEN secret (a Calendly Personal Access Token).
//   If it is unset this function returns 503 and writes nothing — it does NOT
//   return a cheerful 200 having reconciled zero events. Reporting success
//   while doing nothing is the exact bug this whole workstream exists to kill.
//
//   NOTE (2026-07-24): the token is not yet set. Minting a Calendly PAT
//   requires passing an MFA challenge (POST /api/integrations/personal_access_tokens
//   returns {"type":"mfa_required"}), which is a second-factor boundary on
//   Sam's own device and is not something to route around. Everything else is
//   built and deployed; this starts reconciling the moment the secret lands.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CALENDLY_TOKEN = Deno.env.get("CALENDLY_API_TOKEN") ?? "";

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

async function cal(pathOrUrl: string): Promise<any> {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `https://api.calendly.com${pathOrUrl}`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${CALENDLY_TOKEN}`, "Content-Type": "application/json" },
  });
  if (!r.ok) throw new Error(`Calendly ${r.status} on ${url}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

/** Both live booking forms ask for Instagram, just under different labels. */
function extractInstagram(qa: any[]): string | null {
  for (const q of qa ?? []) {
    if (/instagram|ig handle/i.test(String(q?.question ?? ""))) {
      const a = String(q?.answer ?? "").trim().replace(/^(https?:\/\/)?(www\.)?instagram\.com\//i, "").replace(/\/+$/, "").replace(/^@+/, "");
      if (a) return a;
    }
  }
  return null;
}

function extractAnswer(qa: any[], needle: RegExp): string | null {
  for (const q of qa ?? []) {
    if (needle.test(String(q?.question ?? ""))) {
      const a = String(q?.answer ?? "").trim();
      if (a) return a;
    }
  }
  return null;
}

const PLACEHOLDER_EMAILS = new Set(["name@noname.com", "noname@noname.com", "test@test.com", "none@none.com", "n/a@gmail.com"]);
const cleanEmail = (e: string | null | undefined) => {
  const v = (e ?? "").trim().toLowerCase();
  return !v || PLACEHOLDER_EMAILS.has(v) ? null : v;
};

function classify(name: string | null, slug: string | null): string {
  const t = `${name ?? ""} ${slug ?? ""}`.toLowerCase().trim();
  if (t.includes("seminar")) return "seminar";
  if (t.includes("exam") || t.includes("test")) return "exam";
  // "unlicensed" CONTAINS "licensed" — must check first (bug fixed 2026-08-01)
  if (t.includes("unlicensed")) return "leader";
  if (t.includes("licensed")) return "licensed";
  if (t.includes("leader")) return "leader";
  if (/interview|1on1|prospect|manager/.test(t)) return "leader";
  return "other";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  if (!CALENDLY_TOKEN) {
    // Fail loud. Never a 200 that reconciled nothing.
    return json({
      ok: false,
      error: "CALENDLY_API_TOKEN not set",
      detail:
        "Reconciliation cannot run without a Calendly Personal Access Token. " +
        "Minting one requires clearing Calendly's MFA challenge. Set the secret " +
        "and this begins reconciling on the next 6-hour tick.",
    }, 503);
  }

  const url = new URL(req.url);
  const sinceParam = url.searchParams.get("since");
  const since = sinceParam
    ? new Date(sinceParam)
    : new Date(Date.now() - 90 * 24 * 3600 * 1000);
  const until = new Date(Date.now() + 60 * 24 * 3600 * 1000);

  try {
    const me = await cal("/users/me");
    const userUri: string = me?.resource?.uri;
    if (!userUri) throw new Error("could not resolve current user uri");

    let next: string | null =
      `/scheduled_events?user=${encodeURIComponent(userUri)}` +
      `&min_start_time=${since.toISOString()}&max_start_time=${until.toISOString()}` +
      `&count=100&sort=start_time:asc`;

    let seen = 0, upserted = 0, failed = 0;
    const errors: string[] = [];

    while (next) {
      const page: any = await cal(next);
      for (const ev of page?.collection ?? []) {
        seen++;
        try {
          const uuid = String(ev.uri).split("/").pop();
          const inv: any = await cal(`/scheduled_events/${uuid}/invitees?count=100`);
          const i = inv?.collection?.[0] ?? {};
          const qa = i?.questions_and_answers ?? [];

          const instagram = extractInstagram(qa);
          const email = cleanEmail(i?.email);
          const phone =
            i?.text_reminder_number ?? ev?.location?.location ?? null;

          const { data: match } = await sb.rpc("resolve_application_for_invitee", {
            p_email: email, p_phone: phone, p_instagram: instagram,
          });
          const applicationId = Array.isArray(match) && match.length ? match[0]?.application_id ?? null : null;
          const matchMethod = Array.isArray(match) && match.length ? match[0]?.match_method ?? "none" : "none";

          const { error } = await sb.from("interview_events").upsert({
            source: "calendly",
            calendly_event_uri: ev.uri,
            calendly_invitee_uri: i?.uri ?? null,
            event_type_name: ev.name ?? null,
            call_track: classify(ev.name ?? null, ev?.event_type?.slug ?? null),
            application_id: applicationId,
            match_method: matchMethod,
            invitee_name: (i?.name ?? "").trim() || null,
            invitee_email: email,
            invitee_phone: phone,
            instagram_handle: instagram,
            invitee_status: extractAnswer(qa, /status/i),
            prep_notes: extractAnswer(qa, /prepare|anything else|share anything/i),
            scheduled_at: ev.start_time,
            ended_at: ev.end_time ?? null,
            canceled_at: ev.status === "canceled" ? (ev?.cancellation?.created_at ?? new Date().toISOString()) : null,
            cancel_reason: ev?.cancellation?.reason ?? null,
            reschedule_url: i?.reschedule_url ?? null,
            cancel_url: i?.cancel_url ?? null,
            was_rescheduled: Boolean(i?.old_invitee),
          }, { onConflict: "calendly_event_uri" });

          if (error) { failed++; if (errors.length < 5) errors.push(error.message); }
          else upserted++;
        } catch (e) {
          failed++;
          if (errors.length < 5) errors.push((e as Error).message);
        }
      }
      next = page?.pagination?.next_page ?? null;
    }

    // Any failure at all is reported as a non-2xx so the cron surfaces it.
    const ok = failed === 0;
    return json({ ok, seen, upserted, failed, errors, since: since.toISOString() }, ok ? 200 : 500);
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
