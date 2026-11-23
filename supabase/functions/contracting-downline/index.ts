// contracting-downline — MP-304 (2026-11-23). One function, the whole Ethos contracting lane.
//
// Public (no login) — the ONE link a manager sends: apex-financial.org/contract/<manager-slug>
//   resolve  {slug}                       → who the link belongs to + where it goes after
//   join     {slug, first_name, last_name, email, phone, npn, license_status}
//            → durable intake (Ethos leg queued) + login/agent provisioned under that manager, THEN the MGN
//              redirect URL. The record is committed and read back before the browser ever leaves.
//
// Signed in (manager or admin; the database scopes every row to the caller's own downline):
//   actor                                 → caller, cap, defaults, their link
//   verdict  {rows:[...]}                 → one verdict per row, nothing written
//   submit   {rows:[...]}                 → commit the rows whose verdict is ok; report partial as partial
//   update   {agent_id, ...}              → identity / comp change → Agent Updates tab queue
//   mgn_link {url}                        → store the manager's MGN referral link (host-allowlisted in SQL)
//   downlines                             → the board
//   refresh_sheet                         → re-mirror the Ethos sheet (at most once per 10 minutes)
//
// What this function does NOT do: write to the sheet (the outbox dispatcher does, behind
// ethos_sheet_writes_enabled), invent a comp level (default or the manager's explicit choice, capped at
// their own), or redirect anywhere but mgnagenthub.com.
//
// supabase-js is pinned to 2.90.1 like submit-contracting-intake: that is the dependency graph proven alive in
// production; 2.50.0 is dead at boot on this project (esm.sh resolves transitive deps at request time).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { corsHeaders, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { honeypotResponseBody, isHoneypotTripped, rateLimitVerdict } from "../_shared/intake-guard.ts";
import { provisionOnboarding, type LicensePath } from "../_shared/provision-onboarding.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const MAX_ROWS = 200;
const MGN_HOST = /^https:\/\/(www\.)?mgnagenthub\.com(\/|$)/;
const PUBLIC_ACTIONS = new Set(["resolve", "join"]);
const USER_ACTIONS = new Set(["actor", "verdict", "submit", "update", "mgn_link", "downlines", "refresh_sheet"]);

type Row = Record<string, unknown>;
type Verdict = Record<string, unknown> & { ok?: boolean; verdict?: string };

const FIELD_KEYS = ["first_name", "last_name", "email", "phone", "npn", "request_type", "comp_pct", "reason", "upline_agent_id", "row_key"] as const;

/** The only keys a row may carry into the database, each as a trimmed string (numbers for comp). */
function pickRow(raw: unknown): Row {
  const r = (raw && typeof raw === "object" ? raw : {}) as Row;
  const out: Row = {};
  for (const k of FIELD_KEYS) {
    const v = r[k];
    if (v === null || v === undefined) continue;
    if (k === "comp_pct") { const n = Number(v); if (Number.isFinite(n)) out[k] = n; continue; }
    if (typeof v === "string") out[k] = v.slice(0, 300);
    else if (typeof v === "number") out[k] = String(v);
  }
  for (const b of ["license_attested", "eo_attested", "confirm_downgrade", "confirm_near_duplicate", "sub_agent_head"]) {
    if (b in r) out[b] = r[b] === true || r[b] === "true";
  }
  return out;
}

function statusFor(v: Verdict): number {
  if (v.ok) return 200;
  switch (v.verdict) {
    case "needs_fix": return 400;
    case "would_downgrade_comp": return 409;
    case "npn_near_duplicate": return 409;
    case "npn_belongs_to_other_team": return 409;
    case "email_belongs_to_other": return 409;
    case "ambiguous_upline": return 400;
    default: return 400;
  }
}

function redact(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.replace(/[0-9]{5,}/g, "#####").slice(0, 200);
}

// deno-lint-ignore no-explicit-any
async function callerFromJwt(sb: any, req: Request) {
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!jwt || (ANON_KEY && jwt === ANON_KEY)) return null;
  const { data, error } = await sb.auth.getUser(jwt);
  if (error || !data?.user?.id) return null;
  // deno-lint-ignore no-explicit-any
  const user: any = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false },
  });
  return { userId: data.user.id, user };
}

/** Provision the login/agent for a committed intake that has no agent yet, then link it. */
async function provisionAndLink(
  // supabase-js carries no generated schema inside edge functions; an inferred generic collapses table
  // writes and rpc args to `never` (same boundary note as submit-contracting-intake).
  // deno-lint-ignore no-explicit-any
  sb: any,
  committed: Verdict,
  fields: { first_name: string; last_name: string; email: string; phone: string; npn: string },
  opts: { managerId: string | null; createdByPath: string; userSource: string; source: string },
): Promise<{ agentId: string | null; linked: boolean; error: string | null }> {
  const intakeId = String(committed.intake_id ?? "");
  let agentId = (committed.agent_id as string | null) ?? null;
  try {
    if (!agentId) {
      const out = await provisionOnboarding(sb, fields, "licensed", {
        managerId: opts.managerId, createdByPath: opts.createdByPath, userSource: opts.userSource,
      });
      agentId = out.agentId;
    }
    const { data, error } = await sb.rpc("fn_contracting_after_provision", { p_intake: intakeId, p_agent: agentId, p_source: opts.source });
    if (error) return { agentId, linked: false, error: redact(error.message) };
    return { agentId, linked: Boolean((data as Verdict)?.ok), error: null };
  } catch (e) {
    return { agentId, linked: false, error: redact(e) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("POST only", 405, "METHOD_NOT_ALLOWED");
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) return errorResponse("Server configuration missing", 503, "NOT_CONFIGURED");

  let body: Row;
  try { body = await req.json(); } catch { return errorResponse("A JSON body is required", 400, "VALIDATION_ERROR"); }
  if (!body || typeof body !== "object") return errorResponse("A JSON body is required", 400, "VALIDATION_ERROR");
  const action = String(body.action ?? "").trim();
  if (!PUBLIC_ACTIONS.has(action) && !USER_ACTIONS.has(action)) return errorResponse("Unknown action", 400, "VALIDATION_ERROR");

  // deno-lint-ignore no-explicit-any
  const sb: any = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // ── Public: the one link ──────────────────────────────────────────────────────────────────────────────
  if (action === "resolve" || action === "join") {
    const slug = String(body.slug ?? "").trim().toLowerCase().slice(0, 120);
    if (!/^[a-z0-9-]{3,120}$/.test(slug)) return errorResponse("That link is not valid.", 404, "NO_SUCH_LINK");
    const { data: target, error: targetError } = await sb.rpc("fn_contract_link_target", { p_slug: slug });
    if (targetError) return errorResponse("We could not look that link up right now.", 503, "LOOKUP_UNAVAILABLE");
    const t = (target ?? {}) as Verdict;
    if (!t.ok) return errorResponse("That link is not valid.", 404, "NO_SUCH_LINK");
    const redirectUrl = String(t.redirect_url ?? "");
    if (!MGN_HOST.test(redirectUrl)) return errorResponse("The destination for this link is not configured.", 503, "REDIRECT_NOT_ALLOWED");

    if (action === "resolve") {
      return jsonResponse({ ok: true, slug, manager_name: t.manager_name, sub_agency: t.sub_agency, redirect_host: new URL(redirectUrl).host, custom_link: t.custom_link === true });
    }

    if (isHoneypotTripped(body)) return jsonResponse(honeypotResponseBody(), 202);
    const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const { data: allowed, error: rateError } = await sb.rpc("check_rate_limit", { _bucket_key: `contracting-downline:join:${ip}`, _max_requests: 8, _window_seconds: 300 });
    const rate = rateLimitVerdict({ allowed, error: rateError });
    if (rate === "reject_unavailable") return errorResponse("Submissions are temporarily unavailable. Try again shortly.", 503, "RATE_LIMIT_UNAVAILABLE");
    if (rate === "reject_rate_limited") return errorResponse("Too many submissions. Try again in a few minutes.", 429, "RATE_LIMIT");

    const row = pickRow(body);
    const fields = {
      first_name: String(row.first_name ?? "").trim(), last_name: String(row.last_name ?? "").trim(),
      email: String(row.email ?? "").trim().toLowerCase(), phone: String(row.phone ?? "").trim(), npn: String(row.npn ?? "").replace(/[^0-9]/g, ""),
    };
    const licensePath: LicensePath = String(body.license_status ?? "licensed").toLowerCase() === "unlicensed" ? "unlicensed" : "licensed";
    const managerId = String(t.manager_agent_id);

    if (licensePath === "unlicensed") {
      // Not licensed yet: park the intake (the core's pre-license path), put them under this manager, no
      // Ethos leg runs and there is nothing for MGN to do yet. They come back through the same link later.
      if (!fields.first_name || !fields.last_name || !fields.email || !fields.phone) return errorResponse("Name, email and mobile are needed.", 400, "VALIDATION_ERROR");
      const { data: core, error: coreError } = await sb.rpc("fn_contracting_intake_core", {
        p_first_name: fields.first_name, p_last_name: fields.last_name, p_email: fields.email, p_phone: fields.phone, p_npn: null,
        p_source: "one_link", p_submitted_by: null, p_license_status: "unlicensed", p_destinations: ["ethos_sheet"],
      });
      if (coreError) return errorResponse("Not saved. Try again.", 503, "SAVE_FAILED");
      const c = (core ?? {}) as Verdict;
      if (!c.ok) return errorResponse(String(c.error ?? "Not saved."), 400, "VALIDATION_ERROR", { field: c.field });
      const intakeId = String(c.intake_id);
      await sb.from("contracting_intakes").update({ upline_agent_id: managerId, sub_agency_name: t.sub_agency, request_type: "contracting" }).eq("id", intakeId);
      let agentId: string | null = null;
      try {
        agentId = (await provisionOnboarding(sb, fields, "unlicensed", { managerId, createdByPath: "contracting-downline", userSource: "contracting_one_link" })).agentId;
        await sb.rpc("fn_contracting_after_provision", { p_intake: intakeId, p_agent: agentId, p_source: "one_link_prelicense" });
      } catch (e) { console.error("[contracting-downline] prelicense provision:", redact(e)); }
      return jsonResponse({ ok: true, intake_id: intakeId, agent_id: agentId, parked: true, next: "licensing", manager_name: t.manager_name });
    }

    const { data: v, error: vError } = await sb.rpc("submit_downline_contracting", {
      p: { ...row, actor_agent_id: managerId, license_attested: true, eo_attested: false, source: "one_link", request_type: row.request_type ?? "contracting" },
      p_dry_run: false,
    });
    if (vError) return errorResponse("Not saved. Try again.", 503, "SAVE_FAILED");
    const verdict = (v ?? {}) as Verdict;
    if (!verdict.ok) return jsonResponse({ ok: false, ...verdict }, statusFor(verdict));

    const link = await provisionAndLink(sb, verdict, fields, { managerId, createdByPath: "contracting-downline", userSource: "contracting_one_link", source: "one_link" });
    // The intake is committed and queued regardless of whether the login provisioned; say exactly which happened.
    return jsonResponse({
      ok: true, intake_id: verdict.intake_id, agent_id: link.agentId, provisioned: link.linked, provision_error: link.error,
      delivery: verdict.delivery, level: verdict.level, comp_pct: verdict.comp_pct, advance: verdict.advance, manager_name: t.manager_name,
      redirect_url: redirectUrl,
    });
  }

  // ── Signed in: manager / admin ────────────────────────────────────────────────────────────────────────
  const caller = await callerFromJwt(sb, req);
  if (!caller) return errorResponse("Sign in required", 401, "UNAUTHORIZED");
  const user = caller.user;

  if (action === "actor") {
    const { data, error } = await user.rpc("contracting_actor");
    if (error) return errorResponse(redact(error.message), 503, "ACTOR_UNAVAILABLE");
    return jsonResponse(data ?? { ok: false });
  }

  if (action === "verdict" || action === "submit") {
    const rowsRaw = Array.isArray(body.rows) ? body.rows : [];
    if (!rowsRaw.length) return errorResponse("No rows.", 400, "VALIDATION_ERROR");
    if (rowsRaw.length > MAX_ROWS) return errorResponse(`At most ${MAX_ROWS} rows per upload.`, 400, "VALIDATION_ERROR");
    const results: Row[] = [];
    let written = 0, held = 0;
    for (const raw of rowsRaw) {
      const row = pickRow(raw);
      const key = String(row.row_key ?? results.length);
      delete row.row_key;
      const { data: dry, error: dryError } = await user.rpc("submit_downline_contracting", { p: { ...row, source: action === "submit" ? "bulk_upload" : "manager_portal" }, p_dry_run: true });
      if (dryError) { results.push({ row_key: key, ok: false, verdict: "error", message: redact(dryError.message) }); held++; continue; }
      const verdict = (dry ?? {}) as Verdict;
      if (action === "verdict" || !verdict.ok) { results.push({ row_key: key, ...verdict }); if (!verdict.ok) held++; continue; }
      const { data: committedRaw, error: commitError } = await user.rpc("submit_downline_contracting", { p: { ...row, source: "bulk_upload" }, p_dry_run: false });
      if (commitError) { results.push({ row_key: key, ok: false, verdict: "error", message: redact(commitError.message) }); held++; continue; }
      const committed = (committedRaw ?? {}) as Verdict;
      if (!committed.ok) { results.push({ row_key: key, ...committed }); held++; continue; }
      const fields = { first_name: String(committed.first_name ?? row.first_name ?? ""), last_name: String(committed.last_name ?? row.last_name ?? ""), email: String(committed.email ?? ""), phone: String(committed.phone ?? ""), npn: String(committed.npn ?? "") };
      fields.first_name = String(row.first_name ?? "").trim(); fields.last_name = String(row.last_name ?? "").trim();
      const link = await provisionAndLink(sb, committed, fields, { managerId: String(committed.upline_id ?? ""), createdByPath: "contracting-downline", userSource: "contracting_manager_upload", source: "bulk_upload" });
      results.push({ row_key: key, ...committed, agent_id: link.agentId, provisioned: link.linked, provision_error: link.error });
      written++;
    }
    return jsonResponse({ ok: true, action, total: rowsRaw.length, written, held, results });
  }

  if (action === "update") {
    const p = pickRow(body);
    const agentId = String(body.agent_id ?? "").trim();
    if (!agentId) return errorResponse("agent_id is required.", 400, "VALIDATION_ERROR");
    const payload: Row = { ...p, agent_id: agentId };
    if (body.terminate === true) payload.terminate = true;
    const { data, error } = await user.rpc("update_downline_contracting", { p: payload });
    if (error) return errorResponse(redact(error.message), 503, "UPDATE_UNAVAILABLE");
    const v = (data ?? {}) as Verdict;
    return jsonResponse(v, v.ok ? 200 : 400);
  }

  if (action === "mgn_link") {
    const url = String(body.url ?? "").trim().slice(0, 500);
    const { data, error } = await user.rpc("set_my_mgn_link", { p_url: url });
    if (error) return errorResponse(redact(error.message), 503, "LINK_UNAVAILABLE");
    const v = (data ?? {}) as Verdict;
    return jsonResponse(v, v.ok ? 200 : 400);
  }

  if (action === "downlines") {
    const { data, error } = await user.rpc("my_contracting_downlines");
    if (error) return errorResponse(redact(error.message), 503, "BOARD_UNAVAILABLE");
    return jsonResponse({ ok: true, rows: data ?? [] });
  }

  if (action === "refresh_sheet") {
    // Managers are not contracting staff; the mirror is refreshed on their behalf with the service key,
    // and at most once per 10 minutes so a page full of managers cannot hammer the export.
    const { data: last } = await sb.from("ethos_sheet_snapshots").select("fetched_at").eq("status", "complete").order("fetched_at", { ascending: false }).limit(1).maybeSingle();
    const age = last?.fetched_at ? Date.now() - Date.parse(String(last.fetched_at)) : Infinity;
    if (age < 10 * 60 * 1000) return jsonResponse({ ok: true, refreshed: false, mirror_at: last?.fetched_at, note: "Mirror is fresh (under 10 minutes)." });
    const res = await fetch(`${SUPABASE_URL}/functions/v1/ethos-sheet-sync`, { method: "POST", headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY, "Content-Type": "application/json" }, body: "{}" });
    const text = await res.text();
    let parsed: Verdict | null = null;
    try { parsed = JSON.parse(text) as Verdict; } catch { parsed = null; }
    return jsonResponse({ ok: res.ok, refreshed: res.ok, status: res.status, mirror: parsed ?? text.slice(0, 200) }, res.ok ? 200 : 502);
  }

  return errorResponse("Unknown action", 400, "VALIDATION_ERROR");
});
