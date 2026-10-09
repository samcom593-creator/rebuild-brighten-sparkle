/**
 * Shared My Team roster types and small pure helpers, used by the page, the roster rows and the detail drawer so a
 * number is formatted one way everywhere.
 */

export interface RosterRow {
  agent_id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  agent_code: string | null;
  status: string | null;
  is_deactivated: boolean | null;
  is_inactive: boolean | null;
  is_sync_only: boolean | null;
  license_status: string | null;
  license_progress: string | null;
  onboarding_stage: string | null;
  training_stage: string | null;
  manager_id: string | null;
  manager_name: string | null;
  downline_count: number | null;
  contracts_total: number | null;
  contracts_active: number | null;
  mtd_alp: number | string | null;
  mtd_deals: number | null;
  today_alp: number | string | null;
  today_deals: number | null;
  selling_streak_days: number | null;
  free_leads_qualified: boolean;
  free_leads_reason: string | null;
  free_leads_needed_for_qual: number | string | null;
  l30_alp: number | string | null;
  l30_deals: number | null;
  lifetime_alp: number | string | null;
  lifetime_deals: number | null;
  first_posted_date: string | null;
  last_posted_date: string | null;
  last_contacted_at: string | null;
  created_at: string | null;
  tenure_days: number | null;
}

export const num = (v: number | string | null | undefined): number => Number(v ?? 0) || 0;

/** Compact USD. Returns null (never "$0") when there is genuinely nothing on file. */
export function usdOrNull(v: number | string | null | undefined): string | null {
  const n = num(v);
  if (n <= 0) return null;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

export const daysSince = (iso: string | null): number | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
};

/**
 * A sync-only row is NOT a person on this team. crm_agent_roster() projects `is_sync_only` for the placeholder seats
 * the deal ingest mints to hold production it could not match to an agent. They have no login, email, phone or
 * onboarding path, so nothing that implies a human action (call, chase, coach) applies to them.
 */
export const isSyncOnly = (r: RosterRow): boolean => r.is_sync_only === true;

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * A read that comes back exactly at the platform's page limit may be cut short. Treat that as a failed read so the
 * screen shows "could not be read" instead of a roster that quietly stops at row 1,000.
 */
export function ensureCompleteRead(label: string, rows: readonly unknown[] | null | undefined, cap = 1000): void {
  if (rows && rows.length >= cap) {
    throw new Error(`${label} returned ${rows.length} rows, the platform page limit, so the list may be incomplete`);
  }
}
