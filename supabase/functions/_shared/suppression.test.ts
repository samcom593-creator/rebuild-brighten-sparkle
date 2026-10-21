import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { inList, lookupSuppressed, recipientOf, verdictFromRows } from "./suppression.ts";

const row = (to: string, created_at: string, last_event: string, id = "e") => ({ to: [to], created_at, last_event, id });

Deno.test("latest send decides: suppressed after delivered blocks", () => {
  const v = verdictFromRows([
    row("A@x.com", "2026-10-20 10:00:00+00", "delivered"),
    row("a@x.com", "2026-10-21 10:00:00+00", "suppressed", "e2"),
  ]);
  assertEquals([...v.suppressed.keys()], ["a@x.com"]);
  assertEquals(v.suppressed.get("a@x.com")?.resend_email_id, "e2");
  assertEquals(v.cleared.size, 0);
});

Deno.test("latest send decides: delivered after suppressed clears", () => {
  const v = verdictFromRows([
    row("a@x.com", "2026-10-21 10:00:00+00", "delivered"),
    row("a@x.com", "2026-10-20 10:00:00+00", "suppressed"),
  ]);
  assertEquals(v.suppressed.size, 0);
  assert(v.cleared.has("a@x.com"));
});

Deno.test("bounced alone neither blocks nor clears", () => {
  const v = verdictFromRows([row("b@x.com", "2026-10-21 10:00:00+00", "bounced")]);
  assertEquals(v.suppressed.size, 0);
  assertEquals(v.cleared.size, 0);
});

Deno.test("recipientOf takes the first address, lowercased", () => {
  assertEquals(recipientOf({ to: [" Sam@X.com ", "z@y.com"] }), "sam@x.com");
  assertEquals(recipientOf({ to: "q@y.com" }), "q@y.com");
  assertEquals(recipientOf({ to: null }), "");
});

Deno.test("inList quotes values so a comma cannot split the list", () => {
  assertEquals(inList(['a,b@x.com', 'c"d@x.com']), '("a,b@x.com","c\\"d@x.com")');
});

const stub = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const opts = { url: "https://db", key: "k" };

Deno.test("lookup returns the suppressed subset", async () => {
  const got = await lookupSuppressed(["A@x.com", "b@x.com"], { ...opts, fetchImpl: stub(200, [{ email: "a@x.com" }]) });
  assertEquals(got, new Set(["a@x.com"]));
});

Deno.test("a failed lookup is null (send), never an empty block and never a throw", async () => {
  assertEquals(await lookupSuppressed(["a@x.com"], { ...opts, fetchImpl: stub(500, { message: "boom" }) }), null);
  assertEquals(await lookupSuppressed(["a@x.com"], { ...opts, fetchImpl: stub(200, { not: "an array" }) }), null);
  const throws = (async () => { throw new TypeError("network"); }) as unknown as typeof fetch;
  assertEquals(await lookupSuppressed(["a@x.com"], { ...opts, fetchImpl: throws }), null);
  assertEquals(await lookupSuppressed(["a@x.com"], { url: "", key: "" }), null);
});

Deno.test("lookup asks only for rows inside the recheck window", async () => {
  let asked = "";
  const spy = (async (u: string) => { asked = u; return new Response("[]", { status: 200 }); }) as unknown as typeof fetch;
  await lookupSuppressed(["a@x.com"], { ...opts, now: new Date("2026-10-21T00:00:00Z"), fetchImpl: spy });
  assert(asked.includes("last_seen_at=gte." + encodeURIComponent("2026-09-21T00:00:00.000Z")), asked);
  assert(asked.includes("email=in." + encodeURIComponent('("a@x.com")')), asked);
});
