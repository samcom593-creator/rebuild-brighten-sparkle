import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// 2026-08-17: bumped off supabase-js@2.50.0 — esm.sh resolves transitive deps at
// request time, so that pin pinned nothing underneath it and now fails to resolve
// ws's optional native deps (bufferutil / utf-8-validate). The function died at
// BOOT, before the handler, so every call 500d and nothing recorded a reason.
// Measured 2026-08-17: send-notification 903/903 failures in 24h, poke-pusher
// 164/164, metricool-sync 3/3 — zero 200s. 2.90.1 is the version proven booting.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { corsHeaders } from "../_shared/cors.ts";
import { logFunctionError, writeAudit } from "../_shared/audit.ts";
import { checkRateLimit, RateLimitError } from "../_shared/rateLimit.ts";
import { nanpTenDigits } from "../_shared/nanp-phone.ts";
import { requireSendAuth } from "../_shared/require-send-auth.ts";
import {
  classifyCaller,
  escapeHtml,
  isStaffInbox,
  memberRefusal,
} from "../_shared/notify-caller-policy.ts";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ADMIN_EMAIL = "info@kingofsales.net";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

// Asks the caller's own RLS whether this address is on a row they can already
// see. Exact match on the stored value: RecruiterDashboard sends lead.email as
// read. null = could not tell; the caller refuses rather than sends.
async function recipientVisibleToCaller(token: string, email: string): Promise<boolean | null> {
  if (!anonKey || !token) return null;
  const asCaller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  for (const table of ["applications", "aged_leads"]) {
    const { data, error } = await asCaller.from(table).select("id").eq("email", email).limit(1);
    if (error) return null;
    if ((data ?? []).length > 0) return true;
  }
  return false;
}

const CARRIER_GATEWAYS: Record<string, string> = {
  att: "txt.att.net",
  verizon: "vtext.com",
  tmobile: "tmomail.net",
  sprint: "messaging.sprintpcs.com",
  uscellular: "email.uscc.net",
  cricket: "sms.cricketwireless.net",
  metro: "mymetropcs.com",
  boost: "sms.myboostmobile.com",
};

async function logNotification(supabase: any, data: any) {
  try {
    await supabase.from("notification_log").insert({
      recipient_user_id: data.recipient_user_id || null,
      recipient_email: data.recipient_email || null,
      recipient_phone: data.recipient_phone || null,
      channel: data.channel,
      title: data.title,
      message: data.message,
      status: data.status,
      error_message: data.error_message || null,
      metadata: data.metadata || {},
    });
  } catch (e) {
    console.error("Failed to log notification:", e);
  }
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // PL-WIB-SEND-NOTIFICATION-AUTH (2026-10-08). verify_jwt = false and, until
  // this commit, no credential read: a bare POST {} with no Authorization header
  // reached the body validation (400, nothing sent). The caller chose `email`,
  // `title`, `message` (interpolated into the HTML unescaped) and `url`, so anyone
  // could mail any address from notifications@apex-financial.org with a link of
  // their choosing, and text or push any userId on file.
  //
  // Floor is any_authenticated, not admin_or_manager. AgentPipelineSimple
  // (/dashboard/pipeline-simple, any signed-in user) sends agents' manager-switch
  // requests to Sam through here and ignores the result, then toasts "Sam will
  // review it"; an admin floor would drop those with nothing on screen.
  // RecruiterDashboard sits on the same bare route. Service-key callers:
  // system-health-check, applicant_login_send, send_reapply_email_blast.
  //
  // Four pg fns still post here with the anon key and now get a 401:
  // nudge_day2_not_enrolled, nudge_day4_not_enrolled, weekly_xcel_progress_emails,
  // send_completion_contracting_handoff. None is scheduled, triggered or called
  // by another fn, and none has a cron run on record. They were NOT moved to the
  // service key: all four are SECURITY DEFINER with EXECUTE granted to anon, so
  // that move would hand any stranger a one-call mail blast to real applicants.
  // Reviving one means the key move and the anon REVOKE in the same change.
  //
  // PL-WIB-SEND-NOTIFICATION-RECIPIENT (2026-10-09). any_authenticated was not a
  // real floor: signup is open (GoTrue disable_signup=false), so a stranger who
  // confirms an inbox passed it and could still mail any address with raw HTML
  // and a link. Service and admin/manager keep today's behaviour; every other
  // signed-in caller is held to _shared/notify-caller-policy.ts (Sam's inboxes or
  // a person their own RLS shows them, email only, no link, escaped text).
  const auth = await requireSendAuth(req, { floor: "any_authenticated" });
  if (!auth.ok) {
    return json(auth.status, { error: auth.error });
  }

  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  try {
    // Rate limit: 60 req/min per IP (best effort, fails open)
    const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? "unknown";
    await checkRateLimit(supabase, { bucketKey: `send-notification:${ip}`, maxRequests: 60, windowSeconds: 60 });

    const body = await req.json();
    const { userId, title, message, url, email } = body;

    let roles: unknown[] | null = [];
    if (auth.caller !== "service") {
      const uid = (auth.caller ?? "").slice("user:".length);
      const { data: roleRows, error: rolesError } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", uid);
      roles = rolesError ? null : (roleRows ?? []).map((r: { role: unknown }) => r.role);
    }
    const callerClass = classifyCaller(auth.caller, roles);
    if (callerClass === null) {
      return json(503, { error: "sender role unavailable" });
    }
    const escapeText = callerClass === "member";
    if (callerClass === "member") {
      const refusal = memberRefusal(body ?? {});
      if (refusal) return json(refusal.status, { error: refusal.error });
      if (!isStaffInbox(email)) {
        const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
        const visible = await recipientVisibleToCaller(token, email);
        if (visible === null) return json(503, { error: "recipient check unavailable" });
        if (!visible) {
          return json(403, { error: "forbidden: you can only notify people on your own pipeline" });
        }
      }
    }
    const htmlTitle = escapeText ? escapeHtml(title || "Notification") : (title || "Notification");
    const htmlMessage = escapeText ? escapeHtml(message) : message;

    if (!userId && !email) {
      return new Response(
        JSON.stringify({ error: "userId or email is required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const results = { push: false, sms: false, email: false };

    const channelErrors: Record<string, string> = {};

    // Resolve profile info
    let profileData: any = null;
    if (userId) {
      const { data } = await supabase
        .from("profiles")
        .select("email, phone, carrier")
        .eq("user_id", userId)
        .single();
      profileData = data;
    }

    const recipientEmail = email || profileData?.email;
    const logMeta = { url, trigger: "send-notification" };

    // 1. Try push notification
    if (userId) {
      try {
        const pushResponse = await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({ userId, title, body: message, url }),
        });
        const pushResult = await pushResponse.json();
        results.push = pushResult.sent > 0;
        await logNotification(supabase, {
          recipient_user_id: userId,
          recipient_email: recipientEmail,
          channel: "push",
          title: title || "Notification",
          message: message || "",
          status: results.push ? "sent" : "failed",
          error_message: results.push ? null : "No push subscriptions or push failed",
          metadata: logMeta,
        });
      } catch (err: any) {
        console.error("Push notification failed:", err);
        await logNotification(supabase, {
          recipient_user_id: userId,
          recipient_email: recipientEmail,
          channel: "push",
          title: title || "Notification",
          message: message || "",
          status: "failed",
          error_message: err.message,
          metadata: logMeta,
        });
      }
    }

    // 2. Try SMS via email gateway (known carrier)
    if (profileData?.phone && profileData?.carrier) {
      const gateway = CARRIER_GATEWAYS[profileData.carrier];
      if (gateway) {
        // MP-420: `slice(-10)` then `length === 10` is a dead gate --
        // the slice already truncated, so it could only reject numbers
        // that were too SHORT and every international number passed
        // through it addressing a stranger. nanpTenDigits refuses.
        const cleanedPhone = nanpTenDigits(profileData.phone);
        if (cleanedPhone) {
          try {
            const smsEmail = `${cleanedPhone}@${gateway}`;
            await resend.emails.send({
               from: "Galaxy Financial <notifications@apex-financial.org>",
              to: [smsEmail],
              subject: "",
              text: `${title}: ${message}`.substring(0, 160),
            });
            results.sms = true;
            await logNotification(supabase, {
              recipient_user_id: userId,
              recipient_phone: profileData.phone,
              channel: "sms",
              title: title || "Notification",
              message: `${title}: ${message}`.substring(0, 160),
              status: "sent",
              metadata: { ...logMeta, carrier: profileData.carrier, gateway: smsEmail },
            });
          } catch (err: any) {
            console.error("SMS via email failed:", err);
            await logNotification(supabase, {
              recipient_user_id: userId,
              recipient_phone: profileData.phone,
              channel: "sms",
              title: title || "Notification",
              message: `${title}: ${message}`.substring(0, 160),
              status: "failed",
              error_message: err.message,
              metadata: { ...logMeta, carrier: profileData.carrier },
            });
          }
        }
      }
    }

    // 2b. SMS Auto-Detect (unknown carrier, has phone)
    if (!results.sms && profileData?.phone && !profileData?.carrier) {
      try {
        const autoResp = await fetch(`${supabaseUrl}/functions/v1/send-sms-auto-detect`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({
            phone: profileData.phone,
            message: `${title}: ${message}`.substring(0, 160),
          }),
        });
        const autoResult = await autoResp.json();
        if (autoResult.successCount > 0) results.sms = true;
      } catch (err: any) {
        console.error("SMS auto-detect failed:", err);
      }
    }

    // 3. ALWAYS send email if we have a recipient (not just fallback)
    if (recipientEmail) {
      try {
        // MP-269: resend.emails.send() resolves with { data, error } — it does NOT throw
        // on an API error. The old code awaited it, never inspected `error`, and logged
        // status:"sent" unconditionally. Result: 24,806 rows in July marked "sent" while
        // Resend was returning 429 monthly_quota_exceeded on every call. Inspect `error`.
        const { data: sendData, error: sendError } = await resend.emails.send({
          from: "Galaxy Financial <notifications@apex-financial.org>",
          to: [recipientEmail],
          cc: [ADMIN_EMAIL],
          subject: title || "Galaxy Financial Notification",
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #3b82f6;">${htmlTitle}</h2>
              <p>${htmlMessage}</p>
              ${url ? `<p><a href="${url}" style="color: #3b82f6;">View Details →</a></p>` : ""}
              <br/>
              <p style="color: #9ca3af; font-size: 12px;">Powered by Galaxy Financial</p>
            </div>
          `,
        });

        if (sendError) {
          console.error("Email send rejected by provider:", sendError);
          results.email = false;
          // Surface WHY, not just that it failed. Callers cannot tell a
          // transient outage from a permanently invalid recipient out of a bare
          // 500, so they retry both — which is how one refused address absorbed
          // 2,222 send attempts.
          channelErrors.email = sendError.message ?? String(sendError);
          await logNotification(supabase, {
            recipient_user_id: userId,
            recipient_email: recipientEmail,
            channel: "email",
            title: title || "Notification",
            message: message || "",
            status: "failed",
            error_message: sendError.message ?? String(sendError),
            metadata: { ...logMeta, cc: ADMIN_EMAIL, provider: "resend" },
          });
        } else {
          results.email = true;
          await logNotification(supabase, {
            recipient_user_id: userId,
            recipient_email: recipientEmail,
            channel: "email",
            title: title || "Notification",
            message: message || "",
            status: "sent",
            metadata: { ...logMeta, cc: ADMIN_EMAIL, provider: "resend", provider_message_id: sendData?.id ?? null },
          });
        }
      } catch (err: any) {
        console.error("Email send failed:", err);
        channelErrors.email = err?.message ?? String(err);
        await logNotification(supabase, {
          recipient_user_id: userId,
          recipient_email: recipientEmail,
          channel: "email",
          title: title || "Notification",
          message: message || "",
          status: "failed",
          error_message: err.message,
          metadata: logMeta,
        });
      }
    }

    const anyDelivered = results.push || results.sms || results.email;
    console.log(`Notification for ${userId || email}: push=${results.push}, sms=${results.sms}, email=${results.email}, cc=${ADMIN_EMAIL}, anyDelivered=${anyDelivered}`);

    if (!anyDelivered) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "All notification channels failed",
          channels: results,
          // The reason per channel, so a caller can decide whether retrying is
          // even capable of working.
          channelErrors,
        }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    await writeAudit(supabase, {
      action: "notification.sent",
      entityType: "notification",
      entityId: userId ?? email,
      afterData: { channels: results, title },
      requestId,
    });

    return new Response(
      JSON.stringify({ success: true, channels: results, requestId }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    if (error instanceof RateLimitError) {
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded", retryAfter: error.retryAfter }),
        { status: 429, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }
    console.error("Error in send-notification:", error);
    await logFunctionError(supabase, "send-notification", error, undefined, undefined, requestId);
    return new Response(
      JSON.stringify({ error: error.message, requestId }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
