import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { sendClaimed } from "./claim.ts";

// A fake PostgREST client: just enough of the builder chain to record what claim.ts asks for.
// `rowsHeld` is the set of application ids whose stamp column is already non-null.
function fakeDb(opts: { rowsHeld?: Set<string>; claimError?: boolean; receiptError?: boolean } = {}) {
  const held = opts.rowsHeld ?? new Set<string>();
  const log: string[] = [];
  const db = {
    from(table: string) {
      if (table === "email_delivery_log") {
        return {
          insert(row: Record<string, unknown>) {
            log.push(`receipt ${row.template} ${row.provider_message_id} ${row.related_record_id}`);
            return Promise.resolve({ error: opts.receiptError ? { message: "boom" } : null });
          },
        };
      }
      let values: Record<string, unknown> = {};
      const filters: string[] = [];
      let id = "";
      const chain = {
        update(v: Record<string, unknown>) { values = v; return chain; },
        eq(col: string, val: string) { if (col === "id") id = val; else filters.push(`${col}=${val}`); return chain; },
        is(col: string, _v: null) { filters.push(`${col} is null`); return chain; },
        select(_cols: string) {
          // claim: conditional update
          if (opts.claimError) return Promise.resolve({ data: null, error: { message: "db down" } });
          const col = Object.keys(values)[0];
          // Only a conditional update (".is(col, null)") can lose to an earlier claim; an
          // unconditional one overwrites the stamp, which is exactly the double-send bug.
          const conditional = filters.includes(`${col} is null`);
          if (conditional && held.has(id)) { log.push(`claim-lost ${col} ${id}`); return Promise.resolve({ data: [], error: null }); }
          held.add(id);
          log.push(`claim ${col} ${id}`);
          return Promise.resolve({ data: [{ id }], error: null });
        },
        then(resolve: (r: { error: null }) => void) {
          // release: update ... eq(id) eq(col, stamp), awaited directly
          const col = Object.keys(values)[0];
          if (values[col] === null && filters.some((f) => f.startsWith(`${col}=`))) {
            held.delete(id);
            log.push(`release ${col} ${id}`);
          }
          resolve({ error: null });
        },
      };
      return chain;
    },
  };
  return { db, log, held };
}

const app = { id: "app-1", email: "a@gmail.com" };

Deno.test("a delivered send keeps the claim and writes one receipt", async () => {
  const f = fakeDb();
  const r = await sendClaimed(f.db, app, "day1_nudge_sent_at", "followup-day1", () => Promise.resolve("re_123"));
  assertEquals(r.sent, true);
  assertEquals(f.log, ["claim day1_nudge_sent_at app-1", "receipt followup-day1 re_123 app-1"]);
  assertEquals(f.held.has("app-1"), true);
});

Deno.test("a second run cannot claim the same person, so nothing is sent twice", async () => {
  const f = fakeDb();
  let sends = 0;
  const send = () => { sends += 1; return Promise.resolve("re_1"); };
  const first = await sendClaimed(f.db, app, "followup_sent_at", "followup-day3", send);
  const second = await sendClaimed(f.db, app, "followup_sent_at", "followup-day3", send);
  assertEquals([first.sent, second.sent, sends], [true, false, 1]);
});

Deno.test("a refused or failed send releases the claim and writes no receipt", async () => {
  const f = fakeDb();
  const r = await sendClaimed(f.db, app, "followup_licensed_sent_at", "followup-licensed", () => Promise.resolve(null));
  assertEquals(r.sent, false);
  assertEquals(f.log, ["claim followup_licensed_sent_at app-1", "release followup_licensed_sent_at app-1"]);
  assertEquals(f.held.has("app-1"), false);
});

Deno.test("a send that throws is treated as not sent and released", async () => {
  const f = fakeDb();
  const r = await sendClaimed(f.db, app, "followup_unlicensed_2_sent_at", "followup-day7", () => Promise.reject(new Error("network")));
  assertEquals(r.sent, false);
  assertEquals(f.held.has("app-1"), false);
});

Deno.test("a claim the database cannot record sends nothing", async () => {
  const f = fakeDb({ claimError: true });
  let sends = 0;
  const r = await sendClaimed(f.db, app, "day1_nudge_sent_at", "followup-day1", () => { sends += 1; return Promise.resolve("re_9"); });
  assertEquals([r.sent, sends], [false, 0]);
});

Deno.test("a failed receipt insert does not undo a delivered send", async () => {
  const f = fakeDb({ receiptError: true });
  const r = await sendClaimed(f.db, app, "day1_nudge_sent_at", "followup-day1", () => Promise.resolve("re_5"));
  assertEquals(r.sent, true);
  assertEquals(f.held.has("app-1"), true);
});
