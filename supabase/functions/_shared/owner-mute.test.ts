import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { dropOwnerMuted, isOwnerMuted, loadOwnerMute, parseOwnerMute, resetOwnerMuteCache } from "./owner-mute.ts";
import { gateResend } from "./resend-gate.ts";
import { REFUSED_OWNER_MUTED } from "./owner-mute.ts";

const POLICY = parseOwnerMute(JSON.stringify({
  enabled: true,
  owners: ["Info@KingOfSales.net"],
  subjects: ["Log your numbers", "just recruited"],
}));

Deno.test("owner + muted subject is muted, case-insensitive, display-name form included", () => {
  assertEquals(isOwnerMuted(POLICY, "info@kingofsales.net", "Galaxy · log your numbers"), true);
  assertEquals(isOwnerMuted(POLICY, "Sam <INFO@kingofsales.net>", "🏆 A Just Recruited B!"), true);
});

Deno.test("an applicant alert to the owner is never muted", () => {
  assertEquals(isOwnerMuted(POLICY, "info@kingofsales.net", "LICENSED ✅ — Jo Doe · AZ · CALL NOW"), false);
});

Deno.test("the same subject to anyone else is sent", () => {
  assertEquals(isOwnerMuted(POLICY, "agent@x.com", "Galaxy · log your numbers"), false);
  assertEquals(dropOwnerMuted(POLICY, ["agent@x.com", "info@kingofsales.net"], "log your numbers"), ["agent@x.com"]);
});

Deno.test("disabled, missing or unreadable policy mutes nothing", () => {
  assertEquals(isOwnerMuted(parseOwnerMute('{"enabled":false,"owners":["a@b.c"],"subjects":["x"]}'), "a@b.c", "x"), false);
  assertEquals(isOwnerMuted(null, "a@b.c", "x"), false);
  assertEquals(parseOwnerMute("not json"), null);
});

Deno.test("loadOwnerMute: a failed read is null, never a policy", async () => {
  resetOwnerMuteCache();
  const failing = (() => Promise.resolve(new Response("nope", { status: 500 }))) as unknown as typeof fetch;
  assertEquals(await loadOwnerMute({ url: "http://x", key: "k", fetchImpl: failing }), null);
});

// deno-lint-ignore no-explicit-any
function fakeClient(): { client: { emails: { send: (p: any) => Promise<any> } }; sent: any[] } {
  // deno-lint-ignore no-explicit-any
  const sent: any[] = [];
  return { sent, client: { emails: { send: (p) => { sent.push(p); return Promise.resolve({ data: { id: "re_1" }, error: null }); } } } };
}
const noSuppression = () => Promise.resolve(new Set<string>());
const mute = () => Promise.resolve(POLICY);

Deno.test("gate: owner-only muted send is refused with no id", async () => {
  const { client, sent } = fakeClient();
  const r = await gateResend(client, { lookup: noSuppression, ownerMute: mute }).emails.send({ to: ["info@kingofsales.net"], subject: "Galaxy · log your numbers" });
  assertEquals(sent.length, 0);
  assertEquals(r.data, null);
  assertEquals(r.error.name, REFUSED_OWNER_MUTED);
});

Deno.test("gate: owner dropped from to, cc and bcc; everyone else still gets it", async () => {
  const { client, sent } = fakeClient();
  await gateResend(client, { lookup: noSuppression, ownerMute: mute }).emails.send({
    to: ["mgr@x.com", "info@kingofsales.net"], cc: "info@kingofsales.net", bcc: ["info@kingofsales.net", "other@x.com"],
    subject: "🏆 A Just Recruited B!",
  });
  assertEquals(sent.length, 1);
  assertEquals(sent[0].to, ["mgr@x.com"]);
  assertEquals(sent[0].cc, undefined);
  assertEquals(sent[0].bcc, ["other@x.com"]);
});

Deno.test("gate: unmuted subject to the owner passes through unchanged", async () => {
  const { client, sent } = fakeClient();
  const payload = { to: ["info@kingofsales.net"], subject: "UNLICENSED — Jo Doe · AZ · course first" };
  await gateResend(client, { lookup: noSuppression, ownerMute: mute }).emails.send(payload);
  assertEquals(sent, [payload]);
});
