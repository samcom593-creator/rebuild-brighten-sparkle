import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
});

const url = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
if (!url || !serviceKey) throw new Error("Missing Supabase configuration");
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

type Actor = { userId: string; roles: Set<string>; allowedAgentIds: Set<string> | null };

async function authenticate(req: Request): Promise<Actor | Response> {
  const header = req.headers.get("Authorization") ?? "";
  if (!header.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
  const { data, error } = await admin.auth.getUser(header.slice(7));
  if (error || !data.user?.id) return json({ error: "invalid token" }, 401);

  const [{ data: roleRows, error: roleError }, { data: roots, error: rootError }] = await Promise.all([
    admin.from("user_roles").select("role").eq("user_id", data.user.id),
    admin.from("agents").select("id").eq("user_id", data.user.id),
  ]);
  if (roleError) throw roleError;
  if (rootError) throw rootError;
  const roles = new Set((roleRows ?? []).map((row) => String(row.role)));
  if (!["admin", "manager", "agent"].some((role) => roles.has(role))) {
    return json({ error: "forbidden" }, 403);
  }
  if (roles.has("admin")) return { userId: data.user.id, roles, allowedAgentIds: null };

  const allowed = new Set((roots ?? []).map((row) => String(row.id)));
  if (roles.has("manager") && allowed.size > 0) {
    const { data: rows, error: agentsError } = await admin
      .from("agents").select("id,manager_id,invited_by_manager_id").limit(3000);
    if (agentsError) throw agentsError;
    let changed = true;
    while (changed) {
      changed = false;
      for (const row of rows ?? []) {
        if (allowed.has(row.id)) continue;
        if ((row.manager_id && allowed.has(row.manager_id)) ||
            (row.invited_by_manager_id && allowed.has(row.invited_by_manager_id))) {
          allowed.add(row.id);
          changed = true;
        }
      }
    }
  }
  return { userId: data.user.id, roles, allowedAgentIds: allowed };
}

function canAccess(actor: Actor, agentId: unknown): agentId is string {
  return typeof agentId === "string" &&
    (actor.allowedAgentIds === null || actor.allowedAgentIds.has(agentId));
}

function phoenixToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Phoenix", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function validActivity(raw: unknown): Record<string, number> {
  const input = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const limits: Record<string, number> = {
    presentations: 500, hours_called: 2000, referrals_caught: 500,
    referral_presentations: 500, passed_price: 500, booked_inhome_referrals: 500,
  };
  const out: Record<string, number> = {};
  for (const [key, max] of Object.entries(limits)) {
    const value = Number(input[key] ?? 0);
    if (!Number.isFinite(value) || value < 0 || value > max) throw new Error(`Invalid ${key}`);
    out[key] = value;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const actor = await authenticate(req);
    if (actor instanceof Response) return actor;
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action ?? "");

    if (action === "search") {
      if (!actor.roles.has("admin")) return json({ error: "admin required" }, 403);
      const rawQuery = String(body.query ?? "").trim();
      if (rawQuery.length < 2) return json({ agents: [], applicants: [] });
      const query = rawQuery.toLowerCase();
      const queryDigits = rawQuery.replace(/\D/g, "");

      const [{ data: agents, error: agentError }, { data: applications, error: appError }] = await Promise.all([
        admin.from("agents").select("id,display_name,agent_code,onboarding_stage,license_status,status,user_id,profile_id,profile:profiles!agents_profile_id_fkey(full_name,email,phone)").limit(3000),
        admin.from("applications").select("id,first_name,last_name,email,phone,license_status,status,created_at").order("created_at", { ascending: false }).limit(2000),
      ]);
      if (agentError) throw agentError;
      if (appError) throw appError;

      const missing = (agents ?? []).filter((row: any) => !row.profile?.full_name && row.user_id);
      const fallbackProfiles = new Map<string, any>();
      if (missing.length) {
        const { data: extras, error: extraError } = await admin.from("profiles")
          .select("user_id,full_name,email,phone").in("user_id", missing.map((row: any) => row.user_id));
        if (extraError) throw extraError;
        for (const profile of extras ?? []) if (profile.user_id) fallbackProfiles.set(profile.user_id, profile);
      }
      const agentMatches = (agents ?? []).filter((row: any) => {
        const profile = row.profile || fallbackProfiles.get(row.user_id);
        return String(row.display_name || profile?.full_name || "").toLowerCase().includes(query) ||
          String(profile?.email || "").toLowerCase().includes(query) ||
          String(row.agent_code || "").toLowerCase().includes(query) ||
          (queryDigits.length >= 4 && String(profile?.phone || "").replace(/\D/g, "").includes(queryDigits));
      }).slice(0, 20).map((row: any) => {
        const profile = row.profile || fallbackProfiles.get(row.user_id);
        return {
          id: row.id, name: row.display_name || profile?.full_name || "—",
          email: profile?.email || "", phone: profile?.phone || "",
          agentCode: row.agent_code || null, licenseStatus: row.license_status || null,
          status: row.status || null, onboardingStage: row.onboarding_stage || null,
        };
      });
      const applicantMatches = (applications ?? []).filter((row: any) => {
        const name = `${row.first_name || ""} ${row.last_name || ""}`.toLowerCase();
        return name.includes(query) || String(row.email || "").toLowerCase().includes(query) ||
          (queryDigits.length >= 4 && String(row.phone || "").replace(/\D/g, "").includes(queryDigits));
      }).slice(0, 20).map((row: any) => ({
        id: row.id, name: `${row.first_name || ""} ${row.last_name || ""}`.trim() || "—",
        email: row.email || "", phone: row.phone || "",
        licenseStatus: row.license_status || null, status: row.status || null,
      }));
      return json({ agents: agentMatches, applicants: applicantMatches });
    }

    if (action === "load-existing") {
      if (!canAccess(actor, body.agentId)) return json({ error: "forbidden" }, 403);
      const date = String(body.date ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: "invalid date" }, 400);
      const { data, error } = await admin.from("daily_production").select("*")
        .eq("agent_id", body.agentId).eq("production_date", date).maybeSingle();
      if (error) throw error;
      return json({ data });
    }

    if (action === "submit") {
      if (!canAccess(actor, body.agentId)) return json({ error: "forbidden" }, 403);
      const date = String(body.date ?? "");
      const today = phoenixToday();
      const oldest = new Date(`${today}T12:00:00Z`);
      oldest.setUTCDate(oldest.getUTCDate() - 31);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today || date < oldest.toISOString().slice(0, 10)) {
        return json({ error: "date must be within the last 31 Phoenix days" }, 400);
      }
      let activity: Record<string, number>;
      try { activity = validActivity(body.productionData); }
      catch (error) { return json({ error: error instanceof Error ? error.message : "invalid activity" }, 400); }

      const { data: production, error: productionError } = await admin
        .from("v_production_unified").select("annual_premium")
        .eq("agent_id", body.agentId).eq("posted_date", date).limit(3000);
      if (productionError) throw productionError;
      const dealsClosed = production?.length ?? 0;
      const aop = (production ?? []).reduce((sum, row) => sum + Number(row.annual_premium || 0), 0);
      const { error } = await admin.from("daily_production").upsert({
        agent_id: body.agentId, production_date: date, ...activity,
        deals_closed: dealsClosed, aop,
      }, { onConflict: "agent_id,production_date" });
      if (error) throw error;
      return json({ success: true, production: { deals_closed: dealsClosed, aop, source: "v_production_unified" } });
    }

    if (action === "leaderboard") {
      const weekStart = String(body.weekStart ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return json({ error: "invalid week start" }, 400);
      const [{ data: production, error: productionError }, { data: agents, error: agentsError }, { data: canonical, error: canonicalError }] = await Promise.all([
        admin.from("v_production_unified").select("agent_id,annual_premium").gte("posted_date", weekStart).neq("origin", "external_daily_gap").limit(10000),
        admin.from("agents").select("id,display_name").limit(3000),
        admin.from("v_agent_canonical_map").select("agent_id,canonical_agent_id").limit(3000),
      ]);
      if (productionError) throw productionError;
      if (agentsError) throw agentsError;
      if (canonicalError) throw canonicalError;
      const canon = new Map((canonical ?? []).map((row) => [row.agent_id, row.canonical_agent_id]));
      const names = new Map((agents ?? []).map((row) => [row.id, row.display_name || "Agent"]));
      const totals = new Map<string, { alp: number; deals: number }>();
      for (const row of production ?? []) {
        if (!row.agent_id) continue;
        const id = canon.get(row.agent_id) ?? row.agent_id;
        const current = totals.get(id) ?? { alp: 0, deals: 0 };
        current.alp += Number(row.annual_premium || 0);
        current.deals += 1;
        totals.set(id, current);
      }
      const entries = [...totals].map(([agentId, total]) => ({
        agentId, agentName: names.get(agentId) ?? "Agent", weeklyALP: total.alp,
        weeklyDeals: total.deals, weeklyPresentations: 0, closingRate: 0,
      })).sort((a, b) => b.weeklyALP - a.weeklyALP || a.agentName.localeCompare(b.agentName))
        .map((entry, index) => ({ ...entry, rank: index + 1 }));
      return json({ entries, source: "v_production_unified" });
    }

    return json({ error: "unknown action" }, 400);
  } catch (error) {
    console.error("log-production error:", error);
    return json({ error: "request failed" }, 500);
  }
});
