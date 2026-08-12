// Durable APEX integration dispatcher.
//
// Claims redacted outbox rows atomically, delivers one destination at a time,
// records every attempt, retries transient failures, and makes unsupported
// Skool posting an explicit manual action instead of reporting false success.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import {
  FAILURE_OVERWRITABLE_STATES,
  readSettingFromResult,
  runContractingDelivery,
} from "../_shared/contracting-delivery.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const CONTACT_FROM = Deno.env.get("APEX_CONTACT_FROM") ?? "APEX Financial <notifications@apex-financial.org>";
const CONTACT_DRY_RUN = Deno.env.get("APEX_CONTACT_DRY_RUN") === "true";
const MAX_ATTEMPTS = 5;

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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

function redactError(value: unknown): string {
  return String(value instanceof Error ? value.message : value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g, "[redacted-phone]")
    .slice(0, 700);
}

type DispatchAuthorization = {
  userId: string | null;
  canDispatchAll: boolean;
};

async function authorize(req: Request, sb: any): Promise<DispatchAuthorization | null> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  if (token === SERVICE_KEY) return { userId: null, canDispatchAll: true };

  const { data, error } = await sb.auth.getUser(token);
  if (error || !data.user) return null;
  const { data: roles } = await sb
    .from("user_roles")
    .select("role")
    .eq("user_id", data.user.id);
  const roleNames = (roles ?? []).map((row: any) => String(row.role));
  const isStaff = roleNames.some((role: string) =>
    ["admin", "super_admin", "owner", "manager", "va_manager", "va"].includes(role)
  );
  if (!isStaff) return null;
  return {
    userId: data.user.id,
    canDispatchAll: roleNames.some((role: string) => ["admin", "super_admin", "owner"].includes(role)),
  };
}

async function callFunction(name: string, body: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${SERVICE_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${name} returned ${response.status}: ${text.slice(0, 300)}`);
  }
  if (text) {
    try {
      const parsed = JSON.parse(text);
      if (parsed?.ok === false || parsed?.error) {
        throw new Error(`${name}: ${parsed.error ?? "reported failure"}`);
      }
    } catch (error) {
      if (error instanceof SyntaxError) return;
      throw error;
    }
  }
}

function normalizePhone(value: unknown): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function resendEmail(payload: Record<string, unknown>, idempotencyKey: string): Promise<string> {
  if (CONTACT_DRY_RUN) return `dry-run:${idempotencyKey}`;
  if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY is not configured");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${RESEND_API_KEY}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify(payload),
  });
  const body = await response.text();
  let parsed: any = null;
  try {
    parsed = body ? JSON.parse(body) : null;
  } catch { // empty-catch-allow:provider-body-may-be-non-json
    // The status and a redacted body excerpt still produce an actionable error.
  }
  if (!response.ok || !parsed?.id) {
    throw new Error(`Resend returned ${response.status}: ${parsed?.message ?? body.slice(0, 250)}`);
  }
  return String(parsed.id);
}

async function logAcceptedContact(sb: any, action: any): Promise<void> {
  if (action.logged_at) return;
  const payload = {
    channel: action.channel,
    outcome: "provider_accepted",
    logged_by: action.requested_by,
    contact_action_id: action.id,
  };
  const result = action.subject_kind === "application"
    ? await sb.from("application_contact_log").insert({
        ...payload,
        application_id: action.application_id,
        notes: `${action.provider ?? "provider"} accepted the request; delivery is unconfirmed`,
      })
    : await sb.from("apex_toolkit_agent_contact_log").insert({
        ...payload,
        toolkit_agent_id: action.toolkit_agent_id,
      });
  if (result.error && result.error.code !== "23505") throw result.error;

  const { error } = await sb
    .from("apex_contact_actions")
    .update({ logged_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", action.id);
  if (error) throw error;
}

async function deliverContact(
  sb: any,
  event: any,
): Promise<{ providerMessageId: string; deliveryConfirmed: false }> {
  const { data: action, error: actionError } = await sb
    .from("apex_contact_actions")
    .select("*")
    .eq("id", event.aggregate_id)
    .single();
  if (actionError || !action) throw new Error(actionError?.message ?? "Contact action not found");

  if (action.provider_message_id) {
    const { error: receiptStateError } = await sb
      .from("apex_contact_actions")
      .update({
        status: "provider_accepted",
        delivery_confirmed: false,
        last_error_redacted: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", action.id);
    if (receiptStateError) throw receiptStateError;
    await logAcceptedContact(sb, action);
    return { providerMessageId: action.provider_message_id, deliveryConfirmed: false };
  }

  let recipient = "";
  let carrier: string | null = null;
  if (action.subject_kind === "application") {
    const { data: application, error } = await sb
      .from("applications")
      .select("email, phone, carrier, phone_bad_at, sms_consent_given")
      .eq("id", action.application_id)
      .single();
    if (error || !application) throw new Error(error?.message ?? "Application no longer exists");
    recipient = action.channel === "email"
      ? String(application.email ?? "").trim().toLowerCase()
      : normalizePhone(application.phone);
    carrier = String(application.carrier ?? "").trim().toLowerCase() || null;
    if (action.channel === "sms" && application.phone_bad_at) throw new Error("Phone is marked bad");
    if (action.channel === "sms" && application.sms_consent_given !== true) {
      throw new Error("SMS consent is no longer recorded");
    }
  } else {
    const { data: addedAgent, error } = await sb
      .from("apex_toolkit_agents")
      .select("email, phone, sms_opted_out_at, email_opted_out_at, status")
      .eq("id", action.toolkit_agent_id)
      .single();
    if (error || !addedAgent || addedAgent.status !== "active") {
      throw new Error(error?.message ?? "Added agent is no longer active");
    }
    recipient = action.channel === "email"
      ? String(addedAgent.email ?? "").trim().toLowerCase()
      : normalizePhone(addedAgent.phone);
    if (action.channel === "email" && addedAgent.email_opted_out_at) throw new Error("Email opt-out recorded");
    if (action.channel === "sms" && addedAgent.sms_opted_out_at) throw new Error("SMS opt-out recorded");
  }

  const queuedRecipient = action.channel === "email"
    ? String(action.recipient_address).trim().toLowerCase()
    : normalizePhone(action.recipient_address);
  if (!recipient || recipient !== queuedRecipient) {
    throw new Error("Recipient changed after confirmation; create a new contact action");
  }

  if (action.channel === "email") {
    const { data: unsubscribe, error } = await sb
      .from("email_unsubscribes")
      .select("id")
      .ilike("email", recipient)
      .maybeSingle();
    if (error) throw error;
    if (unsubscribe) throw new Error("Email opt-out recorded");
  }

  let providerMessageId: string;
  if (action.channel === "email") {
    providerMessageId = await resendEmail({
      from: CONTACT_FROM,
      to: [recipient],
      subject: action.subject,
      html: `<div style="font-family:Arial,sans-serif;white-space:normal;line-height:1.55">${escapeHtml(String(action.message)).replaceAll("\n", "<br>")}</div>`,
      text: action.message,
    }, `apex-contact-${action.id}`);
  } else if (action.channel === "sms") {
    const gateway = carrier ? CARRIER_GATEWAYS[carrier] : null;
    if (!gateway) throw new Error("No verified carrier gateway is available");
    providerMessageId = await resendEmail({
      from: CONTACT_FROM,
      to: [`${recipient}@${gateway}`],
      subject: "",
      text: String(action.message).slice(0, 160),
    }, `apex-contact-${action.id}`);
  } else {
    throw new Error(`Unsupported contact channel: ${action.channel}`);
  }

  const acceptedAt = new Date().toISOString();
  const { error: updateError } = await sb
    .from("apex_contact_actions")
    .update({
      status: "provider_accepted",
      provider_message_id: providerMessageId,
      provider_accepted_at: acceptedAt,
      delivery_confirmed: false,
      last_error_redacted: null,
      updated_at: acceptedAt,
    })
    .eq("id", action.id);
  if (updateError) throw updateError;

  await logAcceptedContact(sb, { ...action, provider_message_id: providerMessageId });
  return { providerMessageId, deliveryConfirmed: false };
}

async function deliverDiscord(sb: any, event: any): Promise<void> {
  const { data: deal, error } = await sb
    .from("deals")
    .select("id, agent_id, carrier_id, product_sold, face_amount, annualized_commissionable_premium, annual_premium, community_caption")
    .eq("id", event.aggregate_id)
    .single();
  if (error || !deal) throw new Error(error?.message ?? "Deal no longer exists");

  const [{ data: agent }, { data: carrier }] = await Promise.all([
    sb
      .from("agents")
      .select("display_name, profile:profiles(full_name, instagram_handle, avatar_url)")
      .eq("id", deal.agent_id)
      .maybeSingle(),
    deal.carrier_id
      ? sb.from("carriers").select("name").eq("id", deal.carrier_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const profile = Array.isArray((agent as any)?.profile)
    ? (agent as any).profile[0]
    : (agent as any)?.profile;
  const agentName = profile?.full_name ?? (agent as any)?.display_name ?? "APEX agent";

  await callFunction("discord-webhook-notify", {
    event_type: "deal_closed",
    details: {
      deal_id: deal.id,
      agent_id: deal.agent_id,
      agent_name: agentName,
      instagram_handle: profile?.instagram_handle ?? null,
      photo_url: profile?.avatar_url ?? null,
      carrier: (carrier as any)?.name ?? null,
      product_type: deal.product_sold,
      face_amount: deal.face_amount,
      aop: deal.annualized_commissionable_premium ?? deal.annual_premium,
      caption: deal.community_caption ?? null,
    },
  });
}

async function skoolCapability(sb: any): Promise<"supported" | "not_configured" | "unsupported"> {
  const { data } = await sb
    .from("integration_capabilities")
    .select("support_state, integration_accounts!inner(provider, status)")
    .eq("capability", "create_post")
    .eq("integration_accounts.provider", "skool")
    .limit(1)
    .maybeSingle();
  return (data?.support_state as "supported" | "not_configured" | "unsupported" | undefined) ?? "not_configured";
}

type DispatchResult = {
  state: "delivered" | "manual_action_required";
  providerMessageId?: string;
  deliveryConfirmed?: boolean;
};

// ── Contracting intake destinations ──────────────────────────────────────────
//
// The decisions live in _shared/contracting-delivery.ts so the vitest suite can
// drive the SAME functions against stubbed providers. This wrapper supplies the
// real database and network dependencies and records the settled verdict.

async function readSetting(sb: any, key: string): Promise<string | null> {
  // Throws on a query error. A swallowed error here would report a database
  // outage as "no webhook configured", and not_configured is terminal.
  const result = await sb.from("system_settings").select("value").eq("key", key).maybeSingle();
  return readSettingFromResult(result, key);
}

async function deliverContractingIntake(sb: any, event: any): Promise<DispatchResult> {
  const intakeId = event.aggregate_id;
  const destination = event.destination;

  const patchDelivery = async (patch: Record<string, unknown>) => {
    const { error } = await sb
      .from("contracting_intake_deliveries")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("intake_id", intakeId)
      .eq("destination", destination);
    if (error) throw error;
  };

  const result = await runContractingDelivery(destination, intakeId, {
    readSetting: (key) => readSetting(sb, key),
    loadIntake: async (id) => {
      const { data, error } = await sb
        .from("contracting_intakes")
        .select("id, first_name, last_name, email, phone_e164, npn, status")
        .eq("id", id)
        .single();
      if (error || !data) throw new Error(error?.message ?? "Contracting intake no longer exists");
      return data;
    },
    sendEmail: (payload, idempotencyKey) =>
      resendEmail({ from: CONTACT_FROM, ...payload }, idempotencyKey),
    fetchImpl: fetch,
    googleCredential: Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON") || null,
    now: () => Date.now(),

    currentState: async () => {
      const { data, error } = await sb
        .from("contracting_intake_deliveries")
        .select("state")
        .eq("intake_id", intakeId)
        .eq("destination", destination)
        .maybeSingle();
      if (error) throw error;
      return String(data?.state ?? "queued");
    },
    markAttempting: () => patchDelivery({ state: "attempting", last_error_redacted: null }),
    clearAttempting: () => patchDelivery({ state: "queued" }),
    markUnknownOutcome: (note) => patchDelivery({ state: "unknown_outcome", last_error_redacted: note }),
    settle: async (outcome) => {
      const patch: Record<string, unknown> = {
        state: outcome.state,
        last_error_redacted: outcome.note,
      };
      if (outcome.state === "accepted") {
        patch.receipt = outcome.receipt;
        patch.accepted_at = new Date().toISOString();
      }
      if (outcome.state === "delivered") {
        patch.receipt = outcome.receipt;
        patch.delivered_at = new Date().toISOString();
      }
      await patchDelivery(patch);
    },
  });

  // manual_action_required covers not_configured, manual_review and
  // unknown_outcome. All three are terminal on purpose: none of them is a
  // failure the machine can fix by trying again, and unknown_outcome
  // specifically must never be auto-retried.
  if (result.verdict === "manual_action_required") return { state: "manual_action_required" };
  return {
    state: "delivered",
    providerMessageId: result.providerMessageId,
    deliveryConfirmed: result.state === "delivered",
  };
}

async function dispatch(sb: any, event: any): Promise<DispatchResult> {
  if (event.aggregate_type === "contracting_intake") {
    return await deliverContractingIntake(sb, event);
  }
  if (event.destination === "review") return { state: "delivered" };
  if (event.destination === "discord") {
    await deliverDiscord(sb, event);
    return { state: "delivered" };
  }
  if (event.destination === "insuracloud") {
    await callFunction("insuracloud-outbox", { deal_id: event.aggregate_id });
    return { state: "delivered" };
  }
  if (event.destination === "contact_email" || event.destination === "contact_sms") {
    const receipt = await deliverContact(sb, event);
    return { state: "delivered", ...receipt };
  }
  if (event.destination === "file_scan") {
    // Evidence remains private and pending until an approved malware scanner
    // is configured. Never promote an unscanned object or pretend it is clean.
    return { state: "manual_action_required" };
  }
  if (event.destination === "skool") {
    const capability = await skoolCapability(sb);
    if (capability !== "supported") return { state: "manual_action_required" };
    // There is no verified general-purpose Skool post endpoint configured in
    // this repository. Capability discovery may later say supported, but the
    // dispatcher still refuses to invent an endpoint or scrape private UI.
    return { state: "manual_action_required" };
  }
  throw new Error(`Unsupported destination: ${event.destination ?? "none"}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ ok: false, error: "Server configuration missing" }, 503);

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const authorization = await authorize(req, sb);
  if (!authorization) return json({ ok: false, error: "Unauthorized" }, 401);

  let requestedLimit = 20;
  let contactActionId: string | null = null;
  try {
    const body = await req.json();
    requestedLimit = Number(body?.limit ?? 20);
    contactActionId = typeof body?.contactActionId === "string" ? body.contactActionId : null;
  } catch { // empty-catch-allow:empty-cron-body
    // Empty body is valid for cron invocation.
  }
  const limit = Math.max(1, Math.min(Number.isFinite(requestedLimit) ? requestedLimit : 20, 100));

  if (!authorization.canDispatchAll) {
    if (!contactActionId || !authorization.userId) {
      return json({ ok: false, error: "A contact action ID is required" }, 403);
    }
    const { data: ownedAction, error: ownedActionError } = await sb
      .from("apex_contact_actions")
      .select("id")
      .eq("id", contactActionId)
      .eq("requested_by", authorization.userId)
      .maybeSingle();
    if (ownedActionError || !ownedAction) {
      return json({ ok: false, error: "Contact action access denied" }, 403);
    }
  }

  const claim = contactActionId
    ? await sb.rpc("claim_apex_contact_action_event", { p_action_id: contactActionId })
    : await sb.rpc("claim_apex_outbox_events", { p_limit: limit });
  const { data: claimed, error: claimError } = claim;
  if (claimError) return json({ ok: false, error: redactError(claimError) }, 500);

  const summary = {
    claimed: claimed?.length ?? 0,
    delivered: 0,
    manual: 0,
    retried: 0,
    deadLettered: 0,
    persistenceFailures: 0,
  };
  const receipts: Array<Record<string, unknown>> = [];

  for (const event of claimed ?? []) {
    const attemptNumber = Number(event.attempts);
    const { data: attempt, error: attemptError } = await sb
      .from("delivery_attempts")
      .insert({
        outbox_event_id: event.id,
        attempt_number: attemptNumber,
        status: "started",
      })
      .select("id")
      .single();

    try {
      if (attemptError || !attempt) throw new Error(attemptError?.message ?? "Delivery attempt could not be recorded");
      if (event.aggregate_type === "contact_action") {
        const { error: processingError } = await sb.from("apex_contact_actions").update({
          status: "processing",
          updated_at: new Date().toISOString(),
        }).eq("id", event.aggregate_id);
        if (processingError) throw processingError;
      }
      const result = await dispatch(sb, event);
      if (result.state === "manual_action_required") {
        const { error: manualError } = await sb.from("outbox_events").update({
          status: "manual_action_required",
          processed_at: new Date().toISOString(),
          locked_at: null,
          last_error_redacted: "Provider write capability is unavailable; operator action required.",
        }).eq("id", event.id);
        if (manualError) throw manualError;
      } else {
        const { error: deliveredError } = await sb.from("outbox_events").update({
          status: "delivered",
          processed_at: new Date().toISOString(),
          locked_at: null,
          last_error_redacted: null,
        }).eq("id", event.id);
        if (deliveredError) throw deliveredError;
      }
      if (attempt.id) {
        const { error: attemptUpdateError } = await sb.from("delivery_attempts").update({
          status: "delivered",
          finished_at: new Date().toISOString(),
        }).eq("id", attempt.id);
        if (attemptUpdateError) throw attemptUpdateError;
      }
      if (result.state === "manual_action_required") summary.manual += 1;
      else summary.delivered += 1;
      if (event.aggregate_type === "contact_action") {
        receipts.push({
          actionId: event.aggregate_id,
          status: result.state === "delivered" ? "provider_accepted" : result.state,
          providerMessageId: result.providerMessageId ?? null,
          deliveryConfirmed: result.deliveryConfirmed ?? false,
        });
      }
    } catch (error) {
      const message = redactError(error);
      const exhausted = attemptNumber >= MAX_ATTEMPTS;
      const retryAt = new Date(Date.now() + Math.min(60, 2 ** attemptNumber) * 60_000).toISOString();
      const persistenceErrors: string[] = [];
      const { error: outboxFailureError } = await sb.from("outbox_events").update({
        status: exhausted ? "dead_letter" : "failed",
        available_at: retryAt,
        locked_at: null,
        last_error_redacted: message,
      }).eq("id", event.id);
      if (outboxFailureError) persistenceErrors.push(redactError(outboxFailureError));
      if (event.aggregate_type === "contracting_intake") {
        // Keep the per-destination verdict in step with the outbox. Without
        // this the delivery row would sit at 'queued' forever while the outbox
        // dead-lettered, and the contracting page would show a producer as
        // waiting when in fact nothing is coming.
        // Scoped to states this handler is allowed to overwrite. 'attempting'
        // and 'unknown_outcome' are excluded: overwriting either with 'failed'
        // would erase the marker that stops a non-idempotent destination being
        // posted twice, and the next tick would repost.
        const { error: contractingFailureError } = await sb
          .from("contracting_intake_deliveries")
          .update({
            state: exhausted ? "dead_letter" : "failed",
            last_error_redacted: message,
            updated_at: new Date().toISOString(),
          })
          .eq("intake_id", event.aggregate_id)
          .eq("destination", event.destination)
          .in("state", [...FAILURE_OVERWRITABLE_STATES]);
        if (contractingFailureError) persistenceErrors.push(redactError(contractingFailureError));
      }
      if (event.aggregate_type === "contact_action") {
        const { error: actionFailureError } = await sb.from("apex_contact_actions").update({
          status: exhausted ? "dead_letter" : "retrying",
          last_error_redacted: message,
          updated_at: new Date().toISOString(),
        }).eq("id", event.aggregate_id);
        if (actionFailureError) persistenceErrors.push(redactError(actionFailureError));
      }
      if (attempt?.id) {
        const { error: attemptFailureError } = await sb.from("delivery_attempts").update({
          status: exhausted ? "permanent_failure" : "retryable_failure",
          error_redacted: message,
          finished_at: new Date().toISOString(),
        }).eq("id", attempt.id);
        if (attemptFailureError) persistenceErrors.push(redactError(attemptFailureError));
      }
      if (exhausted) {
        const { error: deadLetterError } = await sb.from("dead_letter_events").upsert({
          outbox_event_id: event.id,
          reason: message,
          operator_action: "Inspect the redacted error, validate connector configuration, then retry the failed destination only.",
        }, { onConflict: "outbox_event_id" });
        if (deadLetterError) persistenceErrors.push(redactError(deadLetterError));
      }
      if (persistenceErrors.length) {
        summary.persistenceFailures += 1;
        console.error("[apex-outbox-dispatcher] state persistence failed", persistenceErrors);
      } else if (exhausted) {
        summary.deadLettered += 1;
      } else {
        summary.retried += 1;
      }
      if (event.aggregate_type === "contact_action") {
        receipts.push({
          actionId: event.aggregate_id,
          status: persistenceErrors.length
            ? "state_persistence_failed"
            : exhausted ? "dead_letter" : "retrying",
          error: persistenceErrors.length
            ? "The provider failed and the retry state could not be fully recorded."
            : message,
          deliveryConfirmed: false,
        });
      }
    }
  }

  return json({ ok: summary.persistenceFailures === 0, ...summary, receipts });
});
