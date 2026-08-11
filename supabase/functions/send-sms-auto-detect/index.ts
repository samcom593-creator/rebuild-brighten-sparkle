import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// MP-273: this said @2.50.0, and that pin is why the function was DEAD in prod.
// esm.sh resolves TRANSITIVE deps at request time, so pinning supabase-js pinned
// nothing underneath it: ws@8.21.3 shipped a build that throws at import
// ("Cannot destructure property 'URL' of null"), which killed this worker at boot.
// Every call answered WORKER_ERROR -- before the handler, so not even the honest
// "skipped" log row was written. Verified by deploying the pre-edit file and
// invoking it: identical WORKER_ERROR, so the crash predates this wave's changes.
// @2 boots clean and is the exact specifier ics-feed uses, which is serving 200s.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ADMIN_EMAIL = "sam@apex-financial.org";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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


function cleanPhone(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function logNotification(supabase: any, data: any) {
  try {
    await supabase.from("notification_log").insert(data);
  } catch (e) {
    console.error("Log failed:", e);
  }
}

type Caller = { service: boolean; userId: string | null; roles: string[] };

async function authenticateCaller(req: Request, supabase: any): Promise<Caller | null> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  if (token === serviceRoleKey) return { service: true, userId: null, roles: ["service_role"] };
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  const { data: roleRows, error: roleError } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", data.user.id);
  if (roleError) return null;
  return {
    service: false,
    userId: data.user.id,
    roles: (roleRows ?? []).map((row: any) => String(row.role)),
  };
}

async function callerCanWorkLead(supabase: any, caller: Caller, lead: any): Promise<boolean> {
  if (caller.service) return true;
  if (caller.roles.some((role) => ["admin", "super_admin", "owner", "va", "va_manager"].includes(role))) {
    return true;
  }
  if (!caller.userId) return false;
  if (lead.hiring_manager_user_id === caller.userId) return true;
  const { data: ownAgents, error } = await supabase
    .from("agents")
    .select("id")
    .eq("user_id", caller.userId);
  if (error) return false;
  const ownIds = new Set((ownAgents ?? []).map((agent: any) => String(agent.id)));
  return [lead.assigned_agent_id, lead.assigned_manager_id, lead.referral_manager_id, lead.recruiter_id]
    .some((id) => id && ownIds.has(String(id)));
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });
    const caller = await authenticateCaller(req, supabase);
    if (!caller) {
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } },
      );
    }

    const { phone: requestedPhone, to, message, applicationId, agedLeadId } = await req.json();
    let phone = requestedPhone || to;

    if (!phone || !message) {
      return new Response(
        JSON.stringify({ error: "phone and message are required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    if (typeof message !== "string" || !message.trim() || message.length > 160) {
      return new Response(
        JSON.stringify({ success: false, error: "message must contain 1 to 160 characters" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } },
      );
    }

    let scopedLead: any = null;
    if (applicationId) {
      const { data, error } = await supabase
        .from("applications")
        .select("phone, carrier, phone_bad_at, sms_consent_given, hiring_manager_user_id, assigned_agent_id, referral_manager_id, recruiter_id")
        .eq("id", applicationId)
        .single();
      if (error || !data) {
        return new Response(JSON.stringify({ success: false, error: "Application not found" }), {
          status: 404, headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }
      scopedLead = data;
      if (!(await callerCanWorkLead(supabase, caller, data))) {
        return new Response(JSON.stringify({ success: false, error: "Forbidden" }), {
          status: 403, headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }
      if (data.phone_bad_at) {
        return new Response(JSON.stringify({ success: false, error: "Phone is marked bad" }), {
          status: 409, headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }
      if (!caller.service && data.sms_consent_given !== true) {
        return new Response(JSON.stringify({ success: false, error: "SMS consent is not recorded" }), {
          status: 409, headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }
      phone = data.phone;
    } else if (agedLeadId) {
      const { data, error } = await supabase.from("aged_leads").select("*").eq("id", agedLeadId).single();
      if (error || !data) {
        return new Response(JSON.stringify({ success: false, error: "Lead not found" }), {
          status: 404, headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }
      scopedLead = data;
      if (!(await callerCanWorkLead(supabase, caller, data))) {
        return new Response(JSON.stringify({ success: false, error: "Forbidden" }), {
          status: 403, headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }
      if (data.phone_bad_at) {
        return new Response(JSON.stringify({ success: false, error: "Phone is marked bad" }), {
          status: 409, headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }
      phone = data.phone;
    } else if (!caller.service && !caller.roles.some((role) => ["admin", "super_admin", "owner", "va", "va_manager"].includes(role))) {
      return new Response(JSON.stringify({ success: false, error: "A scoped lead id is required" }), {
        status: 403, headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const cleaned = cleanPhone(String(phone));
    if (cleaned.length !== 10) {
      return new Response(
        JSON.stringify({ error: "Invalid phone number — must be 10 digits" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      return new Response(JSON.stringify({ success: false, error: "SMS provider is not configured" }), {
        status: 503, headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
    const resend = new Resend(resendKey);

    const results: { carrier: string; success: boolean; error?: string }[] = [];
    let successCount = 0;
    const carrierSuccesses: string[] = [];
    const carrierFailures: string[] = [];

    // MP-270: this loop used to fan every single SMS out to ALL 8 carrier gateways.
    // A phone belongs to exactly one carrier, so 7 of the 8 were guaranteed waste --
    // 8 Resend sends per SMS, ~32k sends/month, which is what exhausted the 50k
    // monthly quota and silently killed new-application notifications for 38 days.
    //
    // It also could not learn its way out. Resend accepts any well-formed address,
    // so every gateway reported success: 19,498 of 19,522 logged rows show all 8
    // "succeeding". The carrier bounce happens later and asynchronously and never
    // comes back here, so successCount never carried any delivery information.
    //
    // New rule: send to ONE gateway when the carrier is actually known. When it is
    // not known, send nothing and say so, so the caller can fall back to a channel
    // that reports real delivery. Do not guess by broadcasting.
    let knownCarrier: string | null = null;
    // MP-273: why the carrier lookup lost carriers that were on file.
    //
    // This was .maybeSingle(). For a GET, postgrest-js returns the rows as an array
    // and then, if there is more than one, sets data=null with a PGRST116 error
    // (PostgrestBuilder.js:101-112). The caller destructured { data } only and threw
    // the error away, so "two profile rows share this phone" was indistinguishable
    // from "this phone has no carrier" -- and the second reading is the one that won.
    //
    // Sam's own number is the case in point: two profiles rows, BOTH saying tmobile,
    // so the answer was never ambiguous. Every alert SMS to him took the no-carrier
    // branch and sent nothing while bot_alerts recorded "sent".
    //
    // Resolve across every matching row instead: if the carriers agree, use it; if
    // they genuinely disagree, say which ones and send nothing. Never discard the error.
    let carrierLookupError: string | null = null;
    let carrierConflict: string[] | null = null;

    const phoneVariants = Array.from(new Set([phone, cleaned].filter(Boolean)));
    const { data: profileRows, error: profileErr } = await supabase
      .from("profiles")
      .select("carrier")
      .in("phone", phoneVariants)
      .not("carrier", "is", null);

    if (profileErr) {
      carrierLookupError = profileErr.message ?? String(profileErr);
    } else {
      const distinct = Array.from(
        new Set(
          (profileRows ?? [])
            .map((r: any) => String(r.carrier ?? "").toLowerCase().trim())
            .filter((c: string) => c.length > 0),
        ),
      );
      if (distinct.length === 1) knownCarrier = distinct[0];
      else if (distinct.length > 1) carrierConflict = distinct;
    }

    if (!knownCarrier && scopedLead?.carrier) {
      knownCarrier = String(scopedLead.carrier).toLowerCase();
    }

    const noCarrierReason = (): string =>
      carrierConflict
        ? `conflicting carriers on file (${carrierConflict.join(", ")}) — not guessing`
        : carrierLookupError
          ? `carrier lookup failed: ${carrierLookupError}`
          : "no carrier on file — not broadcasting";

    if (knownCarrier && !CARRIER_GATEWAYS[knownCarrier]) {
      results.push({ carrier: knownCarrier, success: false, error: "unrecognized carrier value" });
      knownCarrier = null;
    }

    if (knownCarrier) {
      await delay(500);
      const smsEmail = `${cleaned}@${CARRIER_GATEWAYS[knownCarrier]}`;
      try {
        const { error: sendError } = await resend.emails.send({
          from: "Apex Financial <notifications@apex-financial.org>",
          to: [smsEmail],
          subject: "",
          text: message.substring(0, 160),
        });
        const success = !sendError;
        results.push({ carrier: knownCarrier, success, error: sendError?.message });
        if (success) {
          successCount++;
          carrierSuccesses.push(knownCarrier);
        } else {
          carrierFailures.push(knownCarrier);
        }
      } catch (err: any) {
        results.push({ carrier: knownCarrier, success: false, error: err.message });
        carrierFailures.push(knownCarrier);
      }
    } else {
      // No carrier resolved. Previously this was the 96% case that triggered the
      // 8-gateway broadcast. Report it honestly instead of burning quota on a guess.
      // MP-273: "we looked and found nothing" and "the lookup itself failed" are
      // different problems with different fixes, so they no longer share one string.
      results.push({ carrier: "unknown", success: false, error: noCarrierReason() });
    }

    // ONE consolidated notification_log row per outbound SMS.
    // MP-270: status now distinguishes "we had no carrier and sent nothing" from
    // "we sent to the right gateway and the provider rejected it". The old code
    // collapsed both into failed with a message about 8 gateways that no longer
    // reflects what this function does.
    const outcome = knownCarrier
      ? (successCount > 0 ? "sent" : "failed")
      : "skipped";

    await logNotification(supabase, {
      recipient_phone: phone,
      channel: "sms-auto",
      title: "SMS Auto-Detect",
      message: message.substring(0, 160),
      status: outcome,
      error_message: outcome === "sent"
        ? null
        : (knownCarrier
            ? `Carrier gateway ${knownCarrier} rejected: ${results[results.length - 1]?.error ?? "unknown"}`
            : `SMS not attempted, use another channel — ${noCarrierReason()}`),
      metadata: {
        trigger: "sms-auto-detect",
        gatewaysAttempted: knownCarrier ? 1 : 0,
        carrierResolved: knownCarrier,
        // MP-273: keep the reason the carrier could not be resolved, so a future
        // reader can tell a duplicate-row collision from a genuinely blank field.
        carrierConflict,
        carrierLookupError,
        carrierSuccesses,
        carrierFailures,
        attempts: results,
        // Gateway acceptance is not delivery. The carrier bounce is asynchronous
        // and never reaches this function, so never read "sent" here as "arrived".
        deliveryConfirmed: false,
        applicationId: applicationId || null,
        agedLeadId: agedLeadId || null,
      },
    });

    // MP-270: only persist a carrier we actually resolved from stored data.
    // The old code sorted carrierSuccesses by CARRIER_PRIORITY and saved the winner,
    // but since all 8 gateways always "succeeded" that reduced to writing "att"
    // onto essentially every record it touched.
    let carrierSelected: string | null = null;

    if (knownCarrier && carrierSuccesses.length > 0) {
      carrierSelected = knownCarrier;

      if (applicationId && carrierSelected) {
        try {
          const { data: app } = await supabase
            .from("applications")
            .select("carrier")
            .eq("id", applicationId)
            .maybeSingle();

          if (app && !app.carrier) {
            await supabase
              .from("applications")
              .update({ carrier: carrierSelected })
              .eq("id", applicationId);
            console.log(`Auto-saved carrier "${carrierSelected}" for application ${applicationId}`);
          }
        } catch (err: any) {
          console.error("Failed to auto-save carrier:", err.message);
        }
      }
    }

    // MP-270: this admin copy was ungated, so it fired on every attempt including
    // the ~96% with no carrier on file. Combined with the 8-gateway broadcast that
    // made 9 Resend sends per single SMS. Only copy admin when a send actually went out.
    if (outcome === "sent") {
      try {
        await resend.emails.send({
          from: "Apex Financial <notifications@apex-financial.org>",
          to: [ADMIN_EMAIL],
          subject: `[SMS Copy] To: ${phone}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h3 style="color: #3b82f6;">SMS Auto-Detect Copy</h3>
              <p><strong>To:</strong> ${phone}</p>
              <p><strong>Carrier gateway used:</strong> ${carrierSelected || "unknown"}</p>
              <p style="color:#b45309;"><strong>Note:</strong> the gateway accepted this message. Carrier delivery is not confirmed.</p>
              <div style="background: #f3f4f6; padding: 12px; border-radius: 8px; margin: 12px 0;">
                <p style="margin: 0;">"${message.substring(0, 160)}"</p>
              </div>
              <p style="color: #9ca3af; font-size: 12px;">Powered by Apex Financial</p>
            </div>
          `,
        });
      } catch (e) {
        console.error("Failed to send admin SMS copy email:", e);
      }
    }

    console.log(`SMS auto-detect for ${phone}: outcome=${outcome}, carrier=${carrierSelected || "none"}, gatewaysAttempted=${knownCarrier ? 1 : 0}`);

    return new Response(
      JSON.stringify({
        success: successCount > 0,
        // MP-270: callers should branch on this. "skipped" means no carrier was on
        // file and nothing was sent, so fall back to email/Telegram rather than
        // treating the person as contacted.
        outcome,
        deliveryConfirmed: false,
        phone,
        attempts: results,
        successCount,
        totalAttempts: knownCarrier ? 1 : 0,
        carrierSelected,
        carrierSuccesses,
        carrierFailures,
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in send-sms-auto-detect:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
