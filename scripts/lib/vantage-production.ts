export const ORGANIZATION_ID = "00000000-0000-0000-0000-000000000001";
export const SOURCE = "agentcloud_production_api";

type Totals = { premium: number; policies: number; placed: number; producers: number };
type Producer = { agent_id: string; name: string; premium: number; policies: number; placed: number };
export type Production = { organization_id: string; period: { start: string; end: string }; totals: Totals; producers: Producer[] };

function amounts(value: unknown): value is { premium: number; policies: number; placed: number } {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return [v.premium, v.placed].every(n => typeof n === "number" && Number.isFinite(n) && n >= 0)
    && typeof v.policies === "number" && Number.isSafeInteger(v.policies) && v.policies >= 0
    && v.policies <= 100_000 && (v.policies > 0 || (v.premium === 0 && v.placed === 0));
}

export function validateProduction(value: unknown, start: string, end = start): Production {
  const v = value as Production;
  if (!v || v.organization_id !== ORGANIZATION_ID
    || v.period?.start !== `${start}T00:00:00.000Z`
    || v.period?.end !== `${end}T23:59:59.999Z`
    || !amounts(v.totals) || !Array.isArray(v.producers)
    || v.producers.some(p => !amounts(p) || typeof p.agent_id !== "string" || !p.agent_id
      || typeof p.name !== "string" || !p.name.trim())
    || new Set(v.producers.map(p => p.agent_id)).size !== v.producers.length
    || v.totals.producers !== v.producers.length) {
    throw new Error("Vantage returned an invalid organization, date range, or production payload");
  }
  for (const field of ["premium", "placed", "policies"] as const) {
    const sum = v.producers.reduce((total, p) => total + p[field], 0);
    if (Math.abs(sum - v.totals[field]) > (field === "policies" ? 0 : 0.011)) {
      throw new Error("Vantage producer totals do not reconcile to agency totals");
    }
  }
  return v;
}

export function snapshotRow(day: string, data: Production, now: string) {
  return {
    agency_name: "Vantage Financial", business_date: day,
    reported_policies: data.totals.policies, reported_alp: data.totals.premium,
    source: SOURCE, external_ref: `${ORGANIZATION_ID}:${day}`,
    reported_at: now, updated_at: now,
    metadata: {
      organization_id: ORGANIZATION_ID, placed_premium: data.totals.placed,
      producers: data.producers, period: data.period,
      provenance: "Agent Cloud read-only production API", verified: true,
    },
  };
}

export function syncDays(body: { start?: string; end?: string; reconcile?: boolean }, today: string): string[] {
  const floor = "2026-09-01";
  const end = body.end ?? today;
  const defaultStart = new Date(Date.parse(`${end}T00:00:00Z`) - (body.reconcile ? 30 : 2) * 86400000).toISOString().slice(0, 10);
  const start = body.start ?? (defaultStart < floor ? floor : defaultStart);
  const validDate = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day)
    && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day;
  if (!validDate(start) || !validDate(end) || start < floor || end > today || start > end
    || (Date.parse(end) - Date.parse(start)) / 86400000 > 30) throw new Error("Invalid sync date range (maximum 31 days, starting September 2026)");
  const days: string[] = [];
  for (let day = Date.parse(start); day <= Date.parse(end); day += 86400000) days.push(new Date(day).toISOString().slice(0, 10));
  return days;
}
