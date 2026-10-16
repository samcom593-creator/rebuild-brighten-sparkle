/**
 * Call Center queue helpers (F02 to F07, 2026-10-14 Galaxy OS map): one
 * attribution definition, one filter plan for counts and pages, contact and
 * lifecycle rules for every role, keyset paging that survives rows leaving the
 * set (undated rows included), staff access without a producer record, a
 * follow-up email that is only "sent" when the provider accepted it, and call
 * notes that are saved once and to the right lead.
 */
import { describe, expect, it } from "vitest";
import type { AgentIdentityRow } from "@/lib/agentIdentity";
import { blockersOf, isClosed, type WorklistRow } from "@/lib/recruitingQueues";
import {
  AGED_CLOSED_STATUSES,
  AGED_UNDIALABLE_STATUSES,
  APPLICATION_CLOSED_STATUSES,
  ATTRIBUTION_COLUMNS,
  EMPTY_COVERAGE,
  EMPTY_NOTE_DRAFT,
  MINE_NEEDS_AGENT_RECORD,
  NOTE_LOCK_MAX_ENCODED,
  QUEUE_PAGE_SIZE,
  SOURCE_NOT_REQUESTED,
  agedLeadQueueOps,
  appendNoteEntry,
  appendQueuePage,
  applicationQueueOps,
  applyFilterOps,
  asSentence,
  attributedToFilter,
  buildNoteEntry,
  classifyFollowUpResponse,
  combineCoverage,
  coverageLabel,
  cursorFromPage,
  discardNoteDraft,
  followUpKey,
  followUpToast,
  invokeFailureMessage,
  isPermanentInvokeStatus,
  isUnattributed,
  keysetOps,
  markDraftSaved,
  mineFilterBlockedReason,
  nextHasMore,
  noteLanded,
  noteLockFits,
  pageHasMore,
  queueAccessMessage,
  recordTranscript,
  remainingLabel,
  resolveQueueAccess,
  sortQueueRows,
  zeroRowVerdict,
  type AgedLeadQueueOptions,
  type ApplicationQueueOptions,
  type FilterOp,
  type QueueAccessInput,
  type QueueCoverage,
} from "@/lib/callCenterQueue";

function row(overrides: Partial<AgentIdentityRow> = {}): AgentIdentityRow {
  return {
    id: "agent-1",
    user_id: "user-1",
    agent_code: "A1",
    display_name: "Agent One",
    status: "active",
    is_inactive: false,
    is_deactivated: false,
    created_at: "2026-01-01T00:00:00+00:00",
    canonical_agent_id: null,
    ...overrides,
  };
}

function recordingChain() {
  const calls: string[] = [];
  const chain = {
    calls,
    is(column: string, value: unknown) {
      calls.push(`is ${column} ${String(value)}`);
      return this;
    },
    eq(column: string, value: unknown) {
      calls.push(`eq ${column} ${String(value)}`);
      return this;
    },
    neq(column: string, value: unknown) {
      calls.push(`neq ${column} ${String(value)}`);
      return this;
    },
    gt(column: string, value: unknown) {
      calls.push(`gt ${column} ${String(value)}`);
      return this;
    },
    lt(column: string, value: unknown) {
      calls.push(`lt ${column} ${String(value)}`);
      return this;
    },
    not(column: string, operator: string, value: unknown) {
      calls.push(`not ${column} ${operator} ${String(value)}`);
      return this;
    },
    or(filters: string) {
      calls.push(`or ${filters}`);
      return this;
    },
    gte(column: string, value: unknown) {
      calls.push(`gte ${column} ${String(value)}`);
      return this;
    },
  };
  return chain;
}

function coverage(overrides: Partial<QueueCoverage> = {}): QueueCoverage {
  return { loaded: 0, total: 0, countError: null, remaining: 0, hasMore: false, ...overrides };
}

const baseAgedOptions: AgedLeadQueueOptions = {
  statusFilter: "new",
  licenseFilter: "all",
  dateSinceIso: null,
  ownerFilter: "all",
  scopeAgentId: null,
  includeClosed: false,
};

const baseAppOptions: ApplicationQueueOptions = {
  statusFilter: "new",
  licenseFilter: "all",
  progressFilter: "all",
  dateSinceIso: null,
  stateFilter: "all",
  ownerFilter: "all",
  refererFilter: "all",
  identityAgentId: null,
  scopeAgentId: null,
  includeClosed: false,
};

/** The contact and lifecycle tail every aged plan ends with. */
function agedTail(includeClosed: boolean): FilterOp[] {
  const excluded = includeClosed ? [...AGED_UNDIALABLE_STATUSES] : [...AGED_CLOSED_STATUSES, ...AGED_UNDIALABLE_STATUSES];
  return [
    { op: "not", column: "dnc", operator: "is", value: true },
    { op: "is", column: "phone_bad_at", value: null },
    { op: "or", filters: `status.is.null,status.not.in.(${excluded.join(",")})` },
  ];
}

const APP_CONTACT_RULES: FilterOp[] = [
  { op: "is", column: "do_not_contact_at", value: null },
  { op: "is", column: "phone_bad_at", value: null },
];

const APP_CLOSED_RULES: FilterOp[] = [
  { op: "is", column: "terminated_at", value: null },
  { op: "is", column: "contracted_at", value: null },
  { op: "is", column: "closed_at", value: null },
  { op: "not", column: "status", operator: "in", value: "(rejected,disqualified,lapsed)" },
];

describe("attribution (F07)", () => {
  it("is unattributed only when every attribution column is empty", () => {
    expect(isUnattributed({ referral_manager_id: null, assigned_agent_id: null, recruiter_id: null })).toBe(true);
    expect(isUnattributed({})).toBe(true);
  });

  it("never labels a record credited only through recruiter_id as unattributed", () => {
    expect(isUnattributed({ referral_manager_id: null, assigned_agent_id: null, recruiter_id: "r-1" })).toBe(false);
    expect(isUnattributed({ referral_manager_id: "m-1" })).toBe(false);
    expect(isUnattributed({ assigned_agent_id: "a-1" })).toBe(false);
  });

  it("the no_referrer filter and the badge read the same three columns", () => {
    const ops = applicationQueueOps({ ...baseAppOptions, refererFilter: "no_referrer" });
    const nullChecks = ops.filter((op): op is Extract<FilterOp, { op: "is" }> => op.op === "is" && op.value === null && (ATTRIBUTION_COLUMNS as readonly string[]).includes(op.column));
    expect(nullChecks.map((op) => op.column)).toEqual([...ATTRIBUTION_COLUMNS]);
  });

  it("the Mine filter credits through any attribution column", () => {
    expect(attributedToFilter("x")).toBe("referral_manager_id.eq.x,assigned_agent_id.eq.x,recruiter_id.eq.x");
    const ops = applicationQueueOps({ ...baseAppOptions, refererFilter: "mine", identityAgentId: "x" });
    expect(ops).toContainEqual({ op: "or", filters: attributedToFilter("x") });
  });

  it("refuses the Mine filter without an agent record instead of widening the queue", () => {
    expect(() => applicationQueueOps({ ...baseAppOptions, refererFilter: "mine", identityAgentId: null })).toThrow(MINE_NEEDS_AGENT_RECORD);
  });

  it("says why Mine cannot run, and does not call a failed read a missing record", () => {
    expect(mineFilterBlockedReason(null)).toContain(MINE_NEEDS_AGENT_RECORD);
    expect(mineFilterBlockedReason(null)).toContain("Ask an admin to link one");
    const failed = mineFilterBlockedReason("request timed out");
    expect(failed).toContain("could not be read: Request timed out.");
    expect(failed).not.toContain("Ask an admin");
  });
});

describe("filter plans (F02, F06)", () => {
  it("applies a plan in order and hands the same builder back", () => {
    const chain = recordingChain();
    const ops: FilterOp[] = [
      { op: "is", column: "contacted_at", value: null },
      { op: "eq", column: "status", value: "no_pickup" },
      { op: "not", column: "contacted_at", operator: "is", value: null },
      { op: "or", filters: "a.eq.1,b.eq.2" },
      { op: "gte", column: "created_at", value: "2026-01-01" },
      { op: "neq", column: "status", value: "no_pickup" },
      { op: "gt", column: "id", value: "a" },
      { op: "lt", column: "id", value: "b" },
      { op: "not", column: "status", operator: "in", value: "(x,y)" },
      { op: "not", column: "dnc", operator: "is", value: true },
    ];
    const result = applyFilterOps(chain, ops);
    expect(result).toBe(chain);
    expect(chain.calls).toEqual([
      "is contacted_at null",
      "eq status no_pickup",
      "not contacted_at is null",
      "or a.eq.1,b.eq.2",
      "gte created_at 2026-01-01",
      "neq status no_pickup",
      "gt id a",
      "lt id b",
      "not status in (x,y)",
      "not dnc is true",
    ]);
  });

  it("aged leads: status, license, manager scope, date and owner, then the contact and lifecycle rules", () => {
    expect(agedLeadQueueOps(baseAgedOptions)).toEqual([{ op: "is", column: "contacted_at", value: null }, ...agedTail(false)]);
    expect(
      agedLeadQueueOps({ ...baseAgedOptions, statusFilter: "no_pickup", licenseFilter: "licensed", dateSinceIso: "2026-01-01", ownerFilter: "unassigned", scopeAgentId: "m-1" }),
    ).toEqual([
      { op: "eq", column: "status", value: "no_pickup" },
      { op: "eq", column: "license_status", value: "licensed" },
      { op: "eq", column: "assigned_manager_id", value: "m-1" },
      { op: "gte", column: "created_at", value: "2026-01-01" },
      { op: "is", column: "assigned_manager_id", value: null },
      ...agedTail(false),
    ]);
    expect(agedLeadQueueOps({ ...baseAgedOptions, statusFilter: "contacted", ownerFilter: "owner-9" })).toEqual([
      { op: "not", column: "contacted_at", operator: "is", value: null },
      { op: "eq", column: "assigned_manager_id", value: "owner-9" },
      ...agedTail(false),
    ]);
  });

  it("aged leads: hired, contracted, terminated, converted and not-a-fit leads stay out for every role by default", () => {
    const chain = recordingChain();
    applyFilterOps(chain, agedLeadQueueOps(baseAgedOptions));
    expect(chain.calls).toEqual([
      "is contacted_at null",
      "not dnc is true",
      "is phone_bad_at null",
      "or status.is.null,status.not.in.(hired,contracted,terminated,promoted_to_application,bad_applicant,bad_number)",
    ]);
  });

  it("aged leads: Include closed brings closed leads back, never do-not-contact or a bad number", () => {
    const ops = agedLeadQueueOps({ ...baseAgedOptions, includeClosed: true });
    expect(ops).toEqual([{ op: "is", column: "contacted_at", value: null }, ...agedTail(true)]);
    expect(ops).toContainEqual({ op: "not", column: "dnc", operator: "is", value: true });
    expect(ops).toContainEqual({ op: "is", column: "phone_bad_at", value: null });
    expect(ops).toContainEqual({ op: "or", filters: "status.is.null,status.not.in.(bad_number)" });
  });

  it("aged leads: a NULL status is an open lead, so the status exclusion keeps it", () => {
    const statusRule = agedLeadQueueOps(baseAgedOptions).find((op) => op.op === "or");
    expect(statusRule).toEqual({ op: "or", filters: expect.stringMatching(/^status\.is\.null,/) });
  });

  it("applications: a scoped agent sees only rows credited to them, never closed, do-not-contact or phone-bad rows", () => {
    const ops = applicationQueueOps({ ...baseAppOptions, scopeAgentId: "me" });
    expect(ops).toEqual([
      { op: "is", column: "contacted_at", value: null },
      ...APP_CONTACT_RULES,
      ...APP_CLOSED_RULES,
      { op: "or", filters: attributedToFilter("me") },
    ]);
  });

  it("applications: staff send no attribution filter and get the same contact and lifecycle rules", () => {
    const staff = applicationQueueOps(baseAppOptions);
    expect(staff).toEqual([{ op: "is", column: "contacted_at", value: null }, ...APP_CONTACT_RULES, ...APP_CLOSED_RULES]);
    expect(staff.some((op) => op.op === "or")).toBe(false);
  });

  it("applications: Include closed brings back closed records, never do-not-contact or phone-bad ones", () => {
    const ops = applicationQueueOps({ ...baseAppOptions, includeClosed: true });
    expect(ops).toEqual([{ op: "is", column: "contacted_at", value: null }, ...APP_CONTACT_RULES]);
    const chain = recordingChain();
    applyFilterOps(chain, applicationQueueOps({ ...baseAppOptions, statusFilter: "contacted" }));
    expect(chain.calls).toContain("is do_not_contact_at null");
    expect(chain.calls).toContain("is phone_bad_at null");
    expect(chain.calls).toContain("not status in (rejected,disqualified,lapsed)");
  });

  it("applications: the scope filter is not repeated when Mine or no_referrer already narrows the set", () => {
    const mine = applicationQueueOps({ ...baseAppOptions, refererFilter: "mine", identityAgentId: "me", scopeAgentId: "me" });
    expect(mine.filter((op) => op.op === "or")).toHaveLength(1);
    const none = applicationQueueOps({ ...baseAppOptions, refererFilter: "no_referrer", scopeAgentId: "me" });
    expect(none.some((op) => op.op === "or")).toBe(false);
  });

  it("applications: contacted excludes no_pickup, plus progress, state and owner axes", () => {
    const ops = applicationQueueOps({
      ...baseAppOptions,
      statusFilter: "contacted",
      progressFilter: "passed_test",
      stateFilter: "TX",
      ownerFilter: "owner-1",
      dateSinceIso: "2026-02-02",
      licenseFilter: "unlicensed",
      includeClosed: true,
    });
    expect(ops).toEqual([
      { op: "not", column: "contacted_at", operator: "is", value: null },
      { op: "neq", column: "status", value: "no_pickup" },
      { op: "eq", column: "license_status", value: "unlicensed" },
      { op: "eq", column: "license_progress", value: "passed_test" },
      { op: "gte", column: "created_at", value: "2026-02-02" },
      { op: "eq", column: "state", value: "TX" },
      { op: "or", filters: "assigned_agent_id.eq.owner-1,referral_manager_id.eq.owner-1" },
      ...APP_CONTACT_RULES,
    ]);
    const unassigned = applicationQueueOps({ ...baseAppOptions, ownerFilter: "unassigned" });
    expect(unassigned).toContainEqual({ op: "is", column: "assigned_agent_id", value: null });
    expect(unassigned).toContainEqual({ op: "is", column: "referral_manager_id", value: null });
  });

  it("applications: the closed-lost statuses are ones the recruiting worklist also reads as closed, and do-not-contact closes in both", () => {
    const worklistRow = (overrides: Partial<WorklistRow>): WorklistRow =>
      ({
        status: "new",
        do_not_contact_at: null,
        has_agent: false,
        last_contact_outcome: null,
        next_step_stage_key: null,
        phone: "5550100",
        phone_bad_at: null,
        email: "a@example.com",
        email_bad_at: null,
        sms_consent_given: null,
        email_consent_given: null,
        ...overrides,
      }) as WorklistRow;
    for (const status of APPLICATION_CLOSED_STATUSES) expect(isClosed(worklistRow({ status }))).toBe(true);
    expect(isClosed(worklistRow({ status: "new" }))).toBe(false);
    expect(isClosed(worklistRow({ do_not_contact_at: "2026-10-01T00:00:00Z" }))).toBe(true);
    expect(blockersOf(worklistRow({ phone_bad_at: "2026-10-01T00:00:00Z" })).map((b) => b.key)).toContain("phone_bad");
  });
});

describe("keyset paging (F06)", () => {
  const cursor = { createdAt: "2026-06-17T18:05:59.12345+00:00", id: "0000-aaaa" };

  it("steps past the last row on (created_at, id) in the queue's direction, keeping the undated tail reachable", () => {
    expect(keysetOps(null, "oldest_first")).toEqual([]);
    expect(keysetOps(cursor, "oldest_first")).toEqual([
      {
        op: "or",
        filters:
          'created_at.gt."2026-06-17T18:05:59.12345+00:00",and(created_at.eq."2026-06-17T18:05:59.12345+00:00",id.gt."0000-aaaa"),created_at.is.null',
      },
    ]);
    expect(keysetOps(cursor, "newest_first")[0]).toEqual({
      op: "or",
      filters:
        'created_at.lt."2026-06-17T18:05:59.12345+00:00",and(created_at.eq."2026-06-17T18:05:59.12345+00:00",id.lt."0000-aaaa"),created_at.is.null',
    });
  });

  it("once paging reaches the undated rows it pages them by id alone", () => {
    expect(keysetOps({ createdAt: null, id: "u-5" }, "oldest_first")).toEqual([
      { op: "is", column: "created_at", value: null },
      { op: "gt", column: "id", value: "u-5" },
    ]);
    expect(keysetOps({ createdAt: null, id: "u-5" }, "newest_first")).toEqual([
      { op: "is", column: "created_at", value: null },
      { op: "lt", column: "id", value: "u-5" },
    ]);
  });

  it("takes the cursor from the last row, an undated one included", () => {
    expect(cursorFromPage([])).toBeNull();
    expect(cursorFromPage([{ created_at: "a", id: "1" }, { created_at: "b", id: "2" }])).toEqual({ createdAt: "b", id: "2" });
    expect(cursorFromPage([{ created_at: "a", id: "1" }, { created_at: null, id: "2" }])).toEqual({ createdAt: null, id: "2" });
  });

  it("a full page may have more; a short page is the end", () => {
    expect(pageHasMore(QUEUE_PAGE_SIZE)).toBe(true);
    expect(pageHasMore(QUEUE_PAGE_SIZE - 1)).toBe(false);
    expect(pageHasMore(3, 3)).toBe(true);
  });

  it("the count past the cursor decides whether there is more; without it a full page only may have more", () => {
    const c = { createdAt: "x", id: "1" };
    expect(nextHasMore(QUEUE_PAGE_SIZE, c, 0)).toBe(false);
    expect(nextHasMore(QUEUE_PAGE_SIZE, c, 395)).toBe(true);
    expect(nextHasMore(QUEUE_PAGE_SIZE, c, null)).toBe(true);
    expect(nextHasMore(12, c, null)).toBe(false);
    expect(nextHasMore(QUEUE_PAGE_SIZE, null, null)).toBe(false);
  });

  it("sorts by time then id so rows sharing one created_at keep a stable order, and undated rows go last both ways", () => {
    const rows = [
      { id: "b", queuedAt: "2026-01-01T00:00:00Z" },
      { id: "u", queuedAt: null },
      { id: "a", queuedAt: "2026-01-01T00:00:00Z" },
      { id: "c", queuedAt: "2025-12-31T00:00:00Z" },
    ];
    expect(sortQueueRows(rows, "oldest_first").map((r) => r.id)).toEqual(["c", "a", "b", "u"]);
    expect(sortQueueRows(rows, "newest_first").map((r) => r.id)).toEqual(["b", "a", "c", "u"]);
    expect(rows.map((r) => r.id)).toEqual(["b", "u", "a", "c"]);
  });

  it("appends a page without duplicating ids already on screen", () => {
    const merged = appendQueuePage([{ id: "1" }, { id: "2" }], [{ id: "2" }, { id: "3" }, { id: "3" }]);
    expect(merged.map((r) => r.id)).toEqual(["1", "2", "3"]);
  });

  it("coverage says how many are loaded and how many match now, never loaded as a share of the total", () => {
    expect(coverageLabel(coverage({ loaded: 500, total: 895, hasMore: true }), "10:00 AM MST")).toBe(
      "500 loaded so far · 895 match now (counted 10:00 AM MST)",
    );
    // Worked rows leave the set, so loaded can pass the fresh count.
    expect(coverageLabel(coverage({ loaded: 895, total: 595 }))).toBe("895 loaded so far · 595 match now");
    expect(coverageLabel(coverage({ loaded: 12, total: null, countError: "timeout" }))).toBe("12 loaded so far · matching total Unavailable (timeout)");
    expect(coverageLabel(coverage({ loaded: 0, total: null }))).toBe("0 loaded so far · matching total Unavailable");
  });

  it("the end of the loaded queue says what is left, and does not claim more when none is left", () => {
    expect(remainingLabel(coverage({ hasMore: true, remaining: 395 }))).toBe("395 more match these filters and are not loaded yet.");
    expect(remainingLabel(coverage({ hasMore: true, remaining: 1 }))).toBe("1 more matches these filters and is not loaded yet.");
    expect(remainingLabel(coverage({ hasMore: true, remaining: null }))).toBe("More leads may match these filters. Load more to check.");
    expect(remainingLabel(coverage({ hasMore: false, remaining: 0 }))).toBe("Every lead matching these filters has been loaded.");
  });

  it("a failed count on either source makes the combined total Unavailable, never a partial sum", () => {
    const ok = coverage({ loaded: 10, total: 20 });
    expect(combineCoverage([ok, coverage({ loaded: 5, total: 7, remaining: 3, hasMore: true })])).toEqual({
      loaded: 15,
      total: 27,
      countError: null,
      remaining: 3,
      hasMore: true,
    });
    expect(combineCoverage([ok, coverage({ loaded: 5, total: null, countError: "boom", remaining: null })])).toEqual({
      loaded: 15,
      total: null,
      countError: "boom",
      remaining: null,
      hasMore: false,
    });
    expect(combineCoverage([EMPTY_COVERAGE, SOURCE_NOT_REQUESTED]).total).toBeNull();
    expect(combineCoverage([ok, SOURCE_NOT_REQUESTED]).total).toBe(20);
    expect(combineCoverage([ok, SOURCE_NOT_REQUESTED]).remaining).toBe(0);
  });
});

describe("queue access (F02, F17)", () => {
  const base: QueueAccessInput = {
    rolesLoading: false,
    isAdmin: false,
    isVa: false,
    isVaManager: false,
    isRecruiter: false,
    identity: { status: "resolved", agentId: "agent-1", row: row() },
  };

  it("waits for roles and for the identity read", () => {
    expect(resolveQueueAccess({ ...base, rolesLoading: true })).toEqual({ kind: "loading" });
    expect(resolveQueueAccess({ ...base, identity: undefined })).toEqual({ kind: "loading" });
  });

  it("a VA or VA manager with no agent record gets a queue bounded by the server policy, not a disabled Start button", () => {
    const access = resolveQueueAccess({ ...base, isVa: true, identity: { status: "none" } });
    expect(access).toEqual({
      kind: "ready",
      agentId: null,
      scopeAgentId: null,
      mayIncludeClosed: false,
      staffWithoutAgentRow: true,
      identityNote: null,
      identityError: null,
    });
    expect(resolveQueueAccess({ ...base, isVaManager: true, identity: { status: "none" } }).kind).toBe("ready");
  });

  it("a recruiter is scoped like an agent, because the server only lets them update rows credited to them", () => {
    expect(resolveQueueAccess({ ...base, isRecruiter: true })).toMatchObject({ kind: "ready", agentId: "agent-1", scopeAgentId: "agent-1", mayIncludeClosed: false });
    const none = resolveQueueAccess({ ...base, isRecruiter: true, identity: { status: "none" } });
    expect(none).toEqual({ kind: "no_identity", recruiter: true });
    expect(queueAccessMessage(none)?.body).toContain("credited to their agent record");
    expect(resolveQueueAccess({ ...base, isRecruiter: true, identity: { status: "error", message: "boom" } })).toEqual({ kind: "error", message: "boom" });
  });

  it("a plain login with no agent record is told what to do, not shown an empty queue", () => {
    const access = resolveQueueAccess({ ...base, identity: { status: "none" } });
    expect(access).toEqual({ kind: "no_identity", recruiter: false });
    expect(queueAccessMessage(access)?.title).toBe("This login has no agent record");
    expect(queueAccessMessage(access)?.body).toContain("admin, VA or VA manager");
  });

  it("a failed identity read is an error for agents and a visible note for staff", () => {
    expect(resolveQueueAccess({ ...base, identity: { status: "error", message: "boom" } })).toEqual({ kind: "error", message: "boom" });
    const staff = resolveQueueAccess({ ...base, isAdmin: true, identity: { status: "error", message: "boom" } });
    expect(staff.kind).toBe("ready");
    if (staff.kind === "ready") {
      expect(staff.identityError).toBe("boom");
      expect(staff.agentId).toBeNull();
      expect(staff.mayIncludeClosed).toBe(true);
    }
  });

  it("an ambiguous record is quarantined for everyone, admins included", () => {
    const identity = { status: "ambiguous" as const, candidates: [row(), row({ id: "agent-2" })] };
    expect(resolveQueueAccess({ ...base, identity })).toEqual({ kind: "ambiguous", count: 2 });
    expect(resolveQueueAccess({ ...base, isAdmin: true, identity })).toEqual({ kind: "ambiguous", count: 2 });
    expect(queueAccessMessage({ kind: "ambiguous", count: 2 })?.body).toContain("2 records");
  });

  it("a resolved agent is scoped to their own record; admins and staff are not; only admins may include closed records", () => {
    const agent = resolveQueueAccess(base);
    expect(agent).toEqual({
      kind: "ready",
      agentId: "agent-1",
      scopeAgentId: "agent-1",
      mayIncludeClosed: false,
      staffWithoutAgentRow: false,
      identityNote: null,
      identityError: null,
    });
    const admin = resolveQueueAccess({ ...base, isAdmin: true, identity: { status: "resolved", agentId: "agent-1", row: row(), note: "merged" } });
    expect(admin).toMatchObject({ kind: "ready", agentId: "agent-1", scopeAgentId: null, mayIncludeClosed: true, identityNote: "merged" });
    const va = resolveQueueAccess({ ...base, isVa: true });
    expect(va).toMatchObject({ kind: "ready", agentId: "agent-1", scopeAgentId: null, mayIncludeClosed: false });
  });

  it("has a message for every non-ready state and none for ready", () => {
    expect(queueAccessMessage({ kind: "loading" })).not.toBeNull();
    expect(queueAccessMessage({ kind: "error", message: "x" })?.body).toBe("x");
    expect(queueAccessMessage(resolveQueueAccess(base))).toBeNull();
  });
});

describe("follow-up email outcome (F03)", () => {
  it("only emailSent:true is a send, and it is labeled accepted rather than delivered", () => {
    const outcome = classifyFollowUpResponse({ data: { success: true, emailSent: true, emailId: "re_1" }, error: null });
    expect(outcome).toEqual({ kind: "accepted", emailId: "re_1" });
    const t = followUpToast(outcome, "Jane");
    expect(t.level).toBe("success");
    expect(t.title).toContain("accepted by the mail provider");
    expect(t.description).toContain("not delivered");
  });

  it("a 200 with emailSent:false is NOT sent, with the provider's reason", () => {
    const outcome = classifyFollowUpResponse({ data: { success: true, emailSent: false, reason: "domain not verified" }, error: null });
    expect(outcome).toEqual({ kind: "not_sent", reason: "domain not verified" });
    expect(followUpToast(outcome, "Jane")).toMatchObject({ level: "error", title: "Follow-up email was NOT sent", description: "domain not verified" });
    expect(classifyFollowUpResponse({ data: { emailSent: false }, error: null })).toEqual({ kind: "not_sent", reason: "The mail provider did not accept the message." });
  });

  it("a non-2xx answer is failed, naming the function's own error text when the body carries one", () => {
    const error = new Error("Edge Function returned a non-2xx status code");
    expect(classifyFollowUpResponse({ data: null, error }, { success: false, error: "lead has no email address" }, 422)).toEqual({
      kind: "failed",
      message: "lead has no email address",
      permanent: true,
    });
    expect(classifyFollowUpResponse({ data: null, error })).toEqual({ kind: "failed", message: "Edge Function returned a non-2xx status code", permanent: false });
    expect(invokeFailureMessage(error, { reason: "rate limited" })).toBe("rate limited");
    expect(invokeFailureMessage(null, null)).toBe("The follow-up function could not be reached.");
  });

  it("a refusal before sending reads as one sentence and does not suggest a retry that cannot help", () => {
    const t = followUpToast({ kind: "failed", message: "lead has no email address", permanent: true }, "Jane");
    expect(t.description).toBe("Lead has no email address. No email was sent, and sending again will fail the same way.");
    expect(t.description).not.toContain("Retry");
  });

  it("a server or transport failure keeps the unknown-send warning and the retry note", () => {
    const t = followUpToast({ kind: "failed", message: "lead lookup failed", permanent: false }, "Jane");
    expect(t.description).toBe(
      "Lead lookup failed. Nothing is confirmed as sent. Retry sends a new request; the server does not dedupe repeats yet.",
    );
  });

  it("only a 4xx other than timeout and rate limit is permanent", () => {
    expect([400, 401, 403, 404, 422].every(isPermanentInvokeStatus)).toBe(true);
    expect([408, 429, 500, 503].some(isPermanentInvokeStatus)).toBe(false);
    expect(isPermanentInvokeStatus(null)).toBe(false);
  });

  it("an answer without a receipt is failed and says the send is unknown, never success", () => {
    const outcome = classifyFollowUpResponse({ data: {}, error: null });
    expect(outcome).toMatchObject({ kind: "failed", permanent: false });
    const t = followUpToast(outcome, "Jane");
    expect(t.level).toBe("error");
    expect(t.description).toContain("Nothing is confirmed as sent");
    expect(classifyFollowUpResponse({ data: null, error: null }).kind).toBe("failed");
    expect(classifyFollowUpResponse({ data: "ok", error: null }).kind).toBe("failed");
  });

  it("a second click while a send runs is reported, not sent twice", () => {
    expect(followUpToast({ kind: "in_flight" }, "Jane")).toMatchObject({ level: "info", title: "Already sending this follow-up" });
  });

  it("the licensed and unlicensed follow-ups never share an operation id", () => {
    const licensed = followUpKey("applications", "lead-1", "contacted", "https://x/licensed");
    const unlicensed = followUpKey("applications", "lead-1", "contacted", "https://x/get-licensed");
    expect(licensed).not.toBe(unlicensed);
    expect(followUpKey("aged_leads", "lead-1", "hired")).toBe("aged_leads:lead-1:hired:");
  });

  it("asSentence capitalises and ends a message once", () => {
    expect(asSentence("lead has no email address")).toBe("Lead has no email address.");
    expect(asSentence("Already done.")).toBe("Already done.");
    expect(asSentence("  ")).toBe("");
  });
});

describe("call notes (F04)", () => {
  it("stamps who and when, appends to the server's current text, and can verify the write landed", () => {
    const entry = buildNoteEntry("  Spoke, wants Tuesday  ", "2026-10-14T18:00:00.000Z", "Sam James");
    expect(entry).toBe("\n\n[Call Notes - 2026-10-14T18:00:00.000Z by Sam James]\nSpoke, wants Tuesday");
    expect(buildNoteEntry("x", "t", null)).toBe("\n\n[Call Notes - t]\nx");
    expect(buildNoteEntry("x", "t", "   ")).toBe("\n\n[Call Notes - t]\nx");
    expect(appendNoteEntry(null, entry)).toBe(entry);
    expect(appendNoteEntry("older", entry)).toBe(`older${entry}`);
    expect(noteLanded(`older${entry}`, entry)).toBe(true);
    expect(noteLanded("older", entry)).toBe(false);
    expect(noteLanded(null, entry)).toBe(false);
  });

  it("a running transcript only adds what is new", () => {
    let draft = recordTranscript(EMPTY_NOTE_DRAFT, "hello ");
    draft = recordTranscript(draft, "hello world ");
    expect(draft).toEqual({ pending: "hello world ", lastSeen: "hello world " });
    expect(recordTranscript(draft, "hello world ")).toBe(draft);
  });

  it("once saved, the same words are never saved again, so a second flush in one chain writes nothing", () => {
    let draft = recordTranscript(EMPTY_NOTE_DRAFT, "spoke to Jane ");
    const firstFlush = draft.pending;
    draft = markDraftSaved(draft, firstFlush);
    expect(draft.pending).toBe("");
    // The recorder resends the whole transcript with one more sentence.
    draft = recordTranscript(draft, "spoke to Jane wants Tuesday ");
    expect(draft.pending).toBe("wants Tuesday ");
  });

  it("words that arrive while a save runs stay pending", () => {
    let draft = recordTranscript(EMPTY_NOTE_DRAFT, "one ");
    const saving = draft.pending;
    draft = recordTranscript(draft, "one two ");
    draft = markDraftSaved(draft, saving);
    expect(draft.pending).toBe("two ");
  });

  it("a new recording starts from empty without losing an earlier unsaved one", () => {
    let draft = recordTranscript(EMPTY_NOTE_DRAFT, "first call part ");
    draft = recordTranscript(draft, "second part ");
    expect(draft.pending).toBe("first call part \nsecond part ");
    expect(draft.lastSeen).toBe("second part ");
    // Saving the combined text clears it, even when the recorder moved on meanwhile.
    expect(markDraftSaved(draft, "first call part \nsecond part ").pending).toBe("");
  });

  it("discarded words do not come back with the next transcript update", () => {
    let draft = recordTranscript(EMPTY_NOTE_DRAFT, "wrong lead ");
    draft = discardNoteDraft(draft);
    expect(draft.pending).toBe("");
    draft = recordTranscript(draft, "wrong lead and more ");
    expect(draft.pending).toBe("and more ");
  });

  it("a guarded write that matched no row is a race when the guard moved and a refusal when it did not", () => {
    expect(zeroRowVerdict("2026-10-15T01:00:00Z", "2026-10-15T01:00:05Z")).toBe("conflict");
    expect(zeroRowVerdict("2026-10-15T01:00:00Z", "2026-10-15T01:00:00Z")).toBe("refused");
    expect(zeroRowVerdict(null, null)).toBe("refused");
    expect(zeroRowVerdict(null, "now has notes")).toBe("conflict");
  });

  it("an aged-lead notes lock fits the request URL up to the limit and is refused past it", () => {
    expect(noteLockFits(null)).toBe(true);
    expect(noteLockFits("a".repeat(1518))).toBe(true);
    expect(noteLockFits("a".repeat(NOTE_LOCK_MAX_ENCODED))).toBe(true);
    expect(noteLockFits("a".repeat(NOTE_LOCK_MAX_ENCODED + 1))).toBe(false);
    // Encoding counts: a space becomes three characters.
    expect(noteLockFits(" ".repeat(Math.ceil(NOTE_LOCK_MAX_ENCODED / 3) + 1))).toBe(false);
  });
});
