import { describe, expect, test, vi } from "vitest";
import { deliverEthosSheet, deliverEthosUpdate, MGN_NEW_AGENTS_HEADERS, MGN_UPDATE_AGENT_HEADERS, mgnCompPercent, verifyMgnHeader, type DeliveryDeps, type UpdateDeps, type UpdateRow } from "../../../supabase/functions/_shared/contracting-delivery.ts";

// MP-304: MGN IMO's "Apex financial / Ethos" workbook. New Agents A:H in MGN's order; Update Agent A:H with a
// checkbox in H and FALSE pre-filled on every row.
const CONFIG = JSON.stringify({ sheet_id: "mgn-1", tab: "New Agents", updates_tab: "Update Agent", layout: "mgn", principal_npn: "21346366" });
const INTAKE = { id: "i-1", first_name: "Nathan", last_name: "Seward", email: "sewardnathan20@gmail.com", phone_e164: "+16086096667", npn: "22372596", status: "accepted", comp_percentage: 60 };
const APPROVAL = { evidence_mode: "attested", attested_by: "u", attested_at: "2026-11-23T20:00:00Z", license_attested: true, eo_attested: false, contact_confirmed_at: "2026-11-23T20:00:00Z",
  approved_comp_level: "Level 12", approved_advance_tier: "6 Month Advance", approved_upline_npn: "21679167", approved_sub_agency: "Obiajulu Ifediora", approved_sub_agent_head: false, approved_by: "u", approved_at: "2026-11-23T20:00:00Z" };
// Sam, 2026-11-23: MGN's Comp Level column reads a PERCENT, never "Level 12".
const EXPECTED = ["Nathan", "Seward", "(608) 609-6667", "sewardnathan20@gmail.com", "22372596", "21679167", "60%", "6 Month Advance"];
const NEW_TAB = [[...MGN_NEW_AGENTS_HEADERS], ["Ada", "Lovelace", "(555) 010-0001", "ada@example.com", "21000002", "21346366", "Level 12", "6 Month Advance"]];
// MGN's real header cells carry line breaks in E/F/G.
const UPD_HDR = ["First Name (required)", "Last Name (required)", "Personal NPN (required)", "Direct Upline's Personal NPN (if changing)", "Comp Level\n(if changing)", "Payment Tier\n(if changing)", "PII Information\n(if changing)", "Terminate Agent"];
const UPD_TAB = [UPD_HDR, ["", "", "", "", "", "", "", "FALSE"], ["", "", "", "", "", "", "", "FALSE"], ["", "", "", "", "", "", "", "FALSE"]];

function sheets(tabs: Record<string, unknown[][]>) {
  const calls: { method: string; range: string; body?: unknown }[] = [];
  const written: Record<string, unknown[]> = {};
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    const m = /\/values\/([^?]+)/.exec(url); const range = decodeURIComponent(m?.[1] ?? ""); const method = init?.method ?? "GET";
    calls.push({ method, range, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const [tab, a1] = range.split("!");
    if (method === "PUT") { written[range] = (JSON.parse(String(init?.body)) as { values: unknown[][] }).values[0]; return new Response(JSON.stringify({ updatedRange: range }), { status: 200 }); }
    if (written[range]) return new Response(JSON.stringify({ values: [written[range]] }), { status: 200 });
    if (a1 === "A:H") return new Response(JSON.stringify({ values: tabs[tab] ?? [] }), { status: 200 });
    const rowN = Number(/^A(\d+):H\d+$/.exec(a1)?.[1]); const row = (tabs[tab] ?? [])[rowN - 1];
    return new Response(JSON.stringify({ values: row ? [row] : [] }), { status: 200 });
  });
  return { fetchImpl, calls, written };
}
const base = { readSetting: async (k: string) => (k === "ethos_agents_sheet" ? CONFIG : k === "ethos_sheet_writes_enabled" ? "true" : null), googleCredential: "{\"type\":\"authorized_user\",\"client_id\":\"c\",\"client_secret\":\"s\",\"refresh_token\":\"r\"}", now: () => Date.parse("2026-11-23T21:00:00Z"), getToken: async () => "stub" };

describe("MGN New Agents layout (MP-304)", () => {
  test("comp on MGN is a percent: the intake's own pct wins, a level converts exactly, never a bare level", () => {
    expect(mgnCompPercent("Level 12", 60)).toBe("60%");
    expect(mgnCompPercent("Level 14", null)).toBe("70%");
    expect(mgnCompPercent("Level 17", 85)).toBe("85%");
    expect(mgnCompPercent(null, null)).toBe("60%");
  });
  test("header cells with line breaks still match; a renamed column is drift", () => {
    expect(verifyMgnHeader(MGN_UPDATE_AGENT_HEADERS, UPD_HDR).ok).toBe(true);
    expect(verifyMgnHeader(MGN_NEW_AGENTS_HEADERS, ["Agent First Name", "Surname"]).drift).toEqual(["B", "C", "D", "E", "F", "G", "H"]);
  });
  test("appends A:H in MGN's order after the last populated row, upline = manager's NPN, read back", async () => {
    const s = sheets({ "New Agents": NEW_TAB });
    const deps: DeliveryDeps = { ...base, loadIntake: async () => INTAKE, sendEmail: async () => "x", fetchImpl: s.fetchImpl as never, loadEthosApproval: async () => APPROVAL };
    const out = await deliverEthosSheet("i-1", deps);
    expect(out.state).toBe("delivered");
    const put = s.calls.find((c) => c.method === "PUT");
    expect(put?.range).toBe("New Agents!A3:H3");
    expect((put?.body as { values: unknown[][] }).values[0]).toEqual(EXPECTED);
    expect(out.receipt?.written).toBe(true);
  });
  test("NPN already on the MGN tab → delivered, nothing written", async () => {
    const s = sheets({ "New Agents": [...NEW_TAB, EXPECTED] });
    const deps: DeliveryDeps = { ...base, loadIntake: async () => INTAKE, sendEmail: async () => "x", fetchImpl: s.fetchImpl as never, loadEthosApproval: async () => APPROVAL };
    const out = await deliverEthosSheet("i-1", deps);
    expect(out.state).toBe("delivered"); expect(out.receipt?.written).toBe(false);
    expect(s.calls.some((c) => c.method === "PUT")).toBe(false);
  });
  test("same email under another NPN → held, nothing written", async () => {
    const s = sheets({ "New Agents": [...NEW_TAB, ["Someone", "Else", "(555) 010-0009", "sewardnathan20@gmail.com", "21009999", "21346366", "Level 12", "6 Month Advance"]] });
    const deps: DeliveryDeps = { ...base, loadIntake: async () => INTAKE, sendEmail: async () => "x", fetchImpl: s.fetchImpl as never, loadEthosApproval: async () => APPROVAL };
    const out = await deliverEthosSheet("i-1", deps);
    expect(out.state).toBe("manual_review"); expect(s.calls.some((c) => c.method === "PUT")).toBe(false);
  });
  test("header drift on New Agents → held, nothing written", async () => {
    const s = sheets({ "New Agents": [["Agent First Name", "Last", ...MGN_NEW_AGENTS_HEADERS.slice(2)]] });
    const deps: DeliveryDeps = { ...base, loadIntake: async () => INTAKE, sendEmail: async () => "x", fetchImpl: s.fetchImpl as never, loadEthosApproval: async () => APPROVAL };
    const out = await deliverEthosSheet("i-1", deps);
    expect(out.state).toBe("manual_review"); expect(out.note).toMatch(/Header drift/);
  });
});

describe("MGN Update Agent layout (MP-304)", () => {
  const ROW: UpdateRow = { id: "u-1", status: "queued", sheet_row: null, npn: "22372596", first_name: "Nathan", last_name: "Seward", change_upline_npn: null, change_comp_level: "Level 13", change_advance_tier: null, change_pii: null, termination_requested: false, termination_authorized_by: null, termination_authorized_at: null };
  const udeps = (fetchImpl: unknown, row = ROW): UpdateDeps & { planned: number[] } => { const planned: number[] = []; return { ...base, loadUpdate: async () => row, recordPlannedRow: async (n) => { planned.push(n); }, fetchImpl: fetchImpl as never, planned }; };
  test("FALSE-prefilled rows are empty: writes row 2, H as a real boolean, planned row recorded first", async () => {
    const s = sheets({ "Update Agent": UPD_TAB });
    const d = udeps(s.fetchImpl);
    const out = await deliverEthosUpdate("u-1", d);
    expect(out.state).toBe("delivered");
    const put = s.calls.find((c) => c.method === "PUT");
    expect(put?.range).toBe("Update Agent!A2:H2");
    expect((put?.body as { values: unknown[][] }).values[0]).toEqual(["Nathan", "Seward", "22372596", "", "65%", "", "", false]);
    expect(d.planned).toEqual([2]);
  });
  test("a populated row 2 pushes the write to row 3", async () => {
    const s = sheets({ "Update Agent": [UPD_HDR, ["Ada", "Lovelace", "21000002", "", "Level 14", "", "", "FALSE"], ["", "", "", "", "", "", "", "FALSE"]] });
    const out = await deliverEthosUpdate("u-1", udeps(s.fetchImpl));
    expect(out.state).toBe("delivered"); expect(out.receipt?.row).toBe(3);
  });
  test("lost answer with the planned row already holding our values → reconciled, no second write", async () => {
    const s = sheets({ "Update Agent": [UPD_HDR, ["Nathan", "Seward", "22372596", "", "65%", "", "", "FALSE"]] });
    const out = await deliverEthosUpdate("u-1", udeps(s.fetchImpl, { ...ROW, status: "attempting", sheet_row: 2 }));
    expect(out.state).toBe("delivered"); expect(out.receipt?.action).toBe("reconciled_prior_write");
    expect(s.calls.some((c) => c.method === "PUT")).toBe(false);
  });
});
