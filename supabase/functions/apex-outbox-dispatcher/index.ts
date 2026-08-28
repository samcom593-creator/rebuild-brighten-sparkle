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
import { emailPattern } from "../_shared/like-escape.ts";
import { resolveOne } from "../_shared/resolve-one.ts";
import { renderSlackEventText } from "./slack-event-templates.ts";

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

// MP-312: returns the parsed response body so a caller can branch on WHAT the
// callee did, not merely on whether it threw. Existing void callers are
// unaffected. Non-2xx and an explicit { ok: false } / { error } still throw —
// that contract is load-bearing for every other destination.
async function callFunction(
  name: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
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
      return parsed as Record<string, unknown>;
    } catch (error) {
      if (error instanceof SyntaxError) return null;
      throw error;
    }
  }
  return null;
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
    // email_unsubscribes.email IS uniquely indexed, so two opt-out rows for one
    // address are impossible — the hazard here was purely the pattern match.
    // Unescaped, an address containing "_" matched a DIFFERENT person's opt-out
    // and blocked legitimate mail; an address containing "%" matched every row.
    // Measured 2026-08-12: the table holds 1 row and 0 collisions, so this is a
    // structural fix with no live impact. Not dressing it up as a CAN-SPAM save.
    const optOut = await resolveOne<{ id: string }>(
      sb.from("email_unsubscribes").select("id").ilike("email", emailPattern(recipient)),
      { label: `email_unsubscribes.email=${recipient}` },
    );
    if (optOut.row) throw new Error("Email opt-out recorded");
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

async function deliverApplicationSlackInvite(sb: any, event: any): Promise<DispatchResult> {
  // Workspace access is a hired-agent benefit, never an applicant funnel step.
  // The database trigger that used to enqueue application invitations is
  // removed by 20260826150000; this guard makes old/manual rows fail closed.
  if (event.aggregate_type !== "agent") {
    return {
      state: "manual_action_required",
      manualReason: "Applicant Slack invitations are disabled; only verified active hired agents are eligible",
    };
  }

  const setting = await resolveOne<{ value: string }>(
    sb.from("system_settings").select("value").eq("key", "slack_community_invite_url"),
    { label: "system_settings.slack_community_invite_url" },
  );
  const inviteUrl = String(setting.row?.value ?? "").trim();
  if (!inviteUrl.startsWith("https://join.slack.com/")) {
    return { state: "manual_action_required", manualReason: "Slack community invite URL is not configured" };
  }

  const { data: eligibility, error: eligibilityError } = await sb
    .from("v_slack_invite_eligibility")
    .select("agent_id, full_name, email, eligibility_status, is_eligible")
    .eq("agent_id", event.aggregate_id)
    .maybeSingle();
  if (eligibilityError) throw eligibilityError;
  if (!eligibility?.is_eligible) {
    return {
      state: "manual_action_required",
      manualReason: `Slack invite suppressed: ${String(eligibility?.eligibility_status ?? "agent_not_found")}`,
    };
  }

  const fullName = String(eligibility.full_name ?? "").trim();
  const firstName = fullName.split(/\s+/)[0] || "there";
  const email = String(eligibility.email ?? "").trim().toLowerCase();

  let emailReceipt: string | null = null;
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const optedOut = await resolveOne<{ id: string }>(
      sb.from("email_unsubscribes").select("id").ilike("email", emailPattern(email)),
      { label: `email_unsubscribes.email=${email}` },
    );
    if (!optedOut.row) {
      const safeName = escapeHtml(firstName);
      const safeInvite = escapeHtml(inviteUrl);
      emailReceipt = await resendEmail({
        from: CONTACT_FROM,
        to: [email],
        subject: "Join your APEX Financial team in Slack",
        html: `<div style="font-family:Arial,sans-serif;line-height:1.55;max-width:600px;margin:0 auto"><h2>Welcome to APEX, ${safeName}.</h2><p>Join the team workspace for daily huddles, contracting support, training, scripts, and sales wins.</p><p><a href="${safeInvite}" style="display:inline-block;background:#d4af37;color:#0a0a0a;font-weight:700;text-decoration:none;padding:12px 18px;border-radius:8px">Join APEX Financial Slack</a></p><p style="color:#6b7280;font-size:12px">If the button does not open, paste this into your browser: ${safeInvite}</p></div>`,
        text: `Welcome to APEX, ${firstName}. Join the team Slack workspace: ${inviteUrl}`,
      }, `apex-slack-invite-${event.aggregate_type}-${event.aggregate_id}`);
    }
  }

  if (!emailReceipt) {
    return {
      state: "manual_action_required",
      manualReason: "Slack invite could not be sent to the verified hired-agent email",
    };
  }

  return {
    state: "delivered",
    providerMessageId: emailReceipt,
    deliveryConfirmed: false,
  };
}

async function deliverDiscord(sb: any, event: any): Promise<string | undefined> {
  // MP-337: licensing milestones (XCEL course progress, exam, license) — the
  // Slack leg was live; this is the Discord half the directive asked for. The
  // payload is the milestone row (no candidate contact details), so no DB read.
  if (event.aggregate_type === "licensing_milestone") {
    const p = (event.payload ?? {}) as Record<string, unknown>;
    const response = await callFunction("discord-webhook-notify", {
      event_type: "licensing_milestone",
      details: {
        candidate_name: p.candidateName ?? null,
        milestone_type: p.milestoneType ?? null,
        state: p.state ?? null,
        exam_date: p.examDate ?? null,
      },
    });
    if (response?.suppressed === true) throw new Error("Discord licensing-milestone delivery was suppressed");
    if (response?.ok !== true) throw new Error("Discord did not confirm licensing-milestone delivery");
    return typeof response.provider_message_id === "string" ? response.provider_message_id : undefined;
  }

  if (event.aggregate_type === "agent" && event.event_type === "agent.hired") {
    const { data: hired, error } = await sb
      .from("agents")
      .select("id, display_name, manager_id, start_date, profile:profiles(full_name, instagram_handle)")
      .eq("id", event.aggregate_id)
      .maybeSingle();
    if (error || !hired) throw new Error(error?.message ?? "Hired agent no longer exists");
    const profile = Array.isArray(hired.profile) ? hired.profile[0] : hired.profile;
    const { data: manager } = hired.manager_id
      ? await sb.from("agents").select("display_name").eq("id", hired.manager_id).maybeSingle()
      : { data: null };
    const response = await callFunction("discord-webhook-notify", {
      event_type: "agent_activated",
      details: {
        agent_name: profile?.full_name ?? hired.display_name ?? "New APEX agent",
        instagram: profile?.instagram_handle ?? null,
        hired_by: manager?.display_name ?? "APEX Financial",
        start_date: hired.start_date ?? new Date().toISOString().slice(0, 10),
      },
    });
    if (response?.suppressed === true) throw new Error("Discord hire delivery was suppressed");
    if (response?.ok !== true) throw new Error("Discord did not confirm hire delivery");
    return typeof response.provider_message_id === "string" ? response.provider_message_id : undefined;
  }

  if (event.aggregate_type === "external_production_deal") {
    const { data: external, error } = await sb
      .from("production_external_deals")
      .select("id, agent_id, agent_name, carrier, product, annual_premium, face_amount")
      .eq("id", event.aggregate_id)
      .maybeSingle();
    if (error || !external) throw new Error(error?.message ?? "External production deal no longer exists");
    const { data: agent } = await sb
      .from("agents")
      .select("profile:profiles(instagram_handle, avatar_url)")
      .eq("id", external.agent_id)
      .maybeSingle();
    const profile = Array.isArray(agent?.profile) ? agent.profile[0] : agent?.profile;
    const response = await callFunction("discord-webhook-notify", {
      event_type: "deal_closed",
      delivery_scope: "primary",
      details: {
        deal_id: external.id,
        agent_id: external.agent_id,
        agent_name: external.agent_name,
        instagram_handle: profile?.instagram_handle ?? null,
        photo_url: profile?.avatar_url ?? null,
        carrier: external.carrier,
        product_type: external.product,
        face_amount: external.face_amount,
        aop: external.annual_premium,
      },
    });
    if (response?.suppressed === true) throw new Error("Discord external-deal delivery was suppressed");
    if (response?.ok !== true) throw new Error("Discord did not confirm external-deal delivery");
    return typeof response.provider_message_id === "string" ? response.provider_message_id : undefined;
  }

  const bookPayload = event.aggregate_type === "agentlink_book_deal"
    ? (event.payload ?? {}) as Record<string, unknown>
    : null;
  let deal: any;
  if (bookPayload) {
    if (typeof bookPayload.agentId !== "string" || !bookPayload.agentId) {
      throw new Error("AgentLink deal event is missing its agent");
    }
    deal = {
      id: event.aggregate_id,
      agent_id: bookPayload.agentId,
      carrier_id: null,
      product_sold: bookPayload.productCategory ?? null,
      face_amount: bookPayload.faceAmount ?? null,
      annualized_commissionable_premium: bookPayload.annualPremium ?? null,
      annual_premium: bookPayload.annualPremium ?? null,
      community_caption: null,
    };
  } else {
    const { data, error } = await sb
      .from("deals")
      .select("id, agent_id, carrier_id, product_sold, face_amount, annualized_commissionable_premium, annual_premium, community_caption")
      .eq("id", event.aggregate_id)
      .single();
    if (error || !data) throw new Error(error?.message ?? "Deal no longer exists");
    deal = data;
  }

  const [{ data: agent }, { data: carrier }] = await Promise.all([
    sb
      .from("agents")
      .select("display_name, profile:profiles(full_name, instagram_handle, avatar_url)")
      .eq("id", deal.agent_id)
      .maybeSingle(),
    bookPayload
      ? Promise.resolve({ data: { name: bookPayload.carrier ?? null } })
      : deal.carrier_id
      ? sb.from("carriers").select("name").eq("id", deal.carrier_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const profile = Array.isArray((agent as any)?.profile)
    ? (agent as any).profile[0]
    : (agent as any)?.profile;
  const agentName = profile?.full_name ?? (agent as any)?.display_name ?? "APEX agent";

  const response = await callFunction("discord-webhook-notify", {
    event_type: "deal_closed",
    delivery_scope: event.destination === "discord_subagency" ? "subagency" : "primary",
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
  if (response?.suppressed === true) {
    throw new Error("Discord delivery was suppressed; the durable outbox will retry it");
  }
  if (response?.ok !== true) throw new Error("Discord did not confirm delivery");
  return typeof response.provider_message_id === "string" ? response.provider_message_id : undefined;
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
  // MP-312: why the event landed in manual_action_required. Without this the
  // outbox row got a hardcoded "Provider write capability is unavailable",
  // which is false for a refusal — the capability is fine, the DEAL was
  // refused. An operator acting on the wrong sentence is the four months this
  // integration already lost to an error string that named the wrong fix.
  manualReason?: string;
  providerMessageId?: string;
  deliveryConfirmed?: boolean;
};

type SlackRoute = {
  id: string;
  installation_id: string;
  destination_id: string;
  template_version: number;
};

type SlackInstallation = {
  id: string;
  status: string;
  bot_token_secret_ref: string | null;
};

type SlackDestination = {
  id: string;
  channel_id: string;
  purpose: string;
  scope_type: string;
  is_enabled: boolean;
};

type SlackReceiptLease = {
  id: string;
  status: string;
  attempt_count: number | null;
  channel_id: string | null;
  message_ts: string | null;
};

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// A failed post leaves the receipt at 'retrying' (or 'dead_letter' once the
// attempt budget is spent) and only ever overwrites a row this worker holds
// the lease on: a row another worker has since delivered is never touched.
// next_attempt_at is advisory -- the parent outbox event's available_at is
// what actually schedules the retry -- but it is recorded so the receipt
// ledger explains itself without a join.
async function markSlackReceiptFailed(
  sb: any,
  receipt: SlackReceiptLease,
  retryAfterSeconds: number | null,
  message: string,
): Promise<void> {
  const attempts = Math.max(1, Number(receipt.attempt_count ?? 1));
  const exhausted = attempts >= MAX_ATTEMPTS;
  const backoffSeconds = retryAfterSeconds ?? Math.min(3600, 60 * 2 ** (attempts - 1));
  const now = new Date();
  const { error } = await sb.from("messaging_delivery_receipts").update({
    status: exhausted ? "dead_letter" : "retrying",
    retry_after_seconds: retryAfterSeconds,
    next_attempt_at: exhausted ? null : new Date(now.getTime() + backoffSeconds * 1000).toISOString(),
    last_error_redacted: redactError(message).slice(0, 300),
    updated_at: now.toISOString(),
  }).eq("id", receipt.id).eq("status", "claimed");
  if (error) throw error;
}

async function deliverSlack(sb: any, event: any): Promise<DispatchResult> {
  // Render first. An event type with no template is an operator problem, not
  // something to guess at; it must never reach a channel as a wrong sentence.
  const text = renderSlackEventText(String(event.event_type ?? ""), event.payload ?? {});
  if (text === null) {
    return {
      state: "manual_action_required",
      manualReason:
        `No Slack template exists for event type ${event.event_type}; add one to apex-outbox-dispatcher/slack-event-templates.ts`,
    };
  }

  const { data: routeRows, error: routeError } = await sb
    .from("messaging_route_rules")
    .select("id, installation_id, destination_id, template_version")
    .eq("event_type", event.event_type)
    .eq("is_enabled", true)
    .order("priority");
  if (routeError) throw routeError;

  const routes = (routeRows ?? []) as SlackRoute[];
  if (routes.length === 0) {
    return { state: "manual_action_required", manualReason: "No enabled Slack route is mapped for this event" };
  }

  // Fan-out: every enabled route is attempted on every pass. A failure on one
  // destination no longer aborts the others; it is collected, and the parent
  // event is retried, where the per-destination lease skips the ones that
  // already landed.
  let delivered = 0;
  let leasedElsewhere = 0;
  let firstProviderMessageId: string | undefined;
  const failures: string[] = [];

  for (const route of routes) {
    const [{ data: installation, error: installationError }, { data: destination, error: destinationError }] =
      await Promise.all([
        sb.from("messaging_workspace_installations")
          .select("id, status, bot_token_secret_ref")
          .eq("id", route.installation_id)
          .maybeSingle(),
        sb.from("messaging_destinations")
          .select("id, channel_id, purpose, scope_type, is_enabled")
          .eq("id", route.destination_id)
          .maybeSingle(),
      ]);
    if (installationError) throw installationError;
    if (destinationError) throw destinationError;

    const workspace = installation as SlackInstallation | null;
    const channel = destination as SlackDestination | null;
    if (!workspace || workspace.status !== "active" || !channel?.is_enabled) continue;

    // Milestone events currently contain organization-wide recruiting state.
    // Refuse narrower destinations until the payload carries a verified scope
    // key; guessing a hierarchy here could leak one agency's recruits to another.
    if (channel.scope_type !== "organization") continue;

    const secretRef = workspace.bot_token_secret_ref?.trim() ?? "";
    const token = (secretRef ? Deno.env.get(secretRef)?.trim() : "")
      || Deno.env.get("SLACK_BOT_TOKEN")?.trim()
      || "";
    if (!token) continue;

    // Lease BEFORE the post. The RPC inserts-or-locks the (event, destination)
    // receipt atomically: no row means another worker holds a fresh lease;
    // status 'delivered' means the message already landed and must not be
    // posted again. chat.postMessage has no idempotency key of its own, so
    // this row is the only thing standing between a re-claim and a duplicate.
    const receiptKey = `${event.id}:${channel.id}:v${route.template_version}`;
    const { data: leaseRows, error: leaseError } = await sb.rpc("claim_messaging_delivery_receipt", {
      p_outbox_event_id: event.id,
      p_installation_id: workspace.id,
      p_destination_id: channel.id,
      p_idempotency_key: receiptKey,
      p_template_version: route.template_version,
      p_correlation_id: event.correlation_id ?? null,
    });
    if (leaseError) throw leaseError;
    const receipt = (Array.isArray(leaseRows) ? leaseRows[0] : leaseRows) as SlackReceiptLease | undefined;
    if (!receipt) {
      leasedElsewhere += 1;
      continue;
    }
    if (receipt.status === "delivered") {
      delivered += 1;
      firstProviderMessageId ??= receipt.message_ts ? `${receipt.channel_id}:${receipt.message_ts}` : undefined;
      continue;
    }

    let response: Response;
    try {
      response = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          channel: channel.channel_id,
          text,
          unfurl_links: false,
          unfurl_media: false,
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      // No response at all. Slack MAY have accepted the message before the
      // socket died; there is no way to ask, so this is recorded as a retry
      // and the possibility of a duplicate is accepted over the certainty of
      // a silent drop.
      const note = `Slack unreachable (${channel.purpose}): ${redactError(error)}`;
      await markSlackReceiptFailed(sb, receipt, null, note);
      failures.push(note);
      continue;
    }

    const retryAfter = Number(response.headers.get("retry-after"));
    const rawBody = await response.text();
    let body: any = null;
    try {
      body = rawBody ? JSON.parse(rawBody) : null;
    } catch { // empty-catch-allow:provider-body-may-be-non-json
      // A non-JSON body is graded below exactly like a Slack-level failure.
    }
    if (!response.ok || body?.ok !== true || typeof body?.ts !== "string") {
      const retrySeconds = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null;
      const note = `Slack ${response.status} (${channel.purpose}): ${String(body?.error ?? "invalid_provider_response").slice(0, 120)}`;
      await markSlackReceiptFailed(sb, receipt, retrySeconds, note);
      failures.push(note);
      continue;
    }

    const deliveredAt = new Date().toISOString();
    const deliveredPatch = {
      status: "delivered",
      channel_id: typeof body.channel === "string" && body.channel ? body.channel : channel.channel_id,
      message_ts: body.ts,
      provider_response_hash: await sha256Hex(rawBody),
      last_error_redacted: null,
      retry_after_seconds: null,
      next_attempt_at: null,
      delivered_at: deliveredAt,
      updated_at: deliveredAt,
    };
    // The message is in the channel. From here every statement is recording,
    // and a lost record re-posts once the lease goes stale, so the write is
    // retried before it is allowed to fail.
    let recordError: unknown = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { error } = await sb.from("messaging_delivery_receipts").update(deliveredPatch).eq("id", receipt.id);
      recordError = error;
      if (!error) break;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
    if (recordError) throw recordError;
    delivered += 1;
    firstProviderMessageId ??= `${deliveredPatch.channel_id}:${body.ts}`;
  }

  if (failures.length > 0) {
    throw new Error(`Slack delivery failed for ${failures.length} of ${routes.length} route(s): ${failures.join("; ")}`);
  }
  if (leasedElsewhere > 0) {
    // Another worker is mid-post for at least one destination. Marking the
    // parent delivered now would be claiming their outcome; let the parent
    // retry and read the settled receipt instead.
    throw new Error(`Slack delivery lease held by another worker for ${leasedElsewhere} destination(s); will re-check`);
  }
  if (delivered === 0) {
    return {
      state: "manual_action_required",
      manualReason: "Slack route exists, but no active organization destination with a configured token was available",
    };
  }
  return { state: "delivered", providerMessageId: firstProviderMessageId, deliveryConfirmed: true };
}

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
        .select(
          "id, first_name, last_name, email, phone_e164, npn, status, " +
            "comp_percentage, license_status, license_states, eo_certificate_url, " +
            "eo_expires_at, eo_per_claim_limit, eo_aggregate_limit, eft_ready, " +
            "contracting_contact_name",
        )
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
  // MP-335: a Slack row is a Slack row regardless of aggregate. Before this,
  // contracting_intake rows were routed to the contracting handler FIRST — which
  // has no 'slack' case — so the seeded contracting.intake_submitted → Slack route
  // (enqueued by fn_queue_contracting_slack) could never deliver even once the
  // outbox guard admitted it. deliverSlack resolves the channel from
  // messaging_route_rules by event_type, so it needs no aggregate knowledge.
  if (event.destination === "slack") {
    return await deliverSlack(sb, event);
  }
  if (event.aggregate_type === "contracting_intake") {
    return await deliverContractingIntake(sb, event);
  }
  if (event.destination === "review") return { state: "delivered" };
  if (event.destination === "discord" || event.destination === "discord_subagency") {
    const providerMessageId = await deliverDiscord(sb, event);
    return { state: "delivered", providerMessageId, deliveryConfirmed: true };
  }
  if (event.destination === "application_slack_invite") {
    return await deliverApplicationSlackInvite(sb, event);
  }
  if (event.destination === "insuracloud") {
    return {
      state: "manual_action_required",
      manualReason: "Legacy cloud forwarding is retired; APEX is the system of record.",
    };
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
  let contractingIntakeId: string | null = null;
  try {
    const body = await req.json();
    requestedLimit = Number(body?.limit ?? 20);
    contactActionId = typeof body?.contactActionId === "string" ? body.contactActionId : null;
    contractingIntakeId = typeof body?.contractingIntakeId === "string" ? body.contractingIntakeId : null;
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

  if (contractingIntakeId && !authorization.canDispatchAll) {
    return json({ ok: false, error: "Contracting intake dispatch requires service role" }, 403);
  }

  const claim = contractingIntakeId
    ? await sb.rpc("claim_contracting_intake_events", { p_intake_id: contractingIntakeId })
    : contactActionId
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
    // MP-314: a send that happened but could not be fully recorded. Counted
    // separately from persistenceFailures because the operator question is
    // different: not "did a write fail" but "is there a delivery the audit log
    // cannot fully account for, which nothing will retry".
    strandedAfterDispatch: 0,
  };
  const receipts: Array<Record<string, unknown>> = [];

  for (const event of claimed ?? []) {
    const attemptNumber = Number(event.attempts);
    // MP-314: the catch below could not tell "the provider was never called"
    // from "the provider succeeded and only the bookkeeping failed", and treated
    // both as retryable. claim_apex_outbox_events re-claims status='failed', so
    // a failed audit-row write re-ran dispatch() and duplicated the side effect.
    // dispatchCompleted marks the instant a provider side effect may exist;
    // parentSettled marks the instant outbox_events holds the terminal truth.
    let dispatchCompleted = false;
    let parentSettled = false;
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
      // Set BEFORE any bookkeeping. Everything past this line is recording, not
      // sending: if any of it throws, the send has already left the building.
      dispatchCompleted = true;
      if (result.state === "manual_action_required") {
        const { error: manualError } = await sb.from("outbox_events").update({
          status: "manual_action_required",
          processed_at: new Date().toISOString(),
          locked_at: null,
          last_error_redacted: result.manualReason
            ?? "Provider write capability is unavailable; operator action required.",
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
      parentSettled = true;
      if (attempt.id) {
        // MP-313: this used to say "delivered" unconditionally -- including on
        // the manual_action_required branch three lines above, for the same
        // event, inside the same try. The parent outbox_events row said the
        // deal was refused and never sent; the child audit row said it was
        // delivered. delivery_attempts has no reader in the app: its whole job
        // is to be the durable per-attempt record a human reads later, so a
        // wrong word here is the entire failure, not a cosmetic one.
        // The status now comes from the SAME result.state the parent branched
        // on, so the two rows cannot disagree by construction. The reason text
        // is deliberately NOT copied down here -- it lives once on
        // outbox_events.last_error_redacted, one FK hop away, because two
        // copies of one fact is how curl --max-time and fn_agentlink_reap_stuck
        // drifted into 36 false pages a day.
        const { error: attemptUpdateError } = await sb.from("delivery_attempts").update({
          status: result.state === "manual_action_required" ? "manual_action_required" : "delivered",
          provider_message_id: result.providerMessageId ?? null,
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
      if (dispatchCompleted) {
        // MP-314: the provider side effect already exists. Re-arming this event
        // does not retry a failed send, it repeats a successful one. Email/SMS
        // survive that (resendEmail carries a stable `apex-contact-${id}`
        // idempotency key), but the Discord webhook and POST /api/deals do not:
        // a duplicate deal lands in agentlink_book, the book Sam's commissions
        // are computed from. So this branch never writes available_at and never
        // writes 'failed'.
        const persistenceErrors: string[] = [];
        if (!parentSettled) {
          // The parent is stranded at 'processing' with locked_at set, and the
          // claim function re-claims a stale 'processing' row after 10 minutes,
          // so leaving it alone re-sends just as surely as marking it failed.
          // manual_action_required is terminal by construction and already in
          // this column's vocabulary (checked live before writing it -- MP-313
          // shipped because a CHECK rejected exactly this kind of honest word).
          const { error: strandedError } = await sb.from("outbox_events").update({
            status: "manual_action_required",
            processed_at: new Date().toISOString(),
            locked_at: null,
            last_error_redacted: `Provider dispatch completed; outbox state could not be recorded: ${message}`,
          }).eq("id", event.id);
          if (strandedError) persistenceErrors.push(redactError(strandedError));
          if (attempt?.id) {
            const { error: strandedAttemptError } = await sb.from("delivery_attempts").update({
              status: "manual_action_required",
              error_redacted: message,
              finished_at: new Date().toISOString(),
            }).eq("id", attempt.id);
            if (strandedAttemptError) persistenceErrors.push(redactError(strandedAttemptError));
          }
        }
        // When parentSettled is true the ONLY statement that can have thrown is
        // the child update, so the child is deliberately left at 'started' with
        // a null finished_at. That is the honest residue -- "this attempt never
        // got a terminal record" -- and re-issuing the write that just failed
        // would be guessing. The parent already holds the truth; overwriting it
        // is the bug this branch exists to stop.
        summary.strandedAfterDispatch += 1;
        if (persistenceErrors.length) summary.persistenceFailures += 1;
        console.error("[apex-outbox-dispatcher] dispatch completed but bookkeeping failed", {
          eventId: event.id,
          destination: event.destination,
          parentSettled,
          message,
          persistenceErrors,
        });
        if (event.aggregate_type === "contact_action") {
          // Do NOT touch apex_contact_actions here. deliverContactAction already
          // set it to 'provider_accepted' and throws if that write fails, so on
          // this path it is correct and terminal. The old code overwrote it with
          // 'retrying' -- a second wrong word promising a retry that will not
          // happen, the same class MP-313 closed one table over.
          receipts.push({
            actionId: event.aggregate_id,
            status: "delivered_record_incomplete",
            error: "The provider accepted this send; its delivery record could not be completed. It will NOT be retried.",
            deliveryConfirmed: false,
          });
        }
        continue;
      }
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

  // A run that sent something it could not account for is not an ok run.
  return json({
    ok: summary.persistenceFailures === 0 && summary.strandedAfterDispatch === 0,
    ...summary,
    receipts,
  });
});
