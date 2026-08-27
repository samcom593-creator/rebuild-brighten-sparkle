// Admin-only live Slack health probe.
//
// Proves four things and refuses to blur them into one green:
//   1. connectivity  — the bot token answers auth.test for the bound workspace
//   2. channels      — every enabled semantic destination is reachable
//   3. route coverage— every enabled route has a dispatcher template, and every
//                      database trigger / edge function that queues a
//                      destination='slack' outbox event has an enabled route
//   4. delivery      — receipt ledger + slack outbox backlog over the last 24h
//
// Callable with an admin user session or with the service-role key (so
// apex-doctor and cron can probe it without minting a user JWT).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { SLACK_EDGE_EMITTERS, SLACK_TEMPLATED_EVENT_TYPES } from "../apex-outbox-dispatcher/slack-event-templates.ts";

type InstallationRow = {
  id: string;
  workspace_id: string;
  workspace_name: string | null;
  status: string;
  last_verified_at: string | null;
};

type DestinationRow = {
  id: string;
  purpose: string;
  channel_id: string;
  channel_name: string | null;
  is_enabled: boolean;
  verified_at: string | null;
  privacy_level: string;
};

type RouteRow = {
  event_type: string;
  destination_id: string;
  is_enabled: boolean;
  priority: number;
  template_version: number;
};

type EmitterRow = {
  function_name: string;
  trigger_name: string | null;
  table_name: string | null;
  trigger_enabled: boolean | null;
  event_type: string;
};

type SlackAuthResult = {
  ok: boolean;
  error?: string;
  team?: string;
  team_id?: string;
  user_id?: string;
};

type SlackConversationResult = {
  ok: boolean;
  error?: string;
  channel?: {
    id: string;
    name?: string;
    is_archived?: boolean;
    is_member?: boolean;
    is_private?: boolean;
  };
};

type SlackApiResult<T> = {
  body: T;
  httpStatus: number;
  retryAfterSeconds: number | null;
};

type DeliveryStats = {
  window_hours?: number;
  lease_stale_after_seconds?: number;
  receipts?: Record<string, unknown>;
  outbox_slack?: Record<string, unknown>;
};

const noStoreHeaders = { "Cache-Control": "no-store" };

// A slack outbox row older than this and still undelivered is graded degraded.
// The dispatcher runs every minute and retries with min(60, 2^attempt) minute
// backoff, so anything past 30 minutes has failed at least twice.
const OUTBOX_STALE_SECONDS = 30 * 60;
const LEGACY_CANDIDATE_CHANNELS = [
  { channel_id: "C0BSTVB98DA", name: "apex-recruiting-growth" },
  { channel_id: "C0BS9F2V3M5", name: "licensing-academy-support" },
] as const;

async function callSlack<T>(
  method: string,
  token: string,
  params: Record<string, string> = {},
): Promise<SlackApiResult<T>> {
  const url = new URL(`https://slack.com/api/${method}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8_000),
  });
  const retryAfter = Number(response.headers.get("retry-after"));
  return {
    body: await response.json() as T,
    httpStatus: response.status,
    retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
  };
}

function num(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "GET" && request.method !== "POST") {
    return jsonResponse({ ok: false, error: "method_not_allowed" }, 405, noStoreHeaders);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim() ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")?.trim() ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ?? "";
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ ok: false, error: "server_not_configured" }, 503, noStoreHeaders);
  }

  const authorization = request.headers.get("authorization")?.trim() ?? "";
  if (!authorization.toLowerCase().startsWith("bearer ")) {
    return jsonResponse({ ok: false, error: "authentication_required" }, 401, noStoreHeaders);
  }

  const bearer = authorization.slice(7).trim();
  let callerKind: "service_role" | "admin_user";
  if (bearer && bearer === serviceRoleKey) {
    callerKind = "service_role";
  } else {
    const caller = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: authorization } },
    });
    const { data: userResult, error: userError } = await caller.auth.getUser();
    if (userError || !userResult.user) {
      return jsonResponse({ ok: false, error: "invalid_session" }, 401, noStoreHeaders);
    }

    const { data: isAdmin, error: adminCheckError } = await caller.rpc("apex_is_admin");
    if (adminCheckError || isAdmin !== true) {
      return jsonResponse({ ok: false, error: "admin_only" }, 403, noStoreHeaders);
    }
    callerKind = "admin_user";
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const { data: installationData, error: installationError } = await admin
    .from("messaging_workspace_installations")
    .select("id, workspace_id, workspace_name, status, last_verified_at")
    .eq("provider", "slack")
    .order("created_at", { ascending: false });
  if (installationError) {
    return jsonResponse({ ok: false, error: "installation_lookup_failed" }, 500, noStoreHeaders);
  }

  const installations = (installationData ?? []) as InstallationRow[];
  const token = Deno.env.get("SLACK_BOT_TOKEN")?.trim() ?? "";
  let authResult: SlackApiResult<SlackAuthResult> | null = null;
  let connectivityError: string | null = null;

  if (token) {
    try {
      authResult = await callSlack<SlackAuthResult>("auth.test", token);
      if (!authResult.body.ok) connectivityError = authResult.body.error ?? "slack_auth_failed";
    } catch {
      connectivityError = "slack_unreachable";
    }
  } else {
    connectivityError = "slack_bot_token_missing";
  }

  const workspaceId = authResult?.body.ok ? authResult.body.team_id : undefined;
  const installation = installations.find((row) => row.workspace_id === workspaceId) ?? installations[0] ?? null;
  const { data: destinationData, error: destinationError } = installation
    ? await admin
      .from("messaging_destinations")
      .select("id, purpose, channel_id, channel_name, is_enabled, verified_at, privacy_level")
      .eq("installation_id", installation.id)
      .order("purpose")
    : { data: [], error: null };

  if (destinationError) {
    return jsonResponse({ ok: false, error: "destination_lookup_failed" }, 500, noStoreHeaders);
  }

  const destinations = (destinationData ?? []) as DestinationRow[];
  const { data: routeData, error: routeError } = installation
    ? await admin
      .from("messaging_route_rules")
      .select("event_type, destination_id, is_enabled, priority, template_version")
      .eq("installation_id", installation.id)
      .order("priority")
    : { data: [], error: null };
  if (routeError) {
    return jsonResponse({ ok: false, error: "route_lookup_failed" }, 500, noStoreHeaders);
  }
  const routes = (routeData ?? []) as RouteRow[];
  const channels: Array<Record<string, unknown>> = [];
  for (const destination of destinations) {
    if (!destination.is_enabled) {
      channels.push({
        purpose: destination.purpose,
        channel_id: destination.channel_id,
        configured_name: destination.channel_name,
        intended_privacy: destination.privacy_level,
        status: "disabled",
      });
      continue;
    }

    if (!token || !authResult?.body.ok) {
      channels.push({
        purpose: destination.purpose,
        channel_id: destination.channel_id,
        configured_name: destination.channel_name,
        intended_privacy: destination.privacy_level,
        status: "not_tested",
        error: connectivityError,
      });
      continue;
    }

    try {
      const result = await callSlack<SlackConversationResult>("conversations.info", token, {
        channel: destination.channel_id,
      });
      const channel = result.body.channel;
      const status = result.body.ok
        ? channel?.is_archived
          ? "archived"
          : channel?.is_member === false
            ? "reachable_not_joined"
            : "reachable"
        : result.httpStatus === 429 || result.body.error === "ratelimited"
          ? "rate_limited"
          : "unreachable";
      channels.push({
        purpose: destination.purpose,
        channel_id: destination.channel_id,
        configured_name: destination.channel_name,
        reported_name: channel?.name ?? null,
        intended_privacy: destination.privacy_level,
        status,
        is_member: channel?.is_member ?? null,
        is_private: channel?.is_private ?? null,
        verified_at: destination.verified_at,
        error: result.body.ok ? null : result.body.error ?? "slack_channel_check_failed",
        retry_after_seconds: result.retryAfterSeconds,
      });
    } catch {
      channels.push({
        purpose: destination.purpose,
        channel_id: destination.channel_id,
        configured_name: destination.channel_name,
        intended_privacy: destination.privacy_level,
        status: "unreachable",
        error: "slack_unreachable",
      });
    }
  }

  const enabledChannels = channels.filter((channel) => channel.status !== "disabled");
  const reachableChannels = enabledChannels.filter((channel) =>
    channel.status === "reachable" || channel.status === "reachable_not_joined"
  );
  const connectivityOk = authResult?.body.ok === true;
  const mappingsOk = enabledChannels.length > 0 && reachableChannels.length === enabledChannels.length;
  const enabledRoutes = routes.filter((route) => route.is_enabled);
  const templated = new Set<string>(SLACK_TEMPLATED_EVENT_TYPES);
  const routeStatuses = enabledRoutes.map((route) => {
    const destination = destinations.find((row) => row.id === route.destination_id) ?? null;
    const hasTemplate = templated.has(route.event_type);
    return {
      event_type: route.event_type,
      priority: route.priority,
      template_version: route.template_version,
      destination_purpose: destination?.purpose ?? null,
      channel_id: destination?.channel_id ?? null,
      has_template: hasTemplate,
      status: !destination?.is_enabled
        ? "destination_unavailable"
        : !hasTemplate
          ? "no_template"
          : "ready",
    };
  });
  const routesOk = enabledRoutes.length > 0
    && routeStatuses.every((route) => route.status === "ready");

  // ── Route coverage ──────────────────────────────────────────────────────
  // Emitters are read from pg_proc (slack_outbox_emitters), never from a list
  // in this file, so a trigger that lands without a route shows up as a gap
  // the week it lands. Edge-function emitters cannot be introspected from the
  // catalog and are declared once in apex-outbox-dispatcher/slack-event-templates.ts.
  const { data: emitterData, error: emitterError } = await admin.rpc("slack_outbox_emitters");
  const emitterRows = (emitterData ?? []) as EmitterRow[];
  const emitterSources = new Map<string, string[]>();
  for (const row of emitterRows) {
    const source = row.trigger_name
      ? `${row.function_name} via ${row.trigger_name} on ${row.table_name}${row.trigger_enabled === false ? " (TRIGGER DISABLED)" : ""}`
      : `${row.function_name} (no trigger bound)`;
    emitterSources.set(row.event_type, [...(emitterSources.get(row.event_type) ?? []), source]);
  }
  for (const [eventType, source] of Object.entries(SLACK_EDGE_EMITTERS)) {
    emitterSources.set(eventType, [...(emitterSources.get(eventType) ?? []), source]);
  }
  const routedTypes = new Set(enabledRoutes.map((route) => route.event_type));
  const routesWithoutTemplate = [...new Set(enabledRoutes.map((r) => r.event_type))]
    .filter((eventType) => !templated.has(eventType));
  const emittersWithoutRoute = [...emitterSources.keys()].filter((eventType) => !routedTypes.has(eventType));
  const templatesWithoutRoute = [...templated].filter((eventType) => !routedTypes.has(eventType));
  const templatesWithoutEmitter = [...templated].filter((eventType) => !emitterSources.has(eventType));
  const disabledTriggers = emitterRows
    .filter((row) => row.trigger_enabled === false)
    .map((row) => `${row.trigger_name} on ${row.table_name}`);
  const coverageStatus = emitterError
    ? "unknown"
    : routesWithoutTemplate.length === 0 && emittersWithoutRoute.length === 0 && disabledTriggers.length === 0
      ? "ok"
      : "gap";
  const routeCoverage = {
    status: coverageStatus,
    error: emitterError ? String(emitterError.message ?? "emitter_lookup_failed").slice(0, 200) : null,
    templated_event_types: [...templated],
    emitters: Object.fromEntries(emitterSources),
    routes_without_template: routesWithoutTemplate,
    emitters_without_route: emittersWithoutRoute,
    disabled_triggers: disabledTriggers,
    // Informational only: a template nobody queues or routes is inert, not a leak.
    templates_without_route: templatesWithoutRoute,
    templates_without_emitter: templatesWithoutEmitter,
  };

  // ── Delivery ledger ─────────────────────────────────────────────────────
  const { data: statsData, error: statsError } = await admin.rpc("slack_delivery_receipt_stats", {
    p_window: "24 hours",
  });
  const stats = (statsData ?? {}) as DeliveryStats;
  const receipts = stats.receipts ?? {};
  const outboxSlack = stats.outbox_slack ?? {};
  const receiptsTotalAllTime = num(receipts.total_all_time);
  const queuedInWindow = num(outboxSlack.queued_in_window);
  const oldestUndeliveredAge = outboxSlack.oldest_undelivered_age_seconds == null
    ? null
    : num(outboxSlack.oldest_undelivered_age_seconds);
  const degradedReasons: string[] = [];
  if (num(receipts.dead_letter) > 0) degradedReasons.push(`${num(receipts.dead_letter)} receipt(s) dead-lettered in window`);
  if (num(receipts.claimed_stale) > 0) degradedReasons.push(`${num(receipts.claimed_stale)} stale lease(s) past ${num(stats.lease_stale_after_seconds)}s`);
  if (num(outboxSlack.dead_letter) > 0) degradedReasons.push(`${num(outboxSlack.dead_letter)} slack outbox event(s) dead-lettered`);
  if (num(outboxSlack.failed) > 0) degradedReasons.push(`${num(outboxSlack.failed)} slack outbox event(s) awaiting retry`);
  if (num(outboxSlack.manual_action_required) > 0) {
    degradedReasons.push(`${num(outboxSlack.manual_action_required)} slack outbox event(s) need an operator`);
  }
  if (oldestUndeliveredAge !== null && oldestUndeliveredAge > OUTBOX_STALE_SECONDS) {
    degradedReasons.push(`oldest undelivered slack event is ${oldestUndeliveredAge}s old`);
  }
  // Three-valued on purpose. "no_traffic" is its own verdict: nothing has been
  // queued or delivered, which is neither proof of health nor of failure.
  const deliveryStatus = statsError
    ? "unknown"
    : degradedReasons.length > 0
      ? "degraded"
      : receiptsTotalAllTime === 0 && queuedInWindow === 0
        ? "no_traffic"
        : "ok";
  const delivery = {
    status: deliveryStatus,
    error: statsError ? String(statsError.message ?? "stats_lookup_failed").slice(0, 200) : null,
    reasons: degradedReasons,
    window_hours: stats.window_hours ?? 24,
    lease_stale_after_seconds: stats.lease_stale_after_seconds ?? null,
    receipts,
    outbox_slack: outboxSlack,
  };

  // ── Operating layer ──────────────────────────────────────────────────────
  // Transport health alone is a false green for a primary workspace. Grade the
  // approved hired-agent audience, private candidate routes, verified links,
  // durable invitation receipts, and explicit Slack-only exclusions together.
  const [eligibilityResult, identityResult, exclusionResult, inviteResult, numbersResult] = await Promise.all([
    admin.from("v_slack_invite_eligibility")
      .select("agent_id, is_eligible, eligibility_status")
      .eq("is_eligible", true),
    installation
      ? admin.from("messaging_identity_links")
        .select("agent_id, verification_status, revoked_at")
        .eq("installation_id", installation.id)
      : Promise.resolve({ data: [], error: null }),
    admin.from("messaging_audience_exclusions")
      .select("agent_id, is_active")
      .eq("provider", "slack")
      .eq("is_active", true),
    admin.from("outbox_events")
      .select("aggregate_type, aggregate_id, status, created_at")
      .eq("event_type", "recruiting.slack_invite_requested")
      .eq("destination", "application_slack_invite"),
    admin.from("numbers_reminder_delivery_log")
      .select("business_date, slack_status, sent_at")
      .order("business_date", { ascending: false })
      .limit(500),
  ]);

  const operatingErrors = [
    eligibilityResult.error,
    identityResult.error,
    exclusionResult.error,
    inviteResult.error,
    numbersResult.error,
  ].filter(Boolean);
  const eligibleIds = new Set((eligibilityResult.data ?? []).map((row: any) => String(row.agent_id)));
  const excludedIds = new Set((exclusionResult.data ?? []).map((row: any) => String(row.agent_id)));
  const verifiedIds = new Set(
    (identityResult.data ?? [])
      .filter((row: any) => row.verification_status === "verified" && !row.revoked_at && row.agent_id)
      .map((row: any) => String(row.agent_id)),
  );
  const inviteRows = inviteResult.data ?? [];
  const deliveredInviteIds = new Set(
    inviteRows
      .filter((row: any) => row.aggregate_type === "agent" && row.status === "delivered")
      .map((row: any) => String(row.aggregate_id)),
  );
  const inviteFailureStates = new Set(["failed", "dead_letter", "manual_action_required"]);
  const hiredInviteFailures = inviteRows.filter((row: any) =>
    row.aggregate_type === "agent" && inviteFailureStates.has(String(row.status))
  ).length;
  const applicantInvitesDelivered = inviteRows.filter((row: any) =>
    row.aggregate_type === "application" && row.status === "delivered"
  ).length;
  const uncoveredEligible = [...eligibleIds].filter((id) => !verifiedIds.has(id) && !deliveredInviteIds.has(id));
  const excludedLinked = [...excludedIds].filter((id) => verifiedIds.has(id));
  // Four-hub model: candidate intake lives in Recruiting/Hiring and licensing,
  // training, and appointment help live together in Training/Contracting.
  const candidateChannels = channels.filter((channel) =>
    channel.purpose === "recruiting_growth" || channel.purpose === "contracting_support"
  );
  const candidatePrivacyOk = candidateChannels.length === 2 && candidateChannels.every((channel) =>
    (channel.intended_privacy === "private" || channel.intended_privacy === "restricted")
      && channel.is_private === true
      && channel.status === "reachable"
  );
  const latestNumbersDate = (numbersResult.data ?? [])[0]?.business_date ?? null;
  const latestNumbers = latestNumbersDate
    ? (numbersResult.data ?? []).filter((row: any) => row.business_date === latestNumbersDate)
    : [];
  const legacyCandidateChannels: Array<Record<string, unknown>> = [];
  if (token && authResult?.body.ok) {
    for (const legacy of LEGACY_CANDIDATE_CHANNELS) {
      try {
        const result = await callSlack<SlackConversationResult>("conversations.info", token, {
          channel: legacy.channel_id,
        });
        legacyCandidateChannels.push({
          ...legacy,
          is_archived: result.body.channel?.is_archived ?? null,
          is_private: result.body.channel?.is_private ?? null,
          locked: result.body.ok === true
            && (result.body.channel?.is_archived === true || result.body.channel?.is_private === true),
          error: result.body.ok ? null : result.body.error ?? "slack_channel_check_failed",
        });
      } catch {
        legacyCandidateChannels.push({ ...legacy, locked: false, error: "slack_unreachable" });
      }
    }
  }
  const legacyCandidateChannelsLocked = legacyCandidateChannels.length === LEGACY_CANDIDATE_CHANNELS.length
    && legacyCandidateChannels.every((channel) => channel.locked === true);
  const operatingReasons: string[] = [];
  if (excludedIds.size !== 8) operatingReasons.push(`expected 8 active Slack exclusions; found ${excludedIds.size}`);
  if (excludedLinked.length > 0) operatingReasons.push(`${excludedLinked.length} excluded agent(s) have verified Slack links`);
  if (!candidatePrivacyOk) operatingReasons.push("recruiting and contracting hubs are not both verified private staff channels");
  if (!legacyCandidateChannelsLocked) operatingReasons.push("legacy public candidate channels are not archived or private");
  if (applicantInvitesDelivered > 0) operatingReasons.push(`${applicantInvitesDelivered} applicant workspace invite(s) delivered`);
  if (hiredInviteFailures > 0) operatingReasons.push(`${hiredInviteFailures} hired-agent invite(s) need attention`);
  if (eligibleIds.size === 0) operatingReasons.push("no eligible active hired agents");
  if (verifiedIds.size === 0) operatingReasons.push("no verified Slack identity links");
  if (uncoveredEligible.length > 0) operatingReasons.push(`${uncoveredEligible.length} eligible hire(s) have neither a verified link nor delivered invite`);
  if (operatingErrors.length > 0) operatingReasons.push("operating-layer query failed");
  const operatingOk = operatingReasons.length === 0;
  const operating = {
    status: operatingErrors.length > 0 ? "unknown" : operatingOk ? "ok" : "not_ready",
    reasons: operatingReasons,
    eligible_hired_agents: eligibleIds.size,
    verified_identity_links: [...verifiedIds].filter((id) => eligibleIds.has(id)).length,
    delivered_hired_invites: [...deliveredInviteIds].filter((id) => eligibleIds.has(id)).length,
    uncovered_eligible_hires: uncoveredEligible.length,
    hired_invite_failures: hiredInviteFailures,
    applicant_invites_delivered: applicantInvitesDelivered,
    active_slack_exclusions: excludedIds.size,
    excluded_verified_links: excludedLinked.length,
    candidate_channels_private: candidatePrivacyOk,
    legacy_candidate_channels_locked: legacyCandidateChannelsLocked,
    legacy_candidate_channels: legacyCandidateChannels,
    latest_numbers_business_date: latestNumbersDate,
    latest_numbers_slack_sent: latestNumbers.filter((row: any) => row.slack_status === "sent").length,
    latest_numbers_no_link: latestNumbers.filter((row: any) => row.slack_status === "no_slack_link").length,
  };

  const ok = connectivityOk
    && installation !== null
    && mappingsOk
    && routesOk
    && coverageStatus === "ok"
    && (deliveryStatus === "ok" || deliveryStatus === "no_traffic")
    && operatingOk;

  if (ok && installation) {
    await admin
      .from("messaging_workspace_installations")
      .update({ status: "active", last_verified_at: new Date().toISOString(), last_error_redacted: null })
      .eq("id", installation.id);
  }

  return jsonResponse({
    ok,
    checked_at: new Date().toISOString(),
    caller: callerKind,
    connectivity: {
      status: connectivityOk ? "connected" : token ? "failed" : "not_configured",
      workspace_id: authResult?.body.team_id ?? installation?.workspace_id ?? null,
      workspace_name: authResult?.body.team ?? installation?.workspace_name ?? null,
      bot_user_id: authResult?.body.user_id ?? null,
      error: connectivityError,
    },
    installation: installation
      ? {
        id: installation.id,
        status: installation.status,
        last_verified_at: installation.last_verified_at,
      }
      : null,
    summary: {
      mapped: destinations.length,
      enabled: enabledChannels.length,
      reachable: reachableChannels.length,
      unhealthy: enabledChannels.length - reachableChannels.length,
      routes_enabled: enabledRoutes.length,
      routes_unhealthy: routeStatuses.filter((route) => route.status !== "ready").length,
      routes_without_template: routesWithoutTemplate.length,
      emitters_without_route: emittersWithoutRoute.length,
      receipts_delivered_24h: num(receipts.delivered),
      receipts_dead_letter_24h: num(receipts.dead_letter),
      receipts_claimed_stale: num(receipts.claimed_stale),
      coverage_status: coverageStatus,
      delivery_status: deliveryStatus,
      operating_status: operating.status,
    },
    channels,
    routes: routeStatuses,
    route_coverage: routeCoverage,
    delivery,
    operating,
  }, ok ? 200 : token ? 502 : 503, noStoreHeaders);
});
