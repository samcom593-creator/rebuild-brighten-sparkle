/**
 * demoFetch's GATE, pinned — the half of demo mode that had no test at all.
 *
 * src/tests/lib/demoMode.test.ts proves maskPayload masks correctly. It always
 * did. MP-530's bug was one line upstream of it: the gate decided WHAT reached
 * the mask, and `method === "GET"` excluded every .rpc() on the platform,
 * because supabase-js sends RPCs as POST. A correct mask behind a wrong gate is
 * indistinguishable from no mask, and the banner asserts the opposite — so
 * these tests grade the gate's decision, never the mask's arithmetic.
 *
 * The assertions that matter most are the two that must stay FALSE: a genuine
 * table write is not rewritten, and no request is ever altered on its way out.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const REST = "https://xrzweoneiieddzxogewk.supabase.co/rest/v1";
const FN = "https://xrzweoneiieddzxogewk.supabase.co/functions/v1";

let demoOn = true;
vi.mock("@/lib/demoMode", async () => {
  const actual = await vi.importActual<typeof import("@/lib/demoMode")>("@/lib/demoMode");
  return { ...actual, isDemoMode: () => demoOn };
});

const bounded = vi.fn();
vi.mock("@/integrations/supabase/boundedFetch", () => ({
  boundedFetch: (input: RequestInfo | URL, init?: RequestInit) => bounded(input, init),
}));

import { demoFetch } from "@/integrations/supabase/demoFetch";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** The live shape MP-530 caught rendering real people under a "this is fake" banner. */
const highlights = () => [{ agent: "OBIAJULU", amount: 20695 }];

beforeEach(() => {
  demoOn = true;
  bounded.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe("demoFetch gate — which responses may be rewritten", () => {
  it("masks an RPC read, which arrives as POST (the MP-530 bug)", async () => {
    bounded.mockResolvedValue(json(highlights()));
    const out = await demoFetch(`${REST}/rpc/landing_deal_highlights`, { method: "POST" });
    const body = (await out.json()) as Array<Record<string, unknown>>;
    expect(body[0].agent).not.toBe("OBIAJULU");
    expect(body[0].amount).not.toBe(20695);
  });

  it("masks an edge function read, also POST", async () => {
    bounded.mockResolvedValue(json({ client_name: "Real Person", annual_premium: 2400 }));
    const out = await demoFetch(`${FN}/agent-summary`, { method: "POST" });
    const body = (await out.json()) as Record<string, unknown>;
    expect(body.client_name).not.toBe("Real Person");
    expect(body.annual_premium).not.toBe(2400);
  });

  it("still masks an ordinary GET select", async () => {
    bounded.mockResolvedValue(json([{ client_name: "Real Person" }]));
    const out = await demoFetch(`${REST}/deals?select=*`);
    const body = (await out.json()) as Array<Record<string, unknown>>;
    expect(body[0].client_name).not.toBe("Real Person");
  });

  it("does NOT mask a genuine table write's returning row", async () => {
    bounded.mockResolvedValue(json([{ client_name: "Real Person", annual_premium: 2400 }]));
    const out = await demoFetch(`${REST}/deals`, { method: "POST" });
    const body = (await out.json()) as Array<Record<string, unknown>>;
    expect(body[0].client_name).toBe("Real Person");
    expect(body[0].annual_premium).toBe(2400);
  });

  it("does NOT mask PATCH or DELETE at a table", async () => {
    for (const method of ["PATCH", "DELETE"]) {
      bounded.mockResolvedValue(json([{ client_name: "Real Person" }]));
      const out = await demoFetch(`${REST}/deals?id=eq.1`, { method });
      const body = (await out.json()) as Array<Record<string, unknown>>;
      expect(body[0].client_name).toBe("Real Person");
    }
  });

  it("never alters the outgoing request — the write that leaves is the write Sam made", async () => {
    bounded.mockResolvedValue(json([{ ok: true }]));
    const init = { method: "POST", body: JSON.stringify({ client_name: "Real Person", annual_premium: 2400 }) };
    await demoFetch(`${REST}/rpc/post_a_deal`, init);
    const [, sentInit] = bounded.mock.calls[0];
    expect(sentInit.body).toBe(init.body);
    expect(sentInit.method).toBe("POST");
  });

  it("leaves auth alone even on POST — masking a token refresh would end the session", async () => {
    bounded.mockResolvedValue(json({ access_token: "real", user: { email: "sam@apex.com" } }));
    const out = await demoFetch("https://xrzweoneiieddzxogewk.supabase.co/auth/v1/token", { method: "POST" });
    const body = (await out.json()) as Record<string, unknown>;
    expect((body.user as Record<string, unknown>).email).toBe("sam@apex.com");
  });

  it("passes everything through untouched when demo mode is off", async () => {
    demoOn = false;
    bounded.mockResolvedValue(json(highlights()));
    const out = await demoFetch(`${REST}/rpc/landing_deal_highlights`, { method: "POST" });
    const body = (await out.json()) as Array<Record<string, unknown>>;
    expect(body[0].agent).toBe("OBIAJULU");
  });

  it("passes non-JSON and non-ok responses through rather than guessing", async () => {
    bounded.mockResolvedValue(new Response("plain", { status: 200, headers: { "content-type": "text/plain" } }));
    expect(await (await demoFetch(`${REST}/rpc/x`, { method: "POST" })).text()).toBe("plain");

    bounded.mockResolvedValue(json({ agent: "OBIAJULU" }, 500));
    const bad = await demoFetch(`${REST}/rpc/x`, { method: "POST" });
    expect(bad.status).toBe(500);
    expect(((await bad.json()) as Record<string, unknown>).agent).toBe("OBIAJULU");
  });

  it("reads the method off a Request object, not just init", async () => {
    bounded.mockResolvedValue(json(highlights()));
    const req = new Request(`${REST}/rpc/landing_deal_highlights`, { method: "POST" });
    const body = (await (await demoFetch(req)).json()) as Array<Record<string, unknown>>;
    expect(body[0].agent).not.toBe("OBIAJULU");
  });
});

describe("demoMode name coverage — the field the live page actually rendered", () => {
  it("masks a bare `agent` key, which `agent_name` alone did not reach", async () => {
    const { maskPayload } = await vi.importActual<typeof import("@/lib/demoMode")>("@/lib/demoMode");
    const out = maskPayload([{ agent: "OBIAJULU", agent_id: "11111111-2222-3333-4444-555555555555" }]) as Array<
      Record<string, unknown>
    >;
    expect(out[0].agent).not.toBe("OBIAJULU");
    expect(out[0].agent_id).toBe("11111111-2222-3333-4444-555555555555");
  });

  it("recurses into an object under `agent` instead of name-masking it", async () => {
    const { maskPayload } = await vi.importActual<typeof import("@/lib/demoMode")>("@/lib/demoMode");
    const out = maskPayload({ agent: { wordsPerMinute: 140, status: "active" } }) as Record<string, unknown>;
    const nested = out.agent as Record<string, unknown>;
    expect(typeof nested).toBe("object");
    expect(nested.status).toBe("active");
  });
});
