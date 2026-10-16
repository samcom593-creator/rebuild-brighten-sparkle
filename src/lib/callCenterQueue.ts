/**
 * Pure helpers behind the Call Center dial queue (src/pages/CallCenter.tsx).
 *
 * Findings F02 to F07 of the 2026-10-14 Galaxy OS improvement map. Nothing in
 * here touches React or a Supabase client: the page hands these functions
 * plain values or a filter chain, and src/tests/lib/callCenterQueue.test.ts
 * drives every branch with a recording stub. One definition each of "who may
 * see what", "who is credited", "what may be dialed", "how the next page is
 * addressed", "what counts as a sent follow-up" and "what a saved note looks
 * like" lives here.
 */
import type { AgentIdentity } from "@/lib/agentIdentity";
import { errorMessage } from "@/lib/queryState";

export type QueueSortOrder = "newest_first" | "oldest_first";
export type QueueStatusFilter = "new" | "no_pickup" | "contacted";
export type QueueLicenseFilter = "all" | "licensed" | "unlicensed";
export type QueueProgressFilter = "all" | "course_purchased" | "passed_test" | "waiting_on_license";
export type QueueRefererFilter = "all" | "mine" | "no_referrer";

/**
 * Rows per source per page. 500 was the hard cap before (2026-06-17 dial-speed
 * directive); it is now the page size, and the page says how much is loaded.
 */
export const QUEUE_PAGE_SIZE = 500;

// ------------------------------------------------------------------ F07 credit

/**
 * The columns that credit an application to an agent. The no-referrer filter,
 * the no-referrer badge and the Mine filter all read this one list, so a
 * record credited only through recruiter_id can never be labeled unattributed
 * by one of them while another matches it.
 */
export const ATTRIBUTION_COLUMNS = ["referral_manager_id", "assigned_agent_id", "recruiter_id"] as const;
export type AttributionColumn = (typeof ATTRIBUTION_COLUMNS)[number];
export type AttributionRow = Partial<Record<AttributionColumn, string | null | undefined>>;

/** True only when every attribution column is empty. */
export function isUnattributed(row: AttributionRow): boolean {
  return ATTRIBUTION_COLUMNS.every((column) => !row[column]);
}

/** PostgREST `or` filter: credited to this agent through any attribution column. */
export function attributedToFilter(agentId: string): string {
  return ATTRIBUTION_COLUMNS.map((column) => `${column}.eq.${agentId}`).join(",");
}

// ------------------------------------------------------------------ filter plans (F02, F06, F07)

/**
 * One PostgREST filter call recorded as data, so the count request and every
 * page request apply the identical plan and "N of M" means one set of filters.
 */
export type FilterOp =
  | { op: "is"; column: string; value: boolean | null }
  | { op: "eq"; column: string; value: string }
  | { op: "neq"; column: string; value: string }
  | { op: "gt"; column: string; value: string }
  | { op: "lt"; column: string; value: string }
  | { op: "not"; column: string; operator: "is"; value: boolean | null }
  | { op: "not"; column: string; operator: "in"; value: string }
  | { op: "or"; filters: string }
  | { op: "gte"; column: string; value: string };

/** The slice of a PostgREST filter builder a plan needs. */
export interface FilterChain {
  is(column: string, value: boolean | null): this;
  eq(column: string, value: string): this;
  neq(column: string, value: string): this;
  gt(column: string, value: string): this;
  lt(column: string, value: string): this;
  not(column: string, operator: string, value: unknown): this;
  or(filters: string): this;
  gte(column: string, value: string): this;
}

/** Apply a plan to a builder. The builder's own type is handed back to the caller. */
export function applyFilterOps<Q>(query: Q, ops: readonly FilterOp[]): Q {
  let chain = query as unknown as FilterChain;
  for (const step of ops) {
    switch (step.op) {
      case "is":
        chain = chain.is(step.column, step.value);
        break;
      case "eq":
        chain = chain.eq(step.column, step.value);
        break;
      case "neq":
        chain = chain.neq(step.column, step.value);
        break;
      case "gt":
        chain = chain.gt(step.column, step.value);
        break;
      case "lt":
        chain = chain.lt(step.column, step.value);
        break;
      case "not":
        chain = chain.not(step.column, step.operator, step.value);
        break;
      case "or":
        chain = chain.or(step.filters);
        break;
      case "gte":
        chain = chain.gte(step.column, step.value);
        break;
    }
  }
  return chain as unknown as Q;
}

// ------------------------------------------------------------------ what may be dialed (F06)

/**
 * Aged-lead statuses that close a lead. They stay out of the dial queue for
 * every role unless an admin turns on Include closed.
 */
export const AGED_CLOSED_STATUSES = ["hired", "contracted", "terminated", "promoted_to_application", "bad_applicant"] as const;

/** Aged-lead statuses nobody can dial, whatever the filters say. */
export const AGED_UNDIALABLE_STATUSES = ["bad_number"] as const;

/**
 * Application statuses that mean closed-lost (Not a Fit writes "rejected").
 * Hired, contracted and terminated applications are closed by their
 * timestamps. The recruiting worklist (recruitingQueues.isClosed) reads these
 * three as closed too; it also closes converted statuses such as contracting
 * and paid, which this queue leaves to the timestamps.
 */
export const APPLICATION_CLOSED_STATUSES = ["rejected", "disqualified", "lapsed"] as const;

export interface AgedLeadQueueOptions {
  statusFilter: QueueStatusFilter;
  licenseFilter: QueueLicenseFilter;
  dateSinceIso: string | null;
  /** "all" | "unassigned" | an agents.id */
  ownerFilter: string;
  /**
   * Client-side scope: only leads assigned to this manager. Null when the
   * server policy bounds the read (admin, VA, VA manager).
   */
  scopeAgentId: string | null;
  /** Admin opt-in: closed leads come back. Do-not-contact leads and bad numbers never do. */
  includeClosed: boolean;
}

export function agedLeadQueueOps(o: AgedLeadQueueOptions): FilterOp[] {
  const ops: FilterOp[] = [];
  if (o.statusFilter === "new") ops.push({ op: "is", column: "contacted_at", value: null });
  else if (o.statusFilter === "no_pickup") ops.push({ op: "eq", column: "status", value: "no_pickup" });
  else if (o.statusFilter === "contacted") ops.push({ op: "not", column: "contacted_at", operator: "is", value: null });
  if (o.licenseFilter !== "all") ops.push({ op: "eq", column: "license_status", value: o.licenseFilter });
  if (o.scopeAgentId) ops.push({ op: "eq", column: "assigned_manager_id", value: o.scopeAgentId });
  if (o.dateSinceIso) ops.push({ op: "gte", column: "created_at", value: o.dateSinceIso });
  if (o.ownerFilter === "unassigned") ops.push({ op: "is", column: "assigned_manager_id", value: null });
  else if (o.ownerFilter && o.ownerFilter !== "all") ops.push({ op: "eq", column: "assigned_manager_id", value: o.ownerFilter });
  // Contact rules for every role: asked not to be called, or the number is
  // known bad. The same dnc rule v_unlicensed_all applies.
  ops.push({ op: "not", column: "dnc", operator: "is", value: true });
  ops.push({ op: "is", column: "phone_bad_at", value: null });
  const excluded = o.includeClosed ? [...AGED_UNDIALABLE_STATUSES] : [...AGED_CLOSED_STATUSES, ...AGED_UNDIALABLE_STATUSES];
  // status is nullable text and NOT IN drops a NULL, which is an open lead.
  ops.push({ op: "or", filters: `status.is.null,status.not.in.(${excluded.join(",")})` });
  return ops;
}

export const MINE_NEEDS_AGENT_RECORD = "The Mine filter needs an agent record linked to this login.";

/** Why the Mine filter cannot run. A failed read is not the same as no record. */
export function mineFilterBlockedReason(identityError: string | null): string {
  if (identityError) {
    return `The Mine filter needs your agent record, and it could not be read: ${asSentence(identityError)} Retry, or pick another Referrer filter.`;
  }
  return `${MINE_NEEDS_AGENT_RECORD} Ask an admin to link one, or pick another Referrer filter.`;
}

export interface ApplicationQueueOptions {
  statusFilter: QueueStatusFilter;
  licenseFilter: QueueLicenseFilter;
  progressFilter: QueueProgressFilter;
  dateSinceIso: string | null;
  /** "all" | a state code */
  stateFilter: string;
  /** "all" | "unassigned" | an agents.id */
  ownerFilter: string;
  refererFilter: QueueRefererFilter;
  /** The caller's own agents.id. The Mine filter needs it. */
  identityAgentId: string | null;
  /** Client-side scope: rows credited to this agent. Null when the server policy bounds the read. */
  scopeAgentId: string | null;
  /** Admin opt-in: closed applications come back. Do-not-contact and phone-bad never do. */
  includeClosed: boolean;
}

/**
 * Throws MINE_NEEDS_AGENT_RECORD when Mine is selected without an agent
 * record; the page checks first and shows that reason instead of widening the
 * queue to everything.
 */
export function applicationQueueOps(o: ApplicationQueueOptions): FilterOp[] {
  const ops: FilterOp[] = [];
  if (o.refererFilter === "mine") {
    if (!o.identityAgentId) throw new Error(MINE_NEEDS_AGENT_RECORD);
    ops.push({ op: "or", filters: attributedToFilter(o.identityAgentId) });
  } else if (o.refererFilter === "no_referrer") {
    for (const column of ATTRIBUTION_COLUMNS) ops.push({ op: "is", column, value: null });
  }
  if (o.statusFilter === "new") ops.push({ op: "is", column: "contacted_at", value: null });
  else if (o.statusFilter === "no_pickup") ops.push({ op: "eq", column: "status", value: "no_pickup" });
  else if (o.statusFilter === "contacted") {
    ops.push({ op: "not", column: "contacted_at", operator: "is", value: null });
    ops.push({ op: "neq", column: "status", value: "no_pickup" });
  }
  if (o.licenseFilter !== "all") ops.push({ op: "eq", column: "license_status", value: o.licenseFilter });
  if (o.progressFilter !== "all") ops.push({ op: "eq", column: "license_progress", value: o.progressFilter });
  if (o.dateSinceIso) ops.push({ op: "gte", column: "created_at", value: o.dateSinceIso });
  if (o.stateFilter && o.stateFilter !== "all") ops.push({ op: "eq", column: "state", value: o.stateFilter });
  if (o.ownerFilter === "unassigned") {
    ops.push({ op: "is", column: "assigned_agent_id", value: null });
    ops.push({ op: "is", column: "referral_manager_id", value: null });
  } else if (o.ownerFilter && o.ownerFilter !== "all") {
    ops.push({ op: "or", filters: `assigned_agent_id.eq.${o.ownerFilter},referral_manager_id.eq.${o.ownerFilter}` });
  }
  // Contact rules for every role: asked not to be contacted, or the phone is
  // known bad. The recruiting worklist blocks the same two (blockersOf).
  ops.push({ op: "is", column: "do_not_contact_at", value: null });
  ops.push({ op: "is", column: "phone_bad_at", value: null });
  if (!o.includeClosed) {
    ops.push({ op: "is", column: "terminated_at", value: null });
    ops.push({ op: "is", column: "contracted_at", value: null });
    ops.push({ op: "is", column: "closed_at", value: null });
    ops.push({ op: "not", column: "status", operator: "in", value: `(${APPLICATION_CLOSED_STATUSES.join(",")})` });
  }
  if (o.scopeAgentId && o.refererFilter === "all") ops.push({ op: "or", filters: attributedToFilter(o.scopeAgentId) });
  return ops;
}

// ------------------------------------------------------------------ paging (F06)

export interface QueueCursor {
  /** Null once paging has reached the undated rows, which sort after every dated one. */
  createdAt: string | null;
  id: string;
}

/**
 * Keyset step past the last row of a page in (created_at, id) order, with
 * undated rows last in both directions (the page query orders nulls last).
 * Bulk imports share one created_at (452 aged leads do), so id breaks the tie,
 * and rows that leave the set as they are worked cannot shift the next page
 * the way an offset would.
 */
export function keysetOps(cursor: QueueCursor | null, sortOrder: QueueSortOrder): FilterOp[] {
  if (!cursor) return [];
  const ascending = sortOrder === "oldest_first";
  if (cursor.createdAt === null) {
    return [
      { op: "is", column: "created_at", value: null },
      ascending ? { op: "gt", column: "id", value: cursor.id } : { op: "lt", column: "id", value: cursor.id },
    ];
  }
  const cmp = ascending ? "gt" : "lt";
  const at = cursor.createdAt;
  return [
    {
      op: "or",
      filters: `created_at.${cmp}."${at}",and(created_at.eq."${at}",id.${cmp}."${cursor.id}"),created_at.is.null`,
    },
  ];
}

/** The cursor for the next page: the page's last row. Null for an empty page. */
export function cursorFromPage(rows: ReadonlyArray<{ created_at: string | null; id: string }>): QueueCursor | null {
  const last = rows[rows.length - 1];
  if (!last) return null;
  return { createdAt: last.created_at ?? null, id: last.id };
}

/** A full page may have more behind it; a short page is the end of the set. */
export function pageHasMore(pageLength: number, pageSize: number = QUEUE_PAGE_SIZE): boolean {
  return pageLength >= pageSize;
}

/**
 * Whether a next page exists. The count of matching rows after the cursor
 * answers it when that count was taken; without it, a full page may have more
 * behind it and a short page does not.
 */
export function nextHasMore(
  pageLength: number,
  cursor: QueueCursor | null,
  remaining: number | null,
  pageSize: number = QUEUE_PAGE_SIZE,
): boolean {
  if (remaining !== null) return remaining > 0;
  return pageHasMore(pageLength, pageSize) && cursor !== null;
}

export interface QueueRowLike {
  id: string;
  /** The row's created_at as stored. Null rows sort last, the way the server pages them. */
  queuedAt: string | null;
}

export function compareQueueRows(a: QueueRowLike, b: QueueRowLike, sortOrder: QueueSortOrder): number {
  const ascending = sortOrder === "oldest_first";
  const ta = a.queuedAt === null ? Number.NaN : Date.parse(a.queuedAt);
  const tb = b.queuedAt === null ? Number.NaN : Date.parse(b.queuedAt);
  const aDated = !Number.isNaN(ta);
  const bDated = !Number.isNaN(tb);
  if (aDated !== bDated) return aDated ? -1 : 1;
  if (aDated && ta !== tb) return ascending ? ta - tb : tb - ta;
  if (a.id === b.id) return 0;
  return (a.id < b.id) === ascending ? -1 : 1;
}

/** Stable sort by created time then id, in the queue's direction, undated rows last. */
export function sortQueueRows<T extends QueueRowLike>(rows: readonly T[], sortOrder: QueueSortOrder): T[] {
  return [...rows].sort((a, b) => compareQueueRows(a, b, sortOrder));
}

/** Append a page behind the rows already loaded, skipping any id already present. */
export function appendQueuePage<T extends { id: string }>(existing: readonly T[], page: readonly T[]): T[] {
  const seen = new Set(existing.map((row) => row.id));
  const added: T[] = [];
  for (const row of page) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    added.push(row);
  }
  return [...existing, ...added];
}

export interface QueueCoverage {
  /** Rows fetched so far for this source, worked ones included. */
  loaded: number;
  /** Rows matching the same filters when last counted; null when the count failed. */
  total: number | null;
  /** Why total is null, when it is. */
  countError: string | null;
  /** Matching rows after the last loaded one, counted when the page landed; null when not counted. */
  remaining: number | null;
  /** A next page exists. */
  hasMore: boolean;
}

export const EMPTY_COVERAGE: QueueCoverage = { loaded: 0, total: null, countError: null, remaining: null, hasMore: false };

/** A source the filters did not ask for: a definitional zero, not a failed read. */
export const SOURCE_NOT_REQUESTED: QueueCoverage = { loaded: 0, total: 0, countError: null, remaining: 0, hasMore: false };

export function combineCoverage(parts: readonly QueueCoverage[]): QueueCoverage {
  let loaded = 0;
  let total: number | null = 0;
  let countError: string | null = null;
  let remaining: number | null = 0;
  let hasMore = false;
  for (const part of parts) {
    loaded += part.loaded;
    if (part.total === null || total === null) total = null;
    else total += part.total;
    if (!countError && part.countError) countError = part.countError;
    if (part.remaining === null || remaining === null) remaining = null;
    else remaining += part.remaining;
    hasMore = hasMore || part.hasMore;
  }
  return { loaded, total, countError, remaining, hasMore };
}

/**
 * "509 loaded so far · 904 match now (counted 10:00 AM MST)", or an explicit
 * Unavailable when the count failed. Loaded counts worked rows that have left
 * the set since, so it is never presented as a share of the total.
 */
export function coverageLabel(c: QueueCoverage, countedAt: string | null = null): string {
  const loaded = `${c.loaded.toLocaleString()} loaded so far`;
  if (c.total === null) {
    return `${loaded} · matching total Unavailable${c.countError ? ` (${c.countError})` : ""}`;
  }
  return `${loaded} · ${c.total.toLocaleString()} match now${countedAt ? ` (counted ${countedAt})` : ""}`;
}

/** What is left behind the loaded rows, for the end of the loaded queue. */
export function remainingLabel(c: QueueCoverage): string {
  if (!c.hasMore) return "Every lead matching these filters has been loaded.";
  if (c.remaining === null) return "More leads may match these filters. Load more to check.";
  const one = c.remaining === 1;
  return `${c.remaining.toLocaleString()} more ${one ? "matches" : "match"} these filters and ${one ? "is" : "are"} not loaded yet.`;
}

// ------------------------------------------------------------------ access (F02, F17)

export interface QueueAccessInput {
  rolesLoading: boolean;
  isAdmin: boolean;
  isVa: boolean;
  isVaManager: boolean;
  /**
   * Recruiters may read every application, but the server lets them update
   * only rows credited to their own agent record and gives them no aged-lead
   * access, so they are scoped like agents until a recruiter update policy
   * exists. The flag only tailors the message when they have no record.
   */
  isRecruiter: boolean;
  /** From useAgentIdentity: undefined only while loading. */
  identity: AgentIdentity | undefined;
}

export type QueueAccess =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ambiguous"; count: number }
  | { kind: "no_identity"; recruiter: boolean }
  | {
      kind: "ready";
      /** The caller's own agents.id, used for hires, contracts, the Mine filter and follow-up CC. Null for staff without a record. */
      agentId: string | null;
      /** Client-side attribution scope. Null when the server policy bounds the read. */
      scopeAgentId: string | null;
      /** Admins may opt in to closed records; nobody sees them by default. */
      mayIncludeClosed: boolean;
      /** A staff role (admin, VA, VA manager) with no agent record: dialing works, hires and contracts do not. */
      staffWithoutAgentRow: boolean;
      /** The resolver's note, when the row was chosen among several or reached through a merge. */
      identityNote: string | null;
      /** Staff whose agent record read failed: they can still dial under the server policy. */
      identityError: string | null;
    };

/**
 * Who may dial, and under which scope. Staff are the roles is_agency_staff()
 * admits on the server (admin, VA, VA manager): RLS lets them read and update
 * every aged lead and application, so they never need a producer record to
 * get their queue. Everyone else, recruiters included, is scoped to their own
 * agent record, and an ambiguous record is quarantined rather than picked.
 */
export function resolveQueueAccess(i: QueueAccessInput): QueueAccess {
  if (i.rolesLoading || i.identity === undefined) return { kind: "loading" };
  const staff = i.isAdmin || i.isVa || i.isVaManager;
  const identity = i.identity;
  if (identity.status === "ambiguous") return { kind: "ambiguous", count: identity.candidates.length };
  if (identity.status === "error") {
    if (!staff) return { kind: "error", message: identity.message };
    return {
      kind: "ready",
      agentId: null,
      scopeAgentId: null,
      mayIncludeClosed: i.isAdmin,
      staffWithoutAgentRow: false,
      identityNote: null,
      identityError: identity.message,
    };
  }
  if (identity.status === "none") {
    if (!staff) return { kind: "no_identity", recruiter: i.isRecruiter };
    return {
      kind: "ready",
      agentId: null,
      scopeAgentId: null,
      mayIncludeClosed: i.isAdmin,
      staffWithoutAgentRow: true,
      identityNote: null,
      identityError: null,
    };
  }
  return {
    kind: "ready",
    agentId: identity.agentId,
    scopeAgentId: staff ? null : identity.agentId,
    mayIncludeClosed: i.isAdmin,
    staffWithoutAgentRow: false,
    identityNote: identity.note ?? null,
    identityError: null,
  };
}

/** The reason the queue cannot start, for every non-ready access state. */
export function queueAccessMessage(access: QueueAccess): { title: string; body: string } | null {
  switch (access.kind) {
    case "loading":
      return { title: "Still checking your Call Center access", body: "Your roles and agent record are loading." };
    case "error":
      return { title: "Your agent record could not be read", body: access.message };
    case "ambiguous":
      return {
        title: "More than one agent record matches this login",
        body: `${access.count} records share it. Ask an admin to merge them; nothing is shown until then.`,
      };
    case "no_identity":
      return {
        title: "This login has no agent record",
        body: access.recruiter
          ? "Recruiters dial the applications credited to their agent record, because those are the only ones the server lets them update. Ask an admin to link one; nothing can be dialed until then."
          : "Call Center scope comes from an agent record or a staff role (admin, VA or VA manager). Ask an admin to link one; nothing can be dialed until then.",
      };
    default:
      return null;
  }
}

// ------------------------------------------------------------------ follow-up email (F03)

export type FollowUpOutcome =
  /** The function reached the mail provider and it accepted the message. Accepted is not delivered. */
  | { kind: "accepted"; emailId: string | null }
  /** The function answered, the provider refused. */
  | { kind: "not_sent"; reason: string }
  /**
   * The function or the transport failed. Permanent when the function refused
   * the request before sending (a 4xx), so trying again cannot help.
   */
  | { kind: "failed"; message: string; permanent: boolean }
  /** A send for the same lead, action and message is still running. */
  | { kind: "in_flight" };

/**
 * One send attempt per lead, action and message variant. The licensed and
 * unlicensed buttons both send actionType "contacted", so the calendar link
 * keeps their operation ids apart.
 */
export function followUpKey(source: string, leadId: string, actionType: string, calendarLink?: string | null): string {
  return `${source}:${leadId}:${actionType}:${calendarLink ?? ""}`;
}

/** Capitalised and ending in a stop, so a following sentence reads as one. */
export function asSentence(text: string): string {
  const t = text.trim();
  if (!t) return t;
  const capped = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(capped) ? capped : `${capped}.`;
}

/**
 * send-post-call-followup answers every 4xx (bad body, refused login, lead
 * not found, no email address) before it calls the mail provider, so the same
 * request fails the same way again. Timeouts and rate limits are the 4xx
 * exceptions.
 */
export function isPermanentInvokeStatus(status: number | null): boolean {
  return status !== null && status >= 400 && status < 500 && status !== 408 && status !== 429;
}

/** The function's own error text when its non-2xx body carries one, else the client's error. */
export function invokeFailureMessage(error: unknown, body: unknown): string {
  if (body && typeof body === "object") {
    const o = body as Record<string, unknown>;
    if (typeof o.error === "string" && o.error.trim()) return o.error.trim();
    if (typeof o.reason === "string" && o.reason.trim()) return o.reason.trim();
    const nested = errorMessage(body, "");
    if (nested) return nested;
  }
  return errorMessage(error, "The follow-up function could not be reached.");
}

/**
 * Map a functions.invoke result to an outcome. invoke resolves with
 * { data: null, error } on a non-2xx status and never throws, and
 * send-post-call-followup answers 200 with emailSent:false when the mail
 * provider refuses, so only emailSent:true is a send.
 */
export function classifyFollowUpResponse(
  result: { data: unknown; error: unknown },
  errorBody: unknown = null,
  httpStatus: number | null = null,
): FollowUpOutcome {
  if (result.error) {
    return { kind: "failed", message: invokeFailureMessage(result.error, errorBody), permanent: isPermanentInvokeStatus(httpStatus) };
  }
  const data = result.data;
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    if (o.emailSent === true) return { kind: "accepted", emailId: typeof o.emailId === "string" ? o.emailId : null };
    if (o.emailSent === false) {
      const reason =
        typeof o.reason === "string" && o.reason.trim()
          ? o.reason.trim()
          : typeof o.error === "string" && o.error.trim()
            ? o.error.trim()
            : "The mail provider did not accept the message.";
      return { kind: "not_sent", reason };
    }
  }
  return {
    kind: "failed",
    message: "The follow-up function answered without a send receipt, so it is unknown whether a message left.",
    permanent: false,
  };
}

export interface FollowUpToast {
  level: "success" | "error" | "info";
  title: string;
  description: string;
}

export function followUpToast(outcome: FollowUpOutcome, leadName: string): FollowUpToast {
  switch (outcome.kind) {
    case "accepted":
      return {
        level: "success",
        title: "Follow-up email accepted by the mail provider",
        description: `Addressed to ${leadName}. Accepted means handed to the provider, not delivered; bounces are not reported back here.`,
      };
    case "not_sent":
      return { level: "error", title: "Follow-up email was NOT sent", description: outcome.reason };
    case "failed":
      return {
        level: "error",
        title: "Follow-up email did not go out",
        description: outcome.permanent
          ? `${asSentence(outcome.message)} No email was sent, and sending again will fail the same way.`
          : `${asSentence(outcome.message)} Nothing is confirmed as sent. Retry sends a new request; the server does not dedupe repeats yet.`,
      };
    case "in_flight":
      return { level: "info", title: "Already sending this follow-up", description: "Wait for the current attempt to finish." };
  }
}

// ------------------------------------------------------------------ call notes (F04)

/** Unsaved call notes for one lead, built from the recorder's running transcript. */
export interface NoteDraft {
  /** Text not saved yet. */
  pending: string;
  /** The recorder's last running transcript, so a later update adds only what is new. */
  lastSeen: string;
}

export const EMPTY_NOTE_DRAFT: NoteDraft = { pending: "", lastSeen: "" };

/**
 * Fold the recorder's running transcript into a draft. The recorder resends
 * its whole transcript on every update and starts again from empty on a new
 * recording, so only what follows the last transcript it sent is new. Text
 * already saved or discarded never comes back, and an unsaved earlier
 * recording is kept when a new one starts.
 */
export function recordTranscript(draft: NoteDraft, transcript: string): NoteDraft {
  if (transcript === draft.lastSeen) return draft;
  if (draft.lastSeen && transcript.startsWith(draft.lastSeen)) {
    return { pending: draft.pending + transcript.slice(draft.lastSeen.length), lastSeen: transcript };
  }
  const kept = draft.pending.trim() ? `${draft.pending}\n` : "";
  return { pending: kept + transcript, lastSeen: transcript };
}

/** The draft once `saved` (the pending text a save wrote) has landed. Text added while it ran stays pending. */
export function markDraftSaved(draft: NoteDraft, saved: string): NoteDraft {
  if (!saved || !draft.pending.startsWith(saved)) return draft;
  return { pending: draft.pending.slice(saved.length), lastSeen: draft.lastSeen };
}

/** Drop the unsaved text. The recorder's transcript so far stays seen, so it cannot bring the text back. */
export function discardNoteDraft(draft: NoteDraft): NoteDraft {
  return { pending: "", lastSeen: draft.lastSeen };
}

/** One appended call-notes entry: who wrote it and when, then the text. */
export function buildNoteEntry(note: string, nowIso: string, author: string | null): string {
  const by = author && author.trim() ? ` by ${author.trim()}` : "";
  return `\n\n[Call Notes - ${nowIso}${by}]\n${note.trim()}`;
}

export function appendNoteEntry(existing: string | null | undefined, entry: string): string {
  return `${existing ?? ""}${entry}`;
}

/** The server's returned notes end with the entry that was just appended. */
export function noteLanded(serverNotes: unknown, entry: string): boolean {
  return typeof serverNotes === "string" && serverNotes.endsWith(entry);
}

/**
 * A guarded write that matched no row either lost a race (the guard value
 * moved) or was refused (the value is unchanged, so the row was there and the
 * server would not update it, which is how row security answers).
 */
export function zeroRowVerdict(guardUsed: string | null, guardNow: string | null): "conflict" | "refused" {
  return guardUsed === guardNow ? "refused" : "conflict";
}

/**
 * aged_leads has no updated_at, so a notes append is guarded on the notes text
 * itself, which travels in the request URL. Live notes reach 1,518 characters
 * (2,092 once URL-encoded); past this size the request risks being refused
 * for length, so the page reports it instead of sending it.
 */
export const NOTE_LOCK_MAX_ENCODED = 6000;

export function noteLockFits(notes: string | null): boolean {
  return notes === null || encodeURIComponent(notes).length <= NOTE_LOCK_MAX_ENCODED;
}
