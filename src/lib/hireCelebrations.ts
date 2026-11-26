/**
 * In-app hire celebration (MP-HIRE-CELEBRATION, 2026-11-26): the screen half of
 * "an alert and a screen for every hire", beside the Slack post and the email the
 * outbox dispatcher sends.
 *
 * A hire is the `agents` INSERT the database already treats as one: measured on
 * the last 15 agent.hired outbox rows, every one was enqueued at the INSERT
 * (0s after agents.created_at), so this reads realtime INSERTs only and applies
 * the same predicate as fn_notify_agent_hired — status active, not deactivated,
 * not inactive, not a GHOST_/placeholder seat. An UPDATE is a correction or a
 * stage move, never a second hire.
 *
 * Realtime delivers every agents INSERT to every login (the leaderboard SELECT
 * policy is `auth.uid() IS NOT NULL`), so WHO sees the screen is decided here:
 * admins, managers, and the agent who recruited the hire. Everyone else still
 * sees the Slack post.
 */
export const HIRE_FRESHNESS_MS = 120_000;
export const HIRE_BATCH_DELAY_MS = 600;
export const HIRE_CELEBRATION_GAP_MS = 6_000;
export const HIRE_CELEBRATION_DURATION_MS = 9_000;
/** Names shown on one screen; the rest are counted. */
export const HIRE_BATCH_NAMES_SHOWN = 4;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Hire = {
  id: string;
  hiredAt: number;
  displayName: string;
  firstName: string;
  agentCode: string | null;
  licensed: boolean;
  onboardingStage: string | null;
  /** Recruiter first, then operational manager — fn_notify_agent_hired's precedence. */
  managerIds: string[];
};
export type HireCelebrationBatch = { key: string; hires: Hire[] };
export type HireViewer = { isAdmin: boolean; isManager: boolean; agentIds: ReadonlySet<string> };

export function isHireId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function cleanName(value: unknown): string | null {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  return name ? name.slice(0, 80) : null;
}

/** Only an active, non-placeholder, freshly inserted row with a real name is a hire worth a screen. */
export function readHire(value: unknown, armedAt: number, now: number): Hire | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (!isHireId(row.id)) return null;
  if (row.status !== "active") return null;
  if (row.is_deactivated === true || row.is_inactive === true) return null;
  const code = typeof row.agent_code === "string" ? row.agent_code.trim() : "";
  if (/^GHOST/i.test(code)) return null;
  // A sync placeholder seat (public.is_placeholder_agent): GHOST% code with no login.
  if (code.toUpperCase().startsWith("GHOST") && !row.user_id) return null;
  const displayName = cleanName(row.display_name);
  // No name, no screen: a celebration must never render a placeholder word as a person.
  if (!displayName) return null;
  if (typeof row.created_at !== "string") return null;
  const hiredAt = Date.parse(row.created_at);
  if (!Number.isFinite(hiredAt) || hiredAt < armedAt || hiredAt < now - HIRE_FRESHNESS_MS || hiredAt > now + 5_000) return null;
  const managerIds = [row.invited_by_manager_id, row.manager_id].filter(isHireId);
  return {
    id: row.id,
    hiredAt,
    displayName,
    firstName: displayName.split(" ")[0] ?? displayName,
    agentCode: code || null,
    licensed: String(row.license_status ?? "").toLowerCase() === "licensed",
    onboardingStage: typeof row.onboarding_stage === "string" && row.onboarding_stage ? row.onboarding_stage : null,
    managerIds: [...new Set(managerIds)],
  };
}

/** INSERT only. A hire arrives as an INSERT (15/15 measured); an UPDATE is never a second hire. */
export function readRealtimeHire(payload: { eventType?: string; new?: unknown }, armedAt: number, now: number): Hire | null {
  if (payload.eventType !== "INSERT") return null;
  return readHire(payload.new, armedAt, now);
}

/** Admins and managers see every hire; a plain agent sees only the people they recruited. */
export function canViewHire(viewer: HireViewer, hire: Hire): boolean {
  if (viewer.isAdmin || viewer.isManager) return true;
  return hire.managerIds.some((id) => viewer.agentIds.has(id));
}

export function addHireToBatch(batch: HireCelebrationBatch | null, hire: Hire): HireCelebrationBatch {
  const hires = batch ? [...batch.hires, hire] : [hire];
  return { key: hire.id, hires };
}

/** The screen's headline for one hire or a batch. */
export function hireHeadline(batch: HireCelebrationBatch): string {
  if (batch.hires.length === 1) return `Welcome, ${batch.hires[0].firstName}`;
  return `${batch.hires.length} new hires`;
}
