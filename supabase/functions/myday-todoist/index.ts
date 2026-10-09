// My Day <-> Todoist, for the admin only.
//   push     recurring My Day blocks -> Todoist tasks (labelled "myday") -> Google Calendar through Todoist's own sync
//   today    what is due today or overdue in Todoist, excluding the synced My Day blocks
//   complete close one Todoist task
//
// The Todoist token lives in system_settings.todoist_api_token and is only ever read here, with the service role.
// Only tasks recorded in day_plan_todoist_map are ever updated or deleted, so Sam's own Todoist tasks are never touched.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { buildDesired, planSync, type MapRow, type PlanTask } from "../_shared/myday-sync.ts";

const TODOIST = "https://api.todoist.com/api/v1";
const PROJECT_NAME = "APEX";
const LABEL = "myday";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } }, auth: { persistSession: false },
  });
  const { data: u, error: uErr } = await userClient.auth.getUser();
  if (uErr || !u?.user) return json({ ok: false, error: "sign in required" }, 401);

  const sb = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: role } = await sb.from("user_roles").select("role").eq("user_id", u.user.id).eq("role", "admin").limit(1);
  if (!role || role.length === 0) return json({ ok: false, error: "admin only" }, 403);

  let body: { action?: string; task_id?: string } = {};
  try { body = await req.json(); } catch { return json({ ok: false, error: "invalid json" }, 400); }

  const { data: setting, error: sErr } = await sb.from("system_settings").select("value").eq("key", "todoist_api_token").limit(1);
  const token = setting?.[0]?.value as string | undefined;
  if (sErr || !token) return json({ ok: false, error: "todoist token not configured" }, 500);
  const td = async (path: string, init: RequestInit = {}) => {
    const r = await fetch(`${TODOIST}${path}`, {
      ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
    const text = await r.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { ok: r.ok, status: r.status, data };
  };

  if (body.action === "today") {
    const r = await td(`/tasks/filter?query=${encodeURIComponent("today | overdue")}`);
    if (!r.ok) return json({ ok: false, error: `todoist ${r.status}` }, 502);
    const rows = ((r.data as { results?: Array<Record<string, unknown>> })?.results ?? [])
      .filter((t) => !((t.labels as string[] | undefined) ?? []).includes(LABEL))
      .slice(0, 40)
      .map((t) => ({
        id: t.id, content: t.content, priority: t.priority,
        due: (t.due as { date?: string; string?: string } | null)?.date ?? null,
        recurring: Boolean((t.due as { is_recurring?: boolean } | null)?.is_recurring),
      }));
    return json({ ok: true, tasks: rows });
  }

  if (body.action === "complete") {
    if (!body.task_id || !/^[A-Za-z0-9_-]{6,40}$/.test(body.task_id)) return json({ ok: false, error: "task_id required" }, 400);
    const r = await td(`/tasks/${body.task_id}/close`, { method: "POST" });
    return json({ ok: r.ok }, r.ok ? 200 : 502);
  }

  if (body.action === "push") {
    const { data: tasks, error: tErr } = await sb.from("day_plan_tasks")
      .select("weekday,start_min,duration_min,title,detail,category,active,alert").eq("user_id", u.user.id).eq("active", true);
    if (tErr) return json({ ok: false, error: tErr.message }, 500);
    const desired = buildDesired((tasks ?? []) as PlanTask[]);
    // Never wipe the Todoist side because a read came back empty.
    if (desired.length === 0) return json({ ok: false, error: "no active My Day blocks to sync" }, 409);

    const { data: mapRows, error: mErr } = await sb.from("day_plan_todoist_map").select("key,todoist_id,content,due_string");
    if (mErr) return json({ ok: false, error: mErr.message }, 500);
    const plan = planSync(desired, (mapRows ?? []) as MapRow[]);

    const projects = await td("/projects");
    const list = ((projects.data as { results?: Array<{ id: string; name: string }> })?.results ?? (projects.data as Array<{ id: string; name: string }>) ?? []);
    const project = Array.isArray(list) ? list.find((p) => p.name === PROJECT_NAME) : undefined;
    if (!project) return json({ ok: false, error: `Todoist project ${PROJECT_NAME} not found` }, 502);

    const result = { created: 0, updated: 0, deleted: 0, unchanged: plan.unchanged, errors: [] as string[] };

    for (const d of plan.create) {
      const r = await td("/tasks", { method: "POST", body: JSON.stringify({
        content: d.content, description: d.description, project_id: project.id, due_string: d.due_string, labels: [LABEL] }) });
      const id = (r.data as { id?: string } | null)?.id;
      if (!r.ok || !id) { result.errors.push(`create ${d.content}: ${r.status}`); continue; }
      const { error } = await sb.from("day_plan_todoist_map").upsert({ key: d.key, todoist_id: id, content: d.content, due_string: d.due_string, synced_at: new Date().toISOString() });
      if (error) { result.errors.push(`map ${d.content}: ${error.message}`); continue; }
      result.created += 1;
    }
    for (const d of plan.update) {
      const r = await td(`/tasks/${d.todoist_id}`, { method: "POST", body: JSON.stringify({ content: d.content, description: d.description, due_string: d.due_string }) });
      if (!r.ok) { result.errors.push(`update ${d.content}: ${r.status}`); continue; }
      const { error } = await sb.from("day_plan_todoist_map").upsert({ key: d.key, todoist_id: d.todoist_id, content: d.content, due_string: d.due_string, synced_at: new Date().toISOString() });
      if (error) { result.errors.push(`map ${d.content}: ${error.message}`); continue; }
      result.updated += 1;
    }
    for (const e of plan.remove) {
      const r = await td(`/tasks/${e.todoist_id}`, { method: "DELETE" });
      // 404 means it is already gone on the Todoist side, which is the state we wanted.
      if (!r.ok && r.status !== 404) { result.errors.push(`delete ${e.content}: ${r.status}`); continue; }
      const { error } = await sb.from("day_plan_todoist_map").delete().eq("key", e.key);
      if (error) { result.errors.push(`map delete ${e.content}: ${error.message}`); continue; }
      result.deleted += 1;
    }
    return json({ ok: result.errors.length === 0, ...result }, result.errors.length ? 207 : 200);
  }

  return json({ ok: false, error: "unknown action" }, 400);
});
