import { describe, expect, test, vi } from "vitest";
// The SAME leg the dispatcher runs for an Agent Updates row.
import { deliverEthosUpdate, type UpdateDeps, type UpdateRow } from "../../../supabase/functions/_shared/contracting-delivery.ts";
import { UPDATES_HEADERS } from "../../../supabase/functions/_shared/ethos-contract.ts";

const CONFIG = JSON.stringify({ sheet_id: "sheet-1", tab: "agwnts" });
const ROW: UpdateRow = {
  id: "u-1", status: "queued", sheet_row: null, npn: "21755124", first_name: "Chukwudi", last_name: "Ifediora",
  change_upline_npn: null, change_comp_level: "Level 17", change_advance_tier: null, change_pii: "Mobile: (608) 201-8228",
  termination_requested: false, termination_authorized_by: null, termination_authorized_at: null,
};
const EXPECTED = ["Chukwudi", "Ifediora", "21755124", "", "Level 17", "", "Mobile: (608) 201-8228", ""];
// Row 1 guidance, row 2 header, row 3 guidance, row 4 one populated request (as the live tab is today).
const TAB = [["Required", "", "", "if update required"], [...UPDATES_HEADERS], ["", "", "", "", "", "", "Name, mobile, or email", ""], ["Ada", "Lovelace", "21000002", "", "Level 13", "", "", ""]];

function sheets(opts: { tab?: unknown[][]; row5?: unknown[] } = {}) {
  const calls: { method: string; range: string; body?: unknown }[] = [];
  let row5: unknown[] = opts.row5 ?? [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    const m = /\/values\/([^?]+)/.exec(url);
    const range = decodeURIComponent(m?.[1] ?? "");
    const method = init?.method ?? "GET";
    calls.push({ method, range, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (method === "PUT") { row5 = (JSON.parse(String(init?.body)) as { values: unknown[][] }).values[0]; return new Response(JSON.stringify({ updatedRange: range }), { status: 200 }); }
    if (range.endsWith("!A:L")) return new Response(JSON.stringify({ values: [...(opts.tab ?? TAB), ...(row5.length ? [row5] : [])] }), { status: 200 });
    if (/!A5:H5$/.test(range)) return new Response(JSON.stringify({ values: row5.length ? [row5] : [] }), { status: 200 });
    return new Response(JSON.stringify({ values: [] }), { status: 200 });
  });
  return { fetchImpl, calls };
}

function deps(over: Partial<UpdateDeps> & { row?: UpdateRow } = {}): UpdateDeps & { planned: number[] } {
  const planned: number[] = [];
  const row = over.row ?? ROW;
  return {
    planned,
    readSetting: async (k) => (k === "ethos_agents_sheet" ? CONFIG : k === "ethos_sheet_writes_enabled" ? "true" : null),
    loadUpdate: async () => row,
    recordPlannedRow: async (n) => { planned.push(n); },
    fetchImpl: (async () => new Response("{}", { status: 200 })) as never,
    googleCredential: "{\"client_email\":\"x\",\"private_key\":\"y\"}",
    now: () => Date.parse("2026-11-23T20:00:00Z"),
    getToken: async () => "stub-token",
    ...over,
  };
}

describe("ethos Agent Updates leg (MP-304)", () => {
  test("writes exactly A:H of the first empty row, records the planned row FIRST, reads back", async () => {
    const s = sheets();
    const d = deps({ fetchImpl: s.fetchImpl as never });
    const out = await deliverEthosUpdate("u-1", d);
    expect(out.state).toBe("delivered");
    expect(out.receipt?.row).toBe(5);
    expect(d.planned).toEqual([5]);
    const put = s.calls.find((c) => c.method === "PUT");
    expect(put?.range).toBe("Agent Updates!A5:H5");
    expect((put?.body as { values: unknown[][] }).values[0]).toEqual(EXPECTED);
    // planned-row record happens before the PUT
    const putIdx = s.calls.findIndex((c) => c.method === "PUT");
    expect(putIdx).toBeGreaterThan(0);
    expect(out.receipt?.read_back_verified).toBe(true);
  });

  test("writes OFF: not_configured, nothing fetched, nothing planned", async () => {
    const s = sheets();
    const d = deps({ fetchImpl: s.fetchImpl as never, readSetting: async (k) => (k === "ethos_agents_sheet" ? CONFIG : "false") });
    const out = await deliverEthosUpdate("u-1", d);
    expect(out.state).toBe("not_configured");
    expect(s.fetchImpl).not.toHaveBeenCalled();
    expect(d.planned).toEqual([]);
  });

  test("lost answer: 'attempting' + sheet_row and the row already holds our values → reconciled, NO second write", async () => {
    const s = sheets({ row5: EXPECTED });
    const d = deps({ fetchImpl: s.fetchImpl as never, row: { ...ROW, status: "attempting", sheet_row: 5 } });
    const out = await deliverEthosUpdate("u-1", d);
    expect(out.state).toBe("delivered");
    expect(out.receipt?.action).toBe("reconciled_prior_write");
    expect(s.calls.some((c) => c.method === "PUT")).toBe(false);
  });

  test("lost answer but the planned row holds someone else's values → manual_review, NO write", async () => {
    const s = sheets({ row5: ["Grace", "Hopper", "21000009", "", "Level 14", "", "", ""] });
    const d = deps({ fetchImpl: s.fetchImpl as never, row: { ...ROW, status: "attempting", sheet_row: 5 } });
    const out = await deliverEthosUpdate("u-1", d);
    expect(out.state).toBe("manual_review");
    expect(s.calls.some((c) => c.method === "PUT")).toBe(false);
  });

  test("no change requested → held by the gate, nothing written", async () => {
    const s = sheets();
    const d = deps({ fetchImpl: s.fetchImpl as never, row: { ...ROW, change_comp_level: null, change_pii: null } });
    const out = await deliverEthosUpdate("u-1", d);
    expect(out.state).toBe("manual_review");
    expect(out.note).toMatch(/update_no_change_requested/);
    expect(s.calls.some((c) => c.method === "PUT")).toBe(false);
  });

  test("header drift on the Agent Updates tab → manual_review, nothing written", async () => {
    const drifted = TAB.map((r, i) => (i === 1 ? ["Agent First Name", "Surname", ...r.slice(2)] : r));
    const s = sheets({ tab: drifted });
    const d = deps({ fetchImpl: s.fetchImpl as never });
    const out = await deliverEthosUpdate("u-1", d);
    expect(out.state).toBe("manual_review");
    expect(out.note).toMatch(/Header drift/);
    expect(s.calls.some((c) => c.method === "PUT")).toBe(false);
  });
});
