// Xcel Solutions CSV importer.
//
// Sam's admin portal (my.xcelsolutions.com) is a Vue SPA with WCF auth —
// not scrapable from here. Workflow is instead:
//   1. Log in as admin → Users → Export CSV
//   2. POST the CSV to this endpoint (text/csv body OR { csv: "<string>" })
//   3. We match each row by LOWER(email) against applications.email and
//      update license_progress when Xcel's status is further along than
//      what we have on record. Self-reports that disagree with Xcel get
//      overwritten with Xcel's truth.
//
// Supported Xcel export columns (case-insensitive, trimmed):
//   Email / email           → match key
//   Course Status           → maps to course_purchased / finished_course
//   Test Scheduled Date     → sets exam_scheduled_at + license_progress=test_scheduled
//   Test Passed / Exam Passed → sets exam_passed_at + license_progress=passed_test
//   Fingerprints Submitted  → sets fingerprints_submitted_at
//   License Issued / License → sets licensed_at + license_progress=licensed
//
// Returns: { matched, updated, unmatched, errors, rows_in_csv }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Order matters — we only progress forward, never backward.
const STAGE_RANK: Record<string, number> = {
  unlicensed: 0,
  course_purchased: 1,
  finished_course: 2,
  test_scheduled: 3,
  passed_test: 4,
  fingerprints_done: 5,
  waiting_on_license: 6,
  licensed: 7,
};

function parseCSV(text: string): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = splitCSVLine(lines[0]).map(h => h.trim().toLowerCase());
  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCSVLine(lines[i]);
    if (cells.length === 0) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = (cells[idx] ?? "").trim(); });
    rows.push(row);
  }
  return rows;
}

// Basic RFC4180-ish splitter: handles quoted fields, "" escapes, commas-in-quotes.
function splitCSVLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else { inQ = false; }
      } else { cur += c; }
    } else {
      if (c === '"') { inQ = true; }
      else if (c === ",") { out.push(cur); cur = ""; }
      else { cur += c; }
    }
  }
  out.push(cur);
  return out;
}

function pickCol(row: Record<string, string>, ...names: string[]): string {
  for (const n of names) {
    const v = row[n.toLowerCase()];
    if (v && v.trim()) return v.trim();
  }
  return "";
}

function truthyDateLike(v: string): boolean {
  if (!v) return false;
  const s = v.toLowerCase();
  if (["yes", "true", "y", "1", "passed", "complete", "completed", "done"].includes(s)) return true;
  // Looks like a date?
  if (/\d{4}-\d{2}-\d{2}/.test(v) || /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(v)) return true;
  return false;
}

function parseDate(v: string): string | null {
  if (!v || !truthyDateLike(v)) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

// Infer the furthest-along stage from the row's columns.
function inferStage(row: Record<string, string>): { stage: string; fields: Record<string, string> } {
  const fields: Record<string, string> = {};
  let stage = "unlicensed";

  const courseStatus = pickCol(row, "course status", "courseStatus", "status").toLowerCase();
  if (courseStatus) {
    if (/(complete|completed|finish|passed)/.test(courseStatus)) {
      stage = "finished_course";
    } else if (/(in progress|enrolled|active|started|purchased|registered)/.test(courseStatus)) {
      stage = "course_purchased";
    }
  }

  const testScheduled = pickCol(row, "test scheduled date", "exam scheduled date", "exam date", "test date");
  const testScheduledDate = parseDate(testScheduled);
  if (testScheduledDate) {
    stage = "test_scheduled";
    fields.exam_scheduled_at = testScheduledDate;
  }

  const testPassed = pickCol(row, "test passed", "exam passed", "pass", "passed");
  const testPassedDate = parseDate(testPassed);
  if (testPassedDate) {
    stage = "passed_test";
    fields.exam_passed_at = testPassedDate;
  } else if (truthyDateLike(testPassed)) {
    stage = "passed_test";
    fields.exam_passed_at = new Date().toISOString();
  }

  const fingerprints = pickCol(row, "fingerprints submitted", "fingerprints", "fingerprint date");
  const fingerprintsDate = parseDate(fingerprints);
  if (fingerprintsDate) {
    stage = "fingerprints_done";
    fields.fingerprints_submitted_at = fingerprintsDate;
  } else if (truthyDateLike(fingerprints)) {
    stage = "fingerprints_done";
    fields.fingerprints_submitted_at = new Date().toISOString();
  }

  const licenseIssued = pickCol(row, "license issued", "license", "licensed", "license date");
  const licensedDate = parseDate(licenseIssued);
  if (licensedDate) {
    stage = "licensed";
    fields.licensed_at = licensedDate;
  } else if (truthyDateLike(licenseIssued)) {
    stage = "licensed";
    fields.licensed_at = new Date().toISOString();
  }

  return { stage, fields };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } });

  let csvText = "";
  const contentType = req.headers.get("content-type") || "";
  try {
    if (contentType.includes("text/csv") || contentType.includes("text/plain")) {
      csvText = await req.text();
    } else {
      const body = await req.json().catch(() => null);
      csvText = body?.csv ?? "";
    }
  } catch (e: any) {
    return new Response(JSON.stringify({ error: `Body read failed: ${e.message}` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  if (!csvText || csvText.length < 10) {
    return new Response(JSON.stringify({ error: "Empty CSV body. Send text/csv, or JSON with { csv: '...' }." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const rows = parseCSV(csvText);
  if (rows.length === 0) {
    return new Response(JSON.stringify({ error: "No data rows parsed (check header line)" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  let matched = 0;
  let updated = 0;
  let unmatched = 0;
  const errors: Array<{ email: string; error: string }> = [];

  for (const r of rows) {
    const email = pickCol(r, "email", "e-mail").toLowerCase();
    if (!email) continue;

    const { stage, fields } = inferStage(r);
    const newRank = STAGE_RANK[stage] ?? 0;

    // Look up the applicant
    const { data: app, error: findErr } = await supabase
      .from("applications")
      .select("id, license_progress")
      .ilike("email", email)
      .is("terminated_at", null)
      .maybeSingle();

    if (findErr) { errors.push({ email, error: findErr.message }); continue; }
    if (!app) { unmatched++; continue; }

    matched++;
    const currentRank = STAGE_RANK[app.license_progress ?? "unlicensed"] ?? 0;

    // Only advance forward; never regress a license_progress that's further along.
    if (newRank <= currentRank && Object.keys(fields).length === 0) continue;

    const patch: Record<string, unknown> = {
      ...fields,
      updated_at: new Date().toISOString(),
    };
    if (newRank > currentRank) patch.license_progress = stage;
    if (stage === "licensed") patch.license_status = "licensed";

    const { error: updErr } = await supabase
      .from("applications")
      .update(patch)
      .eq("id", app.id);

    if (updErr) { errors.push({ email, error: updErr.message }); continue; }
    updated++;
  }

  return new Response(JSON.stringify({
    ok: true,
    rows_in_csv: rows.length,
    matched,
    updated,
    unmatched,
    errors: errors.slice(0, 20),
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
