import { SAM_AGENT_ID, VALID_DEAL_STATUSES } from "@/lib/dataLayer";

export type DealTruthTimestampRow = {
  posted_at?: string | null;
  created_at?: string | null;
};

export const DEAL_TRUTH_STATUS_FILTER = VALID_DEAL_STATUSES as unknown as string[];

export function dealTruthWindowOr(startIso: string, endIso: string): string {
  return [
    `and(posted_at.gte.${startIso},posted_at.lt.${endIso})`,
    `and(posted_at.is.null,created_at.gte.${startIso},created_at.lt.${endIso})`,
  ].join(",");
}

export function liveDealWindowOr(cutoffIso: string): string {
  return [
    `posted_at.gte.${cutoffIso}`,
    `and(posted_at.is.null,created_at.gte.${cutoffIso})`,
  ].join(",");
}

export function getDealTruthTimestamp(row: DealTruthTimestampRow): string | null {
  return row.posted_at || row.created_at || null;
}

export function excludeSamAgent<T extends { neq: (column: string, value: string) => T }>(query: T): T {
  return query.neq("agent_id", SAM_AGENT_ID);
}
