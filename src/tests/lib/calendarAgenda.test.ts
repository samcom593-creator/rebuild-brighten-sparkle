import { describe, expect, it } from "vitest";
import {
  type AgendaViewRow,
  type CalendarWindowRow,
  groupByDay,
  mergeAgenda,
  reminderStateLabel,
} from "@/lib/calendarAgenda";

const ME = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";

function windowRow(over: Partial<CalendarWindowRow> & { event_id: string }): CalendarWindowRow {
  return {
    event_date: "2026-11-05",
    event_at: "2026-11-05T17:00:00.000Z",
    kind: "interview",
    title: "Synthetic Person",
    subtitle: null,
    person_name: null,
    status: "scheduled",
    ref_id: null,
    link: null,
    ...over,
  };
}

function agendaRow(over: Partial<AgendaViewRow> & { event_key: string }): AgendaViewRow {
  return {
    source_table: "interview_events",
    ref_id: over.event_key.split(":")[1],
    kind: "interview",
    title: "Synthetic Person",
    person_name: "Synthetic Person",
    person_email: "synthetic@example.invalid",
    application_id: null,
    agent_id: null,
    owner_user_id: ME,
    starts_at: "2026-11-05T15:00:00.000Z",
    ends_at: "2026-11-05T15:30:00.000Z",
    event_tz: "America/New_York",
    meeting_link: null,
    status: "scheduled",
    outcome: null,
    booking_source: "manual",
    call_track: "other",
    reminder_state: "off",
    reschedule_url: null,
    cancel_url: null,
    was_rescheduled: false,
    cancel_reason: null,
    notes: null,
    updated_at: null,
    ...over,
  };
}

describe("mergeAgenda", () => {
  it("shows one item per meeting: the agenda row replaces the window copy of the same key", () => {
    const items = mergeAgenda(
      [windowRow({ event_id: "interview:aaa", event_at: "2026-11-05T17:00:00.000Z" })],
      [agendaRow({ event_key: "interview:aaa" })],
    );
    expect(items).toHaveLength(1);
    expect(items[0].startsAt).toBe("2026-11-05T15:00:00.000Z");
    expect(items[0].eventTz).toBe("America/New_York");
    expect(items[0].editMode).toBe("interview");
  });

  it("keeps window rows (read-only) when the agenda feed is unavailable — degraded, not empty", () => {
    const items = mergeAgenda([windowRow({ event_id: "interview:aaa" })], null);
    expect(items).toHaveLength(1);
    expect(items[0].editMode).toBeNull();
    expect(items[0].agenda).toBeNull();
  });

  it("drops window copies of agenda-owned keys even if the agenda has no row for them (agenda is authoritative)", () => {
    const items = mergeAgenda(
      [windowRow({ event_id: "cal:zzz", kind: "appointment" }), windowRow({ event_id: "bday:c1:2026", kind: "birthday" })],
      [],
    );
    expect(items.map((i) => i.key)).toEqual(["bday:c1:2026"]);
  });

  it("Calendly-owned rows are not editable in-app; staff-booked rows are", () => {
    const items = mergeAgenda(null, [
      agendaRow({ event_key: "interview:cal1", booking_source: "calendly", owner_user_id: null }),
      agendaRow({ event_key: "interview:man1", booking_source: "manual", starts_at: "2026-11-05T16:00:00.000Z" }),
    ]);
    expect(items.find((i) => i.key === "interview:cal1")?.editMode).toBe("calendly");
    expect(items.find((i) => i.key === "interview:man1")?.editMode).toBe("interview");
  });

  it("appointments are editable only by their owner (or when ownerless), matching calendar_events RLS", () => {
    const items = mergeAgenda(null, [
      agendaRow({ event_key: "cal:mine", source_table: "calendar_events", kind: "appointment", owner_user_id: ME }),
      agendaRow({ event_key: "cal:theirs", source_table: "calendar_events", kind: "appointment", owner_user_id: OTHER, starts_at: "2026-11-05T16:00:00.000Z" }),
      agendaRow({ event_key: "cal:draft", source_table: "calendar_events", kind: "draft_date", owner_user_id: ME, starts_at: "2026-11-05T17:00:00.000Z" }),
    ], { viewerUserId: ME });
    const mode = Object.fromEntries(items.map((i) => [i.key, i.editMode]));
    expect(mode).toEqual({ "cal:mine": "appointment", "cal:theirs": null, "cal:draft": null });
  });

  it("hides canceled events unless asked, and normalizes the window's 'cancelled' spelling", () => {
    const window = [windowRow({ event_id: "interview:w1", status: "cancelled" })];
    const agenda = [agendaRow({ event_key: "interview:a1", status: "canceled" })];
    expect(mergeAgenda(window, null)).toHaveLength(0);
    expect(mergeAgenda(null, agenda)).toHaveLength(0);
    expect(mergeAgenda(window, null, { showCanceled: true })[0].status).toBe("canceled");
    expect(mergeAgenda(null, agenda, { showCanceled: true })).toHaveLength(1);
  });

  it("filters by kind", () => {
    const items = mergeAgenda(
      [windowRow({ event_id: "bday:c1:2026", kind: "birthday" }), windowRow({ event_id: "pol:k1", kind: "policy_effective" })],
      [agendaRow({ event_key: "interview:a1" })],
      { kinds: ["birthday", "interview"] },
    );
    expect(items.map((i) => i.kind).sort()).toEqual(["birthday", "interview"]);
  });

  it("buckets agenda rows on the Phoenix business day, not UTC", () => {
    // 04:30Z on the 6th is 9:30 PM on the 5th in Phoenix.
    const [item] = mergeAgenda(null, [agendaRow({ event_key: "interview:late", starts_at: "2026-11-06T04:30:00.000Z" })]);
    expect(item.dateKey).toBe("2026-11-05");
  });

  it("orders each day all-day markers first, then by start time", () => {
    const items = mergeAgenda(
      [windowRow({ event_id: "bday:c1:2026", kind: "birthday", event_at: "2026-11-05T07:00:00.000Z" })],
      [
        agendaRow({ event_key: "interview:b", starts_at: "2026-11-05T18:00:00.000Z" }),
        agendaRow({ event_key: "interview:a", starts_at: "2026-11-05T15:00:00.000Z" }),
      ],
    );
    expect(items.map((i) => i.key)).toEqual(["bday:c1:2026", "interview:a", "interview:b"]);
    expect(items[0].allDay).toBe(true);
    expect(groupByDay(items).get("2026-11-05")).toHaveLength(3);
  });
});

describe("reminderStateLabel", () => {
  it("never claims a send without a receipt and treats unknown states as a warning", () => {
    expect(reminderStateLabel("calendly_managed").label).toMatch(/not visible here/);
    expect(reminderStateLabel("invite_queued").label).toMatch(/not sent yet/);
    expect(reminderStateLabel("invite_failed").tone).toBe("bad");
    expect(reminderStateLabel("something_new").tone).toBe("warn");
    expect(reminderStateLabel(undefined).label).toMatch(/unknown/);
  });
});
