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

beforeEach(async () => {
  demoOn = true;
  bounded.mockReset();
  // Each test is its own demo session: priming is once-per-session by design,
  // so a leftover primed map would make a later test pass for the wrong reason.
  const dm = await vi.importActual<typeof import("@/lib/demoMode")>("@/lib/demoMode");
  dm.setDemoMode(false);
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

// ─── MP-533: the prime is AWAITED ────────────────────────────────────────────
// The obvious shape of this fix — kick the roster load off when demo mode turns
// on — is the ordering race MP-532 could not close, moved one file over: the
// first payloads are still masked against an empty map. The only version that
// is a fix is one where no response is rewritten before the roster is resident.
// So this grades the sequencing, not the mask: a loader that resolves LATE must
// still have taught the map by the time the body comes back.
describe("MP-533 roster prime sequencing", () => {
  const ROSTER = `${REST}/agents`;

  /** The live SamHQ payload: a real name inside prose, no name column anywhere. */
  const drafts = () => [{ id: 5130, title: "Aisha Kebbeh · $1,284 Deal Win" }];

  function installRoster(names: string[], delayMs: number) {
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const u = typeof input === "string" ? input : input.toString();
      if (!u.startsWith(ROSTER)) throw new Error(`unexpected fetch: ${u}`);
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      return json(names.map((display_name) => ({ display_name })));
    });
  }

  afterEach(() => vi.restoreAllMocks());

  it("masks prose against a roster that resolves AFTER the response body", async () => {
    const spy = installRoster(["Aisha Kebbeh"], 25);
    bounded.mockResolvedValue(json(drafts()));

    const res = await demoFetch(`${REST}/social_bot_drafts?select=id,title`, {
      headers: { apikey: "anon-key", Authorization: "Bearer jwt" },
    });
    const body = (await res.json()) as Array<Record<string, string>>;

    expect(spy).toHaveBeenCalledTimes(1);
    expect(body[0].title).not.toContain("Aisha");
    expect(body[0].title).not.toContain("Kebbeh");
    expect(body[0].title).toContain("Deal Win");
  });

  it("primes with the intercepted request's OWN credentials, never a second set", async () => {
    const spy = installRoster(["Aisha Kebbeh"], 0);
    bounded.mockResolvedValue(json(drafts()));

    await demoFetch(`${REST}/social_bot_drafts?select=id,title`, {
      headers: { apikey: "anon-key", Authorization: "Bearer the-callers-jwt" },
    });

    const init = spy.mock.calls[0][1] as RequestInit;
    const sent = new Headers(init.headers as HeadersInit);
    // A prime that outranks the caller would read rows the page itself cannot,
    // and mask a demo against a roster the session was never allowed to see.
    expect(sent.get("apikey")).toBe("anon-key");
    expect(sent.get("Authorization")).toBe("Bearer the-callers-jwt");
  });

  it("returns the page when the roster read fails — the mask never takes the site down", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    bounded.mockResolvedValue(json([{ annual_premium: 2400, title: "Aisha Kebbeh · $1,284 Deal Win" }]));

    const res = await demoFetch(`${REST}/social_bot_drafts?select=id,title`, {
      headers: { apikey: "anon-key" },
    });
    const body = (await res.json()) as Array<Record<string, unknown>>;

    expect(res.ok).toBe(true);
    // Everything the key-based mask covers still works; only prose is degraded,
    // and the banner is what says so.
    expect(body[0].annual_premium).not.toBe(2400);
    expect(String(body[0].title)).not.toContain("$1,284");
  });
});

// The await that turns this from a prefetch-race into a fix is also what makes
// a hung roster fatal: every masked response in the demo queues behind the
// first one. A roster that never answers must degrade the mask, never freeze
// the walkthrough on a blank screen in front of whoever Sam is showing it to.
describe("MP-533 the awaited prime is bounded", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it("gives up on a roster that never answers and still returns the page", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_i: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          // Exactly what an aborted fetch does: reject on the signal, never settle otherwise.
          init?.signal?.addEventListener("abort", () => reject(new Error("AbortError")));
        }),
    );
    bounded.mockResolvedValue(json([{ annual_premium: 2400, title: "Aisha Kebbeh · $1,284 Deal Win" }]));

    const res = await demoFetch(`${REST}/social_bot_drafts?select=id,title`, {
      headers: { apikey: "anon-key" },
    });
    const body = (await res.json()) as Array<Record<string, unknown>>;

    expect(res.ok).toBe(true);
    expect(body[0].annual_premium).not.toBe(2400);
  }, 15000);
});
