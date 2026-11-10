// submit-licensing-milestone — request handling, with the database behind an interface so
// it can be tested offline (no supabase-js import in this file).
//
// The applicant's /status/:id page posts one of three self-reports:
//   exam_scheduled (+ exam_date YYYY-MM-DD) | exam_passed | npn (+ 5-10 digit NPN)
// The insert into licensing_self_reports fires trg_apply_licensing_self_report, which stamps
// applications forward-only and labels the row self_reported. It never sets license_status.
//
// Gate: the application_id in the status-page URL, exactly like submit-licensing-proof.
// A malformed id is 400, an id with no application is 404, both before any write.

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const KINDS = ["exam_scheduled", "exam_passed", "npn"] as const;
export type MilestoneKind = (typeof KINDS)[number];

/** Max reports per application per rolling 24h, and the per-kind dedupe window. */
export const DAILY_CAP = 12;
export const DEDUPE_MINUTES = 2;

export interface MilestoneInput {
  applicationId: string;
  kind: MilestoneKind;
  examDate: string | null;
  npn: string | null;
}

export interface MilestoneDeps {
  /** null when there is no such application. Throws on a lookup failure. */
  findApplication(id: string): Promise<{ id: string; license_status: string | null } | null>;
  /** Reports for this application in the last 24h (kind + created_at ISO). */
  recentReports(id: string): Promise<Array<{ kind: string; created_at: string }>>;
  insertReport(input: MilestoneInput): Promise<{ applied: unknown }>;
  now(): Date;
}

export type ValidationResult =
  | { ok: true; value: MilestoneInput }
  | { ok: false; status: number; code: string; message: string };

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function validateMilestoneBody(body: unknown, now: Date): ValidationResult {
  const b = (body ?? {}) as Record<string, unknown>;
  const applicationId = String(b.application_id ?? "").trim();
  if (!UUID_RE.test(applicationId)) {
    return { ok: false, status: 400, code: "bad_application", message: "A valid application is required." };
  }
  const kind = String(b.kind ?? "").trim() as MilestoneKind;
  if (!(KINDS as readonly string[]).includes(kind)) {
    return { ok: false, status: 400, code: "bad_kind", message: "Unknown update." };
  }

  let examDate: string | null = null;
  if (kind === "exam_scheduled") {
    const raw = String(b.exam_date ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(`${raw}T12:00:00Z`))) {
      return { ok: false, status: 400, code: "bad_date", message: "Pick your exam date." };
    }
    const earliest = new Date(now.getTime() - 60 * 86_400_000);
    const latest = new Date(now.getTime() + 365 * 86_400_000);
    if (raw < isoDay(earliest) || raw > isoDay(latest)) {
      return { ok: false, status: 400, code: "bad_date", message: "That exam date doesn't look right." };
    }
    examDate = raw;
  }

  let npn: string | null = null;
  if (kind === "npn") {
    const digits = String(b.npn ?? "").replace(/\D/g, "");
    if (!/^\d{5,10}$/.test(digits)) {
      return { ok: false, status: 400, code: "bad_npn", message: "Your NPN is 5 to 10 digits." };
    }
    npn = digits;
  }

  return { ok: true, value: { applicationId, kind, examDate, npn } };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const err = (message: string, status: number, code: string) => json({ error: { message, code } }, status);

export async function handleMilestone(req: Request, deps: MilestoneDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return err("POST only", 405, "method");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return err("Invalid JSON", 400, "bad_json");
  }

  const now = deps.now();
  const v = validateMilestoneBody(body, now);
  if (!v.ok) return err(v.message, v.status, v.code);
  const input = v.value;

  let app: { id: string; license_status: string | null } | null;
  try {
    app = await deps.findApplication(input.applicationId);
  } catch {
    return err("Could not verify the application.", 500, "app_lookup");
  }
  if (!app) return err("We couldn't find that application.", 404, "no_application");

  // Exam updates are for people getting licensed; a licensed applicant may still add an NPN.
  if (input.kind !== "npn" && String(app.license_status ?? "").toLowerCase() === "licensed") {
    return err("You're already marked licensed.", 409, "already_licensed");
  }

  let recent: Array<{ kind: string; created_at: string }>;
  try {
    recent = await deps.recentReports(input.applicationId);
  } catch {
    return err("Could not save your update.", 500, "recent_lookup");
  }
  if (recent.length >= DAILY_CAP) return err("Too many updates today. Try again tomorrow.", 429, "too_many");
  const dedupeSince = now.getTime() - DEDUPE_MINUTES * 60_000;
  if (recent.some((r) => r.kind === input.kind && Date.parse(r.created_at) >= dedupeSince)) {
    // A double tap. The first report already did the work.
    return json({ ok: true, deduped: true });
  }

  try {
    const { applied } = await deps.insertReport(input);
    return json({ ok: true, applied });
  } catch {
    return err("Could not save your update.", 500, "insert");
  }
}
