/**
 * My Pipeline's rules (src/lib/clientPipelineView.ts), OVERHAUL-agentpipeline 2026-10-31.
 *
 * Pinned here: the four steps and their colours, the one bucket every client is in (so the numbers
 * add up), every count equal to the list it opens, the order people are worked in, the one next step
 * per row in plain words, and the search.
 */
import { describe, expect, it } from "vitest";

import {
  PIPELINE_LIST_KEYS,
  QUEUE_ORDER,
  clientName,
  clientNextStep,
  clientQueue,
  clientStage,
  dayLabel,
  daysBetween,
  formatCallbackTime,
  inPipelineList,
  matchesClientSearch,
  mergeClientOverrides,
  parsePipelineList,
  pipelineBackTo,
  pipelineListCounts,
  pipelineListRows,
  type PipelineClient,
  type PipelineOverride,
} from "@/lib/clientPipelineView";
import { clientStepTone, flipStatusTone } from "@/lib/tones";

// Noon on Friday 2026-10-31, the viewer's own clock: "today" is the viewer's calendar day.
const now = new Date(2026, 9, 31, 12, 0, 0);

let seq = 0;
function client(patch: Partial<PipelineClient> = {}): PipelineClient {
  seq += 1;
  return {
    id: `c${String(seq).padStart(3, "0")}`,
    agent_id: "agent-1",
    first_name: "Pat",
    last_name: `Client ${seq}`,
    phone: "6025550100",
    email: null,
    state: "AZ",
    city: null,
    pipeline_stage: "NEW_INITIAL",
    created_at: "2026-10-20T15:00:00Z",
    updated_at: null,
    stage_changed_at: null,
    last_contact_date: null,
    next_action_date: null,
    callback_date: null,
    callback_time: null,
    do_not_call: false,
    do_not_email: false,
    do_not_text: false,
    policy_number: null,
    ...patch,
  };
}

/** One of every kind of client the page meets. */
function book(): PipelineClient[] {
  return [
    client({ first_name: "Late", last_name: "Callback", pipeline_stage: "FOLLOW_UP", callback_date: "2026-10-28", last_contact_date: "2026-10-25T16:00:00Z" }),
    client({ first_name: "Later", last_name: "Late", pipeline_stage: "FOLLOW_UP", callback_date: "2026-10-30" }),
    client({ first_name: "Today", last_name: "Three", pipeline_stage: "FOLLOW_UP", callback_date: "2026-10-31", callback_time: "15:00" }),
    client({ first_name: "Today", last_name: "Nine", pipeline_stage: "FOLLOW_UP", callback_date: "2026-10-31", callback_time: "09:00" }),
    client({ first_name: "New", last_name: "Recent", created_at: "2026-10-30T15:00:00Z" }),
    client({ first_name: "New", last_name: "Imported", pipeline_stage: null, created_at: "2026-05-16T14:00:00Z" }),
    client({ first_name: "Talked", last_name: "Long ago", pipeline_stage: "PITCHED", last_contact_date: "2026-10-03T16:00:00Z" }),
    client({ first_name: "Talked", last_name: "Lately", pipeline_stage: "FOLLOW_UP", last_contact_date: "2026-10-29T16:00:00Z" }),
    client({ first_name: "Almost", last_name: "There", pipeline_stage: "ALMOST_THERE", last_contact_date: "2026-10-30T16:00:00Z", next_action_date: "2026-11-02T00:00:00+00:00" }),
    client({ first_name: "Scheduled", last_name: "Soon", pipeline_stage: "FOLLOW_UP", callback_date: "2026-11-03", callback_time: "10:30" }),
    client({ first_name: "Scheduled", last_name: "Later", pipeline_stage: "FOLLOW_UP", callback_date: "2026-11-20" }),
    client({ first_name: "Do", last_name: "Not Call", do_not_call: true, email: "dnc@example.com" }),
    client({ first_name: "Sold", last_name: "Here", pipeline_stage: "SOLD", stage_changed_at: "2026-10-20T18:00:00Z", stage_marked_here: true }),
    client({ first_name: "Sold", last_name: "Imported", pipeline_stage: "SOLD", created_at: "2026-06-01T00:00:00Z" }),
    client({ first_name: "Sold", last_name: "Nope", pipeline_stage: "SOLD", do_not_call: true }),
    client({ first_name: "Lost", last_name: "One", pipeline_stage: "LOST" }),
    client({ first_name: "Inactive", last_name: "One", pipeline_stage: "INACTIVE" }),
    client({ first_name: "No", last_name: "Phone", phone: null, email: "nophone@example.com" }),
  ];
}

const names = (rows: PipelineClient[]) => rows.map(clientName);

describe("the four steps", () => {
  it("files every stored stage under New, Callback, Almost there or Sold, the call sheet's own four", () => {
    expect(clientStage(null)).toMatchObject({ key: "new", label: "New", index: 1 });
    expect(clientStage("NEW_INITIAL")).toMatchObject({ key: "new", index: 1 });
    expect(clientStage("UNSORTED")).toMatchObject({ key: "new", index: 1 });
    expect(clientStage("WORKING")).toMatchObject({ key: "callback", label: "Callback", index: 2, detail: null });
    expect(clientStage("FOLLOW_UP")).toMatchObject({ key: "callback", index: 2 });
    expect(clientStage("PITCHED")).toMatchObject({ key: "callback", index: 2, detail: "Quote given" });
    expect(clientStage("ALMOST_THERE")).toMatchObject({ key: "almost", label: "Almost there", index: 3 });
    expect(clientStage("SOLD")).toMatchObject({ key: "sold", label: "Sold", index: 4 });
  });

  it("says closed and unknown stages in words with an empty bar", () => {
    expect(clientStage("LOST")).toMatchObject({ key: "closed", label: "Not interested", index: null, tone: "slate" });
    expect(clientStage("INACTIVE")).toMatchObject({ key: "closed", label: "Inactive", index: null });
    expect(clientStage("NEEDS_REVIEW")).toMatchObject({ key: "other", label: "Needs Review", index: null, tone: "slate" });
  });

  it("gives the four steps four different tones, the same ones the tone map names", () => {
    const tones = ["NEW_INITIAL", "FOLLOW_UP", "ALMOST_THERE", "SOLD"].map((s) => clientStage(s).tone);
    expect(tones).toEqual(["cool", "warm", "royal", "good"]);
    expect(new Set(tones).size).toBe(4);
    expect(clientStepTone("almost")).toBe(flipStatusTone("appointment"));
  });
});

describe("one bucket per client", () => {
  it("puts every client in exactly one bucket, so the buckets add up to the book", () => {
    const rows = book();
    const byQueue = new Map<string, number>();
    for (const row of rows) byQueue.set(clientQueue(row, now), (byQueue.get(clientQueue(row, now)) ?? 0) + 1);
    expect([...byQueue.keys()].every((q) => (QUEUE_ORDER as readonly string[]).includes(q))).toBe(true);
    expect([...byQueue.values()].reduce((a, b) => a + b, 0)).toBe(rows.length);
  });

  it("files late, today, never called, no next step and later promises by the old work queue's rules", () => {
    const [late, , today] = book();
    expect(clientQueue(late, now)).toBe("late");
    expect(clientQueue(today, now)).toBe("today");
    expect(clientQueue(client(), now)).toBe("new");
    expect(clientQueue(client({ last_contact_date: "2026-10-03T16:00:00Z" }), now)).toBe("follow_up");
    expect(clientQueue(client({ callback_date: "2026-11-03" }), now)).toBe("scheduled");
  });

  it("keeps a sold client sold even when marked do not call, and keeps do-not-call clients off every list of people to call", () => {
    expect(clientQueue(client({ pipeline_stage: "SOLD", do_not_call: true }), now)).toBe("sold");
    const dnc = client({ do_not_call: true, callback_date: "2026-10-20" });
    expect(clientQueue(dnc, now)).toBe("do_not_call");
    for (const list of ["todo", "today", "new", "follow_up", "almost", "scheduled"] as const) {
      expect(inPipelineList(dnc, list, clientQueue(dnc, now))).toBe(false);
    }
    expect(inPipelineList(dnc, "all", "do_not_call")).toBe(true);
  });

  it("never treats a date nobody can read as a callback that is on time", () => {
    expect(clientQueue(client({ callback_date: "unreadable" }), now)).toBe("new");
    expect(clientQueue(client({ callback_date: "soon", last_contact_date: "2026-10-03T16:00:00Z" }), now)).toBe("follow_up");
  });

  it("closes not interested and inactive clients", () => {
    expect(clientQueue(client({ pipeline_stage: "LOST" }), now)).toBe("closed");
    expect(clientQueue(client({ pipeline_stage: "INACTIVE" }), now)).toBe("closed");
  });
});

describe("numbers equal the lists they open", () => {
  it("counts each list with the same rule that builds it", () => {
    const rows = book();
    const counts = pipelineListCounts(rows, now);
    for (const list of PIPELINE_LIST_KEYS) expect(counts[list]).toBe(pipelineListRows(rows, list, now).length);
  });

  it("makes To do exactly Call today plus Never called plus No next step, and Everyone the whole book", () => {
    const rows = book();
    const counts = pipelineListCounts(rows, now);
    expect(counts.todo).toBe(counts.today + counts.new + counts.follow_up);
    expect(counts.all).toBe(rows.length);
    expect(counts).toMatchObject({ today: 4, new: 3, follow_up: 2, almost: 1, scheduled: 3, sold: 3 });
  });

  it("counts nothing for an empty book", () => {
    const counts = pipelineListCounts([], now);
    expect(Object.values(counts).every((n) => n === 0)).toBe(true);
  });
});

describe("the order to work them", () => {
  it("works late promises oldest first, then today's by time, then the newest never-called, then the longest wait", () => {
    expect(names(pipelineListRows(book(), "todo", now))).toEqual([
      "Late Callback", "Later Late", "Today Nine", "Today Three", "New Recent", "No Phone", "New Imported", "Talked Long ago", "Talked Lately",
    ]);
  });

  it("lists scheduled callbacks soonest first", () => {
    expect(names(pipelineListRows(book(), "scheduled", now))).toEqual(["Almost There", "Scheduled Soon", "Scheduled Later"]);
  });

  it("lists sales marked here newest first, then imported sales newest first", () => {
    const rows = [
      ...book(),
      client({ first_name: "Sold", last_name: "Marked earlier", pipeline_stage: "SOLD", stage_changed_at: "2026-10-01T18:00:00Z", stage_marked_here: true }),
    ];
    expect(names(pipelineListRows(rows, "sold", now))).toEqual(["Sold Here", "Sold Marked earlier", "Sold Nope", "Sold Imported"]);
  });

  it("puts people to call first in Everyone, then scheduled, then do not call, sold and closed", () => {
    const order = pipelineListRows(book(), "all", now).map((row) => clientQueue(row, now));
    const ranks = order.map((q) => QUEUE_ORDER.indexOf(q));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(order[0]).toBe("late");
    expect(order[order.length - 1]).toBe("closed");
  });

  it("gives the same order however the rows arrive", () => {
    const rows = book();
    const reversed = [...rows].reverse();
    for (const list of PIPELINE_LIST_KEYS) {
      expect(pipelineListRows(reversed, list, now).map((r) => r.id)).toEqual(pipelineListRows(rows, list, now).map((r) => r.id));
    }
  });
});

describe("the one next step", () => {
  it("calls back a late callback, says how late and repeats the note left for it", () => {
    const step = clientNextStep(client({ pipeline_stage: "FOLLOW_UP", callback_date: "2026-10-28", reminder_notes: "Send the  $45 quote" }), now);
    expect(step).toMatchObject({ key: "late", action: "Call back", when: "3 days late", tone: "hot", channel: "call", emphasis: true });
    expect(step.detail).toBe("The callback was due Oct 28. Your note: “Send the $45 quote”");
  });

  it("says one day, and calls a late next action a follow-up", () => {
    const step = clientNextStep(client({ next_action_date: "2026-10-30T00:00:00+00:00" }), now);
    expect(step).toMatchObject({ key: "late", action: "Follow up", when: "1 day late" });
    expect(step.detail).toBe("The follow-up was due Oct 30.");
  });

  it("gives the time of a callback due today", () => {
    expect(clientNextStep(client({ callback_date: "2026-10-31", callback_time: "15:00" }), now)).toMatchObject({
      key: "today", action: "Call back", title: "Call back today", when: "Due today at 3:00 PM", tone: "warm", channel: "call",
    });
    expect(clientNextStep(client({ callback_date: "2026-10-31" }), now).when).toBe("Due today");
  });

  it("asks for the first call on a client nobody has called", () => {
    expect(clientNextStep(client({ created_at: "2026-10-21T15:00:00Z" }), now)).toMatchObject({
      key: "first_call", action: "First call", when: "Added Oct 21", tone: "cool", channel: "call", emphasis: false,
      detail: "Added Oct 21. Nobody has logged a call yet.",
    });
  });

  it("asks for a follow-up when they talked and nothing is planned", () => {
    expect(clientNextStep(client({ last_contact_date: "2026-10-03T16:00:00Z" }), now)).toMatchObject({
      key: "follow_up", action: "Follow up", when: "Talked Oct 3 · no next step", tone: "warm",
      detail: "You last talked Oct 3, and nothing is planned. Call and set the next step.",
    });
  });

  it("has nothing to do yet for a callback set for a later day", () => {
    expect(clientNextStep(client({ callback_date: "2026-11-03", callback_time: "10:30" }), now)).toMatchObject({
      key: "scheduled", action: "Open", title: "Callback set", when: "Callback Nov 3 at 10:30 AM", channel: "open", emphasis: false,
    });
    expect(clientNextStep(client({ next_action_date: "2027-01-05T00:00:00+00:00" }), now).when).toBe("Follow-up Jan 5, 2027");
  });

  it("emails instead of calling when the client is do not call, and only opens the file without an email", () => {
    expect(clientNextStep(client({ do_not_call: true, email: "a@example.com" }), now)).toMatchObject({ key: "do_not_call", action: "Email", channel: "email", when: "Do not call", tone: "hot" });
    expect(clientNextStep(client({ do_not_call: true }), now)).toMatchObject({ key: "do_not_call", action: "Open", channel: "open" });
    expect(clientNextStep(client({ do_not_call: true, email: "a@example.com", do_not_email: true }), now).channel).toBe("open");
  });

  it("asks for a phone number before anything else when there is none to dial", () => {
    expect(clientNextStep(client({ phone: "bad", email: "a@example.com", callback_date: "2026-10-20" }), now)).toMatchObject({ key: "email_for_phone", action: "Email", when: "No phone on file" });
    expect(clientNextStep(client({ phone: null }), now)).toMatchObject({ key: "no_phone", action: "Open", when: "No phone or email" });
  });

  it("says sold, with the day only when it was marked here", () => {
    expect(clientNextStep(client({ pipeline_stage: "SOLD", stage_changed_at: "2026-10-20T18:00:00Z", stage_marked_here: true }), now)).toMatchObject({ key: "sold", when: "Marked sold Oct 20", channel: "open" });
    expect(clientNextStep(client({ pipeline_stage: "SOLD", stage_changed_at: "2026-03-01T00:00:00Z" }), now).when).toBe("Policy sold");
  });

  it("says a closed client is closed, in the stage's own words", () => {
    expect(clientNextStep(client({ pipeline_stage: "LOST" }), now)).toMatchObject({ key: "closed", when: "Not interested", channel: "open" });
  });

  it("cuts a long note so the card stays readable", () => {
    const detail = clientNextStep(client({ reminder_notes: "x".repeat(400) }), now).detail;
    expect(detail.length).toBeLessThan(220);
    expect(detail.endsWith("…”")).toBe(true);
  });
});

describe("saved call results over the imported rows", () => {
  const override = (o: Partial<PipelineOverride>): PipelineOverride => ({
    client_id: "x", stage_override: null, stage_changed_at: null, last_contact_date: null, next_action_date: null,
    callback_date: null, callback_time: null, schedule_overridden: false, reminder_notes: null, ...o,
  });

  it("lets a saved stage and contact win, and marks a stage set here", () => {
    const base = client({ id: "x", pipeline_stage: "NEW_INITIAL" });
    const [merged] = mergeClientOverrides([base], [override({ stage_override: "SOLD", stage_changed_at: "2026-10-20T18:00:00Z", last_contact_date: "2026-10-19T18:00:00Z" })]);
    expect(merged).toMatchObject({ pipeline_stage: "SOLD", stage_changed_at: "2026-10-20T18:00:00Z", last_contact_date: "2026-10-19T18:00:00Z", stage_marked_here: true });
  });

  it("replaces the imported schedule only once the call sheet has written one, so clearing a callback clears it here", () => {
    const base = client({ id: "x", callback_date: "2026-10-01", callback_time: "09:00" });
    expect(mergeClientOverrides([base], [override({ callback_date: "2026-11-05" })])[0].callback_date).toBe("2026-10-01");
    const [cleared] = mergeClientOverrides([base], [override({ schedule_overridden: true })]);
    expect(cleared.callback_date).toBeNull();
    expect(cleared.callback_time).toBeNull();
  });

  it("carries the exact next step typed on the call sheet and leaves untouched rows alone", () => {
    const a = client({ id: "x" });
    const b = client({ id: "y" });
    const merged = mergeClientOverrides([a, b], [override({ reminder_notes: "Call his wife" })]);
    expect(merged[0].reminder_notes).toBe("Call his wife");
    expect(merged[1]).toBe(b);
  });
});

describe("words", () => {
  it("reads a time input as a clock time and keeps anything else as typed", () => {
    expect(formatCallbackTime("15:00")).toBe("3:00 PM");
    expect(formatCallbackTime("00:05")).toBe("12:05 AM");
    expect(formatCallbackTime("12:30:00")).toBe("12:30 PM");
    expect(formatCallbackTime("after lunch")).toBe("after lunch");
    expect(formatCallbackTime("25:00")).toBe("25:00");
    expect(formatCallbackTime("  ")).toBeNull();
  });

  it("gives the year only when it is not this year, and never counts days below zero", () => {
    expect(dayLabel("2026-10-28", now)).toBe("Oct 28");
    expect(dayLabel("2025-12-30", now)).toBe("Dec 30, 2025");
    expect(daysBetween("2026-10-28", "2026-10-31")).toBe(3);
    expect(daysBetween("2026-11-02", "2026-10-31")).toBe(0);
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2); // across the spring clock change
  });

  it("names a client honestly when no name is on file", () => {
    expect(clientName({ first_name: "  ", last_name: null })).toBe("No name on file");
    expect(clientName({ first_name: "Jo", last_name: null })).toBe("Jo");
  });

  it("opens To do for a missing or unknown list in the address bar", () => {
    expect(parsePipelineList(null)).toBe("todo");
    expect(parsePipelineList("sideways")).toBe("todo");
    expect(parsePipelineList("sold")).toBe("sold");
  });
});

describe("search", () => {
  const row = client({ first_name: "José", last_name: "Muñoz", phone: "+1 (602) 555-0187", email: "jose@example.com", state: "TX", policy_number: "PL-77" });

  it("finds a name without minding accents or case", () => {
    expect(matchesClientSearch(row, "jose munoz", null)).toBe(true);
    expect(matchesClientSearch(row, "MUÑ", null)).toBe(true);
    expect(matchesClientSearch(row, "maria", null)).toBe(false);
  });

  it("finds a phone number however it is typed, from three digits", () => {
    expect(matchesClientSearch(row, "602-555-0187", null)).toBe(true);
    expect(matchesClientSearch(row, "5550187", null)).toBe(true);
    expect(matchesClientSearch(row, "18", null)).toBe(false);
  });

  it("finds email, state, policy number and, when shown, the agent", () => {
    expect(matchesClientSearch(row, "jose@", null)).toBe(true);
    expect(matchesClientSearch(row, "pl-77", null)).toBe(true);
    expect(matchesClientSearch(row, "kaeden", "Kaeden Vaughns")).toBe(true);
    expect(matchesClientSearch(row, "kaeden", null)).toBe(false);
    expect(matchesClientSearch(row, "   ", null)).toBe(true);
  });
});

describe("back from the call sheet", () => {
  it("returns to the exact list and search the client was opened from", () => {
    expect(pipelineBackTo({ from: "/dashboard/agent-pipeline?list=today&q=ann" })).toBe("/dashboard/agent-pipeline?list=today&q=ann");
    expect(pipelineBackTo({ from: "/dashboard/clients" })).toBe("/dashboard/clients");
  });

  it("goes to My Pipeline for anything that is not a pipeline list", () => {
    for (const state of [null, undefined, "x", { from: 42 }, { from: "https://example.com/" }, { from: "/dashboard/clients/abc" }, { from: "//evil.example" }]) {
      expect(pipelineBackTo(state)).toBe("/dashboard/agent-pipeline");
    }
  });
});
