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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BASE = "https://agentlink.insuracloud.ai";

const PERSISTENT_BOT_TOKEN =
  Deno.env.get("BOT_SQL_PERSISTENT_TOKEN") ||
  "37740df6728db61e128392dbbdae34be1dccf862eebe09925ff321182fb30ebd";

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
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
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

async function resolveBotTokens(sb: ReturnType<typeof createClient>): Promise<string[]> {
  const tokens = [PERSISTENT_BOT_TOKEN];
  const env = Deno.env.get("APEX_BOT_TOKEN");
  if (env && env.length > 16) tokens.push(env);
  const { data } = await sb.from("system_settings").select("value").eq("key", "apex_bot_token").maybeSingle();
  const setting = (data as { value?: string } | null)?.value;
  if (setting && setting.length > 16) tokens.push(setting);
  return tokens;
}

async function authorize(req: Request, sb: ReturnType<typeof createClient>) {
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
      cookie = String((setting as { value?: string } | null)?.value ?? "").trim();
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
      deals_skipped: 0,
      unmapped_user_ids: {} as Record<string, number>,
      errors: [] as string[],
      dry_run: dryRun,
    };

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

      const external = str(p.id ?? p.external_deal_id ?? p.policyId);
      const policyNumber = str(p.policyNumber ?? p.policy_number ?? external);
      if (!policyNumber) {
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

      const { data: existing, error: lookupError } = await sb
        .from("deals")
        .select("id, status")
        .eq("agent_id", row.agent_id)
        .eq("policy_number", row.policy_number)
        .limit(1)
        .maybeSingle();
      if (lookupError) {
        summary.errors.push(`${policyNumber}: lookup ${lookupError.message}`);
        continue;
      }

      if (existing?.id) {
        const { error } = await sb.from("deals").update(row).eq("id", existing.id);
        if (error) summary.errors.push(`${policyNumber}: update ${error.message}`);
        else summary.deals_updated++;
        continue;
      }

      const { error } = await sb.from("deals").insert(row);
      if (error) {
        if (error.code === "23505") summary.deals_skipped++;
        else summary.errors.push(`${policyNumber}: insert ${error.message}`);
      } else {
        summary.deals_inserted++;
      }
    }

    await sb.from("insuracloud_snapshots").insert({
      agent_id: null,
      snapshot_date: new Date().toISOString().slice(0, 10),
      snapshot_time: new Date().toISOString(),
      source: "agentlink-cookie-sync:/api/deals",
      raw_payload: { count: policies.length, sample: policies.slice(0, 5) },
    }).catch(() => {});

    await finishLog({
      status: summary.errors.length ? "error" : "ok",
      upstream_status: dealsResp.status,
      policies_seen: summary.policies_seen,
      deals_inserted: summary.deals_inserted,
      deals_updated: summary.deals_updated,
      error_message: summary.errors.length
        ? `edge: ${summary.errors.slice(0, 3).join(" | ")}`
        : `edge: ${summary.deals_inserted} new, ${summary.deals_updated} updated, ${summary.deals_skipped} skipped`,
    });

    return json(summary, summary.errors.length ? 207 : 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishLog({ status: "error", error_message: `edge: ${message.slice(0, 480)}` });
    return json({ ok: false, error: message }, 500);
  }
});
