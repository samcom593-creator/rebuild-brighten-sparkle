import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));

import { dialTapHandler, recordDialTap } from "@/lib/leadDialTap";

const ROOT = resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

// MP-ONBOARD-ANCHOR-PKG2 (2026-11-12). The dialer is canceled; the My Leads call link is how agents dial. A tap on
// it used to write nothing, so "dialing" could not be told from a logged button press. These pin the recording path
// and, above all, that recording a tap can never get in the way of the call.
describe("recordDialTap", () => {
  it("sends the lead's item id to my_lead_dial_tap and reports the server's verdict", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    await expect(recordDialTap("item-1", rpc)).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith("item-1");
  });

  it("never rejects: a server refusal, a network rejection and a synchronous throw all resolve false", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(recordDialTap("item-1", vi.fn().mockResolvedValue({ error: { message: "This lead is not assigned to you." } }))).resolves.toBe(false);
    await expect(recordDialTap("item-1", vi.fn().mockRejectedValue(new Error("offline")))).resolves.toBe(false);
    await expect(recordDialTap("item-1", () => { throw new Error("boom"); })).resolves.toBe(false);
    expect(warn).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });

  it("records nothing without an item id", async () => {
    const rpc = vi.fn();
    await expect(recordDialTap("", rpc)).resolves.toBe(false);
    await expect(recordDialTap(null, rpc)).resolves.toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("the click handler fires the tap and returns immediately (the link navigates as before)", () => {
    let settle: (v: { error: null }) => void = () => undefined;
    const rpc = vi.fn(() => new Promise<{ error: null }>((r) => { settle = r; }));
    const handler = dialTapHandler("item-9", rpc);
    expect(handler()).toBeUndefined();
    expect(rpc).toHaveBeenCalledWith("item-9");
    settle({ error: null });
  });
});

describe("dial tap wiring", () => {
  const page = read("src/pages/MyLeads.tsx");
  const lib = read("src/lib/leadDialTap.ts");
  const sql = read("supabase/migrations/20261112000210_pkg2_activity_truth.sql");

  it("both call links in My Leads record the tap", () => {
    expect(page).toContain('import { dialTapHandler } from "@/lib/leadDialTap";');
    expect(page).toMatch(/<a href=\{href\} \{\.\.\.contactLinkProps\(href\)\} onClick=\{dialTapHandler\(l\.item_id\)\}/);
    expect(page).toMatch(/<a href=\{href\} \{\.\.\.contactLinkProps\(href\)\} onClick=\{dialTapHandler\(cur\.item_id\)\}/);
  });

  it("the client calls the RPC by name with the argument the function declares", () => {
    expect(lib).toContain('supabase.rpc("my_lead_dial_tap" as never, { p_item_id: itemId } as never)');
    expect(sql).toContain("create or replace function public.my_lead_dial_tap(p_item_id uuid)");
  });

  it("the server records only for the grant holder, refuses suspended logins, and folds double taps", () => {
    expect(sql).toMatch(/g\.bundle_id = v_bundle and g\.user_id = v_uid and g\.revoked_at is null/);
    expect(sql).toContain("agent_access_suspensions s where s.user_id = v_uid and s.lifted_at is null");
    expect(sql).toContain("e.at > now() - interval '30 seconds'");
    expect(sql).toContain("'dial_tap'");
    expect(sql).toMatch(/grant execute on function public\.my_lead_dial_tap\(uuid\) to authenticated, service_role;/);
    expect(sql).toMatch(/revoke all on function public\.my_lead_dial_tap\(uuid\) from public, anon;/);
  });
});
