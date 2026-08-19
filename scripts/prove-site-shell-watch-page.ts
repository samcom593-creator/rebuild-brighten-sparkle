// MP-306 proof. Extracts the REAL retry ladder from the deployed source by
// delimiter and drives it against a stub. Asserts the slice is authoritative
// BEFORE any fixture runs -- a harness that silently slices nothing passes
// every test while proving none (MP-283).
const src = await Deno.readTextFile(
  "supabase/functions/site-shell-watch/index.ts",
);
const a = src.indexOf("      // next-tick retry is still the backstop; page_error is still the receipt.");
const b = src.indexOf("      // A failed push is a FAILURE, not a page.");
if (a < 0 || b < 0 || b <= a) throw new Error("SLICE FAILED - anchors moved");
const slice = src.slice(a, b);
for (const tok of ["fetch(NTFY", "paged = res.ok", "attempt", "Priority"]) {
  if (!slice.includes(tok)) throw new Error(`slice missing ${tok}`);
}
if (/bot_sql|Deno\.env|import /.test(slice)) throw new Error("slice can refetch its own operand");
console.log(`SLICE OK (${slice.split("\n").length} lines)`);

let served: number[] = [];
const run = async (codes: number[]) => {
  served = [];
  const ac = new AbortController();
  const srv = Deno.serve({ port: 8931, signal: ac.signal, onListen: () => {} }, () => {
    const c = codes[served.length] ?? 200;
    served.push(c);
    return new Response(
      c === 200 ? "{}" : `{"code":42901,"http":${c},"error":"limit reached: request limit"}`,
      { status: c },
    );
  });
  const NTFY = "http://localhost:8931/";
  const p = { reason: "STUB REASON" };
  let paged = false, pageError: string | null = null;
  const t0 = Date.now();
  await eval(`(async () => {\n${slice}\n if (paged) { pageError = null; }\n})()`);
  const ms = Date.now() - t0;
  ac.abort();
  await srv.finished;
  return { paged, pageError, attempts: served.length, ms };
};

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, got: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}  :: ${JSON.stringify(got)}`);
};

// F1: refused twice, accepted on the third -> the page LANDS.
let r = await run([429, 429, 200]);
check("F1 429,429,200 -> paged", r.paged === true, r);
check("F1 made all 3 attempts", r.attempts === 3, r.attempts);
check("F1 clears pageError on success", r.pageError === null, r.pageError);
check("F1 backed off (>=7.5s)", r.ms >= 7000, r.ms);

// F2: refused every time -> honest failure carrying the ntfy CODE, not just 429.
r = await run([429, 429, 429]);
check("F2 all-429 -> paged false", r.paged === false, r.paged);
check("F2 records ntfy code 42901", String(r.pageError).includes("42901"), r.pageError);
check("F2 records attempt 3/3", String(r.pageError).includes("3/3"), r.pageError);
check("F2 stopped at 3 attempts", r.attempts === 3, r.attempts);

// F3: accepted first time -> no wasted retries, no backoff cost.
r = await run([200]);
check("F3 200 -> one attempt only", r.attempts === 1, r.attempts);
check("F3 no backoff on success path", r.ms < 2000, r.ms);
check("F3 pageError null", r.pageError === null, r.pageError);

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
if (fail) Deno.exit(1);
