import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  CONTACT_CHANNELS,
  CONTACT_OUTCOMES,
  EMPTY_DRAFT,
  OUTCOME_DEFINITIONS,
  QUEUE_DEFINITIONS,
  QUEUE_KEYS,
  blockersOf,
  channelAvailability,
  computeQueueCounts,
  describeSaveError,
  inQueue,
  isClosed,
  personFromParams,
  phoenixDayBounds,
  planCheck,
  queueFromLegacyParams,
  sortForQueue,
  validateOutcomeDraft,
  type WorklistRow,
} from "@/lib/recruitingQueues";
import { clearDraft, draftKey, loadDraft, saveDraft } from "@/lib/worklistDraftStore";
import {
  WORKLIST_SELECT,
  fetchAllPages,
  mergeRow,
  type WorklistData,
} from "@/components/pipeline/worklist/useRecruitingWorklist";

// Synthetic fixtures only — no real applicant data.
const NOW = new Date("2026-10-06T19:00:00.000Z"); // 12:00 Phoenix
const ME = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";

function row(patch: Partial<WorklistRow> = {}): WorklistRow {
  return {
    id: patch.id ?? "app-" + Math.random().toString(36).slice(2),
    first_name: "Test",
    last_name: "Person",
    email: "test.person@example.test",
    phone: "+15555550100",
    state: "AZ",
    time_zone: null,
    time_zone_source: null,
    license_status: "unlicensed",
    license_progress: "unlicensed",
    status: "new",
    next_step_stage_key: "applied",
    created_at: "2026-09-01T12:00:00.000Z",
    assigned_agent_id: "agent-attribution",
    recruiting_owner_user_id: null,
    last_contacted_at: null,
    last_contact_outcome: null,
    last_contact_outcome_at: null,
    last_contact_channel: null,
    next_action: null,
    next_action_due_at: null,
    next_action_set_at: null,
    waiting_reason: null,
    next_review_at: null,
    next_step_due_at: null,
    phone_bad_at: null,
    email_bad_at: null,
    sms_consent_given: true,
    email_consent_given: true,
    do_not_contact_at: null,
    ...patch,
  };
}

const ctx = { now: NOW, userId: ME };

const MIGRATION = readFileSync(
  resolve(__dirname, "../../../supabase/migrations/20261006120000_recruiting_contact_outcomes.sql"),
  "utf8",
);

/** The literal list inside the CHECK that DEFINES `constraintName` (skips e.g. a preceding DROP). */
function checkList(constraintName: string): string[] {
  for (let at = MIGRATION.indexOf(constraintName); at !== -1; at = MIGRATION.indexOf(constraintName, at + 1)) {
    const body = MIGRATION.slice(at, MIGRATION.indexOf(";", at));
    if (!/\bcheck\s*\(/i.test(body)) continue;
    const inner = body.slice(body.lastIndexOf(" in (") + 5, body.lastIndexOf(")"));
    return [...inner.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  }
  throw new Error(`${constraintName} CHECK not found in migration`);
}

describe("outcome vocabulary is single-sourced with the database CHECK", () => {
  it("UI outcomes equal the application_contact_log CHECK list", () => {
    expect(checkList("application_contact_log_contact_outcome_check")).toEqual([...CONTACT_OUTCOMES]);
  });
  it("UI outcomes equal the applications.last_contact_outcome CHECK list", () => {
    expect(checkList("applications_last_contact_outcome_check")).toEqual([...CONTACT_OUTCOMES]);
  });
  it("every outcome has exactly one definition and the brief's seven are present", () => {
    expect(OUTCOME_DEFINITIONS.map((d) => d.value)).toEqual([...CONTACT_OUTCOMES]);
    expect(CONTACT_OUTCOMES).toEqual([
      "no_answer", "callback", "interested", "appointment_booked", "not_interested", "wrong_number", "do_not_contact",
    ]);
  });
  it("UI channels are all admitted by the widened channel CHECK, and legacy values survive", () => {
    const admitted = checkList("application_contact_log_channel_check");
    for (const ch of CONTACT_CHANNELS) expect(admitted).toContain(ch);
    for (const legacy of ["call", "sms", "email", "note"]) expect(admitted).toContain(legacy);
  });
  it("the RPC's own vocabulary matches too", () => {
    const fn = MIGRATION.slice(MIGRATION.indexOf("function public.record_recruiting_outcome("));
    for (const o of CONTACT_OUTCOMES) expect(fn).toContain(`'${o}'`);
  });
  it("the worklist select reads every column the migration adds to the row contract", () => {
    for (const col of ["recruiting_owner_user_id", "last_contact_outcome_at", "waiting_reason", "next_review_at", "do_not_contact_at", "time_zone"]) {
      expect(WORKLIST_SELECT.split(",")).toContain(col);
      expect(MIGRATION).toContain(`'${col}', a.${col}`);
    }
  });
  it("a dial-link click cannot be dressed as a provider event: the RPC takes no provider ref", () => {
    const sig = MIGRATION.slice(MIGRATION.indexOf("function public.record_recruiting_outcome("), MIGRATION.indexOf("returns jsonb", MIGRATION.indexOf("function public.record_recruiting_outcome(")));
    expect(sig).not.toContain("provider");
    expect(MIGRATION).toContain("is_manual boolean generated always as (provider_event_ref is null) stored");
  });
});

describe("queue predicates", () => {
  it("ignores the bulk-stamped contacted_at: a row with only contacted_at is uncontacted", () => {
    const r = row({ /* contacted_at deliberately not part of the row contract */ });
    expect(inQueue(r, "uncontacted", ctx)).toBe(true);
    expect(inQueue(row({ last_contacted_at: "2026-09-02T00:00:00Z" }), "uncontacted", ctx)).toBe(false);
    expect(inQueue(row({ last_contact_outcome_at: "2026-10-01T00:00:00Z", last_contact_outcome: "no_answer" }), "uncontacted", ctx)).toBe(false);
  });

  it("New = applied within 7 days and not yet worked", () => {
    expect(inQueue(row({ created_at: "2026-10-03T00:00:00Z" }), "new", ctx)).toBe(true);
    expect(inQueue(row({ created_at: "2026-09-20T00:00:00Z" }), "new", ctx)).toBe(false);
    expect(inQueue(row({ created_at: "2026-10-03T00:00:00Z", last_contact_outcome_at: "2026-10-04T00:00:00Z", last_contact_outcome: "callback" }), "new", ctx)).toBe(false);
  });

  it("Due today uses the Phoenix business day; Overdue is anything past", () => {
    const later = row({ next_action: "Call", next_action_due_at: "2026-10-06T23:00:00Z" }); // 16:00 Phoenix
    const tomorrow = row({ next_action: "Call", next_action_due_at: "2026-10-07T08:00:00Z" }); // 01:00 Phoenix next day
    const past = row({ next_action: "Call", next_action_due_at: "2026-10-06T15:00:00Z" });
    expect(inQueue(later, "due_today", ctx)).toBe(true);
    expect(inQueue(tomorrow, "due_today", ctx)).toBe(false);
    expect(inQueue(past, "overdue", ctx)).toBe(true);
    expect(inQueue(past, "due_today", ctx)).toBe(false);
    const { start, end } = phoenixDayBounds(NOW);
    expect(new Date(start).toISOString()).toBe("2026-10-06T07:00:00.000Z");
    expect(end - start).toBe(24 * 3600 * 1000);
  });

  it("a waiting item uses its review date for due/overdue and sits in Awaiting reply", () => {
    const w = row({ waiting_reason: "Reply to text", next_review_at: "2026-10-05T00:00:00Z" });
    expect(inQueue(w, "awaiting_reply", ctx)).toBe(true);
    expect(inQueue(w, "overdue", ctx)).toBe(true);
    expect(inQueue(row({ waiting_reason: "x", next_review_at: "2026-10-09T00:00:00Z", next_action: "Call", next_action_due_at: "2026-10-08T00:00:00Z" }), "awaiting_reply", ctx)).toBe(false);
  });

  it("Unassigned and My queue read the explicit owner, never attribution", () => {
    const attributedOnly = row({ assigned_agent_id: "agent-of-sam", recruiting_owner_user_id: null });
    expect(inQueue(attributedOnly, "unassigned", ctx)).toBe(true);
    expect(inQueue(attributedOnly, "mine", ctx)).toBe(false);
    expect(inQueue(row({ recruiting_owner_user_id: ME }), "mine", ctx)).toBe(true);
    expect(inQueue(row({ recruiting_owner_user_id: OTHER }), "mine", ctx)).toBe(false);
    expect(inQueue(row({ recruiting_owner_user_id: ME }), "mine", { now: NOW, userId: null })).toBe(false);
  });

  it("closed people leave every queue", () => {
    for (const closed of [
      row({ do_not_contact_at: "2026-10-01T00:00:00Z" }),
      row({ last_contact_outcome: "not_interested", last_contact_outcome_at: "2026-10-01T00:00:00Z" }),
      row({ status: "rejected" }),
      row({ next_step_stage_key: "closed_lost" }),
    ]) {
      expect(isClosed(closed)).toBe(true);
      for (const q of QUEUE_KEYS) expect(inQueue(closed, q, ctx)).toBe(false);
    }
  });

  it("Needs a plan: owner AND (action+due OR waiting+review); unreadable dates are flagged, not hidden", () => {
    expect(planCheck(row()).missing).toEqual(["owner", "plan"]);
    expect(planCheck(row({ recruiting_owner_user_id: ME, next_action: "Call", next_action_due_at: "2026-10-07T00:00:00Z" })).ok).toBe(true);
    expect(planCheck(row({ recruiting_owner_user_id: ME, waiting_reason: "Spouse", next_review_at: "2026-10-07T00:00:00Z" })).ok).toBe(true);
    expect(planCheck(row({ recruiting_owner_user_id: ME, next_action: "Call" })).missing).toEqual(["plan"]);
    const garbled = row({ recruiting_owner_user_id: ME, next_action: "Call", next_action_due_at: "not-a-date" });
    expect(planCheck(garbled).missing).toContain("unreadable_date");
    expect(inQueue(garbled, "overdue", ctx)).toBe(false);
    expect(inQueue(garbled, "needs_plan", ctx)).toBe(true);
  });

  it("counts are computed over the whole set and agree with the click-filter", () => {
    const rows = [
      row({ id: "a", created_at: "2026-10-05T00:00:00Z" }),
      row({ id: "b", recruiting_owner_user_id: ME, next_action: "Call", next_action_due_at: "2026-10-06T10:00:00Z", last_contacted_at: "2026-10-01T00:00:00Z" }),
      row({ id: "c", recruiting_owner_user_id: OTHER, waiting_reason: "Reply", next_review_at: "2026-10-10T00:00:00Z", last_contact_outcome: "no_answer", last_contact_outcome_at: "2026-10-02T00:00:00Z" }),
      row({ id: "d", do_not_contact_at: "2026-10-01T00:00:00Z" }),
    ];
    const counts = computeQueueCounts(rows, ctx);
    for (const q of QUEUE_KEYS) expect(counts[q]).toBe(rows.filter((r) => inQueue(r, q, ctx)).length);
    expect(counts).toMatchObject({ all_open: 3, new: 1, uncontacted: 1, overdue: 1, awaiting_reply: 1, unassigned: 1, mine: 1, needs_plan: 1 });
  });

  it("every queue key has a definition, and only My queue is personal", () => {
    expect(QUEUE_DEFINITIONS.map((d) => d.key)).toEqual([...QUEUE_KEYS]);
    expect(QUEUE_DEFINITIONS.filter((d) => d.scope === "personal").map((d) => d.key)).toEqual(["mine"]);
  });

  it("sorts most urgent first and puts unknown dates last", () => {
    const sorted = sortForQueue([
      row({ id: "none" }),
      row({ id: "later", next_action_due_at: "2026-10-09T00:00:00Z" }),
      row({ id: "soon", next_action_due_at: "2026-10-06T00:00:00Z" }),
      row({ id: "bad", next_action_due_at: "garbage" }),
    ]);
    expect(sorted.map((r) => r.id).slice(0, 2)).toEqual(["soon", "later"]);
  });
});

describe("suppression and save validation", () => {
  it("channel availability mirrors the RPC's suppression rules", () => {
    const smsOff = channelAvailability(row({ sms_consent_given: false }));
    expect(smsOff.sms.allowed).toBe(false);
    expect(smsOff.call.allowed).toBe(true);
    const badPhone = channelAvailability(row({ phone_bad_at: "2026-09-01T00:00:00Z" }));
    expect(badPhone.call.allowed).toBe(false);
    expect(badPhone.sms.allowed).toBe(false);
    const dnc = channelAvailability(row({ do_not_contact_at: "2026-09-01T00:00:00Z" }));
    expect(Object.values(dnc).every((c) => !c.allowed)).toBe(true);
    expect(channelAvailability(row({ email_consent_given: false })).email.allowed).toBe(false);
    expect(blockersOf(row({ do_not_contact_at: "x" }))[0]).toMatchObject({ key: "do_not_contact", hard: true });
  });

  it("refuses an open outcome with no plan, and a callback without a dated action", () => {
    const r = row();
    expect(validateOutcomeDraft({ ...EMPTY_DRAFT }, r)).toMatch(/what happened/i);
    expect(validateOutcomeDraft({ ...EMPTY_DRAFT, outcome: "no_answer" }, r)).toMatch(/next action/i);
    expect(validateOutcomeDraft({ ...EMPTY_DRAFT, outcome: "callback", waitingReason: "x", nextReview: "2026-10-07T10:00" }, r)).toMatch(/date and time/i);
    expect(validateOutcomeDraft({ ...EMPTY_DRAFT, outcome: "no_answer", waitingReason: "Reply", nextReview: "2026-10-07T10:00" }, r)).toBeNull();
    expect(validateOutcomeDraft({ ...EMPTY_DRAFT, outcome: "not_interested" }, r)).toBeNull();
  });

  it("refuses a blocked channel but always allows recording do-not-contact", () => {
    const r = row({ sms_consent_given: false });
    expect(validateOutcomeDraft({ ...EMPTY_DRAFT, outcome: "interested", channel: "sms", nextAction: "x", nextActionDue: "2026-10-07T10:00" }, r)).toMatch(/blocked/i);
    expect(validateOutcomeDraft({ ...EMPTY_DRAFT, outcome: "do_not_contact", channel: "sms" }, r)).toBeNull();
  });

  it("maps server refusals to honest sentences and never swallows unknown errors", () => {
    expect(describeSaveError("conflict: another outcome (no_answer) was recorded").kind).toBe("conflict");
    expect(describeSaveError("suppressed: no SMS consent on file").text).toBe("Blocked: no SMS consent on file");
    expect(describeSaveError("not_authorized: you cannot work this recruit").kind).toBe("forbidden");
    expect(describeSaveError("invalid_plan: set a next action").text).toBe("set a next action");
    expect(describeSaveError("Could not find the function public.record_recruiting_outcome").kind).toBe("missing_backend");
    expect(describeSaveError("socket hang up")).toEqual({ kind: "unknown", text: "socket hang up" });
  });
});

describe("full-dataset loading", () => {
  it("pages past the 1000-row cap until a short page", async () => {
    const total = 2_350;
    const calls: Array<[number, number]> = [];
    const { rows, error } = await fetchAllPages<number>(async (from, to) => {
      calls.push([from, to]);
      const page = Array.from({ length: Math.max(0, Math.min(to, total - 1) - from + 1) }, (_, i) => from + i);
      return { data: page, error: null };
    });
    expect(error).toBeNull();
    expect(rows).toHaveLength(total);
    expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("an exact multiple of the page size still terminates on the empty page", async () => {
    const { rows } = await fetchAllPages<number>(async (from) => ({ data: from < 2000 ? Array(1000).fill(1) : [], error: null }));
    expect(rows).toHaveLength(2000);
  });

  it("surfaces an error instead of returning a silently partial list as complete", async () => {
    const res = await fetchAllPages<number>(async (from) =>
      from === 0 ? { data: Array(1000).fill(1), error: null } : { data: null, error: { message: "timeout" } });
    expect(res.error?.message).toBe("timeout");
  });

  it("mergeRow replaces the saved row so queue and panel update together", () => {
    const data: WorklistData = {
      rows: [row({ id: "x" }), row({ id: "y" })],
      backendReady: true,
      coverage: { live: 2, duplicates: 0, nonApplication: 0 },
      loadedAt: NOW.toISOString(),
    };
    const updated = mergeRow(data, row({ id: "y", last_contact_outcome: "callback", recruiting_owner_user_id: ME }));
    expect(updated?.rows[1]).toMatchObject({ id: "y", last_contact_outcome: "callback", recruiting_owner_user_id: ME });
    expect(updated?.rows).toHaveLength(2);
  });
});

describe("unfinished notes survive", () => {
  function memoryStorage() {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
      size: () => m.size,
    };
  }

  it("round-trips a draft per viewer and record, and clears only on demand", () => {
    const s = memoryStorage();
    const draft = { ...EMPTY_DRAFT, outcome: "callback" as const, notes: "Said call after 5", nextAction: "Call back", nextActionDue: "2026-10-07T17:00" };
    expect(saveDraft(ME, "app-1", draft, s)).toBe(true);
    expect(loadDraft(ME, "app-1", s)).toEqual(draft);
    expect(loadDraft(OTHER, "app-1", s)).toBeNull();
    expect(draftKey(ME, "app-1")).not.toBe(draftKey(OTHER, "app-1"));
    clearDraft(ME, "app-1", s);
    expect(loadDraft(ME, "app-1", s)).toBeNull();
  });

  it("drops garbage values instead of crashing, and an empty draft is not stored", () => {
    const s = memoryStorage();
    s.setItem(draftKey(ME, "app-2"), JSON.stringify({ outcome: "teleported", channel: "pigeon", notes: 5 }));
    expect(loadDraft(ME, "app-2", s)).toEqual({ ...EMPTY_DRAFT });
    saveDraft(ME, "app-3", { ...EMPTY_DRAFT }, s);
    expect(s.getItem(draftKey(ME, "app-3"))).toBeNull();
  });

  it("a throwing storage degrades to no persistence, never an exception", () => {
    const broken = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("quota"); },
      removeItem: () => { throw new Error("blocked"); },
    };
    expect(loadDraft(ME, "a", broken)).toBeNull();
    expect(saveDraft(ME, "a", { ...EMPTY_DRAFT, notes: "x" }, broken)).toBe(false);
    expect(() => clearDraft(ME, "a", broken)).not.toThrow();
  });
});

describe("deep links into the worklist", () => {
  it("opens the person from ?person=, or from the ?id= / ?lead= / ?focus= other pages send", () => {
    expect(personFromParams(new URLSearchParams("person=a1&id=b2"))).toBe("a1");
    expect(personFromParams(new URLSearchParams("id=b2"))).toBe("b2");
    expect(personFromParams(new URLSearchParams("lead=c3"))).toBe("c3");
    expect(personFromParams(new URLSearchParams("focus=d4"))).toBe("d4");
    expect(personFromParams(new URLSearchParams("queue=overdue"))).toBeNull();
  });

  it("maps the classic table's filter params onto the matching saved queue", () => {
    expect(queueFromLegacyParams(new URLSearchParams("filter=follow_up_due"))).toBe("overdue");
    expect(queueFromLegacyParams(new URLSearchParams("filter=unclaimed"))).toBe("unassigned");
    expect(queueFromLegacyParams(new URLSearchParams("bucket=new&assignment=unclaimed"))).toBe("unassigned");
    expect(queueFromLegacyParams(new URLSearchParams("contacted=untouched"))).toBe("uncontacted");
    expect(queueFromLegacyParams(new URLSearchParams("bucket=new"))).toBe("new");
    expect(queueFromLegacyParams(new URLSearchParams("status=course_bought"))).toBeNull();
  });

  it("a person closed on Recruit Stages (status lapsed) is closed in the worklist too", () => {
    const lapsed = row({ status: "lapsed", next_step_stage_key: "contacted" });
    expect(isClosed(lapsed)).toBe(true);
    expect(inQueue(lapsed, "all_open", { now: NOW, userId: ME })).toBe(false);
  });
});
