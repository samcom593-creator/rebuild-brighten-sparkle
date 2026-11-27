import { deliverWithReceipt, recognitionMetric, recognitionPeriod, validPlaqueDate, validRecognitionAmount } from "./contract.ts";

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
}

Deno.test("provider rejection and missing receipts cannot create a sent record", async () => {
  let recorded = 0;
  for (const response of [{ data: null, error: { message: "suppressed" } }]) {
    const result = await deliverWithReceipt(() => Promise.resolve(response), () => { recorded++; return Promise.resolve(); });
    equal(result.status, "failed");
  }
  equal(recorded, 0);
});

Deno.test("an empty provider response needs review rather than an automatic retry", async () => {
  const result = await deliverWithReceipt(() => Promise.resolve({ data: null, error: null }), () => Promise.resolve());
  equal(result.status, "unknown");
});

Deno.test("hire and streak plaques use their actual units", () => {
  equal(recognitionMetric("recruiter_rising", 5), "5 hires");
  equal(recognitionMetric("hot_streak", 10), "10 days");
  equal(recognitionMetric("single_day_platinum", 5000), "$5,000");
});

Deno.test("unknown request or stored award amounts cannot become zero", () => {
  for (const amount of [null, undefined, "", "0", "5000", false, true, NaN, Infinity, -1]) {
    equal(validRecognitionAmount(amount), false);
    let refused = false;
    try { recognitionMetric("hot_streak", amount as number); } catch { refused = true; }
    equal(refused, true);
  }
  // A recorded numeric zero is distinct from missing evidence; keep existing rules.
  equal(validRecognitionAmount(0), true);
  equal(validRecognitionAmount(3000.5), true);
  equal(recognitionMetric("hot_streak", 0), "0 days");
});

Deno.test("comeback recognition reports the recorded premium increase", () => {
  equal(recognitionMetric("comeback_champion", 3500), "+$3,500");
  equal(recognitionMetric("weekly", 3500), "$3,500");
});

Deno.test("a transport exception is unknown rather than an auto-retryable rejection", async () => {
  const result = await deliverWithReceipt(() => Promise.reject(new Error("response lost")), () => Promise.resolve());
  equal(result.status, "unknown");
});

Deno.test("provider acceptance is not claimed if the receipt cannot be persisted", async () => {
  const result = await deliverWithReceipt(() => Promise.resolve({ data: { id: "synthetic-receipt" } }), () => Promise.reject(new Error("database unavailable")));
  equal(result.status, "unknown");
});

Deno.test("a persisted provider receipt confirms the send", async () => {
  let saved = "";
  const result = await deliverWithReceipt(() => Promise.resolve({ data: { id: "synthetic-receipt" } }), (id) => { saved = id; return Promise.resolve(); });
  equal(result, { status: "sent", providerId: "synthetic-receipt" });
  equal(saved, "synthetic-receipt");
});

Deno.test("recognition windows normalize Mondays and month-end callers without including future days", () => {
  equal(recognitionPeriod("weekly", "2026-11-01", "2026-11-01"), { start: "2026-10-26", end: "2026-11-02" });
  equal(recognitionPeriod("monthly", "2026-10-31", "2026-11-26"), { start: "2026-10-01", end: "2026-11-01" });
  equal(recognitionPeriod("monthly", "2026-11-01", "2026-11-26"), { start: "2026-11-01", end: "2026-11-27" });
  equal(validPlaqueDate("2026-02-30"), false);
  let refused = false;
  try { recognitionPeriod("single_day", "2026-11-27", "2026-11-26"); } catch { refused = true; }
  equal(refused, true);
});
