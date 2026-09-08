// ============================================================================
// RECOVERED MIRROR — NOT THE ORIGINAL SOURCE, AND NOT DEPLOYABLE AS-IS.
//
// slug        : apex-ai-nudge
// prod version: v137   verify_jwt=false
// entrypoint  : apex-ai-nudge/index.ts
// recovered   : 2026-09-08 via scripts/recover-edge-function-source.py
// sha256      : 646f0eb1cd4d2a506ae02a5f6d04808ecb1e5ca0ab51111bdf15dbc8f4166614   (of the recovered bytes below this banner)
//
// This is what the Supabase edge runtime hands back for a DEPLOYED function, which
// is the TRANSPILED module. Measured against check-stale-onboarding, whose real
// source IS in this repo (14032B repo vs 13682B recovered):
//   PRESERVED  comments, string literals, identifiers, control flow, logic
//   LOST       TypeScript types — `interface` blocks vanish, `!` assertions stripped
//   CHANGED    formatting normalised to Deno's emit
//
// So: behaviourally-equivalent JavaScript, NOT the file someone wrote. It lives
// OUTSIDE supabase/functions/ on purpose — deploy-supabase.yml deploys every
// directory under supabase/functions/ (both the deploy-all and deploy-changed
// paths), so putting it there would push this transpilation over live prod the
// moment a working Management PAT exists. For create-va-account / set-va-account
// that is a live auth-level ban/unban path.
//
// To make one of these authoritative: a human reads it, restores the types, moves
// it to supabase/functions/<slug>/index.ts, and pays the slug down in
// scripts/data/deployed-function-orphans.json.
// ============================================================================

/**
 * apex-ai-nudge — auto-licensing follow-ups (B4/E4 from master prompt 207).
 *
 * 2026-06-17 — Sam directive: chase every applicant on a day0 / day3 / day7 /
 * day14 cadence until they're licensed. Idempotent per touch_type +
 * application_id via the unique index on applicant_touchpoints.
 *
 * Fires from pg_cron every 30 minutes; safe to invoke manually.
 */ import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Resend } from "https://esm.sh/resend@2.0.0";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
const supabase = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: {
    persistSession: false
  }
});
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const resend = RESEND_KEY ? new Resend(RESEND_KEY) : null;
const MANYCHAT_TOKEN = Deno.env.get("MANYCHAT_API_TOKEN") ?? "";
// Touchpoint windows. day0 = within 24h of created_at; subsequent at day3/7/14.
const TOUCH_WINDOWS = [
  {
    touch: "day0",
    minHoursOld: 0,
    maxHoursOld: 24
  },
  {
    touch: "day3",
    minHoursOld: 72,
    maxHoursOld: 168
  },
  {
    touch: "day7",
    minHoursOld: 168,
    maxHoursOld: 336
  },
  {
    touch: "day14",
    minHoursOld: 336,
    maxHoursOld: 552
  }
];
const COURSE_URL = "https://apex-financial.org/onboarding-course";
const CALENDLY_URL = "https://calendly.com/samueljameshq/15min";
function copyForTouch(touch, firstName) {
  const name = firstName || "there";
  switch(touch){
    case "day0":
      return {
        subject: "Welcome to APEX — here's your next step",
        html: `<p>Hey ${name},</p><p>You're in. The single thing that decides whether you make it: start the licensing course today.</p><p><a href="${COURSE_URL}" style="display:inline-block;background:#0f172a;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Open the course</a></p><p>30 min of effort today saves you 30 days of regret.</p><p>— Sam</p>`,
        sms: `${name}, welcome to APEX. Start the course today: ${COURSE_URL} — 30 min today saves 30 days of regret. — Sam`
      };
    case "day3":
      return {
        subject: "How's the study going?",
        html: `<p>${name},</p><p>Hitting day 3. How's it going?</p><p>If you've stalled, reply with where you got stuck — I'll help you unstick it.</p><p>Course is here if you've drifted: <a href="${COURSE_URL}">${COURSE_URL}</a></p><p>— Sam</p>`,
        sms: `${name}, day 3 check-in. How's the study going? Reply if you need help. Course: ${COURSE_URL} — Sam`
      };
    case "day7":
      return {
        subject: "Halfway. Here's the exam prep cheat sheet.",
        html: `<p>${name},</p><p>Halfway through the licensing window. If you booked the exam, you're on track. If you haven't, schedule it this week.</p><p>Course: <a href="${COURSE_URL}">${COURSE_URL}</a></p><p>Reply if you want me to walk you through the high-yield sections.</p><p>— Sam</p>`,
        sms: `${name}, halfway through your licensing window. Schedule the exam this week if you haven't. Course: ${COURSE_URL} — Sam`
      };
    case "day14":
      return {
        subject: "Last nudge — need 1:1 time?",
        html: `<p>${name},</p><p>14 days in. If you're not licensed yet, the gap is either a study problem or a life problem — and I can help with both. But only if you reply.</p><p>Book 15 min with me here: <a href="${CALENDLY_URL}">${CALENDLY_URL}</a></p><p>Course: <a href="${COURSE_URL}">${COURSE_URL}</a></p><p>— Sam</p>`,
        sms: `${name}, 14 days in. Need 1:1 time? Book 15 min: ${CALENDLY_URL} — Sam`
      };
    default:
      return {
        subject: "APEX check-in",
        html: `<p>${name}, checking in. — Sam</p>`,
        sms: `${name}, checking in. — Sam`
      };
  }
}
async function processWindow(window) {
  const nowMs = Date.now();
  const minCreated = new Date(nowMs - window.maxHoursOld * 3_600_000).toISOString();
  const maxCreated = new Date(nowMs - window.minHoursOld * 3_600_000).toISOString();
  const { data: rows } = await supabase.from("applications").select("id,first_name,last_name,email,phone,created_at,license_status").gte("created_at", minCreated).lte("created_at", maxCreated).neq("license_status", "licensed").limit(200);
  const applicants = rows ?? [];
  if (applicants.length === 0) {
    return {
      touch: window.touch,
      considered: 0,
      sent: 0,
      skipped: 0,
      errors: []
    };
  }
  // existing touchpoints for these apps + this touch
  const ids = applicants.map((a)=>a.id);
  const { data: existing } = await supabase.from("applicant_touchpoints").select("application_id").eq("touch_type", window.touch).in("application_id", ids);
  const already = new Set((existing ?? []).map((r)=>r.application_id));
  let sent = 0;
  let skipped = 0;
  const errors = [];
  const fromAddr = await loadFromAddress();
  for (const a of applicants){
    if (already.has(a.id)) {
      skipped += 1;
      continue;
    }
    const copy = copyForTouch(window.touch, a.first_name ?? "");
    let okEmail = false;
    let emailErr = null;
    if (resend && a.email) {
      try {
        const r = await resend.emails.send({
          from: fromAddr,
          to: a.email,
          subject: copy.subject,
          html: copy.html
        });
        okEmail = !r.error;
        emailErr = r.error ? JSON.stringify(r.error) : null;
      } catch (e) {
        emailErr = String(e.message ?? e);
      }
    } else if (!a.email) {
      emailErr = "no_email";
    } else {
      emailErr = "resend_unconfigured";
    }
    let okSms = false;
    let smsErr = null;
    if (MANYCHAT_TOKEN && a.phone) {
      // ManyChat SMS via send-content endpoint. If env unset → silent skip.
      // (We don't have a known subscriber_id from phone; this is a best-effort
      // hook for when ManyChat phone→subscriber mapping ships. Until then,
      // record skipped="no_subscriber_lookup" so we know to wire it.)
      smsErr = "manychat_phone_to_subscriber_not_wired";
    } else if (!MANYCHAT_TOKEN) {
      smsErr = "manychat_unconfigured";
    }
    // Record touchpoint regardless — we tried.
    const tpResp = await supabase.from("applicant_touchpoints").insert({
      application_id: a.id,
      touch_type: window.touch,
      channel: okEmail ? "email" : okSms ? "sms" : "email",
      ok: okEmail || okSms,
      meta: {
        email_ok: okEmail,
        email_error: emailErr,
        sms_ok: okSms,
        sms_error: smsErr,
        to_email: a.email,
        to_phone: a.phone
      }
    });
    if (tpResp.error) {
      // unique constraint hit — already sent (race condition). Skip.
      if (tpResp.error.code === "23505") {
        skipped += 1;
        continue;
      }
      errors.push({
        application_id: a.id,
        error: tpResp.error.message
      });
      continue;
    }
    if (okEmail) sent += 1;
    else errors.push({
      application_id: a.id,
      error: emailErr ?? "unknown"
    });
  }
  return {
    touch: window.touch,
    considered: applicants.length,
    sent,
    skipped,
    errors
  };
}
async function loadFromAddress() {
  const { data } = await supabase.from("system_settings").select("value").eq("key", "onboarding_email_from_address").maybeSingle();
  const v = data?.value?.trim();
  return v || "Sam James <noreply@apex-financial.org>";
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response(null, {
    headers: corsHeaders
  });
  const results = [];
  for (const w of TOUCH_WINDOWS){
    try {
      const r = await processWindow(w);
      results.push(r);
    } catch (e) {
      results.push({
        touch: w.touch,
        considered: 0,
        sent: 0,
        skipped: 0,
        errors: [
          {
            application_id: "_",
            error: String(e.message ?? e)
          }
        ]
      });
    }
  }
  const totals = results.reduce((acc, r)=>{
    acc.considered += r.considered;
    acc.sent += r.sent;
    acc.skipped += r.skipped;
    acc.errors += r.errors.length;
    return acc;
  }, {
    considered: 0,
    sent: 0,
    skipped: 0,
    errors: 0
  });
  return new Response(JSON.stringify({
    ok: true,
    totals,
    by_window: results
  }), {
    headers: {
      ...corsHeaders,
      "content-type": "application/json"
    }
  });
});
