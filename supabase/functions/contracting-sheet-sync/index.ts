// contracting-sheet-sync — writes submitted contracting requests into the "apex new contracting" Google Sheet.
//
// The application is the record; the sheet is a destination. Each run:
//   1. Reads A1:N1 and refuses to write unless the 14 headers are EXACTLY the template's (a header change is a
//      configuration fault, not a reason to shift data into the wrong columns).
//   2. For every request with status=submitted and sheet_status queued/failed (bounded retries), finds its row:
//      the row it was written to before (identity re-checked on the NPN cell), or a row already holding the same NPN
//      (a retry after an uncertain network answer must not append a twin), or the first placeholder row whose
//      agent cells are blank. Writes A..N with RAW values, so an NPN stays text and nothing is parsed as a formula.
//   3. Records the provider receipt (updatedRange) before calling the row synced. A failed write stays failed with
//      a readable, PII-free error; the request itself is never touched.
// Auth: an admin's JWT (Sync now) or the APEX_BOT_TOKEN bearer (the 15-minute pg_cron reconciliation).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { createSheetsClient, getAccessToken } from "../_shared/google-sheets.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const BOT_TOKEN = (Deno.env.get("APEX_BOT_TOKEN") ?? "").trim();
const CREDENTIAL = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON") ?? "";
const MAX_ATTEMPTS = 5;

export const HEADERS = [
  "Request Type",
  "Agent First Name (as appears on license)",
  "Agent Last Name (as appears on license)",
  "NPN",
  "Agent Email Address",
  "Agency Name (if applicable)",
  "Agency TIN (if applicable)",
  "Agency NPN (if applicable)",
  "Direct Upline",
  "Commission Level",
  "Advance?",
  "DOB",
  "Residential Address",
  "Agent Phone",
] as const;

type Snapshot = Record<string, unknown>;

/** A cell that starts like a formula is written as text (leading apostrophe), so imported data can never execute. */
export function cellText(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

export function snapshotToRow(s: Snapshot): string[] {
  const dob = s.dob ? String(s.dob).slice(0, 10) : "";
  return [
    String(s.request_type ?? "contracting"),
    cellText(s.first_name), cellText(s.last_name), cellText(s.npn), cellText(s.email),
    cellText(s.agency_name), cellText(s.agency_tin), cellText(s.agency_npn),
    cellText(s.direct_upline), cellText(s.commission_level), cellText(s.advance),
    cellText(dob), cellText(s.residential_address), cellText(s.phone),
  ];
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function safeError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  // Never let a cell value or a key travel in the error column.
  return m.replace(/Bearer [A-Za-z0-9._-]+/g, "Bearer …").slice(0, 300);
}

async function callerAllowed(req: Request): Promise<"bot" | "admin" | null> {
  const auth = req.headers.get("authorization") ?? "";
  if (BOT_TOKEN && auth === `Bearer ${BOT_TOKEN}`) return "bot";
  const jwt = auth.replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const asUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const { data: userData, error } = await asUser.auth.getUser(jwt);
  if (error || !userData?.user) return null;
  const { data: isAdmin } = await asUser.rpc("apex_is_admin");
  return isAdmin === true ? "admin" : null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
  const who = await callerAllowed(req);
  if (!who) return json({ ok: false, error: "unauthorized" }, 401);

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: settings } = await sb.from("system_settings").select("key, value").in("key", ["contracting_requests_sheet", "contracting_requests_sheet_tab"]);
  const sheetId = settings?.find((s) => s.key === "contracting_requests_sheet")?.value?.trim() ?? "";
  const tab = settings?.find((s) => s.key === "contracting_requests_sheet_tab")?.value?.trim() || "Sheet1";

  const { data: queued, error: qErr } = await sb
    .from("contracting_requests")
    .select("id, agent_id, snapshot, sheet_status, sheet_row, sheet_attempts")
    .eq("status", "submitted")
    .in("sheet_status", ["queued", "failed", "not_configured"])
    .lt("sheet_attempts", MAX_ATTEMPTS)
    .order("updated_at", { ascending: true })
    .limit(50);
  if (qErr) return json({ ok: false, error: safeError(qErr) }, 500);
  const items = queued ?? [];

  let serviceEmail: string | null = null;
  try { serviceEmail = CREDENTIAL ? (JSON.parse(CREDENTIAL).client_email as string) ?? null : null; } catch { serviceEmail = null; } // empty-catch-allow:credential-shape-reported-below

  const park = async (status: "failed" | "not_configured", error: string, ids: string[]) => {
    if (!ids.length) return;
    for (const id of ids) {
      const row = items.find((i) => i.id === id);
      await sb.from("contracting_requests").update({
        sheet_status: status, sheet_error: error, sheet_attempts: (row?.sheet_attempts ?? 0) + (status === "failed" ? 1 : 0), updated_at: new Date().toISOString(),
      }).eq("id", id);
    }
    await sb.from("contracting_request_events").insert(ids.map((id) => ({ request_id: id, event_type: "sheet_" + status, detail: { error }, acted_by: null })));
  };

  if (!sheetId) {
    await park("not_configured", "No destination sheet is configured (system_settings.contracting_requests_sheet).", items.map((i) => i.id));
    return json({ ok: false, blocker: "no_sheet_configured", processed: 0, queued: items.length });
  }
  if (!CREDENTIAL) {
    await park("not_configured", "GOOGLE_SERVICE_ACCOUNT_JSON is not set on the function, so nothing can reach the sheet.", items.map((i) => i.id));
    return json({ ok: false, blocker: "no_credential", processed: 0, queued: items.length });
  }

  let sheets;
  try {
    const token = await getAccessToken(JSON.parse(CREDENTIAL), Date.now(), fetch);
    sheets = createSheetsClient(sheetId, token, fetch);
  } catch (e) {
    await park("failed", "Google credential exchange failed: " + safeError(e), items.map((i) => i.id));
    return json({ ok: false, blocker: "credential_exchange", error: safeError(e), service_email: serviceEmail }, 200);
  }

  // Header contract first. Nothing is written if the template moved.
  let headerRow: string[] = [];
  try {
    headerRow = (await sheets.getRange(`${tab}!A1:N1`))[0] ?? [];
  } catch (e) {
    const msg = safeError(e);
    const shareHint = /403|PERMISSION|permission/i.test(msg) && serviceEmail ? ` Share the sheet with ${serviceEmail} (Editor).` : "";
    await park("failed", "Could not read the sheet: " + msg + shareHint, items.map((i) => i.id));
    return json({ ok: false, blocker: "sheet_unreadable", error: msg, service_email: serviceEmail }, 200);
  }
  const headerOk = HEADERS.every((h, i) => (headerRow[i] ?? "").trim() === h) && headerRow.length === HEADERS.length;
  if (!headerOk) {
    await park("not_configured", `Sheet headers do not match the template (expected ${HEADERS.length} exact headers in A1:N1).`, items.map((i) => i.id));
    return json({ ok: false, blocker: "header_mismatch", found: headerRow, processed: 0 });
  }

  if (!items.length) return json({ ok: true, processed: 0, queued: 0, service_email: serviceEmail });

  const body = await sheets.getRange(`${tab}!A2:N`);
  const rowFor = (r: number) => body[r - 2] ?? [];
  const agentCellsBlank = (cells: string[]) => [1, 2, 3, 4, 8, 9, 11, 12, 13].every((c) => !(cells[c] ?? "").trim());
  const taken = new Set<number>();
  let processed = 0, synced = 0, failed = 0;

  for (const item of items) {
    const snap = (item.snapshot ?? {}) as Snapshot;
    const values = snapshotToRow(snap);
    const npn = String(snap.npn ?? "").trim();
    let target: number | null = null;
    // 1) The row it was written to before, if its NPN cell is still ours (or blank).
    if (item.sheet_row) {
      const prev = rowFor(item.sheet_row);
      const prevNpn = (prev[3] ?? "").replace(/^'/, "").trim();
      if (!prevNpn || prevNpn === npn) target = item.sheet_row;
    }
    // 2) A row that already holds this NPN (an earlier write whose answer was lost).
    if (target == null && npn) {
      const idx = body.findIndex((cells) => (cells[3] ?? "").replace(/^'/, "").trim() === npn);
      if (idx >= 0) target = idx + 2;
    }
    // 3) The first placeholder row with blank agent cells that nobody in this run has claimed.
    if (target == null) {
      for (let r = 2; r <= body.length + 1; r++) {
        if (taken.has(r)) continue;
        if (agentCellsBlank(rowFor(r))) { target = r; break; }
      }
      if (target == null) target = body.length + 2;
    }
    taken.add(target);
    await sb.from("contracting_requests").update({ sheet_status: "processing", updated_at: new Date().toISOString() }).eq("id", item.id);
    try {
      const receipt = await sheets.updateRange(`${tab}!A${target}:N${target}`, [values]);
      await sb.from("contracting_requests").update({
        sheet_status: "synced", sheet_row: target, sheet_range: receipt, sheet_error: null, sheet_synced_at: new Date().toISOString(),
        sheet_attempts: (item.sheet_attempts ?? 0) + 1, updated_at: new Date().toISOString(),
      }).eq("id", item.id);
      await sb.from("contracting_request_events").insert({ request_id: item.id, event_type: "sheet_synced", detail: { range: receipt, row: target, by: who }, acted_by: null });
      synced++;
    } catch (e) {
      await park("failed", "Sheet write failed: " + safeError(e), [item.id]);
      failed++;
    }
    processed++;
  }
  return json({ ok: failed === 0, processed, synced, failed, service_email: serviceEmail });
});
