/**
 * xcel-csv-ingest — client-parsed XCEL DataExport CSV ingestion
 *
 * Body: { rows: XcelRow[] } — client parses CSV → JSON, we validate + upsert.
 *
 * - Validates each row (requires email + sku)
 * - Deduplicates by (lower(email), sku) within the batch and against
 *   already-present rows in xcel_events
 * - Upserts on the unique (email, sku) partial index (ON CONFLICT DO UPDATE)
 * - The AFTER INSERT trg_xcel_events_auto_upgrade trigger auto-upgrades
 *   applications (fn_xcel_events_auto_upgrade) — nothing to do here
 * - Returns { inserted, updated, invalid: [{row_index, reason}],
 *             applications_upgraded }
 * - Rejects fake-success per Operating Contract: any Supabase call that
 *   returns a non-JSON / error body surfaces as 502, never a fake 200.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Loose XCEL row — client can send anything; we only require email + sku.
type XcelRow = Record<string, unknown> & {
  email?: string;
  sku?: string;
};

// Whitelist of columns we persist to xcel_events (matches migration schema).
const PERSIST_COLUMNS: readonly string[] = [
  "source", "external_person_key", "email", "first_name", "middle_name",
  "last_name", "home_phone", "address_1", "address_2", "city", "state",
  "zip_code", "hiring_manager_name", "hiring_manager_email", "department",
  "audiences", "insurance_state_license_number", "national_producer_number",
  "company", "status", "course_name", "course_type", "course_status",
  "course_state", "education_type", "internal_code", "sku",
  "start_date", "end_date", "enrollment_date", "completion_date",
  "completion_datetime", "overall_completion_date", "cert_expiration_date",
  "pre_licensing_pct", "prep_review_pct", "simulated_exam_pct", "overall_pct",
  "final_exam_attempts", "final_exam_score", "min_course_work",
  "time_remaining", "time_in",
  "student_name", "student_email", "state_line",
];

function normEmail(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().toLowerCase();
  return t.length === 0 ? null : t;
}

function normSku(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t.length === 0 ? null : t;
}

function shapeRow(row: XcelRow): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const col of PERSIST_COLUMNS) {
    if (col in row) {
      const v = (row as Record<string, unknown>)[col];
      if (v !== undefined && v !== "") out[col] = v;
    }
  }
  // Canonicalize email to lowercase — matches unique index predicate.
  const email = normEmail(row.email);
  const sku = normSku(row.sku);
  if (email) out.email = email;
  if (sku) out.sku = sku;
  out.raw_row = row;
  out.source = out.source ?? "csv_upload";
  out.ingested_at = new Date().toISOString();
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  let body: { rows?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const rows = body?.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    return jsonResponse({ error: "no_rows" }, 400);
  }
  if (rows.length > 10000) {
    return jsonResponse({ error: "batch_too_large", max: 10000 }, 400);
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  // Phase 1 — validate + in-batch dedup.
  const invalid: Array<{ row_index: number; reason: string }> = [];
  const seenInBatch = new Set<string>();
  const shaped: Array<Record<string, unknown>> = [];
  const shapedIdx: number[] = [];

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    if (raw === null || typeof raw !== "object") {
      invalid.push({ row_index: i, reason: "not_an_object" });
      continue;
    }
    const email = normEmail((raw as XcelRow).email);
    const sku = normSku((raw as XcelRow).sku);
    if (!email) { invalid.push({ row_index: i, reason: "missing_email" }); continue; }
    if (!sku)   { invalid.push({ row_index: i, reason: "missing_sku" }); continue; }
    const key = `${email}|${sku}`;
    if (seenInBatch.has(key)) {
      invalid.push({ row_index: i, reason: "duplicate_in_batch" });
      continue;
    }
    seenInBatch.add(key);
    shaped.push(shapeRow(raw as XcelRow));
    shapedIdx.push(i);
  }

  if (shaped.length === 0) {
    return jsonResponse({ inserted: 0, updated: 0, invalid, applications_upgraded: 0 });
  }

  // Phase 2 — find which (email,sku) pairs already exist so we can split
  // inserted vs updated counts. The upsert itself handles the DB write.
  const emails = Array.from(new Set(shaped.map((r) => r.email as string)));
  const skus = Array.from(new Set(shaped.map((r) => r.sku as string)));
  const existing = new Set<string>();
  const { data: existingRows, error: existingErr } = await sb
    .from("xcel_events")
    .select("email,sku")
    .in("email", emails)
    .in("sku", skus);
  if (existingErr) {
    return jsonResponse({ error: "existing_lookup_failed", detail: existingErr.message }, 502);
  }
  for (const r of existingRows ?? []) {
    if (r?.email && r?.sku) existing.add(`${String(r.email).toLowerCase()}|${r.sku}`);
  }

  const preInsertedApp = await sb
    .from("applications")
    .select("id", { count: "exact", head: true })
    .not("pre_licensing_started_at", "is", null);
  const preCount = preInsertedApp.count ?? 0;

  // Phase 3 — upsert. onConflict matches the (email, sku) partial unique index.
  const { data: upserted, error: upErr } = await sb
    .from("xcel_events")
    .upsert(shaped, { onConflict: "email,sku", ignoreDuplicates: false })
    .select("email,sku");
  if (upErr) {
    return jsonResponse({ error: "upsert_failed", detail: upErr.message }, 502);
  }
  if (!Array.isArray(upserted)) {
    // Reject fake-success: no rows echoed back → treat as failure.
    return jsonResponse({ error: "upsert_no_echo" }, 502);
  }

  let inserted = 0;
  let updated = 0;
  for (const r of shaped) {
    const key = `${String(r.email).toLowerCase()}|${r.sku}`;
    if (existing.has(key)) updated++; else inserted++;
  }

  // Phase 4 — measure trigger-driven application upgrades (best-effort).
  const postInsertedApp = await sb
    .from("applications")
    .select("id", { count: "exact", head: true })
    .not("pre_licensing_started_at", "is", null);
  const postCount = postInsertedApp.count ?? preCount;
  const applications_upgraded = Math.max(0, postCount - preCount);

  return jsonResponse({
    inserted,
    updated,
    invalid,
    applications_upgraded,
  });
});
