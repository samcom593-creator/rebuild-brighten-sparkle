// PL-066 — schedule-auto-populate
//
// Materializes two schedule lanes into calendar_events:
// 1. Live policy draft dates from book-of-business mirrors.
// 2. Post-test applicant follow-ups every 3 days for the first 30 days.
//
// Idempotency lives on calendar_events.source + external_id.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const SOURCE = "schedule-auto-populate";
const MS_DAY = 86_400_000;

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-automation-job",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type AgentRow = {
  id: string;
  user_id: string | null;
  invited_by_manager_id: string | null;
  manager_id: string | null;
  display_name: string | null;
  agent_code: string | null;
};

type ProfileRow = {
  user_id: string;
  email: string | null;
  full_name: string | null;
};

type Manager = {
  userId: string | null;
  email: string | null;
  name: string;
};

type PlannedEvent = {
  externalId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  userId: string | null;
  manager: Manager;
  kind: "draft_date" | "post_test_follow_up";
  personName: string;
  emailLine: string;
  metadata: Record<string, unknown>;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function dateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_DAY);
}

function atUtcHour(dateIso: string, hourUtc: number, minuteUtc = 0): Date {
  const [year, month, day] = dateIso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, hourUtc, minuteUtc, 0));
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function nextMonthlyDate(anchorIso: string, now: Date, lookaheadDays: number): Date | null {
  const anchor = atUtcHour(anchorIso, 15);
  if (Number.isNaN(anchor.getTime())) return null;

  const draftDay = anchor.getUTCDate();
  const startToday = atUtcHour(now.toISOString().slice(0, 10), 0);
  const limit = addDays(startToday, lookaheadDays);

  let year = startToday.getUTCFullYear();
  let month = startToday.getUTCMonth();
  let day = Math.min(draftDay, daysInMonth(year, month));
  let candidate = new Date(Date.UTC(year, month, day, 15, 0, 0));

  if (candidate < startToday) {
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
    day = Math.min(draftDay, daysInMonth(year, month));
    candidate = new Date(Date.UTC(year, month, day, 15, 0, 0));
  }

  return candidate <= limit ? candidate : null;
}

function firstDateFromRaw(raw: unknown, depth = 0): string | null {
  if (!raw || depth > 3) return null;
  if (Array.isArray(raw)) {
    for (const item of raw.slice(0, 25)) {
      const found = firstDateFromRaw(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof raw !== "object") return null;

  const entries = Object.entries(raw as Record<string, unknown>);
  for (const [key, value] of entries) {
    const normalized = key.toLowerCase().replace(/[^a-z]/g, "");
    if (normalized.includes("draft") && typeof value === "string") {
      const parsed = dateOnly(value);
      if (parsed) return parsed;
    }
  }
  for (const [, value] of entries.slice(0, 50)) {
    const found = firstDateFromRaw(value, depth + 1);
    if (found) return found;
  }
  return null;
}

function activePolicy(status: string | null | undefined): boolean {
  const s = (status ?? "").toLowerCase();
  if (!s) return true;
  return !["lapsed", "cancel", "surrender", "not taken", "declined", "withdrawn"].some((bad) => s.includes(bad));
}

function dollars(value: unknown): string {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(n) || n <= 0) return "";
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function authorize(req: Request): Promise<{ ok: true; mode: string; userId: string | null } | { ok: false; status: number; error: string }> {
  const authHeader = req.headers.get("authorization") ?? "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (bearer && bearer === SERVICE_ROLE_KEY) {
    return { ok: true, mode: "service", userId: null };
  }
  if (!bearer) return { ok: false, status: 401, error: "missing authorization" };

  const { data, error } = await sb.auth.getUser(bearer);
  const user = data?.user;
  if (error || !user) return { ok: false, status: 401, error: "invalid user token" };

  const { data: roles, error: roleError } = await sb
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id);
  if (roleError) return { ok: false, status: 500, error: roleError.message };

  const allowed = (roles ?? []).some((row: any) => ["admin", "manager"].includes(row.role));
  if (!allowed) return { ok: false, status: 403, error: "admin or manager role required" };
  return { ok: true, mode: "user", userId: user.id };
}

async function fetchAgents(agentIds: Set<string>): Promise<Map<string, AgentRow>> {
  const agents = new Map<string, AgentRow>();
  const firstPass = [...agentIds].filter(Boolean);
  for (const ids of chunk(firstPass, 200)) {
    const { data, error } = await sb
      .from("agents")
      .select("id, user_id, invited_by_manager_id, manager_id, display_name, agent_code")
      .in("id", ids);
    if (error) throw error;
    for (const row of (data ?? []) as AgentRow[]) agents.set(row.id, row);
  }

  const managerIds = new Set<string>();
  for (const agent of agents.values()) {
    if (agent.invited_by_manager_id) managerIds.add(agent.invited_by_manager_id);
    if (agent.manager_id) managerIds.add(agent.manager_id);
  }
  const missing = [...managerIds].filter((id) => !agents.has(id));
  for (const ids of chunk(missing, 200)) {
    const { data, error } = await sb
      .from("agents")
      .select("id, user_id, invited_by_manager_id, manager_id, display_name, agent_code")
      .in("id", ids);
    if (error) throw error;
    for (const row of (data ?? []) as AgentRow[]) agents.set(row.id, row);
  }
  return agents;
}

async function fetchProfiles(userIds: Set<string>): Promise<Map<string, ProfileRow>> {
  const profiles = new Map<string, ProfileRow>();
  const ids = [...userIds].filter(Boolean);
  for (const batch of chunk(ids, 200)) {
    const { data, error } = await sb
      .from("profiles")
      .select("user_id, email, full_name")
      .in("user_id", batch);
    if (error) throw error;
    for (const row of (data ?? []) as ProfileRow[]) profiles.set(row.user_id, row);
  }
  return profiles;
}

async function fallbackAdmin(profiles: Map<string, ProfileRow>): Promise<Manager> {
  const { data } = await sb
    .from("user_roles")
    .select("user_id")
    .eq("role", "admin")
    .limit(20);
  const ids = ((data ?? []) as { user_id: string }[]).map((row) => row.user_id);
  const missing = ids.filter((id) => !profiles.has(id));
  const extra = await fetchProfiles(new Set(missing));
  for (const [id, profile] of extra.entries()) profiles.set(id, profile);

  const preferred = ids.find((id) => profiles.get(id)?.email?.includes("sam.com593"))
    ?? ids.find((id) => profiles.get(id)?.email?.includes("kingofsales"))
    ?? ids[0]
    ?? null;
  const profile = preferred ? profiles.get(preferred) : null;
  return {
    userId: preferred,
    email: profile?.email ?? null,
    name: profile?.full_name ?? "APEX Admin",
  };
}

function managerForAgent(agentId: string | null | undefined, agents: Map<string, AgentRow>, profiles: Map<string, ProfileRow>, fallback: Manager): Manager {
  if (!agentId) return fallback;
  const agent = agents.get(agentId);
  if (!agent) return fallback;

  const managerAgentId = agent.invited_by_manager_id ?? agent.manager_id;
  const managerAgent = managerAgentId ? agents.get(managerAgentId) : null;
  const userId = managerAgent?.user_id ?? agent.user_id ?? fallback.userId;
  if (!userId) return fallback;

  const profile = profiles.get(userId);
  return {
    userId,
    email: profile?.email ?? fallback.email,
    name: profile?.full_name ?? managerAgent?.display_name ?? agent.display_name ?? fallback.name,
  };
}

function managerForApplication(app: any, agents: Map<string, AgentRow>, profiles: Map<string, ProfileRow>, fallback: Manager): Manager {
  if (app.hiring_manager_user_id) {
    const profile = profiles.get(app.hiring_manager_user_id);
    return {
      userId: app.hiring_manager_user_id,
      email: profile?.email ?? fallback.email,
      name: profile?.full_name ?? fallback.name,
    };
  }
  return managerForAgent(app.assigned_agent_id ?? app.recruiter_id, agents, profiles, fallback);
}

async function existingExternalIds(ids: string[]): Promise<Set<string>> {
  const existing = new Set<string>();
  for (const batch of chunk(ids, 250)) {
    const { data, error } = await sb
      .from("calendar_events")
      .select("external_id")
      .eq("source", SOURCE)
      .in("external_id", batch);
    if (error) throw error;
    for (const row of (data ?? []) as { external_id: string | null }[]) {
      if (row.external_id) existing.add(row.external_id);
    }
  }
  return existing;
}

async function loadPlanningContext() {
  const [{ data: bookRows, error: bookError }, { data: carrierRows, error: carrierError }, { data: appRows, error: appError }] = await Promise.all([
    sb
      .from("agentlink_book_of_business")
      .select("id, agent_id, carrier_name, client_name, policy_number, product_name, monthly_premium, annual_premium, effective_date, issue_date, paid_to_date, status, raw")
      .limit(1500),
    sb
      .from("carrier_policies")
      .select("id, agent_id, carrier_name, client_first_name, client_last_name, policy_number, policy_status, effective_date, annual_premium, raw")
      .limit(1500),
    sb
      .from("applications")
      .select("id, first_name, last_name, email, phone, license_progress, exam_passed_at, updated_at, created_at, hiring_manager_user_id, assigned_agent_id, recruiter_id, status, terminated_at, licensed_at")
      .is("terminated_at", null)
      .neq("license_progress", "licensed" as any)
      .limit(1500),
  ]);

  if (bookError) throw bookError;
  if (carrierError) throw carrierError;
  if (appError) throw appError;

  return {
    bookRows: (bookRows ?? []) as any[],
    carrierRows: (carrierRows ?? []) as any[],
    appRows: (appRows ?? []) as any[],
  };
}

function planDraftEvents(rows: any[], sourceTable: "agentlink_book_of_business" | "carrier_policies", now: Date, lookaheadDays: number, agents: Map<string, AgentRow>, profiles: Map<string, ProfileRow>, fallback: Manager): PlannedEvent[] {
  const events: PlannedEvent[] = [];
  for (const row of rows) {
    const status = row.status ?? row.policy_status ?? null;
    if (!activePolicy(status)) continue;

    const explicitDraft = firstDateFromRaw(row.raw);
    const anchor = explicitDraft
      ?? dateOnly(row.paid_to_date)
      ?? dateOnly(row.effective_date)
      ?? dateOnly(row.issue_date);
    if (!anchor) continue;

    const starts = explicitDraft
      ? atUtcHour(explicitDraft, 15)
      : nextMonthlyDate(anchor, now, lookaheadDays);
    if (!starts) continue;

    const startToday = atUtcHour(now.toISOString().slice(0, 10), 0);
    if (starts < startToday || starts > addDays(startToday, lookaheadDays)) continue;

    const ends = new Date(starts.getTime() + 30 * 60_000);
    const manager = managerForAgent(row.agent_id, agents, profiles, fallback);
    const clientName = row.client_name
      ?? `${row.client_first_name ?? ""} ${row.client_last_name ?? ""}`.trim()
      ?? "Policyholder";
    const carrier = row.carrier_name ?? "Carrier";
    const premium = dollars(row.monthly_premium ?? (row.annual_premium ? Number(row.annual_premium) / 12 : null));
    const dateLabel = starts.toISOString().slice(0, 10);
    const policy = row.policy_number ? `Policy ${row.policy_number}` : "Policy";

    events.push({
      externalId: `draft:${sourceTable}:${row.id}:${dateLabel}`,
      title: `Draft check: ${clientName} (${carrier})`,
      startsAt: starts.toISOString(),
      endsAt: ends.toISOString(),
      userId: manager.userId,
      manager,
      kind: "draft_date",
      personName: clientName,
      emailLine: `${dateLabel}: ${clientName} / ${carrier}${premium ? ` / ${premium}` : ""}`,
      metadata: {
        pl: "PL-066",
        kind: "draft_date",
        source_table: sourceTable,
        source_id: row.id,
        person_name: clientName,
        manager_name: manager.name,
        carrier_name: carrier,
        policy_number: row.policy_number ?? null,
        policy_status: status,
        monthly_premium: row.monthly_premium ?? null,
        annual_premium: row.annual_premium ?? null,
        policy_label: policy,
      },
    });
  }
  return events;
}

function planPostTestEvents(appRows: any[], now: Date, lookaheadDays: number, agents: Map<string, AgentRow>, profiles: Map<string, ProfileRow>, fallback: Manager): PlannedEvent[] {
  const events: PlannedEvent[] = [];
  const postTestStages = new Set(["passed_test", "fingerprints_done", "waiting_on_license"]);
  const startToday = atUtcHour(now.toISOString().slice(0, 10), 0);
  const limit = addDays(startToday, lookaheadDays);

  for (const app of appRows) {
    const progress = app.license_progress ?? "";
    if (!app.exam_passed_at && !postTestStages.has(progress)) continue;
    if (app.licensed_at) continue;
    if (["approved", "rejected", "appointed"].includes(app.status ?? "")) continue;

    const anchorIso = dateOnly(app.exam_passed_at ?? app.updated_at ?? app.created_at);
    if (!anchorIso) continue;
    const name = `${app.first_name ?? ""} ${app.last_name ?? ""}`.trim() || app.email || "Applicant";
    const manager = managerForApplication(app, agents, profiles, fallback);

    for (let day = 3; day <= 30; day += 3) {
      const dueDate = addDays(atUtcHour(anchorIso, 15), day);
      if (dueDate < startToday || dueDate > limit) continue;
      const dateLabel = dueDate.toISOString().slice(0, 10);
      const ends = new Date(dueDate.getTime() + 20 * 60_000);
      events.push({
        externalId: `post-test:${app.id}:d${day}`,
        title: `Post-test follow-up: ${name}`,
        startsAt: dueDate.toISOString(),
        endsAt: ends.toISOString(),
        userId: manager.userId,
        manager,
        kind: "post_test_follow_up",
        personName: name,
        emailLine: `${dateLabel}: ${name} / day ${day} after test / ${progress || "post-test"}`,
        metadata: {
          pl: "PL-066",
          kind: "post_test_follow_up",
          application_id: app.id,
          person_name: name,
          manager_name: manager.name,
          email: app.email ?? null,
          phone: app.phone ?? null,
          license_progress: progress,
          exam_passed_at: app.exam_passed_at ?? null,
          follow_up_day: day,
        },
      });
    }
  }
  return events;
}

async function sendManagerSummaries(eventsToEmail: PlannedEvent[], onlyManagerEmails?: Set<string>): Promise<{ sent: number; skipped: number; errors: Array<{ email: string; error: string }> }> {
  if (!RESEND_API_KEY || eventsToEmail.length === 0) return { sent: 0, skipped: eventsToEmail.length, errors: [] };

  const byManager = new Map<string, PlannedEvent[]>();
  for (const event of eventsToEmail) {
    const managerEmail = event.manager.email?.toLowerCase() ?? null;
    if (onlyManagerEmails && (!managerEmail || !onlyManagerEmails.has(managerEmail))) {
      continue;
    }
    const key = event.manager.email ?? `missing:${event.manager.userId ?? "unknown"}`;
    if (!byManager.has(key)) byManager.set(key, []);
    byManager.get(key)!.push(event);
  }

  let sent = 0;
  let skipped = 0;
  const errors: Array<{ email: string; error: string }> = [];
  for (const [email, events] of byManager.entries()) {
    if (!email || email.startsWith("missing:")) {
      skipped += events.length;
      continue;
    }

    const draftEvents = events.filter((event) => event.kind === "draft_date");
    const followUps = events.filter((event) => event.kind === "post_test_follow_up");
    const lines = events
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      .slice(0, 30)
      .map((event) => `<li>${escapeHtml(event.emailLine)}</li>`)
      .join("");

    const html = `<!doctype html>
      <html>
        <body style="margin:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#0f172a">
          <div style="max-width:620px;margin:0 auto;padding:28px 22px">
            <p style="margin:0 0 6px;font-size:12px;font-weight:800;letter-spacing:0.12em;color:#334155">APEX SCHEDULE</p>
            <h1 style="margin:0 0 14px;font-size:22px;line-height:1.2">Schedule auto-fill added ${events.length} item${events.length === 1 ? "" : "s"}</h1>
            <p style="margin:0 0 16px;color:#475569">Draft checks and post-test follow-ups are now on your Apex Calendar.</p>
            <div style="display:flex;gap:10px;margin:0 0 18px">
              <div style="border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;background:#fff"><strong>${draftEvents.length}</strong><br><span style="font-size:12px;color:#64748b">Draft dates</span></div>
              <div style="border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;background:#fff"><strong>${followUps.length}</strong><br><span style="font-size:12px;color:#64748b">Post-test follow-ups</span></div>
            </div>
            <ul style="margin:0 0 20px;padding-left:20px;color:#334155;line-height:1.6">${lines}</ul>
            <p style="margin:0;color:#64748b;font-size:13px">Open Apex Calendar to work the list. Duplicates are blocked by event id, so the daily refresh can run without stacking repeats.</p>
          </div>
        </body>
      </html>`;

    let res: Response | null = null;
    let errorText = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "APEX Schedule <notifications@apex-financial.org>",
          to: [email],
          subject: `APEX schedule auto-fill: ${events.length} item${events.length === 1 ? "" : "s"} added`,
          html,
        }),
      });
      if (res.ok) break;
      errorText = await res.text();
      if (res.status !== 429) break;
      await sleep(1_200);
    }

    if (res?.ok) sent++;
    else errors.push({ email, error: errorText || "send failed" });
    await sleep(250);
  }

  return { sent, skipped, errors };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);

  const auth = await authorize(req);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  let body: {
    dry_run?: boolean;
    lookahead_days?: number;
    email_managers?: boolean;
    email_existing?: boolean;
    only_manager_emails?: string[];
  } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const dryRun = body.dry_run === true;
  const emailManagers = body.email_managers !== false;
  const lookaheadDays = Math.min(Math.max(Number(body.lookahead_days ?? 45), 1), 90);
  const now = new Date();

  try {
    const { bookRows, carrierRows, appRows } = await loadPlanningContext();

    const agentIds = new Set<string>();
    const userIds = new Set<string>();
    for (const row of [...bookRows, ...carrierRows]) if (row.agent_id) agentIds.add(row.agent_id);
    for (const app of appRows) {
      if (app.assigned_agent_id) agentIds.add(app.assigned_agent_id);
      if (app.recruiter_id) agentIds.add(app.recruiter_id);
      if (app.hiring_manager_user_id) userIds.add(app.hiring_manager_user_id);
    }

    const agents = await fetchAgents(agentIds);
    for (const agent of agents.values()) if (agent.user_id) userIds.add(agent.user_id);
    const profiles = await fetchProfiles(userIds);
    const fallback = await fallbackAdmin(profiles);

    const planned = [
      ...planDraftEvents(bookRows, "agentlink_book_of_business", now, lookaheadDays, agents, profiles, fallback),
      ...planDraftEvents(carrierRows, "carrier_policies", now, lookaheadDays, agents, profiles, fallback),
      ...planPostTestEvents(appRows, now, lookaheadDays, agents, profiles, fallback),
    ];

    const bySemanticKey = new Map<string, PlannedEvent>();
    for (const event of planned) {
      const policyNumber = event.kind === "draft_date" ? String(event.metadata.policy_number ?? "") : "";
      const dateLabel = event.startsAt.slice(0, 10);
      const semanticKey = policyNumber
        ? `draft-policy:${policyNumber}:${dateLabel}`
        : event.externalId;
      if (!bySemanticKey.has(semanticKey)) bySemanticKey.set(semanticKey, event);
    }
    const deduped = [...bySemanticKey.values()];
    const existing = await existingExternalIds(deduped.map((event) => event.externalId));
    const missing = deduped.filter((event) => !existing.has(event.externalId));

    let inserted: PlannedEvent[] = [];
    if (!dryRun && missing.length > 0) {
      const { error } = await sb.from("calendar_events").insert(missing.map((event) => ({
        title: event.title,
        starts_at: event.startsAt,
        ends_at: event.endsAt,
        source: SOURCE,
        raw_command: "PL-066 schedule-auto-populate",
        external_id: event.externalId,
        status: "scheduled",
        user_id: event.userId,
        metadata: event.metadata,
      })));
      if (error && error.code !== "23505") throw error;
      inserted = error?.code === "23505" ? [] : missing;
    }

    const onlyManagerEmails = Array.isArray(body.only_manager_emails)
      ? new Set(body.only_manager_emails.map((email) => String(email).toLowerCase()))
      : undefined;
    const eventsForEmail = inserted.length > 0
      ? inserted
      : body.email_existing === true
        ? deduped.filter((event) => existing.has(event.externalId))
        : [];
    const emailSummary = !dryRun && emailManagers
      ? await sendManagerSummaries(eventsForEmail, onlyManagerEmails)
      : { sent: 0, skipped: 0, errors: [] };

    const plannedDrafts = deduped.filter((event) => event.kind === "draft_date").length;
    const plannedFollowUps = deduped.filter((event) => event.kind === "post_test_follow_up").length;
    const insertedDrafts = inserted.filter((event) => event.kind === "draft_date").length;
    const insertedFollowUps = inserted.filter((event) => event.kind === "post_test_follow_up").length;

    return json({
      ok: true,
      mode: dryRun ? "dry_run" : "live",
      authorized_as: auth.mode,
      lookahead_days: lookaheadDays,
      source_counts: {
        agentlink_book_of_business: bookRows.length,
        carrier_policies: carrierRows.length,
        applications: appRows.length,
      },
      planned: {
        total: deduped.length,
        draft_dates: plannedDrafts,
        post_test_follow_ups: plannedFollowUps,
      },
      existing: existing.size,
      inserted: {
        total: inserted.length,
        draft_dates: insertedDrafts,
        post_test_follow_ups: insertedFollowUps,
      },
      email_summary: emailSummary,
      sample: deduped.slice(0, 10).map((event) => ({
        kind: event.kind,
        title: event.title,
        starts_at: event.startsAt,
        manager: event.manager.name,
      })),
    });
  } catch (error: any) {
    console.error("schedule-auto-populate failed", error);
    return json({ ok: false, error: error?.message ?? String(error) }, 500);
  }
});
