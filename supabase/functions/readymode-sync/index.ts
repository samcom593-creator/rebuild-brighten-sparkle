// readymode-sync
//
// Pulls ReadyMode call-log data into readymode_dialer_calls.
//
// ReadyMode's Apex account does not expose a normal REST API key in the admin
// UI. The working source of truth is the authenticated Call Log JSON endpoint:
//   /+CCS Reports/call_log/update
//
// Credential contract:
// - system_settings.readymode_sync_enabled = "true"
// - system_settings.readymode_api_base_url or READYMODE_BASE_URL
// - READYMODE_USERNAME + READYMODE_PASSWORD Edge secrets for browser-login mode
// - optional readymode_api_key / READYMODE_API_KEY for future REST mode

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

type SettingMap = Record<string, string>;
type ReadyModeRow = Record<string, unknown>;

interface NormalizedCall {
  external_call_id: string;
  agent_raw: string | null;
  campaign_name: string | null;
  lead_phone: string | null;
  lead_first_name: string | null;
  lead_last_name: string | null;
  lead_email: string | null;
  disposition: string | null;
  disposition_at: string | null;
  call_started_at: string | null;
  call_ended_at: string | null;
  duration_seconds: number | null;
  recording_url: string | null;
  notes: string | null;
  raw: Record<string, unknown>;
}

interface SyncConfig {
  baseUrl: string;
  apiKey: string;
  accountId: string;
  authMode: "api" | "browser_login";
  username: string;
  password: string;
}

interface PullResult {
  source: "api" | "browser_login";
  rows: ReadyModeRow[];
  pagesFetched?: number;
  endpoint?: string;
}

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const SETTING_KEYS = [
  "readymode_api_base_url",
  "readymode_api_key",
  "readymode_account_id",
  "readymode_auth_mode",
  "readymode_sync_enabled",
];

const CALL_TYPES = [
  "6",
  "139",
  "140",
  "143",
  "141",
  "142",
  "3",
  "0",
  "User,%",
  "Queue,1",
  "Queue,13",
  "Queue,5",
  "Queue,14",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  const { data: logRow } = await sb
    .from("readymode_sync_log")
    .insert({ status: "running" })
    .select("id")
    .single();
  const logId = (logRow as { id?: string } | null)?.id;

  async function finish(status: "ok" | "error", patch: Record<string, unknown>) {
    if (!logId) return;
    await sb
      .from("readymode_sync_log")
      .update({ status, finished_at: new Date().toISOString(), ...patch })
      .eq("id", logId);
  }

  try {
    const { data: settings } = await sb
      .from("system_settings")
      .select("key, value")
      .in("key", SETTING_KEYS);

    const cfgMap = Object.fromEntries(
      ((settings ?? []) as Array<{ key: string; value: string | null }>).map((r) => [
        r.key,
        r.value ?? "",
      ]),
    ) as SettingMap;

    if (cfgMap.readymode_sync_enabled !== "true") {
      await finish("ok", { error_message: "sync disabled", pulled_count: 0 });
      return Response.json(
        { ok: true, skipped: true, reason: "sync disabled" },
        { headers: corsHeaders },
      );
    }

    const config = resolveConfig(cfgMap);
    if (!config.baseUrl) {
      await finish("error", { error_message: "missing ReadyMode base URL" });
      return Response.json(
        { ok: false, error: "missing ReadyMode base URL" },
        { status: 400, headers: corsHeaders },
      );
    }
    if (config.authMode === "api" && !config.apiKey) {
      await finish("error", { error_message: "missing ReadyMode API key" });
      return Response.json(
        { ok: false, error: "missing ReadyMode API key" },
        { status: 400, headers: corsHeaders },
      );
    }
    if (config.authMode === "browser_login" && (!config.username || !config.password)) {
      await finish("error", { error_message: "missing ReadyMode login secrets" });
      return Response.json(
        { ok: false, error: "missing ReadyMode login secrets" },
        { status: 400, headers: corsHeaders },
      );
    }

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const since = typeof body?.since === "string"
      ? new Date(body.since)
      : new Date(Date.now() - 25 * 3600_000);
    const until = typeof body?.until === "string" ? new Date(body.until) : new Date();
    const maxPages = clampNumber(body?.max_pages, 1, 60, config.authMode === "api" ? 1 : 12);

    const pulled = config.authMode === "api"
      ? await pullViaApi(config, since)
      : await pullViaBrowserLogin(config, since, until, maxPages);

    const normalizedRows = pulled.rows
      .map((r) => pulled.source === "api"
        ? normalizeApiCall(r)
        : normalizeBrowserCall(r, config.baseUrl, until.getUTCFullYear()))
      .filter((r): r is NormalizedCall => !!r?.external_call_id);
    // ReadyMode can repeat a call at page boundaries. PostgreSQL rejects an
    // upsert batch containing the same conflict key twice, so collapse those
    // overlaps before the single atomic write (latest copy wins).
    const rows = Array.from(
      new Map(normalizedRows.map((row) => [row.external_call_id, row])).values(),
    );

    let upserted = 0;
    if (rows.length > 0) {
      const { error } = await sb
        .from("readymode_dialer_calls")
        .upsert(rows, { onConflict: "external_call_id", ignoreDuplicates: false });
      if (error) throw error;
      upserted = rows.length;
    }

    const { data: matchResult } = await sb.rpc("fn_match_readymode_calls" as never);
    const matched = typeof matchResult === "object" && matchResult !== null
      ? Number((matchResult as Record<string, unknown>).matched_agents ?? 0)
      : 0;

    const since24h = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { count: ingest24h } = await sb
      .from("readymode_dialer_calls")
      .select("id", { count: "exact", head: true })
      .gte("imported_at", since24h);
    const { count: ingestTotal } = await sb
      .from("readymode_dialer_calls")
      .select("id", { count: "exact", head: true });

    const statePatch: Record<string, unknown> = {
      current_mode: "PULL",
      pull_enabled: true,
      last_error: null,
      last_error_at: null,
      ingest_total: ingestTotal ?? rows.length,
      ingest_24h: ingest24h ?? 0,
    };
    if (rows.length) statePatch.last_ingest_at = new Date().toISOString();
    await sb.from("readymode_bot_state").update(statePatch).eq("id", 1);

    // A zero-row pull is not proof that the integration is healthy. If the
    // prior real ingest is already stale, log an error so the dashboard cannot
    // show a green sync simply because the poller itself ran.
    const { data: currentState } = await sb
      .from("readymode_bot_state")
      .select("last_ingest_at")
      .eq("id", 1)
      .maybeSingle();
    const lastRealIngest = (currentState as { last_ingest_at?: string | null } | null)?.last_ingest_at;
    const staleZeroPull = rows.length === 0 && (!lastRealIngest || Date.now() - new Date(lastRealIngest).getTime() > 2 * 3600_000);

    await finish(staleZeroPull ? "error" : "ok", {
      pulled_count: pulled.rows.length,
      inserted_count: upserted,
      matched_count: matched,
      error_message: staleZeroPull ? `ReadyMode returned 0 calls; last real ingest ${lastRealIngest ?? "never"}` : null,
      raw: {
        source: pulled.source,
        endpoint: pulled.endpoint ?? null,
        pages_fetched: pulled.pagesFetched ?? null,
        normalized: rows.length,
      },
    });

    return Response.json({
      ok: !staleZeroPull,
      source: pulled.source,
      pulled: pulled.rows.length,
      inserted: upserted,
      matched,
      pages_fetched: pulled.pagesFetched ?? null,
    }, { headers: corsHeaders });
  } catch (err) {
    const message = String((err as Error)?.message ?? err).slice(0, 1000);
    await finish("error", { error_message: message });
    await sb
      .from("readymode_bot_state")
      .update({ last_error: message, last_error_at: new Date().toISOString() })
      .eq("id", 1);
    return Response.json({ ok: false, error: message }, { status: 500, headers: corsHeaders });
  }
});

function resolveConfig(settings: SettingMap): SyncConfig {
  const baseUrl =
    clean(settings.readymode_api_base_url) ||
    clean(Deno.env.get("READYMODE_BASE_URL")) ||
    clean(Deno.env.get("READYMODE_API_BASE_URL"));
  const apiKey = clean(settings.readymode_api_key) || clean(Deno.env.get("READYMODE_API_KEY"));
  const accountId =
    clean(settings.readymode_account_id) || clean(Deno.env.get("READYMODE_ACCOUNT_ID"));
  const username = clean(Deno.env.get("READYMODE_USERNAME"));
  const password = clean(Deno.env.get("READYMODE_PASSWORD"));
  const authMode = clean(settings.readymode_auth_mode) === "api" || apiKey
    ? "api"
    : "browser_login";

  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey,
    accountId,
    username,
    password,
    authMode,
  };
}

async function pullViaApi(config: SyncConfig, since: Date): Promise<PullResult> {
  const url = new URL("/v1/calls", config.baseUrl);
  if (config.accountId) url.searchParams.set("account_id", config.accountId);
  url.searchParams.set("since", since.toISOString());

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ReadyMode API HTTP ${res.status}: ${text.slice(0, 500)}`);
  }

  const json = await res.json().catch(() => ({}));
  const rows = Array.isArray(json) ? json : json?.data ?? json?.results ?? json?.calls ?? [];
  return { source: "api", rows: Array.isArray(rows) ? rows : [], endpoint: url.toString() };
}

async function pullViaBrowserLogin(
  config: SyncConfig,
  since: Date,
  until: Date,
  maxPages: number,
): Promise<PullResult> {
  const session = await loginReadyMode(config);
  const allRows: ReadyModeRow[] = [];
  let pages = 1;
  let pagesFetched = 0;

  for (let page = 0; page < Math.min(pages, maxPages); page += 1) {
    const url = new URL("/+CCS Reports/call_log/update", config.baseUrl);
    const params = callLogParams(since, until, page);
    for (const [key, value] of params.entries()) url.searchParams.append(key, value);

    const res = await session.request(url.toString(), {
      headers: {
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
    });

    const contentType = res.headers.get("content-type") ?? "";
    const text = await res.text();
    if (!res.ok || !contentType.includes("json")) {
      throw new Error(
        `ReadyMode call log HTTP ${res.status} ${contentType}: ${text.slice(0, 300)}`,
      );
    }

    const json = JSON.parse(text);
    if (json?.error) throw new Error(`ReadyMode call log error: ${String(json.error)}`);
    const resultRows = Object.values(json?.results ?? {}) as ReadyModeRow[];
    allRows.push(...resultRows);
    pages = clampNumber(json?.pages, 1, maxPages, 1);
    pagesFetched += 1;
  }

  return {
    source: "browser_login",
    rows: allRows,
    pagesFetched,
    endpoint: "/+CCS Reports/call_log/update",
  };
}

async function loginReadyMode(config: SyncConfig) {
  const cookies = new Map<string, string>();
  const base = config.baseUrl;
  const origin = new URL(base).origin;

  async function request(input: string, init: RequestInit = {}) {
    let url = input;
    let nextInit = init;

    for (let redirects = 0; redirects < 6; redirects += 1) {
      const headers = new Headers(nextInit.headers ?? {});
      headers.set("User-Agent", USER_AGENT);
      headers.set("Origin", origin);
      if (cookies.size > 0) {
        headers.set(
          "Cookie",
          [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; "),
        );
      }

      const res = await fetch(url, { ...nextInit, headers, redirect: "manual" });
      storeCookies(cookies, res.headers);

      const location = res.headers.get("location");
      if (location && res.status >= 300 && res.status < 400) {
        url = new URL(location, url).toString();
        nextInit = { method: "GET" };
        continue;
      }

      return res;
    }

    throw new Error("ReadyMode login redirect loop");
  }

  const loginUrl = `${base}/login_new/`;
  await request(`${loginUrl}?then=%2B%20CCS%20Reports%2Fcall_log`);

  const makeLoginForm = (extra?: Record<string, string>) => {
    const form = new URLSearchParams({
      autoequals: "WebRTC",
      user_tz: "America/Chicago",
      use_phone_module: "none",
      then: "/+CCS%20Reports/call_log",
      login_account: config.username,
      login_password: config.password,
      login_as_admin: "on",
      ...extra,
    });
    return form;
  };

  let res = await request(loginUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: loginUrl,
    },
    body: makeLoginForm(),
  });

  let html = await res.text();
  if (/already logged in/i.test(html)) {
    res = await request(loginUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: loginUrl,
      },
      body: makeLoginForm({ logout_other_sessions: "on" }),
    });
    html = await res.text();
  }

  if (/login_account|Sign in/i.test(html) && !html.includes("call_log__settings")) {
    throw new Error("ReadyMode login failed");
  }

  const verify = await request(`${base}/+CCS%20Reports/call_log`, {
    headers: { Accept: "text/html" },
  });
  const verifyHtml = await verify.text();
  if (!verifyHtml.includes("call_log__settings")) {
    throw new Error("ReadyMode call log not available after login");
  }

  return { request };
}

function callLogParams(since: Date, until: Date, page: number) {
  const params = new URLSearchParams();
  params.set("update", "1");
  for (const type of CALL_TYPES) params.append("report[types][]", type);
  params.set("report[time_from_d]", formatReadyModeDate(since));
  params.set("report[time_from_dateonly]", "1");
  params.set("report[time_to_d]", formatReadyModeDate(until));
  params.set("report[time_to_dateonly]", "1");
  params.set("report[restrict_uid]", "0");
  params.set("report[restrict_campaign]", "0");
  params.set("report[restrict_batch]", "0");
  params.set("report[sourceFilter]", "-1");
  params.set("report[durationFilter]", "-1");
  params.set("report[callTypeFilter]", "_");
  params.set("report[page]", String(page));
  return params;
}

function normalizeApiCall(c: ReadyModeRow): NormalizedCall | null {
  const external = firstString(c, ["id", "external_call_id", "call_id", "uniqueid"]);
  if (!external) return null;
  const duration = firstNumber(c, ["duration_sec", "duration_seconds", "duration"]);
  return {
    external_call_id: external,
    agent_raw: firstString(c, ["agent", "agent_raw", "user", "username"]),
    campaign_name: firstString(c, ["campaign", "campaign_name", "list"]),
    lead_phone: firstString(c, ["phone", "lead_phone", "phone_number", "to"]),
    lead_first_name: firstString(c, ["first_name", "lead_first_name"]),
    lead_last_name: firstString(c, ["last_name", "lead_last_name"]),
    lead_email: firstString(c, ["email", "lead_email"]),
    disposition: firstString(c, ["disposition", "call_result", "result"]),
    disposition_at: firstString(c, ["disposition_at"]),
    call_started_at: firstString(c, ["started_at", "call_started_at", "start_time"]),
    call_ended_at: firstString(c, ["ended_at", "call_ended_at", "end_time"]),
    duration_seconds: duration,
    recording_url: firstString(c, ["recording_url", "recording", "audio_url"]),
    notes: firstString(c, ["notes", "comment"]),
    raw: c,
  };
}

function normalizeBrowserCall(
  row: ReadyModeRow,
  baseUrl: string,
  yearHint: number,
): NormalizedCall | null {
  const id = firstString(row, ["id"]);
  if (!id) return null;

  const file = plain(firstString(row, ["File"]) ?? "");
  const phoneMatch = file.match(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
  const leadPhone = phoneMatch?.[0] ?? null;
  const nameText = phoneMatch ? file.slice(0, phoneMatch.index).trim() : file.trim();
  const nameParts = nameText.split(/\s+/).filter(Boolean);
  const startedAt = parseReadyModeTime(firstString(row, ["Time"]), yearHint);
  const duration = parseDurationSeconds(firstString(row, ["Calltime"]));

  return {
    external_call_id: id,
    agent_raw: firstString(row, ["User"]),
    campaign_name: firstString(row, ["call_type"]),
    lead_phone: leadPhone,
    lead_first_name: nameParts[0] ?? null,
    lead_last_name: nameParts[1] ?? null,
    lead_email: null,
    disposition: firstString(row, ["Type"]),
    disposition_at: startedAt,
    call_started_at: startedAt,
    call_ended_at: addSecondsIso(startedAt, duration),
    duration_seconds: duration,
    recording_url: absoluteUrl(firstString(row, ["RecId"]), baseUrl),
    notes: blankToNull(plain(firstString(row, ["Updated Status"]) ?? "")),
    raw: { ...row, source: "readymode_call_log_update" },
  };
}

function storeCookies(cookies: Map<string, string>, headers: Headers) {
  const withHelper = headers as Headers & { getSetCookie?: () => string[] };
  const lines = withHelper.getSetCookie?.() ?? splitSetCookie(headers.get("set-cookie"));
  for (const line of lines) {
    const [pair] = line.split(";");
    const eq = pair.indexOf("=");
    if (eq > 0) cookies.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
}

function splitSetCookie(header: string | null) {
  if (!header) return [];
  return header.split(/,(?=\s*[^;,=]+=[^;,]+;)/g).map((s) => s.trim()).filter(Boolean);
}

function formatReadyModeDate(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  }).formatToParts(date);
  const value = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${value("month")}/${value("day")}/${value("year")}`;
}

function parseReadyModeTime(value: string | null, yearHint: number) {
  const text = plain(value ?? "");
  const match = text.match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{1,2}):(\d{2})(AM|PM)$/i);
  if (!match) return null;
  const month = monthNumber(match[1]);
  if (!month) return null;
  let hour = Number(match[3]);
  const minute = Number(match[4]);
  const ampm = match[5].toUpperCase();
  if (ampm === "PM" && hour < 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;
  const day = Number(match[2]);
  const offset = chicagoOffset(yearHint, month, day);
  return `${yearHint}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00${offset}`;
}

function chicagoOffset(year: number, month: number, day: number) {
  const dstStart = nthWeekdayOfMonth(year, 3, 0, 2);
  const dstEnd = nthWeekdayOfMonth(year, 11, 0, 1);
  const current = Date.UTC(year, month - 1, day);
  return current >= dstStart && current < dstEnd ? "-05:00" : "-06:00";
}

function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return Date.UTC(year, month - 1, 1 + offset + (n - 1) * 7);
}

function parseDurationSeconds(value: string | null) {
  const text = plain(value ?? "").toLowerCase();
  if (!text) return null;
  if (/^<\s*30s?$/.test(text)) return 30;
  const min = Number(text.match(/(\d+)\s*m/)?.[1] ?? 0);
  const sec = Number(text.match(/(\d+)\s*s/)?.[1] ?? 0);
  if (min || sec) return min * 60 + sec;
  const n = Number(text.match(/\d+/)?.[0] ?? NaN);
  return Number.isFinite(n) ? n : null;
}

function addSecondsIso(startedAt: string | null, seconds: number | null) {
  if (!startedAt || seconds == null) return null;
  const end = new Date(new Date(startedAt).getTime() + seconds * 1000);
  return Number.isNaN(end.getTime()) ? null : end.toISOString();
}

function plain(value: string) {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function absoluteUrl(value: string | null, baseUrl: string) {
  if (!value) return null;
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

function firstString(row: ReadyModeRow, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim() !== "" && plain(value) !== "&nbsp;") {
      return plain(value);
    }
    if (typeof value === "number") return String(value);
  }
  return null;
}

function firstNumber(row: ReadyModeRow, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function blankToNull(value: string) {
  const cleanValue = value.trim();
  return cleanValue && cleanValue !== "-" ? cleanValue : null;
}

function monthNumber(name: string) {
  return [
    "jan",
    "feb",
    "mar",
    "apr",
    "may",
    "jun",
    "jul",
    "aug",
    "sep",
    "oct",
    "nov",
    "dec",
  ].indexOf(name.slice(0, 3).toLowerCase()) + 1;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}
