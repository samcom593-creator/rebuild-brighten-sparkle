import { beforeEach, describe, expect, it, vi } from "vitest";
let handler: (req: Request) => Promise<Response>;
beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("Deno", {
    env: {
      get: (key: string) =>
        key === "SUPABASE_SERVICE_ROLE_KEY"
          ? "service-test-key"
          : key === "ANTHROPIC_API_KEY"
            ? "test-anthropic"
            : undefined,
    },
    serve: (fn: typeof handler) => {
      handler = fn;
    },
  });
  vi.stubGlobal("fetch", vi.fn());
  // A variable specifier keeps this Deno entry point out of the web tsc program (it has no Deno
  // types; deno check covers it). vitest still resolves and runs it exactly as before.
  const entry = "../../../supabase/functions/money-inbox-classify/index";
  await import(/* @vite-ignore */ entry);
});
const request = (text: string, authorized = true) =>
  new Request("https://example.test", {
    method: "POST",
    headers: authorized ? { apikey: "service-test-key" } : {},
    body: JSON.stringify({ text }),
  });
describe("Money Inbox internal classification boundary", () => {
  it("rejects anonymous calls without invoking the model", async () => {
    expect((await handler(request("hello", false))).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects oversized messages", async () => {
    expect((await handler(request("x".repeat(16001)))).status).toBe(400);
  });
  it("returns only validated categories and a generic private reason", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          content: [
            {
              text: JSON.stringify({
                topics: ["income"],
                private: true,
                privacy_reason: "private contents here",
              }),
            },
          ],
        }),
      ),
    );
    const response = await handler(request("untrusted"));
    expect(await response.json()).toEqual({
      topics: ["income"],
      private: true,
      privacy_reason: "Private context identified by classifier",
      version: 1,
    });
  });
  it("fails closed on invalid model output", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          content: [
            { text: JSON.stringify({ topics: ["unknown"], private: false }) },
          ],
        }),
      ),
    );
    expect((await handler(request("untrusted"))).status).toBe(502);
  });
});
