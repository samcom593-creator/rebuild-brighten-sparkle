import { isDepartedAgent } from "../_shared/departed.ts";

type Agent = { id: string; user_id: string | null; canonical_agent_id: string | null; status: string; is_deactivated: boolean | null; is_inactive: boolean | null; created_at: string };
type QueueRow = { id: string; agent_id: string; status: string; reason: string; resolved_at: string | null; updated_at: string };
type Activity = { agent_id: string; last_dial_at: string | null; app_last_activity_at: string | null };
type Production = { agent_id: string | null; posted_date: string | null };
type DbClient = { from: (name: string) => any; rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };
const DAY = 86_400_000;

/** Read every page before making a decision. An error or truncated scan never means zero activity. */
export async function readAll<T>(query: () => any): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; offset < 100_000; offset += 500) {
    const { data, error } = await query().range(offset, offset + 499);
    if (error || !Array.isArray(data)) throw new Error("Recovery evidence is unavailable.");
    rows.push(...data);
    if (data.length < 500) return rows;
  }
  throw new Error("Recovery evidence exceeded the complete-read limit.");
}

export function inactivityState(createdAt: string, productionDates: (string | null)[], activity: Activity, now: Date) {
  const dates = [...productionDates, activity.last_dial_at, activity.app_last_activity_at].filter((date): date is string => date !== null);
  // A production row without a date is evidence of activity whose age is unknown.
  if (productionDates.some(date => !date) || dates.some(date => !Number.isFinite(Date.parse(date)) || Date.parse(date) > now.getTime())) return null;
  const lastActivity = dates.length ? Math.max(...dates.map(date => Date.parse(date))) : Date.parse(createdAt);
  if (!Number.isFinite(lastActivity) || lastActivity > now.getTime()) return null;
  const days = Math.floor((now.getTime() - lastActivity) / DAY);
  const sortedProduction = productionDates.filter((date): date is string => !!date).sort();
  const lastProduction = sortedProduction[sortedProduction.length - 1] ?? null;
  return {
    days_inactive: days,
    last_production_date: lastProduction?.slice(0, 10) ?? null,
    reason: days < 7 ? "activity_resumed" : dates.length ? "no_recorded_activity" : "no_activity_since_joining",
    severity: days >= 30 ? "abandoned" : days >= 14 ? "critical" : "warning",
  };
}

/** Writes recovery cases only. Never changes an agent's account or sends contact. */
export async function scanInactivity(db: DbClient, now = new Date()) {
  const [agents, production, activity, queues, exclusions, suspensions] = await Promise.all([
    readAll<Agent>(() => db.from("agents").select("id, user_id, canonical_agent_id, status, is_deactivated, is_inactive, created_at").order("id")),
    readAll<Production>(() => db.from("v_production_canonical").select("agent_id, posted_date, row_key").order("row_key")),
    readAll<Activity>(() => db.from("v_agent_dialer_state").select("agent_id, last_dial_at, app_last_activity_at").order("agent_id")),
    readAll<QueueRow>(() => db.from("inactive_agent_queue").select("id, agent_id, status, reason, resolved_at, updated_at").in("status", ["open", "snoozed"]).order("id")),
    readAll<{ agent_id: string }>(() => db.from("roster_exclusions").select("agent_id").order("agent_id")),
    readAll<{ user_id: string }>(() => db.from("agent_access_suspensions").select("user_id").is("lifted_at", null).order("user_id")),
  ]);
  const byId = new Map(agents.map(agent => [agent.id, agent]));
  const canonical = (id: string): string | null => {
    const row = byId.get(id);
    if (!row) return null;
    const target = row.canonical_agent_id;
    if (!target || target === id) return id;
    const root = byId.get(target);
    // Existing activity views group one canonical hop. Repair broken/chained
    // identities before these records can drive a recovery case.
    return root && (!root.canonical_agent_id || root.canonical_agent_id === root.id) ? root.id : null;
  };
  const excluded = new Set(exclusions.map(row => canonical(row.agent_id) ?? row.agent_id));
  const uncertainIdentity = new Set<string>();
  for (const agent of agents) {
    if (canonical(agent.id) !== null) continue;
    let row: Agent | undefined = agent;
    for (let hop = 0; row && hop < 8; hop++) {
      if (!row.canonical_agent_id || row.canonical_agent_id === row.id) { uncertainIdentity.add(row.id); break; }
      row = byId.get(row.canonical_agent_id);
    }
  }
  const suspended = new Set(suspensions.map(row => row.user_id));
  const usersByAgent = new Map<string, Set<string>>();
  const rootsByUser = new Map<string, Set<string>>();
  for (const agent of agents) {
    const root = canonical(agent.id);
    if (!root || !agent.user_id) continue;
    const users = usersByAgent.get(root) ?? new Set<string>();
    users.add(agent.user_id); usersByAgent.set(root, users);
    // Departed duplicates do not make a live login ambiguous.
    if (agent.status !== "active" || agent.is_inactive || isDepartedAgent(agent)) continue;
    const roots = rootsByUser.get(agent.user_id) ?? new Set<string>();
    roots.add(root); rootsByUser.set(agent.user_id, roots);
  }
  const prodByAgent = new Map<string, (string | null)[]>();
  for (const row of production) {
    const root = row.agent_id ? canonical(row.agent_id) : null;
    if (!root) continue;
    const dates = prodByAgent.get(root) ?? []; dates.push(row.posted_date); prodByAgent.set(root, dates);
  }
  const activityByAgent = new Map(activity.map(row => [row.agent_id, row]));
  const candidates = agents.filter(agent => canonical(agent.id) === agent.id && agent.status === "active"
    && !agent.is_inactive && !isDepartedAgent(agent) && !excluded.has(agent.id) && !uncertainIdentity.has(agent.id)
    && ![...(usersByAgent.get(agent.id) ?? [])].some(id => suspended.has(id) || (rootsByUser.get(id)?.size ?? 0) > 1));

  // Verify every login guard before the first write. Missing/error verdicts
  // are not permission to queue a banned, deleted or ambiguous person.
  const blocked = new Set<string>();
  const userIds = [...new Set(candidates.flatMap(agent => [...(usersByAgent.get(agent.id) ?? [])]))];
  for (let offset = 0; offset < userIds.length; offset += 10) {
    await Promise.all(userIds.slice(offset, offset + 10).map(async id => {
      const { data, error } = await db.rpc("fn_user_login_blocked", { p_user_id: id });
      if (error || typeof data !== "boolean") throw new Error("Login eligibility could not be verified.");
      if (data) blocked.add(id);
    }));
  }

  const updates: { entry: QueueRow; state: NonNullable<ReturnType<typeof inactivityState>> }[] = [];
  const inserts: Record<string, unknown>[] = [];
  let unknown = 0;
  for (const agent of candidates) {
    if ([...(usersByAgent.get(agent.id) ?? [])].some(id => blocked.has(id))) continue;
    const signal = activityByAgent.get(agent.id);
    if (!signal) { unknown++; continue; }
    const state = inactivityState(agent.created_at, prodByAgent.get(agent.id) ?? [], signal, now);
    if (!state) { unknown++; continue; }
    const family = queues.filter(entry => canonical(entry.agent_id) === agent.id);
    const open = family.filter(entry => entry.status === "open");
    if (open.length) {
      // Preserve manual flags and manager notes. Resumed activity remains
      // visible for a manager's explicit recovery review.
      for (const entry of open) if (entry.reason !== "manual_flag") updates.push({ entry, state });
      continue;
    }
    if (state.days_inactive < 7) continue;
    // Honor the old UI's explicit 14-day snooze; new snoozes need a real
    // follow-up/deadline field, which this repair does not invent.
    if (family.some(entry => entry.status === "snoozed" && (!entry.resolved_at
      || !Number.isFinite(Date.parse(entry.resolved_at)) || now.getTime() - Date.parse(entry.resolved_at) < 14 * DAY))) continue;
    inserts.push({ agent_id: agent.id, ...state, status: "open", recovery_attempts: 0,
      detected_at: now.toISOString(), updated_at: now.toISOString() });
  }

  let updated = 0;
  for (const { entry, state } of updates) {
    const { data, error } = await db.from("inactive_agent_queue").update({ ...state, updated_at: now.toISOString() })
      .eq("id", entry.id).eq("status", "open").eq("updated_at", entry.updated_at).select("id");
    if (error || !Array.isArray(data) || data.length !== 1) throw new Error("Recovery queue changed during scan; refresh and retry.");
    updated++;
  }
  if (inserts.length) {
    const { data, error } = await db.from("inactive_agent_queue").insert(inserts).select("id");
    if (error || !Array.isArray(data) || data.length !== inserts.length) throw new Error("New recovery cases could not be confirmed.");
  }
  return { scanned: candidates.length, inserted: inserts.length, updated, evidence_unknown: unknown };
}
