import { describe, expect, it } from "vitest";

import {
  compareClientPriority,
  getClientPriority,
  pipelineDateKey,
  type ClientPriorityInput,
} from "@/lib/clientPipelinePriority";

const now = new Date(2026, 8, 4, 12, 0, 0);

function client(patch: Partial<ClientPriorityInput> = {}): ClientPriorityInput {
  return {
    pipeline_stage: "NEW_INITIAL",
    created_at: "2026-09-04T10:00:00Z",
    last_contact_date: null,
    next_action_date: null,
    callback_date: null,
    callback_time: null,
    ...patch,
  };
}

describe("client pipeline priority", () => {
  it("compares calendar keys without moving UTC midnight to the prior day", () => {
    expect(pipelineDateKey("2026-09-04T00:00:00+00:00")).toBe("2026-09-04");
    expect(getClientPriority(client({ callback_date: "2026-09-04" }), now)?.code).toBe("today");
  });

  it("ranks overdue promises, today's work, untouched clients, unplanned contacts, then upcoming work", () => {
    const rows = [
      client({ last_contact_date: "2026-09-01T10:00:00Z", callback_date: "2026-09-10" }),
      client({ created_at: "2026-09-04T11:00:00Z" }),
      client({ last_contact_date: "2026-09-03T10:00:00Z", callback_date: "2026-09-04" }),
      client({ last_contact_date: "2026-08-30T10:00:00Z", callback_date: "2026-09-03" }),
      client({ last_contact_date: "2026-08-01T10:00:00Z" }),
    ];

    expect(rows.sort((a, b) => compareClientPriority(a, b, now)).map((row) => getClientPriority(row, now)?.code)).toEqual([
      "overdue",
      "today",
      "new",
      "unplanned",
      "upcoming",
    ]);
  });

  it("keeps closed clients out and puts the newest untouched client first", () => {
    expect(getClientPriority(client({ pipeline_stage: "SOLD" }), now)).toBeNull();
    expect(getClientPriority(client({ pipeline_stage: "LOST" }), now)).toBeNull();
    const older = client({ created_at: "2026-08-01T10:00:00Z" });
    const newer = client({ created_at: "2026-09-04T11:00:00Z" });
    expect([older, newer].sort((a, b) => compareClientPriority(a, b, now))[0]).toBe(newer);
  });

  it("treats a future callback as protected even before first contact", () => {
    expect(getClientPriority(client({ callback_date: "2026-09-05" }), now)?.code).toBe("upcoming");
  });
});
