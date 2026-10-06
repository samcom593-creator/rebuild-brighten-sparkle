// ethos-sheet-sync — read-only mirror of the Ethos "Agent Portal Signup" sheet.
//
// Reads both input tabs through the sheet's CSV export (the file currently allows
// link-reader access), audits every populated row with the SAME validator the dispatcher
// and the Contracting → Ethos page use (_shared/ethos-contract.ts), and stores a snapshot
// in ethos_sheet_snapshots / ethos_sheet_rows. It never writes to the sheet and never
// contacts an agent or the carrier.
//
// A login wall or a sharing change returns HTML with HTTP 200; that is recorded as a FAILED
// snapshot, never as an empty sheet. Header drift is recorded as failed too, because every
// column index after it would be a guess.
//
// Callers: contracting staff from /dashboard/contracting/ethos (admin, va_manager, va).
// verify_jwt stays on; the role check below is the authorization.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { corsHeaders, jsonResponse, errorResponse } from "../_shared/cors.ts";
import {
  SIGNUP_TAB, UPDATES_TAB, S, auditSignupTab, auditUpdatesTab, looksLikeHtml, parseCsv,
  sheetCsvExportUrl, toMaskedReport, trimOuter, ETHOS_SPREADSHEET_ID,
} from "../_shared/ethos-contract.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const STAFF_ROLES = ["admin", "va_manager", "va"];
const RETAIN_DAYS = 60;

async function fetchTab(gid: number): Promise<string> {
  let lastError = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 45_000);
    try {
      const res = await fetch(sheetCsvExportUrl(gid), { signal: ctl.signal, redirect: "follow" });
      const body = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (looksLikeHtml(body)) throw new Error("the export returned an HTML page (login wall or sharing changed), not CSV");
      return body;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      if (attempt === 2) break;
      await new Promise((r) => setTimeout(r, 1500));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`tab gid ${gid}: ${lastError}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("POST only", 405, "METHOD_NOT_ALLOWED");
  if (!SUPABASE_URL || !SERVICE_KEY) return errorResponse("Server configuration missing", 503, "NOT_CONFIGURED");

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: userData, error: userError } = await sb.auth.getUser(jwt);
  if (userError || !userData?.user) return errorResponse("Sign in required", 401, "UNAUTHORIZED");
  const { data: roles, error: rolesError } = await sb
    .from("user_roles")
    .select("role")
    .eq("user_id", userData.user.id);
  if (rolesError) return errorResponse("Could not check your role", 503, "ROLE_CHECK_UNAVAILABLE");
  if (!(roles ?? []).some((r: { role: string }) => STAFF_ROLES.includes(String(r.role)))) {
    return errorResponse("Contracting staff only", 403, "FORBIDDEN");
  }

  const { data: snap, error: snapError } = await sb
    .from("ethos_sheet_snapshots")
    .insert({ status: "pending", source: "public_csv_export", triggered_by: userData.user.id })
    .select("id, fetched_at")
    .single();
  if (snapError || !snap) return errorResponse(`Could not open a snapshot: ${snapError?.message ?? "unknown"}`, 502, "SNAPSHOT_FAILED");

  const fail = async (message: string, status = 502) => {
    await sb.from("ethos_sheet_snapshots").update({ status: "failed", error: message.slice(0, 500) }).eq("id", snap.id);
    return jsonResponse({ ok: false, snapshot_id: snap.id, error: message }, status);
  };

  let signupRows: string[][];
  let updatesRows: string[][];
  try {
    const [signupCsv, updatesCsv] = await Promise.all([fetchTab(SIGNUP_TAB.sheetId), fetchTab(UPDATES_TAB.sheetId)]);
    signupRows = parseCsv(signupCsv);
    updatesRows = parseCsv(updatesCsv);
  } catch (e) {
    return await fail(`Sheet read failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  const { data: cfgRow } = await sb.from("system_settings").select("value").eq("key", "ethos_agents_sheet").maybeSingle();
  let principal: { npn?: string; mobile?: string; email?: string } = { npn: "21346366" };
  try {
    const cfg = cfgRow?.value ? JSON.parse(String(cfgRow.value)) : {};
    principal = { npn: cfg.principal_npn ?? cfg.direct_upline_npn ?? "21346366", mobile: cfg.principal_mobile, email: cfg.principal_email };
  } catch (cfgError) {
    console.error("[ethos-sheet-sync] ethos_agents_sheet is not JSON; principal checks use the NPN only:", String(cfgError));
  }

  const signup = auditSignupTab(signupRows, { principal });
  const updates = auditUpdatesTab(updatesRows);
  if (!signup.header.ok) {
    return await fail(`Header drift on the signup tab: ${signup.header.drift.map((d) => `${d.column} "${d.actual}"`).join(", ")}`, 409);
  }

  const byRow = new Map(signup.rows.map((r) => [r.rowNumber, r]));
  const records = [];
  for (const [rowNumber, audit] of byRow) {
    const row = signupRows[rowNumber - 1] ?? [];
    records.push({
      snapshot_id: snap.id,
      row_number: rowNumber,
      first_name: trimOuter(row[S.FIRST]) || null,
      last_name: trimOuter(row[S.LAST]) || null,
      npn: trimOuter(row[S.NPN]) || null,
      upline_npn: trimOuter(row[S.UPLINE]) || null,
      mobile: trimOuter(row[S.MOBILE]) || null,
      email: trimOuter(row[S.EMAIL]).toLowerCase() || null,
      comp_level: trimOuter(row[S.LEVEL]) || null,
      advance_tier: trimOuter(row[S.ADVANCE]) || null,
      sub_agency: trimOuter(row[S.SUBAGENCY]) || null,
      sub_agent_head: trimOuter(row[S.HEAD]) || null,
      life_licensed: trimOuter(row[S.LICENSED]) || null,
      eo: trimOuter(row[S.EO]) || null,
      portal_created: trimOuter(row[S.PORTAL]) || null,
      portal_date_raw: trimOuter(row[S.PORTAL_DATE]) || null,
      partner_id: trimOuter(row[S.PARTNER_ID]) || null,
      partner_code: trimOuter(row[S.PARTNER_CODE]) || null,
      invite_unique: audit.carrier.inviteUnique,
      blockers: audit.findings.filter((f) => f.severity === "blocker").map((f) => f.code),
      review: audit.findings.filter((f) => f.severity === "review").map((f) => f.code),
    });
  }

  if (records.length) {
    const { error: rowsError } = await sb.from("ethos_sheet_rows").insert(records);
    if (rowsError) return await fail(`Could not store rows: ${rowsError.message}`);
  }

  const masked = toMaskedReport(signup, updates, `${ETHOS_SPREADSHEET_ID}/${SIGNUP_TAB.title}`);
  const { error: doneError } = await sb.from("ethos_sheet_snapshots").update({
    status: "complete",
    header_ok: true,
    allocated_rows: signupRows.length,
    populated_rows: signup.counts.populatedRows,
    counts: signup.counts,
    updates_counts: { ...updates.counts, header_ok: updates.header.ok },
    duplicates: masked.duplicates,
    update_rows: masked.updates?.rows ?? [],
  }).eq("id", snap.id);
  if (doneError) return await fail(`Could not finalize the snapshot: ${doneError.message}`);

  // Retention: snapshots are a derived mirror of the carrier sheet, not records of their own.
  const cutoff = new Date(Date.now() - RETAIN_DAYS * 86_400_000).toISOString();
  const { error: pruneError } = await sb.from("ethos_sheet_snapshots").delete().lt("fetched_at", cutoff).neq("id", snap.id);
  if (pruneError) console.error("[ethos-sheet-sync] prune failed:", pruneError.message);

  return jsonResponse({
    ok: true,
    snapshot_id: snap.id,
    fetched_at: snap.fetched_at,
    counts: signup.counts,
    updates: updates.counts,
    duplicates: masked.duplicates,
  });
});
