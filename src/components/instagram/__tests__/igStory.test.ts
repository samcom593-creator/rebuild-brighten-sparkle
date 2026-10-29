/**
 * The story on every IG desk card (OVERHAUL-instagram): who they are, what they last said, what we
 * last did, what to do next. Pins the truth rules: 'delivered' only on a Meta mid, a refusal says
 * why, unknown is never "nobody answered", and a desk action newer than our last send wins.
 */
import { describe, expect, it } from "vitest";
import { agoWords, sentenceCase, trendOf } from "../igFormat";
import { didFor, factsFor, nextFor, originFor, oursFirst, pillFor, rowStory, saidFor } from "../igStory";
import type { IgRow } from "../igTypes";

const NOW = Date.parse("2026-10-29T05:00:00Z");
const H = 3_600_000;
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

function row(over: Partial<IgRow> = {}): IgRow {
  return {
    external_id: "3995481120760704", handle: "@elevated", name: "ELEVATED Clothing", status: "call", rank: 1,
    last_body: "we still on for the call?", last_direction: "inbound", last_at: iso(50 * H), last_inbound_at: iso(50 * H),
    age_min: 3000, window_closes_at: iso(26 * H), phone: "4803277544", email: null, intent: "licensed", licensed: true,
    human_lane: false, booked_event: null, has_booking: false, applied: false,
    ...over,
  };
}

describe("rowStory: the four answers on one card", () => {
  it("a full call row: who, what they said, what the bot did, and the next step with the number", () => {
    const s = rowStory(row({
      told_locked_in: true,
      last_in_body: "we still on for the call?",
      last_out: { body: "locked in, talk soon", at: iso(49 * H), by: "bot", state: "handed", kind: null },
      first_in_at: iso(12 * 24 * H), in_count: 3,
      came_from: { channel: "comment", media_id: "m1", reel_title: "Comment apex to learn", reel_url: "https://www.instagram.com/reel/x/" },
    }), false, NOW);
    expect(s.name).toBe("@elevated");
    expect(s.alias).toBe("ELEVATED Clothing");
    expect(s.initial).toBe("E");
    expect(s.pill).toMatchObject({ key: "call", text: "Call them", tone: "hot" });
    expect(s.facts.map((f) => f.text)).toEqual(["Licensed", "Gave a number", "Told “locked in”, nothing booked"]);
    expect(s.origin).toBe("Commented on “Comment apex to learn” · first wrote 12d ago · 3 messages");
    expect(s.said).toMatchObject({ text: "we still on for the call?", ago: "2d ago" });
    expect(s.did).toMatchObject({ label: "Bot said", text: "locked in, talk soon", note: "no receipt", ago: "2d ago" });
    expect(s.next.text).toBe("Call (480) 327-7544. They were told “locked in” and nothing is booked.");
    expect(s.next.tone).toBe("hot");
  });

  it("their words come from last_in_body even when we spoke after them", () => {
    const r = row({ last_direction: "outbound", last_body: "our words", last_in_body: "their words" });
    expect(saidFor(r, NOW)?.text).toBe("their words");
  });

  it("without last_in_body, last_body counts as theirs only when the server says it is", () => {
    expect(saidFor(row({ last_in_body: undefined, last_direction: "inbound", last_body: "hi" }), NOW)?.text).toBe("hi");
    expect(saidFor(row({ last_in_body: undefined, last_direction: "outbound", last_body: "ours" }), NOW)).toBeNull();
  });
});

describe("didFor: our last move, with its delivery truth", () => {
  it("'delivered' only when Meta returned a mid", () => {
    const delivered = didFor(row({ last_out: { body: "yo", at: iso(H), by: "you", state: "delivered", kind: null } }), true, NOW);
    expect(delivered).toMatchObject({ label: "You said", note: "delivered", tone: "good" });
    const handed = didFor(row({ last_out: { body: "yo", at: iso(H), by: "bot", state: "handed", kind: null } }), true, NOW);
    expect(handed?.note).toBe("no receipt");
    expect(handed?.note).not.toContain("delivered");
    const noReceipt = didFor(row({ last_out: { body: "yo", at: iso(H), by: "you", state: "no_receipt", kind: null } }), true, NOW);
    expect(noReceipt?.note).toBe("no receipt");
  });

  it("a refused send says it was not delivered, and why", () => {
    const refused = didFor(row({ last_out: { body: "do you have your license?", at: iso(H), by: "bot", state: "refused", kind: "window_closed" } }), true, NOW);
    expect(refused).toMatchObject({ label: "Bot tried", note: "not delivered: window closed", tone: "hot" });
    const unknownWhy = didFor(row({ last_out: { body: "x", at: iso(H), by: "you", state: "refused", kind: null } }), true, NOW);
    expect(unknownWhy).toMatchObject({ label: "You tried", note: "not delivered" });
  });

  it("no send at all: 'Nobody has answered yet', hot on a business thread, quiet on small talk", () => {
    expect(didFor(row({ last_out: null }), true, NOW)).toMatchObject({ label: "Nobody has answered yet", tone: "hot" });
    expect(didFor(row({ last_out: null }), false, NOW)).toMatchObject({ label: "Nobody has answered yet", tone: "slate" });
  });

  it("unknown is not nobody: a row with no last_out key and no outbound words says nothing", () => {
    expect(didFor(row({ last_out: undefined, last_direction: "inbound" }), true, NOW)).toBeNull();
  });

  it("a desk action newer than our last send is the last thing we did", () => {
    const r = row({
      last_out: { body: "yo", at: iso(5 * H), by: "bot", state: "handed", kind: null },
      last_action: { action: "emailed", at: iso(H), until: null },
    });
    expect(didFor(r, true, NOW)).toMatchObject({ label: "You emailed the link", ago: "1h ago" });
    const older = row({
      last_out: { body: "yo", at: iso(H), by: "bot", state: "handed", kind: null },
      last_action: { action: "emailed", at: iso(5 * H), until: null },
    });
    expect(didFor(older, true, NOW)?.label).toBe("Bot said");
  });
});

describe("pillFor: the state in words", () => {
  const ev = (over: Partial<NonNullable<IgRow["booked_event"]>>) => ({ id: "e1", scheduled_at: iso(-3 * H), invitee_phone: null, invitee_name: null, outcome: null, ...over });
  it("covers every status", () => {
    expect(pillFor(row({ status: "today", booked_event: ev({}) }), false, NOW).text).toBe("Call booked");
    expect(pillFor(row({ status: "today", booked_event: ev({ scheduled_at: iso(2 * H) }) }), false, NOW).text).toBe("Did they show?");
    expect(pillFor(row({ status: "closing" }), false, NOW)).toMatchObject({ text: "Window closing", tone: "hot" });
    expect(pillFor(row({ status: "reply" }), false, NOW)).toMatchObject({ text: "Reply", tone: "warm" });
    expect(pillFor(row({ status: "tag_it" }), true, NOW).text).toBe("Follow up");
    expect(pillFor(row({ status: "tag_it" }), false, NOW).text).toBe("Window closed");
    expect(pillFor(row({ status: "casual" }), false, NOW)).toMatchObject({ text: "Just chatting", tone: "slate" });
    expect(pillFor(row({ status: "open" }), false, NOW).text).toBe("Waiting on them");
    expect(pillFor(row({ status: "snoozed" }), false, NOW).text).toBe("Snoozed");
    expect(pillFor(row({ status: "handled" }), false, NOW)).toMatchObject({ text: "Done", tone: "good" });
    expect(pillFor(row({ status: "booked", booked_event: ev({ scheduled_at: iso(5 * H), outcome: "no_show" }) }), false, NOW)).toMatchObject({ text: "No-show", tone: "hot" });
    expect(pillFor(row({ status: "booked", booked_event: ev({ scheduled_at: iso(5 * H), outcome: "hired" }) }), false, NOW).text).toBe("Showed");
    expect(pillFor(row({ status: "applied" }), false, NOW).text).toBe("Applied");
    expect(pillFor(row({ status: "applied", agent_status: "active" }), false, NOW)).toMatchObject({ text: "Hired", tone: "gold" });
  });
});

describe("factsFor and originFor: who they are", () => {
  it("what they want, what they gave, where they are", () => {
    expect(factsFor(row({ intent: "opportunity", licensed: false, phone: null, email: "a@b.co", applied: true, application_status: "no_pickup" })).map((f) => f.text))
      .toEqual(["Wants in", "Gave an email", "Applied · no pickup"]);
    expect(factsFor(row({ intent: "casual", licensed: false, phone: null, human_lane: true })).map((f) => f.text)).toEqual(["Your thread · bot off"]);
    expect(factsFor(row({ intent: "fitness", licensed: false, phone: null, has_booking: true })).map((f) => f.text)).toEqual(["Fitness", "Booked before"]);
  });
  it("says how they came in, and nothing when nothing is known", () => {
    expect(originFor(row({ came_from: { channel: "story", media_id: null } }), NOW)).toBe("Replied to your story");
    expect(originFor(row({ came_from: { channel: "dm", media_id: null }, in_count: 1 }), NOW)).toBe("Sent you a DM");
    expect(originFor(row({ came_from: { channel: "comment", media_id: "m", reel_title: null } }), NOW)).toBe("Commented on a post");
    expect(originFor(row({}), NOW)).toBeNull();
  });
});

describe("nextFor: one sentence, in the row's tone", () => {
  it("says the time and the window in Arizona time", () => {
    // 2026-10-29T08:00Z is 1:00am in Phoenix (UTC-7 all year).
    expect(nextFor(row({ status: "closing", window_closes_at: "2026-10-29T08:00:00Z" }), false, NOW).text).toBe("Reply before 1:00am. Instagram closes the window then.");
    expect(nextFor(row({ status: "closed", phone: null }), false, NOW).text).toBe("Answer in the Instagram app. The 24-hour window closed.");
    expect(nextFor(row({ status: "closed", phone: "4803277544" }), false, NOW).text).toBe("Text them, or answer in the Instagram app.");
    expect(nextFor(row({ status: "call", licensed: false, intent: "opportunity" }), false, NOW).text).toBe("Call (480) 327-7544. They gave you their number.");
  });
});

describe("oursFirst: the two lines read like a chat, older first", () => {
  it("our send before their words reads first; after, it reads second; 'nobody answered' always reads last", () => {
    const before = rowStory(row({ last_in_body: "hi", last_inbound_at: iso(H), last_out: { body: "yo", at: iso(5 * H), by: "bot", state: "handed", kind: null } }), false, NOW);
    expect(oursFirst(before)).toBe(true);
    const after = rowStory(row({ last_in_body: "hi", last_inbound_at: iso(5 * H), last_out: { body: "yo", at: iso(H), by: "bot", state: "handed", kind: null } }), false, NOW);
    expect(oursFirst(after)).toBe(false);
    const nobody = rowStory(row({ last_in_body: "hi", last_out: null }), false, NOW);
    expect(oursFirst(nobody)).toBe(false);
  });
});

describe("format helpers", () => {
  it("agoWords never says 0m ago", () => {
    expect(agoWords(iso(20_000), NOW)).toBe("just now");
    expect(agoWords(iso(5 * 60_000), NOW)).toBe("5m ago");
    expect(agoWords(null, NOW)).toBe("");
  });
  it("sentenceCase lifts the first letter of each sentence of the server's lowercase lever", () => {
    expect(sentenceCase("55 talked business, 7 gave a number. ask for the number sooner.")).toBe("55 talked business, 7 gave a number. Ask for the number sooner.");
    expect(sentenceCase("nothing's leaking. go post.")).toBe("Nothing's leaking. Go post.");
    expect(sentenceCase(null)).toBe("");
  });
  it("trendOf compares with the 30 days before and knows unknown from zero", () => {
    expect(trendOf(16, 2)).toEqual({ dir: "up", prior: 2 });
    expect(trendOf(3, 9)).toEqual({ dir: "down", prior: 9 });
    expect(trendOf(1, 1)).toEqual({ dir: "same", prior: 1 });
    expect(trendOf(1, 0)).toEqual({ dir: "up", prior: 0 });
    expect(trendOf(null, 4)).toBeNull();
  });
});
