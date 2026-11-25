import type { ScoreboardData } from "@/components/dashboard/ScopedProductionScoreboard";
import type { DemoNumberField } from "@/hooks/useDemoNumberFields";

type Values = Record<string, number | null>;
type Totals = { ap: number; policies: number };
type Primary = "imo" | "personal";
const MAX_MONEY = 1_000_000_000_000;
const MAX_COUNT = 1_000_000_000;
const valid = (value: unknown, count = false): value is number => typeof value === "number"
  && Number.isFinite(value) && value >= 0 && value <= (count ? MAX_COUNT : MAX_MONEY)
  && (!count || Number.isInteger(value));
const cash = (value: number) => Math.round(value * 100) / 100;
const scaled = (value: number, ratio: number, count = false) => {
  if (!valid(value, count)) return value;
  const result = count ? Math.round(value * ratio) : cash(value * ratio);
  return Number.isFinite(result) && result >= 0 ? result : value;
};

function field(key: string, label: string, value: unknown, kind: DemoNumberField["kind"] = "money"): DemoNumberField[] {
  return valid(value, kind === "count") ? [{ key, label, value, kind, min: 0, max: kind === "count" ? MAX_COUNT : MAX_MONEY }] : [];
}

function changedValue(values: Values, key: string, source: number, count = false): number | undefined {
  const value = values[key];
  return valid(source, count) && valid(value, count) && value !== source ? value : undefined;
}

/** Match the visible headline total: agency for admins, personal otherwise. */
export function scoreboardDemoPrimary(data: ScoreboardData): Primary {
  return data.imo ? "imo" : "personal";
}

export function scoreboardDemoFields(data: ScoreboardData | undefined): DemoNumberField[] {
  if (!data?.has_producer_profile) return [];
  const primary = scoreboardDemoPrimary(data);
  const totals = data[primary]!;
  const label = primary === "imo" ? "Agency" : "Personal";
  return [
    ...field("production.ap", `${label} production · ALP`, totals.ap),
    ...field("production.policies", `${label} policies`, totals.policies, "count"),
    ...(valid(totals.ap) ? [{ key: "issuedPaid.ap", label: `${label} issued & paid AP · demo`, value: null, kind: "money" as const, min: 0, max: MAX_MONEY, allowUnknown: true, maxFieldKey: "production.ap" }] : []),
    ...(valid(totals.policies, true) ? [{ key: "issuedPaid.policies", label: `${label} issued & paid policies · demo`, value: null, kind: "count" as const, min: 0, max: MAX_COUNT, allowUnknown: true, maxFieldKey: "production.policies" }] : []),
    ...field("earnings.direct", "Direct commission · estimate", data.earnings.direct),
    ...field("earnings.override", "Override commission · estimate", data.earnings.override),
    ...field("earnings.team", "Team commission · estimate", data.earnings.team_estimated),
  ];
}

export interface ScoreboardPlacementDemo {
  scope: "Agency" | "Personal";
  isDemo: boolean;
  issuedPaidAP: number | null;
  issuedPaidPolicies: number | null;
  submittedPolicies: number | null;
  placementPct: number | null;
}

/** No live paid or placement facts exist in ScoreboardData. Only explicitly
 * entered demo fields can fill these values; the displayed policy count is
 * their clearly labeled demonstration submission cohort. */
export function scoreboardPlacementDemo(data: ScoreboardData | undefined, values: Values, enabled: boolean): ScoreboardPlacementDemo {
  const scope = data?.imo ? "Agency" : "Personal";
  const empty: ScoreboardPlacementDemo = { scope, isDemo: false, issuedPaidAP: null, issuedPaidPolicies: null, submittedPolicies: null, placementPct: null };
  if (!enabled || !data?.has_producer_profile) return empty;
  const total = data[scoreboardDemoPrimary(data)]!;
  const ap = values["issuedPaid.ap"];
  const count = values["issuedPaid.policies"];
  const issuedPaidAP = valid(ap) && valid(total.ap) && ap <= total.ap ? ap : null;
  const issuedPaidPolicies = valid(count, true) && valid(total.policies, true) && count <= total.policies ? count : null;
  const isDemo = issuedPaidAP !== null || issuedPaidPolicies !== null;
  return {
    scope, isDemo, issuedPaidAP, issuedPaidPolicies,
    submittedPolicies: isDemo && valid(total.policies, true) ? total.policies : null,
    placementPct: issuedPaidPolicies !== null && total.policies > 0 ? Math.round(issuedPaidPolicies / total.policies * 1000) / 10 : null,
  };
}

/** Integer allocation keeps a scaled chart's cents/counts equal to its displayed total. */
export function distributeDemoTotal(total: number, weights: number[], decimals = 2): number[] {
  if (weights.length === 0) return [];
  if ((decimals !== 0 && decimals !== 2) || !valid(total, decimals === 0) || weights.some(value => !valid(value, decimals === 0))) return [...weights];
  const unit = 10 ** decimals;
  const units = Math.round(total * unit);
  const clean = weights.map(value => Number.isFinite(value) && value > 0 ? value : 0);
  const sum = clean.reduce((a, b) => a + b, 0);
  const raw = clean.map(value => sum > 0 ? units * value / sum : units / clean.length);
  const result = raw.map(Math.floor);
  const remaining = units - result.reduce((a, b) => a + b, 0);
  const order = raw.map((value, index) => ({ index, remainder: value - result[index] }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let i = 0; i < remaining; i += 1) result[order[i % order.length].index] += 1;
  return result.map(value => value / unit);
}

/** Reconcile a complete known series in cents/whole policies, never a partial or redacted one. */
function allocateCompleteSeries<T, K extends keyof T>(before: readonly T[], after: T[], key: K, oldTotal: number, newTotal: number, count = false): void {
  if (!before.length || !valid(oldTotal, count) || !valid(newTotal, count)) return;
  const weights = before.map(row => row[key]);
  if (!weights.every(value => valid(value, count))) return;
  const numbers = weights.map(value => Number(value));
  if (cash(numbers.reduce((sum, value) => sum + value, 0)) !== cash(oldTotal)) return;
  const values = distributeDemoTotal(newTotal, numbers, count ? 0 : 2);
  after.forEach((row, index) => { after[index] = { ...row, [key]: values[index] }; });
}

/**
 * These are local demonstration render values. Editing the scope total scales
 * its existing breakdown; it does not add agents, records, history, or access.
 */
export function applyScoreboardDemo(data: ScoreboardData | undefined, values: Values): ScoreboardData | undefined {
  if (!data?.has_producer_profile) return data;
  const primary = scoreboardDemoPrimary(data);
  const source = data[primary]!;
  const ap = changedValue(values, "production.ap", source.ap);
  const policyCount = changedValue(values, "production.policies", source.policies, true);
  const direct = changedValue(values, "earnings.direct", data.earnings.direct);
  const override = changedValue(values, "earnings.override", data.earnings.override);
  const teamEarnings = changedValue(values, "earnings.team", data.earnings.team_estimated);
  if ([ap, policyCount, direct, override, teamEarnings].every(value => value === undefined)) return data;
  const apRatio = ap !== undefined && source.ap > 0 ? ap / source.ap : 1;
  const countRatio = policyCount !== undefined && source.policies > 0 ? policyCount / source.policies : 1;
  const total = <T extends Totals>(input: T): T => ({ ...input, ap: scaled(input.ap, apRatio), policies: scaled(input.policies, countRatio, true) });
  const next: ScoreboardData = {
    ...data,
    personal: total(data.personal), direct_team: total(data.direct_team), recursive_team: total(data.recursive_team),
    team: total(data.team), imo: data.imo ? total(data.imo) : null,
    earnings: { ...data.earnings },
    by_agent: data.by_agent.map(row => ({ ...row })),
    reconciliation: {
      ...data.reconciliation,
      sources: data.reconciliation.sources.map(total), agencies: data.reconciliation.agencies.map(total),
      external_unattributed: total(data.reconciliation.external_unattributed),
      ...(data.reconciliation.unlinked_ap !== undefined ? { unlinked_ap: scaled(data.reconciliation.unlinked_ap, apRatio) } : {}),
    },
  };
  next[primary]!.ap = ap ?? source.ap;
  next[primary]!.policies = policyCount ?? source.policies;
  const zeroPersonal = new Set<keyof Totals>();
  for (const key of ["ap", "policies"] as const) {
    const proposed = key === "ap" ? ap : policyCount;
    // RPC recursive_team includes the viewer; admin IMO is the same complete
    // scope. A zero personal baseline has no ratio, but its additive delta is known.
    if (primary === "imo" && data.imo && data.recursive_team[key] === data.imo[key]) next.recursive_team[key] = next.imo![key];
    if (primary === "personal" && source[key] === 0 && proposed !== undefined && valid(data.recursive_team[key], key === "policies")) {
      next.recursive_team[key] = cash(data.recursive_team[key] + proposed);
      zeroPersonal.add(key);
    }
  }

  const rowAP = data.by_agent.reduce((sum, row) => sum + row.ap, 0);
  const rowPolicies = data.by_agent.reduce((sum, row) => sum + row.policies, 0);
  const apTarget = ap !== undefined && primary === "imo" && rowAP === source.ap ? ap : cash(rowAP * apRatio);
  const countTarget = policyCount !== undefined && primary === "imo" && rowPolicies === source.policies ? policyCount : Math.round(rowPolicies * countRatio);
  const apportionedAP = distributeDemoTotal(apTarget, data.by_agent.map(row => row.ap));
  const apportionedPolicies = distributeDemoTotal(countTarget, data.by_agent.map(row => row.policies), 0);
  const nextDirect = direct ?? scaled(data.earnings.direct, apRatio);
  const nextOverride = override ?? scaled(data.earnings.override, apRatio);
  const directRatio = data.earnings.direct > 0 ? nextDirect / data.earnings.direct : apRatio;
  const overrideRatio = data.earnings.override > 0 ? nextOverride / data.earnings.override : apRatio;
  next.by_agent = next.by_agent.map((row, index) => ({
    ...row, ap: apportionedAP[index], policies: apportionedPolicies[index],
    est_override: scaled(row.est_override, row.external ? apRatio : row.is_self ? directRatio : overrideRatio),
  }));
  // Pin an existing self cohort to the edited personal value. The remaining
  // known rows take the remainder; no absent producer/identity is fabricated.
  const selfIndexes = data.by_agent.flatMap((row, index) => row.is_self && !row.external ? [index] : []);
  const otherIndexes = data.by_agent.flatMap((row, index) => !row.is_self || row.external ? [index] : []);
  if (primary === "personal" && selfIndexes.length) {
    for (const key of ["ap", "policies"] as const) {
      const selfBefore = selfIndexes.map(index => data.by_agent[index]);
      const selfAfter = selfIndexes.map(index => next.by_agent[index]);
      allocateCompleteSeries(selfBefore, selfAfter, key, data.personal[key], next.personal[key], key === "policies");
      selfIndexes.forEach((index, position) => { next.by_agent[index] = selfAfter[position]; });
      const fullKnown = data.by_agent.every(row => valid(row[key], key === "policies"))
        && cash(data.by_agent.reduce((sum, row) => sum + row[key], 0)) === cash(data.recursive_team[key]);
      const selfKnown = selfBefore.every(row => valid(row[key], key === "policies"))
        && cash(selfBefore.reduce((sum, row) => sum + row[key], 0)) === cash(data.personal[key]);
      if (fullKnown && selfKnown && next.recursive_team[key] >= next.personal[key]) {
        const weights = otherIndexes.map(index => data.by_agent[index][key]);
        const parts = distributeDemoTotal(cash(next.recursive_team[key] - next.personal[key]), weights, key === "policies" ? 0 : 2);
        otherIndexes.forEach((index, position) => { next.by_agent[index][key] = parts[position]; });
      }
    }
  }

  const reconcileCohort = (key: "personal" | "direct_team" | "recursive_team", predicate: (row: ScoreboardData["by_agent"][number]) => boolean) => {
    const before = data.by_agent.filter(predicate);
    if (!before.length || key === primary) return;
    const after = next.by_agent.filter(predicate);
    for (const metric of ["ap", "policies"] as const) {
      // A new personal amount without an existing self row is deliberately
      // unallocated. Keep the known total instead of inventing a producer row.
      if (key === "recursive_team" && zeroPersonal.has(metric) && !selfIndexes.length) continue;
      if (valid(data[key][metric], metric === "policies") && before.every(row => valid(row[metric], metric === "policies"))
        && cash(before.reduce((sum, row) => sum + row[metric], 0)) === cash(data[key][metric])) {
        next[key][metric] = cash(after.reduce((sum, row) => sum + row[metric], 0));
      }
    }
  };
  reconcileCohort("personal", row => row.is_self && !row.external);
  reconcileCohort("direct_team", row => !row.is_self && !row.external && row.first_hop_id === row.agent_id);
  reconcileCohort("recursive_team", () => true);
  next.team = { ...next.team, ap: next.recursive_team.ap, policies: next.recursive_team.policies };
  for (const key of ["ap", "policies"] as const) {
    if (zeroPersonal.has(key) && !selfIndexes.length) continue;
    allocateCompleteSeries(data.reconciliation.sources, next.reconciliation.sources, key, data.recursive_team[key], next.recursive_team[key], key === "policies");
    allocateCompleteSeries(data.reconciliation.agencies, next.reconciliation.agencies, key, data.recursive_team[key], next.recursive_team[key], key === "policies");
  }
  next.earnings.direct = nextDirect;
  next.earnings.override = nextOverride;
  next.earnings.team_estimated = teamEarnings ?? scaled(data.earnings.team_estimated, apRatio);
  const gap = data.earnings.external_gap_override;
  if (gap) next.earnings.external_gap_override = {
    ...total(gap), est: gap.est === null ? null : scaled(gap.est, apRatio),
  };
  // The RPC includes an authorized external agency-head estimate in admin
  // earnings. Unknown components/unknown total stay unknown, never null→zero.
  const gapEstimate = data.imo && gap ? next.earnings.external_gap_override?.est : 0;
  if (valid(data.earnings.estimated) && valid(nextDirect) && valid(nextOverride) && valid(gapEstimate)) {
    next.earnings.estimated = cash(nextDirect + nextOverride + gapEstimate);
  }

  return next;
}

type ProjectionMetric = { mtd_ap: number; projected_ap: number; policies: number; active_days?: number };
export type DemoProjection = {
  has_producer_profile: boolean;
  elapsed_calendar_days: number;
  days_in_month: number;
  personal: ProjectionMetric;
  team: ProjectionMetric;
  imo: ProjectionMetric | null;
  agencies: Array<ProjectionMetric & { agency: string }>;
};

export function projectionDemoFields(data: DemoProjection | undefined): DemoNumberField[] {
  if (!data?.has_producer_profile) return [];
  const source = data.imo ?? data.personal;
  const label = data.imo ? "Agency" : "Personal";
  return [
    ...field("month.ap", `${label} month-to-date production · ALP`, source.mtd_ap),
    ...field("month.policies", `${label} month-to-date policies`, source.policies, "count"),
  ];
}

export function applyProjectionDemo<T extends DemoProjection>(data: T | undefined, values: Values): T | undefined {
  if (!data?.has_producer_profile) return data;
  const primary = data.imo ? "imo" : "personal";
  const source = data[primary]!;
  const ap = changedValue(values, "month.ap", source.mtd_ap);
  const policyCount = changedValue(values, "month.policies", source.policies, true);
  if (ap === undefined && policyCount === undefined) return data;
  const apRatio = ap !== undefined && source.mtd_ap > 0 ? ap / source.mtd_ap : 1;
  const countRatio = policyCount !== undefined && source.policies > 0 ? policyCount / source.policies : 1;
  const metric = <M extends ProjectionMetric>(input: M): M => ({
    ...input, mtd_ap: scaled(input.mtd_ap, apRatio), projected_ap: scaled(input.projected_ap, apRatio), policies: scaled(input.policies, countRatio, true),
  });
  const next = {
    ...data, personal: metric(data.personal), team: metric(data.team), imo: data.imo ? metric(data.imo) : null,
    agencies: data.agencies.map(metric),
  };
  const target = next[primary]!;
  target.mtd_ap = ap ?? source.mtd_ap;
  target.policies = policyCount ?? source.policies;
  const projectZero = (metric: ProjectionMetric, amount: number) => valid(metric.active_days, true) && metric.active_days >= 3
    && valid(data.elapsed_calendar_days, true) && data.elapsed_calendar_days > 0 && valid(data.days_in_month, true)
    && data.days_in_month >= data.elapsed_calendar_days
      ? cash(amount * Math.min(5, data.days_in_month / data.elapsed_calendar_days)) : amount;
  if (source.mtd_ap === 0 && ap !== undefined && valid(source.projected_ap)) {
    // The RPC keeps <3 active selling days at MTD. A demo amount cannot
    // manufacture those days, confidence, or uncapped calendar extrapolation.
    target.projected_ap = projectZero(source, ap);
  }
  if (primary === "personal") {
    if (source.mtd_ap === 0 && ap !== undefined && valid(data.team.mtd_ap)) {
      next.team.mtd_ap = cash(data.team.mtd_ap + ap);
      if (valid(data.team.projected_ap)) next.team.projected_ap = data.team.mtd_ap > 0
        ? scaled(data.team.projected_ap, next.team.mtd_ap / data.team.mtd_ap) : projectZero(data.team, next.team.mtd_ap);
    }
    if (source.policies === 0 && policyCount !== undefined && valid(data.team.policies, true)) next.team.policies = data.team.policies + policyCount;
  } else if (data.imo && next.imo) {
    for (const key of ["mtd_ap", "projected_ap", "policies"] as const) if (data.team[key] === data.imo[key]) next.team[key] = next.imo[key];
  }
  const beforeScope = data.imo ?? data.team;
  const afterScope = next.imo ?? next.team;
  for (const key of ["mtd_ap", "projected_ap", "policies"] as const) {
    allocateCompleteSeries(data.agencies, next.agencies, key, beforeScope[key], afterScope[key], key === "policies");
  }
  return next;
}

type AgencyDemoRow = {
  agency: string; alp: number; policies: number;
  alp_mtd?: number; policies_mtd?: number; alp_30d?: number; policies_30d?: number;
  est_owner_override_alp?: number; est_owner_override_mtd?: number; est_owner_override_30d?: number;
};
const AGENCY_PERIODS = [
  { amount: "alp", count: "policies", estimate: "est_owner_override_alp", label: "Production" },
  { amount: "alp_mtd", count: "policies_mtd", estimate: "est_owner_override_mtd", label: "Month to date" },
  { amount: "alp_30d", count: "policies_30d", estimate: "est_owner_override_30d", label: "Last 30 days" },
] as const;
const agencyKey = (agency: string, key: string) => `agency:${encodeURIComponent(agency)}:${key}`;

export function agencyDemoFields(rows: readonly AgencyDemoRow[], exactWindow: boolean): DemoNumberField[] {
  return rows.flatMap(row => rows.filter(other => other.agency === row.agency).length !== 1 ? [] : AGENCY_PERIODS
    .filter((_, index) => !exactWindow || index === 0)
    .flatMap(period => [
      ...field(agencyKey(row.agency, period.amount), `${row.agency} · ${period.label} ALP`, row[period.amount]),
      ...field(agencyKey(row.agency, period.count), `${row.agency} · ${period.label} policies`, row[period.count], "count"),
    ]));
}

export function applyAgencyDemo<T extends AgencyDemoRow>(rows: readonly T[], values: Values): T[] {
  return rows.map(row => {
    if (rows.filter(other => other.agency === row.agency).length !== 1) return row;
    const next = { ...row };
    for (const period of AGENCY_PERIODS) {
      const source = row[period.amount];
      const count = row[period.count];
      if (valid(source)) {
        const amount = changedValue(values, agencyKey(row.agency, period.amount), source);
        if (amount !== undefined) {
          next[period.amount] = amount;
          const estimate = row[period.estimate];
          if (source > 0 && valid(estimate)) next[period.estimate] = cash(estimate * amount / source);
        }
      }
      if (valid(count, true)) next[period.count] = changedValue(values, agencyKey(row.agency, period.count), count, true) ?? count;
    }
    return next;
  });
}
