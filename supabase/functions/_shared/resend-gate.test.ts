import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { addressOf, gateResend, REFUSED_NON_ROUTABLE, REFUSED_SUPPRESSED } from "./resend-gate.ts";

// deno-lint-ignore no-explicit-any
function fakeClient(): { client: { emails: { send: (p: any) => Promise<any> } }; sent: any[] } {
  // deno-lint-ignore no-explicit-any
  const sent: any[] = [];
  return {
    sent,
    client: { emails: { send: (p) => { sent.push(p); return Promise.resolve({ data: { id: "re_1" }, error: null }); } } },
  };
}
const lookupOf = (blocked: string[] | null) => () => Promise.resolve(blocked === null ? null : new Set(blocked));

Deno.test("suppressed single recipient: refused, inner send never called", async () => {
  const { client, sent } = fakeClient();
  const r = await gateResend(client, { lookup: lookupOf(["dead@x.com"]) }).emails.send({ to: "Dead@X.com", subject: "s" });
  assertEquals(sent.length, 0);
  assertEquals(r.data, null);
  assertEquals(r.error.name, REFUSED_SUPPRESSED);
});

Deno.test("display-name form is matched on the address inside <>", async () => {
  const { client, sent } = fakeClient();
  const r = await gateResend(client, { lookup: lookupOf(["dead@x.com"]) }).emails.send({ to: "Dead Person <dead@x.com>", subject: "s" });
  assertEquals(sent.length, 0);
  assertEquals(r.error.name, REFUSED_SUPPRESSED);
  assertEquals(addressOf("A B <A@B.com> "), "a@b.com");
});

Deno.test("clean recipient: payload passed through unchanged, SDK result returned", async () => {
  const { client, sent } = fakeClient();
  const payload = { to: "ok@x.com", subject: "s", html: "<p/>" };
  const r = await gateResend(client, { lookup: lookupOf([]) }).emails.send(payload);
  assertEquals(sent, [payload]);
  assertEquals(r.data.id, "re_1");
});

Deno.test("multi-recipient: suppressed one dropped, the rest still sent", async () => {
  const { client, sent } = fakeClient();
  await gateResend(client, { lookup: lookupOf(["b@x.com"]) }).emails.send({ to: ["a@x.com", "b@x.com", "c@x.com"], subject: "s" });
  assertEquals(sent.length, 1);
  assertEquals(sent[0].to, ["a@x.com", "c@x.com"]);
});

Deno.test("non-routable domain refused without a lookup", async () => {
  const { client, sent } = fakeClient();
  let looked = false;
  const r = await gateResend(client, { lookup: () => { looked = true; return Promise.resolve(new Set<string>()); } })
    .emails.send({ to: "kae@placeholder.apex", subject: "s" });
  assertEquals(sent.length, 0);
  assertEquals(looked, false);
  assertEquals(r.error.name, REFUSED_NON_ROUTABLE);
});

Deno.test("failed lookup (null) sends anyway", async () => {
  const { client, sent } = fakeClient();
  const r = await gateResend(client, { lookup: lookupOf(null) }).emails.send({ to: "dead@x.com", subject: "s" });
  assertEquals(sent.length, 1);
  assertEquals(r.data.id, "re_1");
});

Deno.test("null client passes through (resendKey ? gateResend(new Resend(k)) : null)", () => {
  assertEquals(gateResend(null), null);
  assertEquals(gateResend(undefined), undefined);
});

Deno.test("wrapping twice does not look up twice", async () => {
  const { client } = fakeClient();
  let calls = 0;
  const lookup = () => { calls++; return Promise.resolve(new Set<string>()); };
  const g = gateResend(gateResend(client, { lookup }), { lookup });
  await g.emails.send({ to: "ok@x.com", subject: "s" });
  assertEquals(calls, 1);
});
