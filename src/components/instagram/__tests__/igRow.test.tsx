/**
 * IG desk row contract (MP-305 W5, rebuilt for OVERHAUL-instagram).
 *
 * Pins (1) the main/second button pair per status word, (2) that 'delivered' is said only when the
 * sender's response carries a Meta mid (the 465-row fake-success lesson applied to DMs), (3) the
 * lever's text prefill by key, (4) that a rendered 'call' row shows the number before the tap, its
 * tel/Google Voice anchor spreads contactLinkProps, and every IG link carries noopener, and (5) that
 * a list card never fills a button gold: only the one featured Up next card does.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { classifySendResponse } from "../igActions";
import { SEND_RESULT, SMS, leverSmsBody } from "../igCopy";
import { buttonPair, effectiveStatus, who } from "../igRowLogic";
import { nextFor, pillFor } from "../igStory";
import { IgRow } from "../IgRow";
import type { IgRow as IgRowData } from "../igTypes";

const NOW = Date.parse("2026-10-28T06:00:00Z");

function row(over: Partial<IgRowData>): IgRowData {
  return {
    external_id: "1234567890", handle: "@kevin", name: "Kevin", status: "closed", rank: 6,
    last_body: "we still on?", last_direction: "inbound", last_at: "2026-10-27T06:00:00Z", last_inbound_at: "2026-10-27T06:00:00Z",
    age_min: 1440, window_closes_at: "2026-10-28T06:00:00Z", phone: null, email: null, intent: "opportunity", licensed: false,
    human_lane: false, booked_event: null, has_booking: false, applied: false,
    ...over,
  };
}

describe("buttonPair: one main + one second button per status word", () => {
  it("call -> call + text", () => {
    expect(buttonPair(row({ status: "call", phone: "4803277544" }), false, NOW)).toEqual({ gold: "call", outline: "text" });
  });
  it("today upcoming -> call + text; today past unmarked -> showed + no-show; today past marked reads booked", () => {
    const up = row({ status: "today", phone: "4803277544", booked_event: { id: "e1", scheduled_at: "2026-10-28T20:00:00Z", invitee_phone: null, invitee_name: null, outcome: null } });
    expect(buttonPair(up, false, NOW)).toEqual({ gold: "call", outline: "text" });
    const past = row({ status: "today", phone: "4803277544", booked_event: { id: "e1", scheduled_at: "2026-10-28T04:00:00Z", invitee_phone: null, invitee_name: null, outcome: null } });
    expect(buttonPair(past, false, NOW)).toEqual({ gold: "showed", outline: "no_show" });
    expect(pillFor(past, false, NOW).text).toBe("Did they show?");
    expect(nextFor(past, false, NOW).text).toMatch(/showed or no-show/);
    const marked = row({ status: "today", booked_event: { id: "e1", scheduled_at: "2026-10-28T04:00:00Z", invitee_phone: null, invitee_name: null, outcome: "completed" } });
    expect(effectiveStatus(marked, false, NOW)).toBe("booked");
    expect(pillFor(marked, false, NOW).text).toBe("Showed");
  });
  it("closing / reply -> reply + open in Instagram", () => {
    expect(buttonPair(row({ status: "closing" }), false, NOW)).toEqual({ gold: "send", outline: "open_ig" });
    expect(buttonPair(row({ status: "reply" }), false, NOW)).toEqual({ gold: "send", outline: "open_ig" });
  });
  it("tag it -> follow up only when the sender supports HUMAN_AGENT; otherwise the row is closed", () => {
    expect(buttonPair(row({ status: "tag_it" }), true, NOW)).toEqual({ gold: "nudge", outline: "open_ig" });
    expect(effectiveStatus(row({ status: "tag_it" }), false, NOW)).toBe("closed");
    expect(buttonPair(row({ status: "tag_it" }), false, NOW)).toEqual({ gold: "open_ig", outline: "done" });
  });
  it("closed -> open in Instagram + (text when a phone exists, else done)", () => {
    expect(buttonPair(row({ status: "closed", phone: "4803277544" }), false, NOW)).toEqual({ gold: "open_ig", outline: "text" });
    expect(buttonPair(row({ status: "closed" }), false, NOW)).toEqual({ gold: "open_ig", outline: "done" });
    expect(pillFor(row({ status: "closed" }), false, NOW).text).toBe("Window closed");
  });
  it("casual -> open in Instagram + done; snoozed -> open in Instagram + bring back", () => {
    expect(buttonPair(row({ status: "casual", intent: "casual" }), false, NOW)).toEqual({ gold: "open_ig", outline: "done" });
    expect(buttonPair(row({ status: "snoozed" }), false, NOW)).toEqual({ gold: "open_ig", outline: "bring_back" });
  });
  it("never 'Unknown' for who()", () => {
    expect(who({ handle: null, name: null })).toBe("Someone on Instagram");
    expect(who({ handle: "1234", name: "Kev" })).toBe("Kev");
    expect(who({ handle: "kevin", name: null })).toBe("@kevin");
  });
});

describe("classifySendResponse: 'delivered' only with a Meta mid", () => {
  it("ok with id -> delivered", () => {
    expect(classifySendResponse({ ok: true, id: "m_abc" }).line).toBe(SEND_RESULT.delivered);
  });
  it("ok without id -> no receipt, never delivered", () => {
    const r = classifySendResponse({ ok: true, id: null });
    expect(r.line).toBe(SEND_RESULT.noReceipt);
    expect(r.line).not.toContain("delivered");
  });
  it("ok + link stripped without id -> no link line", () => {
    expect(classifySendResponse({ ok: true, link_stripped: true }).line).toBe(SEND_RESULT.noLink);
  });
  it("refusals read the kind in words", () => {
    expect(classifySendResponse({ ok: false, kind: "window_closed", error: "x" }).line).toBe(SEND_RESULT.windowClosed);
    expect(classifySendResponse({ ok: false, kind: "link_blocked", error: "x" }).line).toBe(SEND_RESULT.linkBlocked);
    expect(classifySendResponse({ ok: false, held: true, error: "x" }).line).toBe(SEND_RESULT.tokenDead);
    expect(classifySendResponse({ ok: false, kind: "tag_not_permitted", error: "x" }).line).toBe(SEND_RESULT.tagNotPermitted);
    expect(classifySendResponse({ ok: false, error: "a".repeat(200) }).line).toHaveLength(140);
  });
  it("a bare 200 shape with no body is not delivered", () => {
    expect(classifySendResponse(null).ok).toBe(false);
  });
});

describe("leverSmsBody", () => {
  it("locked-in gap and number-not-booked carry their own prefill; the rest use the row's", () => {
    expect(leverSmsBody("locked_in_gap")).toBe(SMS.lockedIn);
    expect(leverSmsBody("number_booked")).toBe(SMS.numberNotBooked);
    expect(leverSmsBody("business_number")).toBeNull();
    expect(leverSmsBody("none")).toBeNull();
  });
});

/** Buttons and button-styled links filled with the brand gold. */
function goldButtons(container: HTMLElement): Element[] {
  return Array.from(container.querySelectorAll("a, button")).filter((el) => el.classList.contains("bg-primary"));
}

describe("IgRow render", () => {
  it("a call row prints the number before the tap and links carry noopener", () => {
    render(<IgRow row={row({ status: "call", phone: "4803277544" })} context="list" humanAgentSupported={false} onAction={() => undefined} now={NOW} />);
    // The number is printed in the next step AND on the button: visible before the tap, twice.
    expect(screen.getAllByText(/\(480\) 327-7544/).length).toBeGreaterThanOrEqual(2);
    const call = screen.getByRole("link", { name: /call @kevin/i });
    expect(call.getAttribute("href")).toMatch(/voice\.google\.com|^tel:/);
    if (call.getAttribute("href")?.startsWith("https://")) {
      expect(call).toHaveAttribute("target", "_blank");
      expect(call).toHaveAttribute("rel", "noopener noreferrer");
    }
    expect(screen.getByText("Call them")).toBeInTheDocument();
  });
  it("a closed row's main button is Open in Instagram with rel noopener and a thread deep link", () => {
    render(<IgRow row={row({ status: "closed" })} context="list" humanAgentSupported={false} onAction={() => undefined} now={NOW} />);
    const ig = screen.getByRole("link", { name: /open @kevin on instagram/i });
    expect(ig).toHaveAttribute("href", "https://ig.me/m/kevin");
    expect(ig).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText("Window closed")).toBeInTheDocument();
  });
  it("when the server sends one side only and ours is newest, the row says what we said without claiming delivery", () => {
    render(<IgRow row={row({ status: "open", last_direction: "outbound", last_body: "what's your number?" })} context="people" humanAgentSupported={false} onAction={() => undefined} now={NOW} />);
    expect(screen.getByText("We said")).toBeInTheDocument();
    expect(screen.getByText("“what's your number?”")).toBeInTheDocument();
    expect(screen.queryByText(/delivered/i)).toBeNull();
  });
  it("shows what they said and what we did on the same card", () => {
    render(
      <IgRow
        row={row({
          status: "call", phone: "4803277544", last_in_body: "we still on for the call?",
          last_out: { body: "locked in, talk soon", at: "2026-10-27T07:00:00Z", by: "bot", state: "handed", kind: null },
        })}
        context="list" humanAgentSupported={false} onAction={() => undefined} now={NOW}
      />,
    );
    expect(screen.getByText("“we still on for the call?”")).toBeInTheDocument();
    expect(screen.getByText("“locked in, talk soon”")).toBeInTheDocument();
    expect(screen.getByText("Bot said")).toBeInTheDocument();
    expect(screen.getByText("no receipt")).toBeInTheDocument();
  });
  it("a list card fills no button gold; the featured Up next card fills exactly one", () => {
    const r = row({ status: "call", phone: "4803277544" });
    const { container, unmount } = render(<IgRow row={r} context="list" humanAgentSupported={false} onAction={() => undefined} now={NOW} />);
    expect(goldButtons(container)).toHaveLength(0);
    unmount();
    const featured = render(<IgRow row={r} context="list" humanAgentSupported={false} onAction={() => undefined} now={NOW} featured />);
    expect(goldButtons(featured.container)).toHaveLength(1);
  });
});
