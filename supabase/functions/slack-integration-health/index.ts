import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

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
};

type RouteRow = {
  event_type: string;
  destination_id: string;
  is_enabled: boolean;
  priority: number;
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
  };
};

type SlackApiResult<T> = {
  body: T;
  httpStatus: number;
  retryAfterSeconds: number | null;
};

const noStoreHeaders = { "Cache-Control": "no-store" };

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
      .select("id, purpose, channel_id, channel_name, is_enabled, verified_at")
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
      .select("event_type, destination_id, is_enabled, priority")
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
        status: "disabled",
      });
      continue;
    }

    if (!token || !authResult?.body.ok) {
      channels.push({
        purpose: destination.purpose,
        channel_id: destination.channel_id,
        configured_name: destination.channel_name,
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
        status,
        is_member: channel?.is_member ?? null,
        verified_at: destination.verified_at,
        error: result.body.ok ? null : result.body.error ?? "slack_channel_check_failed",
        retry_after_seconds: result.retryAfterSeconds,
      });
    } catch {
      channels.push({
        purpose: destination.purpose,
        channel_id: destination.channel_id,
        configured_name: destination.channel_name,
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
  const routeStatuses = enabledRoutes.map((route) => {
    const destination = destinations.find((row) => row.id === route.destination_id) ?? null;
    return {
      event_type: route.event_type,
      priority: route.priority,
      destination_purpose: destination?.purpose ?? null,
      channel_id: destination?.channel_id ?? null,
      status: destination?.is_enabled ? "ready" : "destination_unavailable",
    };
  });
  const routesOk = enabledRoutes.length > 0
    && routeStatuses.every((route) => route.status === "ready");
  const ok = connectivityOk && installation !== null && mappingsOk && routesOk;

  if (ok && installation) {
    await admin
      .from("messaging_workspace_installations")
      .update({ status: "active", last_verified_at: new Date().toISOString(), last_error_redacted: null })
      .eq("id", installation.id);
  }

  return jsonResponse({
    ok,
    checked_at: new Date().toISOString(),
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
    },
    channels,
    routes: routeStatuses,
  }, ok ? 200 : token ? 502 : 503, noStoreHeaders);
});
