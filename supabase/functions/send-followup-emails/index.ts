import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { SPAM_NOTE_HTML } from "../_shared/spam-note.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { gateResend } from "../_shared/resend-gate.ts";
import { SCHEDULING_LINKS } from "../_shared/apex.ts";
import { requireSendAuth } from "../_shared/require-send-auth.ts";
import { safeEqual } from "../_shared/send-floor.ts";
import { DEPARTED_AGENT_COLUMNS, isBannedUser, isDepartedAgent } from "../_shared/departed.ts";
import { parseWp3Cutoff } from "../_shared/wp3-cutoff.ts";

// PL-WIB-DIGEST-GATE (2026-10-25). verify_jwt is false and this handler read no
// credential, so any POST ran the applicant drip. The followup_*_sent_at stamps
// keep it from mailing anyone twice, but the drip should run on its schedule,
// not on a stranger's. Callers that exist: pg_cron job 108 (apex_bot_token
// bearer). Service key and admin/manager JWT stay open for a manual run.
const BOT_TOKEN = (Deno.env.get("APEX_BOT_TOKEN") ?? "").trim();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const resendApiKey = Deno.env.get("RESEND_API_KEY");

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

const resend = resendApiKey ? gateResend(new Resend(resendApiKey)) : null;

// WP3 (2026-11-10): a send counts only with a Resend message id. The SDK and the
// resend-gate RETURN {data: null, error} on a refusal (suppressed, non-routable,
// API error) instead of throwing, so `await send()` succeeding proved nothing and
// every drip below used to stamp 'sent' on refusals too.
function messageIdOf(response: unknown): string | null {
  const r = response as { data?: { id?: unknown } | null; error?: unknown } | null;
  if (!r || r.error) return null;
  const id = r.data?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

// WP3 forward-only gate: the day-1 and day-3 nudges reach only people who applied
// after system_settings.wp3_recruit_sla_cutoff. Missing/garbled setting = send nothing.
async function readNudgeCutoff(): Promise<string | null> {
  const { data, error } = await supabaseAdmin.from("system_settings")
    .select("value").eq("key", "wp3_recruit_sla_cutoff").maybeSingle();
  if (error || !data?.value) return null;
  const ms = parseWp3Cutoff(data.value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

const ADMIN_EMAIL = "info@kingofsales.net";

// Calendly URLs
const UNLICENSED_CALENDLY = SCHEDULING_LINKS.unlicensed;
const LICENSED_CALENDLY = SCHEDULING_LINKS.licensed;

async function getManagerEmailForApp(appId: string): Promise<string | null> {
  try {
    // Get the assigned agent for this application
    const { data: app } = await supabaseAdmin.from("applications").select("assigned_agent_id").eq("id", appId).single();
    if (!app?.assigned_agent_id) return null;
    const { data: agent } = await supabaseAdmin.from("agents").select("user_id, invited_by_manager_id").eq("id", app.assigned_agent_id).single();
    if (!agent) return null;
    // The inviting manager first, then the assigned agent. A departed agent (terminated or
    // deactivated) or a banned login is skipped, never CC'd: the 2026-08-17 departure
    // migration left invited_by_manager_id pointing at the departed manager on purpose
    // (historical attribution), so the check has to happen here, at send time.
    const candidates = [agent.invited_by_manager_id, app.assigned_agent_id].filter(Boolean) as string[];
    for (const managerId of candidates) {
      const { data: manager } = await supabaseAdmin.from("agents").select(DEPARTED_AGENT_COLUMNS).eq("id", managerId).single();
      if (!manager?.user_id || isDepartedAgent(manager)) continue;
      const { data: authData } = await supabaseAdmin.auth.admin.getUserById(manager.user_id);
      const user = authData?.user;
      if (!user?.email || isBannedUser(user)) continue;
      return user.email;
    }
    return null;
  } catch (e) {
    console.error("Error resolving manager email for app:", e);
    return null;
  }
}

// Send unlicensed follow-up (3 days after application)
async function sendUnlicensedFollowup(app: {
  id: string;
  first_name: string;
  email: string;
}): Promise<string | null> {
  if (!resend) {
    console.log("Resend not configured, skipping unlicensed followup for application:", app.id);
    return null;
  }

  try {
    // Resolve manager email for CC
    const managerEmail = await getManagerEmailForApp(app.id);
    const ccList = [ADMIN_EMAIL, managerEmail].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i) as string[];

    const response = await resend.emails.send({
       from: "Galaxy Financial <notifications@apex-financial.org>",
      to: [app.email],
      cc: ccList.length > 0 ? ccList : undefined,
      subject: "Need Help Getting Licensed? We're Here For You! 📋",
      html: `${SPAM_NOTE_HTML}
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #f59e0b, #d97706); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 26px;">Having Trouble Getting Licensed?</h1>
          </div>
          
          <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
            <h2 style="color: #111827; margin-top: 0;">Hey ${app.first_name}! 👋</h2>
            
            <p style="color: #4b5563; line-height: 1.6; font-size: 16px;">
              We noticed you submitted your application a few days ago and wanted to check in. 
              <strong>Getting your insurance license can feel overwhelming</strong> — but don't worry, we're here to help!
            </p>

            <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px 20px; margin: 20px 0; border-radius: 0 8px 8px 0;">
              <p style="margin: 0; color: #92400e; font-weight: 500;">
                🎓 You're not alone in this process. We walk every new agent through licensing step by step.
              </p>
            </div>

            <p style="color: #4b5563; line-height: 1.6; font-size: 16px;">
              If you're stuck or have questions about:
            </p>
            
            <ul style="color: #4b5563; line-height: 1.8; font-size: 15px;">
              <li>The pre-licensing course</li>
              <li>Exam preparation</li>
              <li>State requirements</li>
              <li>Scheduling your exam</li>
              <li>Or anything else...</li>
            </ul>

            <p style="color: #4b5563; line-height: 1.6; font-size: 16px; font-weight: 600;">
              Book a quick call with us and we'll walk you through everything step-by-step!
            </p>
            
            <div style="text-align: center; margin: 30px 0;">
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto;">
                <tr>
                  <td align="center" bgcolor="#059669" style="border-radius:8px;">
                    <a href="${UNLICENSED_CALENDLY}" style="display:inline-block;color:#ffffff;padding:16px 32px;text-decoration:none;font-weight:bold;font-size:16px;">
                      📞 Schedule a Licensing Help Call
                    </a>
                  </td>
                </tr>
              </table>
            </div>

            <div style="background: white; padding: 20px; border-radius: 8px; border: 1px solid #e5e7eb; margin-top: 25px;">
              <h3 style="color: #111827; margin-top: 0; margin-bottom: 15px; font-size: 16px;">Quick Resources:</h3>
              <ul style="color: #4b5563; margin: 0; padding-left: 20px; line-height: 1.8;">
                <li><a href="https://apex-financial.org/get-licensed#licensing-video" style="color: #059669;">Watch: How to Get Your Life Insurance License</a></li>
                <li><a href="https://docs.google.com/document/d/1WBN_bh7Tl6IkhdXwQvrUa6Q58xmV9As_q048aKAeyNg/edit" style="color: #059669;">Licensing Step-by-Step Guide</a></li>
                <li><a href="https://partners.xcelsolutions.com/afe" style="color: #059669;">Start Pre-Licensing Course</a></li>
              </ul>
            </div>

            <p style="color: #9ca3af; font-size: 13px; text-align: center; margin-top: 25px;">
              We believe in you! The license is just the first step to an incredible career.
            </p>
          </div>
        </div>
      `,
    });

    const id = messageIdOf(response);
    if (!id) console.error("Unlicensed followup refused for application:", app.id, (response as any)?.error?.name ?? "no message id");
    return id;
  } catch (error) {
    console.error("Failed to send unlicensed followup for application:", app.id, error);
    return null;
  }
}

// Send second unlicensed follow-up (7 days after application - "Are you licensed yet?")
async function sendUnlicensedFollowup2(app: {
  id: string;
  first_name: string;
  email: string;
}): Promise<string | null> {
  if (!resend) {
    console.log("Resend not configured, skipping second unlicensed followup for application:", app.id);
    return null;
  }

  try {
    const managerEmail2 = await getManagerEmailForApp(app.id);
    const ccList2 = [ADMIN_EMAIL, managerEmail2].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i) as string[];
    const response = await resend.emails.send({
       from: "Galaxy Financial <notifications@apex-financial.org>",
      to: [app.email],
      cc: ccList2.length > 0 ? ccList2 : undefined,
      subject: "Are You Licensed Yet? 🎓",
      html: `${SPAM_NOTE_HTML}
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #059669, #047857); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 26px;">How's It Coming Along?</h1>
          </div>
          
          <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
            <h2 style="color: #111827; margin-top: 0;">Hey ${app.first_name}! 👋</h2>
            
            <p style="color: #4b5563; line-height: 1.6; font-size: 16px;">
              It's been about a week since you applied to join Galaxy Financial. We wanted to check in and see how your licensing journey is going!
            </p>

            <div style="background: #d1fae5; border-left: 4px solid #059669; padding: 15px 20px; margin: 20px 0; border-radius: 0 8px 8px 0;">
              <p style="margin: 0; color: #047857; font-weight: 600; font-size: 18px;">
                🎓 Are you licensed yet?
              </p>
            </div>

            <p style="color: #4b5563; line-height: 1.6; font-size: 16px;">
              If you've completed your licensing, <strong>congratulations!</strong> Let's get you started right away. Book your onboarding call below:
            </p>
            
            <div style="text-align: center; margin: 25px 0;">
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto;">
                <tr>
                  <td align="center" bgcolor="#059669" style="border-radius:8px;">
                    <a href="${LICENSED_CALENDLY}" style="display:inline-block;color:#ffffff;padding:16px 32px;text-decoration:none;font-weight:bold;font-size:16px;">
                      📅 I'm Licensed - Schedule My Call!
                    </a>
                  </td>
                </tr>
              </table>
            </div>

            <div style="border-top: 1px solid #e5e7eb; margin: 25px 0; padding-top: 25px;">
              <p style="color: #4b5563; line-height: 1.6; font-size: 16px;">
                <strong>Still working on it?</strong> No worries! Here are your resources again:
              </p>
              
              <ul style="color: #4b5563; line-height: 2; font-size: 15px; margin: 15px 0;">
                <li><a href="https://apex-financial.org/get-licensed#licensing-video" style="color: #059669; font-weight: 500;">▶️ Watch: How to Get Your Life Insurance License</a></li>
                <li><a href="https://docs.google.com/document/d/1WBN_bh7Tl6IkhdXwQvrUa6Q58xmV9As_q048aKAeyNg/edit" style="color: #059669; font-weight: 500;">📄 Licensing Step-by-Step Guide</a></li>
                <li><a href="https://partners.xcelsolutions.com/afe" style="color: #059669; font-weight: 500;">📚 Start/Continue Pre-Licensing Course</a></li>
              </ul>
            </div>

            <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px 20px; margin: 20px 0; border-radius: 0 8px 8px 0;">
              <p style="margin: 0; color: #92400e; font-weight: 500;">
                💡 Need help? Schedule a quick call and we'll walk you through the process step-by-step!
              </p>
            </div>
            
            <div style="text-align: center; margin: 25px 0;">
              <a href="${UNLICENSED_CALENDLY}" 
                 style="display: inline-block; background: #f59e0b; color: white; 
                         padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 14px; max-width:100%; box-sizing:border-box;">
                 📞 I Need Help Getting Licensed
              </a>
            </div>

            <p style="color: #9ca3af; font-size: 13px; text-align: center; margin-top: 25px;">
              We're here to support you every step of the way!
            </p>
          </div>
        </div>
      `,
    });

    const id = messageIdOf(response);
    if (!id) console.error("Second unlicensed followup refused for application:", app.id, (response as any)?.error?.name ?? "no message id");
    return id;
  } catch (error) {
    console.error("Failed to send second unlicensed followup for application:", app.id, error);
    return null;
  }
}

// Send licensed follow-up (3-4 days after application if not contacted)
async function sendLicensedFollowup(app: {
  id: string;
  first_name: string;
  email: string;
}): Promise<string | null> {
  if (!resend) {
    console.log("Resend not configured, skipping licensed followup for application:", app.id);
    return null;
  }

  try {
    const managerEmail3 = await getManagerEmailForApp(app.id);
    const ccList3 = [ADMIN_EMAIL, managerEmail3].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i) as string[];
    const response = await resend.emails.send({
      from: "Galaxy Financial <notifications@apex-financial.org>",
      to: [app.email],
      cc: ccList3.length > 0 ? ccList3 : undefined,
      subject: "Did We Get to You Yet? Let's Connect! 🚀",
      html: `${SPAM_NOTE_HTML}
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #059669, #047857); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 26px;">We Haven't Forgotten About You!</h1>
          </div>
          
          <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
            <h2 style="color: #111827; margin-top: 0;">Hi ${app.first_name}! 👋</h2>
            
            <p style="color: #4b5563; line-height: 1.6; font-size: 16px;">
              We wanted to follow up on your application. If you haven't had a chance to speak with our team yet, 
              <strong>now is the perfect time to schedule your onboarding call!</strong>
            </p>

            <div style="background: #d1fae5; border-left: 4px solid #059669; padding: 15px 20px; margin: 20px 0; border-radius: 0 8px 8px 0;">
              <p style="margin: 0; color: #047857; font-weight: 500;">
                ⚡ As a licensed agent, you're ready to start earning immediately. Don't let this opportunity slip by!
              </p>
            </div>

            <p style="color: #4b5563; line-height: 1.6; font-size: 16px;">
              On your onboarding call, we'll cover:
            </p>
            
            <ul style="color: #4b5563; line-height: 1.8; font-size: 15px;">
              <li>Your personalized fast-track to production</li>
              <li>Our proven sales systems and training</li>
              <li>Commission structures and earning potential</li>
              <li>Getting you contracted and ready to sell</li>
            </ul>
            
            <div style="text-align: center; margin: 30px 0;">
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto;">
                <tr>
                  <td align="center" bgcolor="#dc2626" style="border-radius:8px;">
                    <a href="${LICENSED_CALENDLY}" style="display:inline-block;color:#ffffff;padding:16px 32px;text-decoration:none;font-weight:bold;font-size:16px;">
                      📅 Schedule Your Call NOW
                    </a>
                  </td>
                </tr>
              </table>
            </div>

            <div style="background: #fef2f2; border: 1px solid #fecaca; padding: 15px 20px; border-radius: 8px; margin-top: 20px;">
              <p style="margin: 0; color: #991b1b; font-size: 14px; text-align: center;">
                <strong>Spots fill up fast!</strong> Our top performers started exactly where you are right now.
              </p>
            </div>

            <p style="color: #9ca3af; font-size: 13px; text-align: center; margin-top: 25px;">
              Run with the Standard. We're glad you're here.
            </p>
          </div>
        </div>
      `,
    });

    const id = messageIdOf(response);
    if (!id) console.error("Licensed followup refused for application:", app.id, (response as any)?.error?.name ?? "no message id");
    return id;
  } catch (error) {
    console.error("Failed to send licensed followup for application:", app.id, error);
    return null;
  }
}

// WP3 day-1 nudge (moved here from fn_run_applicant_nudges, which 401'd since
// 2026-09-06 and stamped 'sent' anyway). No reply-to-this promise (nobody is
// confirmed to read notifications@), no cost claim (Sam's N1), no manager-call
// promise, and the link carries the application id, never the email address.
async function sendDay1Nudge(app: { id: string; first_name: string | null; email: string }): Promise<string | null> {
  if (!resend) {
    console.log("Resend not configured, skipping day-1 nudge for application:", app.id);
    return null;
  }
  const first = (app.first_name ?? "").trim().split(/\s+/)[0] || "there";
  const nextStep = `https://apex-financial.org/get-licensed?applicationId=${encodeURIComponent(app.id)}`;
  try {
    const response = await resend.emails.send({
      from: "Galaxy Financial <notifications@apex-financial.org>",
      to: [app.email],
      subject: `${first}, your next step with Galaxy`,
      html: `${SPAM_NOTE_HTML}
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #111827;">
          <p style="font-size: 16px; line-height: 1.6;">${first},</p>
          <p style="font-size: 16px; line-height: 1.6;">You applied to Galaxy Financial yesterday. The next step is your license, and your page shows exactly where you are and what comes next.</p>
          <p style="text-align: center; margin: 28px 0;">
            <a href="${nextStep}" style="display:inline-block;background:#111827;color:#ffffff;padding:14px 28px;text-decoration:none;font-weight:bold;border-radius:8px;">Open my next step</a>
          </p>
          <p style="font-size: 16px; line-height: 1.6;">Questions before you start? Book a quick call: <a href="${UNLICENSED_CALENDLY}">pick a time</a>.</p>
          <p style="font-size: 16px; line-height: 1.6;">Sam<br/>Galaxy Financial</p>
        </div>
      `,
    });
    const id = messageIdOf(response);
    if (!id) console.error("Day-1 nudge refused for application:", app.id, (response as any)?.error?.name ?? "no message id");
    return id;
  } catch (error) {
    console.error("Failed to send day-1 nudge for application:", app.id, error);
    return null;
  }
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const isBot = BOT_TOKEN !== "" && bearer !== "" && safeEqual(bearer, BOT_TOKEN);
  if (!isBot) {
    const auth = await requireSendAuth(req);
    if (!auth.ok) {
      return new Response(JSON.stringify({ error: auth.error ?? "unauthorized" }), {
        status: auth.status,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
  }

  try {
    console.log("Starting follow-up email check...");

    // Calculate the date range for 3 days ago (give or take a few hours)
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const threeDaysAgoStart = new Date(threeDaysAgo);
    threeDaysAgoStart.setHours(0, 0, 0, 0);
    const threeDaysAgoEnd = new Date(threeDaysAgo);
    threeDaysAgoEnd.setHours(23, 59, 59, 999);

    // For licensed, also check 4 days ago
    const fourDaysAgo = new Date();
    fourDaysAgo.setDate(fourDaysAgo.getDate() - 4);
    const fourDaysAgoStart = new Date(fourDaysAgo);
    fourDaysAgoStart.setHours(0, 0, 0, 0);

    // For second unlicensed followup, check 7 days ago
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoStart = new Date(sevenDaysAgo);
    sevenDaysAgoStart.setHours(0, 0, 0, 0);
    const sevenDaysAgoEnd = new Date(sevenDaysAgo);
    sevenDaysAgoEnd.setHours(23, 59, 59, 999);

    console.log("Checking for unlicensed apps from:", threeDaysAgoStart.toISOString(), "to", threeDaysAgoEnd.toISOString());
    console.log("Checking for licensed apps from:", fourDaysAgoStart.toISOString(), "to", threeDaysAgoEnd.toISOString());
    console.log("Checking for second unlicensed followup from:", sevenDaysAgoStart.toISOString(), "to", sevenDaysAgoEnd.toISOString());

    const nudgeCutoff = await readNudgeCutoff();
    const nowMs = Date.now();
    const day1From = new Date(nowMs - 48 * 3600_000).toISOString();
    const day1To = new Date(nowMs - 24 * 3600_000).toISOString();

    // WP3 day-1 nudge: unlicensed/pending, 24-48h after applying, not on the course yet,
    // created after the forward-only cutoff. Same truth rules as every drip below.
    const { data: day1Apps, error: day1Error } = nudgeCutoff
      ? await supabaseAdmin
        .from("applications")
        .select("id, first_name, email")
        .in("license_status", ["unlicensed", "pending"])
        .is("day1_nudge_sent_at", null)
        .is("course_purchased_at", null)
        .is("closed_at", null)
        .is("terminated_at", null)
        .eq("record_type", "application")
        .or("is_duplicate.is.null,is_duplicate.eq.false")
        .is("do_not_contact_at", null)
        .or("email_consent_given.is.null,email_consent_given.eq.true")
        .not("email", "is", null)
        .gte("created_at", nudgeCutoff)
        .gte("created_at", day1From)
        .lte("created_at", day1To)
        .limit(50)
      : { data: [] as Array<{ id: string; first_name: string | null; email: string }>, error: null };
    if (day1Error) console.error("Error fetching day-1 apps:", day1Error);

    // Find unlicensed applicants from exactly 3 days ago who haven't received followup
    // 2026-10-28: every drip below follows the Call list's truth rules
    // (src/lib/recruitingQueues.ts): only live, non-duplicate applications; never anyone
    // under do-not-contact or without email consent. The licensed drip also skips anyone
    // a recruiter already reached (a recorded outcome or last_contacted_at), which it
    // used to judge from the legacy contacted_at column that is never read.
    const { data: unlicensedApps, error: unlicensedError } = await supabaseAdmin
      .from("applications")
      .select("id, first_name, email")
      .in("license_status", ["unlicensed", "pending"])
      .is("followup_sent_at", null)
      .is("closed_at", null)
      .is("terminated_at", null)
      .eq("record_type", "application")
      .or("is_duplicate.is.null,is_duplicate.eq.false")
      .is("do_not_contact_at", null)
      .or("email_consent_given.is.null,email_consent_given.eq.true")
      // 2026-09-07: day 3-4 window (was exact-day) so one missed run cannot skip a cohort; followup_sent_at keeps it idempotent.
      .gte("created_at", fourDaysAgoStart.toISOString())
      .lte("created_at", threeDaysAgoEnd.toISOString())
      // WP3: this day-3 email is the day-3 nudge. It was structurally suppressed for
      // months by fn_run_applicant_nudges' fake day-1 stamp; it now reaches only
      // people who applied after the cutoff, never the old backlog.
      .gte("created_at", nudgeCutoff ?? "9999-12-31T00:00:00Z");

    if (unlicensedError) {
      console.error("Error fetching unlicensed apps:", unlicensedError);
    }

    // Find unlicensed applicants from 7 days ago for second followup ("Are you licensed yet?")
    const { data: unlicensedApps2, error: unlicensedError2 } = await supabaseAdmin
      .from("applications")
      .select("id, first_name, email")
      .in("license_status", ["unlicensed", "pending"])
      .not("followup_sent_at", "is", null) // Must have received first followup
      .is("followup_unlicensed_2_sent_at", null)
      .is("closed_at", null)
      .is("terminated_at", null)
      .eq("record_type", "application")
      .or("is_duplicate.is.null,is_duplicate.eq.false")
      .is("do_not_contact_at", null)
      .or("email_consent_given.is.null,email_consent_given.eq.true")
      .gte("created_at", new Date(sevenDaysAgoStart.getTime() - 86_400_000).toISOString()) // day 7-8 window, same reason
      .lte("created_at", sevenDaysAgoEnd.toISOString());

    if (unlicensedError2) {
      console.error("Error fetching second unlicensed apps:", unlicensedError2);
    }

    // Find licensed applicants from 3-4 days ago nobody has reached yet and who haven't received followup
    const { data: licensedApps, error: licensedError } = await supabaseAdmin
      .from("applications")
      .select("id, first_name, email")
      .eq("license_status", "licensed")
      .is("followup_licensed_sent_at", null)
      .is("last_contact_outcome_at", null)
      .is("last_contacted_at", null)
      .is("closed_at", null)
      .is("terminated_at", null)
      .eq("record_type", "application")
      .or("is_duplicate.is.null,is_duplicate.eq.false")
      .is("do_not_contact_at", null)
      .or("email_consent_given.is.null,email_consent_given.eq.true")
      .gte("created_at", fourDaysAgoStart.toISOString())
      .lte("created_at", threeDaysAgoEnd.toISOString());

    if (licensedError) {
      console.error("Error fetching licensed apps:", licensedError);
    }

    console.log("Found unlicensed apps for followup:", unlicensedApps?.length || 0);
    console.log("Found unlicensed apps for second followup:", unlicensedApps2?.length || 0);
    console.log("Found licensed apps for followup:", licensedApps?.length || 0);

    let day1Sent = 0;
    let unlicensedSent = 0;
    let unlicensed2Sent = 0;
    let licensedSent = 0;

    // WP3 day-1 nudges: stamp day1_nudge_sent_at only with a Resend message id.
    for (const app of day1Apps || []) {
      if (!app.email) continue;
      const messageId = await sendDay1Nudge(app as { id: string; first_name: string | null; email: string });
      if (messageId) {
        const { error: stampErr } = await supabaseAdmin
          .from("applications")
          .update({ day1_nudge_sent_at: new Date().toISOString() })
          .eq("id", app.id);
        if (stampErr) console.error("day-1 stamp failed for application:", app.id, stampErr.message);
        day1Sent++;
      }
    }

    // Send unlicensed follow-ups (first - 3 days) = the day-3 nudge
    for (const app of unlicensedApps || []) {
      const messageId = await sendUnlicensedFollowup(app);
      if (messageId) {
        // Mark as sent: followup_sent_at keeps the day-7 chain; day3_nudge_sent_at is the receipt column.
        const stampAt = new Date().toISOString();
        await supabaseAdmin
          .from("applications")
          .update({ followup_sent_at: stampAt, day3_nudge_sent_at: stampAt })
          .eq("id", app.id);
        unlicensedSent++;
      }
    }

    // Send second unlicensed follow-ups (7 days - "Are you licensed yet?")
    for (const app of unlicensedApps2 || []) {
      const messageId = await sendUnlicensedFollowup2(app);
      if (messageId) {
        // Mark as sent
        await supabaseAdmin
          .from("applications")
          .update({ followup_unlicensed_2_sent_at: new Date().toISOString() })
          .eq("id", app.id);
        unlicensed2Sent++;
      }
    }

    // Send licensed follow-ups
    for (const app of licensedApps || []) {
      const messageId = await sendLicensedFollowup(app);
      if (messageId) {
        // Mark as sent
        await supabaseAdmin
          .from("applications")
          .update({ followup_licensed_sent_at: new Date().toISOString() })
          .eq("id", app.id);
        licensedSent++;
      }
    }

    const result = {
      success: true,
      day1Checked: day1Apps?.length || 0,
      day1Sent,
      nudgeCutoff,
      unlicensedChecked: unlicensedApps?.length || 0,
      unlicensedSent,
      unlicensed2Checked: unlicensedApps2?.length || 0,
      unlicensed2Sent,
      licensedChecked: licensedApps?.length || 0,
      licensedSent,
      timestamp: new Date().toISOString(),
    };

    console.log("Follow-up email job completed:", result);

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Error in send-followup-emails:", errorMessage);
    
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
