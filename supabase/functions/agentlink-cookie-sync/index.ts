/**
 * agentlink-cookie-sync
 *
 * Authorized agency pull from AgentLink using the saved browser session
 * cookie in system_settings.agent_link_session_cookie. This replaces the
 * fragile Postgres pg_net pull for live policy/deal truth; Edge Runtime
 * fetch() handles AgentLink's large JSON response reliably.
 *
 * Body: { cookie?: string, dry_run?: boolean, agent_id?: string }
 * - cookie omitted: use saved system setting
 * - agent_id omitted: route policy-by-policy via policy.userId ->
 *   agents.insuracloud_user_id
 * - agent_id provided: only import policies whose upstream userId maps to
 *   that local agent
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

type AdminClient = ReturnType<typeof createClient<any>>;

/**
 * MP-400: unwrap a cookie that a writer JSON-encoded into a TEXT column.
 * A real Cookie header never starts with a double quote, so a leading+trailing
 * quote pair is unambiguously a storage-format artefact, not cookie data.
 */
function unwrapCookie(raw: unknown): string {
  let v = String(raw ?? "").trim();
  if (v.length > 1 && v.startsWith('"') && v.endsWith('"')) {
    // empty-catch-allow:not-json-means-not-quoted-so-the-raw-value-is-already-correct
    try { const p = JSON.parse(v); if (typeof p === "string") v = p; } catch { /* keep raw */ }
  }
  return v.trim();
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BASE = "https://agentlink.insuracloud.ai";

const PERSISTENT_BOT_TOKEN = Deno.env.get("BOT_SQL_PERSISTENT_TOKEN")?.trim() ?? "";

type AgentRow = {
  id: string;
  insuracloud_user_id: number | null;
};

type CarrierRow = {
  id: string;
  name: string | null;
  insuracloud_carrier_id: number | null;
};

type SyncBody = {
  cookie?: string;
  agent_id?: string;
  dry_run?: boolean;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function num(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function dateOr(v: unknown, fallback: string): string {
  const s = str(v);
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : fallback;
}

function dateOrNull(v: unknown): string | null {
  const s = str(v);
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

function timestampOrNull(v: unknown): string | null {
  const s = str(v);
  if (!s || !/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const t = new Date(s).toISOString();
  return t;
}

function mapStatus(raw: unknown): string {
  const s = String(raw ?? "").trim().toLowerCase();
  if (["active", "issued", "in force", "lapse pending"].includes(s)) return "active";
  if (s === "lapsed") return "lapsed";
  if (["cancelled", "not taken", "nto", "declined", "withdrawn"].includes(s)) return "cancelled";
  if (["chargeback", "charged back"].includes(s)) return "charged_back";
  return "submitted";
}

function pipelineFromStatus(status: string): string {
  if (status === "active") return "approved";
  if (status === "lapsed") return "lapsed";
  return "submitted";
}

function policyStatus(p: any): string | null {
  return str(p?.policyStatus?.standardStatus) ?? str(p?.policy_status_standard) ?? str(p?.status);
}

function upstreamUserId(p: any): number | null {
  const raw = str(p?.userId ?? p?.user_id ?? p?.agentUserId);
  if (!raw || !/^\d+$/.test(raw)) return null;
  return Number(raw);
}

function upstreamCarrierId(p: any): number | null {
  const raw = str(p?.carrierId ?? p?.carrier_id);
  if (!raw || !/^\d+$/.test(raw)) return null;
  return Number(raw);
}

async function resolveBotTokens(sb: AdminClient): Promise<string[]> {
  const tokens: string[] = [];
  if (PERSISTENT_BOT_TOKEN.length > 16) tokens.push(PERSISTENT_BOT_TOKEN);
  const env = Deno.env.get("APEX_BOT_TOKEN");
  if (env && env.length > 16) tokens.push(env);
  const { data } = await sb.from("system_settings").select("value").eq("key", "apex_bot_token").maybeSingle();
  const setting = (data as { value?: string } | null)?.value;
  if (setting && setting.length > 16) tokens.push(setting);
  return tokens;
}

async function authorize(req: Request, sb: AdminClient) {
  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "";
  const presented = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!presented) return { ok: false, status: 401, error: "Unauthorized" };

  const validTokens = await resolveBotTokens(sb);
  if (validTokens.includes(presented)) return { ok: true, mode: "bot" };

  const { data: userData } = await sb.auth.getUser(presented);
  const userId = userData?.user?.id;
  if (!userId) return { ok: false, status: 401, error: "Unauthorized" };

  const { data: isAdmin } = await sb.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (!isAdmin) return { ok: false, status: 403, error: "Admin required" };
  return { ok: true, mode: "admin", userId };
}

async function fetchWithCookie(path: string, cookie: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      Cookie: cookie,
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; APEX-sync/1.2)",
      "X-Requested-With": "XMLHttpRequest",
    },
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { ok: res.ok, status: res.status, body, text };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  const auth = await authorize(req, sb);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  // MP-268: single-flight guard. The 1-minute watchdog kept firing while a run
  // was still in flight — measured 3 syncs starting inside 61s and 2 more 19s
  // apart. Each one re-reads the whole book and writes the same rows, so they
  // contend on `deals` and every run gets slower: a solo run finishes in 46s,
  // overlapping runs stretched to 133-168s and some were reaped as stuck. The
  // reaper already retires abandoned rows, so anything still `running` and
  // younger than the reap window is genuinely alive — yield to it.
  {
    const { data: inFlight } = await sb
      .from("agentlink_sync_log")
      .select("id, started_at")
      .eq("status", "running")
      .gte("started_at", new Date(Date.now() - 5 * 60_000).toISOString())
      .limit(1)
      .maybeSingle();
    if (inFlight?.id) {
      // Not a fake success: no work was needed, and no log row is written so
      // this never pollutes the ok/stuck ratio.
      return json({
        ok: true,
        skipped: "already_running",
        in_flight_since: (inFlight as { started_at?: string }).started_at ?? null,
      });
    }
  }

  const startedAt = new Date().toISOString();
  const { data: logRow } = await sb
    .from("agentlink_sync_log")
    .insert({ status: "running", error_message: "edge: deals" })
    .select("id")
    .single();
  const logId = logRow?.id as string | undefined;

  const finishLog = async (patch: Record<string, unknown>) => {
    if (!logId) return;
    await sb
      .from("agentlink_sync_log")
      .update({ finished_at: new Date().toISOString(), ...patch })
      .eq("id", logId);
  };

  try {
    const body = await req.json().catch(() => ({})) as SyncBody;
    const dryRun = !!body.dry_run;

    let cookie = (body.cookie ?? "").trim();
    if (!cookie) {
      const { data: setting } = await sb
        .from("system_settings")
        .select("value")
        .eq("key", "agent_link_session_cookie")
        .maybeSingle();
      // MP-400: system_settings.value is TEXT, and a writer that stored
      // to_jsonb(cookie::text) landed the value WITH its surrounding JSON
      // quotes. .trim() strips whitespace, not quotes, so this function sent
      // `"connect.sid=..."` as the Cookie header and AgentLink returned 401 on
      // a live cookie for 7h on 2026-09-03. The writer now stores plain text,
      // but a cookie can never legitimately begin with a double quote, so
      // unwrap defensively rather than trusting every future writer.
      cookie = unwrapCookie((setting as { value?: string } | null)?.value);
    }

    if (!cookie || cookie.length < 20) {
      await finishLog({ status: "no_cookie", error_message: "edge: no cookie" });
      return json({
        ok: false,
        error: "Missing AgentLink cookie",
        hint: "Save a fresh cookie at /dashboard/agentlink-sync.",
      }, 400);
    }

    const dealsResp = await fetchWithCookie("/api/deals", cookie);
    if (!dealsResp.ok) {
      await finishLog({
        status: "error",
        upstream_status: dealsResp.status,
        error_message: `edge: /api/deals ${dealsResp.status}: ${dealsResp.text.slice(0, 240)}`,
      });
      return json({
        ok: false,
        error: "AgentLink /api/deals failed",
        upstream_status: dealsResp.status,
        upstream_body: dealsResp.text.slice(0, 400),
      }, 502);
    }

    // MP-268 truth-layer guard: a 200 with a non-JSON/HTML body means the cookie expired
    // (AgentLink served a login page), NOT an empty book. Log auth_failed — never fake "empty ok".
    // Purely additive: the happy path (valid JSON) has body !== null and skips this entirely.
    if (dealsResp.body === null && dealsResp.text && dealsResp.text.trim().length > 0) {
      const sample = dealsResp.text.trim().slice(0, 200).toLowerCase();
      if (
        sample.startsWith("<") || sample.includes("<!doctype") || sample.includes("<html") ||
        sample.includes("login") || sample.includes("sign in")
      ) {
        await finishLog({
          status: "auth_failed",
          upstream_status: dealsResp.status,
          error_message: `edge: cookie expired — /api/deals returned non-JSON (login/HTML) with HTTP ${dealsResp.status}`,
        });
        return json({
          ok: false,
          error: "AgentLink cookie expired (received login page, not JSON)",
          upstream_status: dealsResp.status,
        }, 401);
      }
    }

    const payload: any = dealsResp.body;
    const policies: any[] = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.policies)
        ? payload.policies
        : Array.isArray(payload?.data)
          ? payload.data
          : Array.isArray(payload?.deals)
            ? payload.deals
            : [];

    if (policies.length === 0) {
      await finishLog({
        status: "empty",
        upstream_status: dealsResp.status,
        policies_seen: 0,
        error_message: "edge: empty",
      });
      return json({ ok: true, policies_seen: 0, deals_inserted: 0, deals_updated: 0, dry_run: dryRun });
    }

    const [{ data: agents }, { data: carriers }, { data: samIds }] = await Promise.all([
      sb.from("agents").select("id, insuracloud_user_id").not("insuracloud_user_id", "is", null),
      sb.from("carriers").select("id, name, insuracloud_carrier_id"),
      sb.rpc("sam_agent_ids_to_exclude"),
    ]);

    const agentByInsuraId = new Map<number, string>();
    for (const a of (agents ?? []) as AgentRow[]) {
      if (a.insuracloud_user_id) agentByInsuraId.set(Number(a.insuracloud_user_id), a.id);
    }

    const samSet = new Set<string>((samIds ?? []) as string[]);
    const carrierByExt = new Map<number, string>();
    const carrierByName = new Map<string, string>();
    for (const c of (carriers ?? []) as CarrierRow[]) {
      if (c.insuracloud_carrier_id) carrierByExt.set(Number(c.insuracloud_carrier_id), c.id);
      if (c.name) carrierByName.set(c.name.toLowerCase().trim(), c.id);
    }

    const summary = {
      ok: true,
      started_at: startedAt,
      policies_seen: policies.length,
      deals_inserted: 0,
      deals_updated: 0,
      deals_unchanged: 0,
      deals_skipped: 0,
      unmapped_user_ids: {} as Record<string, number>,
      errors: [] as string[],
      dry_run: dryRun,
    };

    // MP-268 perf: this loop used to issue one SELECT per policy before its
    // UPDATE/INSERT — ~1,600 extra sequential round-trips against a 150s edge
    // limit. Measured over 24h only 34% of runs finished (30 ok / 55 reaped as
    // stuck); successful ones averaged 108s and peaked at 131s, i.e. right at
    // the ceiling and getting worse as the book grows. Prefetch the identity
    // map once (paginated — deals is already >1000 rows, past PostgREST's
    // default page) and the per-policy SELECT disappears.
    const existingByKey = new Map<string, string>();
    // MP-378: the composite key above is a MUTABLE business key. When AgentLink
    // corrects a deal's policyNumber (or reassigns its agent), the key changes,
    // the map misses, and the row falls to the INSERT path -- where it collides
    // with idx_deals_external_deal_id_unique, is caught as 23505, and is booked
    // as deals_skipped. Measured 2026-09-01..02 in postgres_logs: 386 distinct
    // external_deal_ids failing this way 8,887 times in 24h, i.e. the SAME rows
    // on every run, with status_updated_at frozen as far back as 2026-07-28
    // while the sync reported success. external_deal_id is the STABLE upstream
    // identity and is exactly what the constraint keys on, so map it too and
    // let it catch what the composite key drops. Second map, not a replacement:
    // the composite path still owns rows whose external id is null (AgentLink
    // sends placeholders that are coerced to NULL above).
    const existingByExternal = new Map<string, string>();
    // MP-431: the status each existing row holds NOW, so status_updated_at is
    // stamped only on a real transition (it means "when the status changed",
    // and v_lapses_30d_detail / v_ceo_command_center read it that way).
    const existingStatus = new Map<string, string | null>();
    {
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data: page, error: pageErr } = await sb
          .from("deals")
          .select("id, agent_id, policy_number, external_deal_id, status")
          // MP-378: .range() without ORDER BY is non-deterministic -- Postgres
          // may return a row on two pages or on NONE, so a paginated prefetch
          // silently drops rows and the map comes back incomplete. Measured:
          // after the external_deal_id fallback landed, 190 collisions REMAINED
          // in the same run, which is impossible if the map were complete (the
          // 23505 proves the row exists). Order by the primary key so every row
          // appears exactly once.
          .order("id", { ascending: true })
          .range(from, from + PAGE - 1);
        if (pageErr) {
          // Fail loud: a partial map would silently turn updates into inserts
          // and duplicate the book.
          await finishLog({
            status: "error",
            upstream_status: dealsResp.status,
            error_message: `edge: deal prefetch failed: ${pageErr.message}`,
          });
          return json({ ok: false, error: `deal prefetch failed: ${pageErr.message}` }, 500);
        }
        const rows = (page ?? []) as { id: string; agent_id: string | null; policy_number: string | null; external_deal_id: string | null; status: string | null }[];
        for (const r of rows) {
          if (r.agent_id && r.policy_number) existingByKey.set(`${r.agent_id}|${r.policy_number}`, r.id);
          if (r.external_deal_id) existingByExternal.set(r.external_deal_id, r.id);
          existingStatus.set(r.id, r.status);
        }
        if (rows.length < PAGE) break;
      }
    }

    for (const p of policies) {
      const userId = upstreamUserId(p);
      const agentId = userId ? agentByInsuraId.get(userId) : null;
      if (!agentId) {
        const key = userId ? String(userId) : "missing";
        summary.unmapped_user_ids[key] = (summary.unmapped_user_ids[key] ?? 0) + 1;
        summary.deals_skipped++;
        continue;
      }
      if (body.agent_id && body.agent_id !== agentId) {
        summary.deals_skipped++;
        continue;
      }
      if (samSet.has(agentId)) {
        summary.deals_skipped++;
        continue;
      }

      // AgentLink returns garbage placeholder external IDs ("0000", "RN", "123", "123456", "null") for some deals.
      // Left raw, they collide on idx_deals_external_deal_id_unique within a single batch and blow up the whole sync.
      // PG treats NULL as distinct per unique-index, so coerce placeholders to NULL.
      const PLACEHOLDER_EXTERNAL = /^(0+|RN|123|123456|null|none|n\/a|undefined)$/i;
      let external = str(p.id ?? p.external_deal_id ?? p.policyId);
      if (external && PLACEHOLDER_EXTERNAL.test(external)) external = null;
      const rawPolicyNumber = str(p.policyNumber ?? p.policy_number);
      const policyNumber = rawPolicyNumber ?? external;
      if (!policyNumber || PLACEHOLDER_EXTERNAL.test(policyNumber)) {
        summary.deals_skipped++;
        continue;
      }

      const carrierExt = upstreamCarrierId(p);
      const carrierName = str(p.carrierName ?? p.carrier_name ?? p.carrier);
      const carrierId = (carrierExt ? carrierByExt.get(carrierExt) : null)
        ?? (carrierName ? carrierByName.get(carrierName.toLowerCase().trim()) : null)
        ?? null;
      const status = mapStatus(policyStatus(p));
      const monthlyPremium = num(p.monthlyPremium ?? p.monthly_premium);
      const annualPremium = num(p.annualPremium ?? p.annual_premium) || monthlyPremium * 12;
      const effectiveDate = dateOr(p.effectiveDate ?? p.effective_date, new Date().toISOString().slice(0, 10));
      const row = {
        agent_id: agentId,
        carrier_id: carrierId,
        client_first_name: str(p.clientFirstName ?? p.client_first_name) ?? "Unknown",
        client_last_name: str(p.clientLastName ?? p.client_last_name) ?? "Unknown",
        client_phone: str(p.clientPhoneNumber ?? p.client_phone) ?? "UNKNOWN",
        client_dob: dateOr(p.clientDateOfBirth ?? p.client_dob, "1970-01-01"),
        product_sold: str(p.productSold ?? p.product_sold ?? p.product) ?? "Life Insurance",
        policy_number: policyNumber,
        monthly_premium: monthlyPremium,
        annual_premium: annualPremium,
        face_amount: num(p.faceAmount ?? p.face_amount),
        effective_date: effectiveDate,
        policy_expiration_date: dateOrNull(p.policyExpirationDate ?? p.policy_expiration_date),
        status,
        policy_status_standard: policyStatus(p),
        status_updated_at: new Date().toISOString(),
        source: "agent_link",
        pipeline_stage: pipelineFromStatus(status),
        external_deal_id: external,
        notes: str(p.notes),
        posted_at: timestampOrNull(p.createdAt ?? p.created_at) ?? `${effectiveDate}T00:00:00.000Z`,
      };

      if (dryRun) {
        summary.deals_skipped++;
        continue;
      }

      const dealKey = `${row.agent_id}|${row.policy_number}`;
      // Composite key first (it owns external-id-less rows); fall back to the
      // stable upstream id so a corrected policy_number/agent UPDATES the deal
      // it belongs to instead of colliding on the unique index.
      const existingId = existingByKey.get(dealKey)
        ?? (external ? existingByExternal.get(external) : undefined);

      if (existingId) {
        // MP-431: every run used to rewrite every row with a fresh
        // status_updated_at, so 1,264 unchanged deals became 1,264 WAL records,
        // realtime packets and AFTER-trigger fan-outs per sync — the storm that
        // saturated the 2-vCPU database. Stamp the timestamp only on a real
        // transition; the zz_suppress_noop_update trigger then turns an
        // unchanged row into a no-op (0 rows written), and the returned rows say
        // honestly whether anything changed instead of booking every PATCH as
        // an update.
        const patch: Record<string, unknown> = { ...row };
        if (existingStatus.has(existingId) && existingStatus.get(existingId) === row.status) {
          delete patch.status_updated_at;
        }
        const { data: written, error } = await sb.from("deals").update(patch).eq("id", existingId).select("id");
        if (error) {
          if (error.code === "23505") summary.deals_skipped++;
          else summary.errors.push(`${policyNumber}: update ${error.message}`);
        } else if ((written ?? []).length === 0) {
          summary.deals_unchanged++;
        } else {
          summary.deals_updated++;
        }
        continue;
      }

      const { data: inserted, error } = await sb
        .from("deals")
        .insert(row)
        .select("id")
        .maybeSingle();
      if (error) {
        if (error.code === "23505") summary.deals_skipped++;
        else summary.errors.push(`${policyNumber}: insert ${error.message}`);
      } else {
        summary.deals_inserted++;
        // Keep the map truthful so a policy repeated inside one payload updates
        // instead of inserting a second row.
        if (inserted?.id) {
          existingByKey.set(dealKey, inserted.id as string);
          if (external) existingByExternal.set(external, inserted.id as string);
        }
      }
    }

    // supabase-js QueryBuilder is a thenable but does NOT expose .catch — must await + try/catch
    try {
      await sb.from("insuracloud_snapshots").insert({
        agent_id: null,
        snapshot_date: new Date().toISOString().slice(0, 10),
        snapshot_time: new Date().toISOString(),
        source: "agentlink-cookie-sync:/api/deals",
        raw_payload: { count: policies.length, unchanged: summary.deals_unchanged, sample: policies.slice(0, 5) },
      });
    } catch (_snapshotErr) { /* snapshot is audit-only; never block the sync */ }

    await finishLog({
      status: summary.errors.length ? "error" : "ok",
      upstream_status: dealsResp.status,
      policies_seen: summary.policies_seen,
      deals_inserted: summary.deals_inserted,
      deals_updated: summary.deals_updated,
      error_message: summary.errors.length
        ? `edge: ${summary.errors.slice(0, 3).join(" | ")}`
        : `edge: ${summary.deals_inserted} new, ${summary.deals_updated} updated, ${summary.deals_unchanged} unchanged, ${summary.deals_skipped} skipped`,
    });

    return json(summary, summary.errors.length ? 207 : 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishLog({ status: "error", error_message: `edge: ${message.slice(0, 480)}` });
    return json({ ok: false, error: message }, 500);
  }
});
